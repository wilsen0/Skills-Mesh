import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadArtifactSnapshot, loadRun } from "../dist/runtime/trace.js";

test("loadRun rejects v2 runs after v3 hard cutover", async () => {
  const runId = `run_v2_reject_${Date.now()}`;
  const runPath = join(process.cwd(), "runs", `${runId}.json`);
  await mkdir(join(process.cwd(), "runs"), { recursive: true });
  try {
    await writeFile(
      runPath,
      JSON.stringify(
        {
          kind: "trademesh-run",
          version: 2,
          id: runId,
          goal: "legacy",
          plane: "demo",
          status: "planned",
          routeKind: "workflow",
          route: ["portfolio-xray"],
          trace: [],
          facts: [],
          constraints: {},
          proposals: [],
          risk: { score: 0, maxLoss: "n/a", needsApproval: false, reasons: [] },
          permissions: { plane: "demo", officialWriteOnly: true, allowedModules: [] },
          capabilitySnapshot: {
            okxCliAvailable: true,
            configPath: "profiles",
            configExists: true,
            demoProfileLikelyConfigured: true,
            liveProfileLikelyConfigured: false,
            readinessGrade: "A",
            blockers: [],
            recommendedPlane: "demo",
            warnings: [],
          },
          approved: false,
          executions: [],
          errors: [],
          notes: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    await assert.rejects(() => loadRun(runId), /run version 3/i);
  } finally {
    await rm(runPath, { force: true });
  }
});

test("loadArtifactSnapshot rejects v2 artifact envelopes after v3 hard cutover", async () => {
  const runId = `run_v2_artifacts_reject_${Date.now()}`;
  const runDir = join(process.cwd(), ".trademesh", "runs", runId);
  await mkdir(runDir, { recursive: true });
  try {
    await writeFile(
      join(runDir, "artifacts.json"),
      JSON.stringify(
        {
          kind: "trademesh-artifacts",
          version: 2,
          runId,
          savedAt: new Date().toISOString(),
          artifacts: {},
        },
        null,
        2,
      ),
      "utf8",
    );

    await assert.rejects(() => loadArtifactSnapshot(runId), /unsupported legacy format|recreate/i);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});
