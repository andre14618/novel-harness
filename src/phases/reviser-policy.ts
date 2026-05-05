/**
 * D2 of the drafting-deepenings plan
 * (`docs/plans/2026-04-28-drafting-deepenings.md` — Codex GREEN round 4,
 * thread `a125655226814600d`).
 *
 * Concentrates the duplicated reviser/exhaustion policy that lived inline
 * in `src/phases/drafting.ts` at lines 703-838 (plan-check path) and
 * 1035-1159 (validation path) into one module.
 *
 * **Caller contract** (load-bearing): ALL failed settle outcomes from
 * `runSettleLoop` (D3 — exhausted, no-routing, ineligible) MUST funnel
 * through this policy. The policy module owns the reviser path and ALL
 * associated `pendingExhaustion` construction. Caller branches only on
 * `outcome.kind` for restart/bail flow.
 *
 * Module owns:
 *   - `revisionUsed` write-before-call guard (durable-inconsistency fix
 *     preserved — `setRevisionUsed` is awaited BEFORE the reviser LLM call
 *     so a schema/transport error can't leak revision_used=FALSE into the
 *     DB and let a later restart fire a second reviser call). See the
 *     persistence test at `drafting-revision-used-persistence.test.ts (c)`.
 *   - Reviser LLM call dispatch (caller-supplied `callReviser` closure;
 *     V1 `DEBUG_FORCE_REVISER` short-circuits removed in D4a — the V2
 *     transport-interceptor + `src/debug/v1-bridge.ts` now handles
 *     debug-injection at the agent boundary instead).
 *   - Sanity checks: beat floor (`Math.max(3, ceil(targetWords / 300))`)
 *     and no-new-characters.
 *   - Telemetry (`logRevision` callback) for `chapter_revisions` rows.
 *   - Persistence (`persistAcceptedOutline` callback) for accepted plans.
 *   - `pendingExhaustion` construction for all 4 non-accepted outcomes.
 *
 * Stays out (caller responsibility):
 *   - `plan-assist` gate dispatch (drafting.ts ~1186, the consumer of
 *     `pendingExhaustion`).
 *   - Settle loop (D3 — separate commit).
 *   - Outline restart logic (caller branches on `outcome.kind === "accepted"`
 *     to restart the attempt with the revised outline).
 *   - Issue normalization (caller transforms per-path raw deviations or
 *     validation blockers into `ReviserIssue[]` BEFORE calling).
 *   - The `bail = true` flag (caller sets after `attemptRevision` returns).
 *   - Eligibility computation (caller computes `canRevise`, `issueSig`,
 *     and passes them in via `eligibility`).
 *   - The `lastUnresolvedSig` mutation (caller updates from
 *     `eligibility.issueSig` after calling).
 */

import type { ChapterOutline, SceneBeat } from "../types"
import type { PlanAssistGatePayload } from "../gates"

/**
 * Re-export of `PlanAssistGatePayload` under the policy-module vocabulary.
 * The drafting-deepenings plan refers to this shape as `PendingExhaustion`;
 * the runtime gate code calls it `PlanAssistGatePayload`. They are the same
 * type — the alias lets the policy module's interface match the plan's
 * design vocabulary without duplicating the shape.
 */
export type PendingExhaustion = PlanAssistGatePayload

/** Pre-formatted issue passed to the policy module by the caller. */
export interface ReviserIssue {
  /** Pre-formatted issue description, e.g. "[beat 3] Setting mismatch — planned X, observed Y". */
  description: string
  /** Optional structured beat reference, if known. */
  beat_index?: number | null
  beatId?: string
  metadata?: Record<string, unknown>
}

export interface ReviserStrategy {
  /** Build the reviser context string given the current outline + prose + normalized issues. */
  buildReviserContext(outline: ChapterOutline, prose: string, issues: ReviserIssue[]): string
  /** For chapter_revisions telemetry. */
  telemetryLabel: "plan-check" | "validation"
}

export type RevisionLogOutcome =
  | "accepted"
  | "rejected_beat_floor"
  | "rejected_new_characters"
  | "error"
  | "skip_already_revised"
  | "skip_duplicate_sig"
  | "skip_no_beat_state"

export interface RevisionLogEntry {
  novelId: string
  chapter: number
  attempt: number
  /** Raw deviations as the caller passes them (per-path shape). */
  deviations: unknown[]
  originalBeats: SceneBeat[]
  revisedBeats: SceneBeat[] | null
  outcome: RevisionLogOutcome
  rejectionReason?: string
}

/**
 * The successful reviser response shape. Matches `chapterBeatsSchema`'s
 * runtime output (planning-beats schema). The fields beyond `scenes` are
 * optional so a forced/test reviser response can omit them and the policy
 * module falls back to the original outline's values.
 */
export interface ReviserResponseOutput {
  scenes: SceneBeat[]
  establishedFacts?: ChapterOutline["establishedFacts"]
  characterStateChanges?: ChapterOutline["characterStateChanges"]
  knowledgeChanges?: ChapterOutline["knowledgeChanges"]
}

export interface ReviserResponse {
  output: ReviserResponseOutput
}

export interface ReviserPolicyInput {
  novelId: string
  chapter: number
  attempt: number
  outline: ChapterOutline
  prose: string
  /** Pre-normalized issues (caller transforms raw deviations / blockers). */
  issues: ReviserIssue[]
  /** Raw deviations as the caller wants them written into chapter_revisions. */
  rawDeviations: unknown[]
  strategy: ReviserStrategy
  eligibility: {
    revisionUsed: boolean
    lastUnresolvedSig: string | null
    canSettle: boolean
    /**
     * Pre-computed by caller per the current shape:
     *   canRevise = !revisionUsed && issueSig !== lastUnresolvedSig && canSettle
     */
    canRevise: boolean
    /** The signature of the current issues (for the caller's lastUnresolvedSig tracking). */
    issueSig: string
  }
  /** Persistence callback (decoupled from `saveChapterOutline` import). */
  persistAcceptedOutline: (outline: ChapterOutline) => Promise<void>
  /** Telemetry callback (decoupled from `logRevision` import). */
  logRevision: (entry: RevisionLogEntry) => Promise<void>
  /**
   * Callback to mark revision used in DB BEFORE the LLM call. Caller may
   * also update its own in-memory `revisionUsed` here. The policy module
   * AWAITS this — if it rejects, the LLM call never fires (durable-
   * inconsistency fix). See `drafting-revision-used-persistence.test.ts (c)`.
   */
  markRevisionUsed: () => Promise<void>
  /**
   * The actual LLM dispatch. Caller wires this to `callAgent({...})`.
   * Debug-injection (V1 `DEBUG_FORCE_REVISER` env vars) is intercepted
   * in the V2 transport layer via `src/debug/v1-bridge.ts` since D4a;
   * the closure no longer carries an inline short-circuit.
   *
   * The caller's closure is responsible for any agentName / chapter /
   * attempt / system-prompt / schema wiring. The policy module only knows
   * about the resulting output shape.
   *
   * Throws → caught by the policy and routed to the `error` outcome with
   * a `pendingExhaustion` of `kind: "reviser-rejected"`.
   */
  callReviser: (userPrompt: string) => Promise<ReviserResponse>
}

export type ReviserOutcome =
  | { kind: "accepted"; revisedOutline: ChapterOutline }
  | {
      kind: "rejected"
      reason: "beat_floor"
      pendingExhaustion: PendingExhaustion
      info: { revisedBeatCount: number; minBeats: number }
    }
  | {
      kind: "rejected"
      reason: "new_characters"
      pendingExhaustion: PendingExhaustion
      info: { newCharacters: string[] }
    }
  | { kind: "error"; pendingExhaustion: PendingExhaustion; error: Error }
  | { kind: "ineligible"; reason: "already_revised" | "duplicate_sig" | "no_beat_state"; pendingExhaustion: PendingExhaustion }

/**
 * Run the reviser policy. See module docstring for the caller contract.
 *
 * Outcome flow:
 *   - `ineligible` (caller's `canRevise` is false) → emit a skip
 *     `chapter_revisions` row + return `pendingExhaustion`
 *     `kind: "plan-check-exhausted"` so the caller routes to the
 *     plan-assist gate. No LLM call fires.
 *   - `accepted` → revised outline persisted via `persistAcceptedOutline`
 *     callback + `accepted` row written + return the revised outline so
 *     the caller can restart the attempt with it.
 *   - `rejected` (beat_floor or new_characters) → reject row written +
 *     return `pendingExhaustion` `kind: "reviser-rejected"`.
 *   - `error` (LLM throw) → error row written + return `pendingExhaustion`
 *     `kind: "reviser-rejected"` carrying the error message.
 */
export async function attemptRevision(input: ReviserPolicyInput): Promise<ReviserOutcome> {
  const {
    novelId, chapter, attempt, outline, prose,
    issues, rawDeviations, strategy, eligibility,
    persistAcceptedOutline, logRevision, markRevisionUsed, callReviser,
  } = input

  // The runtime shape of pendingExhaustion.unresolvedDeviations matches
  // `rawDeviations` exactly — both paths construct rawDeviations as
  // Array<{description, beat_index}> at the caller (plan-check:
  // ChapterPlanDeviation[]; validation: hand-constructed array). Cast
  // rather than re-mapping so the description text is preserved byte-
  // exactly to the pre-refactor behavior.
  const unresolvedDeviationsForPayload =
    rawDeviations as PlanAssistGatePayload["unresolvedDeviations"]

  // Ineligibility branch: emit the skip row + pendingExhaustion without
  // touching the LLM. Mirrors drafting.ts:840-865 (plan-check path) /
  // :1148-1158 (validation path) before the refactor.
  if (!eligibility.canRevise) {
    const skipOutcome: RevisionLogOutcome = eligibility.revisionUsed
      ? "skip_already_revised"
      : eligibility.issueSig === eligibility.lastUnresolvedSig
        ? "skip_duplicate_sig"
        : "skip_no_beat_state"
    const reasonText =
      skipOutcome === "skip_already_revised"
        ? "already revised this chapter"
        : skipOutcome === "skip_duplicate_sig"
          ? "identical issue signature as last revision"
          : "beat-level state not available"

    await logRevision({
      novelId, chapter, attempt,
      deviations: rawDeviations,
      originalBeats: outline.scenes,
      revisedBeats: null,
      outcome: skipOutcome,
      rejectionReason: reasonText,
    }).catch(() => { /* swallow — caller's logRevision wrapper logs warns */ })

    const ineligibleReason: "already_revised" | "duplicate_sig" | "no_beat_state" =
      skipOutcome === "skip_already_revised"
        ? "already_revised"
        : skipOutcome === "skip_duplicate_sig"
          ? "duplicate_sig"
          : "no_beat_state"

    return {
      kind: "ineligible",
      reason: ineligibleReason,
      pendingExhaustion: {
        kind: "plan-check-exhausted",
        novelId, chapter, attempt, outline, prose,
        unresolvedDeviations: unresolvedDeviationsForPayload,
      },
    }
  }

  // Eligible — fire the reviser. AWAIT the persistence write FIRST so a
  // schema/transport failure on the LLM call can't leak revision_used=FALSE
  // (Codex review 5c9e..., Round A). See module docstring + persistence test.
  await markRevisionUsed()

  const originalBeatsSnapshot: SceneBeat[] = [...outline.scenes]
  const reviseCtx = strategy.buildReviserContext(outline, prose, issues)

  let revised: ReviserResponse
  try {
    revised = await callReviser(reviseCtx)
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err))
    const errMsg = errorObj.message
    const labelPrefix = strategy.telemetryLabel === "validation" ? "[validation] " : ""

    await logRevision({
      novelId, chapter, attempt,
      deviations: rawDeviations,
      originalBeats: originalBeatsSnapshot,
      revisedBeats: null,
      outcome: "error",
      rejectionReason: `${labelPrefix}${errMsg.slice(0, 200)}`,
    }).catch(() => { /* swallow — caller's logRevision wrapper logs warns */ })

    return {
      kind: "error",
      error: errorObj,
      pendingExhaustion: {
        kind: "reviser-rejected",
        novelId, chapter, attempt, outline, prose,
        unresolvedDeviations: unresolvedDeviationsForPayload,
        reviserHistory: {
          attemptedScenes: [],
          rejectionReason: `${labelPrefix}reviser threw: ${errMsg.slice(0, 200)}`,
        },
      },
    }
  }

  // Post-revision sanity checks. Mirror the drafting.ts pre-refactor logic
  // exactly so existing reviser tests pass without edits.
  const revisedScenes: SceneBeat[] = (revised.output.scenes ?? []) as SceneBeat[]
  const minBeats = Math.max(3, Math.ceil(outline.targetWords / 300))
  const originalCharacters = new Set(
    [
      outline.povCharacter,
      ...(outline.charactersPresent ?? []),
      ...outline.scenes.flatMap(s => s.characters ?? []),
    ].filter(Boolean),
  )
  const revisedCharacters = new Set(revisedScenes.flatMap(s => s.characters ?? []))
  const newCharacters = [...revisedCharacters].filter(c => !originalCharacters.has(c))
  const labelPrefix = strategy.telemetryLabel === "validation" ? "[validation] " : ""

  if (revisedScenes.length < minBeats) {
    const reason = `${labelPrefix}revised beat count ${revisedScenes.length} < floor ${minBeats}`
    await logRevision({
      novelId, chapter, attempt,
      deviations: rawDeviations,
      originalBeats: originalBeatsSnapshot,
      revisedBeats: revisedScenes,
      outcome: "rejected_beat_floor",
      rejectionReason: reason,
    }).catch(() => { /* swallow — caller's logRevision wrapper logs warns */ })

    return {
      kind: "rejected",
      reason: "beat_floor",
      pendingExhaustion: {
        kind: "reviser-rejected",
        novelId, chapter, attempt, outline, prose,
        unresolvedDeviations: unresolvedDeviationsForPayload,
        reviserHistory: { attemptedScenes: revisedScenes, rejectionReason: reason },
      },
      info: { revisedBeatCount: revisedScenes.length, minBeats },
    }
  }

  if (newCharacters.length > 0) {
    const reason = `${labelPrefix}new characters: ${newCharacters.join(", ")}`
    await logRevision({
      novelId, chapter, attempt,
      deviations: rawDeviations,
      originalBeats: originalBeatsSnapshot,
      revisedBeats: revisedScenes,
      outcome: "rejected_new_characters",
      rejectionReason: reason,
    }).catch(() => { /* swallow — caller's logRevision wrapper logs warns */ })

    return {
      kind: "rejected",
      reason: "new_characters",
      pendingExhaustion: {
        kind: "reviser-rejected",
        novelId, chapter, attempt, outline, prose,
        unresolvedDeviations: unresolvedDeviationsForPayload,
        reviserHistory: { attemptedScenes: revisedScenes, rejectionReason: reason },
      },
      info: { newCharacters },
    }
  }

  // Accepted — merge revision into outline, persist, log.
  // Cast through unknown because chapterBeatsSchema's z.infer resolves some
  // defaulted fields as optional while chapterOutlineSchema resolves them
  // as required; both produce the same runtime shape after parse.
  const revisedOutline: ChapterOutline = {
    ...outline,
    scenes: revisedScenes,
    establishedFacts: revised.output.establishedFacts ?? outline.establishedFacts,
    characterStateChanges: revised.output.characterStateChanges ?? outline.characterStateChanges,
    knowledgeChanges: revised.output.knowledgeChanges ?? outline.knowledgeChanges,
  } as ChapterOutline

  await persistAcceptedOutline(revisedOutline)

  await logRevision({
    novelId, chapter, attempt,
    deviations: rawDeviations,
    originalBeats: originalBeatsSnapshot,
    revisedBeats: revisedOutline.scenes,
    outcome: "accepted",
  }).catch(() => { /* swallow */ })

  return { kind: "accepted", revisedOutline }
}
