---
status: active
updated: 2026-05-13
role: canonical-current-truth
archive: archive/current-state-2026-05-04-full.md
references:
  - docs/reference/proposal-review-autonomy.md
  - docs/reference/runtime-surfaces.md
---

# Current State

This is the live entrypoint for agents. If another current document disagrees
with this file about active architecture, runtime posture, or verification
gates, this file wins. Historical detail is archived; implementation detail is
linked rather than duplicated here.

## Context Pack

Read these first, in order:

- `AGENTS.md` — agent navigation and repository rules.
- `docs/current-state.md` — live architecture and constraints.
- `docs/decisions.md` — decision index and rationale links.
- `docs/sessions/lane-queue.md` — active lane and next work only.
- `README.md` only when setup or command context is needed.

Use deeper docs only when linked by the context pack or needed by code.

## Repository Mode

- Work happens on `main` unless the user explicitly requests a branch. Use
  rollback tags before risky moves.
- Novel Harness owns novel planning, writing, checking, revision, evaluation,
  proposal workflows, telemetry, and operator review surfaces. It does not own
  a custom autonomous coding supervisor.
- Production lane is the default: preserve runtime defaults, make coherent
  atomic commits, and run targeted verification for changed behavior.
- Production path integration is the active posture: test hypotheses through
  production modules, default-off arms, diagnostics, telemetry, readiness, and
  compare/cohort artifacts rather than POC-to-main loops. One-offs must reuse
  the same production code/artifact contracts; standalone POCs need explicit
  disposable approval. See L106/L107.
- When accelerating, use goal-driven production evidence loops and parallel
  agents where write scopes are separable; continue until a real stop condition. See L101/L107.

## Active Runtime Posture

- Manual review remains the default. Deterministic mechanical assistance needs
  local replay/guard evidence; Canon autonomy needs a new explicit decision.
- Canon and planning edits remain manual by default through `manualKinds:
  ["canon_update", "planning_edit"]`.
- World-bible/canon work flows through the Canon substrate and proposal review
  path, not direct planner auto-commit by default.
- Proposal/review substrate exists and is stable enough to use, but Phase 7
  expansion is not the active product lane. Details live in
  `docs/reference/proposal-review-autonomy.md`.
- Local UI auth is bypassed for the foreseeable browser-testing lane. Set
  `ORCHESTRATOR_AUTH_ENABLED=1` to restore orchestrator API/UI auth.
- Active LLM calls use DeepSeek V4 Flash or DeepSeek V4 Pro only. Legacy model
  references are historical unless a current decision reopens them. See L90.
- Semantic telemetry is explicit opt-in. Use `test-drafting-isolated
  --quality-telemetry-packet` for the stable advisory prose+scene packet; it
  stays fail-open data, not a drafting or promotion gate. See L108/L112.

## Authoring Direction

- Current product focus is genre-specific plotline shaping for the
  mercenary-progression adventure lane, then scene-first drafting evidence; not
  broad UI or autonomy expansion. See L109.
- Planning should scope the story ask before drafting: scene count, scene
  load, obligation density, endpoint/hook fit, and chapter split decisions.
  Word counts are telemetry and rough chapter-size signals; deterministic prose
  repairs handle syntax/integrity artifacts but are not plan substitutes. Future
  reveal terms should be boundary-redacted from current-chapter generation
  context instead of repeated as "do not reveal X" prompt material. See L102/L111.
- Scene is the future plan/write/check unit. Beats remain annotations,
  obligations, legacy compatibility, or internal hints; `beatId` should be used
  only for real beat-specific records. See L092/L095.
- Traceability IDs are mandatory across state, DB, telemetry, checker findings,
  proposal targets, eval artifacts, and audit logs. Raw ID visibility inside
  prose-writer prompts is a narrower per-site question. See L099.
- Scene-first runtime substrate remains default-off for `sceneCallWriterV1`,
  writer expansion, and scene-satisfaction diagnostics; L110 renders populated
  scene-contract fields on the legacy writer, and L112 moves default retry
  checks to `scene-checks` with halluc-ungrounded LLM blocking opt-in only.
- L106 writer-brief arms remain default-off. They render compact briefs,
  record `writer-context` telemetry, and support context/readiness/compare
  artifacts; semantic prose/scene packets are explicit evidence add-ons.
- Production drafting defaults to exact-ID character context capsules
  (`thread-character-context-v1`). See L094.
- Native chapter contracts and story-turn planning are the production planning
  default with legacy rollback; downstream beat caps/packing are diagnostic
  evidence only. See L088.
- Plan Readiness Review bridges planner diagnostics to drafting; accepted scalar
  changes use manual `planning_edit` proposals, including single-field
  scene-turn/endpoint fixes and `beat_obligation:materialityTest` fixes. Use
  `diagnostics:plan-readiness-review-plan`, then apply after review. See L091.
- Runtime surfaces, traceability, checker posture, and UI inventory are
  summarized in `docs/reference/runtime-surfaces.md`.

## Active Lane

The active lane is in `docs/sessions/lane-queue.md`.

As of 2026-05-13, L106-L111 keep evidence on production paths: writer-brief
telemetry, scene-semantic replay, Plan Readiness, source hygiene,
  planning-edit replay, scene-contract telemetry, and compare/cohort artifacts.
`planningSceneTurnShapingV1` and `planningMaterialPressureV1` run through
production planner/state-mapper paths; gaps are recorded instead of
fallback-filled. Tight-anchored writer-brief evidence was promising but did not
generalize, so default flip remains blocked. L109 works directly on main:
`mercenary-rillgate-saltmine` now uses chapter-contract scoped scene expansion,
scene-scale budgets, seed process-instruction scrub, and future-boundary
redaction. Drafting source `test-planner-mercenary-rillgate-saltmine-1778674224711`
is repaired and preferred over the earlier 98-scene plan: 10 chapters / 49
scenes, balanced load, `futureEventAnchors: 0`, no sequence-guard retry, and
2026-05-13 Plan Readiness fixes via approved `planning_edit`; planner-quality
and planning-context core shape errors are 0. See L103-L111.

## Authoring Gates

- Non-trivial work starts with a change packet: phase/surface, exact change,
  expected benefit/outcome, downstream projection across affected IDs/contracts,
  optimized layer, and verification signal. If benefit is speculative, keep the
  change diagnostic-only or A/B-gated. See L87/L89.
- UI-facing work requires Playwright MCP evidence before handoff. Use
  `docs/ui-work-gate.md` and
  `docs/how-to/playwright-mcp-browser-testing.md`; do not run Playwright for
  non-UI methodology or docs work.
- Browser evidence belongs under `output/playwright/<YYYY-MM-DD>/...`; close
  the browser session and stop test-only app servers after the pass.
- Test and invariant work should use `docs/test-invariant-agent.md`.

## Verification Gates

Every slice needs targeted verification for the behavior it changed. Supported
local gates:

```bash
bun run test:fast
bun run test:db
bun run test:db:full
bun run test:archive
bun run test:replay
./node_modules/.bin/tsc --noEmit
git diff --check
```

`test:db:full` is a broad sweep, not a replacement for focused tests.
`test:replay` is opt-in for phase-parity; intentional prompt/request drift
requires a fixture re-recording commit before replay can be treated as green.

Docs-heavy work should run:

```bash
bun run docs:weight
bun scripts/preflight-docs-impact.ts --strict
```

## Documentation Rules

- Keep this file short and live. Move detailed but active reference material to
  `docs/reference/`; move history to `docs/archive/` or
  `docs/sessions/archive/`.
- Keep `docs/decisions.md` as an index, not the full log.
- New major decisions get a dedicated `docs/decisions/LNNN-short-slug.md` file
  plus one index row.
- Docs sweeps should preserve decisions and lessons before compressing active
  context.
