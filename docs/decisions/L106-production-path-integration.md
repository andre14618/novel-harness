---
status: active
date: 2026-05-10
role: decision-record
supersedes:
  - L100 open-ended POC active-lane posture
amends:
  - L101
  - L103
  - L104
  - L105
---

# L106: Production Path Integration Over POC Branching

## Decision

Validated POC learnings now integrate into the main production path instead of
continuing as parallel workflow surfaces.

Future work should target production modules, production runners, production
trace contracts, and production review artifacts by default. POC artifacts
remain useful as evidence, fixtures, and historical comparison points, but they
are not the forward operating lane unless the user explicitly asks for a
disposable experiment.

## Integration Contract

Each POC-derived capability should be classified before more work is added:

- **Promote:** move the behavior into a production module behind an existing or
  explicit control, with tests and telemetry.
- **Absorb:** keep the insight but express it through production prompts,
  context builders, diagnostics, or review surfaces.
- **Archive:** preserve the artifact as evidence only.
- **Delete later:** mark redundant experimental substrate after production
  parity exists.

Do not add another long-lived POC runner, prompt branch, state mapper, checker,
or review format when the same question can be tested through the production
drafting/planning/evaluation path.

## Current Application

The scene-first and writer-context evidence should feed a production drafting
brief path, not another `poc/scene-first-novella` branch. That brief must be a
view over the full writer context surface:

- Character Profiles/Snapshots/context capsules.
- World Bible/setting context.
- Story Spine and POV/worldview context.
- Reader-info state, transition anchors, refs, obligations, scene contracts,
  endpoint-critical fields, and trace IDs.

Scene-first runtime flags remain default-off until a production decision flips
them, but the next implementation lane should exercise production code and
production telemetry rather than a separate POC workflow.

The first production integration slices add a default-off writer drafting brief
and a production `writer-context` telemetry report. The report is an evidence
artifact for real drafting runs: it audits Character Profiles/Snapshots/context
capsules, World Bible/setting, Story Spine, reader-info state, refs,
obligations, scene contracts, drafting-brief mode, and prompt-size deltas.

Initial P4 smoke evidence (`p4-brief-1778445285-drafting-brief-v1`) supports
continuing this lane: 3666/3300 words = 1.10x, prose-semantic rows=8 with
0 lows and 0 errors, and drafting-brief telemetry on 11/11 writer-context
events. It is not a promotion result because the source plan had
sceneContract=0/11 and refs=0/11 in the telemetry report.

Contract-bearing P1 smoke evidence (`p1-contract-1778445814`) strengthens the
signal. On the same `scenePlanContractV1=true` source, baseline drafted
7335/3000 words = 2.45x, `contract-render-only` drafted 7238/3000 = 2.41x,
and `drafting-brief-v1` drafted 4115/3000 = 1.37x. All three arms had
prose-semantic rows=8 with 0 lows and 0 errors; the brief arm traced scene
contracts on 10/10 writer-context events. This supports production brief
framing over simply adding more full-context contract text, but it remains
writer-only evidence until checked by full production/endpoint gates.

A full production-path P1 brief smoke (`p1-full-brief-1778446488`) drafted
chapter 1 at 1885/1500 and passed plan + continuity checks, then paused at a
pending Plan-Assist gate for two halluc-ungrounded findings. That makes the
next integration blocker checker/entity review handling, not prompt length
control.

Plan-Assist now has an `allow-entities` decision for that blocker class. It
appends reviewed walk-on/lore terms to the affected scene's
`obligations.allowedNewEntities`, persists the chapter outline, records
planning lineage against the `chapter_exhaustions` row, and restarts the
attempt. Halluc-ungrounded remains a blocker by default; only reviewed entities
enter the grounded surface.

A follow-up full production-path P1 brief smoke
(`p1-allow-brief-1778447459`) completed without firing Plan-Assist:
ch1 2092/1500 = 1.39x, ch2 2065/1500 = 1.38x, both plan checks passed, checker
blockers=0, prose-semantic rows=8 with 0 lows/0 errors, writer-context brief
telemetry=12/12, scene contracts=12/12. This strengthens the production brief
signal, but it does not count as live `allow-entities` branch evidence because
the original halluc-ungrounded blocker did not reproduce on that attempt.
Scene-semantic replay on the same artifact found sceneDramaturgy clean
(10/10 SCENE-3) but endpointLanding still weak (mean 2.20; four lows, all
chapter 1), so the next production-path lever should be upstream endpoint/turn
quality rather than deterministic prose compaction.

The production drafting evidence harness now accepts opt-in
`--scene-semantic-review` telemetry. It calls the production replay evaluator
after each arm, writes `output/scene-semantic-review/<target-prefix>/<arm>/`
artifacts, and prints per-dimension low counts. This preserves the calibrated
POC judge shape as fail-open production evidence without making it a drafting
gate or adding another POC runner.

Scene-semantic replay now also writes `scene-semantic-readiness.{json,md}`
sidecars. These convert low semantic rows into the existing Plan Readiness
aggregate shape with exact scene, obligation, character, world-fact,
scene-turn, thread, promise, payoff, and source IDs when available. When replay
is run with `--persist`, those lows import as open Plan Readiness items through
the shared target-hash/staleness importer by default; `--no-readiness-import`
keeps the run artifact-only. They remain manual review inputs only: no proposal
creation, plan mutation, or drafting gate occurs unless an operator explicitly
uses the Plan Readiness path.

## Evidence And Verification

Production-path integration needs:

- A named phase/surface and rollback/control point.
- Targeted tests for the production module being changed.
- Trace/review artifacts that show the full context surface, not just the newest
  experimental field.
- `./node_modules/.bin/tsc --noEmit` for TypeScript changes.
- `bun run test:fast` when production runtime behavior changes.
- `bun run docs:weight` and docs impact checks for docs-heavy slices.

Semantic judges and POC reports remain advisory unless a later production
decision promotes a calibrated signal to a gate.

## Implications

- L100 remains historical guidance for explicitly requested disposable POCs, but
  it is no longer the active lane posture.
- L101 still authorizes aggressive evidence loops, now aimed at production-path
  integration and telemetry rather than adding parallel POC substrates.
- L103-L105 promotion holds still block default flips; they do not require more
  POC-only implementation before production-path integration can proceed.
- The active lane should reduce duplicate runners and prompts over time by
  absorbing useful evidence surfaces into production drafting, planning,
  checking, and evaluation modules.
