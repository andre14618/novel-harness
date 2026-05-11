# Lane Queue

This file tracks active work only. Active implementation happens on `main`
unless the user explicitly requests a disposable branch.

## Active

- **Production-first posture is now the standing default (L106).** Validated POC
  learnings move into production modules, controls, telemetry, tests, and review
  artifacts. Use historical `poc/` outputs as evidence/fixtures, but do not add
  another long-lived POC runner, prompt branch, mapper, checker, or review
  format when the same question can be tested through the production path. New
  scene-first novella POC runs require an explicit disposable-POC flag.
- **Production writer-brief evidence (2026-05-11).** P1 made
  `drafting-brief-v1` strongest at 1.24x with prose lows 0/8 and scene lows
  1/33, but LitRPG replication still holds promotion. Planner-generated P1
  repair reached `choice/full=11/11` and `factContradictions=0`; evidence now
  shows a quality/length tradeoff. Clean-source Corso plan repair:
  4778/3800 = 1.26x, scene lows 0/34, prose lows 0/8. LitRPG materiality repair via two approved
  `planning_edit` proposals: 3966/2700 = 1.47x, prose lows 0/8, gaps 0, scene
  lows 3/45; ch1 materiality resolved, ch2 Verification stayed MATERIAL-0, and
  new ch1 materiality plus ch2 endpoint lows appeared. Obligation-character
  carry-through cleared materiality but regressed to 4476/2700 = 1.67x and
  endpoint lows 4/14; endpoint repair cleared selected LitRPG lows at
  4640/2700 = 1.72x. A default-off tight arm plus two source `planning_edit`
  endpoint repairs reached 3398/2700 = 1.27x with scene lows 0/45; Corso
  replication regressed to 5002/3800 with scene lows 4/34. Fresh P1 N=4 tight
  cohort stayed mixed: mean -31.3 words, scene lows -6, endpoint lows -2,
  alignment 3 quality-gain-with-load-change / 1 expanded-no-gain row; new-row manual readiness: checker blockers -1, warnings +17. Separate gate cell leaves 5 clean sources but 4 evidence-comparable rows.
  Keep broad operational-facts brief out after 6050/3800 regression. No default flip. See L106.
- **Planning-to-drafting context audit is production evidence now (2026-05-11).**
  `diagnostics:planning-drafting-context` compares upstream artifacts with
  writer-context/canon/story-spine/story-ref/reader-state telemetry and scene-load pressure; run-compare/cohort
  compare reports with trace IDs/context and manual-readiness deltas, and isolated runs now write Plan-Assist plus checker-readiness sidecars.
  Scene-contract telemetry separates broad `dramatic` presence from `choice`,
  `endpoint`, and `full` completeness.
  `diagnostics:planning-context-readiness` converts overloaded scene-load,
  future-event anchors, partial scene contracts, narrow fact-status reversals, and
  unresolved reference attempts into manual Plan Readiness items. `diagnostics:plan-assist-readiness`
  converts pending Plan-Assist rows into manual readiness items. Keep context gaps diagnostic unless downstream context is missing for a needed ref.
- **Aggressive evidence loops remain authorized (L101, amended by L106).**
  Replace day-based timelines with goal queues and stop conditions. Use
  DeepSeek spend for production-path sweeps, semantic diagnostics, and
  statistics; parallelize independent write scopes; keep going until blocked by
  production-default risk, traceability loss, repeated same-fingerprint failure,
  unavailable environment, or explicit operator decision.
- **Scene-level plan/write lane (operator-adjusted, 2026-05-10).** Operational
  plan is `docs/research/user-adjusted-backlog-2026-05-10.md` (B1–B5).
  Inputs: seven Opus deep dives plus audits for ID rendering, structure-*
  namespace, and fixture design under `docs/research/`. Decision record for
  the writer-prompt ID question: L099.
- **Strategic direction (2026-05-10): scene-first migration.** Beats
  are not the future. The legacy beat-shaped writer was never
  validated to a production-quality bar and is no longer treated as a
  control to optimize. Scene is the durable plan/write/check unit (per
  L092/L095). The migration plan is in
  `docs/sessions/2026-05-10-scene-migration-plan.md` (S0–S7 slices).
  S0 (user-facing log + docs cleanup) shipped. S1 (default flip +
  scenePlanContractV1 calibration) is now a later production slice,
  deferred behind production-path integration evidence; it will need its own
  production-default decision record and replay-fixture re-record.
- **Scene-first novella POC promotion hold (L103).** P3 baseline,
  tight-scope, density-cap, and fixed-plan expansion A/B artifacts landed under
  `poc/scene-first-novella/output/`. Evidence supports scene-count control,
  endpoint/hook fit, and lower obligation density as real levers, but best run
  remains 1.90x target and expansion retry recorded zero events. Keep
  `scenePlanContractV1`, `sceneCallWriterV1`, and `writerExpansionMode`
  default-off; next production-path slice should target planner/state-mapper
  obligation load.
- **Load-control POC promotion hold (L104).** Parallel arms tested prompt-only
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

- Next session start: inspect `drafting-brief-tight-v1` source-sensitive regressions and checker-policy noise before any default decision. See L103-L106.
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
