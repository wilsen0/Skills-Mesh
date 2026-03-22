import { putArtifact } from "../../runtime/artifacts.js";
import {
  deriveClientOrderRef,
  fingerprintWriteIntent,
  markWriteIntentAmbiguous,
  markWriteIntentExecuted,
} from "../../runtime/idempotency.js";
import { matchIntentAgainstHistory, type ReconcileSource } from "../../runtime/reconciliation.js";
import type {
  ExecutionRecord,
  ReconciliationItem,
  ReconciliationReport,
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
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function executionFromInput(context: SkillContext): ExecutionRecord | null {
  const raw = context.runtimeInput.execution;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as ExecutionRecord;
}

function reconcileSource(context: SkillContext): ReconcileSource {
  const source = context.runtimeInput.reconcileSource;
  if (source === "client-id" || source === "fallback" || source === "auto") {
    return source;
  }
  return "auto";
}

function reconcileWindowMinutes(context: SkillContext): number {
  const raw = toFiniteNumber(context.runtimeInput.reconcileWindowMin);
  if (raw === null || raw <= 0) {
    return 120;
  }
  return raw;
}

function attemptNumber(context: SkillContext): number {
  const raw = toFiniteNumber(context.runtimeInput.attemptNumber);
  if (raw === null || raw <= 0) {
    return 1;
  }
  return Math.floor(raw);
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const execution = executionFromInput(context);
  if (!execution || execution.mode !== "execute") {
    throw new Error("reconcile-engine requires latest execute record in runtimeInput.execution.");
  }

  const source = reconcileSource(context);
  const windowMin = reconcileWindowMinutes(context);
  const attempt = attemptNumber(context);
  const writeResults = execution.results.filter((result) => result.intent.requiresWrite);
  const items: ReconciliationItem[] = [];

  for (const result of writeResults) {
    const intent = result.intent;
    const fingerprint = fingerprintWriteIntent(intent, execution.plane);
    const clientOrderRef = deriveClientOrderRef(intent);
    const outcome = await matchIntentAgainstHistory(intent, execution.plane, result.startedAt, source, windowMin);
    const itemStatus: ReconciliationItem["status"] =
      outcome.status === "matched"
        ? "matched"
        : outcome.status === "ambiguous"
          ? "ambiguous"
          : "failed";

    if (itemStatus === "matched") {
      await markWriteIntentExecuted({
        fingerprint,
        remoteOrderId: outcome.remoteOrderId,
      });
    } else if (itemStatus === "ambiguous") {
      await markWriteIntentAmbiguous({
        fingerprint,
        lastError: outcome.reason,
      });
    }

    items.push({
      intentId: intent.intentId,
      module: intent.module,
      fingerprint,
      clientOrderRef,
      status: itemStatus,
      remoteOrderId: outcome.remoteOrderId,
      reason: outcome.reason,
      evidence: outcome.evidence,
    });
  }

  const status: ReconciliationReport["status"] =
    items.length === 0 || items.every((item) => item.status === "matched")
      ? "matched"
      : items.some((item) => item.status === "ambiguous")
        ? "ambiguous"
        : "failed";
  const nextActions =
    status === "matched"
      ? ["No additional reconcile action is required."]
      : status === "ambiguous"
        ? ["Review ambiguous matches manually, then rerun reconcile."]
        : ["Inspect exchange records and rerun reconcile when evidence is available."];
  const previousAttempts = context.artifacts.get<ReconciliationReport>("execution.reconciliation")?.data?.attempts ?? [];
  const attempts = [...previousAttempts, {
    attempt,
    at: now(),
    source,
    windowMin,
    status,
  }];

  const report: ReconciliationReport = {
    runId: context.runId,
    reconciledAt: now(),
    status,
    items,
    attempts,
    nextActions,
  };

  putArtifact(context.artifacts, {
    key: "execution.reconciliation",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: report,
  });

  return {
    skill: "reconcile-engine",
    stage: "executor",
    goal: context.goal,
    summary: "Reconcile uncertain write intents with exchange history using client-order-id first matching.",
    facts: [
      `Reconcile source: ${source}.`,
      `Window: ${windowMin} min.`,
      `Write intents: ${writeResults.length}.`,
      `Reconcile status: ${status}.`,
      `Attempt: ${attempt}.`,
    ],
    constraints: {
      source,
      windowMin,
      status,
      nextActions,
    },
    proposal: [],
    risk: {
      score: status === "matched" ? 0.2 : status === "ambiguous" ? 0.7 : 0.8,
      maxLoss: "No new writes are submitted during reconcile.",
      needsApproval: status !== "matched",
      reasons: nextActions,
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: "operator-summarizer",
    handoffReason: "Reconcile report is ready for operator decision.",
    producedArtifacts: ["execution.reconciliation"],
    consumedArtifacts: ["execution.intent-bundle"],
    metadata: {
      report,
    },
    timestamp: now(),
  };
}
