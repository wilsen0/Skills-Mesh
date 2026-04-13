# Skills Mesh Asset Capture Checklist

This document is for turning the current product path into usable presentation assets.

Principle:

> First capture proof clearly. Then record a clean walkthrough.

---

## 1. Current reference run

Latest prepared reference run:

- `run_20260413161549133_031`

This run already supports the core dry-run proof path:

- `plan`
- `apply --proposal perp-short`
- `export`
- `replay --bundle`

If you want fresh assets tomorrow, re-run the same path once and replace the run id.

---

## 2. Screenshots to capture

Capture these first. They are higher value than a long raw screen recording.

### Screenshot 1 — Plan output with recommendation lenses

Command reference:

```bash
node dist/bin/trademesh.js plan "protect BTC downside with 4% max drawdown" --plane demo
```

Capture area:

- `Proposal Ranking`
- `Recommendation Lenses`
- generated `run_<id>`

Must show:

- `Best risk hedge`
- `Best X Layer routing check`
- `Best low-friction demo path`

Suggested filename:

- `01-plan-recommendation-lenses.png`

---

### Screenshot 2 — Apply output with onchainos routing

Command reference:

```bash
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal perp-short --approve --approved-by demo-operator
```

Capture area:

- `Selected Proposal`
- `Policy Verdict`
- `Wallet / On-Chain Routing`
- first `swap execute` line

Must show:

- `Route type: swap-style`
- `Purpose: preview a wallet-aware X Layer route before live execution`
- `Verdict: approved`
- `Wallet: 0x...`
- `Integration: onchainos`
- `onchainos swap execute ...`

Suggested filename:

- `02-apply-onchainos-route.png`

---

### Screenshot 3 — Export artifact paths

Command reference:

```bash
node dist/bin/trademesh.js export <run-id>
```

Capture area:

- export summary block

Must show:

- output dir
- bundle path
- report path
- operator summary path

Suggested filename:

- `03-export-artifacts.png`

---

### Screenshot 4 — Replay recap

Command reference:

```bash
node dist/bin/trademesh.js replay --bundle .trademesh/exports/<run-id>/bundle.json
```

Capture area:

- `Decision Recap`
- `Operator State`
- `Mesh Proof`

Must show:

- `recommendedAction`
- `nextSafeAction`
- `What to take away`

Suggested filename:

- `04-replay-decision-recap.png`

---

## 3. Best recording order

If recording tomorrow, do this in order:

1. open README first screen
2. run `doctor`
3. run `plan`
4. pause briefly on `Recommendation Lenses`
5. run `apply --proposal perp-short`
6. pause on `Wallet / On-Chain Routing`
7. run `export`
8. run `replay --bundle`

Do not start with a long explanation.
Let the product path appear first.

---

## 4. What can be reused as-is

Already prepared by the repo:

- `docs/QUICKSTART.md`
- `docs/USE-CASES.md`
- `docs/BUILDX-DEMO-SCRIPT.md`
- `docs/SUBMISSION-CHECKLIST.md`
- `docs/NEXT-STEPS.md`

Already improved in CLI:

- proposal route-type hints
- recommendation lenses
- apply purpose hints
- policy verdict explanation
- replay decision recap
- Skills Mesh naming cleanup in key surfaces

---

## 5. What still needs manual work tomorrow

These are the parts the agent cannot finish alone.

### A. Real screenshots / recording

- [ ] capture the 4 screenshots above
- [ ] record the short walkthrough video
- [ ] choose terminal font size / window size
- [ ] make sure the framing is readable

### B. Real chain proof surface

- [ ] open the X Layer explorer for tx `0x680198e29d10b538397a90505141417101e7786fccf1991c4c451db8cefb0ed1`
- [ ] capture one explorer screenshot
- [ ] decide whether the explorer link should be shown directly in the demo or only in submission materials

### C. Presentation polish

- [ ] decide whether to use the existing reference run or create a fresh one tomorrow
- [ ] pick the final 90-second cut
- [ ] pick the final 3-minute cut if needed

### D. Optional but useful

- [ ] one screenshot of README first screen
- [ ] one screenshot of `doctor` readiness block
- [ ] one short text file with links: repo / video / tx / post

---

## 6. Suggested command set for tomorrow

```bash
cd ~/apps/apps/okx-skill-mesh
export SKILLS_MESH_AGENT_WALLET=0x2dcb1965ec07932bfaa165b043e0a7dc9b9eaf7e
node dist/bin/trademesh.js doctor --probe active --plane demo --strict --strict-target apply
node dist/bin/trademesh.js plan "protect BTC downside with 4% max drawdown" --plane demo
node dist/bin/trademesh.js apply <run-id> --plane demo --proposal perp-short --approve --approved-by demo-operator
node dist/bin/trademesh.js export <run-id>
node dist/bin/trademesh.js replay --bundle .trademesh/exports/<run-id>/bundle.json
```

---

## 7. If time is very limited

If tomorrow is rushed, do only this:

1. screenshot `plan` with recommendation lenses
2. screenshot `apply` with `Wallet` + `Integration: onchainos` + `swap execute`
3. screenshot explorer tx proof
4. record one short run from `plan` to `replay`

That already captures most of the value.
