---
status: proposed
kind: experiment-charter
name: arm-d-writer-upgrade
owner: andre
date: 2026-04-21
revision: 3 (post-Codex-YELLOW round 1 + user design pushback — 2026-04-21)
parent-charter: docs/charters/arm-b-direct-pairwise.md (revision 2)
---

# Experiment Charter — `arm-d-writer-upgrade`

Forcing function per Codex strategic consult (job `acc1b47d14ce265f4`,
2026-04-21) for the question the arm-b context-engineering probe could
not answer: **is the Salvatore v4 voice LoRA empirically worse than a
strong untuned base model on the prose-quality pairwise instrument?**

The 2026-04-21 evidence (conditioning-floor KILL, rewrite-capability
probe falsification, quality-redraft 0-fires, arm-b pairwise weak-A
lean at 11-9) establishes that *current Salvatore-adjacent micro-levers
are failing*. It does NOT establish that the LoRA itself is
empirically worse than a capable base model. Codex was clear that
these are three distinct claims and only the first has evidence. This
charter tests the second.

Result determines whether the user's proposed pivot (retire voice-LoRA
track; pivot to API-model + checker + TBD tone methodology) is
empirically justified or premature.

## 1. Question

Does a strong non-LoRA base model (DeepSeek V3.2, the harness's current
default non-voice-LoRA writer per `src/models/roles.ts`) produce prose
on the 20-beat pairwise pool that a blind human adjudicator prefers
over the Salvatore v4 voice-LoRA's prose on the same 20 beats?

## 2. Hypothesis

**If** we regenerate the arm-b-direct-pairwise-v1 20-beat pool under
Arm D (DeepSeek V3.2 base, same stored prompts byte-equal to Arm A)
and blind-adjudicate head-to-head against the already-collected Arm A
Salvatore v4 prose, **then** Arm D will win ≥ 15 decisive pairs at
N_decisive ≥ 14 (one-tailed exact binomial p ≤ 0.021 vs fair-coin
null, ties excluded, same rubric as arm-b-direct-pairwise §7),
**because** the user's prior — based on four 2026-04-21 negative
signals on LoRA-adjacent levers — is that the LoRA is capped below
what a larger capable base can produce.

No prediction on magnitude. A CAUTION outcome (neither arm ≥ 15
decisive wins) would be the worst case: it would mean the LoRA is
roughly equivalent to a capable base, neither clearly better nor
worse, forcing the strategic question onto other axes (cost per call,
deployment flexibility, voice-recognizability, corpus specificity).

## 3. Falsification threshold

Pre-registered, mirrors arm-b-direct-pairwise §3.

- **DeepSeek wins ≥ 15 decisive pairs** → LoRA track is empirically
  capped on prose quality. The user's pivot is justified: freeze
  voice-LoRA work; move capital to capable-base + checker +
  TBD-tone-methodology architecture. Trigger the documentation
  synthesis + strategic identity reckoning per Codex consult §4.
- **Salvatore wins ≥ 15 decisive pairs** → LoRA is doing real work on
  prose quality; keep the track; redirect context-engineering and
  redraft-gate effort. The 2026-04-21 negative signals reflect the
  failure of specific levers, NOT of the track itself.
- **Middle range at N=20 → AUTO-EXPAND to N=40** (revision-3 fix for
  Codex round-1 blocker #3). arm-b-direct-pairwise-v1 returned
  CAUTION at 11-9 with 20/20 decisive pairs on the same instrument,
  confirming that N=20 is near the noise floor. This charter
  pre-commits to continuing with the remaining 20 beats from the
  40-beat manifest (`output/evals/arm-b-preflight-pool-manifest-rev9.json`)
  when N=20 returns CAUTION. Total is then N=40 primary pairs (exact
  binomial threshold: 27/40 decisive for p ≤ 0.019). "Accept
  ambiguity at N=20" is NOT an allowed endpoint for this charter —
  the strategic decision the user needs to make requires a clearer
  signal than 20 pairs can resolve at the current near-null effect
  size.
- **Retest ≥ 2/4 flips OR calibration ≥ 2/5 non-TIE** → INCONCLUSIVE,
  same rules as arm-b-direct-pairwise §3.

## 4. Baseline ladder

Two arms only. Same 20-beat pool as arm-b-direct-pairwise-v1.
**Single-variable design** — the only thing that differs between arms
is the writer (model + provider). The prompt, context, and envelope
fields are identical.

**Revision-3 design rationale (user pushback on revision 2's
two-variable "natural prompts per arm" framing):**

The question "does the LoRA do something the base doesn't" is most
fairly answered by giving both writers the exact prompt the harness
produces today on the Salvatore-routed fantasy path — because that
is the prompt shape Salvatore v4 was TRAINED on (777 beat-brief→
prose pairs from Icewind Dale Trilogy, formatted as the current
harness beat-writer compact-mode output). Evaluating the LoRA
against a base model on the LoRA's training-distribution prompt is
the product question: *on the operational prompts the harness sends
today, does the LoRA outperform a capable base?*

Revision 2 argued "give DeepSeek a different (non-compact) prompt so
it isn't handicapped." The user rejected that: DeepSeek has no
specialized prompt shape — it's a general-purpose API model. There's
no "DeepSeek-natural prompt" to compare against Salvatore-natural;
there's only "the prompt the harness sends." Designing a different
prompt specifically for DeepSeek would be solving a problem that
doesn't exist at this stage.

This design therefore deliberately rejects Codex round-1 blocker
#1's "add Arm D'" suggestion. Both arms get the SAME prompt bytes.

**Blocker #2 (adjudicator familiarity) is still fixed** — Arm A is
FRESHLY generated today rather than reused from arm-b-direct-pairwise-v1,
so the adjudicator sees unfamiliar prose on both sides and doesn't
carry over this-morning's anchoring.

| Slot | Arm | What it is |
|------|-----|------------|
| Current prod | **A: Salvatore v4 LoRA** | FRESH generation today from the 20-beat pool. Uses the byte-equal stored production prompts from `output/evals/arm-b-direct-pairwise-baseline.json` (same prompts the arm-b run used). Envelope: `model='wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4'`, `provider='wandb'`, `temperature=0.8`, `maxTokens=4000`, `responseFormat={type:'text'}`. |
| Writer upgrade | **D: DeepSeek V3.2 base** | FRESH generation today. **Same prompt bytes as Arm A** — same `system_prompt` + `user_prompt` for each beat. Envelope differs from Arm A on `model` and `provider` ONLY: `model='deepseek/deepseek-v3.2-exp'` (or whatever the harness's current non-voice-LoRA default resolves to per `src/models/roles.ts`), `provider` resolves to the DeepSeek-serving provider. All other envelope fields byte-equal. |

**Envelope verification:** per Codex round-1 warning, temperature /
maxTokens / responseFormat are already aligned at `0.8 / 4000 /
text` across both routes in `src/models/roles.ts`. Runner asserts
envelope byte-equality (except on `model`/`provider`) before the
first generation; aborts on drift.

**Acknowledged single-variable-test limitation:** the prompt is
Salvatore-specialized in the trivial sense that compact-mode
character snapshots were chosen to match Salvatore's training
distribution. If DeepSeek performs worse on this prompt than it
would on a prompt redesigned for its capabilities, that's a
product-relevant fact: the harness currently produces this prompt
shape, and a DeepSeek-as-writer decision would require either
accepting DeepSeek's performance on the current shape or rebuilding
the prompt assembler. Neither option is "unfair" — both are real
product tradeoffs. The charter's outcome is interpreted in that
frame.

## 5. Cheapest counterfactuals considered

| Lever | Cost | Rejected because |
|-------|------|------------------|
| Do nothing, accept the user's pivot instinct | $0 | Per Codex consult §1: 4 negative signals on LoRA-adjacent levers ≠ evidence that LoRA itself is capped below base. Pivoting without this test repeats the Howard methodology failure mode (retiring a weight-level solution without a named alternative). |
| Regenerate prompts in non-compact mode for Arm D (clean single-variable test) | $0.005 + prompt-rebuild work | Scoped out for v1. Only matters if decisive-verdict ambiguity needs to be resolved. Deferred to follow-on if CAUTION emerges. |
| Third arm: API-quality writer (Sonnet, Opus) | +$0.10-0.50 per 20 beats | Deferred. This charter's question is "does LoRA lose to the harness's own current non-LoRA default?" — not "what's the best writer money can buy." A three-arm ladder is the follow-on if the base-vs-LoRA answer is decisive. |

## 6. Distribution match

**Pool.** Reuse the 20-beat pool committed for
arm-b-direct-pairwise-v1 at `output/evals/pairwise/v1/mapping.json`
(pool manifest in
`output/evals/arm-b-direct-pairwise-pool.json` on LXC). 2 beats per
chapter × 10 chapters = 20 beats, stratum distribution 14 lore / 3
state / 3 none.

**Arm A reuse.** `eval_results` already has 20 Salvatore-v4
generations under `set_name='arm-b-direct-pairwise-v1'`,
`cell_label='A-baseline'`. Arm D vs those rows is a clean head-to-head
on the same beats. No Arm A regeneration needed.

**Arm D generation.** New `set_name='arm-d-writer-upgrade-v1'`. For
each of the 20 beats: load the archived baseline (from
`output/evals/arm-b-direct-pairwise-baseline.json`), send the exact
same `system_prompt` + `user_prompt` bytes to the DeepSeek V3.2
endpoint, write the result to `eval_results` with
`cell_label='D-deepseek-base'`. Parity contract: envelope differs on
`model`/`provider` ONLY; system_prompt + user_prompt byte-equal to
Arm A.

**Pairwise bundle.** Use the existing `arm-b-pairwise.ts` emitter with
a 2-argument override: generate packets where Version 1 / Version 2
are drawn from Arm A (arm-b-direct-pairwise-v1 cell `A-baseline`) and
Arm D (arm-d-writer-upgrade-v1 cell `D-deepseek-base`) for the same
beat_id. 20 primary pairs + 4 silent retests + 5 calibration = 29
packets. Same UI.

## 7. Success criteria

Identical to arm-b-direct-pairwise §7, substituting Arm D for Arm B:

| Outcome | Condition | Action |
|---------|-----------|--------|
| **INCONCLUSIVE** | Retest flips ≥ 2/4 OR calibration fails ≥ 2/5 | Same remediation as arm-b §3. |
| **CAUTION (underpowered)** | < 14 decisive pairs across the 20 primary packets | Expand to N=40 or accept ambiguity; decision shifts to non-prose axes. |
| **GO-PIVOT** | DeepSeek wins ≥ 15 decisive pairs at N_decisive ≥ 14 | LoRA track empirically capped on prose quality. Freeze Salvatore-LoRA work; synthesize 2026-04-21 retrospective into decisions.md; begin "harness around API base" architecture design. |
| **NO-GO-PIVOT (LoRA defended)** | Salvatore wins ≥ 15 decisive pairs | LoRA doing real work. Keep the track; redirect current LoRA-adjacent lever effort to next-best candidate (corpus expansion? different fine-tune family? Salvatore v5 per the deferred charter?). |
| **CAUTION (middle range)** | Decisive ≥ 14 but neither arm clears 15 | Neither direction justified. Strategic decision falls to non-prose axes (cost per call, offline-capability, voice-recognizability). |

**1-2 sentence notes required per primary pair** (same rule as arm-b
§7, preserves auditability without atomizing into a checklist — exp
#90 lesson).

## 8. Budget

- **Spend cap:** $0.10 hard. Expected: 20 DeepSeek V3.2 writer calls
  at typical Salvatore-beat prompt sizes ≈ $0.01-0.03 writer spend.
  Detector calls reuse Arm A's fire labels as secondary telemetry
  (no new detector cost).
- **Wall-clock cap:** 3 hours from GREEN to verdict. Generation ~15
  min; adjudication ~45 min; writeup ~30 min; 75-min buffer for doc
  synthesis.
- **Human-time cap:** 60 min for adjudication (29 packets at ~2 min
  each).
- **Stop if:** writer errors on Arm D on >2 of 20 beats (infrastructure
  problem, not a product signal); parity violation on any prompt byte
  other than model/provider fields (experiment contamination).

## 9. Linked context

- **Parent:** `docs/charters/arm-b-direct-pairwise.md` (revision 2) —
  reuses infrastructure + 20-beat pool + adjudication UI.
- **Codex strategic consult:** job `acc1b47d14ce265f4`, 2026-04-21 —
  the formal recommendation to run this test before any track-switch
  decision.
- **Arm A prose already in DB:** `eval_results` with
  `set_name='arm-b-direct-pairwise-v1'`, `cell_label='A-baseline'`.
  Reused without regeneration.
- **Reused infrastructure (already committed):**
  - `scripts/evals/run-arm-b-preflight.ts` — generation runner
  - `src/agents/writer/enriched-context.ts` — NOT used (Arm D uses
    byte-replay only, no enrichment)
  - `scripts/evals/preflight-arm-b-parity.ts` — parity check
    (`checkArmBStructure` generalizes to any two-arm byte-replay
    comparison; needs a flag to accept model/provider divergence in
    the envelope whitelist)
  - `scripts/evals/arm-b-pairwise.ts` — emit + ingest (needs a flag
    to compare two set_names cross-bundle instead of two cell_labels
    within one set_name)
- **New code required:**
  - `scripts/evals/run-arm-d-upgrade.ts` (or a `--writer <provider:model>`
    override on `run-arm-b-preflight.ts`) — generates Arm D prose
    using the envelope override.
  - Minor extension to `arm-b-pairwise.ts --emit` to accept two
    `--set-name` flags (Arm A set vs Arm D set) instead of grouping
    by `cell_label` within one set.
- **`tuning_experiment` ID:** will be created at GREEN, type
  `checker_eval`, description citing this charter.

## 10. Adversary review

Scope discipline: ONE Codex pass. This charter is a direct descendant
of arm-b-direct-pairwise and reuses 95% of its machinery — the novel
part is the envelope-swap + two-set pairwise emission. Like the
parent charter, YELLOW with protocol tweaks → fix and proceed. RED on
newly-discovered structural concern → escalate.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — round 1 | YELLOW | 2026-04-21 | Job `a3f55e32b1ed11772`. Three blockers: (1) bundled-lever on prompt shape — proposed adding Arm D' with non-compact prompt; (2) adjudicator familiarity with reused Arm A prose from arm-b; (3) "accept ambiguity at N=20" allowed by §7 despite arm-b already hitting CAUTION at that N. Resolved in revision 3: **(1) REJECTED per user design pushback** — DeepSeek has no specialized prompt shape, so "same prompt to both" IS the fair product comparison on the harness's operational prompt the LoRA was trained on; (2) FIXED via fresh Arm A regeneration today (no arm-b-reuse); (3) FIXED via pre-committed N=40 auto-expand on CAUTION. No round 2 per §10 "fix and proceed" discipline since (1) is a design-intuition choice, not a protocol gap. |
| `/codex:adversarial-review` (GPT) — round 2 | N/A per §10 | 2026-04-21 | Skipped intentionally. User's pivot direction ("native API usage + proper context + other techniques") is the forward-looking context; Arm D is the forcing function before that direction is committed. Review tower is not the bottleneck. |
