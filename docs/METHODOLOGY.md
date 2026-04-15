# TradeMesh Methodology

> `okx` CLI as the execution kernel, skill mesh as the runtime, doctrine/rules as the supporting knowledge layer.

---

## Product First

TradeMesh 2.0 is a `CLI X-Matrix for OKX`.

Its primary value is not “having doctrines” and not “being an agent framework”. The primary value is:

1. route a goal through installable skills
2. keep data handoff structured through artifacts
3. gate every write path through policy + official executor
4. preserve replayable audit state

The hedge workflow is the flagship pack that proves the runtime.

---

## Three Layers

### 1. Execution Kernel

- `okx market ... --json`
- `okx account ... --json`
- `okx swap ... --json`
- `okx option ... --json`

This is the only execution substrate.

### 2. Skill Runtime

- discover skills from `skills/*/SKILL.md`
- load optional local handlers
- run graph-aware planning through artifact dependencies
- persist `runs/*.json` and `.trademesh/runs/*`
- render operator-facing CLI cards for doctor / plan / apply / replay

### 3. Skill Packs

- `portfolio-xray`
- `market-scan`
- `trade-thesis`
- `hedge-planner`
- `scenario-sim`
- `policy-gate`
- `official-executor`
- `replay`

These packs are how the runtime becomes a product.

---

## Artifact Contract

`artifacts` is the authoritative handoff protocol.

- skills read from artifacts
- skills write to artifacts
- trace, replay, policy, and execution all depend on those artifacts
- `sharedState` exists only as a compatibility mirror and should not drive control flow

---

## Flagship Route

```text
goal
  -> portfolio-xray
  -> market-scan
  -> trade-thesis
  -> hedge-planner
  -> scenario-sim
  -> policy-gate
  -> official-executor
  -> replay
```

This route demonstrates:

- portfolio sensing
- market sensing
- thesis synthesis
- proposal ranking
- scenario stress
- policy gating
- controlled execution
- auditable replay

---

## Knowledge Layer

The files under:

- `docs/books/`
- `docs/rules/`
- `rules/*.json`
- `doctrines/*.json`

are a supporting layer for flagship packs.

They should only exist when they improve one of these runtime behaviors:

- thesis synthesis
- proposal ranking
- scenario evaluation
- policy limits

If a new doctrine or rule cannot affect runtime behavior, it is documentation bloat rather than product value.

---

## Design Rules

1. `okx` CLI is the only execution kernel.
2. one module is one skill.
3. `official-executor` is the only write path.
4. `policy-gate` is the mandatory control point for write-adjacent flows.
5. `graph-runtime` is the source of truth for execution order.
6. `router` should only encode goal signals and seed selection.
7. artifacts and run traces are more important than ad hoc logs.
