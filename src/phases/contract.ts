/**
 * Phase contract — typed input/output for the four pipeline Phases.
 *
 * Per docs/designs/phase-modularization.md (R3 APPROVED). Defines the
 * interface every Phase exposes once P2-P5 land:
 *
 *   - run(input, ctx): explicit complete|paused result
 *   - loadOutput(novelId): rehydrate the typed pipe from DB on resume
 *
 * P1 lands these types only. No runtime code consumes them yet — the
 * existing state-machine still calls runConceptPhase/etc. directly. P2-P5
 * wrap each runXPhase to satisfy this interface; P6b1 flips the driver to
 * consume it.
 *
 * Output types are observable summaries, NOT synthetic IDs. The DB
 * (keyed by novel_id) remains authoritative for the underlying records.
 * Summaries serve two consumers: the driver (resume + decisions) and
 * tests (assertion targets). A Phase that needs predecessor data queries
 * the DB directly — the typed pipe is not a substitute for the source of
 * truth.
 */

import type { SeedInput } from "../types"
import type { pipeline as pipelineDefaults } from "../config/pipeline"

// ── Phase identity & control flow ───────────────────────────────────────

export type PhaseName = "concept" | "planning" | "drafting" | "validation"

/** Per-call cross-cutting capabilities. The driver constructs PhaseCtx
 *  once per runNovel invocation. Phases READ from `seed`/`pipeline` and
 *  never mutate them.
 *
 *  Future P-step additions (when consumers materialize): event/trace
 *  handles, transport handle, gate handle, logger. Today each Phase
 *  imports those directly; pulling them through PhaseCtx is a separate
 *  cleanup deferred to after P8. */
export interface PhaseCtx {
  novelId: string
  seed: SeedInput
  pipeline: typeof pipelineDefaults
}

/** A Phase's run outcome. The Phase itself declares which kind it is —
 *  the driver MUST NOT infer from DB state. Driver code branches on
 *  `kind` only; `reason` is for logs and human eyes. Promoting reason to
 *  an enum is a deferred concern (see design doc §"Driver-side
 *  discipline"). */
export type PhaseResult<O> =
  | { kind: "complete"; output: O }
  | { kind: "paused"; reason: string }

export interface Phase<I, O> {
  readonly name: PhaseName
  /** Run the Phase. Idempotent on resume — internals already skip
   *  already-completed work. Returns `complete` only when the Phase has
   *  fully finished its persistent side effects; returns `paused` for
   *  any early exit (mid-chapter abort, plan-assist gate firing, etc.). */
  run(input: I, ctx: PhaseCtx): Promise<PhaseResult<O>>

  /** Reconstruct this Phase's output from DB. Called on resume to rebuild
   *  the typed pipe for already-completed Phases. MUST be deterministic
   *  and side-effect-free. Only called when the Phase has actually
   *  completed (driver consults novel row). */
  loadOutput(novelId: string): Promise<O>
}

// ── IO contract types ───────────────────────────────────────────────────
//
// These are observable summaries of what each Phase persisted. The DB is
// authoritative for the underlying data; downstream Phases query the DB
// directly when they need full records.

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

/** chapter_revisions.outcome enum — verbatim from sql/028:33-40. */
export type RevisionOutcome =
  | "accepted"
  | "rejected_beat_floor"
  | "rejected_new_characters"
  | "error"
  | "skip_already_revised"
  | "skip_duplicate_sig"
  | "skip_no_beat_state"

/** chapter_exhaustions.kind enum — verbatim from sql/030:29; integrity-exhausted added L64. */
export type ExhaustionKind = "plan-check-exhausted" | "reviser-rejected" | "integrity-exhausted"

export type DraftingOutput = {
  /** chapter numbers with at least one chapter_drafts row of status='approved' */
  approvedChapters: readonly number[]
  exhaustions: ReadonlyArray<{ chapter: number; kind: ExhaustionKind }>
  revisions: ReadonlyArray<{ chapter: number; outcome: RevisionOutcome }>
  /** chapter_outlines rows with plan_check_overridden=true */
  planCheckOverridden: readonly number[]
  /** Counts of savePlannedState writes — facts, character_states,
   *  character_knowledge are rolled up here for parity-friendly summaries
   *  without dragging full record sets through the pipe. */
  plannedStateWritten: {
    factsCount: number
    characterStatesCount: number
    knowledgeChangesCount: number
  }
}

export type ValidationOutput = {
  totalChapters: number
  passes: number
  /** Snapshot of `issues` rows with status='open' AT END of Validation.
   *  The `issues` table has no source discriminator (both Drafting and
   *  Validation write to it). This is intentionally the
   *  end-of-Validation open-issue snapshot, mirroring `getOpenIssues()`
   *  at src/phases/validation.ts:85. NOT renamed to filter-by-Validation
   *  because no source column exists in the schema. */
  openIssuesAtEnd: ReadonlyArray<{ chapter: number; description: string; severity: string }>
  /** Historical chapter_drafts rows with status='tonal-pass'. New tonal-pass
   *  generation is retired, but old comparison rows can still be displayed. */
  tonalPassChapters: readonly number[]
}

// ── Convenience type aliases for the typed pipe ─────────────────────────

export type PhaseInput = {
  concept: SeedInput
  planning: ConceptOutput
  drafting: PlanningOutput
  validation: DraftingOutput
}

export type PhaseOutputs = {
  concept: ConceptOutput
  planning: PlanningOutput
  drafting: DraftingOutput
  validation: ValidationOutput
}
