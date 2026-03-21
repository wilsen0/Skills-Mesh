import { putArtifact } from "../../runtime/artifacts.js";
import { currentArtifactVersion } from "../../runtime/artifact-schema.js";
import { inspectOkxEnvironment } from "../../runtime/okx.js";
import type {
  CapabilitySnapshot,
  ProbeMode,
  ProbeReceipt,
  SkillContext,
  SkillOutput,
} from "../../runtime/types.js";

interface ProbeArtifactData {
  probeMode: ProbeMode;
  plane: SkillContext["plane"];
  capabilitySnapshot: CapabilitySnapshot;
  probeReceipts: ProbeReceipt[];
  notes: string[];
}

function readProbeMode(runtimeInput: Record<string, unknown>): ProbeMode {
  const raw = runtimeInput.probeMode;
  if (raw === "active" || raw === "write" || raw === "passive") {
    return raw;
  }
  return "active";
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const probeMode = readProbeMode(context.runtimeInput);
  const capabilitySnapshot =
    (context.runtimeInput.capabilitySnapshot as CapabilitySnapshot | undefined) ??
    (await inspectOkxEnvironment());
  const data: ProbeArtifactData = {
    probeMode,
    plane: context.plane,
    capabilitySnapshot,
    probeReceipts: [],
    notes: [
      `Probe mode=${probeMode}.`,
      `Plane=${context.plane}.`,
      `okx-cli=${capabilitySnapshot.okxCliAvailable ? "ready" : "missing"}.`,
    ],
  };

  putArtifact(context.artifacts, {
    key: "diagnostics.probes",
    version: currentArtifactVersion("diagnostics.probes"),
    producer: context.manifest.name,
    data,
  });

  return {
    skill: context.manifest.name,
    stage: context.manifest.stage,
    goal: context.goal,
    summary: "Capture baseline environment status for downstream probe steps.",
    facts: data.notes,
    constraints: {
      probeMode,
      plane: context.plane,
    },
    proposal: [],
    risk: {
      score: 0.05,
      maxLoss: "None",
      needsApproval: false,
      reasons: ["Probe skills are read-only."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: ["account", "market"],
    },
    handoff: "market-probe",
    producedArtifacts: ["diagnostics.probes"],
    consumedArtifacts: [],
    timestamp: new Date().toISOString(),
  };
}
