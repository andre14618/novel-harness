---
status: proposed
kind: experiment-charter
name: arm-d-writer-upgrade
owner: andre
date: 2026-04-21
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
- **Middle range / CAUTION** → measurement is underpowered or the two
  arms are close enough that the pairwise instrument can't
  distinguish them at N=20. Expand to N=40 or accept ambiguity and
  let other axes (cost, deployment, voice-specificity) decide.
- **Retest ≥ 2/4 flips OR calibration ≥ 2/5 non-TIE** → INCONCLUSIVE,
  same rules as arm-b-direct-pairwise §3.

## 4. Baseline ladder

Two arms only. Same 20-beat pool as arm-b-direct-pairwise-v1.

| Slot | Arm | What it is |
|------|-----|------------|
| Current prod | **A: Salvatore v4 LoRA** | Already generated in `eval_results` for `set_name='arm-b-direct-pairwise-v1'`. Cell label `A-baseline`. Byte-replay of stored production prompts. |
| Writer upgrade | **D: DeepSeek V3.2 base** | Fresh generation: same stored system_prompt + user_prompt bytes sent to `deepseek/deepseek-chat` (or whatever the harness's current non-voice-LoRA default is — see `src/models/roles.ts` `WRITER_GENRE_PACKS` fallback). Envelope differs from Arm A on `model` and `provider` ONLY. |

**Bundled-lever acknowledgment (§11.5 of `experiment-design-rules.md`):**
The stored prompt is Salvatore-optimized (compact-mode per-character
directives built for the voice LoRA's training distribution). Sending
the same prompt to DeepSeek is asking a base model to perform on a
prompt shape it wasn't specialized for. This is a DELIBERATE bundled
test — the real product question is "what does the harness produce if
we swap the writer without redesigning the prompt." A cleaner
single-variable test would require regenerating prompts in non-compact
mode for DeepSeek; that's scoped out as a follow-on only if Arm D
produces a CAUTION verdict and the ambiguity matters. Under a decisive
verdict either direction, the prompt-shape confound is not the
explanation.

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
| `/codex:adversarial-review` (GPT) — primary | — | — | (pending) |
