import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDoctor } from "../dist/runtime/doctor.js";
import { buildReferencePayloads, withMockOkx } from "./test-helpers.mjs";

async function withTempHome(configToml, fn) {
  const dir = await mkdtemp(join(tmpdir(), "okx-skill-mesh-home-probe-"));
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

test("doctor passive probe reports modules without probe receipts", async () => {
  const report = await runDoctor({ probeMode: "passive", plane: "demo" });
  assert.equal(report.probeMode, "passive");
  assert.equal(Array.isArray(report.modules), true);
  assert.equal(report.probeReceipts.length, 0);
});

test("doctor active probe executes read checks and stores receipts", async () => {
  const payloads = await buildReferencePayloads();
  await withTempHome("[profiles.demo]\napiKey = \"demo\"\n", async () => {
    await withMockOkx(payloads, async () => {
      const report = await runDoctor({ probeMode: "active", plane: "demo" });
      const marketModule = report.modules.find((entry) => entry.module === "market-read");
      const accountModule = report.modules.find((entry) => entry.module === "account-read");

      assert.equal(report.probeMode, "active");
      assert.ok(report.probeReceipts.length >= 2);
      assert.ok(report.probeReceipts.some((entry) => entry.module === "market-read"));
      assert.ok(report.probeReceipts.some((entry) => entry.module === "account-read"));
      assert.equal(marketModule?.status, "ready");
      assert.equal(accountModule?.status, "ready");
    });
  });
});

test("doctor write probe checks write-path preflight without sending write commands", async () => {
  const payloads = await buildReferencePayloads();
  await withTempHome("[profiles.demo]\napiKey = \"demo\"\n", async () => {
    await withMockOkx(payloads, async () => {
      const report = await runDoctor({ probeMode: "write", plane: "demo" });
      const writePath = report.modules.find((entry) => entry.module === "write-path");

      assert.equal(report.probeMode, "write");
      assert.ok(report.probeReceipts.some((entry) => entry.module === "write-path"));
      assert.equal(writePath?.status, "ready");
      assert.ok(writePath?.reason.toLowerCase().includes("preflight"));
    });
  });
});
