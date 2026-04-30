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

(none — all subagents from this session landed)

## Recently landed (2026-04-30)

| Work | Outcome | Commit |
|---|---|---|
| Crystal Shard new-dim mining (6 dims) | Subagent over-delivered: ran on **all 3 Icewind Dale books** (Crystal Shard / Streams of Silver / Halfling's Gem), so cross-book validation is **already done** for these new patterns. Highest-leverage findings: tension curve (action density 1.56× first→second half across all 3 books; penultimate act is action peak, final 20% dips back), character-introduction pacing (57% of named entities in first 30% of chapters; 3.5 new/chapter early, 0–1 late), POV rotation (77% rotation rate at chapter boundaries). Sensory dim flagged as low-signal (no planner implication at regex resolution). | `192026b` |
| Voice-shaping ablation v1 synthesis | **KILL on all 3 prompt-shaping arms (D1/D2/D3 all FLAT vs D0 bare DeepSeek baseline).** D0 was already 0.39–0.89σ from Salvatore reference on 3/5 features — no room for prompt shaping to add value. Notable: D2 (few-shot with Salvatore excerpts in the prompt) had 0/20 halluc-leak fires vs the v4 Salvatore LoRA's ~15% — Salvatore in the prompt doesn't leak; Salvatore in the weights does. Corroborates the LoRA-track pivot framing. Next experiment named: character-distinctness audit on D3-style directive prompts. | `3c4f40b` |
| `PLANNING_PLOTTER_PROMPT_OVERRIDE` env-var seam | Mirrors the planning-beats seam. Unblocks Patterns 1 + 3 for variant probing. | `e4343f7` |

## Active queue — non-mice corpus patterns (planner-prompt variants)

Identified in the Crystal Shard chapter-level structural session (2026-04-30 ~02:05 UTC). Each maps to a specific prompt edit. None depends on the stuck mice rubric.

| # | Pattern | Harness target | Variant drafted? | Probe run? | Cross-book? | Verdict |
|---|---|---|---|---|---|---|
| 1 | Length: median 2,534w / 24 beats; default action-fantasy `targetWords ≈ 2500`. Beat-count expectation `targetWords / 100` (current floor `/ 150` is too low). | `chapter-outline-system.md` `targetWords` band guidance | UNBLOCKED — plotter seam shipped `e4343f7` | — | — | DRAFT |
| 2 | Beat kind distribution: action 36% / dialogue 28% / interiority 21% / description 15%. | `beat-expansion-system.md` kind-balance soft prior | — | — | — | DRAFT (lower priority) |
| 3 | Opener kind: 50% description, 26% action, 15% interiority, 9% dialogue. Closer kind: 41% action, 35% interiority, 21% dialogue, 3% description. | `chapter-outline-system.md` opener/closer guidance | UNBLOCKED — plotter seam shipped `e4343f7` | — | — | DRAFT |
| 4 | Within-chapter rhythm: descriptive setup → dialogue mid-peak → action/interiority climax. Description front-loads (q0=25% → q4=9%); dialogue mid-peaks (q0=18% → q2=38% → q4=30%). | `beat-expansion-system.md` position-specific guidance | — | — | — | DRAFT |
| 7 | Beat boundary signals: pov_attention_shift 22% / stakes_recalibration 17% / scene_start 16% / action_shift 15% / speaker_change 13% / narration_to_dialogue 11%. | `beat-expansion-system.md` transition vocabulary as soft prior | — | — | — | DRAFT |
| 8 | **Tension curve / pacing rhythm** (highest-leverage): action density 1.56× first→second half across all 3 IWD books. Penultimate act is the action peak, NOT the final chapters — Crystal Shard final 20% dips back to 34% action vs second-half mean of 38%. Concrete pacing-curve shape. | `beat-expansion-system.md` + `chapter-outline-system.md` chapter-position pacing guidance | — | — | **DONE (3 books)** | DRAFT |
| 9 | **Character introduction pacing**: 57% of 105 named entities in first 30% of chapters. Mean 3.5 new/chapter early, taper to 0–1 late. 12 characters first appear in last 20% of beats. | `chapter-outline-system.md` per-chapter new-character budget | UNBLOCKED — plotter seam shipped `e4343f7` | — | **DONE (3 books)** | DRAFT |
| 10 | **POV rotation**: chapter-primary POV rotates at 77% of chapter boundaries (omniscient 30% + Drizzt 26% own 56% of beats together). HIGH-frequency rotation, not occasional. | `chapter-outline-system.md` POV-character guidance — current planner says "Protagonist should hold POV for most chapters; rotate only when a different perspective is load-bearing." Salvatore data argues for more permissive rotation. | UNBLOCKED — plotter seam shipped `e4343f7` | — | **DONE (3 books)** | DRAFT |
| 11 | **Setting-change frequency**: 3.1 scene-level setting changes per chapter (CS); only 10% monolocation. Streams of Silver diverges (29% monolocation — its dungeon-crawl structure). Author-level pattern with intra-author variance. | `chapter-outline-system.md` permissive multi-location guidance | UNBLOCKED — plotter seam shipped `e4343f7` | — | **DONE (3 books, with variance)** | DRAFT (lower priority due to intra-author variance) |
| 12 | **Dialogue density variance**: 29.5% mean per chapter (CS), high variance std=0.176; 2/3 chapters ≥25% dialogue. Likely overlaps Pattern 2 in implementation. | (subsumed by Pattern 2 — kind balance) | — | — | DONE | NOTE — fold into Pattern 2 |
| 13 | Sensory channel distribution: visual + kinesthetic ~79% combined; olfactory near-zero (regex proxy). | (no planner implication at this resolution) | — | — | — | DROP — descriptive only |

**Sequencing (revised 2026-04-30, post-subagents):**

1. ✅ Subagents landed (voice-shaping verdict + new-dim catalog with cross-book on 3 IWD books).
2. ✅ Plotter seam shipped (`e4343f7`).
3. **Now: draft variants for the highest-leverage patterns.** Top 3 by lift × cross-book confidence:
   - **Pattern 8 (tension curve)** — concrete pacing shape, validated on 3 books, both planner-side and beat-expansion-side levers
   - **Pattern 9 (character intro pacing)** — concrete per-chapter budget, validated on 3 books
   - **Pattern 1 (chapter length / beat-count expectation)** — touches the same plotter prompt as Pattern 9 so they can A/B together
4. Phase-eval probe each variant. Cross-book is ALREADY satisfied for new dims (Patterns 8 / 9 / 10 / 11) — for the older Patterns 1–7, current 1-book evidence is fine for binary qualitative ship per the 90%+ rule.
5. Land winners as defaults; document per-pattern verdict in `docs/decisions.md`.

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
| Voice-shaping ablation v1 synthesis | **DONE 2026-04-30** | KILL on all 3 prompt-shaping arms. Decisions entry committed `3c4f40b`. Next experiment named: character-distinctness audit on D3-style directive prompts (Sonnet quote-required pairwise). | — |
| Character-distinctness audit (named follow-on from voice-shaping KILL) | NEW — pending | Whether D3-style per-character directives produce measurably distinct dialogue voices on a Sonnet quote-required pairwise audit. Tests whether directive-heavy prompts add value at the *character* level even when they don't move the *narrator-voice* metric. | ~$5–10 |
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
