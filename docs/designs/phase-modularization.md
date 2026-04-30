---
status: APPROVED-WITH-MINOR-CHANGES (Codex R3, agent a1b554f97ed3552b8) — P0 unblocked; spec tightenings below must land before P6
kind: refactor-plan
revision: 3
date: 2026-04-28
related: CONTEXT.md, src/state-machine.ts, src/phases/
codex-r1: 2 CRITICAL + 4 HIGH + 3 MEDIUM concerns — all addressed in R2
codex-r2: REJECTED — schema-of-record violations + detection mechanism + 5 derived issues — all addressed in R3
codex-r3: APPROVE-WITH-MINOR-CHANGES — 2 spec tightenings (issues field, P6b caller fallout) + P6b split + regret note (no reason-based branching)
---

# Phase Modularization — Refactor Plan (Revision 3)

Convert the four runtime Phases (concept / planning / drafting / validation) from
shallow shells over DB-mutating side effects into deep modules with typed
input/output contracts. Goal: each Phase becomes independently testable and
independently improvable; the state-machine becomes a small driver over a
typed `Phase[]` rather than a switch over string tags.

This is a **behavior-preserving** refactor (with one intentional exception
flagged in §"One intentional behavior change" below). Parity is enforced
commit-by-commit via a normalized DB-state harness.

## What changed from Revision 2

Codex Round 2 rejected R2 with schema-of-record violations and a
detection-mechanism critique. R3 fixes:

1. **Schema-of-record corrections (HIGH)**
   - `chapter_drafts` has no `approved_at` column. Approval is `status='approved'`
     on the latest version (`src/db/drafts.ts:9-12`). Loaders/parity reflect this.
   - There is no `tonal_pass_drafts` table. Tonal-pass rows are `chapter_drafts`
     with `status='tonal-pass'` (`src/db/drafts.ts:30-35`). Loaders/parity reflect
     this.
2. **Detection mechanism (CRITICAL)**
   - R2 detected complete-vs-paused by reading `novels.phase` after the inner
     function returned. R3 instead refactors each `runXPhase` to return a
     discriminated `PhaseResult` directly — the inner function declares its
     own outcome rather than the wrapper inferring it from DB state.
   - Drafting's three early-return paths at `src/phases/drafting.ts:159, 1265,
     1272` become explicit `return { kind: "paused", reason }`. The success
     path at line 1276 becomes `return { kind: "complete" }`. The wrapper
     consumes that.
3. **`acceptedRevisions` naming conflated two concepts (LOW-medium)**
   - `chapter_revisions.outcome` is a 7-value enum (`sql/028:33-40`):
     `accepted | rejected_beat_floor | rejected_new_characters | error |
     skip_already_revised | skip_duplicate_sig | skip_no_beat_state`. R3's
     `DraftingOutput.revisions` carries the full enum, not a flat list of
     "accepted."
4. **Phase-transition ownership: full migration, not partial (MEDIUM)**
   - R2 only moved Validation's `updatePhase(..., "done")` to the driver.
     R3 moves *all four* phase transitions to the driver. P6b removes
     `updatePhase` calls from all four phases.
5. **P6a not risk-free for Drafting (HIGH)**
   - R2's P6a unconditionally called every loader after every `runXPhase`,
     which would query a half-finished state if Drafting paused. R3's P6a
     only calls a loader when its Phase actually completed (the wrapper's
     return is `complete`).
6. **Parity harness gaps (HIGH)**
   - `llm_calls` normalization now hashes `system_prompt`, `user_prompt`,
     and `request_json` (when present) for prompt-drift detection
     (`sql/017:13-14`, `sql/018:25`).
   - `agent`, `chapter`, `beat_index`, `attempt` stay in the comparison key
     for both `llm_calls` and `pipeline_events` (`sql/017:17-26`).
   - Serial integer IDs (e.g. `pipeline_events.id`) get stripped/remapped
     same as UUIDs.
7. **`DraftingOutput` understated planned-state writes (HIGH)**
   - R2 captured approvedChapters + exhaustions + revisions only. R3 adds
     `plannedStateWritten: { factsCount; characterStatesCount;
     knowledgeChangesCount }` — observable summaries of the
     `savePlannedState` writes (`src/planned-state.ts:18`,
     `src/phases/drafting.ts:1220`).

## Where R3 disagrees with Codex

Codex flagged two items I am not adopting. Both deserve explicit pushback:

**Disagreement 1 — "Output types are too lossy."** Codex argued that
`ConceptOutput` should carry full world/character records so future code can
chain Phases without DB. R3 keeps the lossy summaries. Rationale: the design
intent is **DB is authoritative; typed outputs are observable summaries** for
two consumers — (a) the driver, which needs to know "did this Phase complete?
how many chapters? any exhaustions?" and (b) tests, which assert on summary
properties. A Phase that needs predecessor data (e.g., Drafting needing the
WorldBible) queries the DB; that's already what the existing code does and
it's correct. Carrying full records in the typed pipe would (i) duplicate the
DB as a source of truth, (ii) bloat tests and snapshots, (iii) invite drift
between pipe-state and DB-state. Adding an explicit doc comment to
`PhaseOutput` types stating "summaries for driver decisions and test
assertions; DB is authoritative for the underlying records."

**Disagreement 2 — "P6b breaks the orchestrator restart contract via
`activeRuns`."** Codex's concern: today, `runNovel` runs a busy-retry loop
with `maxPhaseRestarts` (`src/state-machine.ts:24-32`), and the orchestrator
clears `activeRuns` on return (`src/orchestrator/novel-routes.ts:456,506`).
With R3's "return on paused," each `/api/novel/:id/resume` call resets
the in-process restart counter, allowing infinite resumes.

R3's position: **today's busy-retry loop is itself a bug**, not a contract to
preserve. When Drafting can't make progress (e.g., chapter aborted at
plan-assist gate), the current busy-loop spins inside one `runNovel`
invocation while holding `activeRuns` and consuming resources, and only after
`maxPhaseRestarts` does it surface as a thrown error. The new "return on
paused" semantics are *more* correct — the orchestrator marks the novel
inactive, the user sees the paused state, and the user explicitly resumes
when ready. R3 removes the in-process `maxPhaseRestarts` retry counter; this
is the **One intentional behavior change** flagged below.

## One intentional behavior change + secondary fallout

P6b2 removes `pipeline.maxPhaseRestarts` and the `prevSignature/stuckCount`
loop guard in `src/state-machine.ts:14-32`. Rationale above.

**Secondary fallout that must be addressed in P6b2** (Codex R3 catch):

1. `runNovel()` resolution semantics change from "done or error" to "done or
   paused or error." `/api/novel/start` at `novel-routes.ts:454` and the
   resume routes at `:506`, `:542` log success in `.then(...)` branches.
   These must distinguish completed from paused — likely by exposing the
   final phase via `getNovel(novelId)` after `runNovel` resolves, or by
   `runNovel` returning `{ outcome: "complete" | "paused" }` instead of
   `void`. Decide before P6b2 lands.
2. `phase-complete` pipeline events at `state-machine.ts:69` are emitted
   today after every successful phase invocation. The new driver MUST
   preserve them — either inside the driver loop after a `complete` return
   (recommended) or inside each Phase's wrapper (worse — leaks orchestration
   into Phase code).

All other behavior — retry budgets inside Phases, gate semantics, agent
calls, check ordering — is preserved.

## Driver-side discipline (regret prevention)

`PhaseResult.reason: string` exists for logs only. **Driver code must NEVER
branch on the string value** (Codex R3 regret note). All control-flow
decisions are on `kind` only. If pause reasons ever become programmatic
(e.g., needing to distinguish "plan-assist gate aborted" from "reviser
exhausted"), promote `reason` to a small enum *before* multiple call sites
depend on ad-hoc text.

## Motivation (corrected)

Today (`src/state-machine.ts:14-71`):

```ts
switch (novel.phase) {
  case "concept":    await runConceptPhase(novelId, novel.seed); break
  case "planning":   await runPlanningPhase(novelId);            break
  case "drafting":   await runDraftingPhase(novelId);            break
  case "validation": await runValidationPhase(novelId);          break
}
novel = await getNovel(novelId)   // re-fetch to detect progress
// loop runs again with novel.phase advanced (or unchanged → stuckCount++)
```

- Every Phase returns `Promise<void>`.
- State advances by Phase code calling `updatePhase` / `updateCurrentChapter`
  inside its own body.
- The driver detects progress by re-fetching the row and comparing a
  `(phase, currentChapter)` signature. (R1 said "phase tag" alone — wrong.)
- Phases consume their predecessors' outputs by re-querying the DB.

Consequences:
- A Phase cannot be unit-tested at its interface — you have to spin up Postgres
  and observe table writes.
- Future drivers (autonomous-loop replay, single-Phase reruns, snapshot tests)
  cannot consume Phase outputs as values; they must scrape the DB.
- Mid-Phase aborts (e.g., Drafting's plan-assist abort at `drafting.ts:159`)
  cause a busy-retry loop until `maxPhaseRestarts` trips.

## Target

```ts
// src/phases/contract.ts

export type PhaseName = "concept" | "planning" | "drafting" | "validation"

export interface PhaseCtx {
  novelId: string
  seed: SeedInput              // immutable snapshot
  pipeline: ReturnType<typeof effectivePipeline>
  // event/trace handles, transport handle, gate handle, logger
}

/** A Phase's run outcome. The Phase itself declares which kind it is —
 *  the wrapper does NOT infer from DB state. */
export type PhaseResult<O> =
  | { kind: "complete"; output: O }
  | { kind: "paused"; reason: string }

export interface Phase<I, O> {
  readonly name: PhaseName
  /** Run the Phase. Idempotent on resume — Phase internals already skip
   *  already-completed work. */
  run(input: I, ctx: PhaseCtx): Promise<PhaseResult<O>>
  /** Reconstruct this Phase's output from DB. Called on resume to rebuild
   *  the typed pipe for already-completed phases. MUST be deterministic
   *  and side-effect-free. Only called when the Phase has actually
   *  completed (driver consults novel row). */
  loadOutput(novelId: string): Promise<O>
}
```

```ts
// Output types — observable summaries.
// DB is authoritative for the underlying records; these summaries serve the
// driver (resume + decisions) and tests (assertion targets).

export type ConceptOutput = {
  hasWorldBible: true
  characterCount: number
  hasStorySpine: true
  worldSystemsCount: number
  culturesCount: number
}

export type PlanningOutput = {
  totalChapters: number
  chapters: ReadonlyArray<{
    number: number
    title: string
    targetWords: number
    beatCount: number
  }>
}

export type DraftingOutput = {
  approvedChapters: readonly number[]            // chapter_drafts.status='approved'
  exhaustions: ReadonlyArray<{
    chapter: number
    kind: "plan-check-exhausted" | "reviser-rejected"   // sql/030 enum
  }>
  revisions: ReadonlyArray<{
    chapter: number
    outcome:                                              // sql/028 enum
      | "accepted"
      | "rejected_beat_floor"
      | "rejected_new_characters"
      | "error"
      | "skip_already_revised"
      | "skip_duplicate_sig"
      | "skip_no_beat_state"
  }>
  planCheckOverridden: readonly number[]                  // chapters with override flag
  plannedStateWritten: {                                  // savePlannedState scope
    factsCount: number
    characterStatesCount: number
    knowledgeChangesCount: number
  }
}

export type ValidationOutput = {
  totalChapters: number
  passes: number
  /** Snapshot of `issues` rows with status='open' AT END of Validation.
   *  The `issues` table has no source discriminator — both Drafting and
   *  Validation write to it (`src/phases/drafting.ts:1243`,
   *  `src/phases/validation.ts:60`). This is intentionally the
   *  end-of-Validation open-issue snapshot, mirroring `getOpenIssues()` at
   *  `validation.ts:85`. NOT renamed to filter-by-Validation because no
   *  source column exists in the schema. */
  openIssuesAtEnd: ReadonlyArray<{ chapter: number; description: string; severity: string }>
  tonalPassChapters: readonly number[]   // chapter_drafts.status='tonal-pass'
}
```

```ts
// src/state-machine.ts (after P6b)

const phases = [conceptPhase, planningPhase, draftingPhase, validationPhase]

export async function runNovel(novelId: string): Promise<void> {
  const ctx = await buildPhaseCtx(novelId)
  const novel = await getNovel(novelId)

  // Resume rehydration. For each Phase already complete, reconstruct its
  // output from DB to feed the typed pipe for downstream phases.
  let pipe: unknown = novel.seed
  let startIdx = 0
  for (let i = 0; i < phases.length; i++) {
    if (isPhaseComplete(novel, phases[i].name)) {
      pipe = await phases[i].loadOutput(novelId)
      startIdx = i + 1
    } else {
      break
    }
  }

  // Run remaining phases. The Phase declares complete vs paused; we trust it.
  for (let i = startIdx; i < phases.length; i++) {
    const result = await phases[i].run(pipe as never, ctx)
    if (result.kind === "paused") return    // resume on next runNovel(novelId)
    pipe = result.output
    await updatePhase(novelId, phaseAfter(phases[i].name))   // driver owns transition
  }
  // updatePhase(..., "done") happens after Validation's "complete" return.
}
```

The driver no longer detects progress by re-fetching the novel row inside the
loop. The Phase's `PhaseResult` *is* the progress signal. The DB remains
authoritative for resume — the driver consults it once on entry, and each
Phase's `loadOutput` is the canonical reconstruction.

`updateCurrentChapter` stays inside Drafting (resume metadata for inside-drafting).

## Constraints

1. **Behavior-preserving with one exception.** All retry budgets inside
   Phases, gate semantics, agent calls, and check ordering are preserved.
   The single intentional change is removing the outer `maxPhaseRestarts`
   busy-retry loop (rationale §"One intentional behavior change").
2. **Resume-safe.** A run that pauses (Drafting abort, plan-assist gate)
   ends `runNovel`; the next `runNovel(novelId)` call rehydrates and
   resumes.
3. **`updateCurrentChapter` stays phase-owned.** Driver owns `updatePhase`
   only.
4. **Atomic commits.** One Phase per commit. Each commit passes the parity
   harness on a recorded reference run.
5. **No agent or DB-module changes.** This refactor operates strictly above
   the agent layer and strictly above `src/db/`.
6. **State-machine signature unchanged.** `runNovel(novelId): Promise<void>`
   stays.
7. **Branch isolation.** Branch `phase-modularization`, cut from
   `autonomous-harness-loop` after current D-series settles.

## Migration sequence

P-series, atomic commits, branch `phase-modularization`.

### P0 — Normalized parity harness

**File**: `tests/phase-parity/` (new).

Captures and replays a reference Novel run.

**Recorded scope** — these tables, snapshotted as normalized JSON:

*Novel root*
- `novels` (id, phase, currentChapter, totalChapters)

*Concept phase persisted state*
- `world_bibles` (PK: novel_id)
- `characters` (PK: novel_id, id)
- `story_spines` (PK: novel_id)
- `world_systems`, `cultures`, `character_cultures`,
  `character_system_awareness`

*Planning phase persisted state*
- `chapter_outlines` (PK: novel_id, chapter_number) — including the
  `revision_used` and `plan_check_overridden` fields

*Drafting phase persisted state*
- `chapter_drafts` (PK: novel_id, chapter_number, version) — including the
  `status` field; tonal-pass rows are status='tonal-pass'
- `facts` (PK: novel_id, id) — from savePlannedState
- `character_states` (PK: novel_id, character_id, chapter_number)
- character_knowledge — from savePlannedState
- `chapter_revisions` (sql/028) — outcome enum included
- `chapter_exhaustions` (sql/030) — kind enum included

*Validation phase persisted state*
- `validation_passes` (PK: novel_id, pass_number, chapter_number)
- `issues`

*Cross-cutting telemetry — normalized*
- `llm_calls` — comparison key includes `agent`, `chapter`, `beat_index`,
  `attempt`; fields hashed include `system_prompt`, `user_prompt`,
  `request_json` (whichever populated)
- `pipeline_events` — comparison key includes `eventType`, `chapter`,
  `beat_index` if present, `agent` if present; payload hashed

*Prose*
- SHA-256 hash of every approved chapter's prose

**Normalization rules**:
- timestamps stripped or floored to a wall-clock-independent value
- UUIDs replaced by stable hash of (novel_id, table, business-key)
- serial integer PKs (e.g. `pipeline_events.id`) stripped/remapped same way
- floating-point numerics rounded to 6 decimal places
- ordered fields sorted by primary key + relevant secondary

The transport-interceptor seam from D4a hosts both record and replay
adapters.

**P0 acceptance**: harness records and replays one full reference Novel
(romance-drama or current default) with byte-identical normalized snapshots.

### P1 — Define `Phase<I,O>` contract + IO types

**Files**: `src/phases/contract.ts` (new). No other changes.

Types-only commit. Defines `Phase`, `PhaseCtx`, `PhaseName`, `PhaseResult`,
and the four IO contract types (`ConceptOutput`, `PlanningOutput`,
`DraftingOutput`, `ValidationOutput`). No runtime code consumes them yet.

Parity: trivial.

### P2 — Concept phase: explicit return + wrapper

**Files**: `src/phases/concept.ts`.

Two-part change in one commit (atomic, both halves below operate on the same
file):

(a) Refactor `runConceptPhase` to return `PhaseResult<ConceptOutput>` instead
    of `Promise<void>`. Today `runConceptPhase` has a single success path
    (no early returns); the change is to return `{ kind: "complete", output }`
    at the end and `{ kind: "paused", reason }` if a gate ever produces a
    paused state in the future. Today there is no paused path for Concept;
    the discriminated return type is forward-looking but the runtime always
    returns `complete`.

(b) Add `conceptPhase: Phase<SeedInput, ConceptOutput>` whose `run` calls the
    refactored `runConceptPhase` and whose `loadOutput` queries DB.

The legacy state-machine still calls `runConceptPhase` and ignores the new
return type (TypeScript erases unused `Promise<T>` results).

Parity: full.

### P3 — Planning phase: explicit return + wrapper

Same shape as P2.

Today `runPlanningPhase` returns `Promise<void>` with no early returns; same
forward-looking discriminated return as P2.

Parity: full.

### P4 — Drafting phase: explicit return + wrapper

**Files**: `src/phases/drafting.ts`.

(a) Refactor `runDraftingPhase` to return `PhaseResult<DraftingOutput>`. The
    three early returns at lines 159, 1265, 1272 become
    `return { kind: "paused", reason }`. The success path at line 1276
    becomes `return { kind: "complete", output }` after a `loadDraftingOutput`
    call (so the output is built from the same DB query the loader uses).

(b) Add `draftingPhase: Phase<PlanningOutput, DraftingOutput>` and
    `loadDraftingOutput`.

Parity: full. Riskiest commit — but the risk is correctly converting the
three early returns and the one success path, which is line-by-line
mechanical.

### P5 — Validation phase: explicit return + wrapper

Same shape. Validation today has no early returns and a single success path.

Parity: full.

### P6a — Add hydration calls under the old driver

**Files**: `src/state-machine.ts`.

Behavior-preserving: after each `runXPhase` call that *completed* (i.e.,
`novel.phase` advanced past it on the next iteration), call the corresponding
`loadXOutput` and discard the result. Purpose: exercise loaders against
production DB state for one or more reference runs to confirm they don't
throw and return values consistent with the post-Phase DB state. Only call a
loader for a Phase that completed; never call after a paused-equivalent
return.

Parity: full (loaders are read-only; their output is discarded).

### P6b1 — Driver flip + transition migration (structural; behavior-preserving)

**Files**: `src/state-machine.ts`, all four `src/phases/*.ts` files.

Replace the legacy `switch` with the typed driver shown in §Target. Remove
`updatePhase(novelId, ...)` calls from all four phases — the driver now owns
*all* phase transitions.

**Behavior preservation**: a `paused` result from a Phase still re-dispatches
in-process exactly as today, by re-entering the outer loop. The
`prevSignature/stuckCount` busy-retry guard stays in P6b1. The
`phase-complete` events at `state-machine.ts:69` are emitted by the new
driver after every successful Phase return.

`updateCurrentChapter` calls inside Drafting stay.

Parity: full. **The first commit that materially changes orchestrator
structure — hence the prior P0 + P6a de-risking, plus the parity harness.**

### P6b2 — Remove busy-retry; "return on paused" + caller fallout

**Files**: `src/state-machine.ts`, `src/orchestrator/novel-routes.ts`,
`src/config/pipeline.ts`.

Three coordinated changes (one commit, atomic — they break together):

1. Remove `pipeline.maxPhaseRestarts`, `prevSignature`, `stuckCount` from
   `state-machine.ts`. Change paused handling from in-process re-dispatch to
   "return to caller."
2. Update `runNovel()` signature to expose final outcome (recommend:
   `Promise<{ outcome: "complete" | "paused" }>`).
3. Update `/api/novel/start`, `/resume`, and the `activeRuns` lifecycle
   handlers in `novel-routes.ts:454,506,542` to distinguish completed from
   paused, so the orchestrator doesn't log a paused run as "completed."

**This is the one intentional behavior change.** Documented in §"One
intentional behavior change + secondary fallout".

Parity: NOT byte-equal at the orchestrator log level (paused runs now log
differently). Phase-internal behavior remains byte-equal.

### P7 — Tighten legacy `runXPhase` exports (only after P6b2)

**Files**: each phase file.

The original P7 plan was to delete `runConceptPhase`/`runPlanningPhase`/
`runDraftingPhase`/`runValidationPhase` as dead exports. That premise is
false: discovered during P7 implementation that they have 17 external
usages — `src/phases/drafting-revision-used-persistence.test.ts` (5
calls), `src/phases/drafting-reviser-escalation.test.ts` (6 calls), and
3 scripts (`scripts/fork-writer-test.ts`, `scripts/fork-writer-v4-llama.ts`,
`scripts/test-planner-isolated.ts`) that each invoke `runConceptPhase`
+ `runPlanningPhase` (6 calls total). No external caller exists for
`runValidationPhase`. The tests exercise the phase body directly with
mocks; the scripts compose phases manually for ablation runs that
intentionally bypass the driver.

Action: keep the exports, add a JSDoc to each pointing at the Phase<I,O>
wrapper as the canonical driver-consumer entry point.

Parity: full.

### P8 — Phase contract tests

**Files**: `tests/phases/phase-contract.test.ts`.

The original plan was four per-phase test files exercising recorded
`PhaseInput` against a stubbed transport. Discovered during P8 that
behavior coverage is already provided by the integration tests
(`src/phases/drafting-revision-used-persistence.test.ts`,
`drafting-reviser-escalation.test.ts`, `settle-loop.test.ts`) and the
byte-parity harness (`tests/phase-parity/`). Adding four superficial
re-runs of the integration suite at a different file path would be
duplicative.

Collapsed to a single file that pins the wrapper shape only: `name`
matches the canonical PhaseName literal, `run` is AsyncFunction,
`loadOutput` is AsyncFunction, registry has uniqueness + name-coverage
invariants. Behavioral coverage of `run`/`loadOutput` continues to
live in the integration tests + parity harness.

**Out of scope**: redesigning Phase internals (e.g., extracting
ChapterDraftLoop from drafting.ts — separate candidate).

## Tracking

- Experiment row: `createTuningExperiment("ticket", "phase-modularization")`
  before P0 lands; `concludeExperiment` after P8.
- One commit per P-step, prefixed `[refactor] P0:`, `[refactor] P1:`, etc.
- After P8, append a session retro at
  `docs/sessions/2026-04-XX-phase-modularization.md`.
- Branch: `phase-modularization`, cut from `autonomous-harness-loop` after
  current D-series settles.

## Non-goals

- **Not** redesigning Phase internals.
- **Not** changing agent invocation shape.
- **Not** adding per-phase event taxonomy.
- **Not** adding new gates or changing gate semantics.
- **Not** building UI changes.
