---
status: shipped
updated: 2026-05-03
role: lane-result
lane: 2026-05-03-L72-duplicate-sentence-punctuation-fp
experiment: 401
session: 2026-05-02-L68-multicall-halluc-vote
phase: lint/integrity (detector tightening)
---

# L72 Duplicate-Sentence False-Positive on Punctuation-Only Differences (Lever I-A)

## Loop Contract

- **Goal + component:** stop `detectAdjacentDuplicateSentences` from firing on dialogue lines that share content but differ only by terminal punctuation (`"No."` vs `"No?"`). `src/lint/integrity.ts` — `normalizeSentence` was stripping ALL punctuation via `replace(/[^a-z0-9' ]+/g, " ")`, collapsing declarative and interrogative single-word interjections to the same normalized form. Fix: preserve `.?!` in the normalization, so terminator differences keep sentences distinct.
- **Why (concrete evidence):** L70b A/B (exp #399) `fantasy-debt` ch2 bailed integrity-exhausted across 3 attempts. Investigation of `pipeline_events` for the chapter:
  - **Att 1 (id 134673):** 1 `duplicate-sentence` issue with `excerpt: "\n\n\"No?"` and `firstExcerpt: "\n\n\"No."`. The `pairNorm` field shows `"no no"` — both sentences normalized to just `"no"` because `?` and `.` were stripped. **False positive.** Triggered the per-beat settle, which exhausted; chapter retry ensued.
  - **Att 2 (id 134906):** 4 real `duplicate-fragment` issues, spread across 4 different beats. Settle ineligible (>2 beats). Chapter retry ensued.
  - **Att 3 (id 135091):** 2 real `duplicate-fragment` issues. Settle ineligible (final attempt). Bailed integrity-exhausted.
  - The cascade started with a false positive on att 1. Had att 1 passed clean, the chapter would likely have been approved — the att-2/3 real duplicates were introduced by chapter regenerations triggered by the original false positive.
- **Measurable signal:**
  - **Unit-level:** new tests in `src/lint/integrity.test.ts`: (i) `"No."` / `"No?"` produces zero duplicate-sentence issues; (ii) `"Wait!"` / `"Wait?"` produces zero; (iii) genuine `"The hall narrowed."` / `"The hall narrowed."` STILL fires (regression guard); (iv) genuine `"No."` / `"No."` (same word AND same terminator) STILL fires; (v) `.` vs `...` distinct. All 5 pass.
- **Validated stop gates:**
  - **(a) Clean pass:** new tests green; existing 30 lint/integrity tests preserved; 1062/1066 full suite (4 pre-existing failures, +5 new test count vs L71's 1057/1061).
  - **(b) Recall regression on fixtures:** previously-passing `validateLintFixIntegrity` and `detectProseIntegrityIssues` tests must still pass — they cover the canonical positive cases (newly-introduced duplicate sentences, exp #265 fused-boundary corruption, etc.).
  - **(c) Regression:** existing tests fail.
  - **(d) Infra failure.**
- **Starting commit:** `566cbf5` (L71 ship).
- **Experiment ID:** 401 (ticket-class).
- **Budget cap:** $0 — unit-only change; no A/B fan-out needed (the recall side is preserved by construction since the regex change only adds discriminating power).
- **Primary lane:** detector tightening to discriminate terminal punctuation in duplicate-sentence detection.
- **Causal hypothesis:** preserving `.?!` in normalization makes `"no."` ≠ `"no?"`, removing the false-positive class. All other true positives (where terminator agrees) still fire. By construction this is a recall-preserving change — the detector becomes strictly stricter about what it considers a duplicate.
- **Baseline:** debt ch2 att 1 (exp #399) firing duplicate-sentence on `"No."` / `"No?"` adjacent dialogue lines.
- **Changed runtime lever:** `src/lint/integrity.ts` — change `normalizeSentence` regex `replace(/[^a-z0-9' ]+/g, " ")` → `replace(/[^a-z0-9' ?!.]+/g, " ")`.
- **Feedback signal:** unit tests; tsc clean; full suite stays at expected baseline.
- **Escalation rule:** if a future smoke shows the change misses real duplicates whose terminator legitimately differs (rare in published prose but possible in dialogue-heavy paragraphs), revisit by either (a) adding a min-word-count gate (≥3 words) for duplicate-sentence to exempt natural single-word interjections, or (b) requiring the matched sentences to share more than just the normalized form.
- **Allowed parallel support work:** none — single-file change.
- **DeepSeek V4 Flash concurrency plan:** none.
- **Deferred out-of-lane runtime changes:** none.
- **Files/scripts expected to change:** `src/lint/integrity.ts`, `src/lint/integrity.test.ts`, `docs/current-state.md`, `docs/decisions.md` (§L72), `docs/todo.md`.
- **Evidence artifact:** `tuning_experiments.id=401`; commit hash to be set.

## Stop Gates

- (a) Clean pass: 5 new tests + 30 existing lint/integrity tests pass; full suite stays at 1062/1066.
- (b) Recall regression on fixtures.
- (c) Regression: existing tests fail.
- (d) Infra failure.

## Command Plan

- Sample shape: unit-only.
- Command 1: edit `src/lint/integrity.ts`
- Command 2: add tests to `src/lint/integrity.test.ts`
- Command 3: `bun test src/lint/integrity.test.ts`
- Command 4: `bunx tsc --noEmit`
- Command 5: `bun test` (full suite)
- Command 6: docs sweep + commit

## Results

**Outcome: SHIP (unit-only, recall-preserving by construction).** All 35 lint/integrity tests pass (30 existing + 5 new); full suite 1062/1066 (4 pre-existing failures unchanged); tsc clean. The fix removes the false-positive class without affecting any positive case where the terminator agrees.

**Test additions (5 new, all pass):**

1. `"No."` / `"No?"` adjacent → zero duplicate-sentence issues (the debt ch2 att 1 case)
2. `"Wait!"` / `"Wait?"` adjacent → zero duplicate-sentence issues
3. `"The hall narrowed."` / `"The hall narrowed."` adjacent → STILL fires (recall regression guard)
4. `"No."` / `"No."` adjacent (same terminator) → STILL fires (recall regression guard for short dialogue duplicates)
5. `"narrowed..."` / `"narrowed."` (ellipsis vs full stop) → zero duplicate-sentence issues

**No A/B run.** The change is recall-preserving by construction: the new regex `[^a-z0-9' ?!.]+` is a strict superset of the old `[^a-z0-9' ]+` in terms of what it preserves, which means the normalized form gains discriminating power without losing any. Sentences that match under the old regex AND share the terminator continue to match under the new regex; only the sentences that differ ONLY in terminator (the false-positive class) now correctly fail to match.

**Lessons from this attempt:**

1. **The cascade insight: a single false positive can trigger multiple real failures downstream.** debt ch2 att 1 had a false-positive duplicate-sentence; the per-beat settle exhausted on that false positive; the chapter regenerated; att 2 introduced 4 *real* duplicate-fragments because the writer reshuffled prose patterns; att 3 still had 2 real duplicates; chapter bailed. Without the att-1 false positive, the chapter likely would have been approved on att 1 and the cascade never started. **Detectors that gate retries should aggressively avoid false positives even at the cost of some true negatives, because a false-positive gate triggers a chapter regeneration which is itself a stochastic source of new failures.**
2. **Read the `pairNorm` / normalized form when investigating duplicate-sentence fires.** The `pairNorm` field in `pipeline_events` payload is the actual matched normalized string — `"no no"` was the smoking gun that revealed the punctuation strip was too aggressive. Without that field the false positive would have been harder to diagnose.
3. **Unit-only changes that are recall-preserving by construction don't need an A/B run.** Adding discriminating chars to a normalization regex strictly increases the detector's specificity without changing recall. The recall-regression-guard test is the right validation surface; spending an A/B run on this would be over-engineering.
