---
status: active
updated: 2026-04-29
audience: someone returning to this work who wants to understand what's collected and why
---

# Corpus Extraction — What and Why

This document explains, in plain English, what `scripts/corpus/extract-*.ts` actually produces, why each dim exists, and how to read the calibration verdict.

If you only read one section, read **§3 "What success looks like"** — that's the bar each dim has to clear before its output is trusted.

## 1. The big picture

The harness wants to **plan and write novels that match the structural patterns of proven novels**. Currently the planner generates plans with no empirical grounding — it just asks an LLM "make a good plan." The corpus extraction work changes that: we tag a *successful* novel with structural metadata, derive the empirical distribution of those tags, then pass the distribution to the planner as a constraint.

```
Successful novel  →  [extractors]  →  structural tags  →  empirical distribution  →  planner constraint
```

The current target novel is `crystal_shard` (Salvatore, Icewind Dale Trilogy book 1, 1988). It's the reference baseline. After the framework is validated on this book, it scales to modern targets (Sanderson Mistborn, Robertson Breakers, etc. — see `docs/corpus-wide-analysis-todo.md`).

## 2. What each extractor produces

Each extractor reads the canonical text of the novel, augmented with chapter labels, scene IDs, and beat boundaries (from `corpus-pipeline.md` Stages 1-5). It tags the prose with structural metadata grounded in a citable craft framework.

### value-charge (per scene)

**What it tags:** Each scene's polarity — does the scene end on a different value charge than it started? If a scene starts with the protagonist in a position of *power* and ends with them *weakened*, the polarity is `−` and the lifeValue axis is `power-weakness`. If no shift, polarity is `0` (transitional/connective scene).

**Schema per scene:**
```
{
  valueIn:    "+" | "-" | "0",      // polarity at scene start
  valueOut:   "+" | "-" | "0",      // polarity at scene end
  lifeValue:  enum (11 values: life-death, freedom-slavery, ..., other),
  polarity:   "+" | "-" | "0",      // direction of in→out shift
  confidence: 0-1,
  evidence_quote: "<verbatim source quote>",
  abstain_reason: null | "<reason>"
}
```

**Why it matters:** Coyne, McKee, Yorke, Truby, Swain all converge — every scene must contain change. Without polarity shift, the scene is described not dramatized. Empirical distribution from a successful novel (e.g. "37% +, 41% -, 22% 0") becomes a planner target.

**Output:** `novels/<key>/structure/<book>/value-charge.jsonl`

### promise (per book)

**What it tags:** Reader-expectation events — vows, mysteries, declared goals, latent capabilities. Each promise has an opening chapter (where the promise is established), optional hint chapters (where it's reinforced), a closing chapter (where it's paid off, or null if open at end), and a payoff_quality (satisfied, partially_satisfied, unsatisfied, unclear).

**Schema per promise:**
```
{
  promise_id:               "p001",
  promise_text:             "<≤200 char description>",
  opened_chapter_label:     "10",                   // raw label from source
  opened_chapter_index:     10,                      // canonical integer
  closed_chapter_label:     "25" | null,
  closed_chapter_index:     25 | null,
  payoff_quality:           "satisfied" | "partial" | ...,
  evidence_quote_open:      "<verbatim>",
  evidence_quote_close:     "<verbatim>" | null,
  confidence:               0-1
}
```

**Why it matters:** Sanderson, Lisle, LitRPG, Coyne all converge — promises must be paid off in proportion to how loudly they were promised. Catches "dangling threads" and "deus ex machina" simultaneously. Per-book distribution of promise span (opening → closing chapter gap) is a structural fingerprint.

**Output:** `novels/<key>/structure/<book>/promises.json`

### character-arcs (per main character, per book)

**What it tags:** For each main character, the canonical Lie/Truth/Want/Need from Weiland (8-framework convergence — densest in the entire SYNTHESIS).

**Schema per character:**
```
{
  character_name:        "Drizzt Do'Urden",
  lie:                   "<≤200 char belief that's false>",
  truth:                 "<≤200 char corrective truth>",
  want:                  "<≤200 char conscious goal>",
  need:                  "<≤200 char unconscious requirement>",
  arc_resolution:        "fulfilled" | "partial" | "unresolved" | "tragic_inversion",
  evidence_quote_lie:    "<verbatim>",
  evidence_quote_truth:  "<verbatim>" | null,
  confidence:            0-1
}
```

**Why it matters:** Every character needs an internal contradiction (Weiland canonical, Truby, Yorke, Harmon, STC, Maass, McKee, Sanderson — 8 frameworks). Per-novel set of LTWN tuples plus arc-resolution distribution becomes a concept-phase character-agent constraint.

**Output:** `novels/<key>/structure/<book>/character-arcs.json`

### MICE (per scene)

**What it tags:** Sanderson's MICE quotient — Milieu / Idea / Character / Event thread type per scene. A scene either opens a thread, closes a thread, or both. "Balanced parens" property: every M-thread that opens must close, etc.

**Schema per scene:**
```
{
  primary_thread:    "M" | "I" | "C" | "E",
  secondary_thread:  "M" | "I" | "C" | "E" | null,
  opens_thread:      bool,
  closes_thread:     bool,
  thread_descriptor: "<≤200 char: which specific thread is this>",
  confidence:        0-1,
  evidence_quote:    "<verbatim>",
  abstain_reason:    null | "<reason>"
}
```

**Why it matters:** Planner gets a balanced-parens validity check. Per-novel distribution of thread types (e.g. "30% M / 10% I / 20% C / 40% E") is a genre fingerprint.

**Output:** `novels/<key>/structure/<book>/mice.jsonl`

### McKee Gap (per beat)

**What it tags:** McKee's "Gap" — divergence between what the POV character expected and what actually happened. Beats with no gap are flat (description, not story).

**Schema per beat:**
```
{
  povExpectation:  "<≤200 char: what was the POV anticipating?>",
  actualOutcome:   "<≤200 char: what actually happened?>",
  gap_size:        "none" | "small" | "medium" | "large",
  gap_type:        "none" | "reversal" | "escalation" | "revelation" | "undermining" | "other",
  confidence:      0-1,
  evidence_quote:  "<verbatim>",
  abstain_reason:  null | "<reason>"
}
```

**Why it matters:** Maass + McKee + Coyne + Swain converge — tension on every page comes from gap. Per-novel distribution of gap_size is a "tension density" signal — Salvatore's actual rate becomes the redraft-gate floor.

**Output:** `novels/<key>/structure/<book>/mckee-gap.jsonl`

### (Other dims pending — see `docs/corpus-wide-analysis-todo.md`)

## 3. What success looks like (the calibration verdict)

Each extractor is fast and cheap (V4 Flash, ~$0.001/call). To know if its outputs are *trustworthy*, we run the same prompt + same schema through a STRONGER model (V4 Pro judge) on a sample, then compare. This is the "calibration" step.

### Pred vs Gold (the terminology)

| Term | What it is | Cost |
|---|---|---|
| **Pred** (predicted) | V4 Flash extractor output — what we'd run in production | ~$0.001/call |
| **Gold** | V4 Pro judge output — used as ground-truth proxy | ~$0.005-0.01/call |

"Gold" is a slight misnomer here — it's not actual human-confirmed truth, it's "stronger-LLM agreement." If the extractor (cheap) and the judge (expensive) agree, the extractor is reliable enough to scale. If they disagree, either the extractor's prompt is wrong, the schema is too subjective, or the framework is hard to extract reliably.

For the strongest signal — true cross-family ground truth — we'd use a Sonnet (Anthropic) or Codex (OpenAI) subagent instead of V4 Pro. That's the premium path documented in `docs/structure-sonnet-judge-rubric.md`. V4 Pro is the cheap default.

### The verdict gates (per cell, R7 §7)

For each (dimension × book) cell, we compute precision, recall, F1 of pred against gold:

| Verdict | value-charge predicate (precision-first) | promise predicate (recall-first) |
|---|---|---|
| CELL PASS | P ≥ 0.78 AND R ≥ 0.65 AND F1 ≥ 0.71 | R ≥ 0.80 AND P ≥ 0.65 AND F1 ≥ 0.71 |
| CELL MARGINAL | P in [0.65, 0.78), F1 ≥ 0.60 | R in [0.70, 0.80), F1 ≥ 0.60 |
| CELL FAIL | F1 < 0.60 OR lead < 0.65/0.70 | same |
| NULL-GOLD | judge produced too few samples to score | same |

Different dims have different cost-asymmetries:
- value-charge is **precision-first** because false-positive polarity tags create wrong planner constraints
- promise is **recall-first** because false-negative promises create dangling threads (the failure mode the registry exists to prevent)

### What CELL PASS means in practice

If a dim CELL PASS on `crystal_shard`, the empirical distribution from that dim's tags is trustworthy enough to ship as a planner constraint. Add the distribution to `roles.ts` agent context; planner uses it as a target.

If a dim CELL FAIL, three responses:
1. Inspect why pred ≠ gold. Often it's a matching-policy bug (semantic-equivalent text rejected as different) — fixable.
2. Iterate on the extractor prompt; re-run on the same gold.
3. If neither helps, the framework concept is hard to extract; consider human-gold or escalating to Sonnet.

### What NULL-GOLD means

The judge produced disagreeing labels on the same source within its own pass (or with itself across re-runs). Schema is too subjective for the chosen judge config. Tighten the schema, escalate to a stronger judge (Sonnet), or accept the dim as unreliable.

## 4. The matching policy (load-bearing for promise)

Promise calibration uses **per-promise-row matching** because pred and gold are independently-extracted lists, not paired. To compute P/R/F1 we need to decide which pred matches which gold.

**Original (broken) policy** — Jaccard token similarity ≥ 0.5 OR Levenshtein ratio ≥ 0.6 over normalized text, joined by chapter window |Δ ch_index| ≤ 1. Failed because PARAPHRASED promises share few tokens — "Errtu will pursue the crystal shard" vs "Errtu seeks the relic Crenshinibon" are the same promise but Jaccard is ~0.14, fails 0.5 threshold.

**Fixed (R7) policy** — LLM-based pair matching. For each (predicted, gold) pair within ±1 chapter window, ask V4 Pro: "are these the same promise? yes/no." V4 Pro understands semantic equivalence even across paraphrase. ~$0.05 per book per dim. The token-similarity heuristic stays as a pre-filter to reduce LLM calls (only run LLM on pairs with ANY token overlap).

Other dims may need similar matching policies as they ship (mice scene-tags share scene_id so trivial; mckee-gap shares beat_id so trivial; only promise has independent-list matching).

## 5. The flow end-to-end

```
1. corpus-pipeline.md Stages 1-5     →  novels/<key>/{scenes,beats,pairs}.jsonl
2. normalize-for-structure.ts        →  structure-tmp/<book>/{scenes,beats,pairs}.jsonl  (per-book slice + canonical sort)
3. extract-<dim>.ts                  →  structure/<book>/<dim>.{jsonl|json}             (V4 Flash extractor — production cost shape)
4. sample-for-adjudication.ts        →  structure-gold/<book>/<dim>-prompts.jsonl       (sample 30-50 rows)
                                       structure-gold/<book>/<dim>-key.jsonl           (sampled rows w/ pred labels for join)
5. llm-judge.ts                      →  structure-gold/<book>/<dim>-gold.jsonl         (V4 Pro judge — ground-truth proxy)
                                       structure-gold/<book>/<dim>-judge-meta.json
6. compute-calibration.ts            →  structure-calibration/<book>.json              (P/R/F1 + verdict per dim)
7. verify-pipeline.py                →  verification.json (Stage 6 audit)              (structural invariants — schema, evidence quotes, monotonicity)
```

Steps 1-3 are extraction (cheap). Steps 4-6 are calibration (also cheap). Step 7 is structural sanity (free).

## 6. Reading a verdict

Open `novels/<key>/structure-calibration/<book>.json`. Each cell has `metrics` (raw P/R/F1 plus per-field rates) and `verdict` (PASS/MARGINAL/FAIL/NULL-GOLD with reason).

If the verdict is suspect (FAIL but you can hand-match many pred to gold), check the matching policy — promise is the dim where this matters most.

## 6a. Actual crystal_shard results (2026-04-29)

These are real numbers from the first full pass, not hypotheticals.

### value-charge — F1=0.94 binary, gated NULL-GOLD on small retest n

| Metric | Value | Interpretation |
|---|---|---|
| n matched | 54 / 55 (1 judge timeout) | extractor + judge both labeled 54 of the 55 sampled scenes |
| Polarity exact-match | 76% | extractor agrees with judge on polarity tag (+ / − / 0) |
| F1 (binary "non-flat scene") | 0.94 / 0.94 / 0.94 | when both call a scene non-zero, they almost always agree |
| valueOut field rate | 80% | end-of-scene polarity is the most agreed-upon field |
| valueIn field rate | 72% | start-of-scene polarity slightly noisier |
| lifeValue (11-class enum) | 56% | 11-way classification is harder than binary, expected |
| Confidence calibrated | high-conf (≥0.8) → 79% precision | model knows when it's confident |
| Retest self-disagreement | **40% on n=5 retests** | gates the cell to NULL-GOLD per protocol |

**Verdict: NULL-GOLD — but it's a sample-size artifact.** With n=5 retest pairs, 2 disagreements (40%) is well within the noise band of the 15% threshold. The retest pool needs to grow to n ≥ 20 before this verdict is statistically meaningful. The underlying signal (F1=0.94 on the load-bearing binary call) is healthy. **Action:** for the next corpus run, increase retest sample to ≥ 20 pairs and re-judge.

### promise — F1=0.41, real signal

After replacing the broken Jaccard/Levenshtein matcher with V4 Pro semantic matching:

| Metric | Value | Interpretation |
|---|---|---|
| Predicted promises (V4 Flash) | 14 | extractor ran 2-pass open + close |
| Gold promises (V4 Pro) | 30 | judge found ~2× as many promises |
| LLM-confirmed matches | 9 | semantic-equivalent pairs |
| Precision | 0.64 | most of what V4 Flash finds IS a real promise |
| Recall | 0.30 | V4 Flash misses Chekhov's-gun-type setups |
| F1 | 0.41 | CELL FAIL per protocol |

**The 21 unmatched gold promises** (V4 Pro found, V4 Flash missed) are mostly setup-payoff bridges:
- "Drizzt has a magical panther summoned from an onyx figurine" (will pay off later)
- "Drizzt acquires a magical scimitar effective against demons" (Chekhov's scimitar)
- "Drizzt will train Wulfgar in combat" (training arc)

**The 5 unmatched pred promises** look like cases where the judge subsumed multiple predictions under one broader promise (e.g. "Kessell's army will attack" was rolled into "the barbarian invasion arc" by the judge).

**Action:** Treat as expected for V4 Flash on the cheap-extractor cost shape. Three forward paths:
1. Accept ~30% recall — for broad arc-spanning promises only, the planner constraint may still be useful
2. Two-pass extraction: V4 Flash open → V4 Pro "did we miss any?" close pass
3. Upgrade extractor to V4 Pro (~10× cost — only worth it if the planner constraint demands full recall)

### Cost so far (crystal_shard, all dims)

| Stage | Calls | Total cost |
|---|---|---|
| value-charge extractor (V4 Flash) | 139 | $0.05 |
| promise extractor (V4 Flash, 2-pass) | 2 | $0.01 |
| character-arcs extractor (V4 Flash) | 1 | $0.01 |
| MICE extractor (V4 Flash) | 139 | $0.04 |
| McKee-Gap extractor (V4 Flash, in flight) | 824 | ~$0.30 est |
| value-charge judge (V4 Pro promo) | 55 | $0.30 |
| promise judge (V4 Pro promo) | 2 | $0.10 |
| LLM matcher (V4 Pro promo) | 1 | $0.02 |
| **Total per book** | ~1,160 calls | **~$0.85** |

Caching observed at 1,664 cached input tokens per V4 Flash call (~80% prefix-cache hit on system prompt + chapter context). V4 Pro promo is 75% off until 2026-05-31. After promo, total per-book cost roughly doubles to ~$1.70 — still trivial.

## 6b. NULL-GOLD verdict has an n-floor problem

The R7 protocol gates NULL-GOLD when judge self-disagreement exceeds 15%. This works only when the retest pool is large enough that 15% is meaningfully different from random noise. With n=5 retest pairs, the standard error of the rate estimate is ~22 percentage points — well wider than the 15% threshold itself.

**Durable-pipeline fix:** the sampler needs an n-floor. Recommended: at least 20 retest pairs per dim, regardless of total sample size. For dims where total samples are < 100 (like promise, where there are 14 promises total), the retest pool can include EVERY row at least twice — silent retest is just "judge the same row twice."

This is a known gap to fix before the next corpus runs.

## 7. Why this matters strategically

This isn't just data collection. The end goal is the planner methodology shift:

**Old:** "Generate a plan that the LLM thinks is good."  
**New:** "Generate a plan whose structural fingerprint matches a proven novel's empirical distribution."

For each dim that CELL PASS:
- Compute the empirical distribution from `crystal_shard` (and eventually Sanderson, Robertson, etc.)
- Add it to the planner's context as a target distribution
- Validation phase checks how far the generated plan deviates from target
- Drafting uses the per-beat tags (gap_size, polarity, MICE thread, etc.) as constraints

The corpus is the ground truth that grounds every planner decision. That's the load-bearing strategic value.

## 8. Linked context

- `docs/charters/corpus-structural-decomposition-v1.md` — R7 charter (parent doc, denser)
- `docs/corpus-wide-analysis-todo.md` — full menu of dims (12 in Tier 1, more in 2-5)
- `docs/research/writing-frameworks/SYNTHESIS.md` — framework convergence rankings
- `docs/structure-sonnet-judge-rubric.md` — premium-judge protocol via Sonnet/Codex subagents
- `docs/corpus-pipeline.md` — Stages 1-5 (corpus ingestion)
- `scripts/corpus/` — all extractor + judge + calibration scripts
- `src/agents/structure-*/` — per-dim extractor agent dirs
