import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlan, exportRun, replayBundle, runSkillStandalone } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

test("portable bundle drift is reported in replay and blocked by default for standalone rerun", async () => {
  const payloads = await buildReferencePayloads();
  const tempDir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-bundle-drift-"));
  const mutatedPath = join(tempDir, "bundle.json");
  let planRunId = null;
  let overrideRunId = null;

  try {
    await withMockOkx(payloads, async () => {
      const planned = await createPlan("hedge my BTC drawdown with demo first", { plane: "demo" });
      planRunId = planned.id;
      const exported = await exportRun(planned.id);
      const bundle = JSON.parse(await readFile(exported.bundlePath, "utf8"));
      bundle.manifestProof.skillDigests["trade-thesis"] = "deadbeef";
      bundle.manifestProof.registryDigest = "deadbeef";
      await writeFile(mutatedPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

      const replayed = await replayBundle(mutatedPath);
      assert.equal(replayed.contractProof.matchedCurrentRegistry, false);
      assert.ok(replayed.contractProof.driftedSkills.includes("trade-thesis"));

      await assert.rejects(
        runSkillStandalone("hedge-planner", "hedge my BTC drawdown with demo first", {
          plane: "demo",
          bundle,
          skipSatisfied: true,
        }),
        /Portable bundle contract drift detected/,
      );

      const overridden = await runSkillStandalone("hedge-planner", "hedge my BTC drawdown with demo first", {
        plane: "demo",
        bundle,
        skipSatisfied: true,
        allowContractDrift: true,
      });
      overrideRunId = overridden.id;
      assert.equal(overridden.contractDrift, true);

      const artifacts = await loadArtifactSnapshot(overridden.id);
      assert.equal(artifacts["mesh.route-proof"]?.data?.contractDrift, true);
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await cleanupRunArtifacts(planRunId);
    await cleanupRunArtifacts(overrideRunId);
  }
});
