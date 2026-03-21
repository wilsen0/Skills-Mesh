import { putArtifact } from "../../runtime/artifacts.js";
import type {
  PortfolioRiskProfile,
  ScenarioMatrix,
  ScenarioResult,
  SkillContext,
  SkillOutput,
  SkillProposal,
  TradeThesis,
} from "../../runtime/types.js";

function scenarioResult(
  scenario: keyof ScenarioMatrix,
  estimatedPnlUsd: number,
  estimatedDrawdownPct: number,
  estimatedMarginUseUsd: number,
  breachFlags: string[],
): ScenarioResult {
  return {
    scenario,
    estimatedPnlUsd,
    estimatedDrawdownPct,
    estimatedMarginUseUsd,
    breachFlags,
  };
}

function buildScenarioMatrix(proposal: SkillProposal, thesis: TradeThesis, profile: PortfolioRiskProfile): ScenarioMatrix {
  const orderNotionalUsd = proposal.riskBudgetUse?.orderNotionalUsd ?? 0;
  const premiumSpendUsd = proposal.riskBudgetUse?.premiumSpendUsd ?? 0;
  const marginUseUsd = proposal.riskBudgetUse?.marginUseUsd ?? orderNotionalUsd * 0.12;
  const topSharePct = proposal.riskBudgetUse?.correlationBucketPct ?? profile.concentration.topSharePct;
  const strategy = proposal.strategyId ?? proposal.name;
  const convex = strategy === "protective-put" ? 1.3 : strategy === "collar" ? 1.05 : strategy === "de-risk" ? 0.9 : 0.75;
  const downsideBase = orderNotionalUsd > 0 ? orderNotionalUsd : Math.max(profile.directionalExposure.netUsd, 0);
  const breach = (drawdownPct: number, margin: number, corrPct: number): string[] => {
    const flags: string[] = [];
    if (margin > thesis.riskBudget.maxMarginUseUsd) {
      flags.push("margin-budget");
    }
    if (corrPct > thesis.riskBudget.maxCorrelationBucketPct) {
      flags.push("correlation-bucket");
    }
    if (drawdownPct > 12) {
      flags.push("drawdown-tail");
    }
    return flags;
  };

  return {
    spot_down_5pct: scenarioResult(
      "spot_down_5pct",
      strategy === "perp-short" ? downsideBase * 0.035 : premiumSpendUsd * 0.2,
      Math.max(0, 5.5 - convex * 2.5),
      marginUseUsd,
      breach(Math.max(0, 5.5 - convex * 2.5), marginUseUsd, topSharePct),
    ),
    spot_down_10pct: scenarioResult(
      "spot_down_10pct",
      strategy === "perp-short" ? downsideBase * 0.07 : premiumSpendUsd * 0.55,
      Math.max(0, 10.5 - convex * 4),
      marginUseUsd * 1.1,
      breach(Math.max(0, 10.5 - convex * 4), marginUseUsd * 1.1, topSharePct),
    ),
    volatility_x2: scenarioResult(
      "volatility_x2",
      strategy === "protective-put" || strategy === "collar" ? premiumSpendUsd * 0.35 : -downsideBase * 0.015,
      strategy === "protective-put" ? 3.2 : strategy === "collar" ? 4.1 : 6.8,
      strategy === "perp-short" ? marginUseUsd * 1.3 : marginUseUsd,
      breach(
        strategy === "protective-put" ? 3.2 : strategy === "collar" ? 4.1 : 6.8,
        strategy === "perp-short" ? marginUseUsd * 1.3 : marginUseUsd,
        topSharePct,
      ),
    ),
    correlation_to_one: scenarioResult(
      "correlation_to_one",
      strategy === "de-risk" ? downsideBase * 0.03 : downsideBase * 0.01,
      strategy === "de-risk" ? 4.5 : strategy === "protective-put" ? 6.4 : 7.8,
      marginUseUsd * 1.15,
      breach(
        strategy === "de-risk" ? 4.5 : strategy === "protective-put" ? 6.4 : 7.8,
        marginUseUsd * 1.15,
        Math.max(topSharePct, profile.concentration.topSharePct + 15),
      ),
    ),
  };
}

function rankScore(proposal: SkillProposal): number {
  const matrix = proposal.scenarioMatrix;
  if (!matrix) {
    return Number.NEGATIVE_INFINITY;
  }

  const scenarioScores = Object.values(matrix).map((item) => {
    return 100 - item.estimatedDrawdownPct * 4 - item.estimatedMarginUseUsd / 1_000 - item.breachFlags.length * 15;
  });
  return scenarioScores.reduce((sum, value) => sum + value, 0);
}

function annotateRanking(proposals: SkillProposal[]): SkillProposal[] {
  const top = proposals[0];
  return proposals.map((proposal, index) => {
    const scenarioRank = rankScore(proposal);
    const scenarioQuality = Math.max(0, Math.min(100, Math.round(scenarioRank / 4)));
    const base = proposal.scoreBreakdown ?? {
      total: 50,
      protection: 50,
      cost: 50,
      executionRisk: 50,
      policyFit: 50,
        dataConfidence: 50,
    };
    const total = Math.max(0, Math.min(100, Math.round(base.total * 0.65 + scenarioQuality * 0.35)));

    return {
      ...proposal,
      recommended: index === 0,
      scoreBreakdown: {
        ...base,
        total,
      },
      rejectionReason:
        index === 0
          ? undefined
          : `Stress ranking placed ${proposal.name} behind ${top?.name ?? "the top proposal"} after scenario scoring.`,
    };
  });
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const proposals = [...context.artifacts.require<SkillProposal[]>("planning.proposals").data];
  const thesis = context.artifacts.require<TradeThesis>("trade.thesis").data;
  const profile = context.artifacts.require<PortfolioRiskProfile>("portfolio.risk-profile").data;

  const scenarioArtifact: Record<string, ScenarioMatrix> = {};
  const enriched = proposals.map((proposal) => {
    const scenarioMatrix = buildScenarioMatrix(proposal, thesis, profile);
    scenarioArtifact[proposal.name] = scenarioMatrix;
    return {
      ...proposal,
      scenarioMatrix,
    };
  });

  enriched.sort((left, right) => rankScore(right) - rankScore(left));
  const ranked = annotateRanking(enriched);

  putArtifact(context.artifacts, {
    key: "planning.proposals",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: ranked,
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
  });
  putArtifact(context.artifacts, {
    key: "planning.scenario-matrix",
    version: context.manifest.artifactVersion,
    producer: context.manifest.name,
    data: scenarioArtifact,
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
  });

  return {
    skill: "scenario-sim",
    stage: "planner",
    goal: context.goal,
    summary: "Stress every hedge proposal against the fixed scenario matrix before policy approval.",
    facts: [
      `Scenario matrix populated for ${ranked.length} proposal(s).`,
      `Top proposal after stress ranking: ${ranked[0]?.name ?? "n/a"}.`,
    ],
    constraints: {
      scenarioCount: 4,
      rankedByScenario: ranked.map((proposal) => proposal.name),
      requiredModules: [...new Set(ranked.flatMap((proposal) => proposal.requiredModules ?? []))],
    },
    proposal: ranked,
    risk: {
      score: 0.22,
      maxLoss: "Stress outcomes are bounded by the scenario matrix, not live marks.",
      needsApproval: false,
      reasons: ["Scenario simulation is read-only.", "Policy gate consumes the resulting breach flags."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["account", "market"],
    },
    handoff: "policy-gate",
    handoffReason: "Scenario results are attached to proposals and ready for policy evaluation.",
    producedArtifacts: ["planning.proposals", "planning.scenario-matrix"],
    consumedArtifacts: ["planning.proposals", "trade.thesis", "portfolio.risk-profile"],
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
    metadata: {
      scenarioArtifact,
    },
    timestamp: new Date().toISOString(),
  };
}
