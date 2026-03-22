import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyRun, createPlan, exportRun, formatReplay, replayRun } from "../dist/runtime/executor.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("replay and export surface the same business brief first-screen fields", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo first", {
      plane: "demo",
    });
    runId = planned.id;
    await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      approvedBy: "alice",
      execute: false,
    });

    const replayed = await replayRun(planned.id);
    const replayText = formatReplay(replayed);
    const exported = await exportRun(planned.id);
    const bundle = JSON.parse(await readFile(exported.bundlePath, "utf8"));
    const report = await readFile(exported.reportPath, "utf8");

    assert.ok(replayText.includes("Business Brief"));
    assert.ok(report.includes("## Business Brief"));
    assert.equal(typeof bundle.businessBrief.goalSummary, "string");
    assert.equal(typeof bundle.businessBrief.recommendedAction, "string");
    assert.equal(typeof bundle.businessBrief.currentBlocker, "string");
    assert.equal(typeof bundle.businessBrief.nextSafeAction, "string");
    assert.ok(replayText.includes(bundle.businessBrief.goalSummary));
    assert.ok(report.includes(bundle.businessBrief.goalSummary));
  });

  await cleanupRunArtifacts(runId);
});
