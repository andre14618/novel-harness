---
status: active
updated: 2026-04-16
---

# Pipeline 14B Consolidation — Slot-by-Slot Analysis

Living analysis of whether each LLM slot in the harness can run on a single base (`OpenPipe/Qwen3-14B-Instruct` + task-specific LoRAs on W&B Inference) instead of the current mix of DeepSeek V3.2 / Cerebras 235B / Groq Llama / multiple providers.

This is a **strategy doc**, not a commitment. Each slot has its own eval bar. Do not migrate a slot until it clears the bar. "Everything on 14B" is a possible endpoint, not a target.

---

## Why the question matters

1. **Cost.** 14B on W&B is $0.05/$0.22 per 1M vs DeepSeek V3.2 at $0.28/$0.84 per 1M — ~4× cheaper per token. At solo-dev volume the absolute savings are small ($0.75 vs $3 per 10-chapter novel), but at any eventual scale they compound.
2. **Prefix caching.** One hot base means every agent benefits from the same prefix cache. Today each provider has its own cache behavior; DeepSeek's Howard-primer 94% hit rate is single-provider.
3. **Tuning surface.** If the writer moves to 14B, we can imprint voice (Salvatore v2 proved it). If the concept/planner moves to 14B, we can distill DeepSeek's behavior into adapter weights and iterate on top.
4. **Operational simplicity.** One provider, one rate limit story, one latency tail.

**None of these forces the migration.** Capability must clear first.

---

## Current slot assignments (from `src/models/roles.ts` as of 2026-04-16)

| Slot | Current model | On 14B? | Tunable? |
|---|---|:---:|:---:|
| planning-conversationalist | Groq Qwen3-32B | ✗ | probably |
| planning-extractor | DeepSeek V3.2 | ✗ | ✓ |
| concept (world, char, plotter) | DeepSeek V3.2 | ✗ | unknown |
| planning-plotter | DeepSeek V3.2 | ✗ | unknown |
| beat-writer | DeepSeek V3.2 + Howard primer | ✗ | **probing** (Salvatore v2) |
| reference-resolver | Groq Llama-3.1-8B | ✗ | n/a (already cheap) |
| adherence-events | Qwen3-14B SFT v4 | ✅ | shipped |
| chapter-plan-checker | Qwen3-14B SFT v2 | ✅ | shipped |
| continuity (2 parallel) | Qwen3-14B SFT v2 | ✅ | shipped |
| lint-fixer | Cerebras Qwen 235B | ✗ | ✓ |
| rewriter | DeepSeek V3.2 | ✗ | probably (once beat-scoped) |
| tonal-pass | Qwen3-14B SFT v4 (on-demand only) | ✅ | shipped |
| voice (fantasy seeds) | Qwen3-14B + salvatore-1988-v2 | ✅ | shipped |

**Five checker slots + one voice adapter already on 14B. Seven creative/planning slots are the gap.**

---

## Risk-ranked migration plan

Slots listed easiest → hardest. The harder the slot, the more evidence needed before committing. Every migration is gated on ≥95% agreement vs the current model on held-out evals.

### Tier 1 — Mechanical rewriting (low risk)

#### Lint-fixer
- **Current:** Cerebras Qwen 235B, per-sentence rewrite.
- **Why it moves cleanly:** Narrow task — receive flagged sentence + lint rule, emit rewrite. `docs/lessons-learned.md` exp #72 shows K2/235B/DeepSeek all at 100% on this shape; it's not a model-capability task.
- **Data:** 200+ examples mineable from approved chapter lint-fix logs.
- **Path:** SFT distill from 235B outputs → 14B adapter. Evaluate on lint-compliance + collateral damage metrics. Direct teacher replacement.
- **Unblocker:** none — can do today.

#### Rewriter (beat-scoped only)
- **Current:** DeepSeek V3.2, chapter-scoped (~1,200w in/out).
- **Blocked on:** collapsing chapter rewrite → beat rewrite (see `docs/retry-surface-audit.md` + validation.ts audit 2026-04-16). Once beat-scoped, input/output size matches adherence-checker targeted-rewrite shape (~400w), which 14B already handles.
- **Why it moves cleanly (post-collapse):** the rewriter agent largely dissolves — targeted beat rewrites already live in `src/phases/drafting.ts:151-212`.
- **Unblocker:** the beat-scope refactor (add `beat_id` to issues table, delete `src/agents/rewriter/`, route issues back through drafting retry surface).

### Tier 2 — Schema-constrained generation (medium risk)

#### Planning-extractor
- **Current:** DeepSeek V3.2.
- **Task:** unstructured transcript → `PlanningDirectives` JSON.
- **Why it's tractable:** Extraction shape is the closest-to-checker among the generation slots. Structured output, bounded reasoning.
- **Data path:** log DeepSeek outputs during pre-planning conversations, distill onto 14B.
- **Evidence base:** Adherence/chapter-plan/continuity all proved 14B SFT matches Sonnet-level teacher accuracy when the data is sufficient.

#### Concept agents (world-builder, character-agent, plotter)
- **Current:** DeepSeek V3.2.
- **Task:** each emits a structured artifact (world bible, character sheet, plot arc). Creative but schema-bounded.
- **Why it might move:** individual agent output shapes are narrow. The creative surface is small per call.
- **Why it might not:** no prior evidence on 14B SFT for creative-schema tasks. Would need per-agent SFT with ~200–500 pairs each.
- **Evidence still owed:** one-agent pilot (probably world-builder — simplest schema) before generalizing.

### Tier 3 — Constraint-following over long outputs (unresolved)

#### Beat-writer
- **Current:** DeepSeek V3.2 + Howard primer. Primary creative slot.
- **What's been proved:** Salvatore v2 LoRA on 14B produces target-author voice (Δ-sum 0.27 on val, 0.66 on unseen characters) with paragraph breaks and low memorization. See `docs/voice-lora-salvatore.md`.
- **What hasn't been proved:** whether 14B with a voice LoRA can hold a ~2,000-word chapter plan in context across 15–20 serial beats without drifting off-brief, and whether chapter 3 references chapter 1 events correctly when none of the continuity is in the LoRA's training data.
- **The gate:** 3-chapter production run with `beat-writer = salvatore-1988-v2`. Watch adherence pass rate (currently ~79% first-attempt on the 235B-adherence-checker baseline). If it holds, 14B is a viable primary writer on matched-genre seeds. If it collapses (<50%), voice LoRAs stay as opt-in style primers and the writer slot stays on DeepSeek.

#### Planning-plotter
- **Current:** DeepSeek V3.2. Emits ~18 beats + world-state deltas per chapter.
- **Why it's harder:** long structured output with inter-beat dependencies. Errors compound across the chapter.
- **Why not today:** wait on the beat-writer gate. If 14B fails writing, it likely fails planning too (same constraint-following muscle).
- **If we try:** SFT distill from DeepSeek on ~500 pairs across 5+ genres. Evaluate against `chapter-plan-checker` on held-out seeds.

### Tier 4 — Dialogue-like free-form (defer indefinitely)

#### Planning-conversationalist
- **Current:** Groq Qwen3-32B. Interactive 8-phase Q&A with sparsity detection.
- **Why defer:** multi-turn state tracking, branching conversation flow. The hardest shape of all — state survives across turns, not just within one call.
- **Verdict:** no migration plan unless/until the creative tier (beat-writer, planning-plotter) all move successfully. If the creative tier fails to move, this certainly won't.

---

## The 3-chapter gate that decides the creative tier

**Test:** run a full 3-chapter novel with `beat-writer = wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v2:v1` on a Salvatore-style action-pulp fantasy seed. All other slots unchanged.

**Pass criteria:**
- Adherence first-attempt pass rate ≥ 70% (baseline is 79% on current DeepSeek writer)
- Chapter-plan checker pass rate ≥ 85% (baseline is ~90%)
- No more than 1 continuity blocker across the 3 chapters
- Voice metrics match Phase C.3 val results (Δ-sum ≤ 0.5)
- Paragraph breaks present in dialogue beats

**Fail criteria:** any one pass rate collapses > 20pp from baseline, OR > 2 continuity blockers, OR Δ-sum > 1.0 on chapter-level aggregate.

**If it passes:** Tier 2 (planning-extractor, concept agents) become worth pursuing. The 14B-everywhere direction is real.
**If it fails:** voice LoRAs stay as an opt-in style layer. Writer slot stays on DeepSeek. Checker tier stays on 14B. Tier 1 (lint-fixer, rewriter beat-scope) still moves — they're lower-capability tasks that were never blocked by the creative question.

Either outcome is informative. The probe costs ~$0.30 in compute.

---

## Economics sanity check

At solo-dev volume (~10 novels/month × 3 chapters avg → 30 chapters/month):

| Scenario | Writer cost/chapter | Monthly writer spend |
|---|---:|---:|
| Current (DeepSeek V3.2 + primer) | $0.26 | $7.80 |
| All-14B (hypothetical) | $0.07 | $2.10 |
| **Delta** | **−$0.19/chapter** | **−$5.70/month** |

Training budget: $0.10–0.60 per LoRA run × ~6 new adapters to cover the migration = $1–4 one-time. Break-even within 1 month, immediately ongoing savings thereafter.

**At current scale, cost is not the forcing function.** Operational simplicity (one provider, one prefix cache) and tuning freedom (every slot becomes SFT-able on a shared base) are the stronger arguments.

---

## Prerequisites before starting any Tier 2+ migration

1. **Beat-scoped rewriter collapse** (`docs/retry-surface-audit.md` + the 2026-04-16 validation.ts audit). Removes the 1,200w chapter-rewrite shape that 14B measurably fails on.
2. **Genre-slot routing in `src/models/roles.ts`.** Per-seed writer override so Salvatore LoRA hooks in for fantasy seeds without disturbing other genres.
3. **Proper-noun blocklist in voice LoRA system prompt.** Stops trained-lore leaks.
4. **Drop per-beat word-count gate from the adherence checker.** Voice LoRAs don't reliably land exact word counts; the gate was noise regardless.

Items 1–4 are the same set enabling the 3-chapter gate, so they're shared prerequisites. None are expensive.

---

## Status tracker (update as slots move)

| Slot | Current status | Last validated |
|---|---|---|
| adherence-events | **On 14B** (SFT v4) | 2026-04-09, exp #135 |
| chapter-plan-checker | **On 14B** (SFT v2) | 2026-04-12, exp #178 |
| continuity | **On 14B** (SFT v2) | 2026-04-12, exp #175 |
| tonal-pass (on-demand) | **On 14B** (SFT v4) | 2026-04-11 |
| voice (fantasy seeds) | **On 14B** (salvatore-1988-v2) | 2026-04-16, exp #194 |
| lint-fixer | Current: Cerebras 235B. Next: Tier 1 SFT. | — |
| rewriter | Current: DeepSeek V3.2. Next: beat-scope refactor. | — |
| planning-extractor | Current: DeepSeek V3.2. Gated on beat-writer probe. | — |
| concept (world/char/plot) | Current: DeepSeek V3.2. Gated on beat-writer probe. | — |
| planning-plotter | Current: DeepSeek V3.2. Gated on beat-writer probe. | — |
| beat-writer | Current: DeepSeek V3.2 + primer. **3-chapter gate pending.** | voice validated 2026-04-16 |
| reference-resolver | Current: Groq Llama-3.1-8B. No migration planned (already cheap). | — |
| planning-conversationalist | Current: Groq Qwen3-32B. Deferred indefinitely. | — |

---

## Pointers

- Architectural decisions: `docs/decisions.md`
- Model capability numbers: `docs/model-capability-matrix.md`
- Voice LoRA methodology: `docs/voice-lora-salvatore.md`
- Fine-tuning strategy + adapter roadmap: `docs/fine-tuning-strategy.md`
- Retry surfaces + rewriter audit: `docs/retry-surface-audit.md`
- LoRA cost / W&B economics: `docs/lessons-learned.md` "RunPod dedicated GPU is 2× more expensive…" + "W&B Serverless SFT is no longer free…"
