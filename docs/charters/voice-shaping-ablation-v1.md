---
status: proposed
kind: experiment-charter
name: voice-shaping-ablation-v1
owner: andre
date: 2026-04-21
revision: 2 (post-Codex-YELLOW round 1 — 2026-04-21)
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

**Primary:** Do prompt-level voice-shaping interventions on DeepSeek
V3.2 (textual style guide, few-shot reference passages, per-character
speaker directives) measurably improve voice-shape alignment and
character-distinctness over bare DeepSeek **while remaining
competitive with the production Salvatore v4 LoRA** on the same
beats?

**Secondary:** Does any individual arm introduce a structural failure
(halluc-leak corpus contamination, adherence degradation, loops,
underlength) that would disqualify it regardless of voice-shape gains?

**Hypothesis (primary, template-compliant per `experiment-charter-template.md`
§2):**

**If** we regenerate 20 beats from `novel-1776690840208` under three
prompt-only DeepSeek intervention arms (D1 style guide, D2 few-shot
reference, D3 per-character directives) and measure voice-shape,
adherence, and character-distinctness via decomposed audit, **then**
at least one intervention arm will achieve voice-shape feature
distance to Salvatore reference ≤ 75% of bare DeepSeek (D0)'s
distance on 3 of 5 per-feature metrics, AND character-distinctness
pass rate ≥ D0 + 10pt, **because** prompt-level style conditioning
on a ~685B-MoE base is a fundamentally different regime than the
Howard primer's 14B-base failure (2026-04-16), and in-context
learning at DeepSeek scale can plausibly move prose-surface features
without the leak / V1-anchor failure modes that compounded with
narrow corpus at 14B.

**Scoped OUT of v1** (per Codex round-1 blocker #2 — bundled levers):
- D4 (two-stage voice transfer) and D5 (metric-gated retry loop)
  defer to `voice-shaping-ablation-v2`. They mix independent effects
  (D4 = generate + rewrite; D5 = gate + retry + extra samples) and
  need isolated controls (D4' rewrite-only-on-fixed-prose; D5'
  open-loop best-of-N random-retry) to be interpretable. The charter
  v2 will ladder them after v1 establishes which prompt-only levers
  actually move the signal.

## 2. Arms

Four DeepSeek arms (single-variable prompt interventions) + one
production-anchor arm (Salvatore v4 LoRA, per Codex round-1 blocker
#1 fix — anchor comparator required). Same 20-beat pool as
`arm-d-writer-upgrade-v1`.

| Arm | Writer | Intervention | Source |
|-----|--------|--------------|--------|
| **S (anchor)** | Salvatore v4 LoRA | current production compact-mode + voice-LoRA system prompt | REUSE `eval_results` cell `A-salvatore-v4` from `arm-d-writer-upgrade-v1`. No regeneration. |
| **D0** | DeepSeek V3.2 | bare — no voice shaping | FRESH regeneration today (per Codex round-1 warning on baseline-variance estimation). Does NOT reuse the Arm D rows from `arm-d-writer-upgrade-v1` — a same-run D0 eliminates timestamp/sampling-noise confounds vs D1/D2/D3. |
| **D1** | DeepSeek V3.2 | + textual style guide | System prompt prepends a ~500-word description of target voice (cadence, dialogue patterns, sensory density, clause complexity) derived from Salvatore reference corpus analysis. **No direct corpus quotes.** |
| **D2** | DeepSeek V3.2 | + few-shot reference passages | System prompt includes 3–5 actual Salvatore prose excerpts (~1 KB total) as voice exemplars. Direct corpus exposure — the arm where the halluc-leak kill gate is load-bearing. |
| **D3** | DeepSeek V3.2 | + stronger per-character voice directives | Replaces compact-mode character snapshots with richer speaker directives (target cadence, typical sentence length, register, dialogue tags, signature phrasings). Character-distinctness-targeted. |

**What each arm is testing (ablation structure per `experiment-design-rules.md` §11.5 — single-variable isolation):**
- S (anchor): what the harness currently ships to production; ground truth for "is voice-shape alignment achievable at all without weight-level training?"
- D1 vs D0: does a description-only style guide move the needle? (isolated: one prompt-field addition)
- D2 vs D1: do actual corpus excerpts outperform description alone? (isolated: corpus content only)
- D3 vs D0: does the per-character directives lever work independently? (isolated: CHARACTERS section swap)
- D1 vs S, D2 vs S, D3 vs S: do any prompt-only interventions close the gap to the production LoRA on voice-shape metrics?

## 3. Falsification thresholds

Per-arm, pre-registered. Per Codex round-1 blocker #3, oracle is
per-feature with word-count-residualized scoring — NOT mixed-scale
Euclidean (which the biggest-variance feature would dominate).

**Voice-shape features** (five axes, computed per beat per arm):

1. Mean sentence length (words)
2. Sentence-length standard deviation (captures rhythm variation)
3. Dialogue ratio (chars-in-quotes / total chars)
4. Mean clause complexity (commas + semicolons per sentence)
5. Sensory-density proxy (matches against a frozen 120-term sensory
   vocabulary vs total words)

**Reference set:** 10 randomly-sampled Salvatore corpus passages
matched to the pool's beat kind distribution, committed to
`scripts/evals/voice-shape-reference.json` before generation. Frozen.

**Per-feature metric:** `abs(arm_mean - ref_mean) / ref_std` —
standardized distance in ref-feature units. An arm "improves" on a
feature if its standardized distance is ≤ 0.75× D0's on that feature.

**Word-count residualization** (per Codex round-1 blocker #3 +
Axis 6 confound): the analysis pre-registers a sanity check — for
each arm, fit a linear regression of winner-attribution vs word-count
delta across beats. If word-count delta explains > 50% of between-arm
variance on any oracle axis, the arm-signal is flagged as
length-confounded and the verdict on that axis is downgraded from
"arm effect" to "length proxy."

**Per-arm thresholds (pre-registered):**

| Axis | Threshold to count as "arm win" | Notes |
|------|--------------------------------|-------|
| Voice-shape | Arm improves on ≥ 3 of 5 features vs D0 (standardized distance to Salvatore ref) AND no feature regresses by > 0.25× D0 | Conjunctive across features; length-confound downgrade applies |
| Adherence pass rate | Arm rate ≥ D0 rate − 5pt (i.e., not allowed to significantly degrade) AND ≥ 70% absolute | Voice wins can't justify adherence collapse |
| Halluc-leak-salvatore fire rate (D2 kill gate) | D2 leak rate ≤ D0 rate + 10pt absolute | Per Codex round-1 warning on thin-N gates, absolute-rate bound is more defensible than "≥ 2× D0" at 20 beats |
| Character distinctness | Arm rate ≥ 75% absolute AND ≥ D0 rate + 10pt | Pre-registered |

**Character-distinctness audit rubric** (explicit, committed text per
Codex round-1 blocker #3):

> For each beat, given two or more speaking characters, decide: do
> the characters sound meaningfully different from each other — in
> diction, cadence, register, or signature phrasing — GROUNDED IN
> their speaker profiles?
>
> **Mandatory grounding:** quote one line from each speaking
> character, cite the specific speaker-profile attribute (voice,
> drives, avoids, conflict) the line reflects, and decide.
>
> **Do NOT reward** length, sensory richness, prose polish, dialogue
> tag variety, or "evocative" language. These are not distinctness.
> A distinctness win means "the reader could tell who's speaking
> without the tag"; a distinctness loss means "the characters all
> sound like the same person."
>
> **Label:** PASS / FAIL / UNCLEAR (with quote-required justification).

**Program-level kill:** if NO D-arm clears both voice-shape AND
adherence vs D0, the prompt-only voice-shaping thesis is falsified
at this corpus scale + this base model size. The pivot stays but
voice-shaping moves to v2 levers (two-stage rewrite, metric-gate
retry) or to a larger base writer.

**Anchor-informed interpretation:** separately report each D-arm's
scores vs Salvatore v4 (S). If no D-arm closes the voice-shape
gap to S within the threshold, that's a material finding even if
D-arms beat D0 — it says prompt-only shaping is partial, not
complete.

## 4. Cheapest counterfactuals considered

| Lever | Cost | Rejected because |
|-------|------|------------------|
| Holistic pairwise (human or AI) | $0 but confound-biased | Codex meta-consult (`a738b4bb2879c39d0`) and design consult (`ae0e768d3292eb256`) both say pairwise is structurally confounded on this corpus (sensory-richness bias correlates with arm identity). Decomposed audit is the correct instrument. |
| Test on a larger pool (N=40+ beats) | +$0.05 and +30min generation | Overkill for ablation signal. Decomposed metrics are quantitative, not binomial; N=20 gives enough per-axis variance to rank arms. Scale up only if the ranking is ambiguous. |
| Additional arms (e.g., D6 combining D2+D3+D5) | +$0.02 per arm | Deferred. First learn which individual levers work; stack the winners in a follow-on charter. |
| Test against a novel OTHER than `novel-1776690840208` | generation cost × beats | Cross-novel generalization is a separate question. First establish within-novel signal. |

## 5. Distribution match + parity harness

- **Pool:** same 20-beat set as `arm-d-writer-upgrade-v1`; beats
  referenced by `output/evals/arm-b-direct-pairwise-baseline.json`.
- **S (Salvatore v4 anchor):** REUSE `eval_results` rows from
  `arm-d-writer-upgrade-v1` cell `A-salvatore-v4`. Fresh regen from
  this morning; temporal parity with D0/D1/D2/D3 is acceptable per
  `experiment-design-rules.md §9.4` fixed-eval reuse rule.
- **D0, D1, D2, D3:** fresh generation today. Each arm's prompt
  construction is per §2.

**Parity harness (per Codex round-1 blocker #4 + `experiment-design-rules.md` §4.7):**

- **Script:** extend `scripts/evals/preflight-arm-b-parity.ts` with
  a new mode for arm-label-aware multi-arm validation, or write a
  fresh `scripts/evals/voice-shaping-parity.ts`. Contract: structured-
  segment diff per charter §6 of arm-b-preflight revision 6; per-arm
  delta-span whitelist below.
- **Anchor Arm S contract:** envelope + prompt bytes are what's
  already persisted in `llm_calls.system_prompt` + `user_prompt`
  from the arm-d run on the same beats. No regeneration; no parity
  check needed (reused data is already the ground truth).
- **Arm D0 contract:** same user_prompt bytes as S (byte-equal
  compact-mode beat-writer prompt). Envelope differs on
  `model='deepseek-chat'` + `provider='deepseek'` ONLY; all other
  envelope fields (`temperature=0.8`, `maxTokens=4000`, `responseFormat`)
  byte-equal to S. Parity harness asserts this pre-run against the
  real `llm_calls` row for S; aborts on unexpected envelope drift.
- **Arm D1 contract:** same user_prompt as D0 (same beat context).
  Allowed delta: system_prompt replaced — a `VOICE STYLE GUIDE:`
  section is injected as a distinct named block; the rest of the
  system_prompt byte-equal to S/D0's system_prompt. Harness verifies
  single-named-block insertion, aborts on any other system_prompt
  delta.
- **Arm D2 contract:** same as D1 plus a second named block
  `VOICE REFERENCE PASSAGES:` containing exactly 3–5 labeled Salvatore
  excerpts. Harness verifies two-named-block insertion, no unlabeled
  delta.
- **Arm D3 contract:** user_prompt CHARACTERS section (position 3
  per `beat-context.ts:193`) replaced with a named `CHARACTER VOICE
  DIRECTIVES:` block. All other user_prompt sections byte-equal to
  D0. Envelope byte-equal to D0. Harness diffs `sections[]` pre-join,
  asserts only the CHARACTERS section position differs.

**Archival:** parity check runs against the first 3 beats of each
arm BEFORE the full run proceeds; aborts on any unexpected delta.
Manifest of recovered sections + envelope per arm written to
`output/evals/voice-shaping-parity-manifest.json` for the results
memo.

**Arm D1/D2/D3 system_prompt fragments** committed to
`src/agents/writer/voice-shaping-prompts.ts` (new file) so the
prompt content is version-controlled and re-executable.

## 6. Success criteria + next steps

Outcomes are reported on TWO dimensions: (a) D-arms vs D0 (does
prompt shaping move the needle at all?) and (b) D-arms vs S
(production Salvatore v4 anchor — do prompt-only interventions close
the gap to the weight-level voice LoRA?).

| Outcome | Interpretation | Next step |
|---------|---------------|-----------|
| **SHIP candidate** — one or more D-arms clear voice-shape + adherence + distinctness thresholds vs D0 AND match or beat S on at least voice-shape OR distinctness | Prompt-level voice-shaping at DeepSeek scale works competitively with the LoRA anchor. | Re-charter v2: stack winners, add D4 (two-stage rewrite, isolated controls), D5 (metric-gate retry, isolated controls). Consider routing the winning arm to production as a new `WRITER_GENRE_PACKS` entry for fantasy route. |
| **MOVES NEEDLE, NOT TO ANCHOR** — D-arms beat D0 on voice-shape/distinctness but S is still materially better on ≥2 axes | Prompt shaping helps; not enough to replace the LoRA. | Keep Salvatore v4 in production; continue v2 explorations on the margin. Do not reassign production routing. |
| **FLAT vs D0** — no D-arm clears thresholds vs D0 | Prompt-only voice shaping at DeepSeek scale is insufficient. | Program-level kill for v1 direction. Open follow-on: v2 two-stage / metric-retry levers (isolated), or stronger base (Sonnet/Opus/GPT-5.4), or return to weight-level fine-tuning on ≥70B base. |
| **ADHERENCE COLLAPSE** — D-arm wins voice-shape but adherence falls below 70% or > 5pt below D0 | Voice-shaping is trading discipline for surface. | Reject the arm; decompose further (e.g., is it the style guide inflating prose? does truncating the guide help?). |
| **D2 LEAK GATE FIRES** — D2 leak rate > D0 + 10pt absolute | Few-shot corpus exposure is structurally unsafe. | Reject D2; proceed with D1/D3 only. |
| **LENGTH-CONFOUND DOWNGRADE** — any arm's voice-shape win explained >50% by word-count delta per §3 residualization | The signal is length, not voice. | Report as null on that axis; examine whether the arm just inflates prose. |

**What SHIP means operationally (per Codex round-1 blocker #1 —
anchor discipline):** SHIP does not imply retiring Salvatore v4. It
means "add this DeepSeek-shaped route to production routing as an
A/B candidate" — the production swap is a separate product decision
that factors in cost/latency/offline-capability, not just voice
metrics.

## 7. Budget

- **Spend cap:** $0.15 hard (reduced from $0.20 in revision 1 after
  dropping D4/D5 per Codex blocker #2). Expected: 4 new DeepSeek
  generations (D0, D1, D2, D3) × 20 beats × avg ~$0.002/call = $0.16
  ceiling. S (Salvatore anchor) reuses arm-d data, no regen cost.
  Actual probably ~$0.06.
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
| `/codex:adversarial-review` (GPT) — round 1 | YELLOW | 2026-04-21 | Job `ae1efdddbe1fe960c`. Four blockers, all addressed in revision 2 per §9 "fix and proceed" discipline: (1) template-compliant hypothesis added + primary/secondary question split + Salvatore v4 anchor added as arm `S`; (2) D4/D5 deferred to v2 (bundled levers require isolation controls — noted in §1); (3) per-feature standardized thresholds with conjunctive "improve on ≥3 of 5 features" rule, explicit word-count residualization sanity check, distinctness rubric now fully committed with mandatory quote grounding + explicit "do NOT reward length/sensory richness" exclusion; (4) parity harness named (`scripts/evals/voice-shaping-parity.ts` to create, extending structured-segment diff from preflight charter) with per-arm delta-span whitelist. Named counterfactual (slim pilot D0+D1+D3) partially adopted — D2 retained for halluc-leak-kill-gate evidence on the single-clearest-risk arm. No round 2 per §9 discipline. |
