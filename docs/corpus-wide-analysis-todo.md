---
status: roadmap (updated as scope is decided)
updated: 2026-04-29
related_charters: docs/charters/corpus-structural-decomposition-v1.md (R7)
---

# Corpus Wide-Analysis Roadmap

What we can extract from a published-novel corpus given the current cost structure. Drives the scope-expansion decision after the R7 smoke verdict on `value-charge + promise + character-arcs + MICE + McKee-Gap` lands.

## Cost structure (load-bearing for prioritization)

**DeepSeek V4 Pro promo** (until 2026-05-31): $0.435 input / $0.87 output per 1M tokens (75%-off base $1.74/$3.48). Auto-judge on this tier ~$0.05-0.20 per 50-row dim.

**DeepSeek V4 Flash extractor**: $0.14 input / $0.28 output per 1M, with 98%-off cached input ($0.0028/M). Per-extractor, the chapter-context prefix typically caches at ~94% after the first call in a chapter — observed empirically on the value-charge run.

**Practical cost frontier per dim per book** (post-cache, V4 Flash + V4 Pro judge):

| Scope | Calls | Approx LLM cost | Approx wall-clock |
|---|---|---|---|
| Per-book single-call | 1 | ~$0.02 | ~30s-2min |
| Per-character (~6) single-call | 1 | ~$0.05 | ~1-3min |
| Per-scene (~140) | 100-150 | ~$0.10-0.30 | ~7-15min |
| Per-beat (~860) | 600-900 | ~$0.30-0.80 | ~30-50min |

**No urgency to complete during a single "cache hot" window** — each new dim has its own prefix-cache lifecycle. The 75%-off promo IS a real time-bounded discount worth banking before 2026-05-31.

**Cross-corpus signal**: most dims are stronger with N=2+ books for same-author / cross-author / cross-genre transfer questions. Single book answers "does the extractor work" but not "does the framework apply universally."

## Status legend

- 🟢 SHIPPED — extractor exists, scaffolded, can run
- 🟡 IN-FLIGHT — running on `crystal_shard` right now or judge pending
- 🔵 SCAFFOLDED, NOT RUN — agent dir + driver exists, awaiting greenlight
- ⚪ DESIGN-PENDING — schema needs to be drafted before scaffolding
- ⚫ DEFERRED — explicit promotion-gate (e.g. requires N=2+ books)

---

## Tier 1 — Structural framework dims (high convergence, planner-consumable)

These tag scenes/beats with the load-bearing structural concepts from `docs/research/writing-frameworks/SYNTHESIS.md`. Output → planner constraint surfaces.

| Status | Dim | Frameworks (count) | Scope | Cost (LLM + judge) | Downstream consumer | Single book OK? |
|---|---|---|---|---|---|---|
| 🟡 | `value-charge` per scene | Coyne+McKee+Yorke+Truby+Swain (5) | per-scene | ~$0.06 + $0.20 | Planner emits `valueIn`/`valueOut`/`lifeValue` per beat | yes |
| 🟡 | `PromiseRegistry` per book | Sanderson+Lisle+LitRPG+Coyne (4) | per-book | ~$0.03 + $0.10 | Concept extracts initial promises; planner emits `promises_made[]` / `payoffs_delivered[]` | yes |
| 🟢 | `character-arcs` (Lie/Truth/Want/Need) per main char | Weiland+Truby+Yorke+Harmon+STC+Maass+McKee+Sanderson (8 — densest) | per-character per-book | ~$0.05 + $0.15 | Concept-phase character-agent; per-character constraint in beat-writer | yes |
| 🟡 | `MICE` thread per scene | Sanderson | per-scene | ~$0.06 + $0.20 | Planner balanced-parens check (every opened thread closes) | yes |
| 🟡 | `McKee-Gap` per beat | McKee+Yorke+Coyne+Swain (convergent on §2.1, §2.5) | per-beat | ~$0.20 + $0.50 | Drafting / quality-redraft gate ("flat beat" detector) | yes |
| 🔵 | `Yorke phase` per beat | Yorke 5-act (inciting/turning/climax/release) + STC + Brooks (3 align on percentages) | per-beat | ~$0.15 + $0.40 | Planner percentage-targets per phase | yes (single-book validates extractor; 2+ validates phase-percentage rule) |
| ⚪ | `Truby character-web` | Truby unique | 6 chars × 6 chars matrix | ~$0.04 + $0.12 | Concept-phase moral-opposition constraints | yes |
| ⚪ | `Snowflake disaster manifest` | Snowflake (3-disasters formal) + Yorke (turning-point parallel) (2) | per-book, ~3 disasters | ~$0.02 + $0.06 | Concept-phase disaster conservation invariant | yes |
| ⚪ | `Coyne genre obligatory scenes` | Coyne (genre contracts), STC (genre-specific) (2) | per-scene, sparse | ~$0.04 + $0.12 | Planner enforces genre payoff scenes | yes (single book) but cross-genre signal needs ≥2 genres |
| ⚪ | `Maass microtension` per beat | Maass (top-5 §1 finding), Browne-King (POV) (2) | per-beat | ~$0.20 + $0.50 | Quality-redraft gate ("is the writer bored?" detector) | yes |
| ⚪ | `Swain GCDRDl` beat-tag | Swain "Goal/Conflict/Disaster/Reaction/Dilemma/Decision" | per-beat | ~$0.20 + $0.50 | Planner Scene/Sequel structure check | yes |
| ⚫ | `Antagonist parallel-goal` | McKee+Truby converge | per-book | ~$0.03 + $0.08 | Concept-phase antagonist-agent | DEFERRED until antagonist-driven seed library exists |

**Tier 1 total scope** (all 12 dims on 1 book): ~$1.20 LLM + $3.50 judge ≈ **$4.70 per book**, ~3-5h wall-clock.

---

## Tier 2 — World-knowledge extraction (populates harness DB)

These map directly onto the harness's existing `world_systems`, `cultures`, `relationship_states`, `timeline_events`, `character_knowledge`, `knowledge_propagation`, `character_states` tables. Currently those tables are populated only during a novel run; corpus mining would seed them with reference data from a proven novel.

This is the highest-leverage tier *for the harness's existing planner-decision surfaces* — but each dim needs a schema-design pass to align with existing DB columns (not started).

| Status | Dim | Schema target | Scope | Cost | Downstream consumer | Single book OK? |
|---|---|---|---|---|---|---|
| ⚪ | Character emotional-state per chapter | fits `character_states` table | per-character × per-chapter | ~$0.10 + $0.30 | Concept-phase per-char snapshot; drafting context | yes |
| ⚪ | Object lineage tracking | fits `timeline_events` (object-typed) | per-significant-object × appearance-events | ~$0.05 + $0.15 | Continuity check (where is object now?) | yes |
| ⚪ | Magic-system rule extraction | fits `world_systems` table | per-system × rules-list | ~$0.04 + $0.12 | Planner enforces magic-system consistency in sequel novels | yes |
| ⚪ | Setting/location atlas | fits `cultures` table (loose) + locations | per-distinct-location × attributes | ~$0.05 + $0.15 | Concept-phase setting-extraction | yes |
| ⚪ | Faction/alliance map | fits `relationship_states` (group-typed) | per-faction × relationship-changes | ~$0.04 + $0.12 | Concept-phase political-state | DEFERRED to ≥2 books for trans-novel arc tracking |
| ⚪ | Knowledge-propagation timeline | fits `character_knowledge` + `knowledge_propagation` | per-secret × who-learns-when | ~$0.10 + $0.30 | Drafting "doesn't-know" constraints | yes (matches existing harness shape closely) |
| ⚪ | Cultural codes | fits `cultures` table | per-culture × customs/norms | ~$0.04 + $0.12 | Concept-phase character-agent (cultural backstory) | yes |
| ⚪ | Event-cause graph | fits `event_causes` table | per-pivotal-event × cause-chains | ~$0.05 + $0.15 | Planner causality enforcement | yes |

**Tier 2 total scope** (all 8 dims): ~$0.50 LLM + $1.50 judge ≈ **$2 per book**, ~4-6h wall-clock + ~6-8h schema-design author time.

---

## Tier 3 — Voice / style imitation features (relevant to V4 Flash voice-shaping arm)

Per `docs/decisions.md` "Voice-LoRA track frozen": the writer-target is now V4 Flash + prompt-level voice shaping. Extracting style features from a successful corpus is direct training-signal for the prompt-shaping arm. This is the "concrete writer-imitation" tier vs the "structural-imitation" of Tier 1.

| Status | Dim | Scope | Cost | Downstream consumer |
|---|---|---|---|---|
| ⚪ | Sentence-rhythm per scene (length variance, fragment count, opener variety) | per-scene | ~$0.06 + $0.20 OR pure code | Voice prompt: "match Salvatore's median sentence length 14 words ± 6" |
| ⚪ | Per-character dialogue-style signature | per-character × dialogue corpus | ~$0.10 + $0.30 | Voice prompt per-character (Bruenor's idiom vs Drizzt's) |
| ⚪ | Action-vs-interiority ratio per scene | per-scene | ~$0.05 + $0.15 OR partial-code | Planner balance-target per scene type |
| ⚪ | Setting-establishment patterns | per-chapter-opening × pattern-tags | ~$0.04 + $0.12 | Drafting chapter-0 prompt template |
| ⚪ | Combat-sequence beat structure | per-action-set-piece × beats | ~$0.05 + $0.15 | Drafting set-piece template |
| ⚪ | Description timing (when does author introduce a new place/thing) | per-noun-introduction × beat-timing | ~$0.10 + $0.30 | Drafting first-mention discipline |
| ⚪ | Transition pattern between scenes/POV switches | per-scene-transition × pattern-tags | ~$0.05 + $0.15 | Drafting scene-boundary prompts |
| ⚪ | Figurative-language frequency (similes, metaphors, personification per 1000 words) | per-scene OR per-chapter | ~$0.04 + pure code | Voice-shaping intensity dial |

**Tier 3 total scope**: ~$0.50 LLM + $1.50 judge ≈ **$2 per book**, mostly designable as schema-light "tag the salient pattern, don't enumerate."

---

## Tier 4 — Quality / craft-evaluation features (calibrates harness checkers)

Run the harness's existing checkers on Salvatore's prose to calibrate them against ground truth (a published novel). Catches checkers that over-fire on legitimate craft.

| Status | Analysis | What it answers |
|---|---|---|
| ⚪ | Lint pattern frequency on Salvatore prose | Which of the harness's ~26 lint patterns Salvatore violates and how often. Lints that fire on Salvatore are wrong-shape lints. |
| ⚪ | Hallucination frequency check on Salvatore prose | Run halluc-checker-v3 on Salvatore. If FP rate is high, halluc-checker is too strict. |
| ⚪ | Adherence-event detection | Run adherence-checker on (Salvatore plan-summary → Salvatore beat). If FP, planner-adherence is too strict. |
| ⚪ | Repetition / n-gram diversity baseline | Salvatore's actual repetition rate as the calibration floor for the redraft gate |
| ⚪ | Sentence-opener variance baseline | Salvatore's actual sentence-opener distribution as the calibration floor for the lint surface |

**Tier 4 total scope**: ~$0.10 LLM (checkers run on existing prose), ~30 min wall-clock.

---

## Tier 5 — Meta / cross-judge / sensitivity (cheap quality assurance)

| Status | Analysis | Cost |
|---|---|---|
| ⚪ | Sonnet cross-family judge on lowest-V4-Pro-confidence quartile per dim | ~10 rows × subagent compute (no harness $) |
| ⚪ | Codex cross-family judge as third-judge tiebreaker | ~5 rows × subagent compute |
| ⚪ | Temperature-sensitivity sweep on extractor (T=0.05 vs 0.1 vs 0.3) | ~$0.30 per dim per run |
| ⚪ | Cross-dim coherence audit (do MICE primaries align with value-charge polarities?) | ~0 LLM (analytical) |
| ⚪ | Re-judge under V3.2 base for capability-gradient measure | ~$0.05 per dim |
| ⚪ | Two-pass V4 Pro self-consistency (run judge twice with diff seeds) | doubles judge cost |

**Tier 5 total**: ~$0.50 + ~30 min subagent time per dim under audit.

---

## Cross-corpus expansion (gated on Tier 1+2 single-book signal)

After the single-book smoke verdict for at least 1 dim returns SCOPED PASS or PARTIAL, the cheapest-counterfactual move depends on which axis we want to validate.

### Axis A — Genre transfer (single author → multiple genres)

**Question:** does the extractor's framework-tagging transfer across genres, or is it Salvatore-specific?

**New corpus needed**: 1 LitRPG novel + 1 mystery + 1 romance (or similar). ~$10-20 ingest cost per book per `corpus-pipeline.md` Stages 1-5, ~$2 dim-extraction cost per book × 2-3 books ≈ ~$40-70 total.

**Yields**: cross-genre stratification verdict (R6's deferred secondary question).

### Axis B — Author transfer (same genre → multiple authors)

**Question:** does Salvatore's structural pattern generalize to other fantasy authors?

**New corpus needed**: 1 Sanderson novel + 1 Erikson + 1 Cook (Black Company) for fantasy comparison. Same ingest cost.

**Yields**: voice/structural variance signal — can the planner "tune" between author registers?

### Axis C — Series-arc analysis (same series → 3 books)

**Question:** how do structural elements (promises, character arcs) thread across a trilogy?

**Existing corpus has this** — Streams of Silver + Halfling's Gem are ALREADY in the bundle but not extracted. Cost: ~$2-4 to extract all 3 books × all 5 currently-scaffolded dims.

**Yields**: series-arc planner constraints (cross-novel promise carry-forward).

### Axis D — Author lineage (Salvatore vs his influences)

**Question:** which structural patterns Salvatore inherited from Tolkien / Howard / Leiber?

**New corpus needed**: 1 Tolkien + 1 Howard + 1 Leiber (all out-of-copyright). ~$10-20 ingest each.

**Yields**: voice-LoRA training signal + structural archaeology.

---

## Recommended phasing

**Phase 0 — In flight today (R7 smoke):** value-charge + promise + character-arcs + MICE + McKee-Gap on crystal_shard. Verdict gates Phase 1.

**Phase 1 — Tier 1 completion if R7 SCOPED PASS or PARTIAL** (~$2 + ~3h author time): scaffold Yorke phase + Truby web + Snowflake disasters + Coyne obligatory + Maass microtension + Swain GCDRDl. Run all on crystal_shard.

**Phase 2 — Existing-trilogy expansion** (Axis C, ~$3-5 LLM): re-run Phase 0 + 1 dims on Streams of Silver + Halfling's Gem. ZERO new corpus cost (already on disk).

**Phase 3 — Tier 2 world-knowledge** (~$2 + ~6-8h author time on schemas): align with existing harness DB tables; populate one full reference world-bible.

**Phase 4 — Tier 3 voice features** (~$2 + ~4-6h author time): feed prompt-shaping arm.

**Phase 5 — Cross-corpus expansion** (Axis A, B, or D): user purchases additional books. Order depends on which question is most actionable for the planner.

**Phase 6 — Tier 4 calibration + Tier 5 cross-judge**: ongoing background work.

**Total compute budget** for Phases 0-4 on existing trilogy: ~$15 LLM + ~12h author schema-design time. Phase 5 adds ~$50-100 per genre/author axis.

---

## Linked context

- `docs/charters/corpus-structural-decomposition-v1.md` — R7 smoke charter (parent)
- `docs/research/writing-frameworks/SYNTHESIS.md` — convergence rankings (anchors Tier 1)
- `docs/corpus-pipeline.md` — ingest Stages 1-5 (anchors cross-corpus expansion costs)
- `docs/decisions.md` — V4 Flash → V4 Pro promo end date 2026-05-31; voice-LoRA frozen
- `docs/eval-infrastructure.md` — calibration eval shape (anchors Tier 4)
- `src/harness/` — service-layer API for Tier 2 DB-population dims
- `src/db/world-systems.ts`, `src/db/character-states.ts`, etc. — Tier 2 schema targets
