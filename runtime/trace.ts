import { existsSync, promises as fs } from "node:fs";
import { join } from "node:path";
import { getProjectPaths } from "./paths.js";
import { validateArtifactSnapshot, validatePolicyDecision } from "./contracts.js";
import type { ArtifactSnapshot, ExecutionPlane, RunErrorRecord, RunRecord, SkillOutput } from "./types.js";

export interface TraceEnvelope {
  kind: "trademesh-trace";
  version: 3;
  runId: string;
  goal: string;
  plane: RunRecord["plane"];
  status: RunRecord["status"];
  createdAt: string;
  updatedAt: string;
  trace: SkillOutput[];
  executions: RunRecord["executions"];
  errors: RunErrorRecord[];
  policyDecision?: RunRecord["policyDecision"];
}

export interface ExecutionEnvelope {
  kind: "trademesh-executions";
  version: 3;
  runId: string;
  savedAt: string;
  executions: RunRecord["executions"];
  errors: RunErrorRecord[];
}

export interface PolicyEnvelope {
  kind: "trademesh-policy";
  version: 3;
  runId: string;
  savedAt: string;
  decision: RunRecord["policyDecision"] | null;
}

interface ArtifactSnapshotEnvelope {
  kind: "trademesh-artifacts";
  version: 3;
  runId: string;
  savedAt: string;
  artifacts: ArtifactSnapshot;
}

function timestampPrefix(date = new Date()): string {
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPlane(value: unknown): value is ExecutionPlane {
  return value === "research" || value === "demo" || value === "live";
}

function isStatus(value: unknown): value is RunRecord["status"] {
  return (
    value === "planned" ||
    value === "approval_required" ||
    value === "ready" ||
    value === "blocked" ||
    value === "dry_run" ||
    value === "executed" ||
    value === "failed" ||
    value === "previewed"
  );
}

function validateTraceEnvelopePayload(parsed: unknown, runId: string): TraceEnvelope {
  invariant(isObject(parsed), `Trace snapshot for run '${runId}' must be an object.`);
  invariant(parsed.kind === "trademesh-trace", `Trace snapshot for run '${runId}' uses an unsupported legacy format.`);
  invariant(parsed.version === 3, `Trace snapshot for run '${runId}' must use version 3.`);
  invariant(typeof parsed.runId === "string" && parsed.runId.length > 0, `Trace snapshot for run '${runId}' is missing runId.`);
  invariant(typeof parsed.goal === "string", `Trace snapshot for run '${runId}' is missing goal.`);
  invariant(isPlane(parsed.plane), `Trace snapshot for run '${runId}' has an invalid plane.`);
  invariant(isStatus(parsed.status), `Trace snapshot for run '${runId}' has an invalid status.`);
  invariant(typeof parsed.createdAt === "string", `Trace snapshot for run '${runId}' is missing createdAt.`);
  invariant(typeof parsed.updatedAt === "string", `Trace snapshot for run '${runId}' is missing updatedAt.`);
  invariant(Array.isArray(parsed.trace), `Trace snapshot for run '${runId}' must contain a trace array.`);
  invariant(Array.isArray(parsed.executions), `Trace snapshot for run '${runId}' must contain an executions array.`);
  invariant(Array.isArray(parsed.errors), `Trace snapshot for run '${runId}' must contain an errors array.`);
  validatePolicyDecision((parsed.policyDecision as RunRecord["policyDecision"]) ?? undefined);
  return parsed as unknown as TraceEnvelope;
}

function validatePolicyEnvelopePayload(parsed: unknown, runId: string): PolicyEnvelope {
  invariant(isObject(parsed), `Policy snapshot for run '${runId}' must be an object.`);
  invariant(parsed.kind === "trademesh-policy", `Policy snapshot for run '${runId}' uses an unsupported legacy format.`);
  invariant(parsed.version === 3, `Policy snapshot for run '${runId}' must use version 3.`);
  invariant(typeof parsed.runId === "string" && parsed.runId.length > 0, `Policy snapshot for run '${runId}' is missing runId.`);
  invariant(typeof parsed.savedAt === "string", `Policy snapshot for run '${runId}' is missing savedAt.`);
  validatePolicyDecision((parsed.decision as RunRecord["policyDecision"]) ?? null);
  return parsed as unknown as PolicyEnvelope;
}

function validateExecutionEnvelopePayload(parsed: unknown, runId: string): ExecutionEnvelope {
  invariant(isObject(parsed), `Execution snapshot for run '${runId}' must be an object.`);
  invariant(parsed.kind === "trademesh-executions", `Execution snapshot for run '${runId}' uses an unsupported legacy format.`);
  invariant(parsed.version === 3, `Execution snapshot for run '${runId}' must use version 3.`);
  invariant(typeof parsed.runId === "string" && parsed.runId.length > 0, `Execution snapshot for run '${runId}' is missing runId.`);
  invariant(typeof parsed.savedAt === "string", `Execution snapshot for run '${runId}' is missing savedAt.`);
  invariant(Array.isArray(parsed.executions), `Execution snapshot for run '${runId}' must contain an executions array.`);
  invariant(Array.isArray(parsed.errors), `Execution snapshot for run '${runId}' must contain an errors array.`);
  return parsed as unknown as ExecutionEnvelope;
}

export async function ensureRunsDirectory(): Promise<void> {
  const { runsRoot } = getProjectPaths();
  if (!existsSync(runsRoot)) {
    await fs.mkdir(runsRoot, { recursive: true });
  }
}

async function ensureMeshRunsDirectory(): Promise<void> {
  const { meshRunsRoot } = getProjectPaths();
  if (!existsSync(meshRunsRoot)) {
    await fs.mkdir(meshRunsRoot, { recursive: true });
  }
}

async function ensureMeshRunDirectory(runId: string): Promise<string> {
  await ensureMeshRunsDirectory();
  const { meshRunsRoot } = getProjectPaths();
  const runDir = join(meshRunsRoot, runId);
  if (!existsSync(runDir)) {
    await fs.mkdir(runDir, { recursive: true });
  }
  return runDir;
}

function buildTraceEnvelope(record: RunRecord): TraceEnvelope {
  return {
    kind: "trademesh-trace",
    version: 3,
    runId: record.id,
    goal: record.goal,
    plane: record.plane,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    trace: record.trace,
    executions: record.executions,
    errors: record.errors ?? [],
    policyDecision: record.policyDecision,
  };
}

function buildPolicyEnvelope(record: RunRecord): PolicyEnvelope {
  return {
    kind: "trademesh-policy",
    version: 3,
    runId: record.id,
    savedAt: new Date().toISOString(),
    decision: record.policyDecision ?? null,
  };
}

function buildExecutionEnvelope(record: RunRecord): ExecutionEnvelope {
  return {
    kind: "trademesh-executions",
    version: 3,
    runId: record.id,
    savedAt: new Date().toISOString(),
    executions: record.executions,
    errors: record.errors ?? [],
  };
}

export async function createRunId(): Promise<string> {
  await ensureRunsDirectory();
  const nonce = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `run_${timestampPrefix(new Date())}_${nonce}`;
}

export async function saveRun(record: RunRecord): Promise<void> {
  await ensureRunsDirectory();
  const { runsRoot } = getProjectPaths();
  const filePath = join(runsRoot, `${record.id}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  const runDir = await ensureMeshRunDirectory(record.id);
  const tracePath = join(runDir, "trace.json");
  const envelope = buildTraceEnvelope(record);
  await fs.writeFile(tracePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  const policyPath = join(runDir, "policy.json");
  await fs.writeFile(policyPath, `${JSON.stringify(buildPolicyEnvelope(record), null, 2)}\n`, "utf8");

  const executionPath = join(runDir, "executions.json");
  await fs.writeFile(
    executionPath,
    `${JSON.stringify(buildExecutionEnvelope(record), null, 2)}\n`,
    "utf8",
  );
}

export async function loadRun(runId: string): Promise<RunRecord> {
  const { runsRoot } = getProjectPaths();
  const filePath = join(runsRoot, `${runId}.json`);
  const contents = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(contents) as unknown;
  invariant(isObject(parsed), `Run '${runId}' is malformed.`);
  invariant(
    parsed.kind === "trademesh-run",
    `Run '${runId}' uses an unsupported format. Recreate this run with the current runtime.`,
  );
  invariant(
    parsed.version === 3,
    `Run '${runId}' uses version ${String((parsed as { version?: unknown }).version ?? "unknown")}. Hard cutover requires run version 3; recreate the plan.`,
  );
  invariant(
    parsed.routeKind === "workflow" || parsed.routeKind === "standalone" || parsed.routeKind === "operations",
    `Run '${runId}' is missing routeKind. Hard cutover requires new run metadata; recreate the plan.`,
  );
  return parsed as unknown as RunRecord;
}

export async function loadTraceEnvelope(runId: string): Promise<TraceEnvelope | null> {
  const { meshRunsRoot } = getProjectPaths();
  const tracePath = join(meshRunsRoot, runId, "trace.json");

  if (!existsSync(tracePath)) {
    return null;
  }

  const contents = await fs.readFile(tracePath, "utf8");
  return validateTraceEnvelopePayload(JSON.parse(contents), runId);
}

export async function saveArtifactSnapshot(runId: string, snapshot: ArtifactSnapshot): Promise<void> {
  const runDir = await ensureMeshRunDirectory(runId);
  const artifactPath = join(runDir, "artifacts.json");
  const validated = validateArtifactSnapshot(snapshot);
  const envelope: ArtifactSnapshotEnvelope = {
    kind: "trademesh-artifacts",
    version: 3,
    runId,
    savedAt: new Date().toISOString(),
    artifacts: validated,
  };
  await fs.writeFile(artifactPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

export async function loadArtifactSnapshot(runId: string): Promise<ArtifactSnapshot> {
  const { meshRunsRoot } = getProjectPaths();
  const artifactPath = join(meshRunsRoot, runId, "artifacts.json");
  if (!existsSync(artifactPath)) {
    return {};
  }

  const contents = await fs.readFile(artifactPath, "utf8");
  const parsed = JSON.parse(contents) as ArtifactSnapshot | ArtifactSnapshotEnvelope;
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "kind" in parsed &&
    parsed.kind === "trademesh-artifacts" &&
    parsed.version === 3
  ) {
    const snapshot = parsed.artifacts && typeof parsed.artifacts === "object" ? parsed.artifacts : {};
    return validateArtifactSnapshot(snapshot);
  }

  throw new Error(
    `Artifact snapshot for run '${runId}' uses an unsupported legacy format. Archive dev state and recreate the plan.`,
  );
}

export async function loadPolicyEnvelope(runId: string): Promise<PolicyEnvelope | null> {
  const { meshRunsRoot } = getProjectPaths();
  const policyPath = join(meshRunsRoot, runId, "policy.json");
  if (!existsSync(policyPath)) {
    return null;
  }

  const contents = await fs.readFile(policyPath, "utf8");
  return validatePolicyEnvelopePayload(JSON.parse(contents), runId);
}

export async function loadExecutionEnvelope(runId: string): Promise<ExecutionEnvelope | null> {
  const { meshRunsRoot } = getProjectPaths();
  const executionPath = join(meshRunsRoot, runId, "executions.json");
  if (!existsSync(executionPath)) {
    return null;
  }

  const contents = await fs.readFile(executionPath, "utf8");
  return validateExecutionEnvelopePayload(JSON.parse(contents), runId);
}

export async function loadTraceEntries(runId: string): Promise<SkillOutput[]> {
  const envelope = await loadTraceEnvelope(runId);
  return envelope?.trace ?? [];
}

export async function listRunIds(): Promise<string[]> {
  await ensureRunsDirectory();
  const { runsRoot } = getProjectPaths();
  const entries = await fs.readdir(runsRoot);
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.replace(/\.json$/, ""))
    .sort();
}
