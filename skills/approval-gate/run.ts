import { putArtifact } from "../../runtime/artifacts.js";
import type {
  ApprovalTicket,
  GoalIntake,
  PolicyDecision,
  SkillContext,
  SkillOutput,
  SkillProposal,
} from "../../runtime/types.js";

function now(): string {
  return new Date().toISOString();
}

function ticketId(runId: string, proposal: string): string {
  const compact = proposal.replace(/[^a-z0-9_-]/gi, "-").slice(0, 32) || "proposal";
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `apt_${runId}_${compact}_${ts}`;
}

function selectProposalName(
  runtimeInput: Record<string, unknown>,
  policyDecision: PolicyDecision,
  proposals: SkillProposal[],
): string {
  const explicit = typeof runtimeInput.selectedProposal === "string"
    ? runtimeInput.selectedProposal
    : null;
  if (explicit && proposals.some((entry) => entry.name === explicit)) {
    return explicit;
  }
  if (policyDecision.proposal && proposals.some((entry) => entry.name === policyDecision.proposal)) {
    return policyDecision.proposal;
  }
  return proposals.find((entry) => entry.recommended)?.name ?? proposals[0]?.name ?? "unknown";
}

function buildEvidence(goalIntake: GoalIntake | undefined, policyDecision: PolicyDecision): string[] {
  const lines = [
    `policyOutcome=${policyDecision.outcome}`,
    `policyReasons=${policyDecision.reasons.join(" | ") || "none"}`,
  ];
  if (goalIntake) {
    lines.push(`symbols=${goalIntake.symbols.join(",")}`);
    lines.push(`intent=${goalIntake.hedgeIntent}`);
    lines.push(`horizon=${goalIntake.timeHorizon}`);
  }
  return lines;
}

export default async function run(context: SkillContext): Promise<SkillOutput> {
  const runtimeInput = context.runtimeInput as Record<string, unknown>;
  const executeRequested = runtimeInput.executeRequested === true;
  const approvalProvided = runtimeInput.approvalProvided === true;
  const approvedBy =
    typeof runtimeInput.approvedBy === "string" && runtimeInput.approvedBy.trim().length > 0
      ? runtimeInput.approvedBy.trim()
      : undefined;
  const approvalReason =
    typeof runtimeInput.approvalReason === "string" && runtimeInput.approvalReason.trim().length > 0
      ? runtimeInput.approvalReason.trim()
      : "manual_approval";

  const proposals = context.artifacts.require<SkillProposal[]>("planning.proposals").data;
  const policyDecision =
    context.artifacts.get<PolicyDecision>("execution.apply-decision")?.data ??
    context.artifacts.require<PolicyDecision>("policy.plan-decision").data;
  const goalIntake = context.artifacts.get<GoalIntake>("goal.intake")?.data;
  const proposal = selectProposalName(runtimeInput, policyDecision, proposals);

  let ticket: ApprovalTicket | undefined;
  const facts: string[] = [
    `Selected proposal: ${proposal}.`,
    `Execute requested: ${executeRequested ? "yes" : "no"}.`,
    `Approval provided: ${approvalProvided ? "yes" : "no"}.`,
  ];
  const constraintWarnings: string[] = [];

  if (executeRequested) {
    if (!approvalProvided || !approvedBy) {
      constraintWarnings.push("write execution requires --approve and --approved-by.");
      facts.push("Approval ticket was not issued.");
    } else {
      ticket = {
        ticketId: ticketId(context.runId, proposal),
        runId: context.runId,
        proposal,
        plane: context.plane,
        approvedBy,
        reason: approvalReason,
        approvedAt: now(),
        policyOutcome: policyDecision.outcome,
        evidence: buildEvidence(goalIntake, policyDecision),
      };
      putArtifact(context.artifacts, {
        key: "approval.ticket",
        version: context.manifest.artifactVersion,
        producer: context.manifest.name,
        data: ticket,
        ruleRefs: policyDecision.ruleRefs ?? [],
        doctrineRefs: policyDecision.doctrineRefs ?? [],
      });
      facts.push(`Approval ticket issued: ${ticket.ticketId}.`);
      facts.push(`Approved by: ${approvedBy}.`);
    }
  } else {
    facts.push("No approval ticket required for dry-run apply.");
  }

  return {
    skill: "approval-gate",
    stage: "executor",
    goal: context.goal,
    summary: "Attach an auditable approval ticket when supervised write execution is explicitly authorized.",
    facts,
    constraints: {
      selectedProposal: proposal,
      executeRequested,
      approvalProvided,
      approvedBy: approvedBy ?? null,
      approvalReason,
      warnings: constraintWarnings,
    },
    proposal: [],
    risk: {
      score: executeRequested ? 0.6 : 0.1,
      maxLoss: "No write is executed by approval-gate itself.",
      needsApproval: executeRequested && !ticket,
      reasons: constraintWarnings.length > 0 ? constraintWarnings : ["Approval ticket contract satisfied."],
    },
    permissions: {
      plane: context.plane,
      officialWriteOnly: true,
      allowedModules: [],
    },
    handoff: "official-executor",
    handoffReason: "Approval ticket is prepared for supervised execution.",
    producedArtifacts: ticket ? ["approval.ticket"] : [],
    consumedArtifacts: ["policy.plan-decision", "planning.proposals", "goal.intake"],
    ruleRefs: policyDecision.ruleRefs ?? [],
    doctrineRefs: policyDecision.doctrineRefs ?? [],
    metadata: {
      approvalTicket: ticket ?? null,
      approvalRequiredForWrite: executeRequested,
      blocked: executeRequested && !ticket,
    },
    timestamp: now(),
  };
}
