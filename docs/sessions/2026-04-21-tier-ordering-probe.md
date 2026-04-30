---
status: retrospective
updated: 2026-04-21
duration: ~4h
commits: 6
subagents_spawned: 2
wall_clock_min: 240
codex_reviews: 0
rework_passes: 0
bugs_caught_by_codex: 0
bugs_caught_by_preflight: 0
bugs_escaped_to_prod: 0
preflight_false_positives: 0
---

# tier-ordering-validation probe — 2026-04-21

## 1. What shipped

The `tier-ordering-validation-v1` charter was taken from draft through
a complete review / terrain-survey / pivot / probe / kill arc in one
session. Autonomous-loop roadmap revision 2 (`docs/autonomous-loop-roadmap-2026-04-21.md`,
commit `db9d8f6`) incorporated Codex amendments (tier reorder, Tier 1.5
concept, prerequisites, tightened exit criteria, 2×2 counterfactual
design) and that roadmap motivated the charter at
`docs/charters/tier-ordering-validation-v1.md` (commit `76a7667`). An
Opus `experiment-adversary` review (commit `cca9f57`, §10 of the
charter) returned RED with 7 blockers + 4 warnings + a named
$0.60 cheapest-untried-counterfactual probe. Before building the
probe, a terrain survey (commit `9956f62`) read
`src/agents/writer/beat-context.ts:255-281` and discovered the v1
lever was vacuous — orphan `establishedFacts` never reach the writer,
`characterStateChanges` from the outline is never rendered. The
charter was killed and §11 "Post-review terrain survey" pivoted to
the v2 lever (`requiredPayoffs` density). The probe driver
(`scripts/evals/tier-ordering-probe-v1.ts`, commit `8b89638`) ran 52
beat-writer calls, came in 21× under the adversary budget ($0.028 vs
$0.60 forecast), and the results doc (commit `b4426fb`) recorded a
FLAT verdict: marginal delta −7.7pt, matched-pairs McNemar p ≈ 0.68,
NOT significant. Both lever versions killed. Ordering assumption
promoted to "working hypothesis."

## 2. Architectural iterations with supersession chains

### Chain A: roadmap v1 → Codex reorder → roadmap v2 → charter → RED → pivot

- **Initial approach:** autonomous-loop roadmap revision 1 proposed a
  3-tier sequential sub-loop decomposition with tier order
  {concept, planning, writing, checker} and a sprint-style top-down
  attack.
- **Problem discovered:** Codex adversarial review of revision 1
  flagged under-specified prerequisites, a missed Tier 1.5 concept,
  loose exit criteria, and no counterfactual design.
- **Superseded by:** roadmap revision 2 (commit `db9d8f6`) — applied
  all four Codex amendments verbatim (tier reorder, Tier 1.5,
  prerequisites, tightened exit criteria, 2×2 counterfactual).
- **Lesson:** a roadmap is a testable artifact, not a mission
  statement. Codex reviewing the roadmap surfaced the ordering
  assumption that ultimately drove the charter; the revision was
  what made "is tier order actually valid?" a concrete experimental
  question.

### Chain B: charter v1 draft → Opus RED → Fork 2 pivot (NOT to alternative, but to cheapest-untried-counterfactual)

- **Initial approach:** draft charter (commit `76a7667`) proposed a
  full 2×2 ordering-validation experiment (2 planners × 2-3 writers
  across full-novel runs) to test whether Tier 1 winners hold under
  Tier 2 writer swaps.
- **Problem discovered:** Opus `experiment-adversary` review
  (commit `cca9f57`, recorded as charter §10) flagged 7 blockers and
  4 warnings against the 2×2 design and named a $0.60
  cheapest-untried-counterfactual probe (chapter-scale density
  manipulation on `establishedFacts` + `characterStateChanges`) as
  the falsification test to run FIRST.
- **Superseded by:** pivot to the stage-1 probe (commits `8b89638`
  through `b4426fb`). Per the user's `feedback_codex_counterfactual_signal`
  memory, the adversary's named cheapest-untried-counterfactual is a
  pivot recommendation, not an alternative to refute.
- **Lesson:** when the adversary names a specific cheapest probe,
  treat the charter as provisionally killed and the probe as the
  new primary work. The original charter shape is falsifiable only
  through a cheaper instrument; building the expensive instrument
  without running the cheap one is process debt.

### Chain C: v1 lever (outline density) → terrain survey kill → v2 lever (requiredPayoffs density) → FLAT probe

- **Initial approach:** probe would intervene on
  `outline.establishedFacts` count + `outline.characterStateChanges`
  count between "quiet" and "loud" cells, expecting the writer
  under "loud" to produce prose with more payoff density.
- **Problem discovered** (commit `9956f62`): a $0 read of
  `src/agents/writer/beat-context.ts:255-281` showed orphan
  `establishedFacts` are only used to build a `factById` lookup —
  the writer only sees facts linked via `beat.requiredPayoffs`
  (SEEDS + PAYOFFS DUE blocks). `outline.characterStateChanges`
  is never rendered to the writer at all. The v1 lever was vacuous.
- **Superseded by:** the v2 lever — `requiredPayoffs` density
  intervention (commits `8b89638` + `b4426fb`). This lever DOES
  render to the writer. The probe ran as designed on
  `novel-1776691080571` (epic-fantasy, 2 chapters × 13 beats × 2
  variants = 52 beat-writer calls).
- **Result:** FLAT within noise. Marginal −7.7pt (88.5% → 80.8%
  adherence pass), matched-pairs McNemar p ≈ 0.68. Writer IS
  visibly responding to the lever (4 P→F regressions all trace to
  extra SEEDS blocks competing with core-beat attention; 2 F→P
  recoveries fix character-presence failures from baseline) but
  net effect stays within sampling noise at n=26/cell.
- **Lesson:** the cheapest-untried-counterfactual pattern was even
  cheaper than advertised — the terrain survey killed the probe at
  $0 before any LXC burn, and the pivoted probe ran 21× under
  budget. Both kill signals were informative: the survey killed
  the lever on architectural grounds, the probe killed the revised
  lever on measurement grounds. Charter is fully dead, but the
  knowledge is durable (writer render surface documented,
  requiredPayoffs density falsified as a move-the-needle lever,
  3-tier ordering demoted to working hypothesis).

## 3. Codex back-and-forth exchanges

### Exchange 1 — Opus adversary fallback

- **Thread:** N/A (Codex SlashCommand tool was unavailable this session)
- **Original commit claim:** `cca9f57` "Charter review: RED verdict
  recorded on tier-ordering-validation-v1"
- **Codex found:** Codex wasn't available. The `charter-review` skill
  normally routes to Codex gpt-5.4 as the primary adversary; when the
  SlashCommand tool failed to resolve, the Opus `experiment-adversary`
  subagent ran as fallback. The session notes this explicitly in
  charter §10.
- **Fix:** no fix to the charter itself — the Opus review produced a
  real RED verdict with 7 blockers + 4 warnings + a named $0.60
  cheapest-untried-counterfactual probe that the rest of the session
  acted on. But the *tooling* gap (SlashCommand tool unavailability
  blocking the primary review path) is worth fixing before the next
  charter review.
- **Sufficient?** deferred to next session (tooling fix, not charter
  work)

### Exchange 2 — roadmap revision 2 Codex amendments

- **Thread:** captured as commits rather than an explicit thread ID
- **Original commit claim:** roadmap revision 1 proposed a tier
  ordering + sub-loop decomposition
- **Codex found:** reorder needed (Tier 1.5 was missing as a named
  bridge concept; prerequisites were under-specified; exit criteria
  too loose to discriminate SHIP from ITERATE; no counterfactual
  design pinned down)
- **Fix:** roadmap revision 2 (commit `db9d8f6`) applied all four
  amendments. The charter then emerged from the tightened exit
  criteria.
- **Sufficient?** yes — the revision was the source of truth the
  rest of the session built on.

## 4. Class-of-bug patterns

- **Terrain-survey-kills-probe** — a $0 code-level audit of the
  writer render surface invalidated the charter's intended lever
  before any probe spend. Seen at 1 site this session. Not yet
  elevated to a pattern doc; re-check after the next charter cycle.
  The corresponding lesson-learned rule landed in commit `64e8e2c`.
- **Charter-falsifies-via-cheap-counterfactual** — the adversary's
  named $0.60 probe AND the terrain survey BOTH worked as cheap
  falsifiers; the expensive 2×2 never ran. Seen at 1 site this
  session. Reinforces the existing `feedback_codex_counterfactual_signal`
  memory (treat the adversary's named cheapest-untried-counterfactual
  as a pivot recommendation). Not yet promoted to a pattern doc.
- **Writer render surface ≠ outline schema** — the harness has two
  distinct structural-state surfaces (what the planner stores and
  what `beat-context.ts:255-281` renders) that prior roadmap
  language conflated. Seen at 1 site this session — but this is
  architectural knowledge, not a process pattern. Captured as a
  permanent lesson (commit `64e8e2c`).
- **Adherence-pass-rate chapter-probe noise floor** — binary
  pass/fail at n=26/cell has a ≥1σ band around ±6pt; the script's
  ±5pt threshold was too tight. Seen at 1 site this session.
  Captured as a permanent lesson.

No pattern crossed the 2-site threshold this session; no `docs/patterns/`
doc created. If either "terrain-survey-kills-probe" or
"cheapest-untried-counterfactual fires at $0 before driver build"
recurs, elevate.

## 5. Process observations

The session ran without Codex at all on the critical path — the Opus
`experiment-adversary` subagent substituted for the Codex primary
reviewer on the charter-review call because the SlashCommand tool was
unavailable. That fallback produced a usable RED verdict, but the
session lost the normal Codex-gpt-5.4 adversarial lens and operated
on Opus's review alone. The tooling gap is the item worth fixing: if
the `charter-review` skill's primary Codex route is silently
unavailable, the fallback should be called out more prominently so
future sessions can decide whether to wait for the primary.

Two sequential Sonnet subagents handled (a) the terrain survey on
`beat-context.ts` and (b) the probe driver implementation. Both
completed without rework passes, which is consistent with
well-scoped, read-only-and-small-code work. No parallel subagent
fan-out was used — the session was strictly sequential because each
step depended on the previous (roadmap → charter → review → survey
→ pivot → driver → probe → results). This is a case where the "act
on Codex consensus" pattern (`feedback_act_on_codex_consensus`)
and the "adversary counterfactual as pivot recommendation" pattern
(`feedback_codex_counterfactual_signal`) combined to keep the work
moving — at each step, the evidence closed the prior question and
opened the next without user intervention.

The session's cost story reinforced the memory `feedback_query_llm_calls_for_costs`:
the adversary review's $0.60 budget was a per-token ceiling, and
the real cost came in at $0.028 via DeepSeek prefix caching. The
ratio (21× under) is large enough to be worth writing down as a
lesson; beat-scale probes on DeepSeek V3.2 should anchor their
budget in `llm_calls` actuals, not per-token estimates.

Separately, the session's output is an unusual shape for a
retrospective: nothing *shipped to production*. The runtime code is
unchanged. What shipped is (a) architectural knowledge about the
writer render surface, (b) a killed charter + dead lever, and (c)
recalibrated priors on the 3-tier ordering assumption and on
chapter-probe measurement scale. This is still a full retrospective
by the `docs/sessions/README.md` rules — the session had multiple
supersession chains and several class-of-bug patterns — but it's
worth flagging that "nothing shipped" doesn't mean "nothing
happened."

## 6. Open questions / next-session focus

- **Tier 1B writer-visible threading.** The terrain survey identified
  the un-shipped glue (bulk `establishedFacts` injection into
  `beat-context.ts`, `worldExpansionBudget` wiring,
  `priorBeatEstablishedFacts` via `getFactsUpToChapter`) as the
  next Tier 1 direction. This is a production code change, not a
  probe; scope a charter after the `voice-shaping-ablation-v1`
  result lands.
- **Codex SlashCommand tool availability.** Worth investigating
  whether the tool is systematically unavailable in this harness
  variant, or whether it was a transient miss. The Opus fallback
  worked but isn't a clean substitute on every future charter.
- **McNemar test wired into future probe drivers.** The driver
  computed a raw marginal delta and called a −5pt threshold
  "NEGATIVE" — the correct test at n=26/cell matched-pairs is
  McNemar's, which this session had to run by hand. Future probe
  drivers should emit matched-pairs statistics alongside marginal
  deltas.

If you're reading this on the next session, start here: the
tier-ordering charter is dead, the 3-tier sequential ordering is a
working hypothesis, and the next direction is Tier 1B writer-visible
threading (see `docs/todo.md`). Don't re-try density-manipulation
probes at chapter-scale — n=26/cell is too small for an effect below
10pt, and both cheap levers (outline-density, requiredPayoffs-density)
are now falsified.
