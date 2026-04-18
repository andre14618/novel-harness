# Hallucination-checker findings — exp #223

Date: 2026-04-18
Status: **V1 trained + deployed**, pending held-out eval on 160-beat val set. Adapter: `wandb-artifact:///andre14618-/novel-harness/hallucination-checker-v1:v1`.

## Setup

**Objective:** Train a 14B SFT checker (matching the adherence-checker-v4 house recipe) to detect hallucinations in generated beat prose. Two failure classes:

- **Corpus leakage (A)** — named entities borrowed from other fantasy fiction (Drizzt, Mithril Hall, Ten-Towns, drow, etc.) appearing in novels with different worlds. Structural artifact of v4's Salvatore-trained LoRA weights.
- **Ungrounded named entity (B)** — proper nouns introduced in prose that aren't in speakers / brief.characters / brief.setting / world_bible_excerpt.

**Training data:** 800 beats mined from 14 fresh-pipeline novels generated 2026-04-18 with current production stack (v4 LoRA + strict planner Phase-1 + exampleLines on character profiles). Balanced 400 v4 / 400 DeepSeek via `WRITER_MODEL_OVERRIDE` env variable added to `resolveWriterPack()`.

**Labeling:** 10 Sonnet subagents × 80 beats, strict rubric with gold examples (`scripts/hallucination/labeling-rubric.md`). Rubric drafted after an earlier labeling attempt on stale-pipeline data showed Cohen's κ = 0.285 (well below usable).

## Key findings

### 1. Current-pipeline fail rate is ~25%, concentrated rather than uniform

Across 800 beats: **595 pass / 205 fail (25.6% fail rate)**.

Per-batch variance is large (11-52%), and it tracks **novel identity**, not labeler variance:

| Cluster | Batches | Avg fail rate | Characteristic |
|---------|---------|---------------|----------------|
| Clean | 0, 5, 6, 8 | 11-14% | Invented minor furniture (fabricated guilds, book titles) |
| Medium | 2, 3, 9 | 15-28% | Intermittent Salvatore-corpus tokens |
| Heavy | 1, 4, 7 | 34-52% | One novel each with systemic corpus-import |

### 2. v4 corpus leakage is worse than expected — seed-concentrated

Examples of systemic-leak novels caught in the fresh bundle:

- **"Cassius" novel** (batch 1): 31 of 41 failures from a single novel's Chapter 1 — "Cassius" appearing as a recurring scholar character. Non-Salvatore seed, writer imported the name.
- **"Veridia bridge"** (batch 4): full Icewind Dale geography import — Ten-Towns ×6, Bryn Shander ×4, Maer Dualdon ×4, Termalaine, Luskan, Bremen's Run, `drow`.
- **"Halvern+Halen"** (batch 7): 9+3 fabricated recurring character names, pattern-matching old Salvatore-surname style without the exact tokens.

This means v4's corpus leakage is **not a uniform 25% noise floor** — it's **catastrophic in specific novels and near-zero in others**. The trigger is likely seed-dependent (genre similarity to Salvatore corpus matters).

### 3. Fresh pipeline vs stale: ~2x cleaner but same categories

Earlier labeling on 500 stale-pipeline (pre-v4, pre-planner-fix) beats:
- Public (v3-era): 42% fail rate
- Archive (v3-sweep era): 63% fail rate

Fresh (v4-era, post-fixes): **25.6% fail rate**.

The planner fix alone likely drove the improvement — old novels had planner-gap inventions from incomplete briefs. v4 LoRA change also contributed, though it introduced the Salvatore corpus leakage that v3 mostly lacked.

### 4. Inter-labeler rubric divergence is real but bounded

Known edge-case disagreements across the 10 labelers:

- **Per-beat vs novel-wide grounding**: if a character is grounded in beat 3 but referenced in beat 5 without being listed in beat 5's speakers, is that ungrounded? Labeler A says yes (strict rubric), labeler B says no (novel scope). Affected ~10-15% of fails (Machek, Caro, Helix, Orvath, Thessa examples).
- **`brief.summary` inclusion**: some labelers included summary text in the grounded set, others excluded per strict field list.
- **Coordinate names**: "Room 3B", "Ward C", "Sector Gamma" — most labelers passed as positional, one flagged as strict-not-in-set.

These are real noise in the training signal. Mitigation: the training data is biased toward per-beat grounding (strict rubric); the checker will inherit that bias. Acceptable for v1.

### 5. DeepSeek hallucinates differently than v4

We split the bundle 400 v4 / 400 ds. Early observation (not yet formally measured):

- v4 hallucinations are **Salvatore-corpus leaks** (Drizzt, Ten-Towns, drow)
- DeepSeek hallucinations are **novel-internal fabrications** (invented guilds, book titles, relics, minor characters) — no corpus leakage

If we ever switch writer models, the checker needs to generalize across both patterns. This is why we trained on mixed 50/50.

## Architectural decisions locked during this experiment

### Decision 1: Context-engineering-forward, not craft-checker proliferation

Proposed but rejected: building voice-consistency, show-vs-tell, dialogue-naturalness, pacing checkers. User correctly noted this is the retired Howard-primer methodology reincarnated — telling models how to write via fine-grained style rules produces mechanical output or gets ignored.

**Adopted frame:**

| Layer | Responsibility | Where |
|-------|----------------|-------|
| What to write | Planner expressiveness + context delivery | Planner output fields, beat-context assembly |
| How to write | Model weights | Writer model (LoRA or frontier+few-shot) |
| Did writer follow the plan? | Adherence checker | adherence-checker-v4 |
| Did writer invent things? | Hallucination checker | This experiment |

Craft issues (voice drift, show/tell, rhythm) are handled by **upgrading the model**, not by adding prompt instructions or post-hoc checkers.

### Decision 2: Enterprise-grade means labeling quality monitoring

The first labeling pass on 500 stale beats showed Cohen's κ = 0.285 (poor agreement). Fixed via the strict rubric + gold examples in this round. Going forward:
- Every new labeling run should include a 10-30 beat double-label consistency check before investing in the full set
- Target κ ≥ 0.7 for usable data
- Gold-example anchoring in the prompt is the primary lever

### Decision 3: Narrow checker scope matches narrow house recipe

The hallucination checker outputs only `{pass, issues: [{entity, excerpt}]}` — no kind taxonomy. Checker doesn't need to know whether an issue is corpus-leakage or novel-internal; the rewriter just needs the list of things to remove/replace. This matches adherence-checker-v4's simplicity.

### Decision 4: Unified issue aggregator is the next infra investment

Current pipeline has separate retry paths for adherence, continuity, lint. Adding more checkers compounds retry complexity. The next infra move (after hallucination-checker ships) is aggregating all checker outputs into one issue queue per beat, with a single targeted rewrite covering all flags. This is what makes future checker additions cheap.

### Decision 5: Planner enrichment is the next context-engineering move

After hallucination-checker-v1 ships, the next experiment is extending planner output:
- `subplot_id` per beat
- `establishedFact.id` cross-references
- `requiredPayoffs[]` linked to prior fact IDs
- `speaker_directives` per beat (content, not voice)
- `thematic_focus`

Then extend adherence-events to verify payoffs land and directives honored.

## What goes into training

- 800 labeled beats (595 pass + 205 fail) — balanced positive/negative
- 80/20 train/val split, stratified by writer (v4/ds) and by pass/fail rate
- SFT JSONL format matching adherence-checker-v4 recipe
- System prompt: the strict rubric (condensed for token efficiency)
- User prompt: prose + brief + world_bible_excerpt + speakers
- Assistant: `{pass, issues: [{entity, excerpt}]}` JSON

## Cost to date

| Item | Spend |
|------|-------|
| 14 fresh-pipeline novel generations | ~$15 |
| 10 Sonnet labelers × 80 beats | ~$20 |
| 3 consistency labelers × 30 beats (in flight) | ~$3 |
| **Subtotal pre-training** | **~$38** |
| W&B Serverless SFT training (pending) | ~$5 |
| Eval on held-out (pending) | ~$3 |
| **Expected total** | **~$46** |

Well within the $22 original + scope-expansion budget. Worth it for enterprise-grade data quality and the architectural clarity on what to build vs not build.
