import type { ContinuityIssue } from "../types"
import type { BeatIssue } from "./beat-checks"

export interface AcceptedBeatCheckIssues {
  beatIndex: number
  issues: BeatIssue[]
}

export interface CheckerBlockerInput {
  acceptedBeatIssues: AcceptedBeatCheckIssues[]
  continuityIssues: ContinuityIssue[]
}

export function buildCheckerBlockerDeviations(input: CheckerBlockerInput): Array<{ description: string; beat_index: number | null }> {
  const deviations: Array<{ description: string; beat_index: number | null }> = []

  for (const accepted of input.acceptedBeatIssues) {
    for (const issue of accepted.issues) {
      if (issue.severity !== "blocker") continue
      deviations.push({
        beat_index: accepted.beatIndex,
        description: `[beat-check:${issue.source}] Beat ${accepted.beatIndex + 1}: ${issue.description}`,
      })
    }
  }

  for (const issue of input.continuityIssues) {
    if (issue.severity !== "blocker") continue
    deviations.push({
      beat_index: null,
      description: `[continuity] ${issue.description}`,
    })
  }

  return deviations
}
