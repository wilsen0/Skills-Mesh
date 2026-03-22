import assert from "node:assert/strict";
import test from "node:test";
import run from "../dist/skills/receipt-verifier/run.js";
import { putArtifact } from "../dist/runtime/artifacts.js";
import { createContext, buildReferencePayloads, withMockOkx } from "./test-helpers.mjs";

function buildExecution({ intent, startedAt }) {
  return {
    executionId: "run_test:exec:1",
    requestedAt: startedAt,
    mode: "execute",
    plane: "demo",
    proposal: "protective-put",
    approvalProvided: true,
    status: "executed",
    results: [{
      intent,
      ok: true,
      exitCode: 0,
      stdout: "{\"code\":\"0\",\"data\":[]}",
      stderr: "",
      skipped: false,
      dryRun: false,
      startedAt,
      finishedAt: startedAt,
      durationMs: 20,
    }],
  };
}

function createReceiptVerifierContext(intent, execution) {
  const context = createContext({
    skill: "receipt-verifier",
    stage: "executor",
    runtimeInput: {
      latestExecution: execution,
      execution,
    },
  });
  context.manifest = {
    ...context.manifest,
    name: "receipt-verifier",
    role: "guardrail",
    produces: ["operations.receipt-verification"],
    consumes: ["execution.intent-bundle"],
  };
  putArtifact(context.artifacts, {
    key: "execution.intent-bundle",
    version: 3,
    producer: "test",
    data: {
      proposal: "protective-put",
      orderPlan: [],
      intents: [intent],
    },
  });
  return context;
}

test("receipt-verifier marks a unique history match as verified", async () => {
  const payloads = await buildReferencePayloads();
  const startedAt = new Date().toISOString();
  const intent = {
    intentId: "run_test:protective-put:1",
    stepIndex: 1,
    safeToRetry: false,
    clientOrderRef: "clord-test",
    command: `okx option place-order --instId ${payloads.optionInstId} --side buy --sz 1 --px 0.05`,
    args: ["option", "place-order", "--instId", payloads.optionInstId, "--side", "buy", "--sz", "1", "--px", "0.05"],
    module: "option",
    requiresWrite: true,
    reason: "test",
  };
  const execution = buildExecution({ intent, startedAt });
  const context = createReceiptVerifierContext(intent, execution);
  payloads.tradeOrdersHistoryByInstId[payloads.optionInstId] = {
    code: "0",
    data: [{ ordId: "ord-1", side: "buy", sz: "1", cTime: Date.now().toString() }],
  };

  await withMockOkx(payloads, async () => {
    const output = await run(context);
    const verification = context.artifacts.get("operations.receipt-verification")?.data;
    assert.equal(output.skill, "receipt-verifier");
    assert.equal(verification.status, "verified");
    assert.equal(verification.matchedBy, "fallback_window");
  });
});

test("receipt-verifier marks multiple candidates as ambiguous", async () => {
  const payloads = await buildReferencePayloads();
  const startedAt = new Date().toISOString();
  const intent = {
    intentId: "run_test:protective-put:1",
    stepIndex: 1,
    safeToRetry: false,
    clientOrderRef: "clord-test",
    command: `okx option place-order --instId ${payloads.optionInstId} --side buy --sz 1 --px 0.05`,
    args: ["option", "place-order", "--instId", payloads.optionInstId, "--side", "buy", "--sz", "1", "--px", "0.05"],
    module: "option",
    requiresWrite: true,
    reason: "test",
  };
  const execution = buildExecution({ intent, startedAt });
  const context = createReceiptVerifierContext(intent, execution);
  payloads.tradeOrdersHistoryByInstId[payloads.optionInstId] = {
    code: "0",
    data: [
      { ordId: "ord-1", side: "buy", sz: "1", cTime: Date.now().toString() },
      { ordId: "ord-2", side: "buy", sz: "1", cTime: Date.now().toString() },
    ],
  };

  await withMockOkx(payloads, async () => {
    await run(context);
    const verification = context.artifacts.get("operations.receipt-verification")?.data;
    assert.equal(verification.status, "ambiguous");
    assert.ok(verification.nextAction.includes("reconcile"));
  });
});

test("receipt-verifier marks query failures as failed", async () => {
  const payloads = await buildReferencePayloads();
  payloads.tradeOrdersHistoryCommandFailure = true;
  const startedAt = new Date().toISOString();
  const intent = {
    intentId: "run_test:protective-put:1",
    stepIndex: 1,
    safeToRetry: false,
    clientOrderRef: "clord-test",
    command: `okx option place-order --instId ${payloads.optionInstId} --side buy --sz 1 --px 0.05`,
    args: ["option", "place-order", "--instId", payloads.optionInstId, "--side", "buy", "--sz", "1", "--px", "0.05"],
    module: "option",
    requiresWrite: true,
    reason: "test",
  };
  const execution = buildExecution({ intent, startedAt });
  const context = createReceiptVerifierContext(intent, execution);

  await withMockOkx(payloads, async () => {
    await run(context);
    const verification = context.artifacts.get("operations.receipt-verification")?.data;
    assert.equal(verification.status, "failed");
  });
});

test("receipt-verifier marks executions without writes as not_applicable", async () => {
  const startedAt = new Date().toISOString();
  const intent = {
    intentId: "run_test:read:1",
    stepIndex: 1,
    safeToRetry: true,
    command: "okx market ticker --instId BTC-USDT",
    args: ["market", "ticker", "--instId", "BTC-USDT"],
    module: "market",
    requiresWrite: false,
    reason: "test",
  };
  const execution = buildExecution({ intent, startedAt });
  const context = createReceiptVerifierContext(intent, execution);

  const output = await run(context);
  const verification = context.artifacts.get("operations.receipt-verification")?.data;
  assert.equal(output.skill, "receipt-verifier");
  assert.equal(verification.status, "not_applicable");
});
