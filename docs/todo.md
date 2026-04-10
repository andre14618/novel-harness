---
status: active
updated: 2026-04-10
---

<!-- Last edit: Sonnet 4.6 teacher eval complete (exp #147, 96.5%), lessons-learned + fine-tuning-strategy updated, eval-adherence-claude-teacher.md updated. -->


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

> The original "train one multi-task LoRA on all three analytical agents using Qwen 235B as oracle" plan is dead. The four-task + decomposition series showed (a) reference-resolver doesn't need SFT at all, (b) continuity's would-be teacher (235B) misses 90% of warnings — distilling it would teach the student to also miss them, (c) **adherence-checker can be most-of-the-way fixed by a prompt swap alone (#122 closed half the SFT gap with no training)**, and (d) ~~the right teacher is task-specific, not "whatever's already in the pipeline."~~ **CORRECTED (2026-04-10): mixed-teacher V3 regressed vs single-teacher V2 (exp #146). Synthetic teacher accuracy on obvious failures doesn't predict calibration on marginal production cases. A consistent single teacher (235B) produces a better student than per-flag best teachers with different sensitivity thresholds.** See `project_four_task_sft_ladder.md` memory.

1. **~~Swap continuity to decomposed parallel calls.~~** DONE (2026-04-09). 2-call decomposition (facts + character state) replaces single overloaded call. Same pattern as adherence-checker (exp #122). Inline prompts in `check.ts`, prompt.md removed. On 235B for now; decomposition enables dropping to 14B (W&B) once validated. Needs production validation: 3-chapter romance-drama run.

2. **~~Adherence-checker SFT~~** — **V2 DEPLOYED (2026-04-09).** Eval exp #135: V2 90% oracle agreement (230/255) on 64 production pairs vs V1 87% vs base 77%. Wired into `models/roles.ts` as `wandb-artifact:///andre14618-/novel-harness/adherence-checker-v2-sft-resume:v9`. **Per-flag oracle accuracy is non-uniform** — see `docs/lessons-learned.md` "Per-flag oracle accuracy":
    - Setting/tangent: oracle 100% accurate, V2 88%/87% (V2 over-fires — setting inheritance, atmospheric boundary)
    - Character: oracle 95%, V2 88%
    - **Events: oracle only 85%** — misses 3/20 truly absent beats. V2's 98% agreement means it learned the oracle's errors.

3. **~~Score gpt-oss-120b on the adherence decomposed eval.~~** DONE (2026-04-09, exp #138/#140). Teacher ladder across 5 models. Per-flag best: K2.5 events 95%, gpt-oss character 100%, 235B tangent 100%. Led to mixed-teacher V3 training — **which regressed vs V2** (see item 6).

4. **Implement tiered retry policy.** Currently any single flag fires a full beat rewrite. Proposed: events/character flags → hard gate (always retry), setting/tangent → soft gate (log warning, don't retry unless off_spec_fraction > 0.7). Reduces per-beat false-rejection from ~19% to ~5-7%. Especially important when using expensive writer models ($1-3/M).

5. **3-chapter romance-drama end-to-end validation** of V2 adapter + tiered retry policy. Measure actual retry rate, false-rejection impact, and whether setting/tangent soft gates cause downstream chapter-plan-checker failures.

6. **~~(Conditional on #3) Train V3 with stronger events teacher.~~** DONE and DISCONFIRMED (2026-04-10, exp #145/#146). V3 trained on 7,541 mixed-teacher examples (K2.5 events, gpt-oss character, 235B setting/tangent). **V3 regressed vs V2**: 94.4% vs 95.2% overall on synthetic ground truth, FAIL_MISSING_SUBTLE collapsed 78.6% → 55.4%. Root cause: synthetic teacher accuracy doesn't predict calibration on marginal production cases — K2.5 is more lenient on subtle missing events than 235B. See `docs/lessons-learned.md` "Mixed-teacher approach DISCONFIRMED." **V2 remains production adapter.**

7. **(Conditional on V3 or decided unnecessary) Post-SFT: GRPO/RL loop for adherence-checker** — adherence-checker is the only one of the four analytical agents with a clean reward signal (the deterministic checks — character presence, word count, dialogue — plus synthetic labels compose into a fully automatic reward function). After the events gap is addressed, design a GRPO loop on the same W&B/ART stack using the deterministic verifier as the reward.

6. **Chapter-plan-checker per-beat decomposition is DISCONFIRMED — flat single-call stays.** Exp #123 (2026-04-08) tested splitting the chapter-plan check into N parallel per-beat calls. gpt-oss-120b regressed 90% → 64%, Qwen 235B 81% → 72%. Per-beat compounds error multiplicatively (0.9⁴ ≈ 66% pair-level for a 4-beat chapter at 90% per-beat) and can't see cross-beat properties like FAIL_REVERSED_ARC (0–22% across all four models). The chapter-plan-checker SFT path via gpt-oss-120b distillation (`project_chapter_plan_checker_finetune.md`) is unchanged and still validated.

7. **Continuity SFT — BLOCKED until labeling pipeline is built.** The four-task ladder showed 235B itself is missing 90% of warnings and 65% of nits in the synthetic eval, so distilling 235B would replicate exactly that failure. Path forward: (a) build a Claude-as-teacher labeling script (Opus or Sonnet 4.6 — NOT gpt-oss, which is peer-tier with 235B on this task), (b) hand-validate the WARNING and NIT variant injections in `scripts/generate-continuity-data.ts` first, since the bench may itself be measuring "task fundamentally hard" rather than "model deficit," (c) re-run #117/#118 with Claude as the teacher to confirm Claude meaningfully exceeds 235B before committing to a full data run. Cost at scale: ~1000 pairs at ~3K in / 1K out ≈ $120 (Opus) / $15 (Sonnet) — trivial.

8. **Reference-resolver SFT is OFF the list permanently.** Flat 14B is at 97.5% recall against the synthetic labels and reference-resolver's production cost function favors recall (over-fetch nearly free, miss costly). No real deficit to train against. The exp #115 "checklist wins" framing was a metric artifact — see the amendment in the lessons-learned reference-resolver entry.

**Tonal-pass v4 retrain on Qwen3-14B is OFF the table** (was a follow-up in the previous version of this todo). Retraining on a less-capable older base just for unified serving was based on the wrong capability framing — corrected per `docs/lessons-learned.md` "Don't compare model size without checking generation." Howard tonal-pass v3 stays on Together AI as the legacy serving home until/unless retrained on a W&B-supported base.

**DeepInfra is NOT a viable serving home for our LoRAs** (corrected 2026-04-08 — see `docs/lessons-learned.md` "DeepInfra Custom LLMs is dedicated GPU rental"). The previous version of this todo proposed DeepInfra as a serverless alternative because AA's per-provider numbers showed DeepInfra serving stock Qwen 3.5 9B 3.1× faster than Together. That was a conflation: DeepInfra has two different products, and the one that hosts user-uploaded adapters ("Custom LLMs") is dedicated GPU rental at $2-5/hr per A100/H100 with weekly invoicing — uneconomical for our bursty solo-developer traffic by 2-3 orders of magnitude. The W&B/Qwen3-14B plan above stands unchallenged.

## Fine-Tuning — Full Strategy

See `docs/fine-tuning-strategy.md` for the complete plan. Training is free (W&B Serverless SFT, public preview). Inference is $0.05/$0.22 per 1M tokens. One base — `OpenPipe/Qwen3-14B-Instruct` — multiple task adapters. Every agent is a candidate. Full priority ranking, data sources, and evaluation protocol are in the strategy doc.

**Phase 1 — Analytical agents** (revised 2026-04-08 after the four-task baseline+checklist series AND the per-call decomposition follow-ups #122/#123 — see "Fine-Tuning serving infrastructure" section above for the full action list and `project_four_task_sft_ladder.md` memory):

- **Adherence-checker — V2 CURATED DEPLOYED (2026-04-09). V3 mixed-teacher DISCONFIRMED (2026-04-10). Sonnet 4.6 teacher EVALUATED (2026-04-10, exp #147).** 4-call decomposed prompt + V2 LoRA adapter live in production. V2 eval exp #135: 90% oracle agreement on 64 production pairs (base 77%, V1 87%). Adapter: `wandb-artifact:///andre14618-/novel-harness/adherence-checker-v2-sft-resume:v9`. V3 regressed (94.4% vs V2 95.2%, exp #146). Sonnet 4.6 teacher: 96.5% overall (1504/1559), FAIL_MISSING_SUBTLE 87.2%, FAIL_TANGENT_HARD 100% — better than 235B overall but misses V2.1 threshold (>97% + >90% FAIL_MISSING_SUBTLE). Sonnet is not a drop-in teacher replacement; bulk training data stays 235B-labeled. Ground truth errors confirmed in `airlock_standoff` + `trench_letter` FAIL_MISSING_SUBTLE pairs. Next: tiered retry policy + 3-chapter production validation, then GRPO/RL if SFT gap still worth closing.
- **Chapter-plan-checker — CHECKLIST PROMPT SHIPPED (2026-04-09, exp #124).** Structured checklist schema swapped in: 14B vs labels 53% → 75% (+22pp), 14B↔120B direct 58% → 75% (+17pp). Bias corrected: was 100% one-sided (14B rubber-stamps PASS), now symmetric except `FAIL_REVERSED_ARC` (0/2 — 14B reasoning ceiling on arc reversal). SFT target is now the checklist output format, not the flat schema. Distillation pairs must be labeled through the 120B checklist path. See `project_chapter_plan_checker_finetune.md`.
- **Continuity — 2-CALL DECOMPOSITION SHIPPED (2026-04-09).** Split into `continuity-facts` + `continuity-state` parallel calls (same pattern as adherence-checker 4-call decomposition). On Cerebras 235B; decomposition enables dropping to 14B (W&B). SFT still BLOCKED on a stronger labeling pipeline — 235B misses 90% of warnings and 65% of nits (#117/#118). Path forward: Claude-as-teacher labeling script + hand-validation of WARNING/NIT synthetic variants.
- **Reference-resolver — OFF the list.** Flat 14B already at 97.5% recall against synthetic labels; production cost function favors recall (over-fetch nearly free, miss costly). No real deficit to train against. (#114/#115, see amendment in lessons-learned.)

**Phase 2 — Tonal pass v4 + fact extractor** (data exists or easy to generate):

- **Tonal pass v4** — retrain `howard-tonal-pairs-curated.jsonl` on Qwen3-14B via ART. Evaluate against v3 on the same 15-paragraph test set (bigram perplexity, adjective density, word count). Serve via W&B Inference instead of Together.
- **Remove Together AI provider** — V3 tonal pass on Together is being dropped due to latency (~50-100× slower than Groq fast tier). Remove `TOGETHER_API_KEY`, Together entries from `models/registry.ts`, provider config. Any remaining credits are not worth the integration cost.
- **Fact extractor** — `bun scripts/build-finetune-data.ts --task fact-extractor --limit 50`, review 20-30 pairs, correct to gold (target: 8-12 facts/chapter vs current 17-20), scale to 300+.
- **Tonal pass expansion — CRITICAL** — v3/v4 training data is dark-fantasy-specific (Howard corpus). The adapter's voice is genre-locked; applying it to romance, literary fiction, etc. will impose the wrong tonal register. Multi-genre corpus needed before tonal pass is viable as a general pipeline stage. Public domain candidates: Hemingway (pre-1929), London, Cather, Fitzgerald. Copyright notes in `docs/ai-training-copyright-landscape.md`.

**Phase 3 — Continuity** (highest ROI, requires schema work):

- Design compact world-state diff format (new facts, changed character states, new events only — not full dump).
- Generate training data against new format using 235B oracle.
- Expected outcome: 7,294 → ~1,000 input tokens per call = 7× cost reduction on the highest-cost slot.

**Phase 4 — Lint fixer + beat writer** (opportunistic):

- **Lint fixer** — mine approved chapters for `(flagged_sentence, scene_context, good_rewrite)` triples. 200-300 examples across AI cliché pattern types. Low risk.
- **Beat writer** — highest upside (7.8× cheaper), highest risk (quality regression breaks pipeline). Shadow-run in parallel with 235B. See strategy doc for validation bar.

## Pipeline Tuning

- **Tighten fact extractor** — still 17-20 facts/chapter, target 8-15. Precision matters now that facts feed deterministic queries.
- **Word count below target** (550-770 vs 800-1100). Likely partly a tonal pass shortening effect; may also be model, prompt, or beat granularity. Re-evaluate after measuring pre- vs post-tonal-pass word counts.
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

## Structural Diversity

- **Pipeline prose is low on dialogue and interiority** — 15.7% dialogue (published novels: 25-50%), 0.1 interiority verbs/100w, 7.5w avg sentence length (published: 12-18w). Genre does differentiate (sci-fi 24.8% vs literary fiction 8.9%) but all below published norms. See `docs/lessons-learned.md`.
- **Structural diversity pass needed** — analogous to the existing tonal pass but targeting dialogue density, interiority, sentence variety. Requires paired training data (current output → structurally rich output) that doesn't exist yet. Block writer SFT and new tonal-pass training until this is addressed.
- **Analysis script**: `scripts/analyze-structure.ts` — deterministic structural metrics on all approved chapters. Run after each batch of new novels to track improvement.

## Seeds & Data Diversity

- **30 seeds created** (2026-04-09) — 8 post-apoc, 7 sci-fi, 7 epic fantasy, 4 portal fantasy, plus 6 original (romance-drama, dark-fantasy, coastal-mystery, sci-fi-thriller, young-adult-fantasy, minimal). LitRPG-adjacent genre bias per commercial target.
- **Premise diversity gap in production data** — all 131 approved chapters come from only 5 unique premises. Chapter-plan-checker and continuity SFT need plan/world-state diversity that synthetic generation can't provide. Run diverse seeds to fill this gap before those fine-tunes.
- **Run priority**: 10-15 novels across new seeds (mix of 3ch and 10ch) to build diverse training corpus for chapter-plan-checker and continuity fine-tunes.

## Studio — Chat-Driven Novel Creation Interface

Rebuild `/app/studio` from form-based launcher to conversational chat interface:

1. **Chat phase** — user talks to an LLM that asks about genre, premise, characters, tone. The LLM shapes input into the correct seed format (`CustomSeed`) and asks for confirmation before proceeding. Like talking to an assistant that understands the harness's seed schema.
2. **Execution phase** — once the user approves, the chat kicks off the pipeline and transitions into a terminal-style stream view (like Claude Code output). SSE events render as they arrive: agent steps, LLM calls with model/tokens/latency/cost, gate prompts, errors.
3. **Backend**: new API route that proxies chat messages to an LLM (Cerebras Qwen 235B) with a system prompt explaining seed format and available options. Conversation stored in session state.
4. **UX model**: single pane, chat messages above, pipeline stream below once kicked off. Novel list in sidebar for watching existing runs.

Current Studio page (form + passive log) is deployed but doesn't match the vision — needs full rebuild.

## Future — Worldbuilding Workbench (separate project)

Interactive chat frontend backed by the knowledge graph. Author converses with their world, modifies plotlines, generates beats, adjusts world state. Output is a structured plan that feeds the harness. Workbench writes to knowledge graph, harness reads from it. Same Postgres tables, different interface. Semantic search / embeddings may be useful here for exploratory authorial queries. Entirely separate from the prose generation pipeline.
