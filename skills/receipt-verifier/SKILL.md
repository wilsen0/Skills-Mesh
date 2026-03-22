---
name: receipt-verifier
description: "Verify freshly executed demo write receipts against exchange history without replaying writes."
stage: executor
role: guardrail
requires: [okx-cex-trade]
risk_level: medium
writes: false
always_on: false
triggers: [receipt, verify, verification, reconcile, demo-execute]
entrypoint: ./run.js
consumes: [execution.intent-bundle]
produces: [operations.receipt-verification]
preferred_handoffs: [operator-summarizer]
repeatable: true
artifact_version: 3
contract_version: 1
safety_class: read
determinism: medium
proof_class: structural
standalone_command: "trademesh skills run receipt-verifier \"<run-id>\" --plane demo --input .trademesh/runs/<run-id>/artifacts.json"
standalone_route: [receipt-verifier]
standalone_inputs: [run-id]
standalone_outputs: [operations.receipt-verification]
required_capabilities: [okx-cli, market-read, account-read]
---

# Receipt Verifier

Verifies whether demo execute receipts are already visible in exchange history and produces a clear verified or reconcile-needed outcome.
