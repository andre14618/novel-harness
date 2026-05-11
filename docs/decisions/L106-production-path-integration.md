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
amended_by:
  - L107
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

Amended 2026-05-11 by L107: one-off experiments should be thin wrappers around
production modules and production-compatible artifacts wherever possible. Avoid
POC-to-main loops; integrate the reusable behavior into the production path
first, behind default-off controls or diagnostics when needed.

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
Initial scene-semantic replay on the same artifact used whole-chapter prose as
the judge excerpt and found sceneDramaturgy clean (10/10 SCENE-3) but
endpointLanding weak (mean 2.20; four lows, all chapter 1). Corrected replay
now prefers captured per-scene `beat-writer` calls via `llm_calls.scene_id`;
on `p1-allow-brief-1778447459` that reduced endpointLanding lows to 1/10 while
sceneDramaturgy remained 10/10 clean. The remaining lever is upstream
endpoint/turn quality on the actual low scene, not deterministic prose
compaction.

The production drafting evidence harness now accepts opt-in
`--scene-semantic-review` telemetry. It calls the production replay evaluator
after each arm, writes `output/scene-semantic-review/<target-prefix>/<arm>/`
artifacts, and prints per-dimension low counts. This preserves the calibrated
POC judge shape as fail-open production evidence without making it a drafting
gate or adding another POC runner.

The same harness now writes a durable top-level report under
`output/drafting-isolated/<target-prefix>/` by default. That report records
Drafting Evidence Source hygiene, run knobs, per-arm word/semantic telemetry,
and baseline deltas so production-path evidence does not depend on console
memory or scattered sidecars.

Scene-semantic replay now also writes `scene-semantic-readiness.{json,md}`
sidecars. These convert low semantic rows into the existing Plan Readiness
aggregate shape with exact scene, obligation, character, world-fact,
scene-turn, thread, promise, payoff, and source IDs when available. When replay
is run with `--persist`, those lows import as open Plan Readiness items through
the shared target-hash/staleness importer by default; `--no-readiness-import`
keeps the run artifact-only. They remain manual review inputs only: no proposal
creation, plan mutation, or drafting gate occurs unless an operator explicitly
uses the Plan Readiness path.

The production planner-quality diagnostic can now emit and import the same
aggregate shape for upstream endpoint/scene-turn weaknesses via
`--readiness-json` and `--import-readiness`. This puts deterministic planning
issues into the same manual review queue before drafting, without adding a POC
runner or turning diagnostics into blockers.

Existing production readiness items can now be acted on through
`diagnostics:plan-readiness-apply`, which consumes an explicit operator plan
and calls the normal Plan Readiness routes for dispositions or manual
`planning_edit` proposal creation. It replaces the disposable data-loop as the
forward operating path for real novels. The data-loop now requires
`--allow-disposable-data-loop` and is reserved for deliberate bridge smoke
tests on disposable planner data.

Existing Plan Readiness-compatible JSON sidecars can be imported directly with
`diagnostics:plan-readiness-import`, so production review can reuse evaluator
artifacts without rerunning judges. Checker/continuity blocker evidence can
also be converted with `diagnostics:checker-readiness`; blocker-severity
findings import unless polarity is explicitly positive, while warnings remain
opt-in. Both commands create only open manual review items.

`diagnostics:plan-readiness-review-plan` now turns those open items into a
Markdown review packet and an apply-compatible JSON scaffold. The generated
actions default to `deferred` and must be edited with operator judgment before
non-dry-run apply.

The historical `poc/scene-first-novella` runner now requires
`--allow-disposable-poc` for new runs and its README points operators to the
production drafting/semantic/readiness commands. Capture-only repair remains
available for existing artifacts.

The historical `diagnostics:corpus-recreation-poc` generator now also requires
`--allow-disposable-poc` before writing new output. Its artifacts remain useful
for corpus-method evidence and downstream artifact-analysis commands, but new
corpus recreation generation is an explicit disposable experiment, not the
main production lane. The production lessons already absorbed from that lane
include exact-ID character context defaults and the writer-context/readiness
telemetry path.

The `eval:fact-role-context-live-ab` runner now requires
`--allow-disposable-ab` before cloning novels into legacy and role-aware arms.
Fact-role-aware context remains an A/B-only hold under L82; new evidence must be
deliberately disposable and cannot be mistaken for a production path.

The semantic-gate baseline/matrix/cohort runners now require explicit
disposable flags for live clone-producing runs:
`--allow-disposable-baseline`, `--allow-disposable-matrix`, or
`--allow-disposable-cohort`. Matrix/cohort children propagate the narrower
child flags automatically. Summary-only cohort aggregation remains read-only.
A fast-tier disposable-runner control test now covers the known output-producing
POC/disposable command surfaces so these guards are not memory-only policy.

The first production-path operator loop on `p1-allow-brief-1778447459`
dispositioned superseded whole-chapter semantic lows, created two manual
planning edits, approved them through the normal planning-proposal route, and
reran `drafting-brief-v1` as `p1-ready-brief-1778451217-drafting-brief-v1`.
The rerun stayed length-safe (4029/3000 = 1.34x) with 0 prose-semantic lows,
but scene-semantic replay regressed to endpointLanding lows 6/10 and one
sceneDramaturgy low. It also surfaced a continuity blocker around personal
versus sovereign debt. Treat this as evidence that the next production-path
work is plan consistency plus scene-local endpoint landing, not prose
compaction.

That rerun evidence has now been imported into the production Plan Readiness
queue: seven scene-semantic items from the replay sidecar plus one
`CONTINUITY-BLOCKER` from checker evidence. All eight are open review items;
none created proposals or mutated plans during import. A review-plan scaffold
for those eight items was generated and dry-ran through
`diagnostics:plan-readiness-apply` with 8/8 matches and 0 errors.

The next production operator loop edited those eight readiness actions with
real judgments, applied them through `diagnostics:plan-readiness-apply`, and
approved seven resulting `planning_edit` proposals through the normal proposal
route; the duplicate target scene item stayed deferred. A comparable production
rerun (`p1-ready-loop3-1778454964-drafting-brief-v1`) completed both chapters:
3546/3000 words = 1.18x, plan/continuity passed, no exhaustions,
prose-semantic rows=8 with 0 lows/0 errors, sceneDramaturgy 10/10 clean, and
endpointLanding lows reduced to 2/10. The remaining lows are scene-local
endpoint questions, not evidence for deterministic prose compaction.

That rerun also exposed and exercised a production repair slice: exact adjacent
duplicate paragraph/sentence removal now lives in `src/lint/integrity.ts`, is
traced as `prose-integrity-repair` with `kind: "duplicate-integrity"`, and runs
before drafting retries or Plan-Assist exhaustion. Chapter 1 used this
deterministic repair and approved; chapter 2 still used the existing L70b
per-beat integrity settle for non-exact duplicate fragments.

A follow-up operator pass imported the two remaining endpointLanding lows from
`p1-ready-loop3-1778454964-drafting-brief-v1`, created and approved two
additional `planning_edit` proposals, and reran as `p1-ready-loop4-1778455655`.
That rerun is negative and not comparable promotion evidence: it cloned from a
completed drafted artifact, so generated draft facts/states leaked into the
new source state. It also worsened length (4375/3000 = 1.46x) and
endpointLanding lows (3/10). Treat this as evidence-hygiene signal rather than
as proof that the two endpoint edits should be promoted or repeated blindly.

To prevent this failure mode from recurring, Drafting Evidence Source hygiene
now lives in a shared production module instead of only in the isolated runner.
`test-drafting-isolated` rejects sources that already have `chapter_drafts`,
terminal phases, or advanced `current_chapter` values unless the operator
explicitly passes `--allow-drafted-source`; Plan Readiness review/apply reports
surface the same clean-source assessment as advisory telemetry. Clean
production evidence should start from a pre-drafting source; contaminated
replay is an explicit investigation mode.

`diagnostics:planning-edit-replay` now provides the bridge from a drafted
evidence artifact back to a clean Drafting Evidence Source. It reads approved
`planning_edit` envelopes from source Novel artifacts, recreates equivalent
manual planning proposals on the clean target Novel through the normal
planning-proposal route, and can optionally approve them with
`resolvedBy=script`. This keeps projected fixes in production proposal and
lineage records instead of relying on direct DB mutation or POC-only replay
scripts.

Live application validated the bridge on P1 evidence. Clean clone
`p1-clean-replay-1778457296` was created from the pre-drafting source
`p1-full-brief-1778446488-drafting-brief-v1`, then replayed the 11 approved
`planning_edit` envelopes from `p1-allow-brief-1778447459`,
`p1-ready-brief-1778451217-drafting-brief-v1`, and
`p1-ready-loop3-1778454964-drafting-brief-v1`. Replay created and approved
11/11 target proposals with parent lineage and zero errors. Source hygiene after
replay stayed clean: 2 Chapter Plans, 0 drafts, 0 facts, 0 character-knowledge
rows.

The resulting production drafting run
`p1-clean-rerun-1778457296-drafting-brief-v1` approved both chapters with no
Plan-Assist exhaustion. Durable report:
`output/drafting-isolated/p1-clean-rerun-1778457296/drafting-isolated-report.json`.
Key telemetry: 3742/3000 total words (mean ratio 1.25), writer-brief events
11/11 enabled, prose semantic 0/8 lows and 0 errors, sceneDramaturgy 10/10
SCENE-3, endpointLanding 1/10 low and 0 errors. The remaining endpoint low is
ch2 scene 1, where the judge found the scene ended as setup rather than a
concrete consequence. `allow-entities` did not reproduce in this clean run; keep
that replay opportunistic rather than manufacturing a separate path.

A later clean-source cohort exercised the production fixed-plan harness across
`baseline`, `drafting-brief-v1`, and `scene-call-v1` from the same
`p1-clean-replay-1778457296` source. Durable reports:
`output/drafting-isolated/p1-arm-cohort-1778464932/drafting-isolated-report.json`
and `output/drafting-isolated/p1-arm-cohort-1778464932/scene-semantic-compare.json`.
The automatic comparison sidecar aligned 33 scene-semantic rows per candidate.
`drafting-brief-v1` was the strongest current arm: 3731/3000 words (mean ratio
1.24), prose semantic 0/8 lows, planning-context gaps 0, scene-semantic lows
1/33, and character/world lows 0. Baseline remained much longer at 7703/3000
words with endpoint lows 3/10 and `sceneContract:missing_downstream`;
`scene-call-v1` stayed long at 7142/3000 and introduced one worldFactPressure
low. This strengthens `drafting-brief-v1` as the next production candidate, but
does not by itself flip defaults because the sidecar verdict is still mixed and
the evidence is one clean P1 cohort.

The next clean-source replication on LitRPG source `novel-1777777292668` was a
hold signal rather than a promotion signal. Cohort
`litrpg-brief-cohort-1778467196` produced durable report
`output/drafting-isolated/litrpg-brief-cohort-1778467196/drafting-isolated-report.json`.
Baseline exhausted at chapter 1 with 5182/1200 words and scene-semantic lows
11/34. `drafting-brief-v1` controlled length better and reached chapter 2, but
still exhausted there at 3910/2700 words with scene-semantic lows 30/68,
including sceneDramaturgy lows 13/23 and characterMateriality lows 7/11. The
comparison sidecar is now marked `incomplete` when missing rows exist; this run
has 34 candidate-only rows because baseline never reached chapter 2. Treat this
as evidence that writer briefs need a scene-turn/temporal-anchor/materiality
floor on high-scene-count plans before any default flip.

The residual endpoint low was inspected through the production Plan Readiness
path rather than by editing POC artifacts. That exposed a real integration gap:
readiness apply could create scalar `field_replace` proposals but not full
scene-contract replacements. The production Plan Readiness route and
`diagnostics:plan-readiness-apply` now support `beat_replace` proposals, and
`beat_replace` may preserve the same durable scene/beat ID when replacing the
contract. The edit was tested on `p1-clean-replay-1778457296` as proposal
`planning_edit:p1-clean-replay-1778457296:9e20cdbf6d622308`.

Live evidence rejected that edit as a promotion move:
`p1-clean-rerun2-1778457296-drafting-brief-v1` approved both chapters but
worsened to 4061/3000 words (mean ratio 1.35) and endpointLanding lows 3/10,
while prose semantic stayed 0/8 lows and sceneDramaturgy stayed 10/10 clean.
The scene-contract edit was reverted through follow-up production proposal
`planning_edit:p1-clean-replay-1778457296:a8135ebc13ec3d47`, preserving the
clean source's stronger prior plan state. Treat the remaining single
endpointLanding low as diagnostic residue unless a new upstream planning
hypothesis explains it; do not keep compacting prose or hand-tuning the same
scene contract.

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
