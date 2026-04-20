---
status: template
kind: experiment-charter
---

# Experiment Charter — `<short-name>`

One page. Fill before any training spend or benchmark run. Pass through `experiment-adversary` subagent; block `train-lora.py` / `EXPERIMENT_ID=N` run on a GREEN verdict.

## 1. Question

One sentence. What are we trying to learn? Not "what are we trying to build" — what uncertainty gets resolved by this run?

## 2. Hypothesis

**If** *<intervention>* **then** *<metric>* **will** *<direction>* **by** *<magnitude>* **because** *<mechanism>*.

Magnitude must be a number with a unit. "Recall should go up meaningfully" is not a hypothesis — "recall on natural-val FAIL beats should rise from 40% to ≥65%, because every §A token now has 5× training density, teaching the model to match the exact vocabulary rather than Salvatore-adjacent style" is a hypothesis.

## 3. Falsification threshold

The result that would tell us the mechanism is wrong (not just that the magnitude was smaller than hoped). Must be stated *before* we see results.

Example: "If precision drops more than 10 pts while recall moves <5 pts, the mechanism (teaching exact vocabulary) is wrong — the model is generalizing to style. Abandon vocab-expansion as a lever; do not train v3."

## 4. Baseline ladder

What are we comparing against? Minimum: current production, one weaker anchor, one stronger anchor (per `experiment-design-rules.md` §2). Include the production model even if "we already know it works."

| Slot | Model / config | Purpose |
|------|----------------|---------|
| Floor | ... | ... |
| Current prod | ... | ... |
| Ceiling | ... | ... |

## 5. Cheapest counterfactuals considered

Enumerate the 2–3 cheapest alternative levers that could plausibly hit the target, and state why each is rejected. Fine-tuning is expensive; every charter must show that cheaper levers were ruled out, not skipped.

| Lever | Estimated cost | Rejected because |
|-------|----------------|------------------|
| Prompt edit | $0 | ... |
| Inference-time post-processing (regex, threshold tuning, voting) | $0 | ... |
| Data curation on existing train set | ~$0 | ... |
| Different teacher / different base model | ... | ... |

If any of these would plausibly hit the target at <10% of the proposed cost, that is the experiment. Not this one.

## 6. Distribution match

- **Train set stratification:** ...
- **Eval set stratification:** ...
- **Production distribution (real beats in `llm_calls`):** ...
- **Parity harness (per `experiment-design-rules.md` §4.7):** If this experiment intervenes on a production code path (writer, checker, planner, context-builder), name the parity-harness script that will run before judging and the real `llm_calls` coordinates it will diff against. Expected-delta regions (e.g., "exampleLines block") are enumerated here. If the experiment does NOT run production code with an experimental knob, write "not applicable — pure evaluation task, no parity harness needed" with a one-sentence rationale.

Flag any mismatch. `experiment-design-rules.md` §7.1 — expect 5–10 pt generalization penalty; mismatch widens it.

## 7. Success criteria

Explicit thresholds for each possible outcome. No moving goalposts after the fact.

| Outcome | Condition | Action |
|---------|-----------|--------|
| SHIP | ... | promote to production, route traffic |
| ITERATE | ... | adjust and re-charter |
| KILL | falsification threshold hit | abandon this lever family, record in decisions.md |

## 8. Budget

- **Spend cap:** $X (training + eval calls)
- **Time cap:** N hours wall-clock
- **Stop if:** loss plateau, data error rate ≥5%, infra error, or charter invalidated by new information mid-run

## 9. Linked context

- Prior experiments: #NNN, #NNN (what they established)
- Related decisions: `docs/decisions.md` → <heading>
- Code to commit before run: `src/agents/...`, `scripts/...` (one-change-per-commit per `commit-conventions.md`)
- `tuning_experiment` ID will be: #NNN (assigned by `createTuningExperiment()`)

## 10. Adversary review

Primary reviewer is Codex via `/charter-review` → `/codex:adversarial-review`. Different model family from Claude → genuine divergent critique. Opus `experiment-adversary` subagent is fallback only (Codex quota / outage / explicit second opinion after a YELLOW).

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — primary | GREEN / YELLOW / RED | YYYY-MM-DD | key critique, rule/exp citations |
| `experiment-adversary` (Opus) — fallback only | — | — | only fill if Codex unavailable or second opinion requested |

Block training on YELLOW or RED. Iterate the charter, not the run. If both reviewers ran and **disagreed**, record both verdicts and escalate — disagreement between model families is load-bearing signal, not noise to average away.
