import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { applyRun, createPlan } from "../dist/runtime/executor.js";
import { idempotencyLedgerFilePaths, loadIdempotencyLedger } from "../dist/runtime/idempotency.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

const LEDGER_PATHS = idempotencyLedgerFilePaths();

async function cleanupLedger() {
  await rm(LEDGER_PATHS.snapshotPath, { force: true });
  await rm(LEDGER_PATHS.journalPath, { force: true });
  await rm(LEDGER_PATHS.lockPath, { force: true });
}

test("apply execute with verify-receipt writes receipt verification and updates reconciliation state", { concurrency: false }, async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;

  payloads.tradeOrdersHistory = {
    code: "0",
    data: [{ ordId: "ord-verified", side: "buy", cTime: Date.now().toString() }],
  };
  payloads.accountPositions = {
    code: "0",
    data: [
      { instId: "BTC-USDT-SWAP", pos: "0.01", markPx: "70000", lever: "3", posSide: "long" },
      { instId: "ETH-USDT-SWAP", pos: "0.2", markPx: "3500", lever: "3", posSide: "long" },
      { instId: "SOL-USDT-SWAP", pos: "5", markPx: "140", lever: "3", posSide: "long" },
      { instId: "XRP-USDT-SWAP", pos: "1400", markPx: "0.5", lever: "3", posSide: "long" },
    ],
  };
  await cleanupLedger();
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";

  try {
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

      const ledger = await loadIdempotencyLedger();
      assert.ok(Object.values(ledger.entries).some((entry) => entry.status === "executed"));
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
    await cleanupRunArtifacts(runId);
    await cleanupLedger();
  }
});

test("apply execute with verify-receipt keeps write intents pending until readback settles", { concurrency: false }, async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
  payloads.accountPositions = {
    code: "0",
    data: [
      { instId: "BTC-USDT-SWAP", pos: "0.01", markPx: "70000", lever: "3", posSide: "long" },
      { instId: "ETH-USDT-SWAP", pos: "0.2", markPx: "3500", lever: "3", posSide: "long" },
      { instId: "SOL-USDT-SWAP", pos: "5", markPx: "140", lever: "3", posSide: "long" },
      { instId: "XRP-USDT-SWAP", pos: "1400", markPx: "0.5", lever: "3", posSide: "long" },
    ],
  };
  await cleanupLedger();
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";

  try {
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
      assert.equal(latestExecution.reconciliationState, "pending");

      const artifacts = await loadArtifactSnapshot(planned.id);
      const verification = artifacts["operations.receipt-verification"]?.data;
      assert.ok(verification);
      assert.equal(verification.status, "pending");

      const ledger = await loadIdempotencyLedger();
      const entries = Object.values(ledger.entries);
      assert.ok(entries.length >= 1);
      assert.ok(entries.every((entry) => entry.status === "pending"));
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
    await cleanupRunArtifacts(runId);
    await cleanupLedger();
  }
});
