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

## Currently in flight (2026-04-30 ~08:15 UTC)

(none — LXC probe landed; see verdict below)

## Recently landed (2026-04-30)

| Work | Outcome | Commit |
|---|---|---|
| LXC phase-eval probe — plotter corpus-v1 vs default | Mixed verdict on 3 chapters: Pattern 1 (length) PASSES — targetWords 2000→3000, beats 49→67. Pattern 3a opener stable. Pattern 3b closer REGRESSED (0/3 vs 2/3 action). Pattern 16 facts density DROPPED (med 4 vs 6 — small sample). Knowledge changes +75% in chapters 2–3. POV rotation (P10) untestable at n=3. Two follow-ups queued: revise closer-kind guidance in plotter variant; re-measure facts density on 5+ chapters. | `c00097b` |
| Pattern 20 (stake-escalation) + Pattern 21 (beat-length uniform NEG) | Pure compute on beats.jsonl. P20 RISES on both within-chapter q0→q4 AND across-book arc early→late in all 3 books — strong NEW ship candidate. P21 NEGATIVE: all 4 beat kinds within 3w of each other — confirms targetWords/100 policy, rules out per-kind length differentiation. | `2cc851f` |
| `planning-beats` prompt/schema enum sync | Prompt advertised `miceActive: ('I'|'C'|'E')[]` and `miceOpens: ('M'|'I'|'E')[]`; schema only accepts `['I']` and `['M','I']`. Schema is correct per anchor-stability research; prompt updated to match. Unblocks LXC probe. | `0c8457d` |
| Per-chapter dramatic-question resolution shape (3 IWD books) | Modal `partial` in all 3 books (CS 44.1%, SoS 62.1%, HG 58.6%; aggregate 54.3%). Distinct from forward-hook chapter-close taxonomy — most rhetorical cliffhangers are structurally `partial` or `replaced`. **Strong NEW ship candidate** (Pattern 19). | `3305e50` |
| Chapter-opener rhetorical shape taxonomy (3 IWD books) | Modal `scene-set-description` in all 3 books (CS 55.9%, SoS 37.9%, HG 41.4%). Refines Pattern 3a; top-3 set stable. **Strong NEW ship candidate** (Pattern 17). | `1aa9d77` |
| Per-chapter primary conflict-type taxonomy (3 IWD books) | Modal `external-physical` in all 3 books (CS 50%, SoS 62%, HG 55%); rotation rate ~55%. **Counter-finding:** 3+-consecutive same-conflict streaks are common (max 11 chapters in CS Kessell siege) — naive "no streaks" rule falsified by the corpus. **Strong NEW ship candidate** (Pattern 18). | `1869a2c` |
| Directional re-score of original 7 cross-book patterns | **APPENDED** (does not replace) the point-estimate verdicts. Under directional gate (ranking / modal class / sign-of-effect): Pattern 2 PASSes (full ranking matches all 3 books), Pattern 3 opener+closer modal classes both stable, Pattern 4 is PARTIAL (action+description sign-of-effect reproduces; dialogue+interiority do NOT), Pattern 7 modal varies but top-4 set stable. Methodological lesson: the ship gate must match the granularity at which the prior is encoded. | `558c344` |
| Forward-hook taxonomy (chapter-close) across 3 IWD books | 83 chapter endings classified. Partial-resolution modal in all 3 books (43.8% / 33.3% / 37.0%); cliffhanger + foreshadow rotate at #2/#3. **3-book directionally stable.** Strong NEW ship candidate. | `dd9c076` |
| Established-facts density across 3 IWD books | Cross-book mean 5.58 / median 5; harness floor (≥6) is AT corpus median. Words-vs-claims correlation 0.348. | `0b640da` |
| Time-cut markers across 3 IWD books | CS 1.13/ch, SoS 2.54/ch, HG 1.28/ch — SoS is genuinely denser (road-trip book). Within-chapter cuts dominate (~70%). Concentrated in middle chapters (q1–q2). | `adce05f` |
| Original 7 chapter-level patterns cross-book validation (point-estimate ±20% gate) | Point-estimate gate: Pattern 1 PASS, Patterns 2/3/4/7 DIVERGE, Patterns 5/6 SKIP (no SoS/HG mice data). See directional re-score above for the planner-relevant view. | `5124750` |
| Beat-expansion variant `corpus-v1.md` | Encodes Patterns 4 + 7 + 8-beat-side. Created BEFORE the directional re-score landed; under the directional gate, the variant is partial-evidence-based (action+description position rhythm holds; dialogue+interiority don't). LXC probe in flight will measure regardless. | `abcd78f` |
| Plotter variant `corpus-v1.md` | Encodes Patterns 1, 9, 10, 8-chapter-side. All are 3-book directionally stable. Solid evidence base. | `15c4145` |
| Probe runner generalized for both planning-beats AND planning-plotter | `--prompt-env=<envvar>` flag; run-variant.ts auto-detects which env var was set. | `a036a15` |
| Crystal Shard new-dim mining (6 dims) | Subagent over-delivered: ran on **all 3 Icewind Dale books** (Crystal Shard / Streams of Silver / Halfling's Gem), so cross-book validation is **already done** for these new patterns. Highest-leverage findings: tension curve (action density 1.56× first→second half across all 3 books; penultimate act is action peak, final 20% dips back), character-introduction pacing (57% of named entities in first 30% of chapters; 3.5 new/chapter early, 0–1 late), POV rotation (77% rotation rate at chapter boundaries). Sensory dim flagged as low-signal (no planner implication at regex resolution). | `192026b` |
| Voice-shaping ablation v1 synthesis | **KILL on all 3 prompt-shaping arms (D1/D2/D3 all FLAT vs D0 bare DeepSeek baseline).** D0 was already 0.39–0.89σ from Salvatore reference on 3/5 features — no room for prompt shaping to add value. Notable: D2 (few-shot with Salvatore excerpts in the prompt) had 0/20 halluc-leak fires vs the v4 Salvatore LoRA's ~15% — Salvatore in the prompt doesn't leak; Salvatore in the weights does. Corroborates the LoRA-track pivot framing. Next experiment named: character-distinctness audit on D3-style directive prompts. | `3c4f40b` |
| `PLANNING_PLOTTER_PROMPT_OVERRIDE` env-var seam | Mirrors the planning-beats seam. Unblocks Patterns 1 + 3 for variant probing. | `e4343f7` |

## Active queue — non-mice corpus patterns (planner-prompt variants)

Identified in the Crystal Shard chapter-level structural session (2026-04-30 ~02:05 UTC). Each maps to a specific prompt edit. None depends on the stuck mice rubric.

**Verdict columns are dual-tracked** per the 2026-04-30 methodology shift:
- **Point-estimate verdict** (±20% rate-reproduction gate) — relevant for *checker-side distributional priors*
- **Directional verdict** (ranking / modal class / sign-of-effect across books) — relevant for *planner-prompt scaffolding*

A pattern can directionally PASS while point-estimate-DIVERGE. The directional verdict is what governs planner-prompt ship decisions; the point-estimate verdict is preserved as evidence trail and as input to any future checker-side priors.

| # | Pattern | Harness target | Variant drafted? | Probe run? | Cross-book? | Point-estimate verdict | Directional verdict (planner-relevant) |
|---|---|---|---|---|---|---|---|
| 1 | Length: median 2,534w / 24 beats; default action-fantasy `targetWords ≈ 2500`. Beat-count expectation `targetWords / 100` (current floor `/ 150` is too low). | `chapter-outline-system.md` `targetWords` band guidance | shipped in plotter `corpus-v1.md` `15c4145` | **PASSED** (`c00097b`) — corpus-v1 vs default n=3: targetWords 2000→3000, beats 49→67 (+36%) | **DONE (3 books)** | PASS (max diff 18.5%) | **PASS** — variant validated on probe |
| 2 | Beat kind distribution: action 36% / dialogue 28% / interiority 21% / description 15%. | `beat-expansion-system.md` kind-balance soft prior | — | — | **DONE (3 books)** | DIVERGE (max diff 36.8%) | **PASS** — full ranking matches all 3 books (action > dialogue > interiority > description). Ship as directional ranking prior. |
| 3a | Opener kind modal: description (50%/38%/45%). | `chapter-outline-system.md` opener guidance | shipped in plotter `corpus-v1.md` `15c4145` | LXC pending | **DONE (3 books)** | DIVERGE | **PASS_MODAL_ONLY** — description-as-modal-opener stable; secondary ordering varies. Ship as modal-class prior. |
| 3b | Closer kind modal: action (41%/31%/38%). | `chapter-outline-system.md` closer guidance | shipped in plotter `corpus-v1.md` `15c4145` | **REGRESSED** (`c00097b`) — corpus-v1 produced 0/3 action closers vs default's 2/3. Variant prompt steering away from action-as-final-beat. | **DONE (3 books)** | DIVERGE | **PASS_MODAL_ONLY** corpus; **VARIANT REGRESSION** — revise plotter prompt to make "closer beat is action-kind" an explicit prior, then re-probe. |
| 4-action | Action density rises q0→q4 within chapter (35→39.7 / 27→44.6 / 32.4→36.9 across books). | `beat-expansion-system.md` position-aware action density | encoded in beats `corpus-v1.md` `abcd78f` | LXC running | **DONE (3 books)** | DIVERGE | **PASS** — sign-of-effect (rising) reproduces in all 3 books |
| 4-description | Description density falls q0→q4 within chapter (24.9→8.7 / 21.5→7.1 / 15→6.3 across books). | `beat-expansion-system.md` position-aware description density | encoded in beats `corpus-v1.md` `abcd78f` | LXC running | **DONE (3 books)** | DIVERGE | **PASS** — sign-of-effect (falling) reproduces in all 3 books |
| 4-dialogue | (Originally claimed: dialogue mid-peak.) | (do not encode) | encoded in beats `corpus-v1.md` `abcd78f` | LXC running | **DONE (3 books)** | DIVERGE | **DIVERGE** — only CS shows mid-peak; SoS+HG flat. Drop from beat-expansion guidance. |
| 4-interiority | (Originally claimed: interiority builds.) | (do not encode) | — | — | **DONE (3 books)** | DIVERGE | **DIVERGE** — flat in CS+SoS, rises in HG. Drop. |
| 7 | Beat boundary signals: top-4 set is stable (pov_attention_shift / stakes_recalibration / action_shift / scene_start are top-4 across all 3 books) but rank-1 differs (CS+SoS: pov_attention_shift; HG: action_shift). | `beat-expansion-system.md` transition vocabulary as soft prior — encode the top-4 set, not a single dominant signal | encoded in beats `corpus-v1.md` `abcd78f` (currently encodes specific ordering) | LXC running | **DONE (3 books)** | DIVERGE | **PASS_PARTIAL** — top-4 vocabulary stable; specific rank order is not. Soften variant from rank-ordered to set-based. |
| 8 | **Tension curve / pacing rhythm** (highest-leverage): action density 1.56× first→second half across all 3 IWD books. Penultimate act is the action peak, NOT the final chapters — Crystal Shard final 20% dips back to 34% action vs second-half mean of 38%. Concrete pacing-curve shape. | `beat-expansion-system.md` + `chapter-outline-system.md` chapter-position pacing guidance | partial in plotter+beats variants | LXC pending+running | **DONE (3 books)** | n/a | **PASS** — book-level position-aware action density. Ship. |
| 9 | **Character introduction pacing**: 57% of 105 named entities in first 30% of chapters. Mean 3.5 new/chapter early, taper to 0–1 late. 12 characters first appear in last 20% of beats. | `chapter-outline-system.md` per-chapter new-character budget | shipped in plotter `corpus-v1.md` `15c4145` | LXC pending | **DONE (3 books)** | n/a | **PASS** — directional curve matches all 3 books. |
| 10 | **POV rotation**: chapter-primary POV rotates at 77% of chapter boundaries (omniscient 30% + Drizzt 26% own 56% of beats together). HIGH-frequency rotation, not occasional. | `chapter-outline-system.md` POV-character guidance — current planner says "Protagonist should hold POV for most chapters; rotate only when a different perspective is load-bearing." Salvatore data argues for more permissive rotation. | shipped in plotter `corpus-v1.md` `15c4145` | LXC pending | **DONE (3 books)** | n/a | **PASS** — high-frequency rotation reproduces. |
| 11 | **Setting-change frequency**: 3.1 scene-level setting changes per chapter (CS); only 10% monolocation. Streams of Silver diverges (29% monolocation — its dungeon-crawl structure). Author-level pattern with intra-author variance. | `chapter-outline-system.md` permissive multi-location guidance | shipped in plotter `corpus-v1.md` `15c4145` | LXC pending | **DONE (3 books, with variance)** | n/a | **PASS_WITH_CONTENT_CONDITIONALS** — ship the permissive prior; note the dungeon-crawl exception class. |
| 12 | **Dialogue density variance**: 29.5% mean per chapter (CS), high variance std=0.176; 2/3 chapters ≥25% dialogue. Likely overlaps Pattern 2 in implementation. | (subsumed by Pattern 2 — kind balance) | — | — | DONE | n/a | NOTE — fold into Pattern 2 |
| 13 | Sensory channel distribution: visual + kinesthetic ~79% combined; olfactory near-zero (regex proxy). | (no planner implication at this resolution) | — | — | — | n/a | DROP — descriptive only |
| 14 | **Forward-hook taxonomy** (chapter-close): partial-resolution 38.6% modal across all 3 books (43.8% / 33.3% / 37.0%); cliffhanger ~18%, foreshadow ~17% as reliable #2/#3. **3-book directionally stable.** | `chapter-outline-system.md` `purpose` guidance — describe the hook *kind* per chapter, default to partial-resolution | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | **PASS** — strong NEW ship candidate |
| 15 | **Time-cut markers**: CS 1.13 / SoS 2.54 / HG 1.28 per chapter. SoS is genuinely denser (road-trip book). Within-chapter cuts dominate (~70%). Concentrated in middle chapters (q1–q2). | `chapter-outline-system.md` purpose guidance — content-type-conditional time-cut budget; or beat-expansion guidance to use within-chapter time-cuts as a structural device | NEW — DRAFT pending | — | **DONE (3 books with content-type variance)** | n/a | **PASS_CONTENT_CONDITIONAL** — within-chapter cuts are the consistent shape; cross-chapter rate is content-type dependent |
| 16 | **Established-facts density**: cross-book mean 5.58 / median 5; harness floor (≥6) is AT corpus distribution. Words-vs-claims correlation 0.348. | Either RELAX existing planner floor `establishedFacts.length ≥ 6` to ≥4-5, or KEEP as aspirational | NEW — analysis-only | **WATCHED** (`c00097b`) — corpus-v1 plotter variant produced med 4/ch (default med 6). n=3 sample tiny; re-measure on 5+ chapters before drawing conclusion. | **DONE (3 books)** | n/a | **DECISION_PENDING** — corpus-v1 variant may be over-trimming facts; investigate prompt vs. policy interaction |
| 17 | **Chapter-opener rhetorical shape** (refines Pattern 3a): aggregate 45.7% scene-set-description / 17.4% in-media-res-action / 15.2% interior-reflection / 12.0% dialogue-first / 6.5% time-cut / 3.3% callback. **Modal class (scene-set-description) holds in all 3 books** (CS 55.9%, SoS 37.9%, HG 41.4%). Top-3 set stable: {scene-set-description, in-media-res-action, interior-reflection}. Refines but does not contradict Pattern 3a. | `chapter-outline-system.md` opener guidance — add per-chapter `openerKind` enum; default to scene-set-description with permitted alternates | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | **PASS** — strong NEW ship candidate |
| 18 | **Per-chapter primary conflict type**: aggregate 55.4% external-physical / 24.5% interpersonal / 8.7% external-cosmic / 11.4% internal. **Modal class (external-physical) holds in all 3 books** (CS 50%, SoS 62%, HG 55%). Rotation rate 55.1% (CS 54.5%, SoS 50%, HG 60.7%). external-cosmic decays book 1→3 (Crenshinibon arc winding down). **Counter-finding: 3+-consecutive same-primary streaks are COMMON** (max 11-chapter CS Kessell siege; max 7-chapter HG Calimport ascent) — naive "no 3+ streak" rule is falsified. | `chapter-outline-system.md` `purpose` guidance — soft-target rotation ~55% over a moving window; flag streaks ≥6 outside designated set-pieces; do NOT ban 3+ streaks. Orthogonal to mice (complementary chapter-axis). | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | **PASS** — strong NEW ship candidate, with corpus-validated counter-finding |
| 19 | **Per-chapter dramatic question resolution shape**: aggregate 54.3% partial / 18.5% closed / 10.9% replaced / 8.7% deferred / 7.6% compound. **Modal class (partial) holds in all 3 books** (CS 44.1%, SoS 62.1%, HG 58.6%). All 5 buckets fire in every book. Distinct from Pattern 14 (forward-hook chapter-CLOSE rhetoric) — most rhetorical "cliffhangers" (18.1% in P14) close the opening question while opening a new one (structurally `partial` or `replaced`, not `deferred`). | `chapter-outline-system.md` `purpose` field — note resolution-shape prior 55/20/10/10/5; explicitly call out `replaced` (deliberate misdirection) and `compound` (multi-faction) as structural choices, not bugs | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | **PASS** — strong NEW ship candidate, complements Pattern 14 not duplicates it |
| 20 | **Stake-escalation curve**: within-chapter `stakes_recalibration` events RISE q0→q4 in all 3 books (CS 7.6→21.5%, SoS 10.7→22.3%, HG 4.8→23.2%). Across-book arc early→late mean stakes per chapter RISES in all 3 books (CS 3.8→5.8, SoS 3.5→4.88, HG 4.63→5.75). | `chapter-outline-system.md` `purpose` guidance — within-chapter "stakes escalate from open to close" + arc-level "later chapters carry denser stakes events" | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | **PASS** — strong NEW ship candidate, BOTH axes directionally stable |
| 21 | **Beat-length uniform across kinds (NEGATIVE finding)**: all 4 beat kinds have mean lengths within 3 words (104.9–108.0w; n=2,469). Per-book ordering NOT stable; variation is noise. | (no harness change — confirms current `targetWords/100` policy) | n/a | n/a | **DONE (3 books)** | n/a | **NEG** — recorded to prevent re-discovery; rules OUT the "action beats shorter / interiority longer" edit |

**Sequencing (revised 2026-04-30 ~07:55 UTC, post directional re-score):**

1. ✅ Cross-book validation done for original 7 patterns + 6 new dims + forward-hook + time-cuts + facts density.
2. ✅ Directional re-score appended — Patterns 2, 3a, 3b, 4-action, 4-description, 7 (top-4) all pass directionally.
3. ✅ Plotter variant `15c4145` shipped (Patterns 1, 9, 10, 8-chapter-side, 3a, 3b — all directionally pass).
4. ⚠️ Beats variant `abcd78f` shipped (Patterns 4, 7, 8-beat-side) — Patterns 4-action + 4-description directionally pass but 4-dialogue + 4-interiority do NOT, and Pattern 7 needs softening from rank-ordered to set-based. Probe is still informative; reading should account for this.
5. **Now: read LXC probe results when they land**; revise beats variant if needed; draft variant for Pattern 14 (forward-hook taxonomy) since it's strong-3-book-stable and not yet encoded.
6. **Parallel:** wait for 3 in-flight subagents (chapter-opener taxonomy / dramatic-question shape / conflict-type taxonomy) — each adds another planner-prompt-relevant pattern if directionally stable.
7. Land winners as defaults; document per-pattern verdict in `docs/decisions.md`.

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
