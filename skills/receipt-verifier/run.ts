import { putArtifact } from "../../runtime/artifacts.js";
import {
  deriveClientOrderRef,
  fingerprintWriteIntent,
  markWriteIntentAmbiguous,
  markWriteIntentExecuted,
} from "../../runtime/idempotency.js";
import { matchIntentAgainstHistory, type HistoryMatchOutcome } from "../../runtime/reconciliation.js";
import type {
  ExecutionRecord,
  ReceiptVerification,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";

function now(): string {
  return new Date().toISOString();
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function latestExecutionFromInput(context: SkillContext): ExecutionRecord | null {
  const raw = context.runtimeInput.latestExecution ?? context.runtimeInput.execution;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as ExecutionRecord;
}

function reconcileWindowMinutes(context: SkillContext): number {
  const raw = toFiniteNumber(context.runtimeInput.reconcileWindowMin);
  if (raw === null || raw <= 0) {
    return 120;
  }
  return Math.floor(raw);
}

function verificationStatus(outcome: HistoryMatchOutcome): ReceiptVerification["status"] {
  if (outcome.status === "matched") {
    return "verified";
  }
  if (outcome.status === "ambiguous") {
    return "ambiguous";
  }
  return outcome.status === "query_failed" ? "failed" : "pending";
}

function matchedBy(outcomes: HistoryMatchOutcome[]): ReceiptVerification["matchedBy"] {
  if (outcomes.some((outcome) => outcome.matchedBy === "client_order_ref")) {
    return "client_order_ref";
  }
  if (outcomes.some((outcome) => outcome.matchedBy === "fallback_window")) {
    return "fallback_window";
  }
  return "none";
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const execution = latestExecutionFromInput(context);
  if (!execution || execution.mode !== "execute") {
    throw new Error("receipt-verifier requires latest execute record in runtimeInput.latestExecution.");
  }

  const windowMin = reconcileWindowMinutes(context);
  const writeResults = execution.results.filter((result) => result.intent.requiresWrite);
  const evidence: string[] = [];

  if (writeResults.length === 0) {
    const verification: ReceiptVerification = {
      status: "not_applicable",
      plane: execution.plane,
      executionId: execution.executionId,
      checkedAt: now(),
      matchedBy: "none",
      evidence: ["No write intent was present on this execution."],
      nextAction: `node dist/bin/trademesh.js export ${context.runId}`,
    };
    putArtifact(context.artifacts, {
      key: "operations.receipt-verification",
      version: context.manifest.artifactVersion,
      producer: context.manifest.name,
      data: verification,
    });
    return {
      skill: context.manifest.name,
      stage: context.manifest.stage,
      goal: context.goal,
      summary: "No write receipt verification was needed for this execution.",
      facts: verification.evidence,
      constraints: {
        status: verification.status,
      },
      proposal: [],
      risk: {
        score: 0.05,
        maxLoss: "No verification query was required because no write intent executed.",
        needsApproval: false,
        reasons: verification.evidence,
      },
      permissions: {
        plane: context.plane,
        officialWriteOnly: true,
        allowedModules: [],
      },
      handoff: "operator-summarizer",
      handoffReason: "Receipt verification is complete.",
      producedArtifacts: ["operations.receipt-verification"],
      consumedArtifacts: ["execution.intent-bundle"],
      metadata: {
        receiptVerification: verification,
      },
      timestamp: now(),
    };
  }

  const outcomes: HistoryMatchOutcome[] = [];
  for (const result of writeResults) {
    const outcome = await matchIntentAgainstHistory(result.intent, execution.plane, result.startedAt, "auto", windowMin);
    outcomes.push(outcome);
    evidence.push(`${result.intent.intentId}: ${outcome.status} (${outcome.reason})`);

    const fingerprint = fingerprintWriteIntent(result.intent, execution.plane);
    if (outcome.status === "matched") {
      await markWriteIntentExecuted({
        fingerprint,
        remoteOrderId: outcome.remoteOrderId,
      });
    } else if (outcome.status === "ambiguous") {
      await markWriteIntentAmbiguous({
        fingerprint,
        lastError: outcome.reason,
      });
    }
  }

  const statuses = outcomes.map(verificationStatus);
  const status: ReceiptVerification["status"] =
    statuses.every((entry) => entry === "verified")
      ? "verified"
      : statuses.some((entry) => entry === "ambiguous")
        ? "ambiguous"
        : statuses.some((entry) => entry === "failed")
          ? "failed"
          : "pending";
  const verification: ReceiptVerification = {
    status,
    plane: execution.plane,
    executionId: execution.executionId,
    checkedAt: now(),
    matchedBy: matchedBy(outcomes),
    evidence,
    nextAction: status === "verified"
      ? `node dist/bin/trademesh.js export ${context.runId}`
      : `node dist/bin/trademesh.js reconcile ${context.runId} --source auto --window-min ${windowMin} --until-settled --max-attempts 3 --interval-sec 5`,
  };

  putArtifact(context.artifacts, {
    key: "operations.receipt-verification",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: verification,
  });

  return {
    skill: context.manifest.name,
    stage: context.manifest.stage,
    goal: context.goal,
    summary: "Verify freshly executed write receipts against exchange history without replaying writes.",
    facts: [
      `Write intents: ${writeResults.length}.`,
      `Verification status: ${verification.status}.`,
      `Matched by: ${verification.matchedBy}.`,
      ...evidence,
    ],
    constraints: {
      status: verification.status,
      matchedBy: verification.matchedBy,
      nextAction: verification.nextAction,
    },
    proposal: [],
    risk: {
      score: verification.status === "verified" ? 0.12 : verification.status === "pending" ? 0.45 : 0.7,
      maxLoss: "Receipt verification is read-only and does not submit new writes.",
      needsApproval: verification.status !== "verified",
      reasons: evidence,
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: "operator-summarizer",
    handoffReason: "Receipt verification result is ready for the operator summary.",
    producedArtifacts: ["operations.receipt-verification"],
    consumedArtifacts: ["execution.intent-bundle"],
    metadata: {
      receiptVerification: verification,
      clientOrderRefs: writeResults.map((result) => deriveClientOrderRef(result.intent)).filter(Boolean),
    },
    timestamp: now(),
  };
}
