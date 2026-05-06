---
status: recorded
updated: 2026-05-06
role: session-record
---

# Semantic Gate Diagnostics — 2026-05-06

This record captures why the semantic-gate diagnostic slice happened, what
commits landed, what evidence was produced, and what it means for the next
authoring-harness work. It is not an active single-lane contract.

## Why

The capped fact-role live A/B proved role-aware filtering mechanically worked,
but the product outcome was still `hold`: both arms stopped at chapter-2
Plan-Assist Gates, and role-aware regressed hallucination blockers and cost.
That made the next useful move diagnostic, not another writer/checker prompt
change.

The immediate question was whether the failure pattern was primarily:

- Chapter Plan shape: too many planned Beats for the target length.
- Writer expansion: too many prose words per planned Beat.
- Plan Adherence drift: prose changing or omitting planned actions.
- Continuity/checker behavior: blockers or warnings driving gates.
- Plan-Assist behavior: pending or resolved gate lineage.

## Commits

- `5262d62 feat: add writer expansion diagnostic`
  - Added `bun run diagnostics:writer-expansion -- --novel <id>`.
  - Separates over-planned Chapter Plans from writer over-expansion.
- `1df18f6 feat: add semantic gate diagnostic`
  - Added `bun run diagnostics:semantic-gate -- --novel <id>`.
  - Rolls up outline shape, draft expansion, Plan Adherence drift,
    checker blockers, and Plan-Assist lineage by chapter.
- `0d97ed8 refactor: share beat count assessment`
  - Moved beat-count assessment into `src/harness/beat-counts.ts` so
    diagnostics and planning use the same threshold math.
- `c7c280a feat: persist semantic gate evidence in fact-role ab`
  - Fact-role live A/B summaries now include semantic-gate evidence while
    disposable clone rows still exist.
- `a761935 feat: add semantic gate candidate scanner`
  - Added `bun run diagnostics:semantic-gate-candidates -- --limit N`.
  - Ranks novels by pending Plan-Assist Gates, checker blockers, Plan
    Adherence drift, writer expansion, outline shape, and missing drafts.
- `15e5ac6 feat: tag checker finding polarity in diagnostics`
  - Checker-warning diagnostics now classify findings as negative, positive, or
    ambiguous so consistency-shaped blockers are visible before gate changes.
- `99ae892 feat: add polarity filters to continuity panel`
  - Continuity gray-zone extraction now carries finding polarity and supports
    `--polarity positive` samples for adjudicating consistency-shaped blockers.
- `4bceed5 feat: aggregate continuity labels by polarity`
  - Labeled continuity-panel summaries now include per-polarity TP/FP/AMB rates.
- `7989118 test: sync planning beats default variant`
  - Resynced the phase-eval `planning-beats/default.md` control to the live
    `/400` minimum and `/325` recommended beat-count policy.
- `0ca7d5e feat: filter continuity panel by stratum`
  - Continuity gray-zone extraction now supports `--agent` and `--severity`
    filters so support-echo samples can target one checker stratum.
- `f97c5a9 feat: refine checker polarity diagnostics`
  - Positive wording inside explicit violation language now becomes ambiguous
    rather than a support-echo candidate.
- `17ec6a6 feat: discount support echo in gate ranking`
  - Candidate ranking now reports raw checker blockers and effective checker
    blockers after diagnostic support-echo discount. This changes only the
    read-only scanner score, not runtime gates.
- `048b1fe feat: add gate candidate diagnostic lens`
  - Candidate ranking now emits a primary diagnostic lens and ordered source
    diagnostic commands so follow-up work starts from the likely evidence path.
- `00d80e8 test: refresh phase parity fact roles`
  - Refreshed the replay fixture snapshot for intended fact-role persistence
    (`role: "operational"`) and verified `bun run test:replay` green.
- `1d0ce57 test: assert phase replay shape`
  - Phase-parity replay now asserts the small fixture remains at 5 planned
    beats, has no over-planned chapter, and avoids severe over-target output.
- Deterministic quote-integrity repair slice
  - Added `repairMechanicalQuoteIntegrity()` for local curly quote orientation
    mistakes that the integrity detector already flags and can safely balance.
  - Drafting now applies that repair before prose-integrity retry/gate logic,
    saves the repaired draft, and emits `prose-integrity-repair` trace evidence.
  - This does not relax malformed-prose blocking and does not rewrite Beats or
    Chapter Plans.
- Baseline action-evidence / JSONB telemetry slice
  - Semantic-gate baseline reports now include an `Action Evidence` section for
    targeted beat rewrites, deterministic/LLM lint actions, prose-integrity
    repairs, Chapter Plan Reviser rows, and Plan-Assist gates.
  - Baseline reports also include proposal-envelope totals/samples and can opt
    into continuity review flags with `--continuity-editorial-flag-proposals`.
  - `diagnostics:action-evidence -- --novel <id>` exposes the same action
    evidence directly for existing novel runs without rerunning a baseline.
  - Semantic-gate candidate rows now print the action-evidence command next to
    the primary semantic-gate command so follow-up evidence is discoverable.
  - Baseline reports preserve fallback Plan-Assist stdout evidence when a DB
    consumer has not loaded unresolved gate details.
  - Plan-Assist unresolved-deviation readers now use shared JSONB normalization
    so reports handle both native JSON arrays and string-returning DB clients.
- Plan-check drift witness telemetry slice
  - Drafting now emits trace-only `plan-check-drift-witness` events when
    targeted plan-check settle still fails after rewrite passes.
  - The payload records final unresolved deviations with stable beat refs,
    repeat counts across plan-check attempts, and the terminal settle outcome.
  - Chapter Health and action-evidence diagnostics include the witness event;
    no writer/checker prompt, retry, reviser, or gate behavior changes.
- Candidate ranking calibration slice
  - Semantic-gate rollups now split raw checker blockers from load-bearing
    blockers; continuity blockers remain visible but diagnostic-only per L84.
  - Candidate scoring now boosts Plan-Assist only for pending gates, not
    orphaned/resolved gate history.
  - Fresh top-20 scan shifted from three critical candidates to zero critical
    and five medium candidates; former top rows were demoted because plan-check
    passed, gates were not pending, and continuity blockers were diagnostic.
- Baseline report wording calibration
  - Halluc-ungrounded baseline counts are labeled as raw pre-retry checker
    output so completed runs are not misread as approving accepted blockers.
- Risk-score explainability slice
  - Matrix summaries now persist `riskBreakdown[]` next to `riskScore`, and
    cohort aggregation rolls those components into top risk drivers.
  - Matrix report markdown and the read-only Matrix UI show the weighted
    drivers behind each score.
- Durable candidate artifact slice
  - `diagnostics:semantic-gate-candidates` now accepts `--output <path>` and
    writes cohort-readable JSON while preserving existing stdout behavior.
- Cohort artifact viewer slice
  - Added read-only cohort artifact routes and UI at
    `/app/semantic-gate-cohort-matrix` and
    `/app/semantic-gate-cohort-matrix/:runId`.
  - Summary-only cohort aggregation now derives the chapter count from the
    source matrix artifact when all summaries agree.

## Evidence

Focused tests passed for the new diagnostics and A/B integration. The post-slice
supported fast tier passed:

```bash
bun run test:fast
```

Additional checks passed during the slice:

```bash
./node_modules/.bin/tsc --noEmit
bun run test:replay
bun run docs:weight
git diff --check
```

Current DB smoke:

```bash
bun run diagnostics:semantic-gate -- --novel fantasy-system-heretic
bun run diagnostics:semantic-gate-candidates -- --limit 5 --scan-limit 20
```

Local DB-backed diagnostics in this workspace expect a listener on
`127.0.0.1:15432`, loaded from `.env` as `ORCHESTRATOR_DB_URL`. If that
listener is down, Bun SQL fails as `ERR_POSTGRES_CONNECTION_CLOSED` before the
diagnostic can produce evidence. For this session, remote LXC Postgres was
active and a foreground SSH tunnel restored local DB access for the fresh scan.

Observed signals:

- Chapter 1: `outline_shape`, `writer_expansion`, `plan_assist_gate`
- Chapter 2: `no_draft`, `outline_shape`, `plan_assist_gate`
- Chapter 3: `no_draft`, `outline_shape`
- Candidate scan returned three `critical` novels and two `medium` novels from
  the latest 20; `fantasy-system-heretic` ranked second with one pending gate,
  one writer-expansion chapter, three outline-shape chapters, and two no-draft
  chapters.
- The top candidate (`novel-1777786463873`) had four checker blockers; two
  were positive-polarity continuity-facts blockers whose reasoning said the
  prose was consistent with the fact.
- `bun run diagnostics:continuity-grayzone-extract -- --per-stratum 2
  --polarity positive` found 45 positive-polarity continuity findings in the
  local DB, including seven continuity-facts blockers.
- Aggregate smoke over a positive-polarity sample emitted a `Per-polarity rates`
  table, so adjudicated labels can now quantify support-echo false positives.
- Prompt lint now reports zero default-drift errors for planning-beats; the
  remaining findings are pre-existing negative-prime warnings and one config
  info note.
- Tight support-echo panel:
  `diagnostics:continuity-grayzone-extract -- --agent continuity-facts
  --severity blocker --polarity positive --per-stratum 20`.
  Initial classifier returned 7 positive-polarity blockers: 3 TP / 4 FP after
  local adjudication. The refined classifier returned 4 positive-polarity
  blockers, all 4 labeled FP.
- After scanner discount, `novel-1777786463873` remained top candidate but
  reported `blockers=4` and `effectiveBlockers=2`; the two discounted blockers
  remain visible as support-echo candidates instead of disappearing.
- With diagnostic lenses enabled, the top three current candidates classify as
  `plan_shape`; direct source reports showed passing plan-adherence checks and
  severe over-planning/expansion pressure rather than active plan-drift
  evidence.
- Current phase-parity replay is green after fixture refresh and produces a
  5-beat, 1,519-word chapter, so the inspected over-planned DB candidates look
  like historical rows rather than proof that the current replay path is still
  over-planning.
- Replay now has an explicit writer-expansion postcondition in addition to the
  byte-equal snapshot, so beat-count/length regressions fail with a clearer
  signal.
- Fresh 2026-05-06 rerun through the restored DB tunnel:
  `diagnostics:semantic-gate-candidates -- --limit 5 --scan-limit 20 --json`
  again returned three `critical` and two `medium` candidates. The top three
  still classified as `plan_shape`; `fantasy-system-heretic` ranked second
  with one pending gate, one writer-expansion chapter, three outline-shape
  chapters, and two no-draft chapters.
- Fresh continuity-state warning extraction wrote an unlabeled N=50 panel to
  `output/continuity-grayzone/continuity-state-warning-n50-2026-05-06/`.
  The sample came from 581 `continuity-state/warning` findings: 3 negative, 0
  positive, 47 ambiguous. This is panel material to label next, not a
  production checker-relaxation decision.
- Scoped baseline run:
  `diagnostics:semantic-gate-baseline -- --source fantasy-system-heretic
  --chapters 2 --max-beats-per-chapter 5 --output-base
  output/evals/semantic-gate-baseline/fantasy-system-heretic-capped-20260506T-scoped`
  stopped at `integrity-exhausted` on Chapter 1 attempt 3. The final issue was
  a mechanical quote-orientation error:
  `... The margins require—“`, where the final curly quote should be closing.
  Other repair actions in the run were Plan Adherence driven: attempt 1 rewrote
  one Beat because the chapter did not reach Cassel's summons / Arbiter-office
  endpoint and omitted the emergency coins / sewer map contingency; attempt 2
  accepted a Reviser-produced Chapter Plan replacement after the prose named
  the Arbiter `Vellic` instead of planned `Cassel`. Continuity emitted warnings
  and nits only; it did not block the run.
- Regression evidence for deterministic quote repair:
  `bun test src/lint/integrity.test.ts`,
  `bun test src/phases/drafting-reviser-escalation.test.ts`, and
  `./node_modules/.bin/tsc --noEmit` passed.
- Post-repair scoped baseline:
  `diagnostics:semantic-gate-baseline -- --source fantasy-system-heretic
  --chapters 2 --max-beats-per-chapter 5 --output-base
  output/evals/semantic-gate-baseline/fantasy-system-heretic-capped-20260506T-action-evidence`
  cleared the quote gate. Chapter 1 approved on attempt 1 at 2,289 words.
  Chapter 2 stopped at `plan-check-exhausted`, not word count. The report
  surfaced four `targeted-rewrite:chapter-plan-check` actions, one
  `plan-assist-wait`, and one `plan-assist:plan-check-exhausted` gate.
  The visible blockers were missing Theo/confiding scene evidence, reversed
  emotional-arc evidence, and one beat-level halluc-ungrounded issue for
  `"duty clerk"`.
- That run exposed a telemetry read-shape bug: a pending gate could appear as
  `unresolved=0` when `chapter_exhaustions.unresolved_deviations` arrived as a
  JSONB string. The stdout fallback preserved the blocker evidence; shared
  JSONB parsing now fixes the DB readers used by baseline, candidate reports,
  semantic-gate reports, chapter health, operator summaries, and replay
  comparisons.
- Plan-Assist console evidence now renders zero-based stored `beat_index`
  values as one-based operator labels. The stored contract is unchanged, but
  a blocker for `beat_index: 4` now prints `[beat 5]` instead of `[beat 4]`.
- Live diagnostic smoke:
  `bun run diagnostics:action-evidence -- --novel fantasy-system-heretic`
  reported three actions and correctly showed the pending
  `plan-assist:plan-check-exhausted` gate with `unresolved=4`, including
  blocker samples for Arbiter's carriage, ordinary-strength lifting, and the
  coin/sewer-map continuity issue.
- Runtime gating refinement: continuity checker findings remain visible in
  diagnostics/review evidence but no longer create Drafting Plan-Assist
  blockers by themselves. L84 records the decision; Beat/plan,
  halluc-ungrounded, validation, prose-integrity, and functional blockers
  remain load-bearing.
- Proposal surfacing follow-up: fact-scoped continuity blocker findings can now
  persist manual `editorial_flag` envelopes when a novel opts into
  `seed.pipelineOverrides.continuityEditorialFlagProposals`. The hook is
  nonblocking, emits `continuity-editorial-flag-proposals`, and leaves
  state-only/warning/nit continuity findings diagnostic-only.
- Baseline evidence hook: `diagnostics:semantic-gate-baseline` can enable that
  proposal surfacing on its disposable clone with
  `--continuity-editorial-flag-proposals`, and its report records proposal
  envelope totals/samples before cleanup.
- Plan-check witness evidence: unresolved post-settle plan drift now has a
  trace-only `plan-check-drift-witness` row before reviser or Plan-Assist
  handling, so future investigation can distinguish persistent same-beat drift
  from changing checker findings.
- Ranking evidence: after load-bearing checker and pending-gate discounts,
  `diagnostics:semantic-gate-candidates -- --limit 5 --scan-limit 20 --json`
  returned zero critical candidates. The highest current signals are
  plan-shape/writer-expansion, not active Drafting blockers.
- Durable candidate artifact smoke:
  `diagnostics:semantic-gate-candidates -- --limit 5 --scan-limit 20 --output
  output/evals/semantic-gate-candidates/top-20260506T164552.json` wrote a
  parseable JSON candidate report with five medium-priority candidates and no
  critical/high rows. This artifact shape feeds
  `diagnostics:semantic-gate-cohort-matrix -- --candidate-report <path>`.
- Fresh continuity-flag baseline:
  `diagnostics:semantic-gate-baseline -- --source fantasy-system-heretic
  --chapters 2 --max-beats-per-chapter 5
  --continuity-editorial-flag-proposals --output-base
  output/evals/semantic-gate-baseline/fantasy-system-heretic-continuity-flags-20260506T095502`
  completed 2/2 chapters with no Plan-Assist Gate. Chapter 1 approved at
  2,018 words, Chapter 2 at 1,432 words, total cost `$0.0137`, and the
  continuity editorial-flag hook generated zero envelopes because no
  fact-scoped continuity blockers survived on the settled draft.
- Post-L84 scoped baseline:
  `diagnostics:semantic-gate-baseline -- --source fantasy-system-heretic
  --chapters 2 --max-beats-per-chapter 5 --output-base
  output/evals/semantic-gate-baseline/fantasy-system-heretic-capped-20260506T-continuity-diagnostic`
  completed with no Plan-Assist Gate. Chapter 1 approved at 2,387 words and
  Chapter 2 approved at 2,167 words. Remaining signals were writer expansion
  for Chapter 1 and recovered Plan Adherence drift for Chapter 2. Action
  evidence showed two Chapter Plan targeted rewrites for Chapter 2 beats 4-5
  because the emotional arc reversed from plan, plus one lint-fix attempt and
  one rejected fused-boundary lint repair.
- Matrix comparison evidence:
  `diagnostics:semantic-gate-matrix -- --source fantasy-system-heretic
  --chapters 2 --variant beats=4 --variant beats=5 --parallel 2
  --continuity-editorial-flag-proposals` completed both disposable arms.
  Output:
  `output/evals/semantic-gate-matrix/fantasy-system-heretic-20260506T142441023`.
  Both arms approved 2/2 chapters with no failed child reports. The 5-beat arm
  ranked lower risk (`113.45`) but expanded to 4,439 words (`wordRatio=1.35`)
  and had one plan-drift chapter; the 4-beat arm stayed shorter at 3,526 words
  (`wordRatio=1.07`) but had two plan-drift chapters. Interpretation: beat cap
  is now in a usable range, but neither arm is clean enough to promote as a
  runtime default without a larger A/B or replay comparison.
- Fresh risk-breakdown matrix:
  `diagnostics:semantic-gate-matrix -- --source fantasy-system-heretic
  --chapters 1 --variant capped:beats=4 --variant control:source --parallel 2
  --output-base
  output/evals/semantic-gate-matrix/fantasy-system-heretic-risk-breakdown-20260506T163037`
  completed both disposable arms. Capped ranked at risk `0.97` from
  `word-ratio delta=0.97`. Control ranked at `38.99` from `writer expansion=15`,
  `outline shape=5`, and `word-ratio delta=18.99`. Browser evidence for the
  risk-driver UI and legacy-summary fallback is under
  `output/playwright/2026-05-06/semantic-gate-matrix-risk-risk-breakdown` and
  passed `ui:evidence-check`.
- Read-only matrix artifact viewer shipped for
  `/app/semantic-gate-matrix/fantasy-system-heretic-20260506T142441023` with
  file-backed API route
  `/api/diagnostics/semantic-gate-matrix/:runId`. Browser evidence is under
  `output/playwright/2026-05-06/semantic-gate-matrix-fantasy-system-heretic-20260506t142441023`
  and passed `ui:evidence-check`.
- Matrix discoverability follow-up shipped a recent-run list at
  `/app/semantic-gate-matrix`, a Diagnostics nav entry, and a compact UI API
  wrapper over `GET /api/diagnostics/semantic-gate-matrix?limit=20`. Browser
  evidence is under
  `output/playwright/2026-05-06/semantic-gate-matrix-list-recent-runs` and
  passed `ui:evidence-check`.
- The list summary now also surfaces the top-ranked variant, risk score, word
  ratio, completion state, and short reasons so operators can triage matrix
  runs before opening detail pages.
- Read-only semantic baseline artifact routes and UI shipped for
  `/app/semantic-gate-baseline` and
  `/app/semantic-gate-baseline/:runId`, backed by
  `/api/diagnostics/semantic-gate-baseline`. The list shows terminal status,
  approval/word/cost totals, and terminal reason; detail shows semantic
  signals, draft rows, action evidence, LLM agents, plan-assist samples, and
  artifact paths. Browser evidence is under
  `output/playwright/2026-05-06/semantic-gate-baseline-recent-runs` and passed
  `ui:evidence-check`.
- Diagnostics landing page shipped at `/app/diagnostics`. It loads baseline
  and matrix recent-run summaries independently, links to both detail viewers,
  keeps the Diagnostics nav active on child routes, and degrades per section
  when one diagnostic API fails. Browser evidence is under
  `output/playwright/2026-05-06/diagnostics-recent-runs` and passed
  `ui:evidence-check`; the only console/network error was an intentional
  injected matrix-list `503` for edge-case proof.
- Planning beat-cap experiment seam shipped as a default-off per-novel
  `seed.pipelineOverrides.planningMaxBeatsPerChapter` override. Planning-beat
  prompt guidance now renders the effective cap, generated beats are
  deterministically capped before state mapping, planning enforcement rejects
  over-cap outlines when the override is set, and semantic-gate baseline
  artifacts persist/report the same override. A configured cap below the
  calibrated floor is raised to the floor, so the experiment cannot make a
  chapter structurally under-planned by configuration alone. Disposable smoke
  `fantasy-system-heretic-planning-cap-smoke-20260506T160006` completed capped
  and control arms 1/1; capped wrote `planningMaxBeatsPerChapter=4` and stayed
  shorter, but carried one plan-drift signal, so this remains A/B evidence
  rather than a default change.
- Cohort matrix aggregation shipped as
  `diagnostics:semantic-gate-cohort-matrix`. It can aggregate existing
  `semantic-gate-matrix` summaries or run the same variant set across multiple
  source novels/replicates, including sources read from candidate-scan JSON via
  `--candidate-report`, preserving failed child matrices as evidence.
  Artifact-only smoke over the existing `fantasy-system-heretic` matrix wrote
  `output/evals/semantic-gate-cohort-matrix/existing-summary-smoke-20260506T160425`.
- Cohort viewer browser evidence:
  artifact-only smoke
  `output/evals/semantic-gate-cohort-matrix/risk-breakdown-summary-smoke-20260506T170226`
  aggregated the fresh risk-breakdown matrix with `Chapters: 1`, non-empty
  risk drivers, and no LLM calls. Browser evidence for detail, recent runs,
  Diagnostics landing, and mobile is under
  `output/playwright/2026-05-06/semantic-gate-cohort-matrix-risk-breakdown-cohort`
  and passed `ui:evidence-check`.
- Top-candidate bounded cohort evidence:
  `diagnostics:semantic-gate-cohort-matrix -- --candidate-report
  output/evals/semantic-gate-candidates/top-20260506T164552.json
  --candidate-limit 2 --chapters 1 --variant capped:beats=4 --variant
  control:source --parallel-sources 2 --parallel-variants 2 --output-base
  output/evals/semantic-gate-cohort-matrix/top-candidates-smoke-20260506T171308`
  wrote a completed cohort summary after two idle control children were
  terminated to unblock artifact writing. Capped ranked lower than control
  (`meanRisk=920.50` vs `1057.76`) but completed only 1/2 runs and carried
  pending Plan-Assist, plan-drift, and checker risk. Control completed 0/2 and
  had `process-exit` terminal status in both arms. This is evidence against
  promoting a beat-cap/runtime default and evidence for adding bounded child
  timeouts or gate-exit handling to disposable diagnostics.
- Continuity gray-zone aggregation now emits a support-echo readiness verdict.
  The default candidate filter is positive polarity with conservative
  thresholds (`min labeled 20`, `min FP 80%`, `max TP 5%`, `max AMB 20%`).
  Real smokes remain `insufficient-evidence`: the labeled N=50
  `continuity-state/warning` panel had 44 FP / 6 AMB / 0 TP overall but zero
  positive-polarity candidates, and the positive `continuity-facts/blocker`
  sample was 4/4 FP but below the N threshold.
- Local DB hygiene: `operator-summary --stale-gates --min-age-hours 0`
  found 20 stale pending Plan-Assist rows. After dry-run review,
  `scripts/agent/resolve-stale-gates.ts --older-than-hours 0 --apply` marked
  them `decision='orphaned'` with evidence preserved. A follow-up stale-gate
  audit returned 0 pending stale gates.

## Interpretation

The stored `fantasy-system-heretic` state now points first at Chapter Plan shape
and expansion pressure. That does not prove semantic drift is solved; it says
the next runtime change should start from evidence that compares plan shape,
draft length, drift, and gate behavior together.

The top scanner candidate also shows a checker-calibration risk: some
continuity-facts blocker rows can be consistency echoes rather than negative
contradictions. Keep that diagnostic-only until an adjudicated sample or replay
shows a deterministic runtime filter is safe.

The continuity gray-zone panel can now provide that adjudication sample without
changing gates: filter to `--polarity positive`, label the sample, then decide
whether a deterministic support-echo filter is justified.

Mechanical prose syntax should be repaired before consuming Drafting attempts
or opening a Plan-Assist Gate when the repair is local and deterministic. The
quote-integrity case above is syntax, not creative content: repair locally,
trace it, then let the unchanged integrity detector decide whether any deeper
malformation remains.

Current telemetry is stronger than the previous report surface, but the lesson
is still evidence-first: do not add deterministic name patching just because one
attempt used `Vellic` instead of `Cassel`. That mismatch happened after Beat
writing and was accompanied by broader Plan Adherence/action-shape failures in
fresh evidence. Prefer logged Beat-scoped targeted rewrites and Plan-Assist
evidence before deciding whether any deterministic remediation is safe.

Positive wording alone is not a safe relaxation rule. The diagnostic classifier
must exclude findings that also contain explicit violation/contradiction
language; after that refinement, the current positive `continuity-facts/blocker`
stratum is a small but clean false-positive support-echo cluster.

The candidate scanner should rank by effective blockers while preserving raw
blocker counts. This keeps suspect support echoes available for review without
overstating them as proof of semantic failure.

The currently visible stored failures should be treated first as plan-shape and
writer-expansion evidence, not as a prompt nudge target. A future writer/checker
change still needs fresh replay or A/B evidence.

The refreshed replay fixture confirms current small-fixture planning can stay
inside the calibrated beat count and target-length envelope. Broader seeds may
still need A/B or replay before promoting any planner/writer change.

The earlier capped A/B clone rows were cleaned, so future A/B runs must persist
the semantic-gate roll-up in their JSON/markdown summaries before cleanup. That
is now wired in `c7c280a`.

The top-candidate cohort confirms the current blocker is not simply "pick a
lower beat cap." The better next work is visibility around child matrix runs
and diagnostics-runner boundedness, so operators can see which source/variant
failed, why, and whether a child was terminated because of an idle gate wait.

The cohort detail UI now exposes each child matrix run inline: summary status,
completed variants, child variant risk drivers, reasons, terminal status, and
artifact paths. Browser evidence is clear at
`output/playwright/2026-05-06/semantic-gate-cohort-drilldown-top-candidates/`.

Bounded diagnostics follow-up: `src/index.ts` now closes the shared DB handle
on CLI exit, and semantic-gate baseline/matrix/cohort runners accept/pass
`--timeout-minutes` / `--child-timeout-minutes` with a 30-minute default. If a
baseline child times out, the baseline still writes a partial evidence report
with terminal status `process-timeout` instead of requiring manual process
cleanup.

## Follow-Up

Use this record as input to the broader authoring harness program loop, not as
a one-off overnight lane. The next safe implementation sequence is:

1. Use `diagnostics:semantic-gate-candidates` to pick candidate novels or fresh
   disposable runs.
2. Use `diagnostics:semantic-gate-matrix` when comparing multiple low-risk
   runtime levers; it runs disposable baseline children in parallel and treats
   nonzero child exits with `summary.json` as evidence, not lost work.
3. Choose one low-risk, evidence-backed lever.
4. Add pure/focused tests and a replay or A/B signal before production default
   runtime changes.
5. Commit code and a durable docs record together.
