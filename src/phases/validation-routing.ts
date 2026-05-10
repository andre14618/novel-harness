import type { ChapterOutline, ValidationFinding } from "../types"

/**
 * Route validation blockers to specific beat indices for targeted rewrites.
 * Structured findings are the source of truth when they match the current
 * blocker descriptions; legacy string parsing remains as a fallback for older
 * callers and forced-test blockers.
 */
export function routeValidationBlockers(
  blockers: string[],
  outline: ChapterOutline,
  beatProses: string[],
  findings: readonly ValidationFinding[] = [],
): Map<number, string[]> {
  const routedFromFindings = routeValidationFindings(blockers, outline, beatProses, findings)
  if (routedFromFindings.size > 0) return routedFromFindings
  return routeLegacyValidationBlockers(blockers, outline, beatProses)
}

function routeValidationFindings(
  blockers: string[],
  outline: ChapterOutline,
  beatProses: string[],
  findings: readonly ValidationFinding[],
): Map<number, string[]> {
  const blockerDescriptions = new Set(blockers)
  const perBeat = new Map<number, string[]>()
  const addTo = addIssueToBeat(perBeat, outline)

  for (const finding of findings) {
    if (finding.severity !== "blocker") continue
    if (!blockerDescriptions.has(finding.description)) continue

    if (typeof finding.beatIndex === "number") {
      addTo(finding.beatIndex, formatFindingRewriteInstruction(finding))
      continue
    }

    // L098 Slice 3: prefer obligation-ID lookup when the finding carries
    // exact refs — this is the scene-satisfaction routing path. Closes the
    // silent-no-op risk where a scene-keyed finding without beatIndex
    // would default to beat 0. Skips when no obligation match is found
    // (falls through to the legacy switch below).
    if (finding.obligationIds && finding.obligationIds.length > 0) {
      const targetIndex = findEntryByObligationIds(outline, finding.obligationIds)
      if (targetIndex !== null) {
        addTo(targetIndex, formatFindingRewriteInstruction(finding))
        continue
      }
    }

    switch (finding.code) {
      case "pov_missing": {
        addTo(selectPovBeatIndex(outline), `POV character "${outline.povCharacter}" must be dramatized — ensure this beat puts "${outline.povCharacter}" on the page by name or clear referent.`)
        break
      }
      default:
        addTo(0, `Validation issue: ${finding.description}`)
    }
  }

  return perBeat
}

// L098 Slice 3: locate the entry whose obligations include any of the
// listed obligationIds. Used by validation and chapter-plan routing when a
// scene-satisfaction finding has no beatIndex but carries exact obligation
// refs. Returns null when no entry matches — caller falls through to legacy
// routing.
export function findEntryByObligationIds(outline: ChapterOutline, obligationIds: string[]): number | null {
  if (obligationIds.length === 0) return null
  const targets = new Set(obligationIds)
  const scenes = outline.scenes ?? []
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]
    if (!scene?.obligations) continue
    const keys = ["mustEstablish", "mustPayOff", "mustTransferKnowledge", "mustShowStateChange", "mustNotReveal"] as const
    for (const key of keys) {
      const items = (scene.obligations as Record<string, unknown>)[key]
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const oid = (item as { obligationId?: unknown }).obligationId
        if (typeof oid === "string" && targets.has(oid)) return i
      }
    }
  }
  return null
}

function routeLegacyValidationBlockers(
  blockers: string[],
  outline: ChapterOutline,
  beatProses: string[],
): Map<number, string[]> {
  const perBeat = new Map<number, string[]>()
  const addTo = addIssueToBeat(perBeat, outline)

  for (const blocker of blockers) {
    if (blocker.startsWith("POV character") && blocker.includes("never mentioned")) {
      addTo(selectPovBeatIndex(outline), `POV character "${outline.povCharacter}" must be dramatized — ensure this beat puts "${outline.povCharacter}" on the page by name or clear referent.`)
    } else {
      // Unknown blocker type — append to beat 0 as last resort
      addTo(0, `Validation issue: ${blocker}`)
    }
  }

  return perBeat
}

function addIssueToBeat(
  perBeat: Map<number, string[]>,
  outline: ChapterOutline,
): (idx: number, desc: string) => void {
  return (idx, desc) => {
    if (idx < 0 || idx >= outline.scenes.length) return
    const list = perBeat.get(idx) ?? []
    list.push(desc)
    perBeat.set(idx, list)
  }
}

function selectPovBeatIndex(outline: ChapterOutline): number {
  const pov = outline.povCharacter
  const candidates = outline.scenes
    .map((s, i) => ({ i, castSize: s.characters?.length ?? 0, hasPov: s.characters?.includes(pov) }))
    .filter(c => c.hasPov)
    .sort((a, b) => a.castSize - b.castSize || a.i - b.i)
  return candidates[0]?.i ?? 0
}

function formatFindingRewriteInstruction(finding: ValidationFinding): string {
  switch (finding.code) {
    case "beat_keyword_missing":
    case "beat_keyword_low_coverage":
      return `Validation issue: ${finding.description}. Rewrite this beat so the planned beat is clearly present in the prose.`
    default:
      return `Validation issue: ${finding.description}`
  }
}
