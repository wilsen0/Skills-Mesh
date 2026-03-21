---
name: diagnosis-synthesizer
description: "Convert probe receipts into module-level readiness diagnosis."
stage: guardrail
role: guardrail
requires: [okx-cex-portfolio, okx-cex-market]
risk_level: low
writes: false
always_on: false
triggers: [diagnosis, readiness, rehearsal]
entrypoint: ./run.js
consumes: [diagnostics.probes]
produces: [diagnostics.readiness]
preferred_handoffs: [rehearsal-planner]
repeatable: true
artifact_version: 2
standalone_command: "trademesh skills run diagnosis-synthesizer \"<goal>\" --plane demo"
standalone_route: [env-probe, market-probe, account-probe, diagnosis-synthesizer]
standalone_inputs: [goal]
standalone_outputs: [diagnostics.readiness]
required_capabilities: [okx-cli, market-read, account-read]
---

# Diagnosis Synthesizer

Produces an explicit environment diagnosis from probe evidence.
