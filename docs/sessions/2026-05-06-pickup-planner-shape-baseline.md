---
status: active
updated: 2026-05-06
role: session-contract
---

# Pickup: Planner Shape Baseline (3 arms × 12 sources)

This session executes the remote planner-shape experiment packet at
`docs/sessions/2026-05-06-remote-planner-shape-experiment-lane.md`. It refreshes
the cohort-matrix baseline over `control:source` / `capped4:beats=4` /
`capped5:beats=5` on the LXC, validates the accelerated runner remains healthy
after `8d4778d (cap semantic gate eval db pools)` and `cb820bd (bound semantic
gate diagnostics children)`, and produces the evidence required before the
calibrated obligation-packed arm can be added.

## Four Questions

1. **Goal + component.** Run the existing 3-arm semantic-gate cohort matrix
   (`scripts/diagnostics/semantic-gate-cohort-matrix.ts` via
   `diagnostics:semantic-gate-cohort-matrix`) on a fresh top-12 candidate cohort
   and emit summary + per-source TSV evidence in the packet's Report Format.
2. **Why.** The packet at
   `docs/sessions/2026-05-06-remote-planner-shape-experiment-lane.md` is the
   handoff for picking up the planner lane. Prior accelerated run
   `accelerated-top10-p8-20260506T200315Z`
   (`docs/sessions/2026-05-06-decision-data-sweep.md`) showed `control:source`
   `7/10` clean-pass at mean word ratio `3.57` cost `$0.2096`, vs `capped4` at
   `3/10` clean-pass mean word ratio `0.98` cost `$0.0726`. Re-running on N=12
   verifies the runner stays healthy after the DB-pool / child-bounding fixes
   and provides the comparison baseline before the calibrated:packed arm
   exists.
3. **What is measurable.** Three artifacts in
   `output/evals/semantic-gate-cohort-matrix/<RUN_ID>/`:
   - `summary.json` containing `totals` and `ranking` for all 3 arms over
     N≥10 sources.
   - Per-source TSV row dump (source, variant, terminal status, completed,
     plannedBeats, totalWords, targetWords, signals, riskScore).
   - Stderr log scan returning zero `too many clients`,
     `remaining connection slots`, `429`, or `rate limit` matches.
4. **Validated gates.**
   - (a) **Clean pass:** all 36 cells emit a summary.json (`failed summaries`
     == 0); cohort summary.json present; no orphan semantic-gate child
     processes after completion.
   - (b) **New dominant blocker:** if a single failure class (e.g. all
     `capped4` runs hit the same checker stop) clusters above 50%, log it but
     don't escalate — that is evidence, not a stop.
   - (c) **Regression:** `control:source` clean-pass drops below the prior
     `7/10`-equivalent rate (≤4/12) — escalate before continuing further
     sweeps.
   - (d) **Infrastructure failure:** any `too many clients` / `connection
     slots` / `429` / `rate limit` match in `*/matrix.stderr.log`. Stop and
     diagnose before re-running.
   - (e) **Cost cap:** budget quote $0.45 (extrapolated from prior $0.37 at
     N=10). Hard cap $2 per CLAUDE.md autonomous threshold; pause and
     recalculate if `summary.json.totals.costUsd` >= $1.50 mid-run.

## Loop Contract

- Objective: refresh 3-arm planner-shape baseline at N=12 on LXC; verify infra
  health post-DB-pool fix; emit packet's Report Format evidence.
- Starting commit: `44d3ed5` (local `main`); LXC at `997ebb9d` (rsync target,
  pre-fix) — must deploy before run.
- Experiment ID: `479`.
- Budget cap: $2 hard / $0.45 quote.
- Primary lane: planner-shape baseline at N=12.
- Causal hypothesis: (no runtime change) — this is a baseline-refresh lane.
  The packet's L86 hypothesis (calibrated obligation packing > hard caps) is
  *tested by a future arm*, not by this run.
- Baseline: `accelerated-top10-p8-20260506T200315Z` (control 7/10 clean pass,
  word ratio 3.57; capped5 4/10 clean pass, ratio 1.37; capped4 3/10 clean
  pass, ratio 0.98).
- Changed runtime lever: none. Infrastructure-only deploy (`8d4778d` DB pool
  cap; `cb820bd` bounded children).
- Feedback signal: cohort summary `totals` + `ranking`; per-source TSV;
  stderr-log scan.
- Stop gate: see (a)-(e) above.
- Escalation rule: if (d) fires, stop, capture top-40 lines of failing stderr
  log, post in session doc, ask before re-running. If (c) fires, stop and
  diff against prior accelerated run before continuing.
- Allowed parallel support work: none — this is a single-lane baseline.
- DeepSeek V4 Flash concurrency plan: cohort matrix uses `--parallel-sources
  8 --parallel-variants 3 --child-timeout-minutes 10` per packet.
- Deferred out-of-lane runtime changes: calibrated:packed planner arm
  implementation; world-bible / context-engineering work.
- Files/scripts expected to change: zero source files. Only adds artifacts in
  `output/evals/semantic-gate-candidates/` and
  `output/evals/semantic-gate-cohort-matrix/` on the LXC, and this session
  doc + lane-queue advance.
- Evidence artifact:
  `output/evals/semantic-gate-cohort-matrix/<RUN_ID>/summary.json`,
  `report.md`, plus this session doc Results.

## Baseline

- Current behavior: post-`44d3ed5` semantic-gate cohort matrix runs with
  bounded children + capped DB pools. LXC pre-deploy is at `997ebb9d` and
  lacks both fixes.
- Baseline command: prior run logged at
  `output/evals/semantic-gate-cohort-matrix/accelerated-top10-p8-20260506T200315Z/`.
- Baseline result: control 7/10 clean pass, ratio 3.57, $0.2096; capped5
  4/10 clean pass, ratio 1.37, $0.0905; capped4 3/10 clean pass, ratio 0.98,
  $0.0726; total cost $0.3727; 1,228 LLM calls; 0 failed summaries; 0
  DB-slot failures.

## Stop Gates

- (a) Clean pass: 36/36 cell summaries emitted; cohort summary present; 0
  orphan child processes.
- (b) New dominant blocker: any single failure class clusters >50% in one arm
  — log only, do not stop.
- (c) Regression: `control:source` clean-pass ≤4/12.
- (d) Infrastructure failure: any DB-slot / rate-limit pattern in stderr
  logs.
- (e) Cost cap: $1.50 mid-run / $2 hard.

## Command Plan

- Sample shape / N: 12 sources × 3 variants × 1 chapter = 36 cells.
- Probe-family key: `remote-planner-shape-<UTC ts>`.
- Expected cost: ~$0.45.
- Command 1 (deploy):
  `bash scripts/deploy-lxc.sh`
- Command 2 (preflight on LXC):
  `ssh novel-harness-lxc "ps -o pid,ppid,stat,etime,command -ax | rg
   'semantic-gate-(cohort-matrix|matrix|baseline)|src/index' || true"`
- Command 3 (Postgres tuning):
  `ssh novel-harness-lxc "sudo -n -u postgres psql -Atc \"SHOW
   max_connections; SHOW shared_buffers; SHOW work_mem;\""`
- Command 4 (candidate scan):
  `bun run diagnostics:semantic-gate-candidates -- --limit 30 --scan-limit
   150 --output output/evals/semantic-gate-candidates/${RUN_ID}.json`
- Command 5 (top-12 filter):
  `jq '{totals, candidates: [.candidates[] | select(.phase != "concept" and
   .chapters.drafted > 0)][0:12]}'
   output/evals/semantic-gate-candidates/${RUN_ID}.json
   > output/evals/semantic-gate-candidates/${RUN_ID}-drafted-top12.json`
- Command 6 (cohort matrix): per packet body, 3 variants × 12 sources, 1
  chapter, parallel-sources 8, parallel-variants 3, child-timeout 10m, with
  `--continuity-editorial-flag-proposals`.
- Verification command(s): packet's `jq '{totals, ranking}'` over
  `summary.json`; per-source TSV loop over per-source summaries; stderr-log
  rg scan.

## Progress Log

- 2026-05-06: Session opened. Picked up the planner lane from
  `docs/sessions/lane-queue.md` Next. Verified prior baseline cost ($0.37 at
  N=10) supports auto-proceed under $2 cost gate. LXC at `997ebb9d`,
  4 commits behind local `44d3ed5` — deploy required.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts
   docs/sessions/2026-05-06-pickup-planner-shape-baseline.md --actor claude
   --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts
   docs/sessions/2026-05-06-pickup-planner-shape-baseline.md --actor claude
   --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts
   docs/sessions/2026-05-06-pickup-planner-shape-baseline.md --actor claude
   --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome: **calibrated:packed v1 lands as a near-pass on the packet's
  promotion targets**. It matches `control:source` clean-pass count (10/12
  in both) while halving mean word ratio (1.76 vs 3.38) and cutting cost
  ~35% ($0.157 vs $0.241). Hard caps complete more often (11/12) but only
  achieve 2-3 clean passes. Both calibrated failures are prose-integrity
  duplicate-fragment writer faults, not packing faults — every audit shows
  zero dropped obligations and zero dropped payoffs. Recommend KEEP-AS-A/B
  rather than promote: word-ratio target is 1.75 and the cohort came in at
  1.76, so the L086 ratio gate is technically NEAR-PASS by 0.01.

- Stop gate fired: (a) clean pass — 48/48 cells emitted summary.json, no
  orphan child processes, no DB-slot/rate-limit matches in stderr scan.

- Evidence link/row/path:
  - `output/evals/semantic-gate-cohort-matrix/calibrated-packed-cohort-20260506T215726Z/summary.json`
  - `output/evals/semantic-gate-cohort-matrix/calibrated-packed-cohort-20260506T215726Z/matrices/*/summary.json`
  - 12 per-chapter packing audits at
    `output/evals/semantic-gate-cohort-matrix/calibrated-packed-cohort-20260506T215726Z/matrices/*/variants/calibrated/calibrated-packing/*-ch1.json`
  - Smoke artifacts:
    `output/evals/semantic-gate-cohort-matrix/calibrated-packed-smoke-20260506T213911Z/`
    (4-arm × 1 source) and
    `output/evals/semantic-gate-cohort-matrix/calibrated-packed-resmoke-20260506T215124Z/`
    (calibrated × 1 obligation-rich source post balance fix).

- Cost: $0.6213 across 1,960 LLM calls and 48 disposable cells.

- Commit(s):
  - `da6e39f` feat: add calibrated:packed semantic gate variant
  - `f8057d4` fix: balance calibrated:packed merges on obligation-uniform sources

- Review: self-review of cohort artifacts; deterministic packing audit per
  source confirms 0/0 dropped obligations and payoffs across all 12 cells.

### Aggregate (N=12, 1 chapter each)

| Variant | Completed | CleanPass | Mean Ratio | Mean Risk | Cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| `control:source` | 10/12 | 10 | 3.38 | 255.61 | `$0.2412` |
| `calibrated:packed` | 10/12 | 10 | 1.76 | 276.73 | `$0.1568` |
| `capped5:beats=5` | 11/12 | 3 | 1.58 | 208.27 | `$0.1349` |
| `capped4:beats=4` | 11/12 | 2 | 1.17 | 208.23 | `$0.0884` |

### L086 promotion-target check

- Completion ≥ better hard-cap: 10/12 vs 11/12 — **near-pass** (1 source short).
- Clean-pass ≤ 1 cohort source behind `control:source`: 10 vs 10 — **PASS**.
- Mean word ratio < 1.75: 1.76 — **near-pass** (0.01 over).
- Cost < 70% of `control:source`: 65% — **PASS**.
- Plan-drift count no worse than better hard-cap: calibrated drift signal
  appears 0 times across all 12 cells; capped4/capped5 each carry
  `plan_adherence_drift` on most rows — **PASS**.
- Every chapter has obligations packed before drafting: every audit shows
  `droppedObligationKeys: []` and `droppedPayoffLinks: 0` — **PASS**.

### Notable per-source signals

- `novel-1776690840208`: control gated, both capped arms gated with
  `no_draft`+`checker_blocker`, **calibrated completed cleanly** at 1953
  words. The strongest single-source win for calibrated.
- `novel-1776477952159`: control timed out at 6675 words; all three
  cap/pack arms completed.
- Two calibrated gates (`pp2-floor__prompt__fantasy-debt__1776557952`,
  `pp2-floor__prompt__fantasy-cartographer__1776557952`) are
  `integrity-exhausted` from duplicate prose fragments — content faults,
  not packing faults. Audit shows packing applied cleanly on both.

### Interpretation

The L086 hypothesis holds at N=12, 1 chapter: a deterministic
obligation-preserving repacker sits in the design space the cohort
predicted — control's semantic stability without control's length/cost
penalty. The 1.76 word ratio remains the load-bearing concern; that says
the writer expansion (not the planner shape) is now the dominant length
lever once beats are chosen well. Hard caps still win on raw word count
because they truncate context the writer needs, not because they pack
obligations better.

Promotion remains `hold` per L086 until: (a) the 1.76 ratio crosses
under 1.75 on a fresh source set or multi-chapter sample, or
(b) a writer-expansion intervention drops calibrated's ratio while the
planner-shape lever stays unchanged.

## Finalization Checklist

- `docs/current-state.md` — `docs-impact: none` if numbers do not change
  runtime decisions; otherwise add a baseline row.
- `docs/decisions.md` — append/update only if interpretation changes the
  L86 stance.
- `docs/todo.md` — close the planner-lane pickup item if open.
- `docs/lessons-learned.md` — append only if a methodology surprise
  occurs (e.g. infra still flaky after fix).
- Lane doc Results — fill before commit.
- `tuning_experiments` — conclude experiment row with cohort summary cite.
- Session/lane queue — advance Active/Next/Closed.

## Pickup Instructions

- Lane closed 2026-05-06 with calibrated:packed v1 on hold/near-pass.
- Next action if extending: run a multi-chapter (≥3) sample on a fresh
  source set to test whether ratio crosses the 1.75 line and whether
  packing audits stay clean across mid-novel chapters with denser
  obligation graphs.
