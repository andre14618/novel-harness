---
status: planned
created: 2026-04-15
target: writer quality
philosophy: imitation-first — deconstruct a successful target novel, build a permanent quality oracle against its actual prose, then engineer methodologies that close the distance to it
---

# Writer Imitation Benchmark — R.A. Salvatore Deconstruction

## Thesis

Treat novel writing as an engineering problem with a measurable ground truth. Pick one published, commercially successful novel in our target genre. Deconstruct it down to scene-level beats with full tagged metadata. Use the resulting `(beat brief + context) → (real published prose)` pairs as the permanent quality oracle for every writer experiment going forward.

Every future methodology (model swap, primer change, generation unit change, SFT adapter, hybrid routing) is scored on the *same* beats against the *same* real prose. Subjective "this prose looks good" goes away. "M6 wins 73% of pref-eval pairs against the real Salvatore prose, perplexity 124 vs M1's 187" replaces it.

The corpus deconstruction is also a paired training dataset, which makes any future SFT path a free side effect of building the benchmark.

## Why this changes the architecture

The original beat-first architecture was tuned for Cerebras Qwen 235B's strengths — fast (~2s/call), structured, tight output. DeepSeek V3.2 inverts those constraints (~30s/call, large output capacity, 90% prefix cache discount). Constraints inverting means the cost-optimal generation unit may have moved from beats to scenes or chapters. The benchmark is the only honest way to find out.

Likewise: static voice primer (current Howard exemplars) is one strategy. Dynamic per-scene primer retrieved by similarity from the deconstructed Salvatore corpus is another. The benchmark settles which wins.

## Target

**R.A. Salvatore, *The Crystal Shard*** (Forgotten Realms / Icewind Dale book 1, 1988).

Rationale:
- Where Salvatore found his voice — clean structural choices, action-dense, sword-and-sorcery in the lineage we're already shaping the harness toward.
- Cleanly scene-organized at the prose level — natural unit boundaries, makes deconstruction tractable.
- Commercially proven (NYT bestseller, ongoing 30+ year franchise) — clears the success bar.
- Modern enough to match contemporary reader pacing expectations (vs Howard's 1930s pulp).

Alternate: *Homeland* (Drizzt origin) if Drizzt's voice is the more important commercial vector.

## Phase 0-POC — "Capability vs tuning" proof of concept (runs before full Phase 0)

Before spending ~$75 on a Kimi K2.5 training run, settle a strategic question that the ceiling probes alone cannot: **does real fine-tuning (even at small scale) meaningfully close the gap, or is base-model capability the dominant lever?** Two nested probes — the cheaper **POC-mini** runs first (~$1), and the **POC-full 2×2** runs only if the mini leaves the answer ambiguous.

### Phase 0-POC-mini — Qwen3-14B quadrant only (~$1, ~2 days)

Three cells only — all essentially free because Qwen3-14B training is $0 on W&B ART preview and DeepSeek+primer is already our production default.

| cell | methodology | cost |
|---|---|---:|
| A | Qwen3-14B + Howard primer, untuned | $0 (W&B inference) |
| B | Qwen3-14B LoRA on ~100 Salvatore pairs (3 Crystal Shard training chapters) | $0 training (ART preview) + ~$0.50 inference |
| C | DeepSeek V3 + Howard primer (current default) | ~$0.30 inference |

**Eval:** generate prose for ~60 held-out beats (2 Crystal Shard chapters) under each cell. Sonnet sub-agent pref-eval blind A/B each cell vs real Salvatore prose. Add perplexity + feature-KL as supporting signals.

**Decision rules from POC-mini:**
1. **B > C decisively** → answered. Tuning at small scale already beats the large-untuned baseline. Strongest possible signal that SFT is the lever. Skip POC-full. Proceed to full benchmark with SFT prioritized; Qwen3-14B is a live candidate for production writer.
2. **B < C decisively** → partial answer. 14B may be too small, or tuning on this shape of data doesn't transfer. Don't ship a 14B writer adapter. Proceed to POC-full to add cell D (Llama 70B LoRA) and distinguish "14B too small" from "tuning doesn't work."
3. **B ≈ C** (within ~10% pref-eval) → tiebreaker. Proceed to POC-full.

### Phase 0-POC-full — 2×2 (runs only if POC-mini is ambiguous, adds ~$5)

Adds cell D (Llama 3.3 70B LoRA) to the three mini cells:

| | Untuned (in-context only) | Tuned (LoRA SFT) |
|---|---|---|
| **Small base** (Qwen3-14B) | **A** — Qwen3-14B + Howard primer | **B** — Qwen3-14B LoRA on Salvatore pairs |
| **Large base** (DeepSeek / Llama 70B) | **C** — DeepSeek V3 + Howard primer (current default) | **D** — Llama 3.3 70B LoRA on Salvatore pairs |

Adds:
- A vs C: base-capability isolation at zero training spend
- **B vs D: the core SFT-at-scale question** — does a tuned large base beat a tuned small base by enough margin to justify Kimi K2.5?
- C vs D: tuning lift at a larger base

**Why it isn't just tonal-pass V4 replayed:** V4 failed at voice transfer because it was rewriting existing prose paragraph-by-paragraph — the task collapsed into lexical synonym swapping because the input already had fixed structure and rhythm. Beat-writer SFT is a fundamentally different task: generate new prose from a beat brief + transition + context. The model chooses rhythm, sentence length, dialogue tag style, sensory density, clause structure. Salvatore-trained pairs can shape any of those. V4's no-structure-to-change failure mode doesn't apply.

**14B constraints to flag:** W&B LoRA rank hard-capped at 16 — if voice imprinting needs rank-32+, W&B can't serve it (training/serving fallback: Together or RunPod). Base is `OpenPipe/Qwen3-14B-Instruct` (instruct-tuned, which can fight voice shift; raw base sometimes imprints better). Our prior 14B adapters (adherence-v4, chapter-plan-v2, continuity-v2, tonal-v4) all succeeded at structured classification/rewriting — **none of them tested open-ended creative generation.** POC-mini is new ground for 14B in our harness; that's exactly why it's worth doing cheaply.

**Micro-corpus (shared across mini and full):** train on 3 Crystal Shard chapters (~20–25 scenes, ~100 paired beats), hold out 2 chapters (~60 beats) for eval. ~2 days of sub-agent labor vs. ~4 for the full book.

**Full cost breakdown (if POC-full runs):**

| item | cost |
|---|---:|
| Mini-deconstruction (3+2 chapters, sub-agents) | $0 |
| Training — Qwen3-14B LoRA on W&B (ART preview) | $0 |
| Training — Llama 3.3 70B LoRA on Together (0.9M tokens × $2.90/M) | ~$2.60 |
| Inference — 60 eval beats × 4 conditions | ~$2 |
| Sonnet pref-eval judge (sub-agents, blind A/B) | $0 |
| **POC-full total (mini + D)** | **~$5–7** |

**Decision rules from POC-full 2×2:**

1. **B > C** (tuned small beats untuned large) → tuning matters most. Qwen3-14B adapter may be good enough. Kimi K2.5 investment possible but not urgent. Proceed to full benchmark with SFT methodologies prioritized.
2. **D > B AND D > C** (tuned large beats both) → tuning at scale is the real lever. Justifies the Kimi K2.5 ~$70 training spend. Proceed to full benchmark including Kimi.
3. **C > B AND C ≈ D** (untuned large ties tuned large) → base capability dominates; SFT barely helps. Do NOT spend on Kimi. Invest in primer strategy and scene-vs-beat generation-unit experiments (M3–M7) instead.
4. **A ≈ B ≈ C ≈ D** → we're all far from real Salvatore and the gap is something else (planner beat quality, generation unit, or benchmark noise floor). Reinvest in the planner.

The POC-mini is cheap enough (~$1) that the answer is worth more than the cost of finding out. POC-full (~$5–7) runs only if the mini leaves the 14B-vs-larger question ambiguous.

## Corpus deconstruction (Phase 0) — 6-stage pipeline

Deterministic splitting + sub-agent semantic labeling + deterministic style tagging + a mandatory validation gate before scaling. Sonnet labor goes through Claude Code sub-agents (zero transport API spend).

**Expected shape:** Crystal Shard ~100K words → ~25 chapters → ~150 scenes → ~600–800 beats.

### Stage 1 — Mechanical chapter/scene split (deterministic, no LLM)

`scripts/lora-data/split-salvatore.ts` tokenizes the raw ebook text:
- **Chapters:** split on `^Chapter \d+` or `^\d+$` headers (Salvatore uses numbered chapter breaks)
- **Scenes within chapter:** blank-line triple-break, `* * *`, or `◆◆◆` markers (Salvatore's convention). Fallback: POV-shift heuristic flagged for sub-agent review.
- **Output:** `scripts/lora-data/salvatore-raw.jsonl` — one record per scene: `{chapter, scene_idx, raw_prose, word_count}`. No semantic labels yet.

### Stage 2 — Sub-agent scene labeling (parallel, zero API spend)

5 Sonnet sub-agents, each assigned 5 consecutive chapters (chapter range preserves within-arc context). Each sub-agent receives:
- Its chapter slice as raw prose
- A fixed rubric prompt (`scripts/lora-data/deconstruction-prompt.md`)
- The JSONL schema to emit

For each scene the sub-agent emits:
- **Pragmatic metadata:** `pov`, `location`, `characters_present`, `mood`, `action_level` (low/med/high), `scene_purpose` (1 sentence)
- **Continuity anchors:** `inbound_state` (what the reader knows/feels coming in), `outbound_state` (what's been established leaving)

Style-tag numerics are NOT computed here — Stage 4 handles them deterministically.

### Stage 3 — Beat segmentation inside each scene

Same sub-agent, second pass on each scene. A beat is one micro-unit of narrative motion — typically a paragraph cluster delivering a single action, observation, or exchange. Salvatore averages ~4–6 beats/scene.

For each beat:
- `beat_idx`
- `brief` — one-sentence brief phrased as if written by our `planning-plotter` (this is the training-time input)
- `transition_in` — last sentence of prior beat (or scene opener)
- `landing_target` — first sentence of next beat (the "what comes next" signal)
- `real_prose` — the actual Salvatore paragraphs verbatim
- `beat_type` — action / dialogue / interiority / description / transition (enum)

The `(brief + transition_in + landing_target + context) → real_prose` pair is exactly the shape our beat-writer already consumes. That's the paired-data dividend — SFT training set falls out as a free side effect.

**Most failure-prone step:** Stage 3 briefs must match production `planning-plotter` register — not summaries, not recaps. Stage 5 validation gate catches drift early.

### Stage 4 — Deterministic style tagging (no LLM)

A Bun script walks the JSONL and computes per-scene and per-beat numerics:
- `avg_sentence_words`, `clause_depth_mean`, `dialogue_ratio`
- `sensory_density_per_100w` (regex over a sense-word lexicon)
- `interiority_per_100w` (regex over `thought|wondered|felt|knew|realized|…`)
- `action_verb_density` (POS-tag-free proxy: verbs from a curated action-verb list)

These become the feature-KL targets for the benchmark's surface-voice metric (eval metric #3).

### Stage 5 — Validation gate (mandatory before scaling)

Before merging sub-agent output, hand-check 10 randomly sampled scenes:
- Do beat boundaries align with paragraph breaks naturally? (Bad split = rewrite prompt.)
- Is the `brief` something our existing `planning-plotter` could plausibly emit? (If not, the training data doesn't match production input distribution.)
- Does `real_prose` reconstruct the scene verbatim when concatenated? (Integrity check.)

If the sample fails, tighten the prompt and re-run. Budget: ~2 days for Stages 2+3 first pass, ~1 day for the validation loop.

### Stage 6 — Merge and index

- Concatenate sub-agent slices → `scripts/lora-data/salvatore-deconstruction.jsonl` (one record per scene, with embedded beats array + raw prose)
- Build a Postgres table `salvatore_scenes` (columns: `pov`, `mood`, `action_level`, `beat_type`) as a queryable tag index for dynamic primer retrieval in methodologies M3/M4/M6
- Build a pgvector embedding index over `brief` text for similarity-based retrieval (reuses pgvector, even though the main pipeline has embeddings off)

**Final JSONL record shape:**

```json
{
  "chapter": 3,
  "scene_idx": 2,
  "pov": "Drizzt",
  "location": "Kelvin's Cairn slopes",
  "characters_present": ["Drizzt", "Wulfgar"],
  "mood": "wary truce",
  "action_level": "low",
  "scene_purpose": "establish Drizzt-Wulfgar trust foundation",
  "inbound_state": "Drizzt suspicious of barbarian intent",
  "outbound_state": "fragile mutual respect established",
  "beats": [
    {
      "beat_idx": 0,
      "brief": "Drizzt observes Wulfgar's approach across the snow",
      "transition_in": "The cold wind whistled across the ridgeline.",
      "landing_target": "Wulfgar raised his warhammer in greeting.",
      "real_prose": "The drow ranger crouched lower into the drift...",
      "beat_type": "description"
    }
  ],
  "style_tags": {
    "avg_sentence_words": 14.2,
    "dialogue_ratio": 0.18,
    "sensory_density_per_100w": 4.1,
    "interiority_per_100w": 2.3,
    "action_verb_density": 0.09
  },
  "raw_prose": "<full scene prose verbatim>"
}
```

**Companion artifact: `src/agents/writer/style-primer-salvatore.md`** — a separate sub-agent reads the full JSONL and extracts the always-true voice fundamentals (clause-pacing patterns, dialogue tag habits, sensory-detail conventions, action verb selection, interiority style). ~5K tokens, designed to sit cacheable as the static primer base for M2/M5/M7.

**Wall time:** ~4 days end-to-end. **API spend:** $0 (raw text acquisition in Phase 0a is the only paid step). **Sub-agent parallelism:** 5 × 5 chapters is within the 10–15 parallel agent limit.

## Benchmark harness (Phase 1)

**`scripts/bench-writer.ts`** — given `(methodology, scene_subset)`, generates prose for each beat or scene, runs all eval metrics, writes results to a new `writer_benchmark` table.

```sql
CREATE TABLE writer_benchmark (
  id SERIAL PRIMARY KEY,
  methodology TEXT NOT NULL,        -- "M1-deepseek-beat-howard", "M6-deepseek-scene-hybrid", "M9-sonnet-beat-static"
  experiment_id INT,
  source_novel TEXT NOT NULL,       -- "salvatore-crystal-shard"
  chapter INT NOT NULL,
  scene_idx INT NOT NULL,
  beat_idx INT,                     -- null for scene-level methodologies
  fabricated_prose TEXT NOT NULL,
  real_prose TEXT NOT NULL,
  perplexity REAL,
  feature_kl REAL,
  classifier_score REAL,
  pref_wins INT DEFAULT 0,
  pref_total INT DEFAULT 0,
  cost REAL,
  latency_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Sub-agent pref-eval judge** (`scripts/bench-pref-judge.ts`) — Sonnet sub-agent receives `(beat context, candidate prose, real prose)` blind A/B and returns "which is closer to the published author's voice and craft for this scene." Aggregates wins. No transport API spend (sub-agents).

**Author-style classifier** — reuses the existing tonal-pass eval infrastructure (`scripts/lora-data/howard-classifier`). Retrain on `Salvatore-vs-random-fantasy` to give a continuous voice-distance score.

## Methodologies to benchmark

| ID | generation unit | primer strategy | hypothesis |
|---|---|---|---|
| **M1** | beat | static Howard primer | current default — baseline to beat |
| **M2** | beat | static Salvatore primer | swap exemplars to actual target author |
| **M3** | beat | dynamic primer: top-3 Salvatore scenes by tag similarity | per-call relevance, breaks cache but smaller payload |
| **M4** | beat | hybrid: 5K cached fundamentals + 2K dynamic | best-of-both: cache savings + scene-specific exemplars |
| **M5** | **scene** | static Salvatore primer | larger generation unit, intra-scene rhythm preserved |
| **M6** | scene | hybrid primer | scene-level + best primer strategy |
| **M7** | chapter | static primer | one call per chapter, max coherence, hardest to retry |
| **M8** | scene, iterative | static primer + Sonnet critic + revise pass | quality lift but 3× cost/latency |
| **M9** | beat | static primer, **Sonnet 4.5** | frontier ceiling at current architecture |
| **M10** | scene | hybrid primer, **Sonnet 4.5** | frontier ceiling at best architecture — true upper bound |

All methodologies generate prose for the *same* deconstructed Salvatore beats. All scored against the *same* real Salvatore prose.

## Eval metrics (per methodology, aggregated across scenes)

1. **Pairwise pref-eval win rate vs real prose** — Sonnet sub-agent judge, blind A/B. Primary quality signal.
2. **Perplexity of real prose under candidate** — does the candidate model assign high probability to what Salvatore actually wrote?
3. **Feature distribution KL** vs real prose — sentence length, clause depth, dialogue ratio, sensory density, action verb density. Captures surface voice match.
4. **Author-style classifier score** — continuous voice-distance metric, leverages existing infra.
5. **Cost per scene / per chapter / per estimated 20-ch novel**
6. **Latency per scene / per estimated 20-ch novel**

## Phased plan

| phase | duration | spend | deliverable |
|---|---|---|---|
| **0a** Acquire *Crystal Shard* text | 1 hr | $5 | `scripts/lora-data/salvatore-crystal-shard.txt` |
| **0b.1** Mechanical chapter/scene split (deterministic) | 2 hr | $0 | `scripts/lora-data/salvatore-raw.jsonl` |
| **0b.2** Sub-agent scene labeling (5 agents × 5 chapters) | 1 day | $0 | scenes tagged with pov/location/mood/etc. |
| **0b.3** Sub-agent beat segmentation + brief writing | 1–2 days | $0 | `(brief, transition_in, landing_target, real_prose)` tuples |
| **0b.4** Deterministic style tagging (numerics) | 4 hr | $0 | style_tags computed per scene/beat |
| **0b.5** Validation gate (10-scene hand-check) | 1 day | $0 | prompt tightened if needed; go/no-go to scale |
| **0b.6** Merge, Postgres index, pgvector brief index | 4 hr | $0 | `salvatore-deconstruction.jsonl` + `salvatore_scenes` table |
| **0c** Sub-agent extracts style fundamentals | 1 day | $0 | `src/agents/writer/style-primer-salvatore.md` (~5K tokens) |
| **0d** Dynamic primer infra (embed/tag retrieval over scenes) | 2 days | $0 | `src/agents/writer/dynamic-primer.ts` |
| **1a** `bench-writer.ts` harness | 2 days | $0 | runs M against scene subset, writes to `writer_benchmark` |
| **1b** Sub-agent pref-eval judge | 1 day | $0 | `scripts/bench-pref-judge.ts` |
| **1c** Salvatore author-style classifier (retrain tonal-pass infra) | 1 day | $5 | new classifier artifact |
| **2** Run all 10 methodologies against full benchmark | 1–2 days | ~$50 (mostly Sonnet for M9/M10 + judge) | `writer_benchmark` populated, leaderboard |
| **3** Decide direction from data | — | — | One of: ship M2/M4/M6, commit to SFT, or commit to Sonnet 4.5 |

**Total to data-driven verdict: ~2 weeks, ~$60 API spend.** All Sonnet analytical labor goes through sub-agents.

## Decision rules

**If a DeepSeek methodology (M1–M8) wins ≥ Sonnet (M9/M10) on pref-eval:** ship that methodology as the default writer. SFT path deferred indefinitely.

**If Sonnet (M9/M10) wins decisively (>20% pref-eval gap):** evaluate cost. At ~$2–6 per 20-ch novel, ship Sonnet. SFT path becomes "can we get DeepSeek+SFT to match Sonnet at lower cost."

**If even M10 (Sonnet at best architecture) loses to real Salvatore prose by >30% pref-eval:** writer model is not the bottleneck. The deconstruction reveals what the planner is missing — beat richness, character interiority specs, scene mood definition. Reinvest in the planner.

**If M5/M6 (scene-level) significantly outperform M2/M4 (beat-level):** restructure the generation pipeline around scenes, not beats. The original beat-first architectural decision is invalidated for the new constraint regime.

## What this benchmark uniquely provides

1. **Permanent quality oracle.** Every future writer experiment — primer tweak, model swap, SFT adapter, hybrid routing — is scored against the same real prose. No more "this run feels better" debates.
2. **SFT training set as a free side effect.** The deconstruction is exactly the paired-data shape a future Qwen3.5 397B SFT would need. Building the benchmark builds the training set.
3. **Architecture-level decisions become measurable.** Beat vs scene vs chapter is settled by data, not intuition.
4. **Frontier ceiling exposed.** M9/M10 tell us how much room remains above current methodology — and whether SFT could plausibly close it.
5. **Reusable across target authors.** Same harness, swap the deconstructed corpus. Want a Brandon Sanderson benchmark next? Same framework, ~1 week to add.

## Risks and mitigations

| risk | mitigation |
|---|---|
| Single-novel overfitting — methodology that wins on Crystal Shard may not generalize | Add a second target novel (Sanderson? Lynch?) once Phase 2 verdict lands. Cross-validate. |
| Sonnet judge bias — Anthropic's model judging Anthropic's model in M9/M10 | Use perplexity + feature KL + classifier as independent signals. Pref-eval is one of four. |
| Deconstruction quality — sub-agent may produce inconsistent beat splits | Validate a 10-scene sample by hand before scaling to full book. Tighten prompt. |
| Pure mimicry over craft — methodology may win the benchmark while producing unreadable novels | Track downstream signal: do novels generated with the winning methodology pass the existing checker pipeline at the same rate? Sanity check, not primary metric. |
| Crystal Shard prose is not the right target — too action-heavy, too fantasy-tropey | The deconstruction reveals this immediately. Swap target if early scenes show mismatch with commercial direction. Cost: ~2 days. |

## Architectural decisions that follow this work

- **Generation unit (beat / scene / chapter)** — fixed by Phase 2 verdict
- **Default primer strategy (static / dynamic / hybrid)** — fixed by Phase 2 verdict
- **Beat-writer model assignment (DeepSeek / Sonnet / SFT'd Qwen)** — fixed by Phase 2 verdict
- **Whether to invest in SFT at all** — fixed by Phase 2 verdict
- **Whether the planner needs richer beat output** — fixed by Phase 2 verdict (if even Sonnet fails, planner is the gap)

## Open questions before Phase 0a starts

1. **Confirm target: *The Crystal Shard*?** Or *Homeland* / *The Icewind Dale Trilogy* compilation / a Drizzt-centric later novel?
2. **Where will the ebook text live?** Local-only (gitignored), or in `scripts/lora-data/` with the existing Howard corpus?
3. **Sub-agent budget per chapter range?** Default plan: 5 sub-agents × 5 chapters each, ~30 min each. Tighter or looser is fine.
4. **Should Phase 0d (dynamic primer infra) wait for Phase 2 data?** Default plan: build it before benchmarking so M3/M4/M6 are testable in the same run. Alternative: skip dynamic primer methodologies in v1, add in v2.

## Related artifacts

- `docs/decisions.md` "Writer Model" — exp #189/#190 history (DeepSeek probe, Howard primer validation)
- `docs/lessons-learned.md` — sub-agent labeling SOP, V4 voice-SFT failure post-mortem
- `scripts/lora-data/howard-training.jsonl` — existing Howard corpus, becomes the comparison for Phase 1c classifier
- `src/agents/writer/style-primer-howard.md` — current static primer, becomes baseline M1
- Existing tonal-pass eval infrastructure (`scripts/eval-tonal-pass.ts` and friends) — Phase 1c reuses this

## Next concrete action

Confirm target (Crystal Shard vs alternate) and ebook source location. Phase 0a-0b (text acquisition + sub-agent deconstruction) starts within a day of confirmation.
