# Lane Queue

This file tracks active work only. Active implementation happens on `main`
unless the user explicitly requests a disposable branch.

## Active

- Scene-first runtime promotion lane (2026-05-09): four-slice incremental
  promotion of POC scene-contract methodology into production. Plan:
  `/Users/andre/.claude/plans/velvet-riding-cascade.md`. Session contract:
  `docs/sessions/2026-05-09-scene-first-runtime-promotion.md`.
  - Slice 0 (L095): substrate shipped — optional scene-contract schema fields,
    seven-value `storyDebtStage` enum, `scenePlanContractV1` flag,
    `enforceScenePlanContract` helper. Default-off; byte-parity preserved.
  - Slice 1 (L096): planner behavior wiring shipped — causal-motivation-v3
    prompt under flag, state-mapper materiality + wider stage values,
    structural-v1 retry. Default-off.
  - Slice 1.5 (L096 amendment): validator demoted to advisory mode after
    three LXC smokes showed DeepSeek V4 Flash can't reliably comply with the
    multi-field contract on production-shape novels. Validator still runs
    and logs findings; planning never throws. Promotion to blocking mode is
    contingent on a model upgrade or contract simplification — deferred
    indefinitely.
  - Slice 2 (L097): writer scene-context rendering + retry-short-scenes-v1
    expansion shipped behind `sceneCallWriterV1=false` +
    `writerExpansionMode="off"`. Wiring validated by unit tests + byte-parity
    replay; LXC drafting fixed-plan A/B explicitly deferred until a
    `test-drafting-isolated` harness is built (Slice 2.5 backlog).
  - Slice 3 (L098): structural wiring shipped — optional `obligationIds`
    on `ChapterPlanDeviation` and `ValidationFinding`,
    `sceneSatisfactionCheckerV1` flag, obligation-aware validation-routing
    helper that closes a silent-no-op routing bug. LLM judge + parity
    panel deferred to Slice 3.5 backlog.
  - Slice 2.5 (harness shipped, A/B inconclusive 2026-05-10):
    `scripts/test-drafting-isolated.ts` clones planning-done source twice and
    runs drafting on both arms with different writer flags. First run on
    `test-planner-fantasy-cartographer-1778375271479` produced no usable A/B —
    baseline arm drafted 5/10 chapters at mean ratio 2.20 (over-target across
    the board), treatment arm bailed at ch1 on a halluc-ungrounded plan-assist
    gate. Zero `writer-expansion` events fired in either arm because the L097
    expansion path only triggers when `actualWords < advisoryFloor` (70% of
    target) and this fixture overshoots. To actually answer the deferred
    question, pick a fixture where writers undershoot AND bypass/pre-resolve
    plan-assist gates so both arms can complete the full 10 chapters. Until
    then, `sceneCallWriterV1` and `writerExpansionMode` stay default-off.
  - Slice 3.5 (deferred): port narrow scene-semantic LLM judge to
    `scripts/evals/scene-semantic-review.ts` (replay-only) + build
    `scene-checker-parity-panel.ts` (agreement matrix). Diagnostic only.
- Upstream planning methodology lane: narrow the active product question to
  concept/planning templates, chapter contracts, scene contracts, obligation
  traceability, and planner-quality diagnostics. See L089.
- Run/thread coherence: manifests, validation, refs, thread maps, static evidence, advisory review, opt-in context arm, and scene-plan evidence naming are in.
- Visibility/interactivity foundation is at scope ceiling for now; additional
  UI work is lower priority unless a UI surface changes as part of a specific
  accepted slice.
- Fact roles remain A/B-only; do not wire writer/checker policy without new
  evidence.

## Next

- Native chapter contracts and story-turn planning are now the production
  runtime default, with legacy rollback via seed override. Next gather direct
  runtime drafting evidence and improve endpoint satisfaction plus listed-
  character materiality in the main planner path; see L088.
- Evaluate upstream structure-template scaffolds, including commercial
  chapter-function templates, as concept/planning diagnostics before touching
  drafting/checking/UI. Hold other layers steady unless the test explicitly
  measures downstream projection. Candidate hypotheses are collected in
  `docs/authoring-methodology-hypotheses.md`.
- If pursuing scene-first methodology, treat `sceneId` as the plan/write/check
  unit and `obligationId`/`sourceId` as the traceability unit; do not preserve
  beat-level adherence as the primary future contract by default. See L092.
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
- Before the next implementation slice, write the L87 change packet so phase,
  optimized layer, exact change, expected benefit, downstream projection, and
  evidence gate are explicit.

## Recently Closed

- `calibrated:packed` v1 shipped (commits `da6e39f`, `f8057d4`) and
  evaluated at N=12 × 4 arms × 1 chapter (experiment #479): matches
  `control:source` clean-pass count (10/12) at 1.76 mean word ratio (vs
  3.38) and 65% of control cost. Promotion remains `hold` per L086 — word
  ratio missed 1.75 by 0.01 and completion 10/12 vs better hard-cap 11/12.
  Audits show zero dropped obligations and zero dropped payoffs across all
  12 cells, but is now diagnostic evidence only per L088. Record:
  `docs/sessions/2026-05-06-pickup-planner-shape-baseline.md`.
- `nativePlanningContractV1` shipped and is now the production default:
  concept/planning contract guidance, over-fragmentation retry/reject
  enforcement, and legacy rollback with `nativePlanningContractV1=false`.
- Controlled comparison on frozen `fantasy-system-heretic` concept produced
  legacy 24 beats vs native 18 beats. Native improved mapper headroom and
  avoided visible payoff-link sanitation, but still needs story-quality and
  downstream drafting evidence.
- Planner-quality diagnostic added for controlled planning pairs. On the
  frozen `fantasy-system-heretic` pair it confirmed native's mechanical shape
  improvement while flagging endpoint/relationship risks that beat counts alone
  would hide.
- Additional recent closures are archived in
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
