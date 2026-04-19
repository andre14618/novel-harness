import db from "./connection"

// Types duplicated here rather than imported from ../gates to avoid a
// back-reference cycle — gates.ts imports these DB helpers as values.
export type ExhaustionKind = "plan-check-exhausted" | "reviser-rejected"
export type ExhaustionResolverMode = "auto" | "cli" | "web"
export type ExhaustionDecision = "edit-plan" | "override" | "abort"

export interface ExhaustionRow {
  id: number
  novelId: string
  chapter: number
  attempt: number
  firedAt: string
  kind: ExhaustionKind
  resolverMode: ExhaustionResolverMode
  unresolvedDeviations: Array<{ description: string; beat_index: number | null }>
  reviserHistory: { attemptedScenes: unknown[]; rejectionReason: string } | null
  decidedAt: string | null
  decision: ExhaustionDecision | null
  decisionDetails: unknown | null
}

/**
 * Insert a fire row. Called from gates.ts `requestPlanAssist` as the gate
 * opens. Attempt number is not on `PlanAssistGatePayload` today — drafting
 * passes it in alongside the payload. We accept it as an explicit arg.
 *
 * Auto mode also writes a row so the exhaustion event is durable even
 * when the run halts via PipelineBailError (nothing resolves the gate
 * in auto — the row stays in the "pending" shape but provides the record
 * of why the run bailed).
 */
export async function logExhaustionFired(params: {
  novelId: string
  chapter: number
  attempt: number
  kind: ExhaustionKind
  resolverMode: ExhaustionResolverMode
  unresolvedDeviations: Array<{ description: string; beat_index: number | null }>
  reviserHistory?: { attemptedScenes: unknown[]; rejectionReason: string } | null
}): Promise<number> {
  const rows = await db`
    INSERT INTO chapter_exhaustions (
      novel_id, chapter, attempt, kind, resolver_mode,
      unresolved_deviations, reviser_history
    )
    VALUES (
      ${params.novelId}, ${params.chapter}, ${params.attempt}, ${params.kind}, ${params.resolverMode},
      ${JSON.stringify(params.unresolvedDeviations)}::jsonb,
      ${params.reviserHistory ? JSON.stringify(params.reviserHistory) : null}::jsonb
    )
    RETURNING id
  `
  return (rows[0] as { id: number }).id
}

/**
 * Mark the latest unresolved row for (novelId, chapter) with a decision.
 * Called from gates.ts `resolvePlanAssist`. Matches on decided_at IS NULL
 * to avoid re-marking already-resolved rows. If there are multiple open
 * rows for the same (novelId, chapter) somehow, the newest is closed
 * first (ORDER BY fired_at DESC), since that matches "most recent gate
 * fire" semantics.
 */
export async function logExhaustionResolved(params: {
  novelId: string
  chapter: number
  decision: ExhaustionDecision
  decisionDetails?: unknown
}): Promise<boolean> {
  const rows = await db`
    UPDATE chapter_exhaustions
    SET decided_at = NOW(),
        decision = ${params.decision},
        decision_details = ${params.decisionDetails ? JSON.stringify(params.decisionDetails) : null}::jsonb
    WHERE id = (
      SELECT id FROM chapter_exhaustions
      WHERE novel_id = ${params.novelId}
        AND chapter = ${params.chapter}
        AND decided_at IS NULL
      ORDER BY fired_at DESC
      LIMIT 1
    )
    RETURNING id
  `
  return rows.length > 0
}

export async function listExhaustionsForNovel(novelId: string): Promise<ExhaustionRow[]> {
  const rows = (await db`
    SELECT id, novel_id, chapter, attempt, fired_at, kind, resolver_mode,
           unresolved_deviations, reviser_history,
           decided_at, decision, decision_details
    FROM chapter_exhaustions
    WHERE novel_id = ${novelId}
    ORDER BY chapter, fired_at
  `) as any[]

  return rows.map(r => ({
    id: r.id,
    novelId: r.novel_id,
    chapter: r.chapter,
    attempt: r.attempt,
    firedAt: new Date(r.fired_at).toISOString(),
    kind: r.kind,
    resolverMode: r.resolver_mode,
    unresolvedDeviations: r.unresolved_deviations,
    reviserHistory: r.reviser_history,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    decision: r.decision,
    decisionDetails: r.decision_details,
  }))
}
