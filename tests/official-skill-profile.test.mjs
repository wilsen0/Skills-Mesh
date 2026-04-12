import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActionsFromIntents,
  buildBundleOfficialSkillProfile,
  buildOfficialSkillProfile,
  extractTargetFromCommand,
} from "../dist/runtime/official-skill-adapter.js";
import { createCommandIntent } from "../dist/runtime/okx.js";
import { createArtifactStore, putArtifact } from "../dist/runtime/artifacts.js";

// ── OfficialSkillProfile construction ────────────────────────────────────────

test("buildOfficialSkillProfile derives method from intent module", () => {
  const intent = createCommandIntent("okx swap place-order --instId BTC-USDT-SWAP --tdMode cross --side sell --ordType market --sz 1 --json", {
    intentId: "test:swap:0",
    stepIndex: 0,
    safeToRetry: false,
    module: "swap",
    requiresWrite: true,
    reason: "Open short BTC position.",
  });

  const profile = buildOfficialSkillProfile(intent, "xlayer");
  assert.equal(profile.method, "swap-place-order");
  assert.equal(profile.target, "BTC-USDT-SWAP");
  assert.equal(profile.summary, "Open short BTC position.");
  assert.equal(profile.chain, "xlayer");
});

test("buildOfficialSkillProfile handles account-read intent", () => {
  const intent = createCommandIntent("okx account balance --json", {
    intentId: "test:balance:0",
    stepIndex: 0,
    safeToRetry: true,
    module: "account",
    requiresWrite: false,
    reason: "Refresh balance.",
  });

  const profile = buildOfficialSkillProfile(intent, undefined);
  assert.equal(profile.method, "account-read");
  assert.equal(profile.target, "account");
  assert.equal(profile.chain, "xlayer");
});

test("buildOfficialSkillProfile handles market-read intent", () => {
  const intent = createCommandIntent("okx market ticker BTC-USDT --json", {
    intentId: "test:ticker:0",
    stepIndex: 0,
    safeToRetry: true,
    module: "market",
    requiresWrite: false,
    reason: "Get BTC price.",
  });

  const profile = buildOfficialSkillProfile(intent, "xlayer");
  assert.equal(profile.method, "market-read");
  assert.equal(profile.target, "BTC-USDT");
});

test("extractTargetFromCommand extracts --instId value", () => {
  assert.equal(extractTargetFromCommand("okx swap place-order --instId ETH-USDT-SWAP --side buy --json"), "ETH-USDT-SWAP");
});

test("extractTargetFromCommand extracts ticker symbol", () => {
  assert.equal(extractTargetFromCommand("okx market ticker SOL-USDT --json"), "SOL-USDT");
});

test("extractTargetFromCommand falls back to account for account commands", () => {
  assert.equal(extractTargetFromCommand("okx account positions --json"), "account");
});

test("extractTargetFromCommand falls back to unknown for unrecognized commands", () => {
  assert.equal(extractTargetFromCommand("okx unknown command --json"), "unknown");
});

// ── buildActionsFromIntents populates officialSkill ──────────────────────────

test("buildActionsFromIntents populates officialSkill on each action", () => {
  const intents = [
    createCommandIntent("okx account balance --json", {
      intentId: "r:read:0",
      stepIndex: 0,
      safeToRetry: true,
      module: "account",
      requiresWrite: false,
      reason: "Read balance.",
    }),
    createCommandIntent("okx swap place-order --instId BTC-USDT-SWAP --tdMode cross --side sell --ordType market --sz 1 --json", {
      intentId: "r:write:1",
      stepIndex: 1,
      safeToRetry: false,
      module: "swap",
      requiresWrite: true,
      reason: "Open short BTC.",
    }),
  ];

  const actions = buildActionsFromIntents(intents, "0xTestWallet", "xlayer");
  assert.equal(actions.length, 2);

  // Read action
  assert.equal(actions[0].integration, "official-skill");
  assert.ok(actions[0].officialSkill);
  assert.equal(actions[0].officialSkill.method, "account-read");
  assert.equal(actions[0].officialSkill.target, "account");
  assert.equal(actions[0].wallet, "0xTestWallet");

  // Write action
  assert.equal(actions[1].integration, "official-skill");
  assert.ok(actions[1].officialSkill);
  assert.equal(actions[1].officialSkill.method, "swap-place-order");
  assert.equal(actions[1].officialSkill.target, "BTC-USDT-SWAP");
  assert.equal(actions[1].wallet, "0xTestWallet");
});

// ── buildBundleOfficialSkillProfile aggregates correctly ─────────────────────

test("buildBundleOfficialSkillProfile aggregates methods and targets", () => {
  const intents = [
    createCommandIntent("okx account balance --json", {
      intentId: "r:read:0",
      stepIndex: 0,
      safeToRetry: true,
      module: "account",
      requiresWrite: false,
      reason: "Read balance.",
    }),
    createCommandIntent("okx swap place-order --instId BTC-USDT-SWAP --tdMode cross --side sell --ordType market --sz 1 --json", {
      intentId: "r:write:1",
      stepIndex: 1,
      safeToRetry: false,
      module: "swap",
      requiresWrite: true,
      reason: "Open short BTC.",
    }),
    createCommandIntent("okx swap place-order --instId ETH-USDT-SWAP --tdMode cross --side sell --ordType market --sz 2 --json", {
      intentId: "r:write:2",
      stepIndex: 2,
      safeToRetry: false,
      module: "swap",
      requiresWrite: true,
      reason: "Open short ETH.",
    }),
  ];

  const actions = buildActionsFromIntents(intents, undefined, "xlayer");
  const profile = buildBundleOfficialSkillProfile(actions, "xlayer");

  assert.equal(profile.chain, "xlayer");
  assert.equal(profile.actionCount, 3);
  assert.equal(profile.writeCount, 2);
  assert.equal(profile.readCount, 1);
  assert.ok(profile.methods.includes("swap-place-order"));
  assert.ok(profile.methods.includes("account-read"));
  assert.ok(profile.targets.includes("BTC-USDT-SWAP"));
  assert.ok(profile.targets.includes("ETH-USDT-SWAP"));
  assert.ok(profile.targets.includes("account"));
});

// ── Backward compatibility ───────────────────────────────────────────────────

test("actions without officialSkill still produce valid bundle profile", () => {
  // Simulate old-format actions that lack officialSkill
  const legacyActions = [
    {
      actionId: "legacy:0",
      stepIndex: 0,
      kind: "swap-place-order",
      module: "swap",
      requiresWrite: true,
      safeToRetry: false,
      command: "okx swap place-order --instId BTC-USDT-SWAP --json",
      reason: "legacy action",
      integration: "official-skill",
    },
  ];

  const profile = buildBundleOfficialSkillProfile(legacyActions, "xlayer");
  assert.equal(profile.actionCount, 1);
  assert.equal(profile.writeCount, 1);
  assert.equal(profile.readCount, 0);
  assert.equal(profile.methods.length, 0);  // no officialSkill → empty methods
  assert.equal(profile.targets.length, 0);  // no officialSkill → empty targets
});

test("old bundles without officialSkillProfile remain valid in contracts", () => {
  const artifacts = createArtifactStore();

  // Old-format bundle without officialSkillProfile
  putArtifact(artifacts, {
    key: "execution.intent-bundle",
    version: 3,
    producer: "official-executor",
    data: {
      proposal: "protective-put",
      orderPlan: [],
      intents: [],
      commandPreview: [],
      wallet: "0xLegacy",
      chain: "xlayer",
      integration: "official-skill",
    },
  });

  const bundle = artifacts.get("execution.intent-bundle");
  assert.ok(bundle);
  assert.equal(bundle.data.integration, "official-skill");
  assert.equal(bundle.data.officialSkillProfile, undefined);
});

test("new bundles with officialSkillProfile pass contracts validation", () => {
  const artifacts = createArtifactStore();

  putArtifact(artifacts, {
    key: "execution.intent-bundle",
    version: 3,
    producer: "official-executor",
    data: {
      proposal: "protective-put",
      orderPlan: [],
      intents: [],
      commandPreview: [],
      wallet: "0xNew",
      chain: "xlayer",
      integration: "official-skill",
      officialSkillProfile: {
        chain: "xlayer",
        actionCount: 3,
        writeCount: 1,
        readCount: 2,
        methods: ["swap-place-order", "account-read"],
        targets: ["BTC-USDT-SWAP"],
      },
    },
  });

  const bundle = artifacts.get("execution.intent-bundle");
  assert.ok(bundle);
  assert.ok(bundle.data.officialSkillProfile);
  assert.equal(bundle.data.officialSkillProfile.actionCount, 3);
  assert.deepEqual(bundle.data.officialSkillProfile.methods, ["swap-place-order", "account-read"]);
});
