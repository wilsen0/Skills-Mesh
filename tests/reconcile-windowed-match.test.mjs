import assert from "node:assert/strict";
import test from "node:test";
import { applyRun, createPlan, reconcileRun } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("reconcile fallback matching uses startedAt window constraints", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = {
    code: "0",
    data: [
      { instId: "BTC-USDT-SWAP", pos: "0.01", markPx: "70000", lever: "3", posSide: "long" },
      { instId: "ETH-USDT-SWAP", pos: "0.2", markPx: "3500", lever: "3", posSide: "long" },
      { instId: "SOL-USDT-SWAP", pos: "5", markPx: "140", lever: "3", posSide: "long" },
      { instId: "XRP-USDT-SWAP", pos: "1400", markPx: "0.5", lever: "3", posSide: "long" },
    ],
  };
  payloads.tradeOrdersHistory = {
    code: "0",
    data: [{ ordId: "window_match_order", side: "buy", sz: "1", cTime: String(Date.now() - 2 * 60 * 1_000) }],
  };

  let runId = null;
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";
  try {
    await withMockOkx(payloads, async () => {
      const planned = await createPlan("hedge my BTC drawdown with demo execute", { plane: "demo" });
      runId = planned.id;

      const executed = await applyRun(planned.id, {
        plane: "demo",
        approve: true,
        approvedBy: "alice",
        execute: true,
      });
      assert.equal(executed.status, "executed");

      const narrow = await reconcileRun(planned.id, {
        source: "fallback",
        windowMin: 1,
      });
      assert.ok(["failed", "ambiguous"].includes(narrow.executions.at(-1)?.reconciliationState ?? "failed"));

      const wide = await reconcileRun(planned.id, {
        source: "fallback",
        windowMin: 5,
      });
      assert.equal(wide.executions.at(-1)?.reconciliationState, "matched");

      const artifacts = await loadArtifactSnapshot(planned.id);
      assert.equal(artifacts["execution.reconciliation"]?.data?.status, "matched");
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
  }

  await cleanupRunArtifacts(runId);
});
