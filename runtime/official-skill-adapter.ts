import process from "node:process";
import { createCommandIntent } from "./okx.js";
import { createHash } from "node:crypto";
import type {
  AgentWalletIdentity,
  CommandPreviewEntry,
  ExecutionAction,
  ExecutionBundle,
  OfficialSkillProfile,
  OkxCommandIntent,
  OptionPlaceOrderParams,
  OrderPlanStep,
  SwapPlaceOrderParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// X Layer Token Address Mapping (onchainos DEX execution)

const XLAYER_TOKENS: Record<string, string> = {
  OKB: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  WOKB: "0xe538905cf8410324e03a5a23c1c177a474d59b2b",
  USDC: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
  USDT: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
  WBTC: "0xea034fb02eb1808c2cc3adbc15f447b93cbe08e1",
  NATIVE: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
};

/**
 * Resolve an instId like "BTC-USDT" or "OKB-USDC" to onchainos --from/--to addresses.
 * Returns null if either token cannot be resolved.
 */
export function resolveOnchainosTokenPair(instId: string): { from: string; to: string } | null {
  const parts = instId.split("-");
  if (parts.length < 2) return null;
  const base = parts[0]!.toUpperCase();
  const quote = parts[1]!.toUpperCase();
  // WBTC mapping for BTC
  const fromToken = base === "BTC" ? XLAYER_TOKENS.WBTC : XLAYER_TOKENS[base];
  const toToken = quote === "BTC" ? XLAYER_TOKENS.WBTC : XLAYER_TOKENS[quote];
  if (!fromToken || !toToken) return null;
  return { from: fromToken, to: toToken };
}

export { XLAYER_TOKENS };

/**
 * Build an onchainos swap execute command for DEX execution on X Layer.
 * Format: onchainos swap execute --from <addr> --to <addr> --readable-amount <amt> --chain xlayer --wallet <wallet> --slippage 3
 */
export function buildOnchainosSwapCommand(
  params: SwapPlaceOrderParams,
  walletAddress: string,
  chain: string = "xlayer",
  slippage: string = "3",
): string {
  const instId = params.instId ?? "";
  const tokenPair = resolveOnchainosTokenPair(instId);
  // Fallback: if we can't resolve, use raw instId parts
  const fromAddr = tokenPair?.from ?? instId;
  const toAddr = tokenPair?.to ?? "NATIVE";
  const amount = params.sz ?? "0";
  const side = params.side ?? "buy";

  const args = [
    "onchainos", "swap", "execute",
    "--from", side === "buy" ? toAddr : fromAddr,
    "--to", side === "buy" ? fromAddr : toAddr,
    "--readable-amount", amount,
    "--chain", chain,
    "--wallet", walletAddress,
    "--slippage", slippage,
  ];
  return args.join(" ");
}

// ---------------------------------------------------------------------------
// Official Skill Adapter
//
// This module contains the OKX CLI command-building concern that was
// previously embedded inside the official-executor skill.  Extracting it
// here achieves two things:
//
//   1. The executor skill stays focused on proposal selection, risk-budget
//      materialization, and orchestration — not on command syntax.
//   2. Future skill packs (e.g. a "rebalance" pack) can reuse the same
//      command-building helpers without duplicating code or importing from
//      a skill directory.
//
// Backward compatibility: the executor still produces identical output.
// OkxCommandIntent is not modified.
// ---------------------------------------------------------------------------

// ── Utilities ────────────────────────────────────────────────────────────────

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function formatPrice(px: number): string {
  if (px >= 10_000) {
    return px.toFixed(1);
  }
  if (px >= 1_000) {
    return px.toFixed(2);
  }
  if (px >= 10) {
    return px.toFixed(3);
  }
  return px.toFixed(4);
}

// ── Plane flags ──────────────────────────────────────────────────────────────

export type PlaneLike = "research" | "demo" | "live";

export function buildPlaneFlagArgs(plane: PlaneLike): string[] {
  if (plane === "demo") {
    return ["--profile", "demo", "--json"];
  }
  if (plane === "live") {
    return ["--profile", "live", "--json"];
  }
  return ["--json"];
}

// ── Payload extraction from command strings ──────────────────────────────────

/**
 * Parse a CLI command string into a structured payload object keyed by flag
 * names.  Handles `--flag value` pairs and positional extraction for
 * account / market modules.
 */
export function extractPayloadFromCommand(command: string, module: string): Record<string, unknown> {
  const tokens = command.split(/\s+/);
  const parsed: Record<string, string> = {};

  // Extract --flag value pairs
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.startsWith("--") && i + 1 < tokens.length && !tokens[i + 1]!.startsWith("--")) {
      parsed[tokens[i]!.slice(2)] = tokens[i + 1]!;
      i++;
    }
  }

  // Enrich with positional args for account / market
  if (module === "market") {
    const tickerMatch = command.match(/okx\s+market\s+ticker\s+(\S+)/);
    if (tickerMatch) {
      parsed.symbol = tickerMatch[1]!;
    }
  }

  if (module === "account") {
    const accountMatch = command.match(/okx\s+account\s+(\w+)/);
    if (accountMatch) {
      parsed.operation = accountMatch[1]!;
    }
  }

  // Coerce numeric-looking values
  for (const [key, val] of Object.entries(parsed)) {
    if (val === "true") { parsed[key] = "true" as unknown as string; continue; }
    if (val === "false") { parsed[key] = "false" as unknown as string; continue; }
  }

  return parsed;
}

// ── Contract address resolution ──────────────────────────────────────────────

export interface ContractAddressResolution {
  /** Chain identifier, e.g. "xlayer". */
  chain: string;
  /** Skill method, e.g. "swap-place-order". */
  method: string;
  /** Resolved contract address, or undefined when not configured. */
  address?: string;
  /** Description of the config source for the address. */
  source: string;
  /** Whether a real address has been configured. */
  configured: boolean;
}

/**
 * Resolve a contract address for a given chain + method.
 *
 * Resolution order:
 *  1. Environment variable: `SKILLS_MESH_CONTRACT_{CHAIN}_{METHOD}` (uppercased, hyphens → underscores)
 *  2. Placeholder — no fabricated mainnet addresses.
 */
export function resolveContractAddress(chain: string, method: string): ContractAddressResolution {
  const envKey = `SKILLS_MESH_CONTRACT_${chain.toUpperCase()}_${method.toUpperCase().replace(/-/g, "_")}`;
  const envAddress = process.env[envKey];

  if (typeof envAddress === "string" && envAddress.trim().length > 0) {
    return {
      chain,
      method,
      address: envAddress.trim(),
      source: `env:${envKey}`,
      configured: true,
    };
  }

  return {
    chain,
    method,
    source: `env:${envKey} (not set)`,
    configured: false,
  };
}

// ── Swap / Option command construction ───────────────────────────────────────

export function buildSwapPlaceOrderCommand(params: SwapPlaceOrderParams, plane: PlaneLike): string {
  const args = [
    "okx",
    "swap",
    "place-order",
    "--instId",
    params.instId,
    "--tdMode",
    params.tdMode,
    "--side",
    params.side,
    "--ordType",
    params.ordType,
    "--sz",
    params.sz,
  ];

  if (params.px && params.ordType !== "market") {
    args.push("--px", params.px);
  }
  if (params.reduceOnly !== undefined) {
    args.push("--reduceOnly", String(params.reduceOnly));
  }
  if (params.posSide) {
    args.push("--posSide", params.posSide);
  }
  if (params.tpTriggerPx) {
    args.push("--tpTriggerPx", params.tpTriggerPx, "--tpOrdPx", params.tpOrdPx ?? "-1");
  }
  if (params.slTriggerPx) {
    args.push("--slTriggerPx", params.slTriggerPx, "--slOrdPx", params.slOrdPx ?? "-1");
  }
  if (params.tag) {
    args.push("--tag", params.tag);
  }
  if (params.clOrdId) {
    args.push("--clOrdId", params.clOrdId);
  }
  args.push(...buildPlaneFlagArgs(plane));
  return args.join(" ");
}

export function buildOptionPlaceOrderCommand(params: OptionPlaceOrderParams, plane: PlaneLike): string {
  return [
    "okx",
    "option",
    "place-order",
    "--instId",
    params.instId,
    "--side",
    params.side,
    "--sz",
    params.sz,
    "--px",
    params.px,
    ...buildPlaneFlagArgs(plane),
  ].join(" ");
}

// ── Read intents ─────────────────────────────────────────────────────────────

export function buildReadIntents(
  symbols: string[],
  plane: PlaneLike,
  runId: string,
  proposalName: string,
): OkxCommandIntent[] {
  const flags = buildPlaneFlagArgs(plane).join(" ");
  return [
    createCommandIntent(`okx account balance ${flags}`, {
      intentId: `${runId}:${proposalName}:read-balance`,
      stepIndex: 0,
      safeToRetry: true,
      module: "account",
      requiresWrite: false,
      reason: "Refresh account balance before materializing execution.",
    }),
    createCommandIntent(`okx account positions ${flags}`, {
      intentId: `${runId}:${proposalName}:read-positions`,
      stepIndex: 1,
      safeToRetry: true,
      module: "account",
      requiresWrite: false,
      reason: "Refresh account positions before materializing execution.",
    }),
    ...symbols.map((symbol, index) =>
      createCommandIntent(`okx market ticker ${symbol}-USDT ${flags}`, {
        intentId: `${runId}:${proposalName}:read-ticker:${symbol.toLowerCase()}`,
        stepIndex: index + 2,
        safeToRetry: true,
        module: "market",
        requiresWrite: false,
        reason: `Refresh ${symbol} price before materializing execution.`,
      })),
  ];
}

// ── Client order ref ─────────────────────────────────────────────────────────

export function createClientOrderRef(runId: string, proposalName: string, stepIndex: number): string {
  const fingerprint = createHash("sha256")
    .update(`${runId}|${proposalName}|${stepIndex}`)
    .digest("hex")
    .slice(0, 22);
  return `tm${fingerprint}`;
}

// ── Write intent for a single step ──────────────────────────────────────────

export function writeIntentForStep(
  step: OrderPlanStep,
  plane: PlaneLike,
  runId: string,
  proposalName: string,
  stepIndex: number,
): OkxCommandIntent {
  const clientOrderRef = createClientOrderRef(runId, proposalName, stepIndex);
  if (step.kind === "swap-place-order") {
    const params: SwapPlaceOrderParams = {
      ...step.params,
      clOrdId: clientOrderRef,
    };
    return createCommandIntent(buildSwapPlaceOrderCommand(params, plane), {
      intentId: `${runId}:${proposalName}:write:${stepIndex}`,
      stepIndex,
      safeToRetry: false,
      module: "swap",
      requiresWrite: true,
      clientOrderRef,
      reason: step.purpose,
    });
  }

  return createCommandIntent(buildOptionPlaceOrderCommand(step.params, plane), {
    intentId: `${runId}:${proposalName}:write:${stepIndex}`,
    stepIndex,
    safeToRetry: false,
    module: "option",
    requiresWrite: true,
    clientOrderRef,
    reason: step.purpose,
  });
}

// ── Official skill profile construction ──────────────────────────────────────

/**
 * Build an OfficialSkillProfile for a single action.
 * Derives method/target/payload from the existing intent fields so the
 * profile is always consistent with the command string.
 *
 * The payload is parsed from the CLI command arguments; the contract
 * address is resolved from environment config (never fabricated).
 */
export function buildOfficialSkillProfile(
  intent: OkxCommandIntent,
  chain: string | undefined,
): OfficialSkillProfile {
  const method = intent.module === "swap"
    ? "swap-place-order"
    : intent.module === "option"
      ? "option-place-order"
      : intent.module === "account"
        ? "account-read"
        : intent.module === "market"
          ? "market-read"
          : intent.module;

  // Best-effort target extraction from command args
  const target = extractTargetFromCommand(intent.command);

  // Structured payload from CLI command flags
  const payload = extractPayloadFromCommand(intent.command, intent.module);

  // Contract address resolution
  const effectiveChain = chain ?? "xlayer";
  const contractResolution = resolveContractAddress(effectiveChain, method);

  // An action is "execution ready" when it has a real address AND a non-empty payload
  const executionReady = contractResolution.configured
    && Object.keys(payload).length > 0
    && typeof contractResolution.address === "string";

  const profile: OfficialSkillProfile = {
    method,
    target,
    payload,
    summary: intent.reason,
    chain: effectiveChain,
    contractAddress: contractResolution.address,
    contractSource: contractResolution.source,
    executionReady,
  };

  return profile;
}

export function extractTargetFromCommand(command: string): string {
  // e.g. "okx swap place-order --instId BTC-USDT-SWAP ..."
  const instIdMatch = command.match(/--instId\s+(\S+)/);
  if (instIdMatch) return instIdMatch[1]!;
  // e.g. "okx market ticker BTC-USDT ..."
  const tickerMatch = command.match(/okx\s+market\s+ticker\s+(\S+)/);
  if (tickerMatch) return tickerMatch[1]!;
  // e.g. "okx account balance ..."
  if (command.includes("okx account")) return "account";
  return "unknown";
}

// ── Actions from intents ─────────────────────────────────────────────────────

export function buildActionsFromIntents(
  intents: OkxCommandIntent[],
  walletAddress: string | undefined,
  chain: string | undefined,
  useOnchainos: boolean = false,
): ExecutionAction[] {
  return intents.map((intent) => {
    // For onchainos DEX path, rewrite swap write commands
    let command = intent.command;
    let integration: string = "official-skill";
    if (useOnchainos && intent.requiresWrite && intent.module === "swap") {
      // Extract params from existing command to build onchainos version
      const szMatch = command.match(/--sz\s+(\S+)/);
      const instIdMatch = command.match(/--instId\s+(\S+)/);
      const sideMatch = command.match(/--side\s+(\S+)/);
      if (szMatch && instIdMatch && sideMatch) {
        const params: SwapPlaceOrderParams = {
          instId: instIdMatch[1]!,
          tdMode: "cross",
          side: sideMatch[1] as "buy" | "sell",
          ordType: "market",
          sz: szMatch[1]!,
        };
        command = buildOnchainosSwapCommand(params, walletAddress!, chain);
      }
      integration = "onchainos";
    } else if (useOnchainos && !intent.requiresWrite) {
      // Read intents: use onchainos for balance/market data
      if (intent.module === "account") {
        command = `onchainos wallet balance --chain ${chain ?? "xlayer"}`;
      } else if (intent.module === "market") {
        const tickerMatch = command.match(/okx\s+market\s+ticker\s+(\S+)-USDT/);
        if (tickerMatch) {
          const symbol = tickerMatch[1]!.toUpperCase();
          const tokenAddr = symbol === "BTC" ? XLAYER_TOKENS.WBTC : XLAYER_TOKENS[symbol];
          if (tokenAddr) {
            command = `onchainos --chain xlayer token search --query ${symbol}`;
          }
        }
      }
      integration = "onchainos";
    }

    return {
      actionId: intent.intentId,
      stepIndex: intent.stepIndex,
      kind: intent.module === "swap"
        ? "swap-place-order" as const
        : intent.module === "option"
          ? "option-place-order" as const
          : "cross-chain-transfer" as const,
      module: intent.module,
      requiresWrite: intent.requiresWrite,
      safeToRetry: intent.safeToRetry,
      command,
      reason: intent.reason,
      wallet: walletAddress,
      chain: chain,
      clientOrderRef: intent.clientOrderRef,
      integration,
      officialSkill: buildOfficialSkillProfile(intent, chain),
    };
  });
}

// ── Bundle-level profile aggregation ─────────────────────────────────────────

export function buildBundleOfficialSkillProfile(
  actions: ExecutionAction[],
  chain: string,
): {
  chain: string;
  actionCount: number;
  writeCount: number;
  readCount: number;
  methods: string[];
  targets: string[];
  payloadsPopulated: boolean;
  contractAddressesConfigured: boolean;
} {
  const writeActions = actions.filter((a) => a.requiresWrite);
  const readActions = actions.filter((a) => !a.requiresWrite);
  const methodSet = [...new Set(actions.map((a) => a.officialSkill?.method).filter(Boolean) as string[])];
  const targetSet = [...new Set(actions.map((a) => a.officialSkill?.target).filter(Boolean) as string[])];

  const allPayloadsPopulated = actions.every(
    (a) => a.officialSkill?.payload && Object.keys(a.officialSkill.payload).length > 0,
  );
  const allContractsConfigured = actions
    .filter((a) => a.requiresWrite)
    .every((a) => a.officialSkill?.contractAddress !== undefined);

  return {
    chain,
    actionCount: actions.length,
    writeCount: writeActions.length,
    readCount: readActions.length,
    methods: methodSet,
    targets: targetSet,
    payloadsPopulated: allPayloadsPopulated,
    contractAddressesConfigured: allContractsConfigured,
  };
}

// ── Wallet / chain adapter helpers ──────────────────────────────────────────

export function resolveWalletFromArtifacts(
  walletArtifact: AgentWalletIdentity | undefined,
): { walletAddress: string | undefined; chain: string } {
  return {
    walletAddress: walletArtifact?.walletAddress,
    chain: walletArtifact?.chain ?? "xlayer",
  };
}

export function previewEntry(intent: OkxCommandIntent): CommandPreviewEntry {
  return {
    intentId: intent.intentId,
    stepIndex: intent.stepIndex,
    module: intent.module,
    requiresWrite: intent.requiresWrite,
    safeToRetry: intent.safeToRetry,
    clientOrderRef: intent.clientOrderRef,
    reason: intent.reason,
    command: intent.command,
  };
}
