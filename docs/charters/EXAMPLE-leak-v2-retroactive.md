---
status: example (retroactive — training already ran on 2026-04-18)
kind: experiment-charter
experiment-family: halluc-leak-salvatore
proposed-by: <author>
proposed-date: 2026-04-18 (retroactive)
adversary-verdict: RED (retroactive — experiment would have been blocked)
---

# Experiment Charter — `halluc-leak-salvatore-v2` (retroactive example)

This is a **retroactive** charter for an experiment that has already run. It exists to show what the charter *should* have looked like on 2026-04-18 and why the `experiment-adversary` subagent would have returned RED. Read alongside `docs/experiment-charter-template.md`.

## 1. Question

Can a second-generation Salvatore-leak detector adapter recover more of the §A vocabulary on natural val (recall 40% → ≥75%) without destroying precision?

## 2. Hypothesis

**If** we generate 5× prose examples per §A token (49 tokens × 5 = 245 positive pairs) and merge with the existing v1 train set, rebalancing negatives to 50/50, **then** natural-val recall on FAIL-leak beats **will rise** from 40% to ≥75% **because** every token in the vocabulary list now has explicit training coverage rather than the 0–2 examples in v1.

## 3. Falsification threshold

If precision drops more than 10 pts while recall moves less than 15 pts, the mechanism is wrong — the model is generalizing to Salvatore-adjacent *style*, not learning the list. Abandon vocab-expansion via LLM-generated prose as a lever.

(Retroactive outcome: precision 86% → 50% [−36 pts], recall 40% → 60% [+20 pts]. Mechanism falsified. This falsification was only recognized *after* the run because the charter did not exist.)

## 4. Baseline ladder

| Slot | Model / config | Purpose |
|------|----------------|---------|
| Floor | No leak adapter (ungrounded-only) | What happens if we ship nothing |
| Current prod | `halluc-leak-salvatore-v1` | Beat this or don't ship |
| Ceiling | Regex against §A vocabulary list + case-insensitive substring | Deterministic upper bound on list-match precision |

**Gap flagged retroactively:** the ceiling rung (a deterministic regex) was never measured before spending on the fine-tune. This is a §11.2 violation and would have been the adversary's primary kill-shot.

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Rejected because |
|-------|----------------|------------------|
| **Rung 1 — Prompt edit** (add all 49 §A tokens to the system prompt as explicit list) | $0 | **NOT MEASURED before this charter — required measurement.** v1's system prompt already lists ~30 tokens as examples; extending to all 49 is trivial. |
| **Rung 2 — Regex post-processing** — deterministic substring match against §A list, OR-combined with adapter output | $0 | **NOT MEASURED — required measurement.** §11.2 says this is the correct counterfactual for any vocabulary-list task. A regex pass on the 49 tokens hits 100% precision on in-list tokens; the only failure mode is alias handling (e.g. "Mithral Hall" vs "Mithril Hall") which can be enumerated. |
| **Rung 3 — Decomposition** — split leak detection into character/place/item/race passes | low | Not a fit; the task is already a single decision (is token in list?). |
| **Rung 4 — Data curation** of v1 train set | low | **NOT MEASURED — required measurement.** v1 train was 79/158 FAIL/PASS and no curation pass had been done. |

**Adversary verdict on this section:** RED. Three of the four cheapest rungs were not measured, and rung 2 (regex) would plausibly have hit 100% precision at $0. The fine-tune should not have run.

## 6. Distribution match

- **Train set (proposed):** 648 pairs — 324 FAIL / 324 PASS after 2× PASS oversample. Of the 324 FAIL, 245 are DeepSeek-generated prose in a single cadence, all constructed around isolated §A tokens.
- **Eval set (natural val):** 160 pairs — 10 FAIL / 150 PASS. Reflects production distribution (~6% FAIL).
- **Production distribution:** estimated <5% FAIL rate from `llm_calls` sampling (not formally measured).

**Mismatch flag:** train is 50/50, eval is 6% FAIL. The 50/50 training prior will shift calibration toward predicting FAIL, which is a precision hit proportional to the class-rate ratio (8×). §11.3 — class rebalance without production-rate analysis is a trade-off, not an improvement. **Expected precision cost from this mismatch alone: 15–30 pts.** The hypothesis in §2 did not account for this.

**Additional mismatch:** the 245 DeepSeek-generated FAIL examples are not stylistically matched to production writer output. Production leaks come from DeepSeek V3.2 writer or Salvatore voice LoRA, not from prompted DeepSeek-as-synthesizer. The cadence of the synthesis generator becomes a confound.

## 7. Success criteria

| Outcome | Condition | Action |
|---------|-----------|--------|
| SHIP | Natural-val P ≥ 85% AND R ≥ 75% AND F1 ≥ v1's 56% | Promote to production; 3-chapter pilot |
| ITERATE | R ≥ 65% but P < 85%, no regression vs v1 F1 | Add harder negatives, retrain |
| KILL | P drop > 10 pts with R gain < 15 pts | Abandon vocab-expansion lever; return to §11 ladder |

(Retroactive outcome: KILL condition met.)

## 8. Budget

- **Spend cap:** $5 training + ~$0.50 eval ~= $5.50
- **Time cap:** 2h wall-clock
- **Stop if:** train loss plateau at step 300/972, training data regenerates (would indicate prompt injection failure).

## 9. Linked context

- Prior experiments: #223 (v1 adapter training), #195 (v2 probe failure — prompt-shape mismatch, separate story)
- Related decisions: `docs/decisions.md` 2026-04-18 "Hallucination-checker v3 two-adapter architecture"
- Code to commit before run: `scripts/hallucination/expand-leak-vocab.ts`, `scripts/hallucination/build-leak-v2-train.ts`
- `tuning_experiment` ID: to be assigned

## 10. Adversary review

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT, retroactive) — primary | **RED** | 2026-04-18 | (retroactive — Codex plugin installed after this experiment ran) §5 rungs 1/2/4 unmeasured. §11.2 violation. §6 class-rate mismatch predicts 15–30 pt precision hit, greater than the §3 10-pt falsification threshold — experiment is unfalsifiable-by-shape. Recommended: regex + alias expansion + OR with v1 adapter. $0, expected 100% precision on in-list. |
| `experiment-adversary` (Opus, retroactive) — fallback | **RED** | 2026-04-18 | Concurred with primary. No dissenting axis. |

## Retroactive lessons

- The v2 experiment would have been killed by a 5-minute adversary review that cost nothing to run.
- The adapter is now trained, eats W&B storage, and underperforms the regex counterfactual that was never measured.
- The mechanism falsification in §3 was observable from the charter alone (§6 mismatch predicted the precision hit). No training spend required.
- **Going forward:** no hallucination-adapter retrain without an adversary-GREEN charter. §11.7 stop-rule applies: 4 consecutive attempts on this family; next attempt must propose a different lever.
