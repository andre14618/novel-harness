---
status: active
updated: 2026-04-08
---

# To Do

Items removed when done — git history has the record. Ordered by impact.

## Fine-Tuning serving infrastructure — DECIDED 2026-04-07: W&B Inference on Qwen3-14B-Instruct

The serving plan for fine-tuned adapters was reworked during the 2026-04-07 architectural session. **Fireworks does NOT support serverless LoRA** (verified at https://docs.fireworks.ai/models/overview — "Neither custom base models nor LoRA addons are supported for serverless inference"). **W&B Inference DOES** (https://docs.wandb.ai/inference/lora) — CoreWeave-backed, pay-per-token at base-model rates, no LoRA surcharge, against a fixed list of supported bases.

W&B supported bases (as of 2026-04-07):
- `meta-llama/Llama-3.1-8B-Instruct` — $0.22/$0.22 (worse than Qwen3-14B in every dimension; not used)
- `meta-llama/Llama-3.1-70B-Instruct` — $0.80/$0.80 (overkill for analytical agents)
- `openai/gpt-oss-120b` — $0.15/$0.60 (the existing chapter-plan-checker model; reserve as fallback for harder analytical tasks)
- **`OpenPipe/Qwen3-14B-Instruct` — $0.05/$0.22 — chosen as the analytical multi-task LoRA base** (CoreWeave acquired OpenPipe in Sept 2025, so this is W&B's preferred fine-tune base; non-thinking-default chat template avoids the Together Qwen 3.5 9B thinking-on-by-default trap)
- `Qwen/Qwen3-30B-A3B-Instruct-2507` — $0.10/$0.30 (was the leading candidate before the probe; killed by latency — see below)

Notably absent: Qwen3 8B, Qwen3 4B-Instruct-2507, Qwen 3.5 9B (the base of the existing v3 Howard tonal-pass adapter). Any LoRA we want to serve on W&B has to be (re)trained on a supported base.

**Latency probe results (2026-04-07, `tuning_experiment` id=94, `scripts/test-wandb-inference.ts`)**: 5 parallel calls per cell × 4 models × 3 workload shapes. Decision criterion was "viable if beat-writer-shape avg ≤ 3× Cerebras Qwen 235B baseline (≤4.5s)."

| model | reference-resolver avg | adherence-checker avg | beat-writer avg | vs baseline (writer) | verdict |
|---|---:|---:|---:|---:|---|
| Qwen3-14B-Instruct (OpenPipe) | 741ms | **157ms** | 2008ms | **1.3×** | **VIABLE — chosen** |
| Qwen3-30B-A3B-Instruct-2507 | 3393ms | 7172ms (33s p95!) | 16268ms | 10.7× | TOO SLOW (cold-start sensitive on W&B) |
| openai/gpt-oss-120b | 2148ms | 3881ms | 7339ms | 4.8× | MARGINAL (fallback for chapter-plan-checker only) |
| Qwen3-235B (Cerebras baseline) | 385ms | 365ms | 1520ms | — | — |

**Headline finding: Qwen3-14B-Instruct on W&B is FASTER than Cerebras Qwen 235B on adherence-checker** (157ms vs 365ms — small-output decode is the bottleneck and the 14B decodes faster than the 235B). For reference-resolver and beat-writer it's within 2× baseline. ~10× cheaper per call.

**Decision**: multi-task LoRA on `OpenPipe/Qwen3-14B-Instruct` for the three analytical agents (adherence-checker, reference-resolver, chapter-plan-checker). One base, one training run, one deployment.

**Provider plumbing done (commit `5191e98`)**: `wandb` registered as a provider in `models/registry.ts` with the four candidate model entries. End-to-end smoke test through `getTransport().execute()` confirmed: 410ms for a single tiny call against `OpenPipe/Qwen3-14B-Instruct`, auth via `WANDB_API_KEY` works, OpenAI-compatible payload works, no extraBody quirks. The harness can now route to W&B; no agent assignments yet because there's no LoRA to point at.

**Next action items, in order**:

1. **Research the LoRA training side** — figure out the right training provider for `OpenPipe/Qwen3-14B-Instruct`. The output needs to be a PEFT-format adapter that W&B Inference will accept as a LoRA artifact. Candidates:
   - **W&B's own LoRA training service** — cleanest if it exists for this base. The CoreWeave/OpenPipe acquisition (Sept 2025) suggests this is the intended on-ramp.
   - **Together AI's training service** — proven (we used it for tonal-pass v3) but training and serving aren't co-located.
   - **OpenPipe's own training tooling** — they're the maintainers of this base; their training stack should produce W&B-compatible artifacts by definition.
   - **Local one-off training** on a rented GPU instance — most control, most setup. Last resort.
   This is the next concrete blocker. ~half day of research + testing one path.

2. **Use the existing 111 training pairs** to seed the multi-task LoRA. They were generated 2026-04-07 via `scripts/build-analytical-finetune-data.ts` (oracle = Cerebras Qwen 235B): 35 adherence-checker (with beat-writer pre-step + truncation rejects filtered), 58 reference-resolver, 18 chapter-plan-checker. Spot-check ~10% via `/app/finetune` first to validate oracle quality. If pairs look good, train. If not, expand the dataset with `--limit 30` runs first.

3. **Wire `models/roles.ts`** to route adherence-checker, reference-resolver, and chapter-plan-checker through the LoRA — once it's deployed. Until then those slots stay on their current models (Cerebras Qwen 235B / Llama 8B Groq / gpt-oss-120b Groq).

4. **Validate the LoRA against the oracle** before swapping in production. Same shape as the latency probe but measuring agreement: run N inputs through both the LoRA and Cerebras Qwen 235B, compute agreement rate. Decision criterion: ≥95% agreement for a swap.

**Tonal-pass v4 retrain on Qwen3-14B is OFF the table** (was a follow-up in the previous version of this todo). Retraining on a less-capable older base just for unified serving was based on the wrong capability framing — corrected per `docs/lessons-learned.md` "Don't compare model size without checking generation." Howard tonal-pass v3 stays on Together AI as the legacy serving home until/unless retrained on a W&B-supported base.

**DeepInfra is NOT a viable serving home for our LoRAs** (corrected 2026-04-08 — see `docs/lessons-learned.md` "DeepInfra Custom LLMs is dedicated GPU rental"). The previous version of this todo proposed DeepInfra as a serverless alternative because AA's per-provider numbers showed DeepInfra serving stock Qwen 3.5 9B 3.1× faster than Together. That was a conflation: DeepInfra has two different products, and the one that hosts user-uploaded adapters ("Custom LLMs") is dedicated GPU rental at $2-5/hr per A100/H100 with weekly invoicing — uneconomical for our bursty solo-developer traffic by 2-3 orders of magnitude. The W&B/Qwen3-14B plan above stands unchallenged.

## Fine-Tuning data generation — unchanged direction, base model TBD

LoRA fine-tunes have historically targeted Qwen 3.5 9B on Together ($0.48/M training tokens, $0.10/$0.15 inference). Going forward the base will likely change to whichever W&B supports for the slot — probably Qwen3 30B A3B Instruct 2507 for creative LoRAs and OpenPipe Qwen3 14B Instruct for structured/analytical LoRAs. Knowledge distillation: base model outputs, human reviews/corrects in Claude Code, corrected outputs become training data. Generic prompts — training data teaches behavior, not the prompt.

- **Run fact-extractor dataset generation** — `bun scripts/build-finetune-data.ts --task fact-extractor --limit 50` on LXC. Review 20-30 pairs in Claude Code, correct to gold standard, then scale to 300+.
- **Adherence-checker fine-tune** — runs every beat, high frequency. Classification task (pass/fail + deviation). Needs beat-level training data — generate novels with beat pipeline and log beat/draft/adherence pairs.
- **Reference-resolver fine-tune** — runs every beat. Identify needed lookups from implicit references. Same beat-level data source.
- **Chapter plan checker fine-tune** — runs once per chapter. Compare prose against plan, report structural deviations or PASS. ~3-5K token input. Now serving from `openai/gpt-oss-120b` on Groq (was llama-3.1-8b-instant — too small to reason through structural requirements, kept bouncing valid prose and spinning the drafting retry loop). Prerequisite: persist `(prose, plan, deviations, passed, model)` to a new `chapter_plan_checks` table so each real chapter generates a labeled training example. After ~50-100 examples accumulate, train a LoRA on a W&B-supported base (gpt-oss-120b is on the supported list — natural distillation target since it's already the production checker), evaluate vs GPT-OSS baseline, swap in if accuracy matches.
- **Tonal pass expansion** — V3 LoRA trained on Howard only (sword-and-sorcery). Need multi-genre corpus. Copyright considerations documented in `docs/ai-training-copyright-landscape.md`. Public domain authors: Hemingway (pre-1929), London, Cather, Fitzgerald. Back-translation pipeline exists (`scripts/generate-tonal-pairs.ts`).
- **Test tonal pass V3 in production** — enable `pipeline.tonalPass`, run on a novel, compare before/after. **Note**: this still uses the Together-served v3 adapter on Qwen 3.5 9B. The W&B retraining (above) is a separate decision; production-test the existing adapter first to validate the style transfer before investing in v4 on a new base.

## Pipeline Tuning

- **Tighten fact extractor** — still 17-20 facts/chapter, target 8-15. Precision matters now that facts feed deterministic queries.
- **Word count below target** (550-770 vs 800-1100). May be model, prompt, or beat granularity issue.
- **Switch extractionMode to "plan"** — once planner's state outputs are verified against a few novels, disable LLM extractors (except relationship-timeline which produces data the planner doesn't). Currently set to "both".
- **Re-evaluate lint system role** — if tonal pass LoRA already reduces AI cliches, lint becomes a safety net, not a pipeline stage. Test: run lint on tonal-pass outputs vs base outputs.
- **Strip anti-pattern list from rewriter prompt** — rewriter can't self-police cliches (proven). Lint + tonal pass handles this.
- **Skip re-extraction for prose-only rewrites** — if rewrite only fixes cosmetic issues, extraction results are still valid.

## Character Voice

- **Add speech profiles to character-agent** — concrete attributes per character (register, vocabulary, patterns, forbidden phrases). Current `speechPattern` field captures this as free text but needs to be richer for downstream checking.
- **Character voice checker** (future fine-tune) — per-beat check that dialogue matches character speech profile. Needs speech profile infrastructure first.

## Autoresearcher

- Rename daemon → autoresearcher across codebase
- Refocus on structured quality signals — adherence pass rates, plan check rates, lint counts, extraction precision/recall
- Remove all LLM judge and embedding-related optimization targets

## Pipeline Stability

- Deduplicate timeline events in DB — rewrite re-extractions create duplicate events
- Clean up stale DB data: incomplete novels, orphan benchmark runs, experiments without conclusions

## Infrastructure

- Add context inspection view to web UI (show what the writer/beat-writer received)
- **Mac Mini as local inference provider** — Ollama + `qwen3.5:9b` resident in memory, registered as a `local` provider in `models/registry.ts` pointing at `http://mac-mini:11434/v1` (or Tailscale IP). Cost: ~$2-4/month electricity, zero per-token. Role: background/batch jobs only — tonal-pass pair generation (back-translation), analytical LoRA input generation, agreement probes, offline prompt iteration. Not for online per-beat inference. Hardware already exists alongside Proxmox setup.

## Seeds & Testing

- Create 3-5 new seeds stressing different scenarios: complex magic systems, many POV characters, dense continuity, dialogue-heavy

## Future — Worldbuilding Workbench (separate project)

Interactive chat frontend backed by the knowledge graph. Author converses with their world, modifies plotlines, generates beats, adjusts world state. Output is a structured plan that feeds the harness. Workbench writes to knowledge graph, harness reads from it. Same Postgres tables, different interface. Semantic search / embeddings may be useful here for exploratory authorial queries. Entirely separate from the prose generation pipeline.
