import { createHash } from "node:crypto";
import type { ManifestDigestProof, SkillManifest } from "./types.js";

interface ManifestContractDigestInput {
  name: string;
  contractVersion: number;
  consumes: string[];
  produces: string[];
  standaloneRoute: string[];
  standaloneOutputs: string[];
  proofClass: SkillManifest["proofClass"];
  requiredCapabilities: string[];
  safetyClass: SkillManifest["safetyClass"];
  determinism: SkillManifest["determinism"];
}

function now(): string {
  return new Date().toISOString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestInput(manifest: SkillManifest): ManifestContractDigestInput {
  return {
    name: manifest.name,
    contractVersion: manifest.contractVersion,
    consumes: [...manifest.consumes],
    produces: [...manifest.produces],
    standaloneRoute: [...manifest.standaloneRoute],
    standaloneOutputs: [...manifest.standaloneOutputs],
    proofClass: manifest.proofClass,
    requiredCapabilities: [...manifest.requiredCapabilities],
    safetyClass: manifest.safetyClass,
    determinism: manifest.determinism,
  };
}

export function skillContractDigest(manifest: SkillManifest): string {
  return sha256(stableJson(digestInput(manifest)));
}

function registryDigest(skillDigests: Record<string, string>): string {
  return sha256(stableJson(skillDigests));
}

export function buildManifestDigestProof(manifests: SkillManifest[]): ManifestDigestProof {
  const skillDigests = Object.fromEntries(
    [...manifests]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((manifest) => [manifest.name, skillContractDigest(manifest)]),
  );

  return {
    registryDigest: registryDigest(skillDigests),
    skillDigests,
    matchedCurrentRegistry: true,
    driftedSkills: [],
    checkedAt: now(),
  };
}

export function compareManifestDigestProof(
  expected: ManifestDigestProof,
  manifests: SkillManifest[],
): ManifestDigestProof {
  const current = buildManifestDigestProof(manifests);
  const driftedSkills = [...new Set([
    ...Object.keys(expected.skillDigests),
    ...Object.keys(current.skillDigests),
  ])]
    .filter((skill) => expected.skillDigests[skill] !== current.skillDigests[skill])
    .sort((left, right) => left.localeCompare(right));

  return {
    ...current,
    matchedCurrentRegistry: driftedSkills.length === 0 && expected.registryDigest === current.registryDigest,
    driftedSkills,
    checkedAt: now(),
  };
}
