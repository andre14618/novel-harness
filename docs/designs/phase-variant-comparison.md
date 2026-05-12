---
status: probe-pending
kind: experiment-charter
charter-family: phase-variant-comparison
proposed-by: Claude
proposed-date: 2026-04-29
revision: 5
adversary-verdict:
  R1: RED (Codex 2026-04-29, agent a785e64eeaa660f28) — full harness too early
  R2: RED (Codex 2026-04-29, agent a0123ee11b5b8fecf) — 5 mechanical blockers
  R3: RED (Codex 2026-04-29, agent a033ae12f0caf3fa5) — chapter-plan-checker requires prose
  R4: RED (Codex 2026-04-29, agent a0148a39ac6c0f721) — 5 schema-of-record bugs (outline_json column doesn't exist, facts are chapter-level not per-beat, G2 tautological vs required schema field, approval gate unspecified, gates weaker than rider claims)
  R5: integrated R4 findings; user authorized proceed-to-implementation with Codex post-implementation pass
related:
  - docs/designs/phase-modularization.md (P0-P8 — typed Phase<I,O> contract)
  - docs/designs/autonomous-context-loop.md (Sub-loop 1 — this is its precursor screen)
  - scripts/variant/clone-for-variant.ts (fixture primitive — extended in this charter)
  - src/agents/planning-scenes/index.ts:6-7 (top-level prompt await)
  - src/agents/chapter-plan-checker/context.ts:13 (verified takes prose — incompatible with planner-only scope)
---

# Phase Variant Comparison — Charter (Revision 5)

> **Superseded by exp #289 split mapper:** This charter targeted the old all-in-one `planning-scenes` surface. `planning-scenes` now emits beat shape only; `planning-state-mapper` owns facts, knowledge, character state, payoff links, and writer-visible obligations. The implemented verdict script can compare arbitrary `--control` / `--test` pairs, but this R5 metric set is historical unless the probe explicitly targets mapper-owned state density or a composed beats+mapper surface.

**Compliance + structural-integrity screen** for a "loud" planning-scenes
prompt variant. Asks one question only: did the prompt rider take effect
without breaking the planner? No LLM calls beyond the planner itself; all
checks computed from `chapter_outlines` table state.

SCREEN-PASS authorizes a follow-up charter for downstream replay + 3-chapter
pilot. SCREEN-FAIL closes only the loud-shape question. No quality judgment
in this screen.

## Pivot history

- **R1 (RED):** charter committed ~14h of harness build before validating
  the surface. Pivot: 5-chapter planner-only A/B.
- **R2 (RED):** R2 adopted pivot with 5 mechanical blockers.
- **R3 (RED):** R3 reframed as a screen using chapter-plan-checker as winner
  metric. Codex verified `chapter-plan-checker/context.ts:13` takes
  `(prose, outline)` — incompatible with a planner-only screen. Plus
  predicate logic still overlapped at boundaries and n=5 chapters is too
  small for ±5pp gates.
- **R4 (RED):** R4 dropped chapter-plan-checker but introduced 5 schema-of-record
  bugs: (a) the column is `outline_json` not `outline_json` (`src/db/outlines.ts:5`);
  (b) `establishedFacts` is chapter-level not per-beat (`schema.ts:27-31`); (c) G2's
  "named character" check is tautological — `knowledgeChanges.characterName` is
  required by the schema (`schema.ts:53`); (d) runner didn't specify how to bypass
  `presentForApproval` (`planning.ts:158`); (e) gates set thresholds materially
  weaker than rider language and called that "compliance."
- **R5 (this revision):** fixes all 5 R4 bugs. Metric definitions rewritten in
  the actual schema's terms (chapter-level establishedFacts; volume-not-presence
  for knowledgeChanges). Runner specifies `setAutoMode(true)`. Thresholds
  reframed as "directional movement signal," not "rider compliance" — gate
  language updated to match. User authorized proceeding to implementation
  with a Codex pass after for final cleanup.

## Question

Does the loud planning-scenes prompt variant produce planner output that:

1. **Complies with each rider** — facts/beat target raised, knowledgeChanges
   are character-named, beat count grew toward 1.2x.
2. **Passes structural validity** — schema-validates, planner returned
   without throwing, chapter outlines parse.

A YES on both → SCREEN-PASS → follow-up charter authorized for replay +
pilot. A NO on (1) → variant is being ignored by the model. A NO on (2) →
variant breaks the planner.

**This screen does NOT judge prose quality.** That requires replay and a
3-chapter pilot, deferred to the follow-up charter post-SCREEN-PASS.

## Hypothesis (falsifiable, directional)

**H1:** Setting `PLANNING_SCENES_PROMPT_OVERRIDE` to the loud variant prompt
produces planner output that satisfies the four compliance/structural gates
in §"Decision criteria" below.

**Falsification:** any verdict outcome other than SCREEN-PASS falsifies H1.

**Mechanism:** DeepSeek V3.2 follows explicit schema-of-output instructions
when those instructions are concrete and within its output-budget. The
loud variant's three riders are (a) a per-beat numeric target on
`establishedFacts`, (b) a structural shape requirement on
`knowledgeChanges` entries, (c) a multiplicative target on beat count. If
any rider is ignored, the model is either capacity-limited or treating
the rider as advisory.

## Decision criteria (mechanically computable, ordered, mutually exclusive)

Evaluated **in order** — first matching predicate wins.

Metrics computed from `chapter_outlines.outline_json` for each variant's
5-chapter clone. Per the actual schema (`src/agents/planning-scenes/schema.ts`):
- `establishedFacts` is a CHAPTER-level array, not per-beat.
- `knowledgeChanges` is a CHAPTER-level array; `characterName` is a required
  field (R4 finding — checking presence is tautological).
- `scenes` is the per-chapter beat array.

Within-screen relative comparisons (default + loud both measured in same run)
sidestep cross-run drift. Absolute floors prevent "1.5× zero is still zero"
edge cases.

Let — over each variant's 5 chapters:
- `*_facts_median` = median over 5 chapters of `establishedFacts.length`.
- `*_know_median` = median over 5 chapters of `knowledgeChanges.length`.
- `*_total_scenes` = sum over 5 chapters of `scenes.length`.

**Compliance gates (directional movement signal — NOT literal rider
compliance):**

- **G1 (rich-facts directional uptake):**
  `loud_facts_median ≥ 1.5 × default_facts_median` AND
  `loud_facts_median ≥ 8`. (Rider asks for ~3-5 facts/beat which would
  scale to many dozens of chapter-level facts — the gates only test
  "loud meaningfully exceeds default," not "rider literally complied.")

- **G2 (knowledge-changes directional uptake):**
  `loud_know_median ≥ 1.5 × default_know_median` AND
  `loud_know_median ≥ 3`. (Replaces the R4 tautology — checks volume,
  not field presence. Rationale: the named-knowledge rider asks for
  *more, more-specific* knowledge tracking; volume is the rider's
  observable signature given that `characterName` is already mandatory.)

- **G3 (scene-count directional uptake):**
  `loud_total_scenes ≥ 1.10 × default_total_scenes`. (Rider asks 1.2x;
  threshold 1.10 captures partial uptake.)

- **G4 (structural validity):** loud variant's planning phase returned
  `PhaseResult.kind="complete"` AND all 5 chapter outlines parsed against
  `chapterBeatsSchema` without errors. (R4 advisory: callAgent already
  safeParses, so G4 is mostly a sanity check on whether the variant
  produced complete output across all 5 chapters.)

**Threshold calibration note:** the 1.5× / 8 / 3 / 1.10 floors are
uncalibrated picks. If default's actual median is much higher or much
lower than guessed, a SCREEN-PASS may need re-thresholding before opening
the follow-up replay charter. R5's runner records both default and loud
metrics in the results JSON so a recalibration is data-driven not
hand-wavy.

| Order | Verdict | Predicate (first match wins) |
|---|---|---|
| 1 | **SCREEN-FAIL (broken)** | NOT G4 |
| 2 | **SCREEN-FAIL (non-compliant)** | NOT (G1 AND G2 AND G3) |
| 3 | **SCREEN-PASS** | G1 AND G2 AND G3 AND G4 |

These are exhaustive (every result lands in exactly one cell): predicate
3's condition is the negation of predicates 1 and 2 combined, so the
table covers the full space without overlap or gap.

A "default" run is also captured for context (planner ran without override),
but its metrics are NOT in the verdict computation. They appear in the
results JSON for sanity ("default's facts_median was X, loud's was Y").
The verdict is purely "did the loud variant comply with its own riders."

The verdict computer is `scripts/phase-eval/print-screen-verdict.ts`.
Reads results JSON; emits verdict string; exit code 0 for SCREEN-PASS,
1 otherwise. Human cannot override — to change the verdict, change the
gates and document the change.

## Pre-flight screen specification

### Fixture

- **Source:** a fresh concept-complete novel from a 5-chapter seed.
- **5 chapters × ~14 beats/ch (default-baseline) = ~70 beats per variant.**
  At n=70 beats, median facts/beat and named-knowledge fraction are
  measurable to ~2-3% resolution — fine enough for the 0.80 and 2.0
  absolute thresholds.
- **Why not chapter-plan-checker:** it requires prose (verified at
  `src/agents/chapter-plan-checker/context.ts:13`), incompatible with
  planner-only scope.

### Variants

Two:

1. **`default`** — exact copy of `src/agents/planning-scenes/scene-expansion-system.md`.
2. **`loud`** — combined intervention: facts/beat 3-5 rider, named-knowledge
   rider, 1.2x scene-count rider.

R2 warning #1 (combined-intervention confound) acknowledged: SCREEN-PASS
on `loud` triggers a follow-up charter that adds single-rider arms. The
follow-up answers "which rider matters" only after we know "any rider
matters at all."

### Runner

`scripts/phase-eval/probe-planning-scenes.ts` — a single thin script.
**No drafting, no validation, no checker calls beyond the planner itself.**

```
1. parseArgs: --source <concept-complete-novel-id>
2. createTuningExperiment("ticket", "planning-scenes-screen-<date>", config) -> expId
3. for each variant in [default, loud] serially:
     a. clone-for-variant.ts --target-phase=concept-done --source X --target X-<variant>
     b. Bun.spawn(['bun', 'scripts/phase-eval/run-variant.ts'])
        with env: NOVEL_ID=X-<variant>, EXPERIMENT_ID=expId,
                  VARIANT_LABEL=<variant>, PHASE=planning,
                  PLANNING_SCENES_PROMPT_OVERRIDE=variants/planning-scenes/<variant>.md
     c. Child: import { setAutoMode } from "./cli"; setAutoMode(true);
        runs runPlanningPhase(NOVEL_ID); on completion emits
        {phase_result_kind, error?: string} to stdout. Parent captures.
        (R4 finding: planning.ts:158 calls presentForApproval which blocks
        on stdin without auto mode. setAutoMode(true) bypasses per cli.ts.)
     d. Parent: query chapter_outlines.outline_json from X-<variant>, compute
        G1/G2/G3 metrics for both variants. The two variants' metrics both
        feed the verdict (G1/G2/G3 are within-screen relative comparisons).
4. Parent: emit results JSON to scripts/phase-eval/reports/screen-<date>.json.
5. Parent: invoke print-screen-verdict.ts on the JSON; capture verdict.
6. Parent: concludeExperiment(expId, verdict_summary).
```

### Why child processes

Three module-level globals:

| Hazard | Severity | Verified |
|---|---|---|
| `src/agents/planning-scenes/index.ts:6-7` — top-level await caches prompt | **LOAD-BEARING** | Codex R1 |
| `src/logger.ts:25 currentRunId` | bonus safety | Partially proven |
| `src/transport.ts:78 setTransport` | bonus safety | Partially proven |

The prompt-cache hazard alone justifies child processes. ~200ms startup is
negligible against minutes of planning runtime.

### Prompt-override injection seam

```ts
// src/agents/planning-scenes/index.ts — single change
const defaultPromptPath = new URL("scene-expansion-system.md", import.meta.url).pathname
const overridePath = process.env.PLANNING_SCENES_PROMPT_OVERRIDE
const promptPath = overridePath ?? defaultPromptPath
export const prompt = await Bun.file(promptPath).text()
```

Unset → byte-equal to current production. P0b parity test (Slice 0b)
verifies.

## Schema-of-record

`clone-for-variant.ts --target-phase=concept-done` partitions the
`novel_id`-keyed table set as follows. Codex R2/R3 corrected list.

**MUST clone (concept-side state + per-novel config):**
- `novels` (target's `phase` set to `'planning'`, `current_chapter` to `1`)
- `world_bibles`
- `characters`
- `world_systems`
- `cultures`
- `character_cultures`
- `character_system_awareness`
- `story_spines`
- `retrieval_config` (per-novel config; `sql/011`)

**MUST be absent (post-concept state):**
- `chapter_outlines`
- `chapter_drafts`
- `chapter_summaries` (`sql/010`)
- `facts`
- `character_states`
- `character_knowledge`
- `relationship_states`
- `timeline_events`
- `issues`
- `validation_passes`
- `chapter_revisions` (`sql/028`)
- `chapter_exhaustions` (`sql/030`)
- `event_causes`
- `knowledge_propagation`
- `thematic_tags`

`drift_checks` (`sql/032`) is not novel_id-scoped, so it's outside the
per-novel partition (per Codex R3 confirmation).

Slice 0a's diff to `clone-for-variant.ts`: add `--target-phase=concept-done`
flag handling, expand the clone set per the MUST-clone list above, set
target.phase='planning' under the flag, post-clone assert MUST-be-absent
emptiness. Existing default path (target-phase=drafting) byte-equal —
regression test required.

## Constraints

1. **Phase-modularization parity must hold.** Slice 1a env-var override
   read is unset-safe; default path byte-equal. P0b validates.
2. **One variant per child process.** Module-level prompt cache + global
   `currentRunId` + global transport.
3. **Planner-only scope.** No drafting, no validation, no checker LLM
   calls. All metrics computed from `chapter_outlines` table state.
4. **Decision is mechanical.** `print-screen-verdict.ts` computes verdict
   from results JSON via the ordered predicate table. Human cannot
   override.
5. **No prose-quality judgment in this charter.** SCREEN-PASS authorizes
   the follow-up replay charter; it does NOT authorize productionization.
6. **Atomic commits per CLAUDE.md rule 5.**
7. **SCREEN-FAIL closure is soft per R2 warning #2.** The screen says
   "this loud variant fails" — not "no variant could ever help." Without
   a ceiling arm, broader closure isn't justified.

## Migration sequence

| Slice | Files | Effort | Acceptance |
|---|---|---|---|
| 0a | `scripts/variant/clone-for-variant.ts` | ~2h | `--target-phase=concept-done` produces correct partition. Default path byte-equal on a regression test. |
| 0b | `tests/phase-parity/fixtures/reference-run/` | ~1h LXC | `bun test tests/phase-parity/phase-parity.test.ts` passes byte-equal across two replays. Independent of 0a. |
| 1a | `src/agents/planning-scenes/index.ts` | ~30min | `PLANNING_SCENES_PROMPT_OVERRIDE` env var swaps prompt; unset reverts. P0b parity passes. |
| 1b | `scripts/phase-eval/run-variant.ts` (child) | ~1h | Reads env, runs `runPlanningPhase`, emits PhaseResult kind + error to stdout, exits clean. NO drafting/validation/checker calls. |
| 1c | `scripts/phase-eval/probe-planning-scenes.ts` (parent) | ~2h | Orchestrates 2 variants serially via Bun.spawn, reads chapter_outlines after each, computes G1-G3 from outline_json + targetWords, emits results JSON. |
| 1d | `scripts/phase-eval/variants/planning-scenes/{default,loud}.md` | ~1h | Two prompt files with hypothesis headers. |
| 1e | `scripts/phase-eval/print-screen-verdict.ts` | ~30min | Reads results JSON; applies ordered predicate table; emits verdict; exit code 0 for SCREEN-PASS. |
| 1f | First screen run + retrospective | ~1h | `docs/sessions/2026-MM-DD-planning-scenes-screen.md` records verdict + next action. |

**Total: ~7.5h work + ~$0.10 LXC compute** (just 2 planner runs; no
drafting/validation/checker calls).

## Outcome paths

After Slice 1f, exactly one of:

- **SCREEN-PASS →** open follow-up charter
  `phase-variant-comparison-r5-replay.md`. Scope: same `loud` variant
  + 3 single-rider arms (rich-facts only, named-know only, 1.2x-floor
  only) + downstream replay + 3-chapter pilot per `docs/lessons-learned.md`
  discipline. Estimated cost: ~$3-5, ~10h.
- **SCREEN-FAIL (broken) →** triage planner failure (schema regression,
  output-budget overflow, etc.). May require variant prompt fix and
  re-run before declaring NO-SHIP. Maximum 2 retries before declaring
  the loud-shape unviable.
- **SCREEN-FAIL (non-compliant) →** the model isn't following the riders.
  Try (a) re-prompt with stricter rider language (max 1 retry), or
  (b) declare loud-shape NO-SHIP and pivot to a different variant
  intervention type (model swap, structured-output schema enforcement,
  context injection).

## Codex review checkpoints

- **R1** ✅ — DONE. RED, scope pivot.
- **R2** ✅ — DONE. RED, mechanical fixes.
- **R3** ✅ — DONE. RED, winner-metric architectural fix.
- **R4** — this revision. Expect GREEN or YELLOW-with-fixable-nits given
  R1+R2+R3 fully addressed and chapter-plan-checker dependency removed.
- **R5 (post-implementation, pre-LXC)** — bundled review of Slices 0a +
  1a + 1b + 1c + 1e before any LXC compute. Schema-of-record on 0a,
  predicate-table walkthrough on 1e, child-process spawn safety on 1c.
- **R6 (post-screen)** — review screen results + verdict. Decision: open
  follow-up replay charter or close family.

## Tracking

- Charter row: `createTuningExperiment("charter", "phase-variant-comparison-r4-screen", {...})`.
- Screen run: `createTuningExperiment("ticket", "planning-scenes-screen-<date>", {...})` +
  `linkExperiment(screenId, charterId, "child")`.
- Branch: cut `phase-variant-screen` from current `phase-modularization`
  HEAD, letting `phase-modularization` merge to `autonomous-harness-loop`
  independently.
- Retrospective: `docs/sessions/2026-MM-DD-planning-scenes-screen.md` after
  Slice 1f.

## Non-goals (R4)

- **Not** running drafting, validation, or any checker LLM calls.
- **Not** measuring prose quality.
- **Not** judging variant quality — only compliance and structural validity.
- **Not** authorizing productionization.
- **Not** building a reusable harness.
- **Not** parallelism.
- **Not** a UI.
- **Not** committing to single-rider decomposition unless SCREEN-PASS occurs.
- **Not** establishing a noise band.
