import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rehearseDemo } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

async function withTempHome(configToml, fn) {
  const dir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-home-rehearse-"));
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = dir;
    if (configToml) {
      const okxDir = join(dir, ".okx");
      await mkdir(okxDir, { recursive: true });
      await writeFile(join(okxDir, "config.toml"), configToml, "utf8");
    }
    return await fn();
  } finally {
    process.env.HOME = previousHome;
    await rm(dir, { recursive: true, force: true });
  }
}

test("rehearse demo supports dry-run and writes rehearsal artifacts", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withTempHome("[profiles.demo]\napiKey = \"demo\"\n", async () => {
    await withMockOkx(payloads, async () => {
      const record = await rehearseDemo({ execute: false, approve: true });
      runId = record.id;

      assert.equal(record.routeKind, "operations");
      assert.ok(record.route.includes("rehearsal-planner"));
      assert.ok(record.executions.length > 0);
      assert.ok(["dry_run", "blocked"].includes(record.status));

      const artifacts = await loadArtifactSnapshot(record.id);
      assert.ok(artifacts["operations.rehearsal-plan"]);
      assert.ok(artifacts["operations.rehearsal-receipt"]);
    });
  });

  await cleanupRunArtifacts(runId);
});

test("rehearse demo can execute when approve and execute are both provided", async () => {
  const payloads = await buildReferencePayloads();
  let runId = null;

  await withTempHome("[profiles.demo]\napiKey = \"demo\"\n", async () => {
    await withMockOkx(payloads, async () => {
      const record = await rehearseDemo({ execute: true, approve: true });
      runId = record.id;

      assert.equal(record.routeKind, "operations");
      assert.ok(record.executions.length > 0);
      assert.equal(record.executions.at(-1)?.mode, "execute");
      assert.ok(["executed", "failed", "blocked"].includes(record.status));
    });
  });

  await cleanupRunArtifacts(runId);
});
