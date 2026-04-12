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

### Design principle: targeted rewrite over blind regeneration

The current retry loop throws away prose and regenerates from scratch. The beat writer has no idea what was wrong. This is the primary cause of the 60% retry-exhaustion rate — it's rolling the dice again, not fixing a known issue.

The ground-truth eval revealed a second problem: many "failures" are **alignment offsets** — the beat's content IS in the chapter, just rendered in an adjacent beat's prose block. This is natural prose flow (scenes don't break cleanly at beat boundaries). Blind regeneration can't fix this because the beat writer doesn't know what the adjacent beat already covered.

**Core change:** On adherence failure, pass the existing prose + specific issues back to the beat writer as a **targeted rewrite** instead of regenerating from scratch. The writer keeps its optimized beat-level context (beat spec, transition bridge, landing target, character snapshots) and adds:
1. The prose it already wrote
2. The specific failure: "Beat events not enacted: Nadia crushing the card is missing"
3. For alignment offsets: "Note: the previous beat's prose already covered [X] from your beat spec — cover the remaining actions without duplicating"

This stays entirely at beat level. No architecture change to the writer, no chapter-level rewrite path.

### Phase 1: Ship new events prompt + merge character into events

**Change:** Replace the old events prompt with the validated new one (+16pp). Fold the character call's unique signal (attribution) into it. Drop from 4 LLM calls to 3 per beat.

**New events+attribution prompt** adds one line to the validated new events prompt:
```
- Each action must be performed by the character the beat assigns it to.
  If the beat says Character A does something but the prose has Character B
  do it, the action is NOT correctly enacted.
```

**Expected impact:**
- Events accuracy: 93% baseline, attribution check adds coverage for the 2 swap cases (only unique signal the character call provided)
- Removes the 87% character call entirely — eliminates its FP contribution to the compound rate
- Compound FP with 3 calls at 5% each: `1 - 0.95^3 = 14.3%` (down from 18.5% with 4 calls)
- Saves ~25% of adherence LLM cost per beat

**Validation:** Re-run the 30-pair eval with the merged prompt via subagents before shipping.

### Phase 2: Tiered retry gates

**Change:** Not all flags should trigger a beat rewrite. Introduce severity tiers:

| Call | Gate | Rationale |
|---|---|---|
| Events+attribution | **Hard** — targeted rewrite | Core signal: beat not enacted or wrong character. Writer can fix this with directed feedback. |
| Setting | **Soft** — log, don't retry | Setting mismatches are rare and often inherited from prior beats. Mid-chapter beats don't re-establish setting. |
| Tangent | **Soft** unless off_spec_fraction > 0.7 | Mild tangent (30-60% off-spec) is often atmospheric expansion. Only severe drift warrants a rewrite. |

**Expected impact:**
- Only events+attribution triggers retries → compound FP drops to the single-call rate (~5-7%)
- Setting and tangent still run (signal preserved for monitoring and chapter-level gating) but don't trigger beat rewrites
- Beat first-attempt pass rate should rise from 19% to ~80%+

### Phase 3: Targeted rewrite on beat failure

**Change:** Replace the blind retry loop in `drafting.ts` with a targeted rewrite. On adherence failure:

1. Collect specific issues from the events+attribution check (e.g., "missing action: Nadia crushes the card")
2. Pass to the beat writer as additional context alongside the existing prose:
   ```
   Your previous prose for this beat:
   ---
   {previous prose}
   ---
   Issues found:
   - {issue 1}
   - {issue 2}
   Rewrite this beat to address the issues above while preserving what works.
   ```
3. For alignment offsets (detected when the previous beat's prose covers current beat's actions), add:
   ```
   The previous beat's prose already covers: {summary of covered actions}
   Focus on the remaining actions that are not yet dramatized.
   ```

**Files changed:** `src/phases/drafting.ts` (beat retry loop), `src/agents/writer/beat-context.ts` (context assembly for retry)

**Expected impact:**
- Retries converge because the writer knows exactly what to fix
- Alignment offsets handled explicitly rather than triggering blind regeneration
- Should reduce retry-exhaustion rate from 60% to <20% (the writer model is capable; it just needs feedback)

### Phase 4: Narrow chapter plan checker scope

**Change:** Remove `beats_covered` and `characters_present` from the chapter plan checker. These are redundant with beat-level events+attribution and deterministic character presence.

**Keep in chapter plan checker:**
- `emotional_arc_correct` — cross-beat property, can only be assessed at chapter level
- `setting_match` — chapter-level spatial coherence (catches issues that beat-level soft-gated setting missed)
- Major plot contradictions — cross-beat arc reversals

The chapter plan checker becomes focused on what only it can see: arc direction and cross-beat coherence. It serves as a safety net for setting/tangent issues that were soft-gated at beat level.

### Phase 5: Validation convergence fix

The 66→63→58 rewrite pattern means the rewriter creates nearly as many issues as it fixes. Two potential causes:

1. **Rewriter introduces new lint issues** — rewriting for structural problems creates new AI clichés. Fix: run lint on rewriter output before re-validating.
2. **Rewriter fixes one issue, breaks another** — e.g., fixing word count by padding introduces tangent. Fix: pass all open issues to rewriter in a single call so it can balance constraints.

**Investigation needed:** Query which issues appear AFTER a rewrite that weren't present before. This requires comparing pre- and post-rewrite issue sets per chapter.

---

## Implementation Order

| Step | Change | Risk | Effort | Files |
|---|---|---|---|---|
| 1 | Ship new events prompt | Low — +16pp validated | Small | `adherence-checker.ts` |
| 2 | Write + validate merged events+attribution prompt | Low | Eval run | subagent eval |
| 3 | Remove character call, wire events+attribution | Low | Small | `adherence-checker.ts` |
| 4 | Tiered gates: setting/tangent → soft | Medium | Small | `adherence-checker.ts` |
| 5 | Targeted rewrite on beat failure | Medium | Medium | `drafting.ts`, `beat-context.ts` |
| 6 | Narrow chapter plan checker scope | Medium | Small | `plan-adherence-system.md`, `schema.ts` |
| 7 | Investigate validation convergence | Research | DB queries | — |
| 8 | Re-label training data with merged prompt, train V4 adapter | High effort | Large | Full pipeline |

**Batch 1 (ship together, low risk):** Steps 1-4. Reduces beat LLM calls from 4→3, makes setting/tangent non-blocking. Validate with a 3-chapter romance-drama run.

**Batch 2 (medium risk, highest impact):** Step 5. Targeted rewrite is the key architectural change — this is what breaks the 60% retry-exhaustion pattern. Validate with a full novel run comparing retry rates before/after.

**Batch 3 (independent):** Steps 6-7. Chapter-level deduplication and validation convergence investigation.

**Batch 4 (depends on all above):** Step 8. Re-label training data only after the merged prompt and targeted rewrite are validated in production.

---

## Appendix: Eval Data

Ground truth and prompted evaluation results for 30 production pairs are at:
- `/tmp/eval-results/all_ground_truth.json`
- `/tmp/eval-results/all_prompted.json`
- Input pairs: `/tmp/eval-pairs-30.json`
- Per-batch files: `/tmp/eval-results/batch_{0-9}_{gt,prompted}.json`
