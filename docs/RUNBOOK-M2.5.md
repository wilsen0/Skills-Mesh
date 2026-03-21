# TradeMesh M2.5 Runbook

This runbook covers supervised execution operations for `v3` runtime and artifacts.

## 1. Pre-Apply Execute Checklist

1. Verify runtime health:
   - `node dist/bin/trademesh.js doctor --probe active --plane demo`
2. Verify candidate run:
   - `node dist/bin/trademesh.js replay <run-id>`
3. Verify selected proposal is actionable and policy approved.
4. Execute with explicit approval:
   - `node dist/bin/trademesh.js apply <run-id> --plane demo --proposal <name> --approve --approved-by <operator> --execute`
5. If blocked by idempotency/reconcile, do not rerun execute directly.

## 2. Live Supervised Execute Checklist

1. Active live probe must be fresh (<= 15 min):
   - `node dist/bin/trademesh.js doctor --probe active --plane live`
2. Execute with all required live flags:
   - `node dist/bin/trademesh.js apply <run-id> --plane live --proposal <name> --approve --approved-by <operator> --live-confirm YES_LIVE_EXECUTION --max-order-usd <n> --max-total-usd <n> --execute`
3. If `operations.live-guard` is `blocked`, follow `nextAction` and retry only after remediation.

## 3. Reconcile Procedure

Use reconcile when latest apply execute reports `pending`/`ambiguous` or operator summary requires reconcile.

1. Auto mode (client-id first, then fallback):
   - `node dist/bin/trademesh.js reconcile <run-id> --source auto --window-min 120`
2. Force client-id mode:
   - `node dist/bin/trademesh.js reconcile <run-id> --source client-id`
3. Force fallback mode:
   - `node dist/bin/trademesh.js reconcile <run-id> --source fallback --window-min 60`
4. Re-check operator state:
   - `node dist/bin/trademesh.js replay <run-id>`
5. Export evidence pack:
   - `node dist/bin/trademesh.js export <run-id>`

## 4. Idempotency Ledger Files

- `.trademesh/ledgers/idempotency.v3.snapshot.json`
- `.trademesh/ledgers/idempotency.v3.journal.jsonl`
- `.trademesh/ledgers/idempotency.v3.lock`

## 5. Lock Handling and Recovery

The runtime acquires lock with `O_EXCL`, retries 5 times, and treats locks older than 120s as stale.

If apply is blocked by ledger lock:

1. Ensure no other apply/reconcile process is active.
2. Re-run command once.
3. If lock remains stale and no process is active, remove lock:
   - `rm .trademesh/ledgers/idempotency.v3.lock`
4. Retry apply/reconcile.

## 6. Ledger Corruption Recovery

If ledger files are corrupted or unreadable:

1. Export current evidence first:
   - `node dist/bin/trademesh.js export <run-id>`
2. Backup ledger files:
   - `cp .trademesh/ledgers/idempotency.v3.snapshot.json .trademesh/ledgers/idempotency.v3.snapshot.json.bak`
   - `cp .trademesh/ledgers/idempotency.v3.journal.jsonl .trademesh/ledgers/idempotency.v3.journal.jsonl.bak`
3. Clear lock and rebuild by replaying normal flow:
   - `rm -f .trademesh/ledgers/idempotency.v3.lock`
4. Re-run `reconcile` first, then `apply`.

## 7. Hard Cutover Notes

- Runtime only accepts `RunRecord.version = 3`.
- Runtime only accepts artifact envelopes `version = 3`.
- Old v2 runs are rejected by design; recreate plan/apply/replay/export under current runtime.
