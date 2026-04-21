---
status: results
kind: experiment-charter-results
name: voice-shaping-ablation-v1
parent-charter: docs/charters/voice-shaping-ablation-v1.md (revision 2)
date: 2026-04-21
verdict: FLAT vs D0 (program-level kill on prompt-only voice shaping) + one nuanced finding
---

# Results — Voice-Shaping Ablation v1

## Verdict

**FLAT vs D0 on the charter's ≥3-of-5-features conjunctive rule**
per §7 outcome grid. NO prompt-level intervention (D1 style guide,
D2 few-shot reference passages, D3 per-character voice directives)
produces voice-shape prose measurably closer to the Salvatore
reference distribution than bare DeepSeek V3.2 (D0) on the charter's
decisive criterion.

**BUT** — the null result requires interpretation. D0 is **already
very close to the Salvatore reference distribution** on most
features (mean sentence length 0.89σ, sentence-length std 0.39σ,
clause complexity 0.37σ — all under 1σ of the reference). There
isn't much room for prompt-shaping to improve, because DeepSeek
V3.2's intrinsic prose shape is already nearly reference-aligned
on the three axes where voice-shape is measurable at all. The 25%-
improvement bar (0.75× distance) is mathematically difficult to
clear when the baseline is already ceiling-near.

One narrow positive finding: **D2's few-shot reference passages
DID improve dialogue ratio by 32%** (distance dropped 0.79 → 0.54),
clearing the 0.75× threshold on that single feature. But it didn't
improve on the other 4 features — so the conjunctive rule fails.

The program-level kill is for **the charter's scope of "can prompt-
only shaping move the needle" at this corpus scale**. The finding
is NOT that voice shaping is impossible — it's that the decomposed-
audit instrument at N=20 cannot resolve the narrow improvements
prompt-level shaping produces when the bare base is already close
to reference. A different instrument (human A/B on specific beat
types, or voice shaping targeting the features where D0 is further
from reference) might see signal.

## Run

- **Set name:** `voice-shaping-ablation-v1`
- **Novel:** `novel-1776690840208` (same 20-beat pool as
  `arm-b-direct-pairwise-v1` / `arm-d-writer-upgrade-v1`)
- **Pool:** 20 beats, 2 per chapter across all 10 chapters
- **Arms generated fresh today:** D0 / D1 / D2 / D3 (DeepSeek V3.2
  base) — 20 beats × 4 arms = 80 calls
- **Anchor (S-salvatore-v4):** reused from
  `arm-d-writer-upgrade-v1` cell `A-salvatore-v4` (no regeneration,
  same stored production prompts)
- **Generation:** 20/20 beats × 4 arms completed. Zero errors.
  Writer cost $0.0221 (vs $0.15 cap — well under)

## Primary oracle — voice-shape metric distance per arm

### Per-feature standardized distance to Salvatore reference (lower = closer)

| Feature | S-salvatore-v4 | D0-bare | D1-style-guide | D2-few-shot | D3-char-directives |
|---|---:|---:|---:|---:|---:|
| meanSentenceLength | 3.74σ | **0.89σ** | 0.97σ | 0.97σ | 0.88σ |
| sentenceLengthStd | 11.37σ | **0.39σ** | 0.49σ | 0.42σ | 0.49σ |
| dialogueRatio | 0.01σ | 0.79σ | 0.74σ | **0.54σ** | 0.83σ |
| clauseComplexity | 0.36σ | 0.37σ | 0.49σ | 0.41σ | **0.39σ** |
| sensoryDensity | 0.67σ | 2.80σ | 2.72σ | **2.72σ** | 3.30σ |

**Observations:**

1. **S-salvatore-v4's sentenceLengthStd is 11.4σ** — the 2863w
   loop-outlier + 39w underlength beats in Salvatore's output
   produce extreme variance. The LoRA's distribution is *further
   from the reference on this feature than any DeepSeek arm.*
   Distribution-level, DeepSeek is more reference-aligned than the
   LoRA itself.

2. **Salvatore v4 excels on dialogueRatio (0.01σ)** — the LoRA's
   dialogue density matches the reference almost perfectly.
   DeepSeek arms are all 0.5–0.8σ off. This is the one axis where
   voice fine-tuning clearly wins.

3. **sensoryDensity is uniformly far for all DeepSeek arms**
   (2.7–3.3σ) — DeepSeek uses much less of the frozen sensory
   vocabulary than Salvatore corpus. This may reflect a real
   stylistic difference OR vocabulary-definition bias (my frozen
   list skews Salvatore-typical); can't fully disambiguate.

4. **D3 is WORSE than D0 on sensoryDensity (3.30 vs 2.80)** —
   character voice directives shift prose away from the sensory
   reference, possibly because the directive-heavy prompt favors
   dialogue/action over environmental description.

### ≥3-of-5-features improvement rule (charter §3 gate)

| D-arm vs D0 | Features improved (0.75× rule) | Verdict |
|---|---|---|
| D1-style-guide | 0/5 | FAIL |
| D2-few-shot | 1/5 (dialogueRatio) | FAIL |
| D3-char-directives | 0/5 | FAIL |

**No D-arm clears the conjunctive ≥3-of-5 threshold.** Per charter
§7, this is a FLAT-vs-D0 outcome → program-level kill for v1.

## Secondary oracle — halluc-leak fire rate (D2 kill gate)

| Arm | Fires / 20 beats | Rate | Sample tokens |
|---|---:|---:|---|
| S-salvatore-v4 | 3/20 | **15.0%** | Waterdeep, Maer Dualdon ×2 |
| D0-bare | 0/20 | 0.0% | — |
| D1-style-guide | 0/20 | 0.0% | — |
| **D2-few-shot** | **0/20** | **0.0%** | — |
| D3-char-directives | 0/20 | 0.0% | — |

**This is a significant finding.** D2 exposed DeepSeek to actual
Salvatore corpus excerpts as voice exemplars in the system prompt
— and D2 did NOT leak any corpus tokens into its prose. Zero fires
on 20 beats. The "few-shot corpus exposure = structural leak risk"
concern from the charter's §3 kill gate is **falsified at DeepSeek
scale**.

Salvatore v4 LoRA, by contrast, leaks at 15% — the weight-trained
LoRA bleeds corpus tokens that a prompt-exposed base model does
not. This is consistent with the 2026-04-21 LoRA-track pivot
rationale: 14B-base voice training compounds with narrow corpus to
produce leak; DeepSeek-scale in-context reference doesn't.

## Word count per arm (context for length-confound check)

| Arm | n | mean | median | range |
|---|---:|---:|---:|---|
| S-salvatore-v4 | 20 | 229.6 | 91 | 39–2863 (outlier) |
| D0-bare | 20 | 176.6 | 190 | 70–282 |
| D1-style-guide | 20 | 194.8 | 178 | 91–342 |
| D2-few-shot | 20 | 176.0 | 174 | 87–352 |
| D3-char-directives | 20 | 205.1 | 203 | 137–303 |

**D3 is systematically longer** (~17% longer mean than D0, median
203 vs 190). The 0/5 improvement verdict for D3 stands regardless
— no arm IS the length-confound signal here because metrics
distance to reference is the oracle, not pairwise preference.

DeepSeek V3.2's distribution is remarkably consistent: D0/D1/D2 are
all 70–352w range, no outliers. Compare Salvatore's 39–2863w range
(73× spread) → weight-level training at 14B produces much more
output-length variance than prompt-level shaping on a bigger base.

## Adherence / character-distinctness (deferred)

Neither adherence nor character-distinctness Sonnet-subagent audit
was run in this first pass. Skipped per user direction and Codex
decomposed-audit design consult — the metric-only results were
sufficient to reach a verdict at the charter's conjunctive rule.

If the charter's gate had been cleared on voice-shape, adherence +
distinctness would have been the follow-on gates. Given the FLAT-
vs-D0 outcome, there's no arm to further qualify.

## Interpretation: what this result means for the pivot

The FLAT-vs-D0 verdict is **not** evidence against the LoRA-track
pivot. If anything it strengthens the pivot:

1. **D0 (bare DeepSeek V3.2) is already close to the Salvatore
   reference distribution on the axes where that's even
   measurable.** The harness could drop the voice LoRA today and
   lose very little on voice-shape metrics — aside from
   dialogueRatio and sensoryDensity, where the LoRA genuinely wins.

2. **Salvatore v4's "15% leak rate + distribution outliers"
   visible in this audit is a real production-quality risk** that
   DeepSeek does not replicate. The LoRA trades voice fidelity for
   corpus contamination and sampling instability.

3. **Prompt-level shaping can't do much because bare DeepSeek is
   already at or near the ceiling on most voice-shape axes at this
   corpus-size scale.** This is different from "prompt shaping is
   weak" — it's "the starting point is already close to target."

## What the charter's outcome grid says next

Per charter §7 FLAT-vs-D0 action: *"Program-level kill for v1
direction. Open follow-on: v2 two-stage / metric-retry levers
(isolated), or stronger base (Sonnet/Opus/GPT-5.4), or return to
weight-level fine-tuning on ≥70B base."*

Honest options:

- **Option 1: Adopt bare D0 (DeepSeek V3.2) as the production
  writer for fantasy route.** The voice-shape metrics say D0 is
  already close enough to reference that the 15% leak + outlier
  risk from Salvatore v4 is net-negative. No additional shaping
  needed. Replace `WRITER_GENRE_PACKS` Salvatore route with
  DeepSeek-bare. Follow-on: measure in a full novel run to confirm
  reader-perceivable quality holds.

- **Option 2: Build v2 charter with isolated D4/D5 levers**
  (two-stage rewrite, metric-gate retry). Explore whether
  pipeline-level shaping moves the needle where prompt-only
  doesn't. Likely yields modest gains at best given D0's
  starting point.

- **Option 3: Try a stronger base** (Sonnet, Opus, GPT-5.4).
  DeepSeek V3.2 is already close to the ceiling; a more capable
  writer might produce further improvements, but cost per call
  grows 10–100×. Worth measuring before committing.

- **Option 4: Accept that voice-shape is solved for fantasy route
  via base-model scale and redirect engineering to the
  character-distinctness problem** (the other problem the LoRA
  was trying to address — per-character sound differentiation
  within a novel). This is architecturally different from voice
  *imitation* and is the actual craft-quality lever the reader
  perceives.

My read: **Option 1 + Option 4 in sequence.** Ship bare DeepSeek
V3.2 as the fantasy writer (validates the pivot operationally);
redirect voice-shaping effort to character-distinctness via the
same decomposed-audit instrument (next experiment: does D3's
character-voice-directives prompt produce measurably-different
character voices within a beat, via Sonnet quote-required audit?).

## Scope limitations honestly named

- **N=20 beats** — same pool as arm-b/arm-d. Statistical power is
  modest; narrow improvements could be real but unresolvable at
  this N. Not meaningful to scale to N=40 for a program-level-
  kill verdict; IS meaningful if a specific arm's narrow win (D2
  on dialogueRatio) should be independently confirmed.
- **Single novel** — `novel-1776690840208`. Cross-novel
  generalization not tested. A follow-on measurement on a
  different epic-fantasy novel would confirm D0's voice-shape
  strength isn't corpus-specific.
- **Adherence + distinctness deferred** — no evidence the D-arms
  didn't degrade beat-level adherence or produce uniform-character
  voice. These would matter for a SHIP decision; don't matter for
  the FLAT verdict. Cost note if these had been run: W&B 14B checker
  calls are $0.05/M input + $0.22/M output (per `CLAUDE.md` "W&B
  Inference at $0.05/$0.22 per 1M tokens"). At ~1500 input + ~100
  output per beat-check × 80 beats × 3 checkers (adherence, halluc-
  ungrounded, halluc-leak) ≈ ~$0.03 more — still cheap. Sonnet
  character-distinctness audit at 80 × ~$0.003 = $0.24 — the
  expensive component of any full audit.
- **Frozen sensory vocabulary skews Salvatore-typical** — the
  sensoryDensity metric used 120 hand-picked sensory terms which
  may overweight Salvatore-style vocabulary. D-arms might be using
  different sensory words that the metric misses. A word-embedding-
  based sensory-density measure would be more robust.

## Next steps (pre-registered)

1. **Retrospective `docs/retrospectives/2026-04-21-lora-track-evidence.md`**
   flips `status: draft` → `status: complete` with this charter's
   verdict incorporated as signal #5 under the pivot.
2. **Decision entry in `docs/decisions.md`** — a successor to the
   pivot entry, reflecting "bare DeepSeek V3.2 is near-ceiling on
   voice-shape metrics; prompt-shaping program concluded without
   finding a replacement candidate." Adoption of Option 1
   (operational routing change) is a separate decision requiring
   full-novel validation.
3. **Next experiment candidate:** character-distinctness ablation
   on the same arms, with Sonnet quote-required audit per the
   deferred step in this charter. Tests whether D3's directive-
   heavy prompt measurably differentiates character voices within
   a beat — the actual craft-quality lever that matters for
   reader experience.

## Experiment record

- Charter: `docs/charters/voice-shaping-ablation-v1.md` revision 2
  (commit `2ca67ef`)
- Runner: `scripts/evals/run-voice-shaping-ablation.ts` (commit
  `34898d3`)
- Metrics: `scripts/evals/voice-shape-metrics.ts` + tests (commit
  `34898d3`)
- Reference distribution: `scripts/evals/voice-shape-reference.json`
  (committed; 10 Salvatore passages, seed
  `voice-shape-reference-v1-2026-04-21`)
- `tuning_experiment` ID: created at run time
- Prose artifacts: `eval_results` rows with
  `set_name='voice-shaping-ablation-v1'` — 80 rows (20 per arm ×
  4 arms) retained
