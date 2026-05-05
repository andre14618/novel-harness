import type { ChapterOutline } from "../types"

export type FunctionalIssueSeverity = "blocker" | "warning"

/**
 * Findings emitted by the deterministic story-integrity checks. The
 * `description` and `beat_index` fields are the legacy human-readable surface
 * (consumed by `checker-blockers.ts` and the drafting retry log lines and
 * preserved verbatim across the 2026-05-04 stable-ID hardening pass).
 *
 * Optional structured ID fields are populated when the source data carries
 * the corresponding stable identifier so downstream impact-tracking surfaces
 * (`docs/stable-id-checker-coverage.md`, planning-target lookup) can join
 * findings to durable refs without parsing the description string. They are
 * additive and never replace `beat_index` or `description`.
 */
export interface FunctionalIssue {
  checker: "payoff-link-integrity" | "functional-state-grounding"
  severity: FunctionalIssueSeverity
  description: string
  beat_index: number | null
  /** Durable beatId from `enrichOutlineIds`; absent when the issue is not
   *  beat-scoped or the outline is un-enriched. */
  beatId?: string
  /** Established-fact id the payoff link references. */
  factId?: string
  /** Beat the payoff is expected to land in (0-based). */
  payoffBeatIndex?: number
  /** Durable beatId of the payoff target beat, when available. */
  payoffBeatId?: string
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
      factId: id,
      description: `Established fact id "${id}" is duplicated; payoff links cannot resolve it unambiguously.`,
    })
  }

  for (let beatIndex = 0; beatIndex < outline.scenes.length; beatIndex++) {
    const beat = outline.scenes[beatIndex]
    const beatRefFields = beatRefFieldsFor(beat)
    for (const link of beat.requiredPayoffs ?? []) {
      const factId = link.fact_id?.trim()
      if (!factId) {
        issues.push({
          checker: "payoff-link-integrity",
          severity: "blocker",
          beat_index: beatIndex,
          ...beatRefFields,
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
          ...beatRefFields,
          factId,
          description: `Beat ${beatIndex + 1} seeds payoff fact_id "${factId}", but no establishedFact with that id exists.`,
        })
        continue
      }

      if (!Number.isInteger(link.payoff_beat) || link.payoff_beat < 0 || link.payoff_beat >= outline.scenes.length) {
        issues.push({
          checker: "payoff-link-integrity",
          severity: "blocker",
          beat_index: beatIndex,
          ...beatRefFields,
          factId,
          payoffBeatIndex: link.payoff_beat,
          description: `Beat ${beatIndex + 1} payoff for "${fact}" points to invalid beat ${link.payoff_beat + 1}.`,
        })
        continue
      }

      const payoffBeat = outline.scenes[link.payoff_beat]
      const payoffRefFields = payoffBeatRefFieldsFor(payoffBeat, link.payoff_beat)

      if (link.payoff_beat <= beatIndex) {
        issues.push({
          checker: "payoff-link-integrity",
          severity: "blocker",
          beat_index: beatIndex,
          ...beatRefFields,
          factId,
          ...payoffRefFields,
          description: `Beat ${beatIndex + 1} payoff for "${fact}" points to beat ${link.payoff_beat + 1}; payoff links must resolve in a later beat.`,
        })
      }
    }
  }

  return issues
}

function beatRefFieldsFor(beat: ChapterOutline["scenes"][number]): { beatId?: string } {
  const beatId = typeof beat.beatId === "string" && beat.beatId.length > 0 ? beat.beatId : undefined
  return beatId ? { beatId } : {}
}

function payoffBeatRefFieldsFor(
  beat: ChapterOutline["scenes"][number] | undefined,
  index: number,
): { payoffBeatIndex: number; payoffBeatId?: string } {
  const out: { payoffBeatIndex: number; payoffBeatId?: string } = { payoffBeatIndex: index }
  const id = beat && typeof beat.beatId === "string" && beat.beatId.length > 0 ? beat.beatId : undefined
  if (id) out.payoffBeatId = id
  return out
}
