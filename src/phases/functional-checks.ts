import type { ChapterOutline } from "../types"

export type FunctionalIssueSeverity = "blocker" | "warning"

export interface FunctionalIssue {
  checker: "payoff-link-integrity" | "functional-state-grounding"
  severity: FunctionalIssueSeverity
  description: string
  beat_index: number | null
}

export interface FunctionalCheckResult {
  pass: boolean
  issues: FunctionalIssue[]
}

export interface RunFunctionalStoryChecksInput {
  outline: ChapterOutline
}

export function runFunctionalStoryChecks(input: RunFunctionalStoryChecksInput): FunctionalCheckResult {
  const issues = checkPayoffLinks(input.outline)
  return { pass: issues.every(i => i.severity !== "blocker"), issues }
}

function checkPayoffLinks(outline: ChapterOutline): FunctionalIssue[] {
  const issues: FunctionalIssue[] = []
  const factById = new Map<string, string>()
  const duplicateFactIds = new Set<string>()

  for (const fact of outline.establishedFacts ?? []) {
    const id = fact.id?.trim()
    if (!id) continue
    if (factById.has(id)) duplicateFactIds.add(id)
    factById.set(id, fact.fact)
  }

  for (const id of duplicateFactIds) {
    issues.push({
      checker: "payoff-link-integrity",
      severity: "blocker",
      beat_index: null,
      description: `Established fact id "${id}" is duplicated; payoff links cannot resolve it unambiguously.`,
    })
  }

  for (let beatIndex = 0; beatIndex < outline.scenes.length; beatIndex++) {
    const beat = outline.scenes[beatIndex]
    for (const link of beat.requiredPayoffs ?? []) {
      const factId = link.fact_id?.trim()
      if (!factId) {
        issues.push({
          checker: "payoff-link-integrity",
          severity: "blocker",
          beat_index: beatIndex,
          description: `Beat ${beatIndex + 1} has a payoff link with an empty fact_id.`,
        })
        continue
      }

      const fact = factById.get(factId)
      if (!fact) {
        issues.push({
          checker: "payoff-link-integrity",
          severity: "blocker",
          beat_index: beatIndex,
          description: `Beat ${beatIndex + 1} seeds payoff fact_id "${factId}", but no establishedFact with that id exists.`,
        })
        continue
      }

      if (!Number.isInteger(link.payoff_beat) || link.payoff_beat < 0 || link.payoff_beat >= outline.scenes.length) {
        issues.push({
          checker: "payoff-link-integrity",
          severity: "blocker",
          beat_index: beatIndex,
          description: `Beat ${beatIndex + 1} payoff for "${fact}" points to invalid beat ${link.payoff_beat + 1}.`,
        })
        continue
      }

      if (link.payoff_beat <= beatIndex) {
        issues.push({
          checker: "payoff-link-integrity",
          severity: "blocker",
          beat_index: beatIndex,
          description: `Beat ${beatIndex + 1} payoff for "${fact}" points to beat ${link.payoff_beat + 1}; payoff links must resolve in a later beat.`,
        })
      }
    }
  }

  return issues
}
