---
title: User-Adjusted Backlog — Scene-Level Plan/Write Lane
date: 2026-05-10
status: operational plan; supersedes opus-next-experiment-backlog.md on disputed points
inputs:
  - docs/research/opus-harness-autopsy.md
  - docs/research/opus-craft-market-synthesis.md
  - docs/research/opus-method-pack-candidates.md
  - docs/research/opus-semantic-judge-plan.md
  - docs/research/opus-overbuild-critique.md
  - docs/research/opus-layer-bottleneck.md
  - docs/research/opus-next-experiment-backlog.md
---

# User-Adjusted Backlog — Scene-Level Plan/Write Lane

This is the operator's verdict on the seven Opus deep-dive artifacts produced
2026-05-10. It accepts the synthesis on direction and posture, and corrects it
on five execution points before the lane opens.

## Adopted from the Opus synthesis

- **Bottleneck framing.** The active lane focuses on scene-level plan/write
  behavior. Evidence: beat counts were calibrated, prose still expanded to
  1.89× and 3.03× target on `novel-1778411555121`. The writer is choosing
  scene boundaries because nothing else is.
- **Anti-sprawl posture.** Freeze method-pack expansion, checker expansion,
  and proposal/autonomy work until the core drafting path improves. This is
  a governance call, not a design call.
- **Semantic judges as one-shot falsifiers, not runtime blockers.** Matches
  the current repo posture and the standing constraint that noisy LLM
  checkers should not be calibrated for promotion.
- **Subtract before add.** Every additive item names what it freezes
  alongside. Minimum two subtractions before a third addition.

## Corrections to the synthesis

### Correction 1 — Writer-undershoots fixture is mismatched

Modifies: `opus-next-experiment-backlog.md` B2; `opus-harness-autopsy.md` R1
sequencing claim.

The current live failure is over-expansion (1.89× / 3.03×), not undershoot.
A fixture set should include undershoot cases, but the **primary** test must
include the actual over-target profile. Otherwise we risk fixing the wrong
visible symptom again. The 2026-05-09 Slice 2.5 retrospective recommended
undershoot fixtures because that was the failure mode at the time; the live
failure now is the opposite, and the fixture set must reflect that.

### Correction 2 — "Strip ID metadata" is a prompt ablation, not a free win

Modifies: `opus-next-experiment-backlog.md` B1.

Traceability IDs are non-negotiable infrastructure. Keep IDs everywhere in
system state, telemetry, DB rows, checker findings, proposal targets,
traceability views, eval artifacts, and audit logs. IDs are how the harness
knows which scene/beat/obligation produced which prose, which fact was
supposed to land, which promise/payoff moved, what becomes stale after edits,
and which checker finding maps back to which source.

The narrow question is whether the **prose-writer prompt** needs raw IDs
visible. The model needs the meaning of the dependency, not the literal ID.

Better shape:

Writer prompt (human-readable):
> Sylvie must refuse Voss's offer because accepting would violate her healing
> oath. This refusal should increase her guilt and make Jien protective.

Trace payload (preserved in metadata):
- `sceneId: ch-002-general-s-equation-scene-001-voss-offer`
- `obligationIds: [...]`
- `characterIds: [...]`
- `threadIds: [...]`
- `promiseIds: [...]`

Exceptions where IDs **stay visible** to the LLM:
- LLM must emit structured JSON referencing those exact IDs.
- Call is a mapper / checker / reviewer, not creative prose.
- Prompt asks the model to update a plan or proposal target.
- Two similarly named things require exact disambiguation.

Test as an ablation:
- **Arm A**: current prompt with raw IDs.
- **Arm B**: prose-readable dependency text; raw IDs removed from visible
  prompt, preserved in trace metadata.
- **Measure**: plan drift, hallucination, obligation coverage, cost/tokens,
  prose quality.
- **Decision rule**: do not promote on token savings alone. Require parity-
  or-better on drift, hallucination, and obligation coverage **and** prose
  quality, with no regression on obligation coverage.

### Correction 3 — Deterministic scene-contract fallback is risky

Modifies: `opus-next-experiment-backlog.md` B3 (deterministic field
population).

"Goal from leading verb-noun," "turningPoint from final clause," etc. is the
fuzzy heuristic pattern the codebase has been trying to avoid. Allow only as
a diagnostic fallback to surface gaps, not a production authoring method.

Better path: the planner authors scene contracts explicitly; deterministic
code validates presence and shape, not content.

### Correction 4 — Rendering a scene contract is not the same as scene-level generation

Modifies: `opus-next-experiment-backlog.md` B3 (test design).

B3 as drafted keeps the writer call unit beat-shaped. That may help, but if
the actual issue is "the writer doesn't know scene boundaries," the more
honest test is three arms:

- **A**: current beat-shaped writer + no scene contract.
- **B**: beat-shaped writer + scene contract rendered.
- **C**: scene-call writer + scene contract.

Otherwise we may under-test the real architecture shift. If C beats B, the
shift to scene-call generation is justified. If B beats A but C ≤ B, the
contract-rendering gain is real but the architecture shift isn't yet
warranted.

### Correction 5 — Method packs deferred, but not buried

Modifies: `opus-overbuild-critique.md` P3-P4 archive proposal;
`opus-next-experiment-backlog.md` C3.

Don't run seven packs. But upstream concept/template quality probably still
matters. Keep one simple method-pack or chapter-function scaffold as a shadow
feeder once scene contracts have somewhere to land. The scaffold runs in
diagnostic mode only until the scene-level lane (B1–B5 below) closes.

## Adjusted lane plan

### B1 — Prompt ablation: writer-facing IDs

Remove writer-facing **raw** ID metadata behind a flag. Keep IDs in trace
metadata, DB rows, telemetry, checker payloads, eval artifacts. Replace the
visible prompt fragment with prose-readable dependency text per Correction 2.

- Arm A: current prompt with raw IDs.
- Arm B: prose-readable rendering; raw IDs removed from visible prompt.
- Measure: plan drift, hallucination, obligation coverage, cost/tokens,
  prose quality.
- Decision rule: do not promote on token savings alone.

### B2 — Build a mixed fixture set

Includes:
- the current over-target fantasy-healer style (the actual live failure
  profile);
- undershoot cases;
- clean pre-resolved NPC / casting cases;
- at least one real generated plan from current runtime (e.g.,
  `novel-1778411555121`).

This is the precondition for B3. Without the over-target profile in the
fixture, B3 fixes the wrong symptom.

### B3 — Scene-contract A/B/C

Hold planner output fixed where possible. Three arms:
- **A**: current writer (beat-shaped, no scene contract).
- **B**: current writer + scene contract rendered.
- **C**: scene-call writer + scene contract.

Scene contracts must be **planner-authored**, not deterministically guessed.
Deterministic code validates presence and shape, not content.

### B4 — Judges as diagnostic

Use endpoint landing + scene dramaturgy as scoring signals, not blockers.
Falsifier role only. No runtime gating.

### B5 — Decide whether to promote

Promote (B or C over A) only if:
- it improves story shape on judge falsifiers;
- it reduces drift / expansion variance;
- it does not add checker noise.

If C beats B, the architecture shift to scene-call is justified. If B beats
A but C ≤ B, ship B and defer C until a separate justification appears.
If neither beats A, the synthesis position itself is wrong and the lane
closes.

## Status of the original Opus backlog items

| Opus item | Disposition |
|---|---|
| Strip writer ID metadata (Opus B1) | **Modified.** Adjusted-B1 narrows scope to the prose-writer prompt and runs as an ablation; IDs preserved in all other surfaces. |
| Writer-undershoots fixture set (Opus B2) | **Modified.** Adjusted-B2 makes the fixture mixed, with the over-target profile primary and one real runtime plan included. |
| Un-gate scene contract on rebuilt fixtures (Opus B3) | **Replaced.** Adjusted-B3 is A/B/C with planner-authored contracts; no deterministic field population in production. |
| Method-pack POC (Opus B7 and similar) | **Deferred but not buried.** One simple scaffold stays alive in shadow per Correction 5; full pack work waits on B5. |
| Other Opus items (B4–B6, B8–B10) | **Deferred** to post-B5. Revisit only if the scene-level lane clears its kill-gate. |

## Bottom line

Opus's synthesis is directionally right: focus the lane on scene-level
plan/write behavior, and stop building side scaffolds. The corrections are:

1. Don't productionize deterministic guessed scene fields.
2. Test actual scene-call generation alongside contract rendering.
3. Treat the writer-prompt ID question as a narrow ablation, not a
   system-wide stripping. Traceability is non-negotiable.
4. Use the actual over-target failure profile as the primary fixture, not
   just undershoot.
5. Don't entirely bury upstream concept/template scaffolds — one diagnostic
   feeder stays alive.
