---
status: proposed
kind: experiment-charter
name: character-distinctness-audit-v1
owner: andre
date: 2026-04-21
parent-charter: docs/charters/voice-shaping-ablation-v1.md
---

# Experiment Charter — `character-distinctness-audit-v1`

Cheap follow-on to `voice-shaping-ablation-v1`. Runs the deferred
character-distinctness Sonnet quote-required audit from that charter
§7 on the already-generated 80 `eval_results` rows (Arms D0 / D1 / D2 /
D3 on same 20 beats), plus the Salvatore v4 anchor from
`arm-d-writer-upgrade-v1`. No new writer generation.

Answers the question the voice-shape metrics couldn't: **does any
prompt-level intervention measurably improve per-character
distinctness within a beat?** D3 (character voice directives) was
specifically designed for this; voice-shape-metrics reported D3 as
FLAT vs D0 because they measure rhythm/cadence, not speaker
differentiation. Distinctness is a different axis.

## 1. Hypothesis

**If** we run a blind Sonnet quote-required distinctness audit on the
existing 20 beats × 5 arms (100 beat-arm samples) using the rubric
pre-registered in `voice-shaping-ablation-v1.md` §3, **then** D3 will
pass distinctness on ≥ 15/20 beats AND at least 10pt over D0's
pass rate, **because** D3's CHARACTER VOICE DIRECTIVES block
explicitly instructs the writer to differentiate characters on
cadence / register / signature phrasings / dialogue-tag variety
axes that the bare DeepSeek prompt doesn't emphasize.

## 2. Falsification

- **D3 pass rate < D0 pass rate + 5pt** → the character-directive
  prompt doesn't measurably differentiate characters at DeepSeek
  scale. Architecture implication: character distinctness requires
  either a different prompt structure OR a different instrument
  (multi-turn conversation, per-character generation passes).
- **Adjudicator retest flips ≥ 2/4** → rubric too vague. Re-register
  the rubric; do not report a verdict from this run.

## 3. Arms (all reuse existing eval_results rows, NO regeneration)

| Arm | Source | Expected role |
|---|---|---|
| S (Salvatore v4) | `eval_results` set `arm-d-writer-upgrade-v1` cell `A-salvatore-v4` | Production anchor — LoRA's baseline distinctness |
| D0 | `eval_results` set `voice-shaping-ablation-v1` cell `D0-bare` | Bare DeepSeek baseline |
| D1 | set `voice-shaping-ablation-v1` cell `D1-style-guide` | Style guide doesn't target distinctness; expected ≈ D0 |
| D2 | set `voice-shaping-ablation-v1` cell `D2-few-shot` | Few-shot examples might transfer character-differentiation patterns; uncertain |
| D3 | set `voice-shaping-ablation-v1` cell `D3-char-directives` | Distinctness-targeted — the arm that should win if prompt-level character shaping works |

## 4. Measurement protocol

**Instrument:** Sonnet subagent per beat-arm packet (100 total).
Parallelizable via the `Agent` tool — max 10 concurrent per the
parallel-batch-limit memory.

**Rubric (frozen, from `voice-shaping-ablation-v1.md` §3):**

> For each beat, given two or more speaking characters, decide: do
> the characters sound meaningfully different from each other — in
> diction, cadence, register, or signature phrasing — GROUNDED IN
> their speaker profiles?
>
> **Mandatory:** quote one line from each speaking character, cite
> the specific speaker-profile attribute (voice, drives, avoids,
> conflict) the line reflects, and decide.
>
> **Do NOT reward** length, sensory richness, prose polish, dialogue
> tag variety, or "evocative" language. These are not distinctness.
> A distinctness win means "the reader could tell who's speaking
> without the tag"; a distinctness loss means "the characters all
> sound like the same person."
>
> **Label:** PASS / FAIL / UNCLEAR (with quote-required justification).

**Beats without multiple speakers** are scored N/A and excluded from
the pass-rate denominator.

**Retest controls:** 4 silent retests (same packet, different seed,
separate invocation) sampled deterministically across arms. Flip rate
> 2/4 = rubric drift → re-register before reporting.

## 5. Success criteria

| Outcome | Condition | Action |
|---|---|---|
| **GO** | D3 pass rate ≥ D0 + 10pt AND ≥ 75% absolute | Character-directive prompt works. Ship D3-style speaker directives into production default for fantasy route (additive to the DeepSeek writer decision). |
| **MODEST** | D3 pass rate ≥ D0 + 5pt but < 10pt | Real but small effect. Keep as candidate; stack with other context levers in autonomous-loop exploration. |
| **FLAT** | D3 pass rate within 5pt of D0 | Prompt-level character-shaping doesn't move distinctness on its own. Architecture pivot for distinctness: per-character context passes, multi-turn generation, or weight-level per-character fine-tune. |
| **INCONCLUSIVE** | Retest flips ≥ 2/4 OR N/A rate > 30% of beats | Re-register rubric OR expand beat pool to include more multi-speaker beats. |

## 6. Budget

- **Spend cap:** $0.50 hard. Expected: 100 Sonnet subagent calls × ~$0.003 = $0.30.
- **Wall-clock cap:** 1 hour (parallel 10-at-a-time = ~20 min adjudication + aggregation).
- **Human time:** 0 primary adjudication. Spot-check any beat where
  retest flips.
- **Stop if:** >10% subagent errors; adjudicator-position variance on
  retests.

## 7. Adversary review

One Codex pass per §9 discipline. This charter is trivially scoped
(reuse existing data, established rubric); if round 1 is YELLOW with
protocol tweaks, fix and proceed. RED on newly-discovered structural
concern escalates.

| Reviewer | Verdict | Date | Notes |
|---|---|---|---|
| `/codex:adversarial-review` — round 1 | — | — | (pending) |
