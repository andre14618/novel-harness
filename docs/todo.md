---
status: active
updated: 2026-04-08
---

<!-- Last edit: added LLM call inspector (sql/017_llm_call_inspection.sql, /app/llm-calls). See docs/llm-call-inspector.md. -->


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

**Training provider decided (2026-04-08, revised same day): W&B Serverless SFT (ART framework) — fully on-platform.** W&B does have a managed fine-tuning service: Serverless SFT powered by OpenPipe's ART framework on CoreWeave GPUs. `OpenPipe/Qwen3-14B-Instruct` is ART's own fine-tuning-optimized fork of Qwen3-14B — training against it is the native path. Training is **free during public preview**; adapter is auto-saved as a W&B artifact and immediately routable via W&B Inference. Storage is free under the 100GB free tier (a r=16 PEFT adapter is ~50MB; even at $0.03/GB/month overage that's $0.0015/month). No Modal, no manual upload. ART docs: https://art.openpipe.ai/fundamentals/sft-training

**Next action items, in order** (revised 2026-04-08 after the four-task baseline+checklist ladder series PLUS the per-call decomposition follow-ups #122/#123 — see `docs/lessons-learned.md` entries from "Adherence-checker base-model ladder" through "Per-API-call decomposition"):

> The original "train one multi-task LoRA on all three analytical agents using Qwen 235B as oracle" plan is dead. The four-task + decomposition series showed (a) reference-resolver doesn't need SFT at all, (b) continuity's would-be teacher (235B) misses 90% of warnings — distilling it would teach the student to also miss them, (c) **adherence-checker can be most-of-the-way fixed by a prompt swap alone (#122 closed half the SFT gap with no training)**, and (d) the right teacher is task-specific, not "whatever's already in the pipeline." See `project_four_task_sft_ladder.md` memory.

1. **~~Swap continuity 235B to the checklist prompt in production.~~** DONE (2026-04-09). Prompt, schema, and context updated. Needs production validation: run a 3-chapter romance-drama and compare continuity check quality vs the old flat prompt.

2. **Adherence-checker SFT — DEMOTED, conditional on 4-call prompt holding in production.** With the decomposed prompt at 91% on 14B (within 6pp of 235B teacher), SFT may not be needed at all. Re-evaluate after a few more production novel runs accumulate. If a 6pp gap is still worth closing, the SFT teacher signal should come from the *decomposed* 235B (97%), NOT the flat single-call prompt — that means relabeling the 160 synthetic pairs through the 4-call pipeline so the student learns the same shape as production.

3. **(Conditional on #2) Submit adherence-checker SFT via ART + W&B Serverless SFT** — `base = OpenPipe/Qwen3-14B-Instruct`, `rank = 16`, `alpha = 16`, `epochs = 1–2`, `ServerlessBackend`. ART auto-saves the checkpoint as a W&B artifact and makes it routable through W&B Inference. Free during public preview. Docs: https://art.openpipe.ai/fundamentals/sft-training

4. **(Conditional on #3) Validate adherence-checker LoRA against a held-out 50-pair production set** — agreement rate vs the decomposed-235B teacher per failure-mode variant. Decision criterion: ≥95% on PASS variants, ≥90% on FAIL_MISSING/CHAR/TANGENT. If passes, wire `models/roles.ts` to route adherence-checker through the LoRA.

5. **(Conditional on #4) Post-SFT: GRPO/RL loop for adherence-checker** — adherence-checker is the only one of the four analytical agents with a clean reward signal (the deterministic checks — character presence, word count, dialogue — plus synthetic labels compose into a fully automatic reward function). After the SFT baseline lands, design a GRPO loop on the same W&B/ART stack using the deterministic verifier as the reward. None of the other three analytical agents qualify: continuity has no reliable verifier (that IS the bottleneck), chapter-plan-checker uses an LLM judge (brittle), reference-resolver has no real production deficit.

6. **Chapter-plan-checker per-beat decomposition is DISCONFIRMED — flat single-call stays.** Exp #123 (2026-04-08) tested splitting the chapter-plan check into N parallel per-beat calls. gpt-oss-120b regressed 90% → 64%, Qwen 235B 81% → 72%. Per-beat compounds error multiplicatively (0.9⁴ ≈ 66% pair-level for a 4-beat chapter at 90% per-beat) and can't see cross-beat properties like FAIL_REVERSED_ARC (0–22% across all four models). The chapter-plan-checker SFT path via gpt-oss-120b distillation (`project_chapter_plan_checker_finetune.md`) is unchanged and still validated.

7. **Continuity SFT — BLOCKED until labeling pipeline is built.** The four-task ladder showed 235B itself is missing 90% of warnings and 65% of nits in the synthetic eval, so distilling 235B would replicate exactly that failure. Path forward: (a) build a Claude-as-teacher labeling script (Opus or Sonnet 4.6 — NOT gpt-oss, which is peer-tier with 235B on this task), (b) hand-validate the WARNING and NIT variant injections in `scripts/generate-continuity-data.ts` first, since the bench may itself be measuring "task fundamentally hard" rather than "model deficit," (c) re-run #117/#118 with Claude as the teacher to confirm Claude meaningfully exceeds 235B before committing to a full data run. Cost at scale: ~1000 pairs at ~3K in / 1K out ≈ $120 (Opus) / $15 (Sonnet) — trivial.

8. **Reference-resolver SFT is OFF the list permanently.** Flat 14B is at 97.5% recall against the synthetic labels and reference-resolver's production cost function favors recall (over-fetch nearly free, miss costly). No real deficit to train against. The exp #115 "checklist wins" framing was a metric artifact — see the amendment in the lessons-learned reference-resolver entry.

**Tonal-pass v4 retrain on Qwen3-14B is OFF the table** (was a follow-up in the previous version of this todo). Retraining on a less-capable older base just for unified serving was based on the wrong capability framing — corrected per `docs/lessons-learned.md` "Don't compare model size without checking generation." Howard tonal-pass v3 stays on Together AI as the legacy serving home until/unless retrained on a W&B-supported base.

**DeepInfra is NOT a viable serving home for our LoRAs** (corrected 2026-04-08 — see `docs/lessons-learned.md` "DeepInfra Custom LLMs is dedicated GPU rental"). The previous version of this todo proposed DeepInfra as a serverless alternative because AA's per-provider numbers showed DeepInfra serving stock Qwen 3.5 9B 3.1× faster than Together. That was a conflation: DeepInfra has two different products, and the one that hosts user-uploaded adapters ("Custom LLMs") is dedicated GPU rental at $2-5/hr per A100/H100 with weekly invoicing — uneconomical for our bursty solo-developer traffic by 2-3 orders of magnitude. The W&B/Qwen3-14B plan above stands unchallenged.

## Fine-Tuning — Full Strategy

See `docs/fine-tuning-strategy.md` for the complete plan. Training is free (W&B Serverless SFT, public preview). Inference is $0.05/$0.22 per 1M tokens. One base — `OpenPipe/Qwen3-14B-Instruct` — multiple task adapters. Every agent is a candidate. Full priority ranking, data sources, and evaluation protocol are in the strategy doc.

**Phase 1 — Analytical agents** (revised 2026-04-08 after the four-task baseline+checklist series AND the per-call decomposition follow-ups #122/#123 — see "Fine-Tuning serving infrastructure" section above for the full action list and `project_four_task_sft_ladder.md` memory):

- **Adherence-checker — PROMPT SWAP SHIPPED (2026-04-08), SFT DEMOTED to conditional.** 4-call decomposed prompt (events/setting/tangent/character) shipped in `src/agents/writer/adherence-checker.ts` and production-validated: fire rate dropped from 57% → 22% on a 3-chapter romance-drama run. 14B 79% → 91%, 235B 96% → 97% (exp #122). Re-evaluate SFT after production accumulates more data — the remaining 6pp gap on 14B may not be worth a training run. If SFT happens, label through the *decomposed* 235B (97%), not the flat prompt.
- **Chapter-plan-checker — CHECKLIST PROMPT SHIPPED (2026-04-09, exp #124).** Structured checklist schema swapped in: 14B vs labels 53% → 75% (+22pp), 14B↔120B direct 58% → 75% (+17pp). Bias corrected: was 100% one-sided (14B rubber-stamps PASS), now symmetric except `FAIL_REVERSED_ARC` (0/2 — 14B reasoning ceiling on arc reversal). SFT target is now the checklist output format, not the flat schema. Distillation pairs must be labeled through the 120B checklist path. See `project_chapter_plan_checker_finetune.md`.
- **Continuity — CHECKLIST PROMPT SHIPPED (2026-04-09).** Structured checklist schema swapped in (fact_checks → state_checks → figurative_review → derived_issues → issues). Exp #118 showed +0.086 F1 with checklist vs flat. SFT still BLOCKED on a stronger labeling pipeline — 235B misses 90% of warnings and 65% of nits (#117/#118). Path forward: Claude-as-teacher labeling script + hand-validation of WARNING/NIT synthetic variants.
- **Reference-resolver — OFF the list.** Flat 14B already at 97.5% recall against synthetic labels; production cost function favors recall (over-fetch nearly free, miss costly). No real deficit to train against. (#114/#115, see amendment in lessons-learned.)

**Phase 2 — Tonal pass v4 + fact extractor** (data exists or easy to generate):

- **Tonal pass v4** — retrain `howard-tonal-pairs-curated.jsonl` on Qwen3-14B via ART. Evaluate against v3 on the same 15-paragraph test set (bigram perplexity, adjective density, word count). Serve via W&B Inference instead of Together.
- **Burn Together AI credits on tonal pair generation, then remove provider** — $10-12 remaining. Use `scripts/generate-tonal-pairs.ts` pointed at Together's Qwen3 235B A22B Instruct 2507 FP8 ($0.20/$0.60, better flattening quality than current Groq 32B). Once exhausted: remove `TOGETHER_API_KEY`, remove Together entries from `models/registry.ts`, remove provider config.
- **Fact extractor** — `bun scripts/build-finetune-data.ts --task fact-extractor --limit 50`, review 20-30 pairs, correct to gold (target: 8-12 facts/chapter vs current 17-20), scale to 300+.
- **Tonal pass expansion** — multi-genre corpus after v4 validates. Public domain: Hemingway (pre-1929), London, Cather, Fitzgerald. Copyright notes in `docs/ai-training-copyright-landscape.md`.
- **Test tonal pass V3 in production first** — enable `pipeline.tonalPass`, run a novel, compare before/after. Production-test the existing adapter before investing in v4.

**Phase 3 — Continuity** (highest ROI, requires schema work):

- Design compact world-state diff format (new facts, changed character states, new events only — not full dump).
- Generate training data against new format using 235B oracle.
- Expected outcome: 7,294 → ~1,000 input tokens per call = 7× cost reduction on the highest-cost slot.

**Phase 4 — Lint fixer + beat writer** (opportunistic):

- **Lint fixer** — mine approved chapters for `(flagged_sentence, scene_context, good_rewrite)` triples. 200-300 examples across AI cliché pattern types. Low risk.
- **Beat writer** — highest upside (7.8× cheaper), highest risk (quality regression breaks pipeline). Shadow-run in parallel with 235B. See strategy doc for validation bar.

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

- **Mac Mini as local inference provider** — Ollama + `qwen3.5:9b` resident in memory, registered as a `local` provider in `models/registry.ts` pointing at `http://mac-mini:11434/v1` (or Tailscale IP). Cost: ~$2-4/month electricity, zero per-token. Role: background/batch jobs only — tonal-pass pair generation (back-translation), analytical LoRA input generation, agreement probes, offline prompt iteration. Not for online per-beat inference. Hardware already exists alongside Proxmox setup.
- **Extend LLM call inspector tags to non-drafting agents** — `chapter` / `beat_index` / `attempt` are populated for `beat-writer` and `adherence-checker`. Threading through `reference-resolver`, `continuity`, `chapter-plan-checker`, `rewriter`, planner, and extractors is straightforward (columns already exist) but hasn't been done. Each agent's `callAgent` site needs the tags added. See `docs/llm-call-inspector.md`.

## Seeds & Testing

- Create 3-5 new seeds stressing different scenarios: complex magic systems, many POV characters, dense continuity, dialogue-heavy

## Future — Worldbuilding Workbench (separate project)

Interactive chat frontend backed by the knowledge graph. Author converses with their world, modifies plotlines, generates beats, adjusts world state. Output is a structured plan that feeds the harness. Workbench writes to knowledge graph, harness reads from it. Same Postgres tables, different interface. Semantic search / embeddings may be useful here for exploratory authorial queries. Entirely separate from the prose generation pipeline.
