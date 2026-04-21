---
status: proposed
kind: experiment-charter
name: voice-shaping-ablation-v1
owner: andre
date: 2026-04-21
parent-context: docs/retrospectives/2026-04-21-lora-track-evidence.md
---

# Experiment Charter — `voice-shaping-ablation-v1`

First experiment under the post-LoRA-pivot architecture. Tests whether
prompt-level and pipeline-level interventions on DeepSeek V3.2 base
can shape voice (both Salvatore-imitation-specific and
character-distinctness-general) to levels that justify dropping the
voice-LoRA fine-tune track.

Motivated by: (a) Arm D partial evidence that DeepSeek produces longer,
more consistent prose than Salvatore v4 on byte-equal prompts;
(b) user observation that 14B-LoRA voice transfer had hallucination
problems (corpus leak) that are less severe at larger base sizes;
(c) Codex's decomposed-audit recommendation (job `ae0e768d3292eb256`)
that holistic pairwise is bias-confounded on this corpus and
structured metrics are the right measurement.

## 1. Question

Can prompt-level + pipeline-level voice-shaping interventions on
DeepSeek V3.2 produce prose that (a) matches Salvatore voice-shape
metrics within a reader-tolerable band AND (b) achieves
character-distinctness within a beat, WITHOUT reintroducing the
14B-LoRA corpus-leak hallucination problems?

Decomposed into six ablations on the same 20-beat pool.

## 2. Arms

All arms use DeepSeek V3.2 as the writer on the same 20-beat pool as
`arm-d-writer-upgrade-v1`. Differences are purely in prompt
construction + pipeline discipline.

| Arm | Intervention | What's added vs D0 |
|-----|--------------|--------------------|
| **D0** | Bare DeepSeek V3.2 | (baseline — already exists in eval_results for `arm-d-writer-upgrade-v1` cell `D-deepseek-v3.2`; reused) |
| **D1** | + textual style guide | System prompt prepends a ~500-word description of target voice (cadence, dialogue patterns, sensory density, clause complexity) derived from Salvatore reference corpus analysis. No direct quotes from corpus. |
| **D2** | + few-shot reference passages | System prompt includes 3–5 actual Salvatore prose excerpts (~1 KB total) as voice exemplars. Direct corpus exposure. |
| **D3** | + stronger per-character voice directives | Replaces compact-mode character snapshots with richer speaker directives (target cadence, typical sentence length, register, dialogue tags, signature phrasings). Character-distinctness-targeted. |
| **D4** | + two-stage voice transfer | D0 generates → second DeepSeek call rewrites the prose with explicit "rewrite to match [target voice description]" instruction. |
| **D5** | + metric-gated retry | D0 generates → compute voice-shape metrics (sentence length variance, dialogue density, clause complexity) → if outside target band, retry with voice-shape-enforcing prompt. Up to 2 retries per beat. |

**What each arm is testing:**
- D1 vs D0: does a description-only style guide move the needle?
- D2 vs D1: do actual corpus excerpts do better than description?
- D3 vs D0: does the character-distinctness lever work independently?
- D4 vs D0: does a dedicated rewrite pass outperform single-pass?
- D5 vs D0: does a metric-based retry loop outperform open-loop?

## 3. Falsification thresholds

Per-arm, pre-registered.

- **Voice-shape metric distance to Salvatore reference** — computed
  per beat per arm; aggregated as mean Euclidean distance across
  (avg sentence length, sentence length std, dialogue ratio, clause
  complexity, sensory word density). An arm "wins" on voice-shape if
  its mean distance is ≤ 0.6× D0's mean distance (meaningful effect
  size; arbitrary but pre-registered).
- **Adherence pass rate** — `runBeatChecks` output. An arm "wins" on
  adherence if its pass rate is ≥ D0's + 10pt OR is tied within 5pt
  with substantially better voice-shape metrics.
- **Halluc-leak-salvatore fire rate** — kill gate for D2 specifically
  (few-shot reference passages are the direct-contamination risk). If
  D2 leak rate > 2× D0's, D2 is rejected as a structural failure
  regardless of voice-shape gains.
- **Character distinctness** — per-beat Sonnet subagent audit, quote-
  required, constrained rubric ("do the speaking characters sound
  meaningfully different from each other, grounded in their speaker
  profiles?"). An arm "wins" on distinctness if its pass rate is ≥
  75% AND ≥ D0's + 15pt.

**Program-level kill:** if NO arm beats D0 on BOTH voice-shape AND
adherence, the prompt/pipeline voice-shaping thesis is falsified at
this corpus scale. The pivot stays but voice-shaping goes back to
the drawing board (possibly requiring a different base writer or a
return to weight-level fine-tuning on a bigger base).

## 4. Cheapest counterfactuals considered

| Lever | Cost | Rejected because |
|-------|------|------------------|
| Holistic pairwise (human or AI) | $0 but confound-biased | Codex meta-consult (`a738b4bb2879c39d0`) and design consult (`ae0e768d3292eb256`) both say pairwise is structurally confounded on this corpus (sensory-richness bias correlates with arm identity). Decomposed audit is the correct instrument. |
| Test on a larger pool (N=40+ beats) | +$0.05 and +30min generation | Overkill for ablation signal. Decomposed metrics are quantitative, not binomial; N=20 gives enough per-axis variance to rank arms. Scale up only if the ranking is ambiguous. |
| Additional arms (e.g., D6 combining D2+D3+D5) | +$0.02 per arm | Deferred. First learn which individual levers work; stack the winners in a follow-on charter. |
| Test against a novel OTHER than `novel-1776690840208` | generation cost × beats | Cross-novel generalization is a separate question. First establish within-novel signal. |

## 5. Distribution match

- **Pool:** same 20-beat set as `arm-d-writer-upgrade-v1`; beats
  reference `output/evals/arm-b-direct-pairwise-baseline.json`.
- **D0 baseline:** reuse existing `eval_results` rows from
  `arm-d-writer-upgrade-v1` cell `D-deepseek-v3.2`. No regeneration.
- **D1–D5:** fresh generation today. Same stored system_prompt
  structure (+arm-specific additions); same user_prompt bytes per
  beat except D3 which modifies the CHARACTERS section and D5 which
  rewrites on retry.
- **Parity:** NOT byte-equal across arms by design (arms literally
  differ in prompt content). The parity requirement is scoped to
  envelope (model, provider, temperature, maxTokens, responseFormat)
  byte-equality across all arms. Arm runner asserts this.

## 6. Success criteria + next steps

| Outcome | Interpretation | Next step |
|---------|---------------|-----------|
| One or more arms clear both voice-shape AND adherence thresholds vs D0 | Prompt/pipeline voice-shaping works on DeepSeek at this scale. | Stack winners into a v2 charter; if D3 (character distinctness) wins, ship to production. |
| Only voice-shape wins, adherence degrades | Voice-shaping works but tradeoff is real. | Charter to investigate which sub-component of each arm drives the adherence cost; decompose further. |
| Only adherence wins, voice-shape flat | Arms aren't moving the voice needle meaningfully. | Escalate: consider a larger base, or rebuild the voice-shape metric suite. |
| No arm beats D0 on either axis | Program-level kill. Prompt-level voice-shaping at DeepSeek scale is insufficient. | Open follow-on: stronger base (Sonnet/Opus/GPT-5.4) OR return to fine-tune thesis with a bigger base (~70B+). |
| D2 leaks ≥2× D0 halluc-leak-salvatore | Few-shot corpus exposure is structurally unsafe. | Kill D2; proceed with D1/D3/D4/D5 winners only. |

## 7. Budget

- **Spend cap:** $0.20 hard. Expected: 5 new arms × 20 beats × avg
  ~$0.002/call = $0.20 writer ceiling. Actual probably ~$0.08.
- **Wall-clock cap:** 2 hours. Generation ~30 min (parallel where
  possible); metric computation ~10 min; character-distinctness
  audit via Sonnet subagents ~20 min; writeup ~30 min; 30-min buffer.
- **Human-time cap:** 0 primary adjudication. 10-min spot-check on
  any beat where the aggregate metric disagrees with the distinctness
  audit or where a surprising arm wins.
- **Stop if:** writer errors >2/20 on any arm; envelope parity
  violation on any arm (not model/provider divergence which is
  expected); metric computation produces NaN or errors on ≥3 beats.

## 8. Linked context

- **Parent retrospective:** `docs/retrospectives/2026-04-21-lora-track-evidence.md`
  — the strategic context under which this is the first experiment.
- **Prior Codex consults:**
  - `acc1b47d14ce265f4` (strategic pivot consult)
  - `ae0e768d3292eb256` (decomposed-audit design recommendation)
- **Reused infrastructure:**
  - `scripts/evals/run-arm-d-upgrade.ts` — adapts to multi-arm via
    a `--arms` flag; each arm has its own system_prompt override
  - `src/phases/beat-checks.ts` — runBeatChecks for adherence
  - `src/agents/halluc-leak-salvatore/regex-leak.ts` + adapter for
    leak fire-rate
  - `src/lint/quality-detectors.ts` — repetition/underlength
- **New code required:**
  - `scripts/evals/voice-shape-metrics.ts` — computes per-beat
    metric distances to Salvatore reference. Sentence-length, dialogue
    ratio, clause complexity, sensory density.
  - `src/agents/writer/style-guide-prompts.ts` (or similar) — prompt
    fragments for arms D1, D2, D3.
  - `scripts/evals/run-voice-shaping-ablation.ts` — arm orchestration.
  - Sonnet-subagent harness for character-distinctness audit (reuses
    the existing subagent pattern).

## 9. Adversary review

One Codex pass. Revision 2 of the arm-d-writer-upgrade charter made
the pattern for "lightweight ablation post-meta-consult" explicit:
if round 1 is GREEN, proceed; YELLOW with protocol tweaks → fix and
run; RED on new structural concern → escalate.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — round 1 | — | — | (pending) |
