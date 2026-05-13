# Lane Queue

This file tracks active work only. Active implementation happens on `main`
unless the user explicitly requests a disposable branch.

## Active

- **Production-path one-offs are now the standing default (L106/L107).** Test
  new hypotheses through production modules, default-off arms, diagnostics,
  readiness artifacts, and run-compare/cohort reports. Historical `poc/`
  outputs are evidence/fixtures only; do not add POC runners, prompt branches,
  mappers, checkers, or review formats when a thin production wrapper can write
  the same artifacts.
- **Production writer/planner evidence (2026-05-12).** P1/P2/P3 evidence now
  runs through production writer briefs, planner/state-mapper flags,
  diagnostics, Plan Readiness, and reviewed `planning_edit`. Scene-turn semantic
  backfill is removed; endpoint, source-refed turn-shape, and materiality gaps
  surface as warnings/readiness labels. P1/P2/P3 tight clean replays hold
  Plan-Assist/context/checker groups 0 and prose/scene lows 0 at 3741/3100,
  4086/3100, and 3806/3100; length attribution classifies residual length as
  mixed scope-load plus budget-control. Bounded target scaling showed 0.85 can
  work and 0.72 adds checker noise, so deterministic compaction is not the
  active lever. Selector `semantic-exec-p2-arms-1778590188` rejected scene-turn
  and anchored arms; tight-anchored was P2-promising at 4272/3100 with no scene
  lows and better endpoint/dramaturgy. P1/P3 replications blocked promotion:
  P1 regressed at 4392/3100 with one scene low; P3 was mixed at 4269/3100 with
  no scene lows but readiness/checker noise. Cohort
  `semantic-exec-p123-tight-anchored-vs-tight` is regressed overall. Default
  flip remains blocked; semantic evidence is explicit via
  `--quality-telemetry-packet`, while default drafting now prioritizes
  scene-contract/adherence mechanics over paid semantic gates. See L106-L108/L112.
- **Genre-specific plotline lane is open (L109).** First commercial POC is adult guild/mercenary mission progression fantasy; shape one Book 1 contract packet from `docs/method-packs/mercenary-progression-adventure-v0.md` before broad drafting.
- **Rillgate drafting follow-up (L110-L112).** Use repaired planner source `test-planner-mercenary-rillgate-saltmine-1778674224711`: 10 chapters / 49 scenes, balanced load, boundary redaction active, `futureEventAnchors: 0`, and no sequence-guard retry. 2026-05-13 Plan Readiness repairs landed through approved `planning_edit` proposals; planner-quality endpoint/inactive-character/weak-turn/obligation errors are 0, and planning-context missing dramatic/endpoint/turn/materiality shape is 0. Draft from this source with default `scene-checks`, verify writer-context/checker-readiness telemetry, and keep halluc/semantic judges opt-in unless evidence is explicitly needed.
- **Planning-to-drafting context audit is production evidence now (2026-05-11).**
  `diagnostics:planning-drafting-context` compares upstream artifacts with
  writer-context/canon/story-spine/story-ref/reader-state telemetry, scene-normalized coverage, and scene-load pressure; run-compare/cohort
  compare reports with trace IDs/clusters, context, manual-readiness deltas, and scene-contract semantic gap deltas, and isolated runs now write Plan-Assist plus checker-readiness sidecars.
  Scene-contract telemetry separates broad `dramatic` presence from `choice`,
  `endpoint`, and `full` completeness.
  `diagnostics:planning-context-readiness` converts overloaded scene-load, future-event
  anchors, partial scene contracts, narrow materiality/fact-status gaps, and unresolved
  refs into manual readiness items; narrow semantic gaps target scalar scene fields or
  `beat_obligation:materialityTest`; `diagnostics:plan-assist-readiness` imports Plan-Assist rows. Keep context gaps diagnostic unless downstream context is missing for a needed ref.
- **Aggressive evidence loops remain authorized (L101, amended by L106/L107).**
  Replace day-based timelines with goal queues and stop conditions. Use
  DeepSeek spend for production-path sweeps, semantic diagnostics, and
  statistics; parallelize independent write scopes; keep going until blocked by
  production-default risk, traceability loss, repeated same-fingerprint failure,
  unavailable environment, or explicit operator decision. Disposable one-offs must reuse production modules/artifact contracts whenever possible.
- **Scene-level plan/write lane (operator-adjusted, 2026-05-10).** Operational
  plan is `docs/research/user-adjusted-backlog-2026-05-10.md` (B1–B5);
  research inputs live under `docs/research/`; writer-prompt IDs are L099.
- **Strategic direction (2026-05-10): scene-first migration.** Scene is the
  durable plan/write/check unit (L092/L095); beats are legacy annotations.
  Migration plan: `docs/sessions/2026-05-10-scene-migration-plan.md`. S1
  default flip is deferred behind production-path integration evidence and
  needs a production-default decision plus replay-fixture re-record.
- **Historical scene-first evidence hold (L103).** P3 baseline,
  tight-scope, density-cap, and fixed-plan expansion A/B artifacts landed under
  `poc/scene-first-novella/output/`. Evidence supports scene-count control,
  endpoint/hook fit, and lower obligation density as real levers, but best run
  remains 1.90x target and expansion retry recorded zero events. Keep
  `scenePlanContractV1`, `sceneCallWriterV1`, and `writerExpansionMode`
  default-off; next production-path slice should target planner/state-mapper
  obligation load.
- **Historical load-control evidence hold (L104).** Parallel arms tested prompt-only
  hard cap, deterministic chapter-budget compaction, and minimal state mapping.
  Best length was prompt-only at 6456/3900 = 1.66x with 8 obligations, but
  endpoints regressed to 2/2/3. Endpoint-complete arms stayed at 2.16x
  (compactor) and 1.89x (mapper-min v3). Do not promote load-control defaults;
  next production-path slice should compress scene-contract payload while
  preserving endpoints.
- **Adjusted-B1/B2/B3 prep all shipped (default-off).** The scene-first
  evidence lane is runnable end-to-end on LXC.
  - **B1 flag (`writerPromptIdRendering`, commit `62e5c8c`):** default
    "raw" preserves byte-parity (replay green; 21 beat-context fixtures
    pass; 1423 fast-tier tests pass); `"suppress"` per-novel override
    omits Cluster-1 raw-ID lines from the prose-writer prompt only.
    Trace metadata / DB / telemetry / checker findings / proposals /
    evals / audit unaffected. See L099.
  - **B2 runner (`--from-fixture`, commit `e48f996`):** chains concept
    + planning on a P1/P2/P3 fixture in one command. Resulting novel-id
    feeds `test-drafting-isolated`.
  - **B3 contract-render decoupling + new arms (commit `138780c`):**
    `forceRenderSceneContractWhenAvailable` decouples scene-contract
    render from `sceneCallWriterV1`. `test-drafting-isolated --writer-arms`
    grows two new arms — `id-suppress` (B1 ablation) and
    `contract-render-only` (B3 Arm B). `scene-call-v1` (B3 Arm C)
    pre-existing. Default arm list `baseline,scene-call-v1` unchanged
    so existing scripts produce identical output.
  - **P4 capture (commit `cc6385e`):** real frozen plan from
    `novel-1778411555121` ch1+ch2 (5+6 scenes, 11 obligations, empty
    refs substrate). Replaces the is_stub manifest. Loader hydration
    is partial — for B3 evidence on P4, drive
    `test-drafting-isolated --source novel-1778411555121` so
    `clone-for-variant` carries the full concept-side state.
  - Operator commands in `docs/fixtures/scene-first/README.md`.
  - structure-* namespace move stays parked — not on the critical path.
- Scene-first runtime promotion lane CLOSED (2026-05-09/10). All four slices
  + 2.5 + 3.5 shipped default-off. Retrospective:
  `docs/sessions/2026-05-09-scene-first-runtime-promotion.md`. Open follow-ups
  now sequenced into the operator-adjusted lane above: Slice 2.5 redo and
  Slice 3.5 live N≥20 panel both depend on the adjusted-B2 mixed fixture
  set (P1 over-target primary, plus undershoot, pre-resolved, real-runtime-
  derived). Promotion of any flag stays gated.
- Upstream planning methodology lane: narrow the active product question to
  concept/planning templates, chapter contracts, scene contracts, obligation
  traceability, and planner-quality diagnostics. Direct runtime evidence slice
  completed 2026-05-10; see
  `docs/sessions/2026-05-10-runtime-drafting-evidence.md`. See L089.
- Run/thread coherence: manifests, validation, refs, thread maps, static evidence, advisory review, opt-in context arm, and scene-plan evidence naming are in.
- Visibility/interactivity foundation is at scope ceiling for now; additional
  UI work is lower priority unless a UI surface changes as part of a specific
  accepted slice.
- Fact roles remain A/B-only; live runs require `--allow-disposable-ab`, and
  writer/checker policy must not be wired without new evidence.

## Next

- Next session start: use `semantic-exec-p123-tight-anchored-vs-tight` trace
  clusters as the next production-path input. Favor a narrow main-path change
  that improves endpoint landing or character materiality on the regressed rows,
  with `--quality-telemetry-packet` evidence and no POC branch.
- Plotline start: use the wired Rillgate Book 1 contract packet; keep seeds story-owned and free of process/count instructions.
- Planning-to-drafting context next step: use `attempted_no_context` reference
  telemetry as a diagnostic only; escalate to Plan Readiness only after a run
  shows missing downstream context for a genuinely needed background reference.
- Production scene-first migration S1 is deferred by the L103 promotion hold.
  When reopened, close L096's
  `scenePlanContractV1` prompt-fidelity gaps, re-record replay parity fixtures,
  and ship a new production-default decision record. Sequence per
  `docs/sessions/2026-05-10-scene-migration-plan.md`.
- Open follow-ups (NOT on the critical path): richer P4 fixture
  hydration (load-frozen-plan currently writes only novels +
  chapter_outlines; clone-for-variant carries the full state today, so
  P4 is usable via --source). See `docs/fixtures/scene-first/README.md`.
- Native chapter contracts and story-turn planning are the production runtime default, with legacy rollback via seed override. Scoped chapter-contract expansion plus boundary redaction passed for `mercenary-rillgate-saltmine` at 10 chapters / 49 scenes (`test-planner-mercenary-rillgate-saltmine-1778674224711`), and Plan Readiness repairs are applied; next draft from that repaired source. See L088/L109/L111.
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
- Corpus structure recreation is historical evidence now: v3 planning survived ch1+ch2; `thread-character-context-v1` is the production writer-context default after POC expansion gains without semantic lows. New `diagnostics:corpus-recreation-poc` runs require an explicit disposable flag. See L094/L106.
- Review `docs/method-packs/commercial-fantasy-adventure-v0.md` as the first
  general method-pack charter before implementing template definitions,
  fixtures, or planner prompt changes.
- Apply frameworks via `docs/research/writing-frameworks/framework-application-plan.md`; next is diagnostic-only CFA v1 plus framework-to-prose diagnostics through production-path evidence where possible.
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
  disposition capture, staleness refresh, and evidence/ID-rich manual `planning_edit`
  proposal scaffolds now support replacement values and exact required-ID removal. The
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
