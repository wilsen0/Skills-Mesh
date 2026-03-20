import assert from "node:assert/strict";
import test from "node:test";
import run from "../dist/skills/trade-thesis/run.js";
import { createContext } from "./test-helpers.mjs";

test("trade-thesis converts market regime and portfolio risk into a canonical thesis", async () => {
  const sharedState = {
    portfolioSnapshot: {
      source: "okx-cli",
      symbols: ["BTC"],
      drawdownTarget: "4%",
      accountEquity: 80_000,
      availableUsd: 25_000,
      commands: [],
      errors: [],
    },
    portfolioRiskProfile: {
      directionalExposure: {
        longUsd: 32_000,
        shortUsd: 2_000,
        netUsd: 30_000,
        dominantSide: "long",
      },
      concentration: {
        grossUsd: 40_000,
        topSymbol: "BTC",
        topSharePct: 72,
        top3: [{ symbol: "BTC", usd: 28_800, sharePct: 72 }],
      },
      leverageHotspots: [{ instId: "BTC-USDT-SWAP", symbol: "BTC", leverage: 6.5, notionalUsd: 12_000 }],
      feeDrag: { recentFeePaidUsd: 20, recentFeeRows: 4, makerRateBps: 1, takerRateBps: 5 },
      correlationBuckets: [{ bucketId: "crypto-beta", symbols: ["BTC"], grossUsd: 28_800, sharePct: 72 }],
    },
    marketRegime: {
      symbols: ["BTC"],
      directionalRegime: "uptrend",
      volState: "elevated",
      tailRiskState: "elevated",
      fundingState: "longs-paying",
      conviction: 68,
      trendScores: [],
      marketVolatility: 0.061,
      ruleRefs: ["trend-following"],
      doctrineRefs: ["turtle-trend", "vol-hedging"],
    },
  };

  const output = await run(
    createContext({
      skill: "trade-thesis",
      stage: "planner",
      sharedState,
    }),
  );

  assert.equal(output.skill, "trade-thesis");
  assert.equal(output.stage, "planner");
  assert.ok(output.facts.some((fact) => fact.includes("Thesis bias")));
  assert.ok(sharedState.tradeThesis);
  assert.equal(sharedState.tradeThesis.hedgeBias, "protective-put");
  assert.ok(sharedState.tradeThesis.riskBudget.maxSingleOrderUsd > 0);
});
