import db from "../db/connection"

type Executor = typeof db

export interface SourceDraftingIsolationState {
  phase: string | null
  currentChapter: number | null
  outlineCount: number
  draftCount: number
}

export interface SourceDraftingIsolationAssessment {
  clean: boolean
  issue: string | null
  guidance: string | null
  state: SourceDraftingIsolationState | null
}

export const DRAFTING_SOURCE_GUIDANCE =
  "Use a clean planning/drafting source, or pass an explicit contaminated-source flag when intentionally replaying generated draft state."

export async function loadSourceDraftingIsolationState(
  novelId: string,
  executor: Executor = db,
): Promise<SourceDraftingIsolationState | null> {
  const [novelRow] = await executor`
    SELECT phase, current_chapter FROM novels WHERE id = ${novelId}
  ` as Array<{ phase: string | null; current_chapter: number | null }>
  if (!novelRow) return null

  const [{ outline_count, draft_count } = { outline_count: 0, draft_count: 0 }] = await executor`
    SELECT
      (SELECT COUNT(*)::int FROM chapter_outlines WHERE novel_id = ${novelId}) AS outline_count,
      (SELECT COUNT(*)::int FROM chapter_drafts WHERE novel_id = ${novelId}) AS draft_count
  ` as Array<{ outline_count: number; draft_count: number }>

  return {
    phase: novelRow.phase,
    currentChapter: novelRow.current_chapter,
    outlineCount: outline_count ?? 0,
    draftCount: draft_count ?? 0,
  }
}

export function assessSourceDraftingIsolation(
  state: SourceDraftingIsolationState | null,
): SourceDraftingIsolationAssessment {
  if (!state) {
    return {
      clean: false,
      issue: "source novel not found",
      guidance: DRAFTING_SOURCE_GUIDANCE,
      state: null,
    }
  }
  const issue = sourceDraftingIsolationIssue(state)
  return {
    clean: issue === null,
    issue,
    guidance: issue ? DRAFTING_SOURCE_GUIDANCE : null,
    state,
  }
}

export async function loadSourceDraftingIsolationAssessment(
  novelId: string,
  executor: Executor = db,
): Promise<SourceDraftingIsolationAssessment> {
  return assessSourceDraftingIsolation(await loadSourceDraftingIsolationState(novelId, executor))
}

export function sourceDraftingIsolationIssue(state: SourceDraftingIsolationState): string | null {
  if (state.outlineCount <= 0) return "source has no chapter_outlines"
  if ((state.draftCount ?? 0) > 0) {
    return `source already has ${state.draftCount} chapter_drafts and is not a clean planning source`
  }
  const phase = state.phase ?? ""
  if (phase === "complete" || phase === "failed" || phase === "aborted") {
    return `source phase is ${phase}, not a clean planning/drafting source`
  }
  if ((state.currentChapter ?? 1) > 1) {
    return `source current_chapter is ${state.currentChapter}, not chapter 1`
  }
  return null
}

export function formatSourceDraftingIsolationAssessment(
  assessment: SourceDraftingIsolationAssessment,
): string {
  if (assessment.clean) return "clean planning/drafting source"
  return assessment.guidance
    ? `${assessment.issue}. ${assessment.guidance}`
    : assessment.issue ?? "unknown drafting source issue"
}
