import { putArtifact } from "../../runtime/artifacts.js";
import { buildBusinessBrief } from "../../runtime/business-brief.js";
import { buildOperatorBrief } from "../../runtime/operator-brief.js";
import type {
  ApprovalTicket,
  BusinessBrief,
  ExecutionRecord,
  GoalIntake,
  OperatorSummaryV3,
  PolicyDecision,
  ReceiptVerification,
  ReconciliationReport,
  RunStatus,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";

interface IdempotencyCheckArtifactLike {
  status?: string;
  hitCount?: number;
  items?: Array<{ ledgerSeq?: number | null; status?: string }>;
}

function now(): string {
  return new Date().toISOString();
}

function latestExecutionFromInput(context: SkillContext): ExecutionRecord | null {
  const raw = context.runtimeInput.latestExecution;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as ExecutionRecord;
}

function runStatusFromInput(context: SkillContext): RunStatus {
  const raw = context.runtimeInput.runStatus;
  if (
    raw === "planned" ||
    raw === "approval_required" ||
    raw === "ready" ||
    raw === "blocked" ||
    raw === "dry_run" ||
    raw === "executed" ||
    raw === "failed" ||
    raw === "previewed"
  ) {
    return raw;
  }
  return "planned";
}

function selectedNextAction(context: SkillContext, status: RunStatus): string {
  if (typeof context.runtimeInput.nextSafeAction === "string" && context.runtimeInput.nextSafeAction.trim().length > 0) {
    return context.runtimeInput.nextSafeAction.trim();
  }
  const verification = context.artifacts.get<ReceiptVerification>("operations.receipt-verification")?.data;
  if (verification?.status && verification.status !== "verified" && verification.status !== "not_applicable") {
    return verification.nextAction;
  }
  if (status === "approval_required") {
    return `node dist/bin/trademesh.js apply ${context.runId} --plane ${context.plane} --approve --approved-by <name> --execute`;
  }
  return `node dist/bin/trademesh.js export ${context.runId}`;
}

function computeHitCount(execution: ExecutionRecord | null, idempotencyCheck: IdempotencyCheckArtifactLike | undefined): number {
  const fromExecution = execution
    ? execution.results.filter((result) => result.stderr.includes("skipped(idempotent-hit)")).length
    : 0;
  if (fromExecution > 0) {
    return fromExecution;
  }
  if (typeof idempotencyCheck?.hitCount === "number" && Number.isFinite(idempotencyCheck.hitCount)) {
    return Math.max(0, idempotencyCheck.hitCount);
  }
  return 0;
}

function computeLedgerSeq(execution: ExecutionRecord | null, idempotencyCheck: IdempotencyCheckArtifactLike | undefined): number | null {
  if (typeof execution?.idempotencyLedgerSeq === "number") {
    return execution.idempotencyLedgerSeq;
  }
  const items = Array.isArray(idempotencyCheck?.items) ? idempotencyCheck.items : [];
  const seqs = items
    .map((item) => (typeof item.ledgerSeq === "number" ? item.ledgerSeq : null))
    .filter((seq): seq is number => seq !== null && Number.isFinite(seq));
  if (seqs.length === 0) {
    return null;
  }
  return Math.max(...seqs);
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const status = runStatusFromInput(context);
  const execution = latestExecutionFromInput(context);
  const approvalTicket = context.artifacts.get<ApprovalTicket>("approval.ticket")?.data ?? null;
  const reconciliation = context.artifacts.get<ReconciliationReport>("execution.reconciliation")?.data ?? null;
  const receiptVerification = context.artifacts.get<ReceiptVerification>("operations.receipt-verification")?.data ?? null;
  const goalIntake = context.artifacts.get<GoalIntake>("goal.intake")?.data ?? null;
  const policyDecision = context.artifacts.get<PolicyDecision>("execution.apply-decision")?.data ??
    context.artifacts.get<PolicyDecision>("policy.plan-decision")?.data ??
    null;
  const idempotencyCheck = context.artifacts.get<IdempotencyCheckArtifactLike>("execution.idempotency-check")?.data;

  const blockers: string[] = [];
  if (status === "blocked") {
    blockers.push("policy_blocked_or_runtime_blocked");
  }
  if (status === "approval_required") {
    blockers.push("approval_required");
  }
  if (execution?.blockedReason && execution.blockedReason.trim().length > 0) {
    blockers.push(execution.blockedReason);
  }
  if (idempotencyCheck?.status === "blocked_reconcile_required") {
    blockers.push("idempotency_reconcile_required");
  }
  if (receiptVerification && receiptVerification.status !== "verified" && receiptVerification.status !== "not_applicable") {
    blockers.push(`receipt_verification_${receiptVerification.status}`);
  }
  if (reconciliation && reconciliation.status !== "matched") {
    blockers.push(`reconciliation_${reconciliation.status}`);
  }

  const reconciliationState = receiptVerification?.status === "verified"
    ? "matched"
    : receiptVerification?.status === "ambiguous"
      ? "ambiguous"
      : receiptVerification?.status === "failed"
        ? "failed"
        : receiptVerification?.status === "pending"
          ? "pending"
          : execution?.reconciliationState ?? (reconciliation?.status ?? "none");
  const requiresHumanAction =
    blockers.length > 0 ||
    reconciliationState === "pending" ||
    reconciliationState === "ambiguous" ||
    reconciliationState === "failed" ||
    status === "approval_required";
  const isExecutable =
    !requiresHumanAction &&
    (status === "ready" || status === "dry_run" || status === "planned");
  const nextSafeAction = selectedNextAction(context, status);

  const summary: OperatorSummaryV3 = {
    runId: context.runId,
    plane: context.plane,
    status,
    isExecutable,
    blockers,
    approval: {
      provided: execution?.approvalProvided ?? false,
      ticketId: approvalTicket?.ticketId ?? execution?.approvalTicketId ?? null,
      approvedBy: approvalTicket?.approvedBy ?? null,
      reason: approvalTicket?.reason ?? null,
    },
    idempotency: {
      checked: execution?.idempotencyChecked === true || idempotencyCheck?.status === "ok" || idempotencyCheck?.status === "blocked_reconcile_required",
      hitCount: computeHitCount(execution, idempotencyCheck),
      ledgerSeq: computeLedgerSeq(execution, idempotencyCheck),
    },
    reconciliation: {
      state: reconciliationState,
      required: reconciliationState === "pending" || reconciliationState === "ambiguous" || reconciliationState === "failed",
    },
    nextSafeAction,
    requiresHumanAction,
    generatedAt: now(),
  };
  const brief = buildOperatorBrief(summary);
  const businessBrief: BusinessBrief = buildBusinessBrief({
    goal: context.goal,
    plane: context.plane,
    goalIntake,
    operatorSummary: summary,
    selectedProposal: execution?.proposal ?? (typeof context.runtimeInput.selectedProposal === "string"
      ? context.runtimeInput.selectedProposal
      : undefined),
    policyDecision,
    latestExecution: execution,
  });

  putArtifact(context.artifacts, {
    key: "report.operator-summary",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: summary,
  });
  putArtifact(context.artifacts, {
    key: "report.operator-brief",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: brief,
  });
  putArtifact(context.artifacts, {
    key: "report.business-brief",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: businessBrief,
  });

  return {
    skill: "operator-summarizer",
    stage: "memory",
    goal: context.goal,
    summary: "Generate a single operator-facing state snapshot consumed by replay and export.",
    facts: [
      `Run status: ${status}.`,
      `Executable now: ${summary.isExecutable ? "yes" : "no"}.`,
      `Requires human action: ${summary.requiresHumanAction ? "yes" : "no"}.`,
      `Blockers: ${summary.blockers.length}.`,
      `Primary blocker: ${brief.currentBlocker}.`,
      `Business action: ${businessBrief.recommendedAction}.`,
      `Next safe action: ${summary.nextSafeAction}.`,
    ],
    constraints: {
      status: summary.status,
      blockers: summary.blockers,
      requiresHumanAction: summary.requiresHumanAction,
      isExecutable: summary.isExecutable,
      nextSafeAction: summary.nextSafeAction,
    },
    proposal: [],
    risk: {
      score: summary.requiresHumanAction ? 0.8 : 0.2,
      maxLoss: "No write is executed by operator-summarizer.",
      needsApproval: summary.requiresHumanAction,
      reasons: summary.blockers.length > 0 ? summary.blockers : ["Operator state is stable."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: null,
    producedArtifacts: ["report.operator-summary", "report.operator-brief", "report.business-brief"],
    consumedArtifacts: [
      "goal.intake",
      "approval.ticket",
      "execution.idempotency-check",
      "execution.reconciliation",
      "operations.receipt-verification",
    ],
    metadata: {
      operatorSummary: summary,
      operatorBrief: brief,
      businessBrief,
    },
    timestamp: now(),
  };
}
