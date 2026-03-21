import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyRun, createPlan } from "../dist/runtime/executor.js";
import { loadArtifactSnapshot } from "../dist/runtime/trace.js";
import { buildReferencePayloads, cleanupRunArtifacts, withMockOkx } from "./test-helpers.mjs";

async function withTempHome(configToml, fn) {
  const dir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-live-guard-"));
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

test("live execute is blocked when live-guard mandatory flags are missing", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = { code: "0", data: [] };
  payloads.accountBalance = {
    code: "0",
    data: [{ details: [{ ccy: "USDT", availBal: "80000", usdEq: "80000" }] }],
  };

  let runId = null;
  const previousCorrelationCap = process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
  process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = "100";
  try {
    await withTempHome("[profiles.live]\napiKey = \"live\"\n[profiles.demo]\napiKey = \"demo\"\n", async () => {
      await withMockOkx(payloads, async () => {
        const planned = await createPlan("hedge my btc drawdown with live supervise", { plane: "live" });
        runId = planned.id;

        const blocked = await applyRun(planned.id, {
          plane: "live",
          approve: true,
          approvedBy: "alice",
          execute: true,
        });
        assert.equal(blocked.status, "blocked");
        assert.ok(blocked.executions.at(-1)?.blockedReason?.includes("--live-confirm"));

        const blockedArtifacts = await loadArtifactSnapshot(planned.id);
        const blockedGuard = blockedArtifacts["operations.live-guard"]?.data;
        assert.equal(blockedGuard?.status, "blocked");

        const allowed = await applyRun(planned.id, {
          plane: "live",
          approve: true,
          approvedBy: "alice",
          execute: true,
          liveConfirm: "YES_LIVE_EXECUTION",
          maxOrderUsd: 500,
          maxTotalUsd: 1_500,
        });
        assert.ok(["executed", "blocked"].includes(allowed.status));

        const allowedArtifacts = await loadArtifactSnapshot(planned.id);
        const allowedGuard = allowedArtifacts["operations.live-guard"]?.data;
        assert.equal(allowedGuard?.status, "allowed");
      });
    });
  } finally {
    if (previousCorrelationCap === undefined) {
      delete process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT;
    } else {
      process.env.TRADEMESH_MAX_CORRELATION_BUCKET_PCT = previousCorrelationCap;
    }
  }

  await cleanupRunArtifacts(runId);
});
