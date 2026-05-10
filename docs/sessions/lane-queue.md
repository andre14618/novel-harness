# Lane Queue

This file tracks active work only. Active implementation happens on `main`
unless the user explicitly requests a disposable branch.

## Active

- Scene-first runtime promotion lane CLOSED (2026-05-09/10). All four slices
  + 2.5 + 3.5 shipped default-off. Retrospective:
  `docs/sessions/2026-05-09-scene-first-runtime-promotion.md`. Open follow-ups
  outside this lane: (a) Slice 2.5 redo needs a writer-undershoots fixture +
  pre-resolved entities; (b) Slice 3.5 live N≥20 panel needs a fixture with
  declared refs AND scene-contract fields. Promotion of any flag stays gated.
- Upstream planning methodology lane: narrow the active product question to
  concept/planning templates, chapter contracts, scene contracts, obligation
  traceability, and planner-quality diagnostics. Direct runtime evidence slice
  completed 2026-05-10; see
  `docs/sessions/2026-05-10-runtime-drafting-evidence.md`. See L089.
- Run/thread coherence: manifests, validation, refs, thread maps, static evidence, advisory review, opt-in context arm, and scene-plan evidence naming are in.
- Visibility/interactivity foundation is at scope ceiling for now; additional
  UI work is lower priority unless a UI surface changes as part of a specific
  accepted slice.
- Fact roles remain A/B-only; do not wire writer/checker policy without new
  evidence.

## Next

- Next session start: use the 2026-05-10 runtime evidence to choose a narrow
  implementation slice. Preferred order: (1) fixture or prompt path that emits
  real `threadId`/`promiseId`/`payoffId` refs so lineage can be tested; (2)
  planner-frozen default-writer vs scene-call-writer A/B where word expansion
  is visible; (3) endpoint-landing semantic review; (4) remaining telemetry
  cleanup so `beatId` appears only for real beat hints, legacy beat-shaped
  entries, or beat-specific compatibility.
- Native chapter contracts and story-turn planning are now the production
  runtime default, with legacy rollback via seed override. Next gather direct
  runtime drafting evidence and improve endpoint satisfaction plus listed-
  character materiality in the main planner path; see L088.
- Evaluate upstream structure-template scaffolds, including commercial
  chapter-function templates, as concept/planning diagnostics before touching
  drafting/checking/UI. Hold other layers steady unless the test explicitly
  measures downstream projection. Candidate hypotheses are collected in
  `docs/authoring-methodology-hypotheses.md`.
- If pursuing scene-first methodology, treat each `outline.scenes[]` entry as
  the plan/write/check unit. Its durable entry ID is `sceneId`; reserve
  `beatId` for real beat hints, legacy beat-shaped entries, and beat-specific
  records. Use `obligationId`/`sourceId` as the traceability unit; do not
  preserve beat-level adherence as the primary future contract by default. See
  L092/L095.
- L093 runtime refs are additive: directives can declare story
  threads/debts/payoffs; state-mapper obligations and writer-context telemetry
  carry active `threadId`/`promiseId`/`payoffId` without blocking semantics.
  Deterministic mapper ref validation is warning-only. Remaining work is
  semantic payoff review plus proposal/stale-impact integration. Treat Option B
  as lineage fields, not graph implementation.
- Golden examples for that contract should come from authored craft/template
  structures or corpus-derived distributions, not existing beat-shaped harness
  outlines. Legacy outlines are baseline/migration evidence only.
- Corpus structure recreation is active: v3 planning survived ch1+ch2; `thread-character-context-v1` is now the production writer-context default after POC expansion gains without semantic lows. See L094.
- Review `docs/method-packs/commercial-fantasy-adventure-v0.md` as the first
  general method-pack charter before implementing template definitions,
  fixtures, or planner prompt changes.
- Apply frameworks via `docs/research/writing-frameworks/framework-application-plan.md`; next is diagnostic-only CFA v1 plus framework-to-prose POC.
- Method-pack Flash cohort completed at N=18 paired cells and is `HOLD`:
  slot fit/IDs held, but character materiality, world relevance, and endpoint
  landing did not improve over no-method control. Pro-thinking timed out in
  the sampled diagnostic shape and again in a narrowed one-scene smoke; use
  Flash for bulk cohorts and Pro only as smaller judge/adjudication unless its
  prompt/output shape is narrowed. Session:
  `docs/sessions/2026-05-07-method-pack-planner-cohort.md`.
- Blind semantic pairwise judge over the same N=18 plan cells exposed severe
  Plan-A bias. After AB/BA swap control, stable method wins are `0/18` and
  position-biased pairs are `18/18`; do not use this judge for promotion until
  repaired or replaced. Same-plan calibration passed `3/3`.
- Narrow DeepSeek discernment calibration found a useful judge shape while
  broad pairwise judging remains invalid. The expanded fixture covers floor
  and richness dimensions; use one excerpt, one dimension, one rubric before
  prose tests. Prefer `evidence-first` for nuance-sensitive dimensions. Record:
  `docs/sessions/2026-05-07-planner-discernment-calibration.md`.
- Plan Readiness Review is now the default bridge from planner diagnostics to
  drafting when diagnostics are available. Backend persistence/import/list,
  disposition capture, staleness refresh, and manual `planning_edit` proposal
  creation now supports replacement values and exact required-ID removal. The
  outcome report joins readiness items to proposal resolution, planning
  lineage, approved-draft impact contexts, and exact checker observations where
  available. The data-loop command proved matched diagnostic import, sample
  and explicit fixture dispositions, proposal approval, lineage, and
  draft/checker observer reporting on disposable planner data; next gather real
  operator/draft outcome data before UI. See L91.
- For local DB-backed diagnostics, verify `15432`; if down, use a temporary LXC Postgres SSH tunnel.
- Browser-test every UI-facing slice with Playwright MCP before handoff, close
  the browser session after the pass, and leave unconfirmed evidence as TODO
  rather than inferred. Do not run Playwright for non-UI methodology work.
- Keep creative heuristics diagnostic-only or A/B-gated until evidence proves
  value.
- Treat mechanically repairable prose syntax as a deterministic repair surface
  before Drafting retries or Plan-Assist Gates; keep semantic/content changes
  in Settle Loops, Reviser paths, or proposal/manual review.
## Recently Closed

- Scene-first runtime promotion lane (2026-05-09/10): see Active section + retrospective.
- Older 2026-05-09 closures (`calibrated:packed` v1, `nativePlanningContractV1`
  default, `fantasy-system-heretic` controlled comparison, planner-quality
  diagnostic) archived in
  `docs/sessions/archive/lane-queue-2026-05-06-recent-closed.md`.

## Parked

- Broader checker entity resolution for aliases, display-name variants,
  outline-derived entities, free-form allowed-new entities, and legacy
  world-location refs remains parked until there is a canonical entity registry
  or explicit checker output contract.
- Artifact/Canon checker observation sources are backlog until concrete
  artifact-aware or Canon-generation-aware observers exist.
- External CI for `policy:promotion-guard` is on hold indefinitely. Keep the
  local guard as the supported path unless the user reopens a concrete CI need.

Closed history: `docs/sessions/archive/`.
