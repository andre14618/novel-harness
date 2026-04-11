---
status: active
updated: 2026-04-11
---

# Context Engineering

What goes into each beat-writer call and how it has evolved. Covers beat context assembly, character voice, extraction mode, structural diversity, and retrieval. Parallel to `docs/adapter-changelog.md` — this tracks context changes; that tracks trained adapters.

**Status legend:** DEPLOYED · IN PROGRESS · PLANNED · DISCONFIRMED · BLOCKED · RETIRED

---

## Quick Reference

| Area | Status | Current State | Next Action |
|------|--------|--------------|-------------|
| Beat context skeleton | DEPLOYED | Bridge + landing + chars + refs + setting | — |
| Speech profiles | **PLANNED** | Free-text `speechPattern` field | Phase 1: structured schema |
| Planner dialogue targets | **PLANNED** | No guidance | Add to planning-plotter prompt |
| Archetype library | **PLANNED** | None | Phase 2: 15–20 archetypes |
| Extraction mode | **PLANNED** | `"both"` (extractors + planner) | Switch to `"plan"` after validation |
| Semantic retrieval | RETIRED (idle) | Infrastructure exists, disabled | Not before beat-writer SFT |
| Structural diversity | **BLOCKED** | 15.7% dialogue, 7.5w sentences | Paired training data needed |
| Together AI removal | **PLANNED** | V4 confirmed, V3 retired | Remove from registry.ts + env |

---

## Beat Context — Current Contents

**File:** `src/agents/writer/beat-context.ts`

Every beat-writer call gets ~500–1,000 tokens assembled deterministically:

| Slot | Contents | Always? |
|------|----------|---------|
| Beat spec | Beat number, POV, setting, description, characters | Yes |
| Transition bridge | Last 2–3 sentences of previous beat | Yes |
| Landing target | First sentence of next beat | Yes |
| Character snapshots | Per character: `speechPattern` (free text), emotional state, relationship to POV (trust/dynamic/tension), knowledge gaps (max 2) | Yes |
| Resolved references | Deterministic DB lookups via reference-resolver (Llama 3.1 8B, parallel-3 for recall) | Yes |
| Setting block | Sensory details for current location | Beat 0 or location change only |

**Deliberate omissions:**
- `emotionalShift` — excluded to prevent "telling" bias in prose
- World systems / facts / timeline — omitted per-beat; reserved for chapter-level validation (continuity checker)

**Observed output shape (131 chapters, 5 premises, 2026-04-09):**

| Metric | Pipeline avg | Published norm | Gap |
|--------|-------------|---------------|-----|
| Dialogue word% | 15.7% | 25–50% | **−9–34pp** |
| Interiority verbs/100w | 0.1 | 0.5–2.0 | **−5–20×** |
| Avg sentence length | 7.5w | 12–18w | **−4–10w** |
| Max non-dialogue paragraph run | 9¶ | 3–8¶ | over |

*Measurement note: Initial structural analysis showed 7.6% dialogue — wrong due to regex bug that missed Unicode smart quotes. Fixed detection handles `""`, `''`, and contractions. Always validate deterministic metrics against spot-checked samples.*

---

## Character Voice

**The problem:** Current `speechPattern: string` in character schema is free-text ("sounds gruff"). Models follow example dialogue far better than abstract descriptions. No per-character guardrails in the pipeline.

### Phase 1 — Structured SpeechProfile (no training required)
**Status: PLANNED — build now**

Replace free-text `speechPattern` with structured attributes:

```typescript
interface SpeechProfile {
  register: string              // "formal" | "casual" | "slang" | "hard_boiled" | etc.
  sentenceLength: string        // "short" | "medium" | "long"
  vocabulary: string[]          // characteristic words/phrases
  forbiddenPhrases: string[]    // what this character would never say
  syntacticPatterns: string[]   // "imperative verbs" | "rhetorical questions" | etc.
  emotionalExpression: string   // "muted" | "verbose" | "sarcastic" | etc.
}
```

Render in beat context as a structured block with **2–3 example dialogue lines**, not an attribute list. Qwen3-14B follows examples far better than abstract descriptions.

**Also in Phase 1 (same code change, no training):**
- **Forbidden phrase lint** — extend deterministic lint to flag per-character `forbiddenPhrases` in dialogue. Same mechanism as cliché patterns, scoped by character name. Zero model cost.
- **Planner dialogue guidance** — add explicit dialogue beat targets to planning-plotter prompt. At least 2 of 4–6 beats should be primarily dialogue-driven. Measure before/after with `scripts/analyze-structure.ts`. Target: 15.7% → 25%.

### Phase 2 — Archetype Library (no training required)
**Status: PLANNED — after Phase 1 ships**

15–20 named archetypes with structured speech profiles and 3–5 canonical example dialogue lines each. Map every generated character to an archetype at concept time; beat context gets the archetype's examples automatically.

Planned archetypes: `stoic_warrior`, `scheming_noble`, `earnest_apprentice`, `reluctant_hero`, `cynical_mentor`, `naive_innocent`, `calculating_villain`, `world_weary_professional`, `hot_tempered_youth`, `diplomatic_deceiver`, `hard_boiled_detective`, `theatrical_authority`.

**Phase 2 data (feeds Phase 3):** Public domain dialogue extraction pipeline.
- Sources: Doyle (analytical/earnest), Hammett (hard_boiled), Wodehouse pre-1930 (evasive/exasperated), Dickens (theatrical villain/earnest apprentice), Twain (dialect), Haggard (stoic adventure), O. Henry (deadpan working-class)
- Extract 2–8 sentence exchanges. Use 235B to: (a) assign archetype label, (b) generate neutral "flattened" version
- Training pair: `(flat_dialogue + archetype_profile) → (original_voiced_dialogue)`
- Target: 400–500 pairs across 10–12 archetypes. ~$3–5 total.
- Same distillation-from-corpus pattern as the Howard tonal pass

### Phase 3 — Voice-Pass LoRA (after Phase 1+2 in production)
**Status: BLOCKED on Phase 1 infrastructure**

W&B Qwen3-14B adapter that rewrites dialogue-only paragraphs conditioned on the character's `SpeechProfile`. Beat-writer generates voice-agnostic prose; voice-pass applies character-specific voice post-hoc.

Training format:
```
[system: voice-pass instructions]
[user: CHARACTER_PROFILE: {...}  DIALOGUE: "..."  CONTEXT: "..."]
[assistant: "voiced dialogue"]
```

Target: `voice-pass-archetype-v1` once 400+ pairs assembled from Phase 2 pipeline.

### Future — Character Voice Checker
**Status: BLOCKED on Phase 1**

Per-beat classifier: does this dialogue match the character's `SpeechProfile`? Train from `(dialogue_line, speech_profile, matches: bool)` once voice-pass adapter generates labeled examples naturally. No separate data collection needed — voice-pass outputs become the training signal.

---

## Extraction Mode

**The question:** The planner already outputs `establishedFacts`, `characterStateChanges`, and `knowledgeChanges` per chapter. Do we still need to run LLM extractors?

### Current: `extractionMode = "both"`
**File:** `src/config/pipeline.ts`

After each approved chapter, runs 5 parallel extraction agents:
1. `summary-extractor` — chapter summary, key events, emotional state, open threads
2. `fact-extractor` — currently 17–20 facts/chapter (target: 8–15, over-extracting)
3. `character-state` — location, emotional state, knows/doesNotKnow per character
4. `relationship-timeline` — relationship changes, timeline events, knowledge propagation
5. `graph-linker` — causal chains via `event_causes` + `knowledge_propagation` tables

Extraction is ~45% of total pipeline cost. Extractors write to the same Postgres tables the continuity checker reads.

### Planned: Switch to `extractionMode = "plan"`
**Status: PLANNED — requires validation on 2–3 novels first**

Disable LLM extractors except `relationship-timeline` (planner doesn't output relationship arcs). Use planner-produced `establishedFacts`, `characterStateChanges`, `knowledgeChanges` directly.

**Risk:** Planner outputs may miss things the extractors catch. Run `"both"` on 2–3 new-seed novels, compare planner vs extractor outputs, confirm coverage before switching.

### Fact Extractor Tightening
**Status: PLANNED**

17–20 facts/chapter vs 8–15 target. Over-extraction creates noisy continuity context. Fix path: `bun scripts/build-finetune-data.ts --task fact-extractor --limit 50` → review 20–30 pairs manually → establish keep/drop criteria → correct to gold → scale to 300+ pairs → SFT.

---

## Structural Diversity

**Status: BLOCKED — no paired training data exists**

The pipeline produces structurally monotone prose. The gap isn't a prompt issue — it's a training data problem.

| Metric | Pipeline | Published norm | Fix required |
|--------|---------|---------------|-------------|
| Dialogue word% | 15.7% | 25–50% | Planner guidance (Phase 1) + structural paired data |
| Interiority verbs/100w | 0.1 | 0.5–2.0 | Paired training data |
| Avg sentence length | 7.5w | 12–18w | Paired training data |

**What planner guidance can fix:** Dialogue quantity (planner controls beat composition). Phase 1 targets 15.7% → 25% via explicit dialogue beat targets in the prompt.

**What requires paired training data:** Interiority density and sentence length variation. Needs `(current pipeline output → structurally rich rewrite)` pairs that don't exist yet. Beat-writer SFT and new tonal-pass training are blocked until this is addressed.

**Tracking:** Run `scripts/analyze-structure.ts` after each batch of new novels. Measure before/after each context engineering change.

---

## Semantic Retrieval

**Status: RETIRED (infrastructure idle)**

Full hybrid retrieval infrastructure exists in `src/db/retrieval.ts`:
- 6-table RRF search (characters, locations, facts, timeline, relationship states, world systems)
- Per-table boost weights, recency decay (half-life: 10 chapters default)
- Tunable parameters per novel in `retrieval_config` table

**Why disabled:** Beat-level writing uses only deterministic lookups (reference-resolver). The reference-resolver at parallel-3 covers the practical case. Semantic retrieval adds latency and non-determinism without a demonstrated accuracy gap.

**When to revisit:** If beat-writer SFT shows that the model needs broader world-state context to maintain coherence across long novels, re-enable embeddings and measure. Not a priority until the structural diversity problem is addressed.

---

## Infrastructure Cleanup

### Remove Together AI provider
**Status: PLANNED**

V4 tonal-pass pref eval confirmed 2026-04-11. V3 on Together AI retired. Actions:
- Remove `TOGETHER_API_KEY` from `.env`
- Remove Together entries from `models/registry.ts`
- Verify no remaining role assignments in `models/roles.ts`

---

## Measurement Tools

| Script | Purpose | Run when |
|--------|---------|----------|
| `scripts/analyze-structure.ts` | Dialogue %, interiority, sentence length, paragraph run | After each batch of novels |
| `scripts/eval-adherence-finetune.ts` | Adherence checker oracle agreement | After adapter training |
| `scripts/eval-adherence-synthetic.ts` | Synthetic accuracy on known-label pairs | Teacher eval, adapter comparison |
| `scripts/build-finetune-data.ts` | Build SFT training data for any extractor | Before fact-extractor SFT |

---

## Decision Gates Pending

| Gate | Blocks | Criteria |
|------|--------|----------|
| Structural diversity improvement | Beat-writer SFT, tonal-pass V2 training | Dialogue ≥ 25%, sentence length ≥ 10w avg |
| Phase 1 (SpeechProfile) shipped | Phase 2 archetype library, Phase 3 voice-pass | In production on ≥ 1 novel |
| extractionMode validation | Switch to `"plan"` | Planner vs extractor coverage match on 2–3 novels |
| V3-sonnet adherence eval | Tiered retry policy, GRPO loop | FAIL_TANGENT_HARD > 69%, FAIL_MISSING_SUBTLE > 78.6%, events ≥ 95% |
