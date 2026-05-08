# Lane Queue

This file tracks active work only. Active implementation happens on `main`
unless the user explicitly requests a disposable branch.

## Active

- Upstream planning methodology lane: narrow the active product question to
  concept/planning templates, chapter contracts, scene contracts, obligation
  traceability, and planner-quality diagnostics. See L089.
- Visibility/interactivity foundation is at scope ceiling for now; additional
  UI work is lower priority unless a UI surface changes as part of a specific
  accepted slice.
- Fact roles remain A/B-only; do not wire writer/checker policy without new
  evidence.

## Next

- Upstream native planning contract is directional hold after the controlled
  3-chapter planner comparison and planner-quality diagnostic: better beat
  budget, mapper pressure, and weak-turn count, but endpoint satisfaction and
  listed-character materiality still need upstream work. Next choose whether to
  revise concept/planning contracts or draft the controlled pair; see L088.
- Evaluate upstream structure-template scaffolds, including commercial
  chapter-function templates, as concept/planning diagnostics before touching
  drafting/checking/UI. Hold other layers steady unless the test explicitly
  measures downstream projection. Candidate hypotheses are collected in
  `docs/authoring-methodology-hypotheses.md`.
- If pursuing scene-first methodology, treat `sceneId` as the plan/write/check
  unit and `obligationId`/`sourceId` as the traceability unit; do not preserve
  beat-level adherence as the primary future contract by default.
- Next docs/code slice should use `docs/planner-output-contract.md` as the
  target: template slot -> chapter contract -> scene contract -> obligations
  before writer/checker/UI changes.
- Golden examples for that contract should come from authored craft/template
  structures or corpus-derived distributions, not existing beat-shaped harness
  outlines. Legacy outlines are baseline/migration evidence only.
- Review `docs/method-packs/commercial-fantasy-adventure-v0.md` as the first
  general method-pack charter before implementing template definitions,
  fixtures, or planner prompt changes.
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
  creation from replacement values are in place, plus a read-only outcome
  report over linked proposal resolution, planning lineage, and exact observer
  rows where available. Next add supported remove-requirement edits and
  concrete downstream observer capture for approved planning edits before UI.
  See L91.
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
- `nativePlanningContractV1` first slice shipped: default-off concept/planning
  context guidance, over-fragmentation retry/reject enforcement, and
  `test-planner-isolated` runner flag. Smoke on `phase-parity-smoke` produced
  5 beats for 1500w with clean planning token headroom.
- Controlled comparison on frozen `fantasy-system-heretic` concept produced
  legacy 24 beats vs native 18 beats. Native improved mapper headroom and
  avoided visible payoff-link sanitation, but still needs story-quality and
  downstream drafting evidence.
- Planner-quality diagnostic added for controlled planning pairs. On the
  frozen `fantasy-system-heretic` pair it confirmed native's mechanical shape
  improvement while flagging endpoint/relationship risks that beat counts alone
  would hide.
- Additional recent UI, diagnostics, checker, proposal, traceability, test, and
  lineage closures are archived in
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

Closed history:
`docs/sessions/archive/lane-queue-2026-05-04-full.md`,
`docs/sessions/archive/lane-queue-2026-05-06-recent-closed.md`.
