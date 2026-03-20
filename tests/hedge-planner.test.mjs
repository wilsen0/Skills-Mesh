import assert from "node:assert/strict";
import test from "node:test";
import run from "../dist/skills/hedge-planner/run.js";
import { buildReferencePayloads, createContext } from "./test-helpers.mjs";

test("hedge-planner emits proposal set with structured intents/order plans", async () => {
  const payloads = await buildReferencePayloads();
  const sharedState = {
    portfolioSnapshot: {
      source: "okx-cli",
      symbols: ["BTC"],
      drawdownTarget: "3%",
      positions: payloads.accountPositions,
      accountEquity: 50_000,
      availableUsd: 20_000,
      commands: [],
      errors: [],
    },
    marketSnapshot: {
      tickers: {
        "BTC-USDT": payloads.marketTicker,
      },
    },
    tradeThesis: {
      directionalRegime: "uptrend",
      volState: "elevated",
      tailRiskState: "elevated",
      hedgeBias: "protective-put",
      conviction: 71,
      riskBudget: {
        maxSingleOrderUsd: 5_000,
        maxPremiumSpendUsd: 900,
        maxMarginUseUsd: 4_000,
        maxCorrelationBucketPct: 55,
      },
      disciplineState: "normal",
      preferredStrategies: ["protective-put", "collar", "perp-short"],
      decisionNotes: ["test thesis"],
      ruleRefs: ["trend-following"],
      doctrineRefs: ["turtle-trend", "vol-hedging"],
    },
    portfolioRiskProfile: {
      directionalExposure: {
        longUsd: 20_000,
        shortUsd: 2_000,
        netUsd: 18_000,
        dominantSide: "long",
      },
      concentration: {
        grossUsd: 25_000,
        topSymbol: "BTC",
        topSharePct: 70,
        top3: [{ symbol: "BTC", usd: 17_500, sharePct: 70 }],
      },
      leverageHotspots: [{ instId: "BTC-USDT-SWAP", symbol: "BTC", leverage: 6, notionalUsd: 7_000 }],
      feeDrag: { recentFeePaidUsd: 12, recentFeeRows: 3, makerRateBps: 1, takerRateBps: 5 },
    },
  };

  const output = await run(
    createContext({
      skill: "hedge-planner",
      stage: "planner",
      sharedState,
    }),
  );

  assert.equal(output.skill, "hedge-planner");
  assert.equal(output.stage, "planner");
  assert.equal(output.proposal.length, 4);
  assert.equal(output.proposal[0].strategyId, "protective-put");
  assert.ok(output.proposal[0].riskTags.includes("strategy-source:trade-thesis"));
  assert.ok(output.proposal.every((proposal) => Array.isArray(proposal.intents)));
  assert.ok(output.proposal.every((proposal) => Array.isArray(proposal.orderPlan)));
  assert.ok(Array.isArray(sharedState.proposals));
});
