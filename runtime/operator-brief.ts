import type { OperatorBrief, OperatorSummaryV3 } from "./types.js";

function formatApprovalState(summary: OperatorSummaryV3): string {
  if (summary.approval.ticketId) {
    return `approved(${summary.approval.approvedBy ?? "unknown"})`;
  }
  if (summary.approval.provided) {
    return "approve_flag_only";
  }
  return "missing";
}

function formatIdempotencyState(summary: OperatorSummaryV3): string {
  if (!summary.idempotency.checked) {
    return "unchecked";
  }
  if (summary.idempotency.hitCount > 0) {
    return `checked(hit=${summary.idempotency.hitCount})`;
  }
  return "checked(clean)";
}

export function buildOperatorBrief(summary: OperatorSummaryV3): OperatorBrief {
  return {
    runId: summary.runId,
    isExecutable: summary.isExecutable,
    currentBlocker: summary.blockers[0] ?? "none",
    approvalState: formatApprovalState(summary),
    idempotencyState: formatIdempotencyState(summary),
    reconciliationState: summary.reconciliation.state,
    nextSafeAction: summary.nextSafeAction,
  };
}
