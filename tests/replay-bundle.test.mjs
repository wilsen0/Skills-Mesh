import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyRun, createPlan, exportRun, replayBundle } from "../dist/runtime/executor.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("replay bundle works without local run files", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my BTC drawdown with demo first", { plane: "demo" });
    runId = planned.id;
    await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      approvedBy: "alice",
      execute: false,
    });
    const exported = await exportRun(planned.id);

    await rm(join(process.cwd(), "runs", `${planned.id}.json`), { force: true });
    await rm(join(process.cwd(), ".trademesh", "runs", planned.id), { recursive: true, force: true });

    const replayed = await replayBundle(exported.bundlePath);
    assert.equal(replayed.bundle.runId, planned.id);
    assert.equal(replayed.contractProof.matchedCurrentRegistry, true);
    assert.ok(replayed.summary.includes("Business Brief"));
    assert.ok(replayed.summary.includes("Contract Proof"));
  });

  await cleanupRunArtifacts(runId);
});
