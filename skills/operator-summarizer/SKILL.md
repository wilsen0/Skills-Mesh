---
name: operator-summarizer
description: "Build a unified operator summary used by replay/export and operational decisions."
stage: memory
role: memory
requires: [okx-cex-trade]
risk_level: low
writes: false
always_on: false
triggers: [operator, summary, replay, export]
entrypoint: ./run.js
consumes: [approval.ticket, execution.idempotency-check, execution.reconciliation]
produces: [report.operator-summary]
preferred_handoffs: [replay]
repeatable: true
artifact_version: 3
standalone_command: "trademesh skills run operator-summarizer \"<goal>\" --plane demo"
standalone_route: [operator-summarizer]
standalone_inputs: [goal]
standalone_outputs: [report.operator-summary]
required_capabilities: []
---

# Operator Summarizer

Produces one canonical operator snapshot for replay/export and next-step operations.
