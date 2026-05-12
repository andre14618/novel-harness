---
status: active
updated: 2026-04-09
derived-from: 125 experiments (tuning_experiments #1-#138), docs/lessons-learned.md
---

# Experiment Design Rules

Hard rules for designing experiments, selecting models, generating training data, and evaluating fine-tunes. Every rule here was learned from a mistake or a surprising result in this harness's experiment history. Read before designing any new experiment.

---

## 1. Experiment Infrastructure

### 1.1 Every experiment goes in the DB
Use `createTuningExperiment()` + `concludeExperiment()`. No exceptions — even smoke tests, null results, and system tests. The conclusion JSON is your lab notebook. Experiments without conclusions are invisible to future analysis. *(Rule since day 1; reinforced by having to reconstruct results from stdout for early unnumbered runs.)*

### 1.2 Commit code before running experiments
`createTuningExperiment()` captures the git commit hash. If you run against uncommitted code, the experiment can't be reproduced. The experiment record says "this code produced these results" — that contract breaks if "this code" doesn't exist in git. *(Exp #28 onward — enforced after losing reproducibility on pre-Postgres experiments.)*

### 1.3 Link every benchmark run to an experiment via EXPERIMENT_ID
Ad-hoc benchmark runs without experiment linkage produce orphaned results. If you're measuring something, it's an experiment. *(Enforced since exp #33.)*

### 1.4 Never delete experiments
Failed experiments, null results, and system tests are all valuable data. A null result tells you what doesn't work — deleting it means someone will try again. Mark conclusions as "null result" or "superseded by #N", don't delete the row.

---

## 2. Baseline Measurements

### 2.1 Run a baseline ladder before designing any intervention
Before testing a prompt change, schema swap, or fine-tune: run the **current production model** and at least **two comparison models** (one weaker, one stronger) on the same eval set. This gives you:
- The gap you're trying to close (strong vs production)
- The floor you're trying to stay above (weak model)
- The direction of failure (over-strict vs over-permissive)

Without a ladder, you can't tell whether a +5pp improvement is closing a 50pp gap (good) or a 6pp gap (noise). *(Learned from exp #110/#111 — the 3-model ladder exposed symmetric-but-opposite failure modes that a 2-model comparison would have missed.)*

### 2.2 Always include the production model in the ladder
Even if you "already know it works." Including gpt-oss-120b in the chapter-plan-checker ladder (exp #119) revealed 9 max-token errors in its current config AND gave the actual head-to-head vs 235B. Cost: one extra column. Upside: the entire SFT teacher decision. *(Exp #119.)*

### 2.3 Include a third anchor model when one exists at low cost
Three-way ladders expose failure mode symmetry. In exp #110, Llama 8B was over-strict (42 false-fails) while 14B was over-permissive (33 false-passes). With only 14B + 235B you'd see "14B is 17pp worse" but miss that the *direction* reveals the mechanism. *(Exp #110.)*

### 2.4 Report FP/FN confusion direction, not just accuracy
One-sided confusion (e.g., 38 FP / 0 FN) is a stronger signal than overall accuracy. It tells you the model has a systematic bias (rubber-stamp or hair-trigger) and tells you exactly what the SFT training data should emphasize. *(Exp #107: 14B chapter-plan-checker was 38/0 — 100% rubber-stamp bias.)*

---

## 3. Evaluation Methodology

### 3.1 Pick the metric that matches the production cost function
Different metrics tell completely different stories on the same data:

| Metric | Good for | Misleading when |
|--------|----------|-----------------|
| Exact match | Binary verdict tasks (adherence) | Set-output tasks (reference-resolver: 1% exact but 97.5% recall) |
| F1 | Balanced precision/recall tradeoff | Production cost function is asymmetric (recall >> precision for ref-resolver) |
| Recall | Tasks where missing a catch is expensive | Tasks where false alarms are expensive |
| Precision | Tasks where false alarms waste retries | Tasks where missing a catch compounds |

**Always report multiple metrics**, but know which one drives the production decision. *(Exp #114: 14B scored 1% exact-match, which looked damning; F1 showed 0.518 — practically tied with 235B. Recall showed 97.5% — actually the best.)*

### 3.2 Synthetic eval FP rates are a lower bound, not a prediction
Synthetic distributions are narrower than production. The adherence-checker 4-call decomposition showed 1.3% false-fail rate on the synthetic eval; production hit **57%** on the first run. The gap was ~25x. Always validate checker changes on a **3-chapter romance-drama end-to-end run** before declaring a win. *(Exp #122 → production run. The 3-chapter pilot is now mandatory.)*

### 3.3 Smoke runs can mislead in the positive direction
A 16-pair smoke showed 235B at 94% on chapter-plan per-beat; the full 80-pair eval showed 72%. Random sampling can produce variant distributions that hide failure modes. Use smoke runs to catch **regressions and missing slots**, not to validate gains. *(Exp #120 vs #123.)*

### 3.4 Report empty-expected variants as FP call counts, not exact-match
A model that emits zero issues on a VAR_NONE case scores 100% exact-match on that cell — hiding the false-positive rate across the eval. Report FP calls separately (e.g., "14B-flat: 26/40 FP on NONE+TRAP variants" vs "14B-checklist: 0/40"). The exact-match jump may come entirely from FP reduction, not from improved detection. *(Exp #117/#118: 14B's +13pp exact-match on continuity came entirely from NONE/TRAP going to 100%, not from better issue detection.)*

### 3.5 1-10 scoring does not discriminate between models
LLM judges using 1-10 rubrics anchor to the "7-8: Accomplished" band for any competent output. Prose Craft, Character Voice, Sensory Grounding all scored identically across 235B, DeepSeek, and MiMo Flash. **Use penalty counts (issue enumeration) or pairwise comparison for model comparison.** For iteration, use deterministic checks (lint, adherence). *(Exp #86-90, full audit.)*

### 3.6 Pairwise judges need reasoning models
Non-reasoning models (DeepSeek V3.2 flat) produced inconsistent pairwise results with 20%+ position bias. Reasoning models (DeepSeek Reasoner) were consistent and defensible. **Always use a reasoning model for pairwise.** *(Exp #47-53.)*

### 3.7 Pairwise is wrong for mechanical edits
When the edit changes 3-6 words in 1,200, pairwise judges can't detect the difference. Position bias dominates. For lint/mechanical changes, measure lint compliance, collateral damage, and word count delta. *(Exp #64-66.)*

---

## 4. Schema & Prompt Design

### 4.1 Structured checklists help N-check tasks, hurt 1-judgment tasks
Before designing an output schema, count the independent things being checked:

| Task shape | Schema effect | Example |
|-----------|--------------|---------|
| N independent checks against discrete elements (N > 3) | **Helps** — forces attention per element | Chapter-plan-checker: setting + characters + beats + arc |
| 1 nuanced holistic judgment | **Hurts** — atomization destroys meaningful-vs-nominal distinction | Adherence FAIL_TANGENT: "did the beat happen meaningfully?" |
| N items of same type with OR aggregation | **Hurts** — compounding error at scale | Per-beat chapter-plan: 0.9^4 = 66% pair-level |

*(Exp #109: +17pp on chapter-plan. Exp #111: -6pp on adherence 235B, FAIL_TANGENT collapsed. Exp #122 vs #123: orthogonal facets win, same-type items lose.)*

### 4.2 Schemas are verdict-space design — expose the options the model needs
When a model universally over-fires, check whether the output schema gives it a way to say "no issue." Adding an `"ambient"` branch to reference-resolver fixed VAR_NONE from 0% → 80% on 14B. Adding a `figurative_review` step fixed TRAP from 30% → 100% on 14B. **The model would have known to skip if asked — it just was never given a way to skip.** *(Exp #115, #118.)*

### 4.3 Make the verdict the LAST field, not the first
When the model emits `{"pass":` first, the next token samples from priors (biased toward `true`). With checklist fields first, by the time it reaches `pass`, it has already emitted `"missing": ["Leth"]` — the verdict conditions on its own observation. *(Exp #107/#109: chapter-plan 14B went from 58% → 75% solely from field ordering.)*

### 4.4 Only include fields the model can actually answer
Abstract fields beyond capacity become confident fabrications. 14B's `emotional_arc_correct` field regressed REVERSED_ARC from 50% → 20% — the model couldn't assess emotional arcs, so it confidently stamped `true`. **When in doubt, leave the field out and route to a more capable model.** *(Exp #109.)*

### 4.5 Test schema changes against multiple base models
The same checklist had opposite effects on three models: Llama 8B +18pp (rescued under-confident), 14B +4pp (barely moved), 235B -6pp (imposed unnecessary atomization). A schema is not universally good or bad — it interacts with the model's baseline calibration. *(Exp #111.)*

### 4.6 Check prompt assumptions against the architecture, not just the eval
The adherence-checker setting prompt said "no setting markers → false." The beat-context code only injects setting on beat 0 or location change. Mid-chapter beats never have setting markers by design. **Read the production data shape before writing the check prompt.** *(Production run post-exp #122.)*

### 4.7 Build a parity harness for any experiment that changes how a production LLM request is CONSTRUCTED
When an experiment modifies code that produces the request bytes a live production LLM call also emits (writer, checker, planner, context-builder prompt assembly; model-config resolution; tokenizer/format wrapping), build a **request-construction parity harness** that diffs the experimental-path outgoing request against a real `llm_calls` row from a drafted production run for the same coordinates. Run it BEFORE any judging. A non-zero diff outside explicitly-declared delta spans aborts the pilot.

**Scope — what this rule covers:** only the request-construction layer. System prompt, user prompt (structured-segment diff, not first-divergence-only), model, provider, temperature, max_tokens, response_format. For multi-arm experiments, per-arm: control arm byte-equal to live; treatment arms byte-equal to live outside declared delta spans.

**Scope — what this rule does NOT cover.** A request-byte parity harness does not verify any of these; flag them separately in the charter if the experiment touches them:
- **Response parsing / schema** — if the experiment changes how the raw LLM response is parsed into agent output, add a response-parse parity check (apply both parsers to a corpus of real responses; compare.)
- **Retry / transport audit behavior** — if the experiment changes retry count, retry conditions, or how retry metadata persists (see `src/transport.ts`), add a retry-audit parity check that replays a known-429 response and compares `httpAttempts` + `retryErrors` shape.
- **DB write-shape / side-effects** — if the experiment changes what gets written to `llm_calls`, `eval_results`, `pipeline_events`, or similar persistence layers, add a write-shape parity check that diffs the INSERT payloads.

**Explicit not-applicable exemptions** (charter must name which applies if §4.7 is skipped):
- **Pure evaluation task** — experiment only reads existing data / runs offline scoring; no new production-shape request is constructed.
- **Model or weight swap only** — experiment changes ONLY the model name / LoRA artifact URI while request construction is byte-identical to production.
- **Analysis-only** — experiment generates reports or statistics from `llm_calls` / `eval_results` without invoking any production code path.

If an experiment falls in none of the above categories and skips the parity harness, the charter must name an alternative invariant and a one-sentence rationale.

**Why:** over 7 rounds of adversarial review on the `salvatore-distinctness-conditioning-floor` charter, the parity harness caught two silent regressions that no unit test could have: (1) a 4-line-vs-5-line preset mismatch that made the experiment a no-op on production characters, and (2) a pack-level `conditioning: "fixed"` default that silently dropped one exampleLine from every production novel beat. A subsequent Codex round-7 review also caught a permissive-diff bug in the harness's first implementation (suppressed ALL post-marker drift instead of only the allowed spans) — fixed via structured-segment diff with explicit mask + subset check.

**Canonical implementation:** [`scripts/evals/conditioning-floor-parity-check.ts`](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/conditioning-floor-parity-check.ts) — uses `extractExampleLineBlocks` + `maskExampleLineBlocks` for structured-segment diff. Model new parity harnesses on its shape. *(Added 2026-04-20 after the conditioning-floor charter's review cycle. Refined per Codex SOP audit.)*

---

## 5. Teacher Selection for Fine-Tuning

### 5.1 The best teacher varies per task — there is no universal oracle
Run each teacher candidate against the deterministic eval labels and look at the per-variant table:

| Task | Best teacher | Accuracy | Why not a universal oracle? |
|------|-------------|----------|---------------------------|
| Adherence-checker | Qwen 235B | 97% (decomposed) | gpt-oss only 87% on tangent |
| Chapter-plan-checker | gpt-oss-120b | 90% | 235B only 81%, misses MISSING_BEAT at 10% |
| Continuity | Claude (Opus/Sonnet) | TBD | 235B at 35% recall, misses 90% of warnings |
| Reference-resolver | N/A | 97.5% recall | No fine-tune needed |

*(Exp #119: gpt-oss beat 235B by 9pp on chapter-plan-checker, and by 40pp on FAIL_MISSING_BEAT.)*

### 5.2 Score the teacher against labels, not just against the student
Exp #107 measured 14B vs gpt-oss outputs (58% agreement). That conflated "14B is wrong" with "14B disagrees with the teacher, who is also wrong." Always score every model against deterministic gold. The 5pp shift from "vs teacher" to "vs labels" was small here but would be catastrophic if the teacher were weaker. *(Exp #107 vs #119.)*

### 5.3 A teacher that misses a failure mode will teach the student to miss it too
235B on chapter-plan-checker scores 10% on FAIL_MISSING_BEAT. Distilling 235B into a 14B LoRA would teach the student to also rubber-stamp missing beats. **Check the teacher's per-variant accuracy before committing to distillation.** If the teacher is weak on a specific variant, either use a different teacher for that variant (mixed-teacher approach) or hand-label those examples. *(Exp #119: 235B had 14 FP / 1 FN — same rubber-stamp bias as 14B, just milder.)*

### 5.4 Mixed-teacher distillation is better than single-teacher when per-variant accuracy is non-uniform
When Teacher A is best on events (97%) and Teacher B is best on setting (100%), use each teacher for its strongest flag. The overhead is per-variant routing in the data generation script, not in production serving. *(Derived from exp #122/#138 cross-analysis: 235B wins events at 97%, gpt-oss wins events at 93% but beats 235B on other dimensions.)*

### 5.5 Use the cheapest model that passes the teacher quality bar
For offline SFT data generation, latency doesn't matter — only label quality. But cost matters at scale (10K+ examples). Run teacher candidates on a 160-pair eval first; the best-accuracy model at tolerable cost becomes the teacher. Don't default to the most expensive model. *(Continuity exception: even 235B at $0.60/$1.20 isn't good enough — need Claude at $3/$15 for the teacher signal.)*

---

## 6. Data Generation

### 6.1 Multi-writer diversity prevents stylistic overfitting
Generate prose samples from 4+ different writer models (Cerebras 235B, Llama 8B, Kimi K2, DeepSeek V3.2). Weaker writers produce organic drift — prose that deviates naturally from the beat spec — which creates more realistic FAIL training examples than synthetic injection alone. *(Exp #132: 2,596 prose samples from 4 writers → 10,008 training examples. gpt-oss couldn't write to spec — 100% prose errors — which is itself useful data about model limitations.)*

### 6.2 Curate training data by removing cross-contaminated labels
FAIL variants designed to test one dimension often trip non-target dimensions (e.g., FAIL_MISSING trips character contradiction because "not doing the action" ≈ "behaving out of character"). Remove ambiguous labels where the non-target flag fires — they teach the model the wrong discrimination boundary. *(Exp #132 → curation: 10,008 → 8,524 after removing 15% cross-contaminated labels. V2 curated beat V1 uncurated: 90% vs 87%.)*

### 6.3 Data curation outperforms data volume and rank increases
The single most impactful change across the tonal-pass v1→v3 progression was removing low-contrast training pairs, not adding more data or increasing LoRA rank. When style signal is weak, ask "does every training pair show clear contrast?" before asking "do we need more data?" *(Tonal-pass v2→v3: fewer pairs, same rank, better results.)*

### 6.4 Scenario diversity matters more than scenario count
131 approved chapters from only 5 unique premises is sufficient for adherence-checker (synthetic variants cover the gap) but insufficient for chapter-plan-checker and continuity (where plan structure and world-state diversity are the training signal). **Increase premise diversity before increasing examples-per-premise.** *(Data sufficiency audit, 2026-04-09: 30 new seeds created to address the gap.)*

### 6.5 Generic system prompts generalize better than detailed ones
Training data should use the simplest possible task description. The fine-tuned behavior lives in the weights, not the prompt. A model trained on "Does this prose match this beat?" generalizes better than one trained on a 500-word prompt full of rules. *(Fine-tuning strategy principle.)*

### 6.6 Label quality gates: review 20-30% before scaling
Every dataset needs a human review pass before training. Review 20-30% of examples manually, correct systematic errors, then scale. Don't trust automated oracle labels without spot-checking variant accuracy. *(Exp #100/#101: 96% oracle agreement validated before training.)*

---

## 7. Evaluation of Fine-Tunes

### 7.1 Don't test fine-tunes only on the same synthetic distribution they were trained on
The synthetic eval measures in-distribution performance. The real signal is the **production eval** — real beat/prose pairs from actual novel runs. Expect a generalization penalty of 5-10pp between synthetic and production accuracy. *(Exp #135: V2 scored 90% on 64 production pairs, lower than synthetic numbers.)*

### 7.2 Evaluating teachers on synthetic data IS correct
For teacher selection (not student evaluation), synthetic data with known-by-construction ground truth is the right tool. A FAIL_MISSING pair was deliberately written with the beat's action removed — if the teacher can't catch that, it won't catch subtler production omissions. **Synthetic for teacher selection, production for adapter validation.** *(Exp #122/#138: teacher comparison on 160 synthetic pairs.)*

### 7.3 Avoid circular evaluation: don't evaluate a student against the teacher that generated its training signal
If V3 is trained using gpt-oss labels for events, then evaluating V3 against gpt-oss on events is circular — you're measuring agreement with the source, not accuracy. V3 evaluation needs: (a) production pairs, or (b) a held-out synthetic set from new scenarios.

### 7.4 The standard evaluation protocol
All fine-tune evaluations follow this structure:

1. **Oracle agreement rate** on held-out examples (≥95% for a slot swap, ≥90% to ship with monitoring)
2. **Per-variant breakdown** — overall numbers hide failure modes; the per-variant table is the truth
3. **3-chapter end-to-end pipeline run** on romance-drama — no regression on adherence/plan-check/lint
4. **Latency probe** at production output length (not arbitrary max_tokens)
5. **Cost comparison** at production call volume

### 7.5 Shape latency probes to match real workload output lengths
The adherence-checker outputs ~17 tokens. A probe with `max_tokens=256` hides the fact that a smaller model can be 2.3x faster than a larger model on short outputs. Set max_tokens close to expected output for each shape. *(Exp #94: 14B W&B beat Cerebras 235B on adherence: 157ms vs 365ms.)*

---

## 8. Model Selection Heuristics

### 8.1 Never compare models on parameter count alone
Qwen 3.5 9B (MoE, 2026-03) has 2x the intelligence index of Qwen3 14B (dense, 2025-04) despite having fewer parameters. Check: release date, architecture (MoE vs dense), and third-party benchmarks (Artificial Analysis). *(Lessons-learned, 2026-04-07.)*

### 8.2 Provider matters as much as model
Same model (Qwen 3.5 9B), same precision (FP8): DeepInfra serves at 170 tps, Together AI at 55 tps — 3.1x gap. When a model is slow, the first diagnostic is "find another provider," not "try a different model." *(AA comparison, 2026-04-07.)*

### 8.3 "LoRA support" means different things across providers
| Provider | LoRA hosting model | Viable for solo dev? |
|----------|-------------------|---------------------|
| W&B Inference | Per-token serverless, multi-tenant | **Yes** — $0.05/$0.22 per 1M |
| Together AI | Per-token serverless, multi-tenant | **Yes** — legacy home for tonal-pass |
| DeepInfra | Per-GPU-hour dedicated rental | No — $2-5/hr idle cost |
| Fireworks | Per-GPU-hour dedicated rental | No — same economics |
| Cerebras/Groq | No user adapter hosting | N/A |

Always verify the **serving** docs page, not just the **training** docs. *(Fireworks false positive, 2026-04-07.)*

### 8.4 Parallel-N works when variance is the problem, not when calibration is the problem
The diagnostic is **internal disagreement rate**: if parallel calls disagree with each other ≥10%, variance is the problem and aggregation helps. If they agree with each other but disagree with the oracle, calibration is the problem and aggregation won't help. *(Exp adherence-checker: 0/29 internal disagreement, 0pp improvement. Exp reference-resolver: ~57% Jaccard between calls, +23% recall gain.)*

### 8.5 At very short outputs, smaller models can be faster than larger ones on faster hardware
Decode-overhead-per-token dominates at <50 output tokens. Qwen3-14B on W&B beat Cerebras 235B on adherence-checker (157ms vs 365ms) because the response is ~17 tokens. At ~400 output tokens (beat-writer), Cerebras wins. **Match model to slot by output length, not just capability.** *(Exp #94.)*

---

## 9. Anti-Patterns to Avoid

### 9.1 Don't optimize from intuition — pull llm_calls and read the shapes
The natural instinct was to fine-tune the writer first. Actual data: writer costs $0.001/call (rounding error), continuity costs $0.0023/call with 7,294 input tokens (10x the next highest). **The real optimization target was invisible without querying production data.** *(Trace analysis, 2026-04-07.)*

### 9.2 Don't deploy a checker without a production pilot
Synthetic evals always underestimate false-positive rates. The 3-chapter romance-drama pilot is mandatory before any checker prompt ships to production. *(Post-exp #122 production disaster: 57% false-fail rate.)*

### 9.3 Don't design training data before measuring the prompt-engineering ceiling
The adherence-checker SFT case changed dramatically after the 4-call decomposition lifted 14B from 79% → 91%. The gap to close shrank from 17pp to 6pp. **Prompt-engineering is free; SFT is not. Measure the ceiling first.** *(Exp #110→#111→#122 progression.)*

### 9.4 Don't rerun all models when adding one to a comparison
If you already have results for models A, B, C on a fixed eval set, only run model D. The eval set is deterministic — existing results are still valid. *(Exp #138: ran only gpt-oss on the 160-pair set, compared against exp #122 reference.)*

### 9.5 Don't assume a provider swap is model-neutral
W&B Inference keeps Qwen3-14B hot but lets Qwen3-30B-A3B cold-start (33s p95 vs sub-second). Model architecture efficiency only matters when the serving infrastructure keeps it warm. *(Exp #92-94.)*

### 9.6 Don't use full-chapter rewriting for targeted fixes
All models (K2, 32B, 235B) change 63-78% of characters when reproducing a full chapter while making 3 edits. **Per-sentence with scene context is the only viable approach for targeted fixes.** *(Exp #67.)*

---

## 10. Checklist: Before Running Any Experiment

```
[ ] Hypothesis written down in experiment description
[ ] Primary lane named: baseline, changed runtime lever, feedback signal, stop gate, escalation rule
[ ] Parallel support work declared separately from the runtime behavior bundle
[ ] Out-of-lane runtime changes explicitly deferred to follow-up lanes
[ ] If using concurrent DeepSeek V4 Flash calls: sample shape, N, family key, budget cap, and promotion/rejection gate declared before launch
[ ] Code changes committed (git hash will be captured)
[ ] Baseline ladder exists or is being created as part of this experiment
[ ] Eval set covers PASS and FAIL variants (not just one direction)
[ ] Metric chosen matches the production cost function
[ ] Multiple metrics will be reported (exact-match + F1 + recall at minimum for set outputs)
[ ] Per-variant breakdown will be included in the conclusion
[ ] FP/FN confusion direction will be reported
[ ] Production model included in the ladder
[ ] Smoke run (16 pairs) planned before full run
[ ] If checker change: 3-chapter romance-drama pilot scheduled after
[ ] Experiment linked to related prior experiments in config JSON
[ ] Request-construction parity harness: if the experiment changes
    how outgoing LLM requests are constructed on any production code
    path (writer, checker, planner, context-builder, prompt assembly,
    model-config resolution), build and pass a structured-segment diff
    against a real llm_calls row for the same coordinates. Per §4.7.
    Skip categories (charter must name one): pure evaluation task,
    model/weight-only swap, analysis-only.
[ ] Sibling parity gates (add separately if the experiment touches
    these layers): response-parse parity, retry-audit parity, DB
    write-shape parity. Per §4.7. Request-byte parity does NOT cover
    these layers.
```

---

## 11. Lever Selection: Before Fine-Tuning

Fine-tuning is the most expensive lever — in dollars, in time, and in the risk of teaching the model the wrong generalization. Every fine-tune charter must show that cheaper levers have been **measured** (not just "considered") and failed. Every rule in this section was violated by at least one of the three hallucination-checker v3 retrains on 2026-04-18 that produced F1 regressions.

### 11.1 Lever hierarchy — cheapest-first

When a checker, writer, or extractor underperforms, work this ladder top-down. Do not skip rungs.

| Rung | Lever | Cost | When it works |
|------|-------|------|---------------|
| 1 | **Prompt edit** — schema, examples, field ordering, verdict-last | ~$0 | Model has the capability but is mis-calibrated or mis-framed (§4) |
| 2 | **Inference-time post-processing** — regex, threshold tuning, voting, rejection sampling, OR/AND with a deterministic check | ~$0 | The signal is in the output distribution; a cheap wrapper extracts it |
| 3 | **Decomposition** — split one call into N focused parallel calls | low | 14B+ cannot handle complex single-call checklists (§4.1) |
| 4 | **Data curation** — remove cross-contaminated labels from existing train set | low | Current train distribution teaches the wrong boundary (§6.2, §6.3) |
| 5 | **Teacher swap** — regenerate existing training data with a better-scoring teacher | moderate | Current teacher is weak on a specific variant (§5.3) |
| 6 | **Data expansion** — generate more examples in under-covered variants | moderate–high | Signal exists but coverage is thin (§6.4) |
| 7 | **Fine-tune retrain** — new adapter on new data | high | All rungs 1–6 measured and insufficient |
| 8 | **Base model swap** — different foundation | highest | Capacity floor hit |

### 11.2 Regex/deterministic post-processing is the cheapest counterfactual for any vocabulary or list-match task

If the task reduces to "does this output contain any token from a known list?", a regex against the list is a perfect-precision deterministic check. The only reason to fine-tune for list-matching is if the list is unknown at inference time. The Salvatore leak-detector violated this on 2026-04-18: the §A vocabulary list is static and known; a regex pass would have hit 100% precision at $0. The fine-tune instead taught the model to match *style* and produced false positives like `Frostvale`, `Seven-Towns`, `Baldur's Gate`. *(Leak-v2 eval, 2026-04-18.)*

### 11.3 Class rebalance without calibration analysis is not an improvement — it is a trade-off

Shifting the training prior from 62/38 PASS/FAIL to 50/50 predictably lifts recall and drops precision in the same direction. The net F1 movement is small and depends on the production class distribution. **Before rebalancing, measure whether the production-equivalent eval favors recall or precision.** If the production cost function favors precision (e.g., FPs trigger retries that consume writer budget), rebalancing toward FAIL is the *wrong* direction regardless of class imbalance. *(Ungrounded-v3, 2026-04-18: +10 pt recall / −14 pt precision / −0.5 pt F1. Production cost function favors precision. Net wrong direction.)*

### 11.4 Data expansion must add *distinct* signal, not denser copies of the same signal

5× prose examples per vocabulary token teaches the model that the token-context pattern matters, not the token itself. If all 5 examples are authored by the same generator in the same cadence, the model learns "this cadence implies leak" and generalizes to the cadence. **Diversity of generator, prose length, grammatical position, and co-occurring vocabulary must vary across the 5 examples, or density reduces to redundancy.** *(Leak-v2 vocab expansion, 2026-04-18: DeepSeek-generated, similar prose shapes, model generalized to Salvatore-adjacent *style*, not to the list.)*

### 11.5 "Improvement" without an ablation is not an improvement

If the charter proposes Change A + Change B, at least one of the three runs must isolate each change. Bundled changes produce uninterpretable results: if F1 drops, which change caused it? If F1 rises, which change is load-bearing for the next iteration? Ablation is cheap compared to a second misdirected retrain six experiments later.

### 11.6 When the natural-val eval regresses, the first question is "did the production distribution change?" not "how do we re-train?"

If the model's eval-distribution data is old and production distribution has shifted, the answer is to rebuild the eval, not retrain the model. Pull fresh `llm_calls` samples, label them, and see whether the regression is real or an artifact of eval staleness. *(Hallucination natural-val has not been refreshed since exp #223 — age unknown to the 2026-04-18 retrains.)*

### 11.7 Stop rule: three failed retrains on the same adapter family means the lever is wrong

After three consecutive charters in the same adapter family fail to beat baseline on the production-equivalent eval, stop attempting that adapter family for the session. The next charter must propose a *different lever* (see 11.1) or explicitly justify the fourth attempt with new evidence. This is not a quota — it is a forcing function to step back and re-examine the problem framing. *(Hallucination checker v2/v3/v3-rebalance/leak-v2 is at 4. Next hallucination-checker experiment requires re-examination, not a fifth adapter.)*

### 11.8 Fine-tune charter must cite which rungs 1–6 were measured

Every fine-tune charter's §5 ("Cheapest counterfactuals considered") must name specific measured results for at least rungs 1, 2, and 4 on the current production model. "Considered and rejected because X" without a measurement is not a rejection — it is a guess. The adversary review (`/charter-review` — Codex primary, Opus fallback; see `docs/experiment-adversary-prompt.md`) will block any charter whose rejections are unmeasured.

---

## 12. Promotion Thresholds

Phase-eval and prompt-A/B results are noisy. A single PASS verdict is suggestive, not promotion-grade. Every promotion path is gated by structural evidence — multi-run, multi-seed, or per-class FN/FP closure — not by best-run cherry-picking. Every rule below was learned from a real promotion miss (or near-miss) in the L7–L23 sequence.

### 12.1 Verdict ladder

| Verdict | Meaning | Action allowed |
|---------|---------|----------------|
| `SCREEN-FAIL (broken)` | Probe could not produce outlines / parser failed | Investigate parse, do not promote |
| `SCREEN-FAIL (non-compliant)` | Probe ran but failed a G1–Gn structural gate | Iterate or kill; do not promote |
| `SCREEN-PASS-SUGGESTIVE` | Single run cleared all gates | Eligible for re-probe; **not promote-eligible** |
| `PROMOTION-PASS` | This run passed AND ≥1 prior consecutive PASS exists on the same probe-family tuple | Promotion-eligible |

`scripts/phase-eval/print-screen-verdict.ts` emits these labels automatically; `scripts/phase-eval/promotion-check.ts` does the prior-run lookup. *(L13 + L10.)*

### 12.2 Probe-family tuple

Two runs are comparable only if they share `(probe_name, test_variant, git_commit, seed)`. Group families with `scripts/phase-eval/list-runs.ts` (default rollup mode). Mixing seeds, commits, or variants across "the same" probe is the most common source of false promotion claims. *(L13: family rollup added because cherry-picked PASS rows from different commits / seeds were being read as a streak.)*

### 12.3 Minimum promotion gate: 3 consecutive PASS on the tuple

Or equivalently, **2 seeds × 2 reruns (4 cells) all-passing** when seed-generalization is the gate. Single n=10 PASS is insufficient. *(L10, exp #323: Family A's coverage-balanced variant flapped 4 PASS / 2 FAIL on the same tuple — without the 3-consecutive guard, two of those runs would have triggered incorrect KILL decisions.)*

The probability calculation (n=3 consecutive PASS): P(3 consec | true 60% pass-rate) = 22% vs P(3 consec | true 85% pass-rate) = 61%. The gap is what makes the gate informative.

### 12.4 Coefficient-of-variation reference table

Use these CV values to decide whether a metric is gateable from a single run:

| Metric class | Typical CV | Gateable from 1 run? | Source |
|--------------|-----------|----------------------|--------|
| `total_scenes` (well-conditioned) | 0.04–0.16 | Yes (if delta is ≥1.5σ) | L10 Family C control |
| `facts_median` (typical) | 0.16–0.18 | Suggestive only | L10 Family A/D |
| `facts_median` (high-noise) | 0.30–0.40 | **No — multi-run required** | L10 Family A test arm |
| `know_median` | 0.16–0.22 | Suggestive only | L10 Family C |
| `closer_action` rate | 0.55+ | **No — never gate from rate** | L10 Family C |
| Adherence-checker recall (panel) | 0.05–0.15 | Yes for binary; suggestive for two-of-three | L18 |
| Halluc-ungrounded F1 (panel) | 0.05–0.12 | Yes if delta ≥0.05 | L23b |

A CV ≥ 0.35 on the gating metric means the verdict is unreliable — promote only after 3-consecutive-PASS on the tuple.

### 12.5 At CV=0.18, ±15% of mean requires n=4 runs

The standard 90% CI calculation gives n=4 for ±15% precision and n=31 for ±5%. This is why the practical gate is "3 consecutive" not "3/5" — the latter requires too many runs to be cost-effective at production CV levels. *(L10.)*

### 12.6 Single-seed-deep beats multi-seed-shallow at near-equal cost

Multi-seed (3 seeds × 5 chapters × 3 reruns = 9 cells) was 3-4× noisier than single-seed-deep (1 seed × 10 chapters × 5 reruns) on per-chapter medians. Between-seed structural variation in the planner output distribution dominates within-seed temperature noise. Default phase-eval shape is **single-seed-deep**; multi-seed lives as a sibling for explicit seed-generalization probes only. *(L6, exp #318, `phase_eval_runs.id=67`.)*

### 12.7 Prompt-A/B promotion gate: 100% on production-equivalent panel + no regression on labeled panel

Two parallel acceptance gates for any prompt iteration:
1. **Target gate:** the new shape's recall/precision on the dedicated synthetic panel (the FN/FP class the iteration is closing).
2. **Regression gate:** the labeled production-equivalent panel's exact previous numbers must hold (e.g., `current-surface-panel-exp299-labeled.jsonl` for halluc-ungrounded → must stay at 100/100).

Iterate until both gates pass. If only the target gate passes but the regression gate breaks, the iteration is a side-grade, not a promotion. *(L21 needed 5 iterations; v3-v7 reasoning-first variants closed the candle case but caused 3 FPs on the regression panel.)*

### 12.8 A/B prompt iterations: positive framing, no negative-prime "X OR Y"

Negative priming ("never use X, NEVER add Y, do NOT default to Z") consistently makes the model emit the forbidden tokens MORE, not less — observed in 2026-04-20 Salvatore A/B (+10.5 pts worse) and L21 (the explicit-prohibition reasoning-first variants regressed precision by 14 pts). Reframe as "Treat X as equally obligated as Y" or "Pass [positive description]" instead. The lint at `scripts/phase-eval/lint-prompts.ts` warns on `X OR Y` + negative-prime patterns — heed it. *(`feedback_priming_suppression_ab` + `feedback_act_on_codex_consensus`.)*

### 12.9 Cluster verification: prior closures must not regress

When promoting a fix that closes a new FN class, also verify the prior closures still hold. The L17→L20→L22→L23 ratchet uses the same fantasy-debt seed across smokes precisely so each iteration's plan-assist gate fires can be class-checked: L20 must close the L17 cluster (Brennan/Aldric); L23 must close the L22 cluster (T.C./Guildmaster) AND the L17 cluster. A regression on a prior cluster is a stop-condition (c) — roll back, don't patch in-place. *(L22 + L24.)*

### 12.10 Atomic FN closures: one ticket = one orthogonal fix

L23 split into L23a (NER initials + capitalized-first-only extractors) and L23b (derived titles + v5 prompt) because the 4 entities had 4 root causes. Bundling all 4 into one prompt rewrite would have produced an uninterpretable A/B result if the ratio of fixed-vs-broken changed unevenly. The atomic structure also lets git revert a single-cause regression without unwinding the others. *(L23a/L23b parallel-dispatch sprint, atomic commits per concern.)*

### 12.11 Adopt the `--persist` discipline: probe results live in `phase_eval_runs`, not stdout

Every checker A/B / planner variant / synthetic-panel run should pass `--persist` to the script (or call `persistPhaseEvalRun()` directly). Stdout is volatile and lost; the DB row is queryable, comparable, and stays linked to the experiment. Persistence is also the prerequisite for the family-rollup (§12.2) and consecutive-PASS gate (§12.3). *(R6 v1, commit `31f26b4`.)*

### 12.12 Primary-lane loop rule

Every iteration loop has exactly one primary lane: the causal hypothesis under validation. The lane may span multiple files when one behavior bundle requires it, but it should not combine unrelated runtime levers.

Support work can run in parallel if it improves attribution or operability without changing the behavior being validated. Examples: tests, replay harnesses, result summarizers, docs-impact audits, operator summaries, stop classifiers.

Promotion evidence belongs only to the primary lane. A support script making the next run easier is not evidence that the runtime lever worked. A live smoke that includes unrelated prompt, schema, routing, threshold, planner-context, or retry-policy changes is not attribution-clean unless those changes were declared as one bundle before the run.

### 12.13 DeepSeek V4 Flash statistical-power rule

Use cheap concurrent DeepSeek V4 Flash calls to strengthen one lane's evidence, not to multiply unrelated lanes. Good uses:
- fixed-panel checker reruns to measure disagreement, recall, precision, and FP/FN class movement
- paired replay over saved `llm_calls` so control and treatment share upstream artifacts
- repeated same-family phase-eval runs to avoid single n=10 cherry-picks
- multi-seed confirmation after a single-seed-deep lane has a clear signal

Every concurrent batch must predeclare sample shape, N, family key or panel identity, expected cost, budget cap, and promotion/rejection gate. Persist results to `phase_eval_runs`, checker JSONL/result docs, or experiment conclusion rows. Do not stop early on a favorable partial batch unless the stop rule said so before launch.

Bad uses:
- running L38 context wiring, continuity threshold calibration, and writer prompt edits concurrently
- mixing probes with different commits or prompt hashes and treating them as a streak
- spending repeated calls on a deterministic/systematic failure class that needs a code/context fix, not variance reduction

### 12.14 Stop-condition labels for any iteration loop

Every loop should declare which of (a)/(b)/(c)/(d)/(e) fired:
- (a) Clean pass — acceptance criterion met; promote, doc, commit
- (b) New dominant blocker — target cluster is gone and a new out-of-scope cluster has clear evidence; document the new cluster, propose follow-up sprint
- (c) Regression — prior cluster regresses; diagnose or revert before new work, doc the regression
- (d) Infrastructure failure — DB, deploy, provider, test harness, logging, or missing evidence prevents interpretation; fix the harness first
- (e) Cost cap crossed — doc partial findings + remaining budget

Without a stop-condition label, future loops can't tell whether the work was a clean win, a planned-followup, a regression, an infrastructure failure, or an exhausted budget. *(Standing practice across L17–L24.)*
