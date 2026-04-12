---
date: 2026-04-12
updated: 2026-04-12
status: shipped
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

| # | Check | Type | Model | Hard gate? | Accuracy | Unique signal? | Status |
|---|---|---|---|---|---|---|---|
| 1 | Character presence | Deterministic | — | Yes | ~99% | Duplicated by chapter plan checker | Live |
| 2 | Word count (40-200% target) | Deterministic | — | Yes | ~99% | Duplicated by chapter validation | Live |
| 3 | Dialogue present (2+ chars) | Deterministic | — | Yes | ~99% | Unique | Live |
| 4 | **Events+attribution** | LLM | V2 LoRA 14B | Yes | **93% (new prompt)** | Core signal | **Shipped** |
| 5 | ~~Setting matches~~ | ~~LLM~~ | — | — | — | 4.3% fire rate, planner-level bug | **Removed** |
| 6 | ~~Tangent detection~~ | ~~LLM~~ | — | — | — | 0 fires in 563 calls | **Removed** |
| 7 | ~~Character behavior~~ | ~~LLM~~ | — | — | — | 6/8 redundant with events | **Removed** |

**Retry logic (after tightening):** 2+ deterministic failures → skip LLM. Single events+attribution call — failure triggers **targeted rewrite** (prose + specific issues passed back to writer). After max retries, accept with warning.

**Compound FP (before):** Four independent calls at 5% FP each → `1 - 0.95^4 = 18.5%` false positive rate per beat.
**Single call (after):** ~5-7% FP rate. Expected first-attempt pass rate: ~80%+ (up from 19%).

### Production data (2026-04-12, 563 calls per agent across 41 novels)

| Agent | Total calls | Fires | Fire rate | Verdict |
|---|---|---|---|---|
| adherence-events | 563 (512 succeeded) | ~81% of beats | — | Core signal, kept |
| adherence-setting | 563 | 24 | 4.3% | Real issues but planner-level — removed |
| adherence-tangent | 563 | 0 | 0% | Zero signal — removed |
| adherence-character | 563 | — | — | 6/8 redundant with events — merged |

**Setting fires are planner bugs:** All 24 setting flags show the planner assigned a setting that the narrative naturally flows away from (e.g., "Drowned Row Gym" → prose in "Statless Hideout", "Ascension Chamber" → prose at "Sea of Static"). The beat writer cannot fix these by rewriting — the scene transition is correct. Tracked as upstream planner issue in `docs/todo.md`.

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

## Redundancy Map (post-tightening)

```
BEAT LEVEL                          CHAPTER LEVEL
──────────                          ─────────────
events+attribution (#4) ─overlaps→  beats_covered in plan checker (#8)
char presence (#1) ──────overlaps→  characters_present in plan checker (#8)
word count (#2) ─────────overlaps→  deterministic validation (#9)
```

Character (#7), setting (#5), tangent (#6) removed. Attribution folded into events. Remaining redundancy is between beat-level events and chapter plan checker's `beats_covered` — addressed in Phase 4 (narrow chapter plan checker scope).

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

### Shipped: Events+attribution prompt + character merger + setting/tangent removal + targeted rewrite

**What shipped (2026-04-12):**

1. **New events+attribution prompt** — requires ALL actions enacted by the correct character (+16pp accuracy). Attribution check folds in the character call's only unique signal (2/30 line attribution swaps).
2. **Character call removed** — 6/8 catches were redundant with events.
3. **Setting and tangent calls removed** — production data showed tangent had 0 fires in 563 calls (zero signal). Setting had 4.3% fire rate but all flags were planner-level bugs (wrong setting assigned to beat) unfixable by the beat writer. Setting coherence tracked upstream in planner — see `docs/todo.md`.
4. **Targeted rewrite** — on events failure, the beat writer receives its previous prose + specific issues instead of a generic "try again" note. Replaces blind regeneration.

**Net result:** 4 LLM calls → 1 per beat. Compound FP rate drops from 18.5% to ~5-7%. Cost savings: ~75% of adherence LLM spend.

**Files changed:** `src/agents/writer/adherence-checker.ts`, `src/phases/drafting.ts`, `models/roles.ts`

### Remaining: Narrow chapter plan checker scope

Remove `beats_covered` and `characters_present` from the chapter plan checker — redundant with beat-level events+attribution and deterministic character presence.

**Keep in chapter plan checker:**
- `emotional_arc_correct` — cross-beat property, only assessable at chapter level
- `setting_match` — chapter-level spatial coherence
- Major plot contradictions — cross-beat arc reversals

### Remaining: Validation convergence fix

The 66→63→58 rewrite pattern means the rewriter creates nearly as many issues as it fixes. Two potential causes:

1. **Rewriter introduces new lint issues** — rewriting for structural problems creates new AI clichés. Fix: run lint on rewriter output before re-validating.
2. **Rewriter fixes one issue, breaks another** — e.g., fixing word count by padding introduces tangent. Fix: pass all open issues to rewriter in a single call so it can balance constraints.

**Investigation needed:** Query which issues appear AFTER a rewrite that weren't present before.

### Remaining: Re-label training data

Re-label 7,540 pairs with the new events+attribution prompt once validated in production. Train V4 adapter on W&B.

---

## Appendix: Eval Data

Ground truth and prompted evaluation results for 30 production pairs are at:
- `/tmp/eval-results/all_ground_truth.json`
- `/tmp/eval-results/all_prompted.json`
- Input pairs: `/tmp/eval-pairs-30.json`
- Per-batch files: `/tmp/eval-results/batch_{0-9}_{gt,prompted}.json`
