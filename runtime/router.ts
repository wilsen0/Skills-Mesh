import type { SkillManifest } from "./types.js";

const STAGE_ORDER: SkillManifest["stage"][] = ["sensor", "planner", "guardrail", "executor", "memory"];

function stageRank(stage: SkillManifest["stage"]): number {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function matchingTriggers(goal: string, manifest: SkillManifest): string[] {
  const loweredGoal = goal.toLowerCase();
  return manifest.triggers.filter((trigger) => loweredGoal.includes(trigger.toLowerCase()));
}

export function triggerScore(goal: string, manifest: SkillManifest): number {
  return matchingTriggers(goal, manifest).length;
}

export function seedReasons(goal: string, manifest: SkillManifest): string[] {
  const reasons: string[] = [];
  const matched = matchingTriggers(goal, manifest);

  if (manifest.alwaysOn) {
    reasons.push("always_on");
  }
  if (matched.length > 0) {
    reasons.push(`trigger:${matched.join(",")}`);
  }
  if (manifest.stage === "guardrail") {
    reasons.push("guardrail");
  }
  if (manifest.consumes.length > 0) {
    reasons.push(`consumes:${manifest.consumes.join(",")}`);
  }
  if (reasons.length === 0) {
    reasons.push("manual");
  }

  return reasons;
}

export function shouldSeedManifest(goal: string, manifest: SkillManifest): boolean {
  if (manifest.stage === "guardrail") {
    return true;
  }

  if (manifest.alwaysOn) {
    return true;
  }

  if (triggerScore(goal, manifest) > 0) {
    return true;
  }

  return manifest.consumes.length > 0;
}

export function buildPlanningRoute(goal: string, manifests: SkillManifest[]): SkillManifest[] {
  return [...manifests]
    .filter((manifest) => manifest.stage !== "executor" && manifest.stage !== "memory")
    .filter((manifest) => shouldSeedManifest(goal, manifest))
    .sort((left, right) => {
      return (
        stageRank(left.stage) - stageRank(right.stage) ||
        triggerScore(goal, right) - triggerScore(goal, left) ||
        left.name.localeCompare(right.name)
      );
    });
}

export function buildRunRoute(goal: string, manifests: SkillManifest[]): string[] {
  const planningRoute = buildPlanningRoute(goal, manifests).map((manifest) => manifest.name);
  const extras = manifests
    .filter((manifest) => manifest.stage === "executor" || manifest.stage === "memory")
    .sort((left, right) => stageRank(left.stage) - stageRank(right.stage) || left.name.localeCompare(right.name))
    .map((manifest) => manifest.name);

  return [...new Set([...planningRoute, ...extras])];
}

export function resolveExecutor(manifests: SkillManifest[]): SkillManifest {
  const executor = manifests.find((manifest) => manifest.name === "official-executor");
  if (!executor) {
    throw new Error("No official-executor skill installed");
  }

  return executor;
}
