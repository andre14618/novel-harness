import type { ContinuityIssue } from "../types"
import type { BeatIssue } from "./beat-checks"
import type { FunctionalIssue } from "./functional-checks"

export interface AcceptedBeatCheckIssues {
  beatIndex: number
  beatId?: string
  issues: BeatIssue[]
}

export interface CheckerBlockerInput {
  acceptedBeatIssues: AcceptedBeatCheckIssues[]
  continuityIssues: ContinuityIssue[]
  functionalIssues?: FunctionalIssue[]
}

export interface CheckerBlockerDeviation {
  description: string
  beat_index: number | null
  beatId?: string
  metadata?: Record<string, unknown>
}

export function buildCheckerBlockerDeviations(input: CheckerBlockerInput): CheckerBlockerDeviation[] {
  const deviations: CheckerBlockerDeviation[] = []

  for (const accepted of input.acceptedBeatIssues) {
    for (const issue of accepted.issues) {
      if (issue.severity !== "blocker") continue
      deviations.push({
        beat_index: accepted.beatIndex,
        ...(accepted.beatId ? { beatId: accepted.beatId } : {}),
        description: `[beat-check:${issue.source}] Beat ${accepted.beatIndex + 1}: ${issue.description}`,
        ...(issue.metadata ? { metadata: issue.metadata } : {}),
      })
    }
  }

  // Continuity findings are diagnostic/editorial evidence. They stay visible
  // in checker-warning and action-evidence reports, but they do not block
  // Drafting or open a Plan-Assist gate on their own.

  for (const issue of input.functionalIssues ?? []) {
    if (issue.severity !== "blocker") continue
    deviations.push({
      beat_index: issue.beat_index,
      description: `[functional:${issue.checker}] ${issue.description}`,
    })
  }

  return deviations
}
