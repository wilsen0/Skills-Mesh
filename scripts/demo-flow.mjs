#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const executorPath = join(repoRoot, "dist", "runtime", "executor.js");
const doctorPath = join(repoRoot, "dist", "runtime", "doctor.js");

const DEFAULTS = {
  goal: "hedge my BTC drawdown with demo first",
  plane: "demo",
  symbol: "BTC",
  maxDrawdown: "4",
  intent: "protect-downside",
  horizon: "swing",
  proposal: "protective-put",
  approvedBy: "demo-operator",
  approvalReason: "demo_flow",
};

function parseArgs(argv) {
  const options = {
    ...DEFAULTS,
    execute: false,
    verifyReceipt: undefined,
    replayBundle: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      continue;
    }
    if (token === "--execute") {
      options.execute = true;
      continue;
    }
    if (token === "--verify-receipt") {
      options.verifyReceipt = true;
      continue;
    }
    if (token === "--no-replay-bundle") {
      options.replayBundle = false;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unknown positional argument '${token}'. Use named flags only.`);
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Flag '${token}' requires a value.`);
    }

    switch (token) {
      case "--goal":
        options.goal = next;
        break;
      case "--plane":
        options.plane = next;
        break;
      case "--symbol":
        options.symbol = next;
        break;
      case "--max-drawdown":
        options.maxDrawdown = next;
        break;
      case "--intent":
        options.intent = next;
        break;
      case "--horizon":
        options.horizon = next;
        break;
      case "--proposal":
        options.proposal = next;
        break;
      case "--approved-by":
        options.approvedBy = next;
        break;
      case "--approval-reason":
        options.approvalReason = next;
        break;
      default:
        throw new Error(`Unknown flag '${token}'.`);
    }
    index += 1;
  }

  return options;
}

function assertSupportedOptions(options) {
  if (!existsSync(executorPath) || !existsSync(doctorPath)) {
    throw new Error("dist/runtime outputs were not found. Run `pnpm build` first.");
  }
  if (options.plane !== "demo" && options.plane !== "research") {
    throw new Error("demo-flow only supports --plane demo|research.");
  }
  if (options.execute && options.plane !== "demo") {
    throw new Error("--execute is only supported with --plane demo in demo-flow.");
  }
  if (options.verifyReceipt === true && options.execute !== true) {
    throw new Error("--verify-receipt requires --execute in demo-flow.");
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

function printCommand(args) {
  console.log(`$ node dist/bin/trademesh.js ${args.join(" ")}`);
}

function strictTarget(options) {
  return options.execute ? "execute" : "apply";
}

function doctorProbeMode(options) {
  return options.execute ? "active" : "passive";
}

function verifyReceiptEnabled(options) {
  if (options.execute !== true) {
    return false;
  }
  if (typeof options.verifyReceipt === "boolean") {
    return options.verifyReceipt;
  }
  return options.plane === "demo";
}

function goalOverrides(options) {
  const targetDrawdownPct = Number(options.maxDrawdown);
  if (!Number.isFinite(targetDrawdownPct) || targetDrawdownPct <= 0) {
    throw new Error("--max-drawdown must be a positive number.");
  }

  return {
    symbols: options.symbol.split(",").map((entry) => entry.trim()).filter(Boolean),
    targetDrawdownPct,
    hedgeIntent: options.intent,
    timeHorizon: options.horizon,
    executePreference: options.execute ? "execute" : "dry_run",
  };
}

function planArgs(options) {
  return [
    "plan",
    options.goal,
    "--plane",
    options.plane,
    "--symbol",
    options.symbol,
    "--max-drawdown",
    options.maxDrawdown,
    "--intent",
    options.intent,
    "--horizon",
    options.horizon,
  ];
}

function applyArgs(runId, options) {
  const args = [
    "apply",
    runId,
    "--plane",
    options.plane,
    "--proposal",
    options.proposal,
  ];

  if (options.execute) {
    args.push(
      "--approve",
      "--approved-by",
      options.approvedBy,
      "--approval-reason",
      options.approvalReason,
      "--execute",
    );
    if (verifyReceiptEnabled(options)) {
      args.push("--verify-receipt");
    }
  }

  return args;
}

function replayArgs(bundlePath) {
  return ["replay", "--bundle", bundlePath];
}

function printFinalSummary(summary) {
  section("Demo Flow Summary");
  console.log(`doctor.strictPass: ${summary.doctor.strictPass ? "yes" : "no"}`);
  console.log(`skills.failed: ${summary.certification.failedSkills}`);
  console.log(`planned.runId: ${summary.plan.id}`);
  console.log(`applied.status: ${summary.apply.status}`);
  console.log(`export.bundle: ${summary.export.bundlePath}`);
  console.log(`export.report: ${summary.export.reportPath}`);
  console.log(`export.operatorSummary: ${summary.export.operatorSummaryPath}`);
  console.log(`bundle.contractMatched: ${summary.bundleReplay?.contractProof?.matchedCurrentRegistry === false ? "no" : "yes"}`);
  console.log(`nextSafeAction: ${summary.apply.lastSafeAction ?? summary.apply.policyDecision?.nextAction ?? "see export report"}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertSupportedOptions(options);
  const [{ applyRun, certifySkills, createPlan, exportRun, replayBundle }, { runDoctor }] = await Promise.all([
    import("../dist/runtime/executor.js"),
    import("../dist/runtime/doctor.js"),
  ]);

  section("Doctor");
  printCommand([
    "doctor",
    "--probe",
    doctorProbeMode(options),
    "--plane",
    options.plane,
    "--strict",
    "--strict-target",
    strictTarget(options),
  ]);
  const doctor = await runDoctor({
    probeMode: doctorProbeMode(options),
    plane: options.plane,
    strict: true,
    strictTarget: strictTarget(options),
  });
  if (!doctor.strictPass) {
    throw new Error(`doctor strict gate failed for target=${strictTarget(options)}.`);
  }

  section("Certification");
  printCommand(["skills", "certify", "--strict"]);
  const certification = await certifySkills();
  if (certification.report.failedSkills > 0) {
    throw new Error(`skills certify failed for ${certification.report.failedSkills} skill(s).`);
  }

  section("Plan");
  printCommand(planArgs(options));
  const plan = await createPlan(options.goal, {
    plane: options.plane,
    goalOverrides: goalOverrides(options),
  });

  section("Apply");
  printCommand(applyArgs(plan.id, options));
  const apply = await applyRun(plan.id, {
    plane: options.plane,
    proposalName: options.proposal,
    approve: options.execute,
    approvedBy: options.execute ? options.approvedBy : undefined,
    approvalReason: options.execute ? options.approvalReason : undefined,
    execute: options.execute,
    verifyReceipt: verifyReceiptEnabled(options),
  });

  section("Export");
  printCommand(["export", plan.id]);
  const exported = await exportRun(plan.id);

  let bundleReplay;
  if (options.replayBundle) {
    section("Portable Replay");
    printCommand(replayArgs(exported.bundlePath));
    bundleReplay = await replayBundle(exported.bundlePath);
  }

  printFinalSummary({
    doctor,
    certification: certification.report,
    plan,
    apply,
    export: exported,
    bundleReplay,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
