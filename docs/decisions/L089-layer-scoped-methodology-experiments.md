---
status: active
date: 2026-05-07
role: decision-record
---

# L089: Layer-Scoped Methodology Experiments

## Decision

Every non-trivial authoring-methodology change must name the layer it is
optimizing and hold adjacent layers steady unless the experiment explicitly
tests a downstream consequence.

Current product focus is upstream concept/planning quality:

- genre and market strategy;
- structure templates and chapter-function slots;
- chapter contracts, scene functions, and beat/obligation checklists;
- planner-quality evidence for endpoint landing, character materiality,
  obligation health, and story-function allocation.

UI, Playwright, writer rewrites, checker strictness, and review/proposal
surfaces remain important infrastructure, but they are not the active product
optimization target unless a slice explicitly changes those surfaces. Do not
try to improve concept, planning, drafting, checking, and UI in the same
experiment.

## Rationale

Recent beat-count and packing work produced useful evidence, but it also
showed how easy it is to optimize the wrong layer. A downstream repair can
make a chapter shorter without proving the planner understands story function.
Likewise, UI work can improve visibility without improving the novel-writing
methodology itself.

The harness needs cleaner causal evidence. If a structure scaffold such as a
commercial 24-chapter outline is introduced, it should first live as far
upstream as possible: concept/planning input, structure-slot labels, and
read-only diagnostics. Only after plan-quality evidence improves should it be
fed into drafting, checking, proposal flows, or UI defaults.

Candidate experiments are collected in
`docs/authoring-methodology-hypotheses.md`.

## Implications

- Change packets must include `optimized layer`: concept, planning template,
  chapter plan, scene plan, beat obligations, writer, checker, revision,
  proposal/review, UI, telemetry, or test infrastructure.
- Methodology candidates start default-off and diagnostic/A-B-only.
- Prefer additive IDs and observations: `templateId`, `structureSlotId`,
  future `sceneId`, `chapterId`, `obligationId`, and source refs. Under a
  scene-first method, `beatId` is legacy/internal compatibility unless beat
  planning remains the primary contract.
- Browser testing is required for UI-facing handoff, but Playwright work should
  not be expanded just to create motion while the active question is upstream
  planning quality.
- Branches are reserved for destabilizing or explicitly disposable
  architecture experiments. Default-off flags, disposable novel clones, and
  atomic commits on `main` are the normal isolation tools.
- A methodology experiment should define fixed inputs, one changed layer,
  expected downstream projection, and the evidence needed before touching the
  next layer.
