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
