import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPlan, exportRun, runSkillStandalone } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("skills run can resume from a portable bundle without contract drift", async () => {
  const payloads = await buildReferencePayloads();
  let planRunId = null;
  let standaloneRunId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo first", { plane: "demo" });
    planRunId = planned.id;
    const exported = await exportRun(planned.id);
    const bundle = JSON.parse(await readFile(exported.bundlePath, "utf8"));

    const record = await runSkillStandalone("hedge-planner", "hedge my BTC drawdown with demo first", {
      plane: "demo",
      bundle,
      skipSatisfied: true,
    });
    standaloneRunId = record.id;

    assert.equal(record.routeKind, "standalone");
    assert.equal(record.contractDrift ?? false, false);

    const artifacts = await loadArtifactSnapshot(record.id);
    const proof = artifacts["mesh.route-proof"]?.data;
    assert.ok(proof);
    assert.equal(proof.contractDrift ?? false, false);
    assert.ok(proof.steps.some((step) => step.disposition === "skipped_satisfied"));
  });

  await cleanupRunArtifacts(planRunId);
  await cleanupRunArtifacts(standaloneRunId);
});
