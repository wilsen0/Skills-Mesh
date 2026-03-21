import process from "node:process";
import { inspectOkxEnvironment } from "./okx.js";
import { getProjectPaths } from "./paths.js";
import { loadSkillRegistry } from "./registry.js";
import type { CapabilitySnapshot } from "./types.js";

type ExecutionReadiness =
  | "can_plan_only"
  | "can_dry_run_apply"
  | "can_execute_on_demo"
  | "cannot_execute";

const PLANNING_PACK = [
  "portfolio-xray",
  "market-scan",
  "trade-thesis",
  "hedge-planner",
  "scenario-sim",
  "policy-gate",
];
const APPLY_PACK = [...PLANNING_PACK, "official-executor", "replay"];

export interface DoctorReport {
  ok: boolean;
  summary: string;
  projectRoot: string;
  nodeVersion: string;
  skillCount: number;
  capabilitySnapshot: CapabilitySnapshot;
  executionReadiness: ExecutionReadiness;
  missingSkills: string[];
  recommendations: string[];
}

function section(title: string, lines: string[]): string {
  return [`== ${title} ==`, ...lines, ""].join("\n");
}

function computeExecutionReadiness(
  skillNames: string[],
  capabilitySnapshot: CapabilitySnapshot,
): {
  readiness: ExecutionReadiness;
  missingSkills: string[];
} {
  const installed = new Set(skillNames);
  const missingPlanning = PLANNING_PACK.filter((name) => !installed.has(name));
  const missingApply = APPLY_PACK.filter((name) => !installed.has(name));

  if (
    missingApply.length === 0 &&
    capabilitySnapshot.okxCliAvailable &&
    capabilitySnapshot.configExists &&
    capabilitySnapshot.demoProfileLikelyConfigured
  ) {
    return {
      readiness: "can_execute_on_demo",
      missingSkills: [],
    };
  }

  if (missingApply.length === 0) {
    return {
      readiness: "can_dry_run_apply",
      missingSkills: [],
    };
  }

  if (missingPlanning.length === 0) {
    return {
      readiness: "can_plan_only",
      missingSkills: missingApply,
    };
  }

  return {
    readiness: "cannot_execute",
    missingSkills: missingPlanning,
  };
}

function readinessLabel(readiness: ExecutionReadiness): string {
  if (readiness === "can_execute_on_demo") {
    return "can execute on demo";
  }
  if (readiness === "can_dry_run_apply") {
    return "can dry-run apply";
  }
  if (readiness === "can_plan_only") {
    return "can plan only";
  }
  return "cannot execute";
}

export async function runDoctor(): Promise<DoctorReport> {
  const paths = getProjectPaths();
  const [skills, capabilitySnapshot] = await Promise.all([loadSkillRegistry(), inspectOkxEnvironment()]);
  const readiness = computeExecutionReadiness(
    skills.map((skill) => skill.name),
    capabilitySnapshot,
  );
  const recommendations = [
    ...(readiness.missingSkills.length > 0
      ? [`Install the missing flagship skills: ${readiness.missingSkills.join(", ")}.`]
      : []),
    ...(!capabilitySnapshot.okxCliAvailable ? ["Install `okx` CLI and ensure it is on PATH."] : []),
    ...(!capabilitySnapshot.configExists ? ["Create ~/.okx/config.toml or keep project profiles/ for local development."] : []),
    ...(!capabilitySnapshot.demoProfileLikelyConfigured
      ? ["Configure a demo profile before attempting `--execute` on the demo plane."]
      : []),
    "Prefer apply without --execute first to validate policy and execution intents.",
    "Use replay after apply to show the auditable route, policy verdict, and execution receipt.",
  ];
  const ok = readiness.readiness !== "cannot_execute";

  const summary = [
    "TradeMesh CLI Skill Mesh 2.0",
    `Project root: ${paths.projectRoot}`,
    `Node: ${process.version}`,
    "",
    section("Runtime Readiness", [
      `Overall grade: ${capabilitySnapshot.readinessGrade}`,
      `Mesh state: ${readinessLabel(readiness.readiness)}`,
      `Executable plane recommendation: ${capabilitySnapshot.recommendedPlane}`,
      `Skills installed: ${skills.length}`,
      `Missing flagship skills: ${readiness.missingSkills.length > 0 ? readiness.missingSkills.join(", ") : "none"}`,
    ]),
    section("OKX Environment", [
      `OKX CLI status: ${capabilitySnapshot.okxCliAvailable ? "detected" : "missing"}`,
      `Config path: ${capabilitySnapshot.configPath}`,
      `Config status: ${capabilitySnapshot.configExists ? "available" : "missing"}`,
      `Demo profile: ${capabilitySnapshot.demoProfileLikelyConfigured ? "ready" : "not ready"}`,
      `Live profile: ${capabilitySnapshot.liveProfileLikelyConfigured ? "ready" : "not ready"}`,
    ]),
    section("Blockers And Remedies", [
      ...(capabilitySnapshot.blockers.length > 0
        ? capabilitySnapshot.blockers.map((blocker) => `blocker: ${blocker}`)
        : ["blocker: none"]),
      ...(capabilitySnapshot.warnings.length > 0
        ? capabilitySnapshot.warnings.map((warning) => `warning: ${warning}`)
        : ["warning: none"]),
      ...recommendations.slice(0, 3).map((item) => `remedy: ${item}`),
    ]),
  ].join("\n");

  return {
    ok,
    summary,
    projectRoot: paths.projectRoot,
    nodeVersion: process.version,
    skillCount: skills.length,
    capabilitySnapshot,
    executionReadiness: readiness.readiness,
    missingSkills: readiness.missingSkills,
    recommendations,
  };
}
