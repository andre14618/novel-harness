---
status: active
date: 2026-04-30
experiment: 283
---

# Checker Calibration Plan

## Purpose

Build checker readiness from evidence instead of intuition. Runtime checkers can
only block drafting after their evidence surface, oracle labels, and false-positive
budget are explicit.

This plan is operational. The broader framework contract remains in
`docs/checker-framework-implementation-spec.md`.

## Layer Map

| Layer | Active checks | Valid blocker shape | Calibration need |
|---|---|---|---|
| Planning | skeleton schema, chapter count, beat floor, payoff-link sanitation, chapter-plan-reviser sanity checks | mechanical artifact integrity only | unit fixtures unless the invariant is debatable |
| Beat writing | deterministic character presence, adherence-events, halluc-ungrounded, optional quality-redraft defects | local beat failed its required event or introduced unsupported entities | oracle dataset before any LLM-backed blocker is trusted |
| Chapter/post-writing | chapter-plan-checker, continuity facts/state, payoff-link integrity, functional-state-checker warnings, draft validation, prose integrity | cross-beat contradiction, impossible knowledge, invalid graph edge, catastrophic prose corruption | oracle panels for semantic blockers; fixtures for deterministic integrity |
| Validation/UI | diagnostic validation, lint display, historical rows | no generic approval block in validation phase | diagnostic metrics only unless promoted through this plan |

## Current Surface Audit

Exp #283 traced the current runtime path: `planning-plotter` emits chapter
skeletons, `planning-beats` emits per-chapter beats/state, `enforcePlanningOutput`
sanitizes structural defects, and `drafting.ts` renders each beat through
`buildBeatContext()` before the `beat-writer` call.

Important finding: not every planner field is writer-visible. Score-bearing eval
rows must therefore freeze which surface is being judged.

| Planner field | Beat-writer visible? | Beat checker visible? | Implication |
|---|---|---|---|
| `scene.description` | yes | yes | Primary writer/checker contract. Missing-item checks can judge this directly. |
| `scene.characters` | yes | yes | Drives character snapshots and deterministic presence checks. |
| `scene.kind` | yes | yes | Rendered as a local hint, not a blocker by itself. |
| `scene.requiredPayoffs` | yes, as resolved fact text in `SEEDS` / `PAYOFFS DUE` | yes in chapter/functional checks; entity checker sees only derived names | Safe to test as writer-visible when the fact resolves. |
| `scene.obligations` | yes, as compact `BEAT OBLIGATIONS` | not yet consumed by active beat checkers | Candidate future checker contract; do not block until orphan coverage and labels are calibrated. |
| `establishedFacts` | only if encoded in beat descriptions or payoff links | yes in chapter/functional checks; partial entity derivation in `halluc-ungrounded` | Do not expect prose to establish orphan facts the writer never saw. |
| `characterStateChanges` | no direct current-chapter end-state surface | yes in chapter/functional checks | Missing state establishment should stay warning until writer-visible contract is explicit. |
| `knowledgeChanges` | no direct surface | yes in chapter/functional checks | Must be written into beat descriptions before beat-level checkers can fairly block. |
| `valueShifted`, `gapPresent`, `lifeValueAxes`, `mice*` | no | no active runtime checker surface | These are planning soft priors only in the current surface; do not score writer/checker behavior against them. |
| structural priors/directives | indirect, through the generated plan | indirect | They shape planning; they are not direct writer instructions. |

Use `bun scripts/hallucination/current-surface-manifest.ts --out <path>` before
sampling a score-bearing dataset. The manifest hashes the planner, writer,
checker, role, and schema files and records the field-surfacing matrix above.

Initial panel builder:

```bash
bun scripts/hallucination/current-surface-manifest.ts --out /tmp/current-surface.json
bun scripts/hallucination/build-current-surface-panel.ts \
  --run-id <fresh-run-id> \
  --surface /tmp/current-surface.json \
  --out /tmp/halluc-current-panel.jsonl \
  --limit 50 \
  --synthetic-per-kind 10
```

Run these on LXC after the target surface is deployed. Because LXC deploys are
rsync-based, `git rev-parse HEAD` can be stale there; use
`deployed_commit_marker` plus `surface_fingerprint` as the canonical dataset
surface identity. Local manifests may show `dirty_worktree: true` or a missing
`.deployed_commit` marker; those are useful for development but not
score-bearing dataset metadata.

## Deterministic vs Semantic

Deterministic checks are allowed to enforce invariants that every valid artifact
must satisfy. They must not encode current array shapes unless those shapes are
the domain contract.

Safe deterministic examples:

- `requiredPayoffs[].fact_id` must reference an existing established fact.
- `requiredPayoffs[].payoff_beat` must point to a real future beat.
- Approved prose cannot contain unresolved normalized blockers.
- Fallback prose cannot inherit blocker findings from an abandoned artifact.

Unsafe deterministic examples:

- assuming every good chapter has a specific beat kind sequence.
- blocking because a plan uses a different but valid structure.
- treating previous-chapter character location as immutable without same-time
  evidence.

Semantic checks require labels before promotion. They may run as warnings while
we collect data.

## Dataset Freshness Rule

Checker labels are only score-bearing for the evidence surface that produced
them. A case from an older writer prompt, checker prompt, beat-context shape,
model route, or `BEAT_ENTITY_LIST_VARIANT` can seed the failure taxonomy, but it
cannot be mixed into precision/recall metrics for the current runtime.

Every score-bearing case must record:

- git commit or deployed marker.
- writer model route.
- writer prompt/context family.
- checker prompt family.
- checker evidence-surface variant, including `BEAT_ENTITY_LIST_VARIANT`.
- whether the row came from a current-surface natural run, a historical seed, or
  a synthetic fixture.

Panel rows have three roles:

- `current_surface_natural`: counts toward current precision/recall.
- `synthetic_fixture`: counts toward edge-class regression coverage, but reported
  separately from natural precision.
- `historical_seed`: used for taxonomy and regression reproduction only; never
  counted in current precision/recall unless re-run against the current surface.

If the writer gets more structured beat context than the checker, old
`halluc-ungrounded` failures can overstate hallucination risk and understate
evidence-surface mismatch. The fix is not to discard them; the fix is to mark
them as historical seeds and regenerate a current-surface panel before changing
runtime severity.

## Shared Oracle Vocabulary

Use the same labels across checker datasets so false positives remain comparable.

| Label | Meaning | Default severity |
|---|---|---|
| `true_hallucination` | The prose introduced a named entity/lore/place/faction not grounded in the adjudicated evidence surface. | blocker candidate |
| `grounded_in_visible_context` | The checker missed evidence that was actually visible in its adjudicated surface. | pass |
| `reasonable_generic_inference` | The term is a generic or local descriptive inference, not a named world commitment. | pass or warning |
| `alias_or_paraphrase_false_positive` | The entity is a valid alias, possessive, title, or paraphrase of grounded material. | pass |
| `missing_evidence_surface` | The writer saw the grounding evidence, but the checker did not. | warning; fix context before blocker use |
| `checker_prompt_error` | The checker rubric/prompt instructed the wrong behavior or underspecified the edge case. | warning; fix prompt before blocker use |

Each adjudication also records expected runtime severity: `blocker`, `warning`,
or `pass`.

## Readiness Phases

### Phase 0 - Inventory

Status: done for exp #283 seed plan.

Deliverables:

- active checker inventory by layer, type, severity, and source file.
- list of checks with no calibration data.
- stale docs updated so the next concrete step is calibration, not another broad
  validation run.

### Phase 1 - Planning Readiness Invariants

Goal: prove the plan artifact is mechanically safe to draft before spending
writer/checker calls.

Candidate checks:

- POV exists and is internally consistent with listed characters.
- beat settings, beat characters, and chapter setting do not contradict at the
  schema level.
- payoff links are forward, resolvable graph edges.
- planner-declared state IDs are unique and referentially sound.
- writer-visible context can be assembled for every beat without missing required
  references.

Acceptance:

- fixtures include clean plans and intentionally malformed plans.
- deterministic blockers are limited to mechanical corruption.
- ambiguous story-quality judgments stay out of this layer.

Status: exp #284/#285 started this as shadow measurement. Exp #286 adds
planner-authored `scene.obligations` and renders them to the beat writer as
`BEAT OBLIGATIONS`. Hardened commit `1f62210` makes optional obligation metadata
lenient so malformed id-only items do not reject whole chapters. Fresh hardened
run `novel-1777597799926` had no schema retries, assigned all facts, and showed
remaining knowledge/state orphans in chapters 1-2. Checker promotion is still
blocked on planner contract tightening and current-surface labels.

Exp #287 tightened the prompt and hardened optional soft-prior arrays. It removed
schema retries on the final deployed surface, but prompt-only obligation coverage
was still variable (`novel-1777598438754` left chapter-3 knowledge/state orphans).
Next readiness work should be deterministic coverage validation plus targeted
re-expansion/exemption, not beat-checker promotion.

Exp #288 implements deterministic coverage validation plus one targeted
re-expansion pass for chapters whose planned facts/knowledge/state are not
writer-visible through beat text or obligations. This is still a planning-layer
gate; beat checkers should wait for fresh post-validator current-surface labels.

### Phase 2 - `halluc-ungrounded` Oracle Dataset

Goal: calibrate the current beat-level entity-grounding blocker before changing
more checker behavior.

Seed case:

- exp #282, run `567`, novel `novel-1777591510985`, checker call `llm_calls.id =
  55625`, entity `Spire`.
- against checker-visible sources, `Spire` is not grounded.
- against writer-visible retry context, this may be a surface-mismatch case.
- role: `historical_seed` until reproduced or re-run under the current
  writer/checker evidence surface.

Dataset shape:

- 20-50 natural production fires first.
- score-bearing natural rows must come from the current writer/checker prompt and
  evidence-surface version.
- include both checker fires and sampled passes.
- add synthetic edge cases only after natural cases establish the real failure
  distribution.
- keep DB prompts/prose as source of truth; checked-in seed manifests reference
  call IDs and compact adjudication metadata.

Required fields per case:

- `case_id`
- `checker`
- `source`
- `novel_id`, `run_id`, `chapter`, `beat_index`, `attempt`
- `writer_call_id`, `checker_call_id`
- `flagged_issues`
- `case_role`: `current_surface_natural`, `synthetic_fixture`, or
  `historical_seed`
- `runtime_surface`: deployed marker, writer route, writer prompt/context family,
  checker prompt family, and entity-list variant
- `checker_visible_sources_ref`
- `writer_visible_sources_ref`
- `adjudicated_surface`: `checker_visible` or `writer_visible`
- `oracle_label`
- `expected_severity`
- `notes`

Acceptance:

- at least 20 natural fires labeled.
- at least 10 clean/sampled-pass cases labeled.
- blocker precision reported on checker-visible labels and writer-visible labels
  separately.
- every false positive has one of the shared oracle labels.

### Phase 2b - Purposeful Beat-Level Fail Fixtures

Goal: guarantee that the checkers catch controlled failures at the smallest
useful unit: one beat prose sample against one checker surface.

Natural current-surface rows protect against over-triggering. Purposeful fail
fixtures protect recall.

Initial fixture classes:

| Class | Mutation | Expected target |
|---|---|---|
| `synthetic_entity_insertion` | add a named faction/place/artifact absent from the evidence surface | `halluc-ungrounded` fail |
| `synthetic_entity_swap` | replace a grounded name with an absent but plausible name | `halluc-ungrounded` fail |
| `synthetic_lore_invention` | add a specific world rule/institution not in evidence | `halluc-ungrounded` fail |
| `synthetic_event_omission` | remove the beat's core planned action while preserving fluent prose | `adherence-events` fail |
| `synthetic_event_substitution` | replace the planned action with a different plausible action | `adherence-events` fail |
| `synthetic_wrong_actor` | make the wrong character perform/learn/decide the core event | `adherence-events` fail |
| `control_generic_description` | add only lowercase generic atmosphere | both pass |
| `control_implied_event` | fulfill the beat indirectly without literal wording | `adherence-events` pass |
| `control_silent_character` | present character does not speak | both pass unless the beat requires speech/action |

Each fixture row should target exactly one checker when possible. If the same
prose should exercise two checkers, emit two rows with the same `fixture_id` and
different `checker` values so metrics remain granular.

Purposeful fail rows are score-bearing only when the mutation is single-fault and
unambiguous. Historical weird cases and ambiguous prose remain regression-only.

Parallel checker fan-out:

- run `halluc-ungrounded` and `adherence-events` independently per beat fixture.
- keep per-checker latency/cost/tokens separate.
- aggregate only after each checker emits normalized findings.
- use V4 Flash non-thinking first; escalate only invalid/ambiguous adjudication
  rows, not the runtime checker path.

### Phase 3 - Chapter Checker Oracle Panels

Goal: calibrate chapter-plan and continuity blockers after the beat-level entity
surface is understood.

Initial panels:

- 20 chapter-plan-checker failures.
- 20 chapter-plan-checker passes.
- 20 continuity fact/state findings, oversampling knowledge blockers and location
  warnings.

Acceptance:

- labels quote chapter evidence.
- previous-location warnings remain separate from impossible same-time movement.
- no semantic class is blocker-eligible without measured precision.

### Phase 4 - Holistic Trace Corpus

Goal: use full novel runs as data generation, not proof.

Each holistic validation run should append to the corpus:

- bails by checker/source.
- retry clearance rate.
- accepted blocker count.
- warning count.
- checker latency/cost.
- representative evidence-surface gaps.

Acceptance:

- every new bail reason either maps to an existing oracle class or creates a new
  proposed class in this document.
- no blocker policy changes from a single unlabelled holistic run.

### Phase 5 - Blocker Promotion Policy

Goal: make severity changes explicit and reversible.

Promotion requirements:

- deterministic invariant: fixtures pass and invariant is documented as a domain
  contract.
- semantic checker: blocker precision >= 0.85 on natural fires for the proposed
  subclass.
- at least 20 positive examples for the proposed blocker subclass, unless the
  class is rare and explicitly marked as a mandatory regression fixture.
- known false positives are downgraded, fixed, or excluded by source-scoped policy
  before promotion.

Demotion triggers:

- any repeated false-positive class that blocks live drafting.
- evidence-surface mismatch between writer and checker.
- prompt/schema drift that invalidates prior labels.

## Immediate Next Work

1. Load the exp #282 Spire seed into `halluc-ungrounded-oracle-v1` as the first
   case.
2. Sample 20-50 current-pipeline `halluc-ungrounded` fires from `llm_calls` with
   their `groundedSources` metadata.
3. Add 10 sampled passes so the panel can measure over-triggering and missed
   allowed entities.
4. Label with the shared vocabulary above.
5. Report blocker precision separately for checker-visible and writer-visible
   evidence surfaces.
