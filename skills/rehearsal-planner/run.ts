import { putArtifact } from "../../runtime/artifacts.js";
import { artifactReference, currentArtifactVersion } from "../../runtime/artifact-schema.js";
import type {
  GoalIntake,
  ProbeModuleStatus,
  ScenarioMatrix,
  SkillContext,
  SkillOutput,
  SkillProposal,
  TradeThesis,
} from "../../runtime/types.js";
import runTradeThesis from "../trade-thesis/run.js";

type JsonRecord = Record<string, unknown>;
type MarketSnapshotLike = {
  tickers?: Record<string, unknown>;
};

function asObject(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function nextFridayYymmdd(base = new Date()): string {
  const date = new Date(base.getTime());
  const distance = ((5 - date.getUTCDay() + 7) % 7) || 7;
  date.setUTCDate(date.getUTCDate() + distance);
  const year = date.getUTCFullYear().toString().slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function readReferencePrice(snapshot: MarketSnapshotLike | undefined, symbol: string): number {
  const tickers = asObject(snapshot?.tickers);
  const ticker = asObject(tickers?.[`${symbol}-USDT`]);
  const first = Array.isArray(ticker?.data) ? asObject(ticker?.data[0]) : undefined;
  return (
    toNumber(first?.last) ??
    toNumber(first?.lastPx) ??
    toNumber(first?.markPx) ??
    (symbol === "BTC" ? 70_000 : symbol === "ETH" ? 3_500 : 150)
  );
}

function buildScenarioMatrix(): ScenarioMatrix {
  return {
    spot_down_5pct: {
      scenario: "spot_down_5pct",
      estimatedPnlUsd: 25,
      estimatedDrawdownPct: 0.6,
      estimatedMarginUseUsd: 5,
      breachFlags: [],
    },
    spot_down_10pct: {
      scenario: "spot_down_10pct",
      estimatedPnlUsd: 80,
      estimatedDrawdownPct: 1.2,
      estimatedMarginUseUsd: 8,
      breachFlags: [],
    },
    volatility_x2: {
      scenario: "volatility_x2",
      estimatedPnlUsd: 15,
      estimatedDrawdownPct: 0.9,
      estimatedMarginUseUsd: 6,
      breachFlags: [],
    },
    correlation_to_one: {
      scenario: "correlation_to_one",
      estimatedPnlUsd: 0,
      estimatedDrawdownPct: 1.4,
      estimatedMarginUseUsd: 9,
      breachFlags: [],
    },
  };
}

function isReady(modules: ProbeModuleStatus[]): boolean {
  return !modules.some((entry) => entry.status === "blocked");
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  if (context.plane !== "demo") {
    throw new Error("rehearsal-planner only supports demo plane.");
  }

  const thesisManifest = context.manifests.find((entry) => entry.name === "trade-thesis") ?? context.manifest;
  const thesisOutput = await runTradeThesis({
    ...context,
    manifest: thesisManifest,
  });
  const thesis = context.artifacts.require<TradeThesis>("trade.thesis").data;
  const diagnosis = context.artifacts.require<{ modules: ProbeModuleStatus[] }>("diagnostics.readiness").data;
  if (!isReady(diagnosis.modules)) {
    throw new Error("diagnostics.readiness contains blocked modules; rehearsal planning aborted.");
  }

  const goalIntake = context.artifacts.require<GoalIntake>("goal.intake").data;
  const symbol = goalIntake.symbols[0] ?? "BTC";
  const marketSnapshot = context.artifacts.get<MarketSnapshotLike>("market.snapshot")?.data;
  const referencePx = readReferencePrice(marketSnapshot, symbol);
  const strike = Math.round(referencePx * 0.9 / 500) * 500;
  const premiumUsd = Math.min(25, thesis.riskBudget.maxPremiumSpendUsd * 0.05 || 25);
  const proposal: SkillProposal = {
    name: "rehearsal-protective-put",
    strategyId: "protective-put",
    recommended: true,
    reason: "Minimal-risk rehearsal proposal for validating demo write path and receipts.",
    estimatedCost: `${premiumUsd.toFixed(2)} USD premium`,
    estimatedProtection: "small downside hedge for execution rehearsal",
    scoreBreakdown: {
      total: 90,
      protection: 72,
      cost: 88,
      executionRisk: 90,
      policyFit: 94,
      dataConfidence: 86,
    },
    riskTags: ["rehearsal", "minimal-risk", "demo-only"],
    requiredModules: ["account", "market", "option"],
    evidence: {
      artifactRefs: [
        artifactReference(context.artifacts.get("goal.intake"), "goal.intake", "portfolio-xray"),
        artifactReference(context.artifacts.get("portfolio.snapshot"), "portfolio.snapshot", "portfolio-xray"),
        artifactReference(context.artifacts.get("diagnostics.readiness"), "diagnostics.readiness", "diagnosis-synthesizer"),
        artifactReference(context.artifacts.get("trade.thesis"), "trade.thesis", "trade-thesis"),
      ],
      ruleRefs: thesis.ruleRefs,
      doctrineRefs: thesis.doctrineRefs,
    },
    riskBudgetUse: {
      premiumSpendUsd: premiumUsd,
      marginUseUsd: 0,
      orderNotionalUsd: Math.max(200, premiumUsd * 8),
      correlationBucketPct: 5,
    },
    orderPlan: [
      {
        kind: "option-place-order",
        purpose: "Execute one minimal demo protective put for controlled write-path rehearsal.",
        symbol,
        targetPremiumUsd: premiumUsd,
        referencePx,
        params: {
          instId: `${symbol}-USD-${nextFridayYymmdd()}-${Math.max(1_000, strike)}-P`,
          side: "buy",
          sz: "1",
          px: Math.max(0.01, premiumUsd / referencePx).toFixed(4),
        },
        strategy: "protective-put",
        leg: "protective-put",
        riskTags: ["rehearsal"],
      },
    ],
    actionable: true,
    executionReadiness: "ready_for_dry_run",
  };
  const proposals: SkillProposal[] = [proposal];
  const scenarioMatrix = buildScenarioMatrix();

  putArtifact(context.artifacts, {
    key: "planning.proposals",
    version: currentArtifactVersion("planning.proposals"),
    producer: context.manifest.name,
    data: proposals,
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
  });
  putArtifact(context.artifacts, {
    key: "planning.scenario-matrix",
    version: currentArtifactVersion("planning.scenario-matrix"),
    producer: context.manifest.name,
    data: scenarioMatrix,
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
  });
  putArtifact(context.artifacts, {
    key: "operations.rehearsal-plan",
    version: currentArtifactVersion("operations.rehearsal-plan"),
    producer: context.manifest.name,
    data: {
      proposal: proposal.name,
      symbol,
      plane: context.plane,
      executePreference: goalIntake.executePreference,
      intents: proposal.orderPlan,
      diagnosisSummary: diagnosis.modules.map((entry) => `${entry.module}:${entry.status}`),
    },
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
  });

  return {
    skill: context.manifest.name,
    stage: context.manifest.stage,
    goal: context.goal,
    summary: "Build a deterministic, minimal-risk rehearsal proposal set for demo execution checks.",
    facts: [
      `Rehearsal symbol: ${symbol}.`,
      `Premium budget: ${premiumUsd.toFixed(2)} USD.`,
      ...thesisOutput.facts.slice(0, 2),
    ],
    constraints: {
      selectedProposal: proposal.name,
      diagnosisReady: true,
      proposalCount: proposals.length,
    },
    proposal: proposals,
    risk: {
      score: 0.28,
      maxLoss: "Bounded to rehearsal premium budget.",
      needsApproval: true,
      reasons: ["Rehearsal still routes through policy + official executor."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["account", "market", "option"],
    },
    handoff: "policy-gate",
    producedArtifacts: ["trade.thesis", "planning.proposals", "planning.scenario-matrix", "operations.rehearsal-plan"],
    consumedArtifacts: ["goal.intake", "portfolio.snapshot", "diagnostics.readiness", "market.regime"],
    ruleRefs: thesis.ruleRefs,
    doctrineRefs: thesis.doctrineRefs,
    timestamp: new Date().toISOString(),
  };
}
