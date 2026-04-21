---
status: results
kind: experiment-charter-results
name: arm-b-detector-preflight
parent-charter: docs/charters/arm-b-detector-preflight.md
experiment-id: 260
verdict: INCONCLUSIVE
date: 2026-04-21
---

# Results — Arm B Detector Preflight (exp #260)

## Verdict

**INCONCLUSIVE** per charter §3 bullet 1 (adjudicable fires below
8-per-arm floor at the 20-beat cap).

No adjudication was performed. The raw fire counts (below) are small
enough that no possible label pattern could produce adjudicable fires
≥ 8 per arm, so the §3 top-down precedence locks the verdict to
INCONCLUSIVE regardless of TP/FP/UNCLEAR distribution.

## Run

- **Novel:** `novel-1776690960321` (epic-fantasy, 10 approved chapters,
  Salvatore-routed voice LoRA `salvatore-1988-v4`, compact mode universal)
- **Pool:** 10 beats — one mid-chapter beat per chapter, preferring
  `beat.kind === "dialogue"` where available. Selection manifest at
  `output/evals/arm-b-preflight-pool.json`.
- **Baseline:** `output/evals/arm-b-preflight-baseline.json` — 100%
  section recovery yield from stored `llm_calls.user_prompt`.
- **Runner:** `scripts/evals/run-arm-b-preflight.ts`, `set_name =
  arm-b-preflight-v2`, completed 10/10 beats in ~6min wall-clock, zero
  errors, $0.0023 writer cost.
- **Arm A (baseline):** byte-replay of stored production
  `system_prompt` + `user_prompt`. 2 fires on halluc-ungrounded V1
  detector (20% fire rate).
- **Arm B (enriched):** same system_prompt + `insertEnrichedSection`
  into Arm A's recovered `sections[]`. Avg enriched block = 2199
  bytes (SPEAKER DIRECTIVES + READER-INFO STATE + FOCUSED WORLD SLICE).
  3 fires on the detector (30% fire rate).

## The structural flaw

Charter revision 2 (commit `b321dde`, 2026-04-21) rebased the expected
fire rate from V0 (44.9% — exp #254-pre-ship) to V1 (28.9% — exp
#254-shipped). The §3 dynamic stop rule kept the original 8-fire
adjudicable floor and the 20-beat cap.

At 28.9% fire rate:
- 10 beats → ~2.9 fires/arm expected
- 20 beats → ~5.8 fires/arm expected

The §3 8-fire floor cannot be reached at the §8 20-beat cap in
expectation — the two numbers are mathematically incompatible. Codex
rounds 1–6 did not catch this because each round's revalidation was
scoped to the specific blockers it addressed; the floor/cap consistency
check was implicit, not explicit.

The v2 run yielded 2+3 = 5 raw fires total on 10 beats, within the
expected range. Even doubling the pool to the §8 cap would project
6 fires/arm, still below the §3 floor.

## What the preflight infrastructure proved

Independent of the floor/cap incompatibility, the preflight machinery
works end-to-end:

1. **Parity — 100% yield** on all 314 beat-writer rows of the target
   novel (`arm-b-detector-preflight-dryrun-results.md`). The
   header-prefix merge parser + insertion-at-setting-anchor contract
   is correct against live `beat-context.ts:143-229`.
2. **Byte-replay Arm A** reproduces stored production prompts via the
   dedicated `llm_calls.system_prompt` + `user_prompt` columns + the
   model/provider/temperature/max_tokens from dedicated columns (after
   commit `0ff8646` fixed request_json-as-TEXT extraction).
3. **Enriched-context builder** produces non-trivial additive context
   on real beats — avg 2199 bytes, range ~800B–2.6KB, driven primarily
   by SPEAKER DIRECTIVES (~1.3KB) and READER-INFO STATE (~1KB) on
   chapter 3+ beats.
4. **Detector + DB writes** wire cleanly into `eval_results` with
   per-arm `cell_label`. 45 unit tests pass on the pure
   `checkArmBStructure`; 21 unit tests pass on `computeVerdict` and
   `parseLabelsTsv`.

The preflight was not failed by its machinery; it was failed by its
charter's internal math.

## Two bugs fixed during execution

Surfaced only by live execution — neither caught by the 6-round Codex
review nor by the 311-test unit suite:

1. **`llm_calls.request_json` is TEXT not JSONB** (`src/llm.ts:355`
   stringifies on insert; the column was never migrated to JSONB).
   The parity harness read `.model` / `.provider` from a JSON string
   → got undefined → every writer call failed with `def.envKey`
   undefined. v1 run (pid 345291) lost all 20 writer calls to this.
   Fix: commit `0ff8646` — extract envelope from dedicated columns
   (model, provider, temperature, max_tokens), parse request_json
   only for `responseFormat`.
2. **`eval_results.actual_label_json` is JSONB but Bun's pg driver
   returns JSONB as STRING.** The adjudicator's emit partition
   filtered on `!row.actual_label_json.pass` → `!undefined` → true
   for all rows → all 20 classified as fires. Fix: same commit —
   `parseLabelJson()` helper applied at both emit partition and
   packet rendering.

Lesson to memorialize: the Codex-review discipline catches design
contradictions and reproducibility gaps, but it does not catch
driver-level type surprises. Real execution is the only test for
the I/O layer.

## Successor charter — paths forward

The §7 action on INCONCLUSIVE is: "Re-charter with higher-fire-prior
stratum, different detector, or revised adjudication policy." Three
concrete options:

### Option 1 — revision 7: widen the beat cap

Raise §8 beat cap from 20 to ~40. At 28.9% expected yield, 40 beats
produces ~11.6 fires/arm — clears the 8-fire floor with slack. Cost
scales linearly: $0.0023 × 4 = ~$0.01 writer + ~$0.01 detector =
under $0.05 per run. Wall clock ~25 min (sequential W&B Inference).

Cons: needs round 7 Codex review; risks another revision cycle if
Codex flags a new blocker. Doesn't address the underlying question
of whether halluc-ungrounded V1 is the right detector for this
measurement at all.

### Option 2 — switch to a higher-fire-prior stratum

Production-wide V1 fire rate is 28.9% averaged over ALL beats. Stratified
rates are unknown but plausibly higher on chapter-start beats (new
setting descriptions → more entity introductions → more ungrounded
candidates) and lore-heavy beats (world-bible vocabulary exposure).
A query on `eval_cell_summary` by chapter_index or by entity-density
could reveal where the fire rate exceeds 40–50% — enough to clear the
floor at 15–20 beats.

Needs an analysis pass + updated stratification predicate in §6. One
Codex review round. Modest charter churn.

### Option 3 — switch detector

halluc-ungrounded V1 is the detector with the cleanest production
calibration (`beat-entity-list-v1` exp #254), but it's not the only
viable oracle. The adherence-events detector has higher production
fire rate (estimated 10–15% on Salvatore-routed novels from the
2026-04-20 halluc v3 production report) — too low. But combined
adherence + ungrounded + leak has 46.7% production fire rate — above
V0 and above what we need.

Using a COMBINED detector as the preflight oracle changes the
measurement question from "does enriched context preserve halluc-ungrounded
precision" to "does enriched context preserve *aggregated beat-check*
precision." That's arguably a better fit for the replay-ladder-v1
parent charter (which gates on "does enriched context help overall"
not "does it help halluc-ungrounded specifically").

Needs a new charter — not a revision. Largest scope, cleanest answer.

### Recommendation

**Option 1 first** — simplest, preserves the measurement as specified,
cheapest insurance against "the preflight would have worked at a
realistic N." If option 1 still produces ambiguous results, option 3
is the architectural answer.

Option 2 defers a real answer; it's a compromise that may only marginally
clear the floor.

## DB record

- Experiment #260 (`checker_eval`, commit at creation time) — conclusion
  updated to reflect this verdict. See `tuning_experiments.conclusion`.
- `eval_results.set_name = 'arm-b-preflight-v2'` — 20 rows retained
  (10 beats × 2 arms). No `expected_label_json` populated (adjudication
  skipped).
- Pool + baseline + log artifacts on LXC at
  `~/apps/novel-harness/output/evals/` and `/tmp/arm-b-preflight-run-v2.log`.

## Parent charter blocking

`docs/charters/replay-ladder-v1.md` is still RED-blocked pending
either GO from a preflight run OR explicit acknowledgement that the
preflight could not be run at current detector + charter config. This
results memo constitutes the second case. The ladder's §10 should be
updated to cite this memo + the chosen successor-charter option
before any further ladder work.
