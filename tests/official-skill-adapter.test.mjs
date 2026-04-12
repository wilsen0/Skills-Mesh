import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActionsFromIntents,
  buildOptionPlaceOrderCommand,
  buildPlaneFlagArgs,
  buildReadIntents,
  buildSwapPlaceOrderCommand,
  createClientOrderRef,
  extractPayloadFromCommand,
  formatPrice,
  previewEntry,
  resolveContractAddress,
  resolveWalletFromArtifacts,
  toNumber,
  writeIntentForStep,
} from "../dist/runtime/official-skill-adapter.js";

// ── formatPrice ──────────────────────────────────────────────────────────────

test("formatPrice formats large prices to 1 decimal", () => {
  assert.equal(formatPrice(70_000), "70000.0");
  assert.equal(formatPrice(10_500), "10500.0");
});

test("formatPrice formats mid-range prices to 2 decimals", () => {
  assert.equal(formatPrice(1_500), "1500.00");
});

test("formatPrice formats small prices to 3 or 4 decimals", () => {
  assert.equal(formatPrice(50), "50.000");
  assert.equal(formatPrice(0.5), "0.5000");
});

// ── toNumber ─────────────────────────────────────────────────────────────────

test("toNumber returns number for finite input", () => {
  assert.equal(toNumber(42), 42);
  assert.equal(toNumber("1,200.5"), 1200.5);
});

test("toNumber returns undefined for non-finite input", () => {
  assert.equal(toNumber("abc"), undefined);
  assert.equal(toNumber(NaN), undefined);
  assert.equal(toNumber(null), undefined);
});

// ── buildPlaneFlagArgs ───────────────────────────────────────────────────────

test("buildPlaneFlagArgs returns demo flags", () => {
  const args = buildPlaneFlagArgs("demo");
  assert.deepStrictEqual(args, ["--profile", "demo", "--json"]);
});

test("buildPlaneFlagArgs returns live flags", () => {
  const args = buildPlaneFlagArgs("live");
  assert.deepStrictEqual(args, ["--profile", "live", "--json"]);
});

test("buildPlaneFlagArgs returns json-only for research", () => {
  const args = buildPlaneFlagArgs("research");
  assert.deepStrictEqual(args, ["--json"]);
});

// ── buildSwapPlaceOrderCommand ───────────────────────────────────────────────

test("buildSwapPlaceOrderCommand produces a swap order command", () => {
  const cmd = buildSwapPlaceOrderCommand({
    instId: "BTC-USDT-SWAP",
    tdMode: "cross",
    side: "sell",
    ordType: "limit",
    sz: "0.03",
    px: "69950",
    reduceOnly: false,
  }, "demo");

  assert.ok(cmd.startsWith("okx swap place-order"));
  assert.ok(cmd.includes("--instId BTC-USDT-SWAP"));
  assert.ok(cmd.includes("--side sell"));
  assert.ok(cmd.includes("--sz 0.03"));
  assert.ok(cmd.includes("--profile demo"));
  assert.ok(cmd.includes("--clOrdId") === false);
});

test("buildSwapPlaceOrderCommand includes clOrdId when provided", () => {
  const cmd = buildSwapPlaceOrderCommand({
    instId: "BTC-USDT-SWAP",
    tdMode: "cross",
    side: "sell",
    ordType: "limit",
    sz: "0.03",
    px: "69950",
    clOrdId: "tm_abc123",
  }, "demo");

  assert.ok(cmd.includes("--clOrdId tm_abc123"));
});

// ── buildOptionPlaceOrderCommand ─────────────────────────────────────────────

test("buildOptionPlaceOrderCommand produces an option order command", () => {
  const cmd = buildOptionPlaceOrderCommand({
    instId: "BTC-USD-260327-90000-P",
    side: "buy",
    sz: "1",
    px: "0.05",
  }, "demo");

  assert.ok(cmd.startsWith("okx option place-order"));
  assert.ok(cmd.includes("--side buy"));
  assert.ok(cmd.includes("--sz 1"));
  assert.ok(cmd.includes("--profile demo"));
});

// ── buildReadIntents ─────────────────────────────────────────────────────────

test("buildReadIntents produces balance + positions + ticker intents", () => {
  const intents = buildReadIntents(["BTC", "ETH"], "demo", "run_1", "test-proposal");

  assert.equal(intents.length, 4); // balance + positions + BTC ticker + ETH ticker
  assert.ok(intents[0].command.includes("account balance"));
  assert.ok(intents[1].command.includes("account positions"));
  assert.ok(intents[2].command.includes("market ticker BTC-USDT"));
  assert.ok(intents[3].command.includes("market ticker ETH-USDT"));
  assert.equal(intents[0].module, "account");
  assert.equal(intents[2].module, "market");
});

// ── createClientOrderRef ─────────────────────────────────────────────────────

test("createClientOrderRef produces deterministic refs", () => {
  const ref1 = createClientOrderRef("run_1", "proposal", 0);
  const ref2 = createClientOrderRef("run_1", "proposal", 0);
  const ref3 = createClientOrderRef("run_1", "proposal", 1);

  assert.ok(ref1.startsWith("tm"));
  assert.equal(ref1, ref2);
  assert.notEqual(ref1, ref3);
});

// ── resolveWalletFromArtifacts ───────────────────────────────────────────────

test("resolveWalletFromArtifacts returns wallet when present", () => {
  const result = resolveWalletFromArtifacts({
    walletAddress: "0xabc",
    chain: "xlayer",
    source: "env",
    resolvedAt: "2026-04-12T00:00:00.000Z",
  });
  assert.equal(result.walletAddress, "0xabc");
  assert.equal(result.chain, "xlayer");
});

test("resolveWalletFromArtifacts defaults chain to xlayer when absent", () => {
  const result = resolveWalletFromArtifacts(undefined);
  assert.equal(result.walletAddress, undefined);
  assert.equal(result.chain, "xlayer");
});

// ── buildActionsFromIntents ──────────────────────────────────────────────────

test("buildActionsFromIntents maps intents to actions with wallet metadata", () => {
  const intents = buildReadIntents(["BTC"], "demo", "run_1", "test");
  const actions = buildActionsFromIntents(intents, "0xdead", "xlayer");

  assert.equal(actions.length, intents.length);
  assert.equal(actions[0].wallet, "0xdead");
  assert.equal(actions[0].chain, "xlayer");
  assert.equal(actions[0].integration, "official-skill");
});

// ── previewEntry ─────────────────────────────────────────────────────────────

test("previewEntry maps intent to preview entry", () => {
  const intents = buildReadIntents(["BTC"], "demo", "run_1", "test");
  const entry = previewEntry(intents[0]);

  assert.equal(entry.intentId, intents[0].intentId);
  assert.equal(entry.command, intents[0].command);
  assert.equal(entry.safeToRetry, true);
});

// ── writeIntentForStep ───────────────────────────────────────────────────────

test("writeIntentForStep creates swap write intent with clOrdId", () => {
  const intent = writeIntentForStep({
    kind: "swap-place-order",
    purpose: "Open short.",
    symbol: "BTC",
    targetNotionalUsd: 2000,
    referencePx: 70_000,
    params: {
      instId: "BTC-USDT-SWAP",
      tdMode: "cross",
      side: "sell",
      ordType: "limit",
      sz: "0.03",
      px: "69950",
    },
  }, "demo", "run_1", "test", 0);

  assert.ok(intent.command.startsWith("okx swap place-order"));
  assert.ok(intent.command.includes("--clOrdId"));
  assert.equal(intent.requiresWrite, true);
  assert.equal(intent.safeToRetry, false);
  assert.ok(typeof intent.clientOrderRef === "string");
});

test("writeIntentForStep creates option write intent", () => {
  const intent = writeIntentForStep({
    kind: "option-place-order",
    purpose: "Buy put.",
    symbol: "BTC",
    targetPremiumUsd: 220,
    referencePx: 70_000,
    params: {
      instId: "BTC-USD-260327-90000-P",
      side: "buy",
      sz: "1",
      px: "0.05",
    },
  }, "demo", "run_1", "test", 1);

  assert.ok(intent.command.startsWith("okx option place-order"));
  assert.equal(intent.module, "option");
  assert.equal(intent.requiresWrite, true);
});

// ── extractPayloadFromCommand ────────────────────────────────────────────────

test("extractPayloadFromCommand parses swap order flags", () => {
  const payload = extractPayloadFromCommand(
    "okx swap place-order --instId BTC-USDT-SWAP --tdMode cross --side sell --ordType limit --sz 0.03 --px 69950",
    "swap",
  );
  assert.equal(payload.instId, "BTC-USDT-SWAP");
  assert.equal(payload.tdMode, "cross");
  assert.equal(payload.side, "sell");
  assert.equal(payload.ordType, "limit");
  assert.equal(payload.sz, "0.03");
  assert.equal(payload.px, "69950");
});

test("extractPayloadFromCommand parses option order flags", () => {
  const payload = extractPayloadFromCommand(
    "okx option place-order --instId BTC-USD-260327-90000-P --side buy --sz 1 --px 0.05",
    "option",
  );
  assert.equal(payload.instId, "BTC-USD-260327-90000-P");
  assert.equal(payload.side, "buy");
  assert.equal(payload.sz, "1");
  assert.equal(payload.px, "0.05");
});

test("extractPayloadFromCommand extracts market ticker symbol from positional", () => {
  const payload = extractPayloadFromCommand(
    "okx market ticker BTC-USDT --profile demo --json",
    "market",
  );
  assert.equal(payload.symbol, "BTC-USDT");
  assert.equal(payload.profile, "demo");
});

test("extractPayloadFromCommand extracts account operation from positional", () => {
  const payload = extractPayloadFromCommand(
    "okx account balance --profile demo --json",
    "account",
  );
  assert.equal(payload.operation, "balance");
  assert.equal(payload.profile, "demo");
});

test("extractPayloadFromCommand returns empty object for empty command", () => {
  const payload = extractPayloadFromCommand("", "unknown");
  assert.deepStrictEqual(payload, {});
});

test("extractPayloadFromCommand handles flags at end of line gracefully", () => {
  const payload = extractPayloadFromCommand(
    "okx swap place-order --instId BTC-USDT-SWAP --json",
    "swap",
  );
  assert.equal(payload.instId, "BTC-USDT-SWAP");
  // --json has no value after it, so it should not be parsed as a key-value
});

// ── resolveContractAddress ───────────────────────────────────────────────────

test("resolveContractAddress returns placeholder when env is not set", () => {
  const result = resolveContractAddress("xlayer", "swap-place-order");
  assert.equal(result.chain, "xlayer");
  assert.equal(result.method, "swap-place-order");
  assert.equal(result.configured, false);
  assert.equal(result.address, undefined);
  assert.ok(result.source.includes("SKILLS_MESH_CONTRACT_XLAYER_SWAP_PLACE_ORDER"));
  assert.ok(result.source.includes("not set"));
});

test("resolveContractAddress returns configured address from env", () => {
  const envKey = "SKILLS_MESH_CONTRACT_XLAYER_SWAP_PLACE_ORDER";
  const original = process.env[envKey];
  process.env[envKey] = "0x1234567890abcdef1234567890abcdef12345678";

  try {
    const result = resolveContractAddress("xlayer", "swap-place-order");
    assert.equal(result.configured, true);
    assert.equal(result.address, "0x1234567890abcdef1234567890abcdef12345678");
    assert.equal(result.source, `env:${envKey}`);
  } finally {
    if (original === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = original;
    }
  }
});

// ── buildActionsFromIntents with payload/contractAddress ─────────────────────

test("buildActionsFromIntents populates officialSkill.payload from command", () => {
  const intents = buildReadIntents(["BTC"], "demo", "run_1", "test");
  const actions = buildActionsFromIntents(intents, "0xdead", "xlayer");

  // Market ticker action should have a symbol in payload
  const tickerAction = actions.find((a) => a.module === "market");
  assert.ok(tickerAction);
  assert.ok(tickerAction.officialSkill);
  assert.ok(tickerAction.officialSkill.payload);
  assert.equal(tickerAction.officialSkill.payload.symbol, "BTC-USDT");
});

test("buildActionsFromIntents sets contractSource when no address configured", () => {
  const intents = buildReadIntents(["BTC"], "demo", "run_1", "test");
  const actions = buildActionsFromIntents(intents, "0xdead", "xlayer");

  const action = actions[0];
  assert.ok(action.officialSkill);
  assert.ok(typeof action.officialSkill.contractSource === "string");
  assert.ok(action.officialSkill.contractSource.includes("not set"));
  assert.equal(action.officialSkill.executionReady, false);
});
