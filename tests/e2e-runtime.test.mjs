import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyRun, createPlan, replayRun } from "../dist/runtime/executor.js";
import { buildReferencePayloads, withMockOkx } from "./test-helpers.mjs";

test("runtime supports plan -> apply --approve -> replay through mocked OKX CLI", async () => {
  const payloads = await buildReferencePayloads();
  payloads.accountPositions = { code: "0", data: [] };
  payloads.accountBalance = {
    code: "0",
    data: [{ details: [{ ccy: "USDT", availBal: "50000", usdEq: "50000" }] }],
  };

  let runId = null;
  await withMockOkx(payloads, async () => {
    const planned = await createPlan("hedge my btc drawdown with demo first", { plane: "demo" });
    runId = planned.id;

    assert.ok(planned.route.includes("trade-thesis"));
    assert.ok(planned.route.includes("scenario-sim"));
    assert.ok(planned.proposals.length > 0);

    const applied = await applyRun(planned.id, {
      plane: "demo",
      approve: true,
      execute: false,
    });

    assert.ok(["dry_run", "approval_required", "blocked"].includes(applied.status));
    assert.ok(applied.executions.length >= 1);

    const replayed = await replayRun(planned.id);
    assert.equal(replayed.trace.at(-1)?.skill, "replay");
  });

  if (runId) {
    await rm(join(process.cwd(), "runs", `${runId}.json`), { force: true });
    await rm(join(process.cwd(), ".trademesh", "runs", runId), { recursive: true, force: true });
  }
});
