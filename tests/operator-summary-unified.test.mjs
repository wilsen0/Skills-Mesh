import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyRun, createPlan, exportRun, replayRun } from "../dist/runtime/executor.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("replay and export use the same operator-summary conclusion fields", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo first", { plane: "demo" });
    runId = planned.id;

    await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      execute: false,
    });

    const replayed = await replayRun(planned.id);
    const exported = await exportRun(planned.id);

    const operatorFromExport = JSON.parse(await readFile(exported.operatorSummaryPath, "utf8"));
    const operatorFromReplay = replayed.trace
      .filter((entry) => entry.skill === "operator-summarizer")
      .at(-1)?.metadata?.operatorSummary;

    assert.ok(operatorFromReplay);
    assert.equal(operatorFromReplay.isExecutable, operatorFromExport.isExecutable);
    assert.deepEqual(operatorFromReplay.blockers, operatorFromExport.blockers);
    assert.equal(operatorFromReplay.nextSafeAction, operatorFromExport.nextSafeAction);
    assert.equal(operatorFromReplay.requiresHumanAction, operatorFromExport.requiresHumanAction);
  });

  await cleanupRunArtifacts(runId);
});
