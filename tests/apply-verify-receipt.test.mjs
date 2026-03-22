import assert from "node:assert/strict";
import test from "node:test";
import { applyRun, createPlan } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("apply execute with verify-receipt writes receipt verification and updates reconciliation state", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  payloads.tradeOrdersHistory = {
    code: "0",
    data: [{ ordId: "ord-verified", side: "buy", cTime: Date.now().toString() }],
  };

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo execute", { plane: "demo" });
    runId = planned.id;

    const applied = await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      approvedBy: "alice",
      execute: true,
      verifyReceipt: true,
    });

    const latestExecution = applied.executions.at(-1);
    assert.ok(latestExecution);
    assert.equal(latestExecution.reconciliationState, "matched");

    const artifacts = await loadArtifactSnapshot(planned.id);
    const verification = artifacts["operations.receipt-verification"]?.data;
    assert.ok(verification);
    assert.equal(verification.status, "verified");
  });

  await cleanupRunArtifacts(runId);
});
