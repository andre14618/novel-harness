---
date: 2026-04-12
status: active
---

# Retry Surface Audit & Tightening Plan

## Executive Summary

The pipeline's quality checks are over-firing. **60% of beats exhaust all 3 retry attempts.** Only 19% pass on the first try. Validation barely converges (66→63→58 rewrites across 3 passes). The root cause is overlapping checks with independent false-positive rates that compound — any single flag from 4 parallel LLM calls triggers a full beat rewrite, and beat-level checks duplicate chapter-level checks.

This report maps every check that can trigger a rewrite, identifies redundancies and accuracy gaps from a 30-pair ground-truth eval (2026-04-12), and proposes a tightening plan.

---

## Production Retry Rates

Source: `llm_calls` and `validation_passes` tables. Corpus: 41 novels, 187 approved chapters, 194 unique beats.

### Beat-level retries (adherence checker)

| Metric | Value |
|---|---|
| Beats passing on first attempt | **37/194 (19%)** |
| Beats needing 2 attempts | 41/194 (21%) |
| **Beats exhausting all 3 attempts** | **116/194 (60%)** |
| Avg adherence calls per beat | 2.9 (max 3) |
| Total adherence LLM calls | 2,252 (563 × 4 call types) |

60% of beats are written 3 times. The adherence checker fires on the majority of first-attempt prose, and the beat writer often cannot fix the flagged issue on retry — suggesting the flags are either false positives or issues the writer model cannot resolve.

### Chapter-level retries

| Check | Total calls | Unique chapters | Calls/chapter |
|---|---|---|---|
| Chapter plan checker | 177 | 77 | 2.3 |
| Continuity (facts+state) | 246 | ~77 | 3.2 |

### Validation convergence (across all novels)

| Pass | Passed | Rewritten | Has issues |
|---|---|---|---|
| 1 | 95 | 66 | 13 |
| 2 | 14 | 63 | 13 |
| 3 | 20 | 58 | 12 |

Rewrites decline only 12% per pass (66→63→58). The rewriter is introducing new issues at nearly the same rate it fixes old ones. 12 chapters remain stuck after 3 passes.

### Issue distribution

- **95 blockers**, **1,119 warnings**
- Top warnings are all lint AI-cliché patterns ("The silence stretched," "Something shifted between them," "The air between them charged") — these are non-blocking and auto-fixed by the lint system
- Blockers come from validation deterministic checks (word count, POV) and continuity

---

## Full Retry Surface Map

### Beat level — per beat, before chapter assembly

| # | Check | Type | Model | Hard gate? | Accuracy | Unique signal? |
|---|---|---|---|---|---|---|
| 1 | Character presence | Deterministic | — | Yes | ~99% | Duplicated by chapter plan checker |
| 2 | Word count (40-200% target) | Deterministic | — | Yes | ~99% | Duplicated by chapter validation |
| 3 | Dialogue present (2+ chars) | Deterministic | — | Yes | ~99% | Unique |
| 4 | **Events enacted** | LLM | V2 LoRA 14B | Yes | **77% old / 93% new** | Core signal |
| 5 | **Setting matches** | LLM | V2 LoRA 14B | Yes | ~95% (est.) | Unique but low fire rate |
| 6 | **Tangent detection** | LLM | V2 LoRA 14B | Yes | ~90% | Unique |
| 7 | **Character behavior** | LLM | V2 LoRA 14B | Yes | **87%** | **6/8 redundant with events** |

**Retry logic:** 2+ deterministic failures → skip LLM. Any LLM flag → retry up to `maxBeatRetries=2` (3 total attempts). After max retries, accept with warning.

**Compound FP problem:** If each LLM call has a 5% false-positive rate (conservative), four independent calls give: `1 - 0.95^4 = 18.5%` chance of at least one false positive per beat. This alone explains why 81% of beats fail their first attempt.

### Chapter level — after beat assembly

| # | Check | Type | Model | Hard gate? | Unique signal? |
|---|---|---|---|---|---|
| 8 | Chapter plan checker | LLM | gpt-oss-120b (Groq) | Yes | `beats_covered` redundant with #4; arc direction/emotional trajectory unique |
| 9 | Deterministic validation | Heuristic | — | Yes (blockers) | Word count + POV duplicated with #1/#2; keyword coverage unique |
| 10 | Continuity (facts) | LLM | Qwen 235B (Cerebras) | Warning in draft, blocker in validation | Fully unique (cross-chapter) |
| 11 | Continuity (state) | LLM | Qwen 235B (Cerebras) | Blocker | Fully unique (cross-chapter) |

### Post-approval — non-blocking

| # | Check | Type | Model | Triggers retry? |
|---|---|---|---|---|
| 12 | Lint detection (26 regex patterns) | Deterministic | — | No, auto-fixed |
| 13 | Lint fixing | LLM | Qwen 235B (Cerebras) | No |
| 14 | Tonal pass | LLM | V4 LoRA 14B (W&B) | No (currently disabled) |

---

## Redundancy Map

```
BEAT LEVEL                          CHAPTER LEVEL
──────────                          ─────────────
events (#4)  ────overlaps────→  beats_covered in plan checker (#8)
character (#7) ──overlaps────→  events (#4) — 6 of 8 catches shared
char presence (#1) ──overlaps→  characters_present in plan checker (#8)
word count (#2) ──overlaps───→  deterministic validation (#9)
```

The character LLM call (#7) is the weakest link: 87% accuracy, 6/8 of its catches are redundant with events. Its unique contribution is 2/30 pairs (line attribution swaps where the right event happens but the wrong character performs it).

---

## Ground-Truth Eval Results (2026-04-12)

30 production beat/prose pairs, ground truth established by careful independent evaluation, then tested with old vs new prompts.

### Events prompt

| Prompt | Accuracy | FP | FN | Error pattern |
|---|---|---|---|---|
| **Old** (production) | 77% (23/30) | 7 | 0 | Passes partially-enacted beats — "the beat's action" (singular) misses multi-action beats |
| **New** (revised) | **93% (28/30)** | 1 | 1 | Catches 6/7 partial enactments. One overcorrection. |

**Old prompt failure mode:** Says "the beat's action happens" (singular focus) when only 1 of 3 specified actions appear. The new prompt explicitly requires ALL actions.

### Character prompt

| Prompt | Accuracy | FP | FN | Error pattern |
|---|---|---|---|---|
| **Old** (production) | 87% (26/30) | 0 | 4 | Misses 50% of real contradictions — "only flag clear contradictions" is too permissive |
| **New** (4-check) | 83% (25/30) | 5 | 0 | Catches all contradictions but over-flags absence/omission that events already catches |

**Old prompt failure mode:** "Only flag clear contradictions" causes FN on subtle issues (line attribution swaps, dynamic inversions). **New prompt failure mode:** PRESENCE check fires on characters missing from prose — but this is already caught by events_present=false. The new prompt's scope overlaps with events.

### Character call unique contribution

Of 8 ground-truth character contradictions, events_present=false already catches 6. The character call's unique catches:

| ID | Issue | Events catches it? |
|---|---|---|
| 5 | Mabel/Rosa line attribution swap | No — events are present, wrong person says the line |
| 19 | Nadia/Jem "Not terrible" swap | No — events are present, wrong person says the line |

Both are **line attribution swaps**: the action happens, but the wrong character performs it.

---

## Tightening Plan

### Phase 1: Merge events + character, ship new events prompt

**Change:** Merge the character call into events. Drop from 4 LLM calls to 3 per beat.

**New events+attribution prompt** adds one line to the validated new events prompt:
```
- Each action must be performed by the character the beat assigns it to.
  If the beat says Character A does something but the prose has Character B
  do it, the action is NOT correctly enacted.
```

**Expected impact:**
- Events accuracy: 93% baseline, attribution check adds coverage for the 2 swap cases
- Removes the 87% character call entirely — eliminates its FP contribution to the compound rate
- Compound FP with 3 calls at 5% each: `1 - 0.95^3 = 14.3%` (down from 18.5%)
- Saves ~25% of adherence LLM cost per beat (1 fewer call × ~256 tokens each)

**Validation:** Re-run the 30-pair eval with the merged prompt via subagents before shipping.

### Phase 2: Tiered retry gates

**Change:** Not all flags should trigger a beat rewrite. Introduce severity tiers:

| Call | Gate | Rationale |
|---|---|---|
| Events+attribution | **Hard** — always retry | Core signal: beat not enacted or wrong character. Writer can fix this. |
| Setting | **Soft** — log, don't retry | Setting mismatches are rare and often inherited from prior beats. Mid-chapter beats don't re-establish setting. Current prompt already accounts for this. |
| Tangent | **Soft** unless off_spec_fraction > 0.7 | Mild tangent (30-60% off-spec) is often atmospheric expansion. Only severe drift (>70%) warrants a rewrite. |

**Expected impact:**
- Only events+attribution triggers retries → compound FP drops to the single-call rate (~5-7%)
- Setting and tangent still run (signal preserved for monitoring) but don't cause rewrites
- Beat first-attempt pass rate should rise from 19% to ~80%+

### Phase 3: Deduplicate beat vs chapter checks

**Change:** Remove `beats_covered` and `characters_present` from the chapter plan checker. These are redundant with beat-level events+attribution and deterministic character presence.

**Keep in chapter plan checker:**
- `emotional_arc_correct` — cross-beat property, can only be assessed at chapter level
- `setting_match` — chapter-level spatial coherence
- Major plot contradictions — cross-beat arc reversals

**Expected impact:**
- Fewer false chapter-level rejections from `beats_covered` re-flagging issues the beat writer already accepted
- Chapter plan checker becomes focused on what only it can see: arc direction and cross-beat coherence

### Phase 4: Validation convergence fix

The 66→63→58 rewrite pattern means the rewriter creates nearly as many issues as it fixes. Two potential causes:

1. **Rewriter introduces new lint issues** — rewriting for structural problems creates new AI clichés. Fix: run lint on rewriter output before re-validating.
2. **Rewriter fixes one issue, breaks another** — e.g., fixing word count by padding introduces tangent. Fix: pass all open issues to rewriter in a single call so it can balance constraints.

**Investigation needed:** Query which issues appear AFTER a rewrite that weren't present before. This requires comparing pre- and post-rewrite issue sets per chapter.

---

## Implementation Order

| Step | Change | Risk | Effort |
|---|---|---|---|
| 1 | Ship new events prompt to `adherence-checker.ts` | Low — +16pp validated | 1 file edit |
| 2 | Write + validate merged events+attribution prompt (subagent eval) | Low — extends step 1 | Eval run |
| 3 | Remove character call, wire events+attribution | Low | `adherence-checker.ts` edit |
| 4 | Add soft gate for setting + tangent | Medium — changes retry behavior | `adherence-checker.ts` + `drafting.ts` |
| 5 | Remove `beats_covered`/`characters_present` from chapter plan checker | Medium — changes chapter gate | `plan-adherence-system.md` + schema |
| 6 | Investigate validation convergence | Research | DB queries + analysis |
| 7 | Re-label training data with merged prompt, train V4 adapter | High effort | Full re-labeling pipeline |

Steps 1-3 can ship together. Step 4 is the highest-impact change for retry rates. Steps 5-6 are independent. Step 7 depends on all prior steps being validated in production.

---

## Appendix: Eval Data

Ground truth and prompted evaluation results for 30 production pairs are at:
- `/tmp/eval-results/all_ground_truth.json`
- `/tmp/eval-results/all_prompted.json`
- Input pairs: `/tmp/eval-pairs-30.json`
- Per-batch files: `/tmp/eval-results/batch_{0-9}_{gt,prompted}.json`
