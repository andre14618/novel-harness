import type { ChapterOutline } from "../types"
import type { ChapterPlanCheckResult } from "../agents/chapter-plan-checker/schema"
import { findEntryByObligationIds } from "./validation-routing"

/**
 * Route chapter-plan-checker deviations to the outline entry that should be
 * rewritten. Beat-indexed deviations remain the primary path; scene-shaped
 * deviations can route by exact obligation ID before falling back to the
 * legacy chapter-level rules.
 */
export function routeChapterPlanDeviations(
  result: Pick<ChapterPlanCheckResult, "deviations" | "setting_match" | "emotional_arc_correct">,
  outline: ChapterOutline,
): Map<number, string[]> {
  const devs = result.deviations ?? []
  const perEntry = new Map<number, string[]>()
  const addTo = (idx: number, desc: string) => {
    if (idx < 0 || idx >= outline.scenes.length) return
    const list = perEntry.get(idx) ?? []
    list.push(desc)
    perEntry.set(idx, list)
  }
  const routed = new Set<number>()

  for (let i = 0; i < devs.length; i++) {
    const d = devs[i]!
    if (d.beat_index != null) {
      addTo(d.beat_index, d.description)
      routed.add(i)
      continue
    }
    if (d.obligationIds && d.obligationIds.length > 0) {
      const targetIndex = findEntryByObligationIds(outline, d.obligationIds)
      if (targetIndex !== null) {
        addTo(targetIndex, d.description)
        routed.add(i)
      }
    }
  }

  const hasUnroutedChapterLevel = devs.some((d, i) => d.beat_index == null && !routed.has(i))
  if (hasUnroutedChapterLevel || (result.setting_match && !result.setting_match.matches)) {
    if (result.setting_match && !result.setting_match.matches) {
      addTo(0, `Chapter setting mismatch — planned "${result.setting_match.planned}" but prose observed "${result.setting_match.observed}"`)
    }
  }

  if (result.emotional_arc_correct === false) {
    const lastN = outline.scenes.length >= 12 ? 3 : 2
    for (let i = outline.scenes.length - lastN; i < outline.scenes.length; i++) {
      addTo(i, "Emotional arc reversed from plan — the closing beats should land the planned emotion direction, not invert it")
    }
  }

  for (let i = 0; i < devs.length; i++) {
    const d = devs[i]!
    if (
      d.beat_index == null
      && !routed.has(i)
      && result.setting_match?.matches !== false
      && result.emotional_arc_correct !== false
    ) {
      addTo(0, d.description)
    }
  }

  return perEntry
}
