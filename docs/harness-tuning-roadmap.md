---
status: active
updated: 2026-04-30
---

# Harness Tuning Roadmap

Single-page view of what we're evaluating, what's measurable, where each pattern lands. **Living doc** — update each row as variants are drafted, probed, and shipped.

This doc tracks the corpus-pattern → harness-prompt pipeline. Concluded architectural decisions live in `docs/decisions.md`; pending action items live in `docs/todo.md`. This roadmap is the matrix view that ties them together.

## How a pattern moves through the pipeline

```
corpus mining          →  pattern validated on Salvatore Crystal Shard reference
harness mapping        →  pattern tied to a specific prompt or schema field
variant prompt drafted →  the alternative phrasing that encodes the pattern
phase-eval probe       →  $0.30, minutes — default vs variant, G1-G4 directional read
cross-book validation  →  ±5-10% reproduction on Streams of Silver / Halfling's Gem
ship / hold / pivot    →  variant lands as default, holds for more evidence, or kills
```

**Probe scaffold:** `scripts/phase-eval/` (commits `a031980` + `c6ef9a5` + `9de6a78` + `d024ce8`). G1=facts/chapter, G2=knowledge transfers/chapter, G3=beats/chapter, G4=state changes/chapter. SCREEN-PASS = directional movement above the charter R5 thresholds.

**Anchor stability gates** (per `docs/decisions.md` 2026-04-30 SOPs): J ≥ 0.85 Sonnet self-consistency at BOTH calibration-anchor and production-emit granularities, validated at full population (n=50 is screening only).

## Active queue — non-mice corpus patterns

These were identified in the Crystal Shard chapter-level structural session (2026-04-30 ~02:05 UTC, conclusions doc). All four are corpus-validated independent of the stuck mice rubric.

| # | Pattern (Crystal Shard reference) | Harness target | Variant drafted? | Probe run? | Cross-book? | Verdict |
|---|---|---|---|---|---|---|
| 1 | Length: median 2,534w / 24 beats; mean 2,647w; range 394–8,113w. Default action-fantasy `targetWords ≈ 2500`. Beat-count expectation `targetWords / 100` (current floor `/ 150` is too low). | `chapter-outline-system.md` `targetWords` band guidance | — | — | — | DRAFT |
| 2 | Beat kind distribution: action 35.9% / dialogue 28.2% / interiority 20.6% / description 15.2%. | `beat-expansion-system.md` kind-balance soft prior | — | — | — | DRAFT |
| 3 | Opener kind: 50% description, 26% action, 15% interiority, 9% dialogue. Closer kind: 41% action, 35% interiority, 21% dialogue, 3% description. (Current planner rule "open w/ action or description; close w/ action or interiority; never close on pure description" is empirically validated — reinforce with corpus citation.) | `chapter-outline-system.md` opener/closer guidance | — | — | — | DRAFT |
| 4 | Within-chapter rhythm: descriptive setup → dialogue mid-peak → action/interiority climax. Description front-loads (q0=25% → q4=9%); dialogue mid-peaks (q0=18% → q2=38% → q4=30%); action steady ~35–40%; interiority flat ~21%. | `beat-expansion-system.md` position-specific guidance | — | — | — | DRAFT |
| 7 | Beat boundary signals: pov_attention_shift 22% / stakes_recalibration 17% / scene_start 16% / action_shift 15% / speaker_change 13% / narration_to_dialogue 11%. (4-and-7 are gap-numbered — Patterns 5 + 6 are mice-dependent and parked.) | `beat-expansion-system.md` transition vocabulary as soft prior | — | — | — | DRAFT |

**First move:** draft variants 1 + 3 (highest-leverage on planner-side; both touch chapter-outline-system.md so they can A/B together). Probe against `fantasy-system-heretic` (already tested on the loud variant — clean SCREEN-PASS baseline). Cross-book validate by running `chapter-level-structural.ts` on Streams of Silver before landing.

## Schema-shipped soft priors (live)

Current state of `sceneBeatSchema` corpus-derived fields. All optional / default-empty; checkers MUST NOT block on them. Status reflects 2026-04-30 anchor-stability findings.

| Field | Schema state | Anchor stability | Notes |
|---|---|---|---|
| `valueShifted` (binary) | shipped | scene 0.887–0.923 / beat 0.852 | Stable. Replaces 3-class `valueShift` (J=0.639). Commit `c48a232`. |
| `gapPresent` (binary) | shipped w/ caveat | scene 0.818 NEAR / beat pending | Rubric sharpen queued (next move). Commit `42745ce`. |
| `lifeValueAxes` (5 binary) | shipped | beat 0.852–0.961 (all 5 axes) | Stable at beat granularity. agency / aspiration improved scene→beat. Commit `c48a232` + `cd4347a`. |
| `miceActive=["I"]` | shipped | beat n=50: 0.887 / scene n=139: **0.313 FAIL** | n=50 wave was sample-underpowered. See parked. Commit `cd4347a`. |
| `miceOpens=["M","I"]` | shipped | beat n=50: 0.887–0.961 / scene n=139: **0.10–0.36 FAIL** | n=50 wave was sample-underpowered. See parked. Commit `cd4347a`. |
| `miceCloses=["M","I","C","E"]` | shipped | beat n=50: 0.887–1.000 / scene n=139: **0.14–0.75 FAIL** | n=50 wave was sample-underpowered. See parked. Commit `cd4347a`. |

The mice fields are SAFE in production (soft priors, no checker gates), but are not eligible to support a planner prior in `chapter-outline-system.md` until rubric stability is recovered at full corpus.

## Parked / blocked

| Item | Why parked | Gate to unpark | Estimated cost |
|---|---|---|---|
| Pattern 5: chapter-level mice rhythm (E 56% / C 18% / M 12% / I 3% openers and closers) | Underlying mice rubric J<0.85 at full corpus | Rubric sharpen + beat-level full-corpus pass | $8 + half-day |
| Pattern 6: opens/closes per chapter (mean 2.44 / 1.00; threads accumulate across chapters) | Same — depends on mice rubric stability | Same | Bundled with Pattern 5 |
| `chapter-outline-system.md` plotter prompt re-cut with mice priors | Same | Same | Bundled |
| Beat-level full-corpus mice extraction | Awaiting rubric sharpen first (binary collapse already done; rubric polish is the canonical next step on FAIL) | Sharpened v2 mice prompt | $8 + half-day |
| v2 mice rubric sharpen on opens / dominant | Lower priority for single-book harness tuning | Series-engineering work begins (multi-book commitment) | Rubric edit + test wave |
| Promise dim Sonnet self-consistency | Sub-dim split (arc-promise + setup-payoff-bridge) not yet tested | Split sub-prompts + n=50 probe | $5–10 |
| McKee-gap rubric sharpen | `gapPresent` at scene-level J=0.818 NEAR | Sharpened rubric + n=50 retest | $3 |
| Streams of Silver Stage 6 | Methodology not yet locked on Crystal Shard | Patterns 1 / 3 / 4 / 7 probed AND landed; or rubric sharpen lands | $3 + 30 min |
| Halfling's Gem cross-book validation | Same | Streams of Silver landed | $3 + 30 min |
| Storm Front (Butcher) cross-author probe | Same; cross-genre signal expectation: I-thread should dominate | Salvatore intra-author validation lands | $15 acquisition + $2 extraction |

## Why mice work comes back later

Single-book harness tuning: mice tags are soft priors with no checker gates → lower lift than Patterns 1 / 3 / 4 / 7. Defer.

Multi-book series engineering (the commercial unlock per memory `project_series_engineering_vision`): mice-thread tracking across books would be load-bearing for cross-book character-arc continuity, thread-debt accounting (opens in book N must close by book N+M), and narrative-spine alignment between volumes. Mice is also the highest-rubric-latitude dim across the 5 R7 dims — the methodological proof that decomposed Sonnet anchor + binary collapse + granularity rotation generalizes to hard rubrics. Rubric stability becomes the entry-gate to series engineering.

## Charters & briefs (the controlling docs)

- `docs/charters/corpus-structural-decomposition-v1.md` — Bucket 1 charter for the broader corpus mining program
- `docs/designs/decomposed-extractor-sonnet-anchor-v1.md` — v2 architecture design (Sonnet anchor + decomposed extractors)
- `docs/cross-book-cross-author-brief.md` — cross-book validation methodology
- `novels/salvatore-icewind-dale/structure-calibration/crystal_shard-conclusions.md` — append-only Crystal Shard analysis log (~2000 lines, 9+ session entries)
- `docs/designs/phase-variant-comparison.md` — phase-eval probe scaffold charter (R1–R5 with adversary review)
- `docs/decisions.md` 2026-04-30 entries — concluded SOPs (binary-collapse-before-relabel, granularity-aware ship gates, sceneBeatSchema soft-prior expansion, chapter-level structural patterns)

## Update protocol

- When a variant prompt is drafted: fill the "Variant drafted?" cell with the path/commit.
- When a probe runs: fill "Probe run?" with the result summary (G1-G4 deltas) + commit.
- When cross-book validation lands: fill "Cross-book?" with the verdict.
- When a pattern ships / holds / pivots: update "Verdict" and add an entry to `docs/decisions.md`.
- When parked items unpark: move them to active queue with rationale.
