---
status: proposed
kind: experiment-charter
experiment-family: salvatore-distinctness-conditioning-floor
proposed-by: Codex
proposed-date: 2026-04-18
adversary-verdict: pending
supersedes: docs/charters/salvatore-v5-corpus-expansion.md
depends_on: docs/evals/salvatore-distinctness-v1.md
---

# Experiment Charter — `salvatore-distinctness-conditioning-floor`

Supersedes the RED `salvatore-v5-corpus-expansion` charter. This charter is conditioning-first by design: test the measured inference-time floor on the frozen distinctness eval before reopening any corpus-expansion claim.

## 1. Question

On the frozen distinctness eval, does rotating v4 `exampleLines`/profile conditioning improve multi-character separation enough that corpus expansion can wait?

## 2. Hypothesis

**If** `salvatore-1988-v4` keeps the same adapter but rotates frozen `exampleLines` / profile subsets at inference time across the three preset sweeps defined in [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md), **then** the primary metric on `salvatore-distinctness-v1` will improve by at least `4/24` exact-assignment cells over fixed v4, while the secondary retention axis on `salvatore-original-v1` plus held-out val worsens by no more than `+0.10 Δ-sum` versus v4, **because** the remaining blur is more likely a conditioning-surface bottleneck than a missing-corpus bottleneck: v4 already bakes character-conditioned `exampleLines` into both training and runtime, and the cheapest unresolved question is whether rotating those anchors reduces one-subset luck and paraphrase collapse enough to separate hard pairs without retraining.

Primary metric artifact:
- [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md)

Secondary retention artifacts:
- [docs/voice-lora-salvatore.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/voice-lora-salvatore.md)
- [docs/writer-imitation-benchmark.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/writer-imitation-benchmark.md)

This charter inherits the frozen judge choice and circularity rationale from the eval artifact. It does not reopen judge selection.

## 3. Falsification threshold

The conditioning-first mechanism is wrong if either prong fires:

1. Rotation gain is `<=2/24` on the frozen distinctness eval versus fixed v4. That means conditioning is not the lever; changing the subset does not move exact assignment enough to justify staying in the conditioning family.
2. Retention regresses by `>+0.10 Δ-sum` versus v4 on `salvatore-original-v1` plus held-out val. That means rotation is actively harming the shipped surface even if the distinctness number moves.

If either prong fires, kill the conditioning-first approach and reopen corpus expansion as a candidate in a separate charter. PDF acquisition for corpus expansion remains a pre-gate there, not in this charter.

## 4. Baseline ladder

| Slot | Model / config | Purpose |
|------|----------------|---------|
| Floor | `salvatore-1988-v3` | Earlier writer LoRA before full-trilogy corpus and runtime `exampleLines` conditioning |
| Current prod | `salvatore-1988-v4` | Current fantasy default; fixed conditioning baseline |
| Conditioning floor | `salvatore-1988-v4` + rotated `exampleLines` / profile subsets at inference | Primary test arm; same adapter, different conditioning surface |
| Ceiling | Sonnet+profile ceiling from exp `#220` | Stronger instruction-following anchor for the distinctness axis |

No additional rungs belong in this charter. There is no training arm.

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Disposition |
|-------|----------------|-------------|
| v4 + rotated `exampleLines` / profile subsets at inference on the frozen eval | Eval-generation + pairwise judging only | MUST-MEASURE. This is the primary arm of the charter, not a rejected alternative. |
| Profile-only ablation if rotation wins: keep the same rotation machinery but blank `tics` / `avoid` so only `exampleLines` rotate | Cheaper follow-on than retraining; same eval surface | FLAGGED, NOT PRIMARY. If full rotation wins, run this sub-counterfactual before claiming the entire profile payload is load-bearing. |
| Corpus expansion retrain (`salvatore-v5-corpus-expansion`) | Training + corpus-prep + eval spend | EXPLICITLY DEFERRED. Reopen only if the conditioning floor fails and the separate corpus charter clears its own source-acquisition gate. |

Work-order reminder: `src/agents/writer/beat-context.ts` is the relevant runtime surface because `exampleLines` are rendered there under each character profile. This charter measures that surface before authorizing any broader intervention.

## 6. Distribution match

- **Train set stratification:** Not applicable. This is an inference-conditioning ablation charter, not a training-data change.
- **Eval set stratification:** The pilot is exactly the frozen [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md) surface: `24` assignment cells, `3` hard pairs, `4` beat archetypes, and `3` fixed rotation presets per character. That yields `72` per-arm generations. The charter compares three non-baseline arms against fixed v4: `v3`, `v4+rotation`, and `Sonnet+profile`, for `72 per-arm generations × 3 comparison arms`.
- **Production distribution:** This is a proxy eval for the actual failure mode called out in the RED review: multi-character separation under the writer's existing profile/example-line conditioning surface. It matches the shipped v4 runtime surface more closely than a corpus-expansion retrain would because the adapter stays fixed and only conditioning changes.

Known mismatch, inherited transparently from the frozen eval:

- `Jarlaxle` and `Zaknafein` do not exist as direct speaking characters in the Icewind Dale trilogy bundle on disk, so [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md) freezes them as explicitly disclosed nearest-match proxy cards. `Jarlaxle` proxies derive from `Pook` / `Malchor`; `Zaknafein` proxies derive from `Drizzt`'s drow-coded confession / teaching register.
- This limitation is acceptable only because it is frozen and disclosed in the eval spec up front. The charter inherits that limitation; it does not hide it.

## 7. Success criteria

Primary metric is the frozen `salvatore-distinctness-v1` exact-assignment count, reported as total cells and per-pair counts on the same judge and the same three-sweep protocol. Secondary metric is retention on `salvatore-original-v1` plus held-out val, measured as Δ-sum change versus v4.

| Outcome | Condition | Action |
|---------|-----------|--------|
| SHIP conditioning floor | Rotation adds `>=4/24` correct assignments over v4, no anchor pair falls below `3/4`, and `salvatore-original-v1` retention worsens by no more than `+0.10 Δ-sum` versus v4 | If the implementation stays inference-local to preset selection / conditioning assembly, promote rotation to the default v4 conditioning surface. If shipping requires new production preset infrastructure, do not silently widen scope here; open a follow-on charter for rotation infrastructure before default routing. |
| ITERATE conditioning | Rotation beats v4 on the frozen eval but misses at least one ship gate while staying above the kill threshold | Keep corpus expansion closed for now, document the residual failure by pair, and decide whether the next cheapest step is the profile-only ablation or a production-infra charter for deterministic rotation. |
| KILL / REOPEN corpus candidate | Rotation gain is `<=2/24`, or any falsification prong in §3 fires | End the conditioning-first claim. Reopen corpus expansion separately, with PDF acquisition treated as that charter's pre-gate rather than this charter's problem. |

Interpretation rule: use count units only. Do not translate these gates into points or percentages.

## 8. Budget

- **Spend cap:** No training budget. This charter pays only for eval-generation + pairwise judging.
- **Workload anchor:** Use the same pairwise-judging workload shape as exp `#220`, scaled to this eval's frozen arm count.
- **Estimate formula:** `budget_estimate = (72 generations per arm × 3 arms × avg_cost_per_beat_generation) + (48 pairwise judge calls per comparison × 3 comparisons × avg_cost_per_Opus_judge_call)`
- **Why this stays formula-only in draft:** recent `llm_calls` were not queryable from the current workspace during charter drafting, so freezing a dollar number here would be invented precision.
- **Pre-run fill-in rule:** If recent `llm_calls` are queryable at launch time, replace the two average-cost placeholders with measured recent values and freeze the resulting dollar amount before running. If recent `llm_calls` are not queryable, keep the formula explicit and treat the estimate as anchored to exp `#220` pairwise workload rather than an invented numeric certainty.
- **Time cap:** Under one working day for generation + judging only; no corpus prep, no training, no adapter conclusion loop.
- **Stop if:** the frozen eval surface changes, the named judge changes, or the comparison requires editing anything beyond inference conditioning / eval orchestration.

## 9. Linked context

- RED original superseded here: [docs/charters/salvatore-v5-corpus-expansion.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/charters/salvatore-v5-corpus-expansion.md)
- Work order: [docs/charters/revision-work-order-2026-04-18.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/charters/revision-work-order-2026-04-18.md)
- Frozen eval spec: [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md)
- Frozen beat pool: [docs/evals/salvatore-distinctness-v1-beats.jsonl](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1-beats.jsonl)
- Frozen voice cards: [docs/evals/salvatore-distinctness-v1-voice-cards.json](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1-voice-cards.json)
- Scoring script skeleton / remaining implementation gate: [scripts/evals/run-salvatore-distinctness-v1.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/run-salvatore-distinctness-v1.ts)
- Runtime conditioning surface: [src/agents/writer/beat-context.ts](/Users/andre/Desktop/personal_projects/novel-harness/src/agents/writer/beat-context.ts)
- Retention / lineage context: [docs/voice-lora-salvatore.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/voice-lora-salvatore.md), [docs/writer-imitation-benchmark.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/writer-imitation-benchmark.md)
- Decision precedent for model-dependent voice judgments: [docs/decisions.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/decisions.md) (`2026-04-17 Archetype POC`)

## 10. Adversary review

Leave all slots pending. This charter is not ready for re-review until the §11 gate is satisfied.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — primary | pending | pending | Hold until the §11 readiness gate is satisfied |
| `experiment-adversary` (Opus) — fallback only | pending | pending | Only run if Codex is unavailable or a second opinion is explicitly requested after Codex review |

## 11. Open questions / readiness gate

- "Do not re-review until `salvatore-distinctness-v1` exists as a frozen eval artifact with a named judge and the charter is scoped to conditioning-first rather than corpus expansion."
- That gate is now partially satisfied. [docs/evals/salvatore-distinctness-v1.md](/Users/andre/Desktop/personal_projects/novel-harness/docs/evals/salvatore-distinctness-v1.md) is frozen with `status: frozen-2026-04-18`, names `gpt-5.4` as the judge, and this charter is conditioning-first rather than corpus expansion.
- The remaining readiness gate is implementation, not design: [scripts/evals/run-salvatore-distinctness-v1.ts](/Users/andre/Desktop/personal_projects/novel-harness/scripts/evals/run-salvatore-distinctness-v1.ts) still contains open TODOs for `generateSample()`, `judgePair()`, deterministic seeded shuffling, and stable on-disk arm-config schema. This charter cannot be re-reviewed until those TODOs are resolved and the scorer can actually produce the frozen report shape.
- Open post-win path: if rotation wins on the frozen eval, does that ship directly as default conditioning or require another charter? This charter makes that split explicit. Direct promotion is allowed only if the implementation is inference-local and deterministic on the existing v4 surface. If production needs preset-state plumbing, telemetry changes, or a broader runtime contract, that is a new charter, not scope creep hidden inside this one.
- Corpus-expansion acquisition remains orthogonal. If conditioning fails at `<=2/24`, reopen the corpus charter separately and treat source-book acquisition as that charter's pre-gate.
