import { formatDrawdownPct } from "./goal-intake.js";
import type {
  BusinessBrief,
  ExecutionPlane,
  ExecutionRecord,
  GoalIntake,
  OperatorSummaryV3,
  PolicyDecision,
} from "./types.js";

interface BusinessBriefInput {
  goal: string;
  plane: ExecutionPlane;
  goalIntake?: GoalIntake | null;
  operatorSummary: OperatorSummaryV3;
  selectedProposal?: string | null;
  policyDecision?: PolicyDecision | null;
  latestExecution?: ExecutionRecord | null;
}

function renderGoalSummary(goal: string, plane: ExecutionPlane, intake?: GoalIntake | null): string {
  if (!intake) {
    return `${goal} | plane=${plane}`;
  }

  const parts = [
    `symbols=${intake.symbols.join(", ") || "n/a"}`,
    `drawdown=${formatDrawdownPct(intake.targetDrawdownPct)}`,
    `intent=${intake.hedgeIntent}`,
    `horizon=${intake.timeHorizon}`,
    `plane=${plane}`,
  ];
  return `${intake.normalizedGoal} | ${parts.join(" | ")}`;
}

function renderRecommendedAction(
  selectedProposal: string | null | undefined,
  operatorSummary: OperatorSummaryV3,
  latestExecution?: ExecutionRecord | null,
): string {
  if (operatorSummary.blockers.length > 0) {
    return "Clear the current blocker before taking the next trading action.";
  }
  if (latestExecution?.mode === "execute" && latestExecution.status === "executed") {
    return "Review the verified receipt and export the evidence bundle.";
  }
  if (selectedProposal) {
    return operatorSummary.isExecutable
      ? `Proceed with ${selectedProposal}.`
      : `Review ${selectedProposal} and prepare the next supervised step.`;
  }
  return operatorSummary.isExecutable
    ? "Proceed with the current plan."
    : "Review the current plan before proceeding.";
}

function renderRiskBudgetSummary(
  plane: ExecutionPlane,
  intake?: GoalIntake | null,
  policyDecision?: PolicyDecision | null,
): string {
  const budget = policyDecision?.budgetSnapshot;
  const parts = [
    `plane=${plane}`,
    `drawdown=${formatDrawdownPct(intake?.targetDrawdownPct ?? null)}`,
  ];
  if (budget) {
    parts.push(`maxSingleUsd=${budget.maxSingleOrderUsd}`);
    parts.push(`maxTotalUsd=${budget.maxTotalOrderUsd}`);
    parts.push(`maxExposureUsd=${budget.maxTotalExposureUsd}`);
  }
  return parts.join(" | ");
}

export function buildBusinessBrief(input: BusinessBriefInput): BusinessBrief {
  return {
    goalSummary: renderGoalSummary(input.goal, input.plane, input.goalIntake),
    recommendedAction: renderRecommendedAction(input.selectedProposal, input.operatorSummary, input.latestExecution),
    canActNow: input.operatorSummary.isExecutable,
    currentBlocker: input.operatorSummary.blockers[0] ?? "none",
    riskBudgetSummary: renderRiskBudgetSummary(input.plane, input.goalIntake, input.policyDecision),
    nextSafeAction: input.operatorSummary.nextSafeAction,
  };
}
