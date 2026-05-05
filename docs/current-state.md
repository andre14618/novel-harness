---
status: active
updated: 2026-05-05
role: canonical-current-truth
archive: archive/current-state-2026-05-04-full.md
---

# Current State

This is the canonical live-context entrypoint for agents. If another document
disagrees with this file about active architecture, runtime posture, or current
verification gates, this file wins.

Historical detail moved to `docs/archive/current-state-2026-05-04-full.md`.

## Context Pack

Read these first, in order:

- `AGENTS.md` — agent navigation and repository context rules.
- `docs/current-state.md` — live architecture and active constraints.
- `docs/decisions.md` — decision index with links to detailed records.
- `docs/sessions/lane-queue.md` — active lane and next work only.

Use deeper docs only when linked by the context pack or when the code path
requires them.

## Operating Boundary

Novel Harness owns novel-planning, writing, checking, revision, evaluation,
proposal workflows, telemetry, and operator-facing review surfaces.

Novel Harness does not own a custom autonomous coding supervisor. Engineering
work uses Claude Code, OpenCode, Codex, or equivalent external coding harnesses.
Repo-local agent scripts are support tooling, not a replacement control plane.

## Active Architecture

- World-bible/canon work flows through the Canon substrate and proposal review
  path, not direct planner auto-commit by default.
- Collaborative proposal workflow Phases 3-6 are implemented: artifact patch
  cards, planning snapshots, editorial proposal shapes/routes, and the
  ApprovalPolicy engine.
- Phase 7 is active: replay and promotion evidence for ApprovalPolicy changes.
- Runtime default remains manual review. Assisted autonomy is limited to
  deterministic mechanical prose edits. Autonomous approval is limited to
  scheduler/eval lanes for low-risk artifact/prose proposals.
- Canon and planning edits remain manual by default through `manualKinds:
  ["canon_update", "planning_edit"]`.
- Accepted autonomy posture: keep manual review as the product default, allow
  deterministic mechanical assisted paths only with local replay/guard evidence,
  and do not expand Canon autonomy without a new explicit decision.
- Local UI auth is bypassed by default for the foreseeable browser-testing
  lane. Set `ORCHESTRATOR_AUTH_ENABLED=1` to restore orchestrator API/UI auth.

## Proposal Model

A proposal is a durable change request, not the change itself. Producers can be
operator-triggered tools, deterministic checks, LLM/checker modules,
planner/Canon flows, or scheduler/policy lanes. The fictional author is not
the producer; the producer is the Novel Harness subsystem that emitted the
review item.

Current kinds:

- `artifact_patch`: proposed artifact change.
- `prose_edit`: proposed draft-text edit.
- `editorial_flag`: review item for a likely draft issue.
- `canon_update`: proposed Canon substrate update.
- `planning_edit`: proposed planning artifact edit for scalar
  chapter/beat/obligation/directive/character/world/spine fields, plus
  structural beat and beat-obligation replace/reorder actions. Planning edits
  remain manual by default.

Every proposal should preserve producer, rationale, evidence, affected surface,
precondition hash/generation, policy recommendation, resolution actor, and audit
outcome. See `docs/decisions/L077-proposal-provenance-checker-attribution.md`.

## Active Phase 7 State

Phase 7 has a read-only replay harness and local promotion guard:

- Pure replay metrics: `src/canon/approval-policy-replay.ts`.
- DB replay loader: `src/db/approval-policy-replay.ts`.
- Downstream outcome source: `sql/042_proposal_resolution_outcomes.sql` and
  `src/db/proposal-resolution-outcomes.ts`.
- Impact/correlation source:
  `sql/043_proposal_resolution_impacts.sql`,
  `sql/044_proposal_checker_observations.sql`, and
  `src/db/proposal-resolution-outcomes.ts`.
- CLI report: `scripts/approval-policy-replay-report.ts`.
- Local guard: `bun run policy:promotion-guard -- --report <report.json>`.
- Deterministic lint proposal hook: set
  `seed.pipelineOverrides.lintProseEditProposals=true` to persist fixable lint
  issues as `prose_edit` envelopes after draft save and skip inline lint apply.
- Editorial beat-coverage proposal hook: set
  `seed.pipelineOverrides.editorialBeatCoverageProposals=true` to run the
  existing validator-backed coverage producer after a chapter draft settles and
  persist uncovered beats as `editorial_flag` envelopes.
- Route-observed outcome writers exist for `prose_edit`, `artifact_patch`, and
  `canon_update` resolutions. Prose-edit checker-fire attribution exists for
  exact draft-hash matches: approve writes a draft impact context, and
  validation checks roll up `downstream_checker_fired` only when the checked
  draft hash matches that impact. Applied artifact patches now record artifact
  impact contexts with target refs and before/after hashes. Artifact checker
  observations and Canon checker attribution are backlog items until concrete
  observer sources exist.

Replay supports historical row fixtures, frozen-envelope candidate fixtures,
and generator replay for artifact patches, deterministic lint-to-prose-edit,
and frozen-output editorial beat coverage.

Promotion tiers:

- `--tier dev`: local tracer default, `minRows=1`, `minAutoPrecision=0.95`,
  zero Canon auto-approve.
- `--tier assisted`: mechanical assisted rollout, `minRows=25`,
  `minAutoPrecision=0.95`, zero Canon auto-approve.
- `--tier autonomous`: stricter scheduler/eval gate, `minRows=100`,
  `minAutoPrecision=0.98`, zero Canon auto-approve.

## Active Work

See `docs/sessions/lane-queue.md` for the current lane. As of 2026-05-05:

- Closed: test harness reliability cleanup has restored supported tiered gates.
  Direct broad `bun test` remains unsupported; use `bun run test:fast` for the
  default loop, `bun run test:db` for bounded DB smoke, and
  `bun run test:db:full` for exhaustive isolated DB integration. Phase-parity
  replay is explicit via `bun run test:replay` and currently needs a refreshed
  fixture after prompt/request drift.
- Active: authoring visibility/interactivity foundation. The traceability UI
  tracer is browser-cleared; next slices should continue closing proposal
  bypasses and improving operator-visible impact/lineage.
- First backend tracer bullet exposes read-only planning targets and
  deterministic impact preview. Write tracers add `planning_edit` envelopes for
  scalar chapter-outline fields (`title`, `purpose`, `setting`, `targetWords`)
  beat-plan fields (`description`, `kind`), and beat-obligation `text` /
  `sourceId` / `sourceKind` / `characterId` / `sourceLink` fields, plus
  planning-directive `rawNotes` / `tonalAnchors` and character-bible scalar
  fields, plus world-bible and story-spine scalar fields, with stale
  preconditions, approve/reject/modified resolution, and lineage recording.
- Planning-edit create/apply responses now include deterministic before/after
  diffs, and `GET /api/novel/:novelId/planning-proposals/:envelopeId/diff`
  exposes read-only diff, current target staleness, and impact-preview data for
  Planning Studio UI.
- Initial Planning Studio UI is browser-tested on disposable novel
  `codex-planning-studio-1777948116315`. Covered target navigation, impact
  preview, proposal creation/approval evidence, pending stale diffs,
  approved/rejected status tabs, resolved-target copy, route links to Pipeline /
  Snapshot / Canon Queue, and mobile rendering. That pass used legacy
  repository-root `planning-studio-*` screenshots; new browser evidence belongs
  under `output/playwright/`.
- Planning Studio now also supports grouped proposal review, queue impact
  detail, and edit-before-approve modified resolution. Browser evidence on
  disposable novel `codex-planning-modified-1777980329324` covers live create,
  edit, resolve-modified, modified-tab diff display, and mobile rendering.
  Modified proposals now use `modified_payload` for their read-only diff.
- Studio artifact preview inline edits for supported world/character/spine
  scalar fields now queue `planning_edit` envelopes instead of directly
  mutating artifacts. Unsupported preview fields render read-only, and legacy
  direct artifact `PUT` routes are disabled by default unless explicitly
  re-enabled with `ORCHESTRATOR_ALLOW_DIRECT_ARTIFACT_PUT=1`. Browser evidence
  for disposable novel `codex-traceability-ui-1778003397963` is under
  `output/playwright/2026-05-05/artifact-preview-planning-edit-codex-traceability-ui-1778003397963/`.
- Production UI is guarded against reintroducing direct artifact PUT callers by
  `scripts/lint/invariants-check.ts`; route-shaped orchestrator tests with
  extra suffixes are classified into the DB/integration tier.
- Chapter-outline saves now persist enriched stable IDs for chapters, beats,
  source items, characters, and obligations; checker findings carry additive
  stable refs on the current high-value surfaces before broader traceability UI.
- Plan-assist `edit-plan` and `override` remain direct manual-gate actions, but
  drafting now records `planning_mutation_lineage` sourced from
  `chapter_exhaustions` and preserves chapter IDs across replacement outlines.
- Stable-ref checker coverage now includes chapter-plan checker deviations:
  drafting resolves `beatId` from `outline.scenes[beat_index].beatId` without
  changing the legacy `beat_index` contract.
- Beat-level LLM telemetry now persists `llm_calls.beat_id` for beat writer,
  targeted beat rewrites, adherence checks, and halluc-ungrounded checks.
- Halluc-ungrounded issue metadata now carries exact-match `entityRefs[]` for
  `character`, `world_system`, and `culture` targets when deterministic
  resolution is possible, and accepted beat-check blockers preserve the
  containing `beatId`.
- `validateChapterDraft()` now emits additive structured `findings[]` with
  stable chapter refs on all findings and stable beat refs for validation-mode
  beat keyword checks while preserving legacy blocker/warning strings.
- Drafting validation rewrite routing prefers those structured finding
  codes/refs and keeps blocker-string routing only as a compatibility fallback.
- `GET /api/novel/:novelId/chapter-health` now exposes read-only chapter
  health over current outlines/drafts by recomputing deterministic validation
  and attaching open issues, pending editorial/prose proposals, trace events,
  checker calls, and checker-observation refs.
- `/app/chapter-health/:novelId` renders that report with status filters,
  chapter cards, refs, and trace/proposal evidence. Browser evidence for
  disposable novel `codex-chapter-health-ui-1778000670807` is under
  `output/playwright/2026-05-05/chapter-health-codex-chapter-health-ui-1778000670807/`.
- `GET /api/novel/:novelId/traceability/chapter/:chapterNumber` now exposes a
  read-only ID-first chapter trace: beat refs, obligation refs, source registry
  links, and writer/checker/event evidence with explicit positional fallback.
- `/app/traceability/:novelId/chapter/:chapterNumber` renders the chapter trace
  with source registry, upstream targets, writer/checker/event evidence, and
  proposal/outcome/observation/lineage evidence. Browser evidence for
  disposable novel `codex-traceability-ui-1778003397963` is under
  `output/playwright/2026-05-05/traceability-codex-traceability-ui-1778003397963/`.
- Deterministic lint-generated `prose_edit` span proposals now carry optional
  `beatRef` metadata when drafting can map the span through the exact
  `beatProses` join to an enriched outline beat id.
- Target links are derived from stored artifacts, and approved
  scalar/text/link/directive/character/world/spine planning edits now persist
  old-ref/new-ref mutation lineage. Structural proposal action routes now
  create/apply beat and beat-obligation replace/reorder edits, and structural
  lineage records exact-ID reorder plus same-slot replacement supersession.
  Planning Studio now exposes those structural beat/obligation replace/reorder
  actions through explicit action-aware controls.
- Structural Planning Studio UI was browser-tested on disposable novel
  `codex-structural-ui-1777995796883`. Evidence covers load, beat reorder
  approve, beat replacement reject, obligation replacement edit-before-modified,
  obligation reorder approve, status tabs, target-refresh recovery after stable
  ID replacement, console/network capture, and local auth bypass.
- Closed: Playwright MCP browser preflight for proposal UI passed on disposable
  novel `codex-ui-preflight-1777936779921`. Covered Canon proposal review load,
  approve/reject, modify-with-edits, status tabs, bulk approve/reject, and
  Studio artifact patch proposal cards for pending load, single resolve, stale
  regeneration surface, bulk actions, and audit history.
- That pass used legacy repository-root `canon-*` and `artifact-*` screenshots;
  new browser evidence uses the `output/playwright/` session directory
  convention.
- UI fixes from clearance: artifact proposal resolve now preserves structured
  stale-precondition `409` responses for the regenerate UI, and the stale Canon
  proposal browser-untested footer copy was removed.
- Phase 7 replay/promotion foundations remain available through the local
  guard and are no longer the active implementation lane.
- Backlog: artifact/Canon checker observation sources after real observers
  exist.
- On hold indefinitely: external CI for `policy:promotion-guard`. Local guard is
  the supported safety gate until a concrete CI need is reopened.

## Authoring Gates

- UI-facing work requires Playwright MCP evidence before handoff. Use
  `docs/ui-work-gate.md` and
  `docs/how-to/playwright-mcp-browser-testing.md`.
- Browser evidence belongs in
  `output/playwright/<YYYY-MM-DD>/<surface-or-lane>-<novelId-or-short-slug>/`;
  close the Playwright tab/session and stop any test-only app server after the
  pass completes.
- `bun run ui:preflight -- --surface <surface> --novel <id> --url <path>` can
  create that evidence directory, runbook, console/network placeholders, and
  manifest before Playwright MCP browser actions.
- Craft heuristics that alter planner, writer, or checker behavior must prove
  value in diagnostic-only or A/B-gated form before production-default wiring.
  See `docs/decisions/L079-authoring-harness-eval-gates.md`.
- Test and invariant work should use the dedicated role contract in
  `docs/test-invariant-agent.md`.

## Verification Gates

Supported local gates:

```bash
bun run test:fast
bun run test:db
bun run test:db:full
bun run test:archive
./node_modules/.bin/tsc --noEmit
git diff --check
```

Every slice still needs targeted verification for the behavior it changed.
`test:db:full` is a broad sweep, not a replacement for narrow tests.

Replay fixture parity is opt-in:

```bash
bun run test:replay
```

As of 2026-05-05, `test:replay` fails with `ReplayTransport miss:
1dd73b5c320260717ff5bfefd77593cc` for `world-builder`, so the phase-parity
fixture must be re-recorded in its own commit before treating replay as green.

## Documentation Rules

- Keep this file under 300 lines.
- Keep `docs/decisions.md` as an index, not the full log.
- Archive historical snapshots instead of deleting them.
- New major decisions should get a dedicated file under `docs/decisions/` and
  a one-line index entry in `docs/decisions.md`.
- Run `bun run docs:weight` before closing docs-heavy work.

## Browser Preflight

Use `docs/how-to/playwright-mcp-browser-testing.md` for agent-run UI evidence.
If Playwright MCP is unavailable in the active session, report that browser
preflight is blocked rather than substituting code inspection for screenshots.
