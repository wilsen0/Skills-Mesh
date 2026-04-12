import assert from "node:assert/strict";
import test from "node:test";
import { runDoctor } from "../dist/runtime/doctor.js";

test("doctor includes agent-wallet module in readiness report", async () => {
  const report = await runDoctor({ probeMode: "passive", plane: "demo" });

  const moduleNames = report.modules.map((m) => m.module);
  assert.ok(moduleNames.includes("agent-wallet"), `modules should include agent-wallet, got: ${moduleNames.join(", ")}`);
  const walletModule = report.modules.find((m) => m.module === "agent-wallet");
  assert.ok(walletModule);
  assert.ok(["ready", "degraded"].includes(walletModule.status), `agent-wallet should be ready or degraded, got ${walletModule.status}`);
});

test("doctor includes xlayer-chain module in readiness report", async () => {
  const report = await runDoctor({ probeMode: "passive", plane: "demo" });

  const moduleNames = report.modules.map((m) => m.module);
  assert.ok(moduleNames.includes("xlayer-chain"), `modules should include xlayer-chain, got: ${moduleNames.join(", ")}`);
  const chainModule = report.modules.find((m) => m.module === "xlayer-chain");
  assert.ok(chainModule);
  assert.ok(["ready", "degraded"].includes(chainModule.status), `xlayer-chain should be ready or degraded, got ${chainModule.status}`);
});

test("doctor includes official-skill module in readiness report", async () => {
  const report = await runDoctor({ probeMode: "passive", plane: "demo" });

  const moduleNames = report.modules.map((m) => m.module);
  assert.ok(moduleNames.includes("official-skill"), `modules should include official-skill, got: ${moduleNames.join(", ")}`);
  const skillModule = report.modules.find((m) => m.module === "official-skill");
  assert.ok(skillModule);
  assert.ok(["ready", "blocked"].includes(skillModule.status), `official-skill should be ready or blocked, got ${skillModule.status}`);
});

test("doctor wallet module evidence mentions installed skill", async () => {
  const report = await runDoctor({ probeMode: "passive", plane: "demo" });

  const walletModule = report.modules.find((m) => m.module === "agent-wallet");
  assert.ok(walletModule);
  // If agent-wallet is installed (it is in this repo), it should report ready
  if (walletModule.status === "ready") {
    assert.ok(
      walletModule.evidence.some((e) => e.toLowerCase().includes("installed")),
      `evidence should mention installed, got: ${walletModule.evidence.join(", ")}`,
    );
  }
});

test("doctor official-skill module evidence mentions adapter", async () => {
  const report = await runDoctor({ probeMode: "passive", plane: "demo" });

  const skillModule = report.modules.find((m) => m.module === "official-skill");
  assert.ok(skillModule);
  if (skillModule.status === "ready") {
    assert.ok(
      skillModule.evidence.some((e) => e.toLowerCase().includes("adapter")),
      `evidence should mention adapter, got: ${skillModule.evidence.join(", ")}`,
    );
  }
});
