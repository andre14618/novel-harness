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

## Corpus deconstruction (Phase 0)

Sonnet sub-agents (free analytical labor — no transport API spend) deconstruct the entire book into structured JSONL.

**Output shape: `scripts/lora-data/salvatore-deconstruction.jsonl`** — one record per scene:

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
  "beats": [
    {
      "beat_idx": 0,
      "brief": "Drizzt observes Wulfgar's approach across the snow",
      "transition_in": "...",
      "real_prose": "The drow ranger crouched lower into the drift..."
    }
  ],
  "style_tags": {
    "avg_sentence_words": 14.2,
    "dialogue_ratio": 0.18,
    "sensory_density_per_100w": 4.1,
    "interiority_per_100w": 2.3,
    "action_verb_density": 0.09
  },
  "raw_prose": "<full scene prose>"
}
```

Sub-agent partitioning: 5–10 sub-agents work parallel chapter ranges (Crystal Shard is ~25 chapters). Each sub-agent produces its slice of the JSONL. Final pass merges and validates.

**Companion artifact: `src/agents/writer/style-primer-salvatore.md`** — Sonnet sub-agent reads the full deconstruction and extracts the always-true voice fundamentals: clause-pacing patterns, dialogue tag habits, sensory-detail conventions, action verb selection, interiority style. ~5K tokens, designed to sit cacheable as the static primer base.

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
| **0b** Sub-agent deconstruction (parallel chapter ranges) | 3–4 days | $0 (sub-agents) | `scripts/lora-data/salvatore-deconstruction.jsonl` (~150 scenes, ~600 beats) |
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
