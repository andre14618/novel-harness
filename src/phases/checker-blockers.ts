import type { ContinuityIssue } from "../types"
import type { SceneIssue } from "./scene-checks"
import type { FunctionalIssue } from "./functional-checks"

export interface AcceptedSceneCheckIssues {
  sceneIndex: number
  sceneId?: string
  beatId?: string
  issues: SceneIssue[]
}

export interface CheckerBlockerInput {
  acceptedSceneIssues: AcceptedSceneCheckIssues[]
  continuityIssues: ContinuityIssue[]
  functionalIssues?: FunctionalIssue[]
}

export interface CheckerBlockerDeviation {
  description: string
  beat_index: number | null
  sceneId?: string
  beatId?: string
  metadata?: Record<string, unknown>
}

export function buildCheckerBlockerDeviations(input: CheckerBlockerInput): CheckerBlockerDeviation[] {
  const deviations: CheckerBlockerDeviation[] = []

  for (const accepted of input.acceptedSceneIssues) {
    for (const issue of accepted.issues) {
      if (issue.severity !== "blocker") continue
      deviations.push({
        beat_index: accepted.sceneIndex,
        ...(accepted.sceneId ? { sceneId: accepted.sceneId } : {}),
        ...(accepted.beatId ? { beatId: accepted.beatId } : {}),
        description: `[scene-check:${issue.source}] Scene ${accepted.sceneIndex + 1}: ${issue.description}`,
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
