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
