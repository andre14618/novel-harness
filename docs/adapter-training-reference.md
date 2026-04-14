# Adapter Training Reference

**Purpose:** Every LoRA adapter is trained on a frozen system prompt. Changing that prompt in production breaks the adapter — the model learned to respond to a specific instruction format. This document records what each adapter was trained on so prompt changes can be evaluated for compatibility.

**Rule:** Before modifying any agent prompt file, check this document. If the prompt is frozen in an adapter, you must either (a) retrain the adapter or (b) leave the prompt unchanged.

---

## Deployed Adapters (Production)

### 1. adherence-events (adherence-checker-v4)

| Field | Value |
|-------|-------|
| **Artifact URI** | `wandb-artifact:///andre14618-/novel-harness/adherence-checker-v4` |
| **Base model** | OpenPipe/Qwen3-14B-Instruct |
| **Training pairs** | 2,134 (Sonnet-labeled) |
| **Epochs** | 2 |
| **Experiment** | #161 |
| **Data file** | `scripts/lora-data/adherence-checker-pairs.jsonl` (160 original + expanded via Sonnet) |
| **roles.ts agent** | `adherence-events` |

**Frozen system prompt** (74 chars, inline in `src/agents/writer/adherence-checker.ts:28-45`):

```
You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to.
- If ANY key action from the beat is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}
```

**User prompt format:** `BEAT: {description}\nCHARACTERS EXPECTED: {chars}\n\nPROSE:\n---\n{prose_trimmed_2000}\n---`

**Output schema:** `{ events_present: boolean, evidence: string, reasoning: string }`

**Prompt location:** Inline constant `EVENTS_SYSTEM` in `src/agents/writer/adherence-checker.ts:28`. NOT in a .md file.

---

### 2. chapter-plan-checker (chapter-plan-checker-v2:v1)

| Field | Value |
|-------|-------|
| **Artifact URI** | `wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v2:v1` |
| **Base model** | OpenPipe/Qwen3-14B-Instruct |
| **Training pairs** | 520 (Sonnet-labeled) |
| **Epochs** | 2 |
| **Experiment** | #178 |
| **Data file** | `scripts/lora-data/chapter-plan-checker-pairs.jsonl` |
| **roles.ts agent** | `chapter-plan-checker` |

**Frozen system prompt** (2,343 chars, from `src/agents/chapter-plan-checker/plan-adherence-system.md`):

Starts with: `You verify that chapter prose captures the INTENT of a chapter plan. Beat descriptions are creative inspiration, NOT literal scripts.`

**Output schema:** `{ setting_match: { planned, observed, matches }, emotional_arc_correct, pass, deviations[] }`

**Prompt location:** `src/agents/chapter-plan-checker/plan-adherence-system.md`

---

### 3. continuity (continuity-v2:v1)

| Field | Value |
|-------|-------|
| **Artifact URI** | `wandb-artifact:///andre14618-/novel-harness/continuity-v2:v1` |
| **Base model** | OpenPipe/Qwen3-14B-Instruct |
| **Training pairs** | 253 (hand-crafted scenarios x 6-7 variants) |
| **Epochs** | 3 |
| **Experiment** | exp in docs/decisions.md |
| **Data file** | `scripts/lora-data/continuity-pairs.jsonl` |
| **roles.ts agents** | `continuity-facts`, `continuity-state` (both use same adapter) |

**Frozen system prompt** (2,927 chars, from `src/agents/continuity/fact-check-system.md` and `state-check-system.md`):

Note: continuity uses 2 decomposed agents (facts + state) sharing one adapter. The training data contains examples for BOTH prompt variants.

Starts with: `You are a continuity checker for fiction. Review the chapter draft against established facts and character states.`

**Output schema:** `{ issues: [{ severity, description, conflictsWith, category }] }`

**Prompt location:** `src/agents/continuity/fact-check-system.md`, `src/agents/continuity/state-check-system.md`

---

### 4. tonal-pass (howard-tonal-v4-sft-resume:v8)

| Field | Value |
|-------|-------|
| **Artifact URI** | `wandb-artifact:///andre14618-/novel-harness/howard-tonal-v4-sft-resume:v8` |
| **Base model** | OpenPipe/Qwen3-14B-Instruct |
| **Training pairs** | 6,423 (back-translated Howard style pairs) |
| **Epochs** | 2 |
| **Experiment** | #98 |
| **Data file** | `scripts/lora-data/howard-tonal-pairs.jsonl` |
| **roles.ts agent** | `tonal-pass` |

**Frozen system prompt** (67 chars):

```
Rewrite this paragraph. Make the prose vivid, concrete, and direct.
```

**User prompt format:** Raw paragraph text.

**Output format:** Rewritten paragraph (plain text, not JSON).

**Prompt location:** Hardcoded in tonal-pass caller. Training data uses this exact string.

---

## In-Training Adapters (Phase 4 — 2026-04-13)

### 5. fact-extractor (fact-extractor-v1)

| Field | Value |
|-------|-------|
| **Status** | Training on W&B (exp #187) |
| **Base model** | OpenPipe/Qwen3-14B-Instruct |
| **Training pairs** | 256 (Sonnet-reviewed, 3% approved / 97% corrected) |
| **Epochs** | 3 |
| **Data file** | `scripts/lora-data/fact-extractor-sonnet.jsonl` |
| **Source** | 143 from llm_calls + 113 generated, all Sonnet-reviewed |
| **Novels** | 50 unique, chapters 1-10 |

**Frozen system prompt** (2,173 chars, from `src/agents/fact-extractor/fact-extractor-system.md`):

Starts with: `Extract facts from this chapter that could cause **continuity errors** if forgotten or contradicted in future chapters.`

**Prompt drift status:** MATCH with current live prompt.

**Output schema:** `{ facts: [{ fact: string, category: "physical"|"rule"|"relationship"|"knowledge"|"identity"|"temporal" }] }`

**User prompt format:** Chapter prose only.

**Sequence length concern:** 77% of training examples exceed 2,048 tokens (W&B ART max_seq_length). Average ~2,602 tokens. Training may truncate assistant responses on longer examples.

---

### 6. summary-extractor (summary-extractor-v1)

| Field | Value |
|-------|-------|
| **Status** | Pending training |
| **Base model** | OpenPipe/Qwen3-14B-Instruct |
| **Training pairs** | 256 (Sonnet-reviewed, 50% approved / 50% corrected) |
| **Epochs** | 3 |
| **Data file** | `scripts/lora-data/summary-extractor-sonnet.jsonl` |
| **Source** | 143 from llm_calls + 113 generated, all Sonnet-reviewed |
| **Novels** | 50 unique, chapters 1-10 |

**Frozen system prompt** (3,406 chars, from `src/agents/summary-extractor/chapter-summary-system.md`):

Starts with: `Extract a structured summary of this chapter for use as context in future chapters.`

**Prompt drift status:** MISMATCH — training data says "downstream agents never lack context", live prompt says "future chapters never lack context". Minor wording change but technically a drift.

**Output schema:** `{ summary: string, keyEvents: string[], emotionalState: string, openThreads: string[] }`

**User prompt format:** Chapter prose only.

**Sequence length concern:** 100% over 2,048 tokens, 14% over 4,096. Average ~3,411 tokens.

---

### 7. character-state (character-state-v1)

| Field | Value |
|-------|-------|
| **Status** | Pending training |
| **Base model** | OpenPipe/Qwen3-14B-Instruct |
| **Training pairs** | 256 (Sonnet-reviewed, 44% approved / 56% corrected) |
| **Epochs** | 3 |
| **Data file** | `scripts/lora-data/character-state-sonnet.jsonl` |
| **Source** | 143 from llm_calls + 113 generated, all Sonnet-reviewed |
| **Novels** | 50 unique, chapters 1-10 |

**Frozen system prompt** (2,935 chars, from `src/agents/character-state/state-extractor-system.md`):

Starts with: `For each character who appeared in this chapter, describe their complete state at the END of the chapter.`

**Prompt drift status:** MISMATCH — training data says "downstream agents depend on this", live prompt says "this must be accurate to maintain continuity". Wording change.

**Output schema:** `{ characters: [{ name, location, emotionalState, knows: string[], doesNotKnow: string[] }] }`

**User prompt format:** Chapter prose + character list.

**Sequence length concern:** 92% over 2,048 tokens. Average ~3,003 tokens.

---

### 8. relationship-timeline (relationship-timeline-v1)

| Field | Value |
|-------|-------|
| **Status** | Pending training |
| **Base model** | OpenPipe/Qwen3-14B-Instruct |
| **Training pairs** | 256 (Sonnet-reviewed, 33% approved / 67% corrected) |
| **Epochs** | 3 |
| **Data file** | `scripts/lora-data/relationship-timeline-sonnet.jsonl` |
| **Source** | 143 from llm_calls + 113 generated, all Sonnet-reviewed |
| **Novels** | 50 unique, chapters 1-10 |

**Frozen system prompt** (3,554 chars, from `src/agents/relationship-timeline/timeline-extractor-system.md`):

Starts with: `You are a relationship and timeline analyst for fiction.`

**Prompt drift status:** MATCH with current live prompt.

**Output schema:** `{ relationshipChanges[], timelineEvents[], knowledgeGains[], awarenessChanges[] }`

**User prompt format:** Chapter prose + characters + relationships + world systems.

**Sequence length concern:** 100% over 2,048 tokens, 51% over 4,096. Average ~4,086 tokens. Most severe truncation risk.

---

## Prompt File Quick Reference

| Agent | Prompt location | Frozen in adapter? | Safe to edit? |
|-------|----------------|-------------------|---------------|
| `src/agents/fact-extractor/fact-extractor-system.md` | fact-extractor-v1 | **NO** — retrain required |
| `src/agents/summary-extractor/chapter-summary-system.md` | summary-extractor-v1 | **NO** — retrain required (already drifted) |
| `src/agents/character-state/state-extractor-system.md` | character-state-v1 | **NO** — retrain required (already drifted) |
| `src/agents/relationship-timeline/timeline-extractor-system.md` | relationship-timeline-v1 | **NO** — retrain required |
| `src/agents/chapter-plan-checker/plan-adherence-system.md` | chapter-plan-checker-v2:v1 | **NO** — retrain required |
| `src/agents/continuity/fact-check-system.md` | continuity-v2:v1 | **NO** — retrain required |
| `src/agents/continuity/state-check-system.md` | continuity-v2:v1 | **NO** — retrain required |
| `src/agents/writer/adherence-checker.ts` (inline) | adherence-checker-v4 | **NO** — retrain required |
| `src/agents/writer/beat-writer-system.md` | None | YES — no adapter |
| `src/agents/planning-plotter/*.md` | None | YES — no adapter |
| `src/agents/writer/reference-resolver*.md` | None | YES — no adapter |
| `src/agents/lint-fixer/*` | None | YES — no adapter (yet) |
| Concept agents (world-builder, character, plotter) | None | YES — no adapter |

---

## Known Issues

### Sequence Length Truncation

W&B ART uses max_seq_length=2048. Training examples exceeding this are truncated, potentially cutting off the assistant response (the part the model learns from). Impact by adapter:

| Adapter | % over 2048 tok | % over 4096 tok | Risk |
|---------|-----------------|-----------------|------|
| fact-extractor | 77% | 0% | Medium — some truncated outputs |
| summary-extractor | 100% | 14% | High — all examples truncated |
| character-state | 92% | 8% | High — most examples truncated |
| relationship-timeline | 100% | 51% | Critical — all truncated, half severely |

**Mitigation options:**
1. Increase max_seq_length if W&B ART supports it (check API)
2. Truncate input prose to fit within budget (loses context)
3. Accept partial learning — the model may still learn extraction patterns from the prefix

### Prompt Drift

Two adapters have prompt drifts between training data and current live prompts:
- **summary-extractor:** "downstream agents" → "future chapters" 
- **character-state:** "downstream agents depend on this" → "this must be accurate to maintain continuity"

These are minor wording changes and unlikely to affect adapter performance, but should be aligned before deployment. Either revert the live prompts or retrain with current prompts.

---

## Eval Results — V1 Extractor Adapters (2026-04-13, exp #187)

Evaluated 20 samples per adapter against Sonnet-reviewed ground truth from the training JSONL. Each sample sends the identical system + user prompt to the W&B adapter, then structurally compares the output against the Sonnet-corrected assistant response. **This is on training data** — these numbers represent a ceiling on what the adapter learned, not generalization to unseen inputs.

80 total W&B Inference calls. 0 errors, 0 JSON parse failures.

### fact-extractor-v1

| Metric | Value |
|--------|-------|
| Success rate | 100% (20/20) |
| Avg latency | 2,557ms |
| Ground truth facts per chapter | 11.3 |
| Predicted facts per chapter | 10.8 |
| Matched facts (>50% word overlap) | 7.3 |
| Precision | 67.7% |
| Recall | 64.6% |
| **F1** | **65.8%** |
| Valid category usage | 100% |

**Assessment:** The 65.8% F1 is misleading — deep inspection of 5 samples reveals the adapter produces correct facts but at different granularity than the ground truth. The fuzzy word-overlap matcher penalizes legitimate extraction differences:

**Failure mode breakdown (from manual inspection of 5 samples, 53 ground truth facts):**

1. **Split facts (adapter decomposes one ground truth fact into two):** ~15% of "misses." Ground truth: "A silver spindle hidden under the desk awakens the central monitor, revealing 'Project Glyph.'" Adapter correctly outputs this as two facts — one about the spindle, one about what was revealed. Each half has <50% word overlap with the combined fact, so the matcher counts zero matches instead of one.

2. **Merged facts (adapter combines two ground truth facts into one):** ~10% of "misses." Ground truth has separate facts for a council order and its penalty clause; adapter merges them into one fact covering both. Matcher misses the penalty fact entirely.

3. **Rephrased facts (same information, different words):** ~10% of "misses." Ground truth says "the area will be redeveloped with or without Nadia's signature"; adapter omits this fact but captures the same threat differently. Word overlap falls below 50%.

4. **Genuinely dropped facts:** ~10-15% of ground truth facts are absent from adapter output. These tend to be atmospheric/physical details the Sonnet reviewer kept but the adapter deprioritized (e.g., "terminal speakers vibrate at a frequency that induces subliminal unease").

5. **Category mismatches (correct fact, wrong label):** ~10% of matched facts have category drift. "Molly's Pride thermos" categorized as `identity` in ground truth but `physical` by adapter. "Vera offers three times market value" categorized as `knowledge` in ground truth but `relationship` by adapter. These are judgment calls, not errors.

6. **Extra facts (not in ground truth):** ~5% of adapter output. Facts present in the prose but not considered continuity-critical by Sonnet.

**True semantic accuracy estimate:** Accounting for splits, merges, and rephrasings, the adapter captures ~80-85% of the ground truth information. The 65.8% F1 is an artifact of the rigid word-overlap matcher, not a reflection of extraction quality.

**Remaining gap:** The genuinely dropped facts and category mismatches suggest the adapter learned a slightly different extraction boundary than Sonnet. This is expected — 256 training examples on a 14B model won't perfectly replicate Sonnet's judgment. The question is whether this boundary is acceptable for production use.

### summary-extractor-v1

| Metric | Value |
|--------|-------|
| Success rate | 100% (20/20) |
| Avg latency | 3,703ms |
| Schema completeness | 100% (summary, keyEvents, emotionalState, openThreads) |
| Summary word count | 180.2 |
| Ground truth word count | 194.0 |
| Word ratio | 92.4% |
| Key events produced | 7.0 |
| Ground truth key events | 7.5 |

**Assessment:** Strong. All 4 required fields present in every response. Summary length is 92% of ground truth — slightly short but in range. Key events count nearly matches. Schema compliance is perfect. Ready for production validation.

### character-state-v1

| Metric | Value |
|--------|-------|
| Success rate | 100% (20/20) |
| Avg latency | 2,783ms |
| Ground truth characters per chapter | 2.5 |
| Predicted characters per chapter | 2.4 |
| Character name overlap | 2.4 |
| Name precision | 98.4% |
| Name recall | 95.9% |
| Schema completeness per character | 100% (location, emotionalState, knows, doesNotKnow) |

**Assessment:** Strong. Near-perfect character identification — 96% recall, 98% precision. Every character entry has all required fields. The adapter correctly identifies which characters appeared and produces complete state objects. Ready for production validation.

### relationship-timeline-v1

| Metric | Value |
|--------|-------|
| Success rate | 100% (20/20) |
| Avg latency | 6,873ms |
| Schema completeness | 100% (all 4 sections present) |
| relationshipChanges: predicted vs ground | 1.8 vs 1.7 |
| timelineEvents: predicted vs ground | 6.1 vs 6.4 |
| knowledgeGains: predicted vs ground | 5.6 vs 5.7 |
| awarenessChanges: predicted vs ground | 2.0 vs 1.6 |
| Valid trust level enum usage | 100% |
| Valid knowledge source enum usage | 100% |

**Assessment:** Strong despite having the worst sequence length problem (100% over 2048 tokens, 51% over 4096). All 4 JSON sections always present, enum values always valid, item counts closely match ground truth. Higher latency (6.9s) reflects the larger output size. Ready for production validation.

### Summary

| Adapter | JSON Valid | Schema | Content Match | Latency | Verdict |
|---------|-----------|--------|---------------|---------|---------|
| fact-extractor-v1 | 100% | 100% | 65.8% F1 | 2.6s | **Investigate** — low content match on training data |
| summary-extractor-v1 | 100% | 100% | 92.4% word ratio | 3.7s | **Ready** for production validation |
| character-state-v1 | 100% | 100% | 95.9% name recall | 2.8s | **Ready** for production validation |
| relationship-timeline-v1 | 100% | 100% | 100% enum/section | 6.9s | **Ready** for production validation |

### Caveats

1. **Tested on training data.** These numbers are an upper bound. Generalization to unseen chapters will be lower.
2. **Fact F1 uses fuzzy word overlap.** Two facts describing the same thing in different words will not match. The 65.8% undercounts semantic agreement — deep inspection shows ~80-85% true semantic accuracy when accounting for splits, merges, and rephrasings.
3. **Latencies include cold starts.** W&B Inference has ~2s cold start overhead. Production calls with warm cache will be faster.
4. **No cost comparison yet.** Need to measure per-call cost vs Cerebras 235B to confirm the ROI case.

---

## Improving Adapter Quality — Methodology Options

### 1. Better eval: Sonnet-as-judge semantic comparison

The current fuzzy word-overlap matcher is a crude proxy. Replace it with a Sonnet call per sample that receives both outputs and judges semantic equivalence per fact. This is the same pattern used for chapter-plan-checker and adherence eval. Cost: ~$0.50 for 80 comparison calls. This won't improve the adapters but will give us an accurate quality number to decide on.

### 2. Fix sequence truncation (highest expected impact)

W&B ART's 2048 max_seq_length truncates most training examples. The assistant response (the part the model learns from) is at the end — so it gets cut first. Impact by adapter:

| Adapter | % over 2048 | What gets truncated |
|---------|-------------|---------------------|
| fact-extractor | 77% | Last 2-4 facts cut from ~40% of examples |
| summary-extractor | 100% | openThreads/emotionalState cut from all examples |
| character-state | 92% | doesNotKnow arrays cut from most examples |
| relationship-timeline | 100% (51% over 4096) | awarenessChanges + knowledgeGains cut from most |

**Mitigation:** Truncate the *user prompt* (chapter prose) instead. The model needs to learn the output format and extraction judgment, not memorize specific prose. Cutting prose from 3,000-14,000 chars to ~4,000 chars would fit most examples within 2048 tokens while preserving the full assistant response. This requires regenerating the training JSONL with truncated inputs and retraining.

### 3. More training data (diminishing returns past ~500)

Current: 256 pairs per adapter from 50 novels. The LIMA finding (Zhou et al. 2023) suggests 1,000 high-quality examples is the sweet spot. We have ~100 more approved chapters we could generate pairs for. Expected impact: modest — the adapters already produce correct schemas, suggesting they've learned the format. More data helps with judgment calls (which facts are continuity-critical) but won't fix truncation.

### 4. Increase epochs cautiously

Current: 3 epochs on 256 pairs = 768 gradient steps. The continuity-v2 adapter showed that 12 epochs on 253 pairs caused overfitting (82% vs V1's 88%). 3 epochs is conservative. Could try 4-5 epochs for fact-extractor specifically since it has the weakest content match. Monitor training loss — if it drops below 0.1, stop.

### 5. Curriculum: train on easy examples first

Sort training examples by complexity (prose length, fact count). Train epoch 1 on the simplest 50%, then full dataset for epochs 2-3. This helps the model learn the format before tackling harder extractions. Requires custom training logic — not supported by W&B ART's current API.

### 6. KL-anchored SFT (prevents capability degradation)

Standard SFT can degrade the base model's general capabilities by 5-10%. Adding a KL divergence penalty (β=0.05) against the frozen base model reduces this to <1%. Not supported by W&B ART — would require switching to a custom training setup (Modal/Unsloth). Only worth it if we see degradation in production (e.g., adapter starts hallucinating in non-extraction contexts).

### 7. Held-out eval on unseen chapters

Run a 3-chapter novel through the full pipeline with adapters, compare extraction output against Cerebras 235B running the same pipeline. This is the production validation step — tests generalization, not memorization. Should be done for all 4 adapters before deploying.

### Recommended next steps (ordered by impact/effort)

1. **Sonnet-as-judge eval** — get accurate quality numbers (low effort, high info)
2. **Truncate user prompts and retrain** — fix the sequence length problem (medium effort, high impact)
3. **Production validation on 3 unseen chapters** — test generalization (medium effort, required before deploy)
4. **More training data** — generate pairs from remaining approved chapters (low effort, modest impact)

---

## Training Configuration (Standard)

All adapters use the same W&B ART configuration:

```
Base model:     OpenPipe/Qwen3-14B-Instruct
LoRA rank:      16
LoRA alpha:     16
LoRA dropout:   0.1
Target modules: q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj
LR:             2e-4 (cosine schedule)
Warmup:         5-10% of total steps
Batch size:     2
Max seq length: 2048
```
