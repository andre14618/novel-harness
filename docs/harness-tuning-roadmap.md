---
status: active
updated: 2026-04-30
---

# Harness Tuning Roadmap

Single-page view of what's in flight, what's queued, and what's parked across the harness — corpus mining, planner-prompt variants, writer-layer ablations, and checker work. **Living doc** — update each row as work moves through the pipeline.

Concluded architectural decisions live in `docs/decisions.md`; pending action items live in `docs/todo.md`. This roadmap is the matrix view that ties them together with current status.

## How work moves through the pipeline

```
mine                →  pattern / signal extracted from corpus or run output
map                 →  pattern tied to a specific prompt / schema field / pipeline lever
draft variant       →  the alternative phrasing or config that encodes the pattern
probe               →  $0.30 phase-eval (planner) or full-novel sample (writer/checker)
cross-book / scale  →  reproduces qualitatively in a 2nd book / scales beyond pilot N
ship / hold / pivot →  variant lands, holds for more evidence, or kills
```

## Ship gate framing (load-bearing — re-read before defining new gates)

The user's standing rule (2026-04-30): **≥ 90% confident a pattern reproduces qualitatively is sufficient to ship as a planner prior.** Tight quantitative CIs are NOT required. Heavy statistical reads are diminishing-returns past book 2 or 3.

Math reference (binary proportions at p≈0.5):
- 1 book, n≈34 chapters → 95% CI ±17% (range 33–67% on a 50% point estimate)
- 2 books → ±12%
- 3 books → ±10%
- 11+ books → ±5%

Translation: cross-book validation is HIGH-VALUE for the binary "does the pattern reproduce" test (one additional book is enough to discriminate "Salvatore quirk" vs "author/genre pattern"). It's LOW-VALUE for tight quantitative priors. The current planner-prompt rules are already consistent with the wide n=34 CI; cross-book mostly answers reproduction, not precision. Don't gate variant ship decisions on CI tightness.

Anchor stability gates for stochastic-schema dims (separate from pattern-shipping): J ≥ 0.85 Sonnet self-consistency at BOTH calibration-anchor AND production-emit granularities, validated at full population (n=50 is screening only). See `docs/decisions.md` 2026-04-30 SOPs.

## Currently in flight (2026-04-30)

| Work | Status | Notes |
|---|---|---|
| Voice-shaping ablation v1 synthesis (Sonnet subagent) | running | Run completed 2026-04-21 (20 beats × 4 arms, $0.0221); decomposed audit + results doc was never produced. Subagent is locating outputs, running the audit per `docs/charters/voice-shaping-ablation-v1.md`, writing `docs/charters/voice-shaping-ablation-v1-results.md`, deciding SHIP/HOLD/KILL per arm. |
| Crystal Shard new-dim mining (Sonnet subagent) | running | Pure-aggregation pass on 6 unmined dims: POV management, character-introduction pacing, setting-change frequency, dialogue density variation, tension/pacing curve, sensory-channel distribution (best effort). Zero LLM cost. Output: timestamped JSONs + conclusions doc session entry + commit. |

When both land: the corpus dim catalog grows from 7 to ~12-13 patterns; voice-shaping verdict shapes the writer-layer roadmap.

## Active queue — non-mice corpus patterns (planner-prompt variants)

Identified in the Crystal Shard chapter-level structural session (2026-04-30 ~02:05 UTC). Each maps to a specific prompt edit. None depends on the stuck mice rubric.

| # | Pattern | Harness target | Variant drafted? | Probe run? | Cross-book? | Verdict |
|---|---|---|---|---|---|---|
| 1 | Length: median 2,534w / 24 beats; default action-fantasy `targetWords ≈ 2500`. Beat-count expectation `targetWords / 100` (current floor `/ 150` is too low). | `chapter-outline-system.md` `targetWords` band guidance | needs `PLANNING_PLOTTER_PROMPT_OVERRIDE` seam first | — | — | DRAFT |
| 2 | Beat kind distribution: action 36% / dialogue 28% / interiority 21% / description 15%. | `beat-expansion-system.md` kind-balance soft prior | — | — | — | DRAFT (lower priority) |
| 3 | Opener kind: 50% description, 26% action, 15% interiority, 9% dialogue. Closer kind: 41% action, 35% interiority, 21% dialogue, 3% description. | `chapter-outline-system.md` opener/closer guidance | needs plotter seam | — | — | DRAFT |
| 4 | Within-chapter rhythm: descriptive setup → dialogue mid-peak → action/interiority climax. Description front-loads (q0=25% → q4=9%); dialogue mid-peaks (q0=18% → q2=38% → q4=30%). | `beat-expansion-system.md` position-specific guidance | — | — | — | DRAFT |
| 7 | Beat boundary signals: pov_attention_shift 22% / stakes_recalibration 17% / scene_start 16% / action_shift 15% / speaker_change 13% / narration_to_dialogue 11%. | `beat-expansion-system.md` transition vocabulary as soft prior | — | — | — | DRAFT |
| (TBD) | New dims from in-flight subagent — placeholder rows added when mining lands | — | — | — | — | PENDING SUBAGENT |

**Sequencing (revised 2026-04-30):**

1. Wait for in-flight subagents to land (voice-shaping verdict + new-dim catalog).
2. Add `PLANNING_PLOTTER_PROMPT_OVERRIDE` env-var seam to `src/agents/planning-plotter/index.ts` (mirrors the existing planning-beats seam from commit `a031980`). Small code addition; unblocks Patterns 1 + 3 probes.
3. Draft variants for Patterns 3 + 4 + 7 first (existing `PLANNING_BEATS_PROMPT_OVERRIDE` supports them via beat-expansion edits — actually 3 needs the plotter seam since opener/closer guidance is plotter-side; Patterns 4 + 7 are beat-expansion).
4. Cross-book wave on Streams of Silver covering existing 7 patterns + new dims + voice-shaping reference, in ONE batch (more efficient than per-pattern cross-book).
5. Land winners as defaults per the 90%+ qualitative-reproduction gate; document the per-pattern verdict in `docs/decisions.md`.

## Schema-shipped soft priors (live, on `sceneBeatSchema`)

All optional / default-empty; checkers MUST NOT block on these fields. Status reflects 2026-04-30 anchor-stability findings.

| Field | Schema state | Anchor stability | Notes |
|---|---|---|---|
| `valueShifted` (binary) | shipped | scene 0.887–0.923 / beat 0.852 | Stable. Replaces 3-class `valueShift` (J=0.639). Commit `c48a232`. |
| `gapPresent` (binary) | shipped w/ caveat | scene 0.818 NEAR / beat pending | Rubric sharpen queued. Commit `42745ce`. |
| `lifeValueAxes` (5 binary) | shipped | beat 0.852–0.961 (all 5) | Stable at beat. agency / aspiration IMPROVED scene→beat. Commits `c48a232` + `cd4347a`. |
| `miceActive=["I"]` | shipped | beat n=50: 0.887 / scene n=139: **0.313 FAIL** | n=50 wave was sample-underpowered. See parked. Commit `cd4347a`. |
| `miceOpens=["M","I"]` | shipped | beat n=50: 0.887–0.961 / scene n=139: **0.10–0.36 FAIL** | Same. Commit `cd4347a`. |
| `miceCloses=["M","I","C","E"]` | shipped | beat n=50: 0.887–1.000 / scene n=139: **0.14–0.75 FAIL** | Same. Commit `cd4347a`. |

Mice fields are SAFE in production (soft priors, no checker gates) but not eligible to back planner-prompt priors until rubric stability is recovered at full corpus.

## Other harness-quality work (non-corpus)

These are the items the user pointed out as the actual production-quality bottleneck — corpus tuning matters less than these for current output quality.

| Work | Status | Why this matters | Estimate |
|---|---|---|---|
| Voice-shaping ablation v1 synthesis | in flight | Writer-layer signal — does prompt-level voice shaping ship a candidate, or confirm the LoRA-track-pivot was correct? | (subagent in flight) |
| Halluc-checker v3 production fire-rate report follow-up | pending | Production fires: ungrounded 46.7%, leak 15.7%, retry clearance 9–28%. Retry-wording fix shipped 2026-04-20; needs re-measurement. | Half-day re-eval |
| Tier 1B writer-visible threading | pending | Most "planner-side state" doesn't reach the writer (terrain survey, exp #264). Bulk facts injection + worldExpansionBudget + priorBeatEstablishedFacts via getFactsUpToChapter. | Multi-day code change |
| Salvatore v5 corpus expansion charter | DRAFT, gated | Distinctness improvements via Legacy of the Drow corpus. Pre-gate: PDFs on disk. | (gated) |
| Speaker-directives V1b (per-beat) | gated on V1a pilot | Context-engineering item. | Half-day after gate |

## Parked / blocked (mice + adjacent)

| Item | Why parked | Gate to unpark |
|---|---|---|
| Pattern 5: chapter-level mice rhythm | Underlying mice rubric J<0.85 at full corpus | Rubric sharpen + beat-level full-corpus pass land |
| Pattern 6: opens/closes per chapter | Same | Same |
| `chapter-outline-system.md` plotter prompt re-cut with mice priors | Same | Same |
| Beat-level full-corpus mice extraction | Awaiting rubric sharpen first | Sharpened v2 mice prompt |
| v2 mice rubric sharpen on opens / dominant | Lower lift than non-mice patterns for current single-book quality | Concrete unparking signal (TBD — see "Why mice stays parked" below) |
| Promise dim Sonnet self-consistency | Sub-dim split (arc-promise + setup-payoff-bridge) not yet tested | Single-book quality bottleneck cleared OR series-engineering becomes a real near-term commitment |
| McKee-gap rubric sharpen | `gapPresent` at scene-level J=0.818 NEAR | Same |
| Streams of Silver / Halfling's Gem / Storm Front | Methodology + dim catalog not locked | New-dim mining lands; cross-book wave then covers everything |

## Why mice stays parked (revised 2026-04-30)

Per-beat mice tags are soft priors with no checker gates. For current single-book harness tuning, they produce lower measurable lift than the non-mice corpus patterns (1 / 3 / 4 / 7) and the current production-quality work (voice-shaping, halluc-checker re-eval, writer-visible threading). That's the full justification for deferral.

Earlier drafts of this roadmap tied mice's "comes back" to multi-book series engineering. **Walked back 2026-04-30:** series engineering is a future state, not a current priority — single-book quality is the live bottleneck. A deferral doesn't need a future-rationale; "lower lift than alternatives now" is sufficient. Mice rubric work might be unparking-triggered by something concrete later (e.g., a downstream feature that needs stable per-scene thread tagging), or it may stay parked indefinitely. That's fine.

## Charters & briefs (the controlling docs)

- `docs/charters/corpus-structural-decomposition-v1.md` — Bucket 1 charter for the broader corpus mining program
- `docs/designs/decomposed-extractor-sonnet-anchor-v1.md` — v2 architecture design (Sonnet anchor + decomposed extractors)
- `docs/cross-book-cross-author-brief.md` — cross-book validation methodology
- `novels/salvatore-icewind-dale/structure-calibration/crystal_shard-conclusions.md` — append-only Crystal Shard analysis log (~2000 lines, 10+ session entries)
- `docs/designs/phase-variant-comparison.md` — phase-eval probe scaffold charter (R1–R5)
- `docs/charters/voice-shaping-ablation-v1.md` — writer-layer ablation (synthesis in flight)
- `docs/decisions.md` 2026-04-30 entries — concluded SOPs (binary-collapse-before-relabel, granularity-aware ship gates, sceneBeatSchema soft-prior expansion, chapter-level structural patterns)

## Update protocol

- When a variant prompt is drafted: fill the "Variant drafted?" cell with the path/commit.
- When a probe runs: fill "Probe run?" with G1-G4 deltas + commit.
- When cross-book validation lands: fill "Cross-book?" with the verdict.
- When a pattern ships / holds / pivots: update "Verdict" and add a `docs/decisions.md` entry.
- When parked items unpark: move them to the active queue with the unparking rationale.
- When in-flight work lands: move from the "Currently in flight" table to wherever it belongs.
