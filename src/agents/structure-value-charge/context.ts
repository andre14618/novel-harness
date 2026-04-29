/**
 * User-prompt builder for the value-charge extractor.
 *
 * Per R6 §3: input is the per-scene brief (from `pairs.jsonl`) plus
 * the ±1-chapter beat context surrounding the scene. We give the
 * extractor enough context to disambiguate polarity (the scene's
 * own prose can be misleading without knowing where it sits in the
 * arc) without dumping the whole novel.
 */

export interface ValueChargeContextInput {
  /** Scene brief from pairs.jsonl — narrative-summary shape. */
  brief: {
    summary: string
    beat_id: string
    chapter: string | number
    characters?: string[]
    pov?: string | null
    setting?: string | null
    tone?: string | null
  }
  /** Verbatim prose for the scene under tag. */
  prose: string
  /** Beats from the previous chapter (canonical-ordered), ≤ 8 most-recent. */
  prevChapterBeats: Array<{ chapter: string | number; summary: string }>
  /** Beats from the next chapter (canonical-ordered), ≤ 8 first beats. */
  nextChapterBeats: Array<{ chapter: string | number; summary: string }>
}

function fmtBeat(b: { chapter: string | number; summary: string }): string {
  return `  - [ch ${b.chapter}] ${b.summary}`
}

export function buildValueChargeContext(input: ValueChargeContextInput): string {
  const lines: string[] = []
  lines.push("Tag the SCENE below with value-charge structural metadata.")
  lines.push("")
  lines.push("=== SCENE METADATA ===")
  lines.push(`beat_id: ${input.brief.beat_id}`)
  lines.push(`chapter: ${input.brief.chapter}`)
  if (input.brief.pov) lines.push(`pov: ${input.brief.pov}`)
  if (input.brief.characters?.length) lines.push(`characters: ${input.brief.characters.join(", ")}`)
  if (input.brief.setting) lines.push(`setting: ${input.brief.setting}`)
  if (input.brief.tone) lines.push(`tone: ${input.brief.tone}`)
  lines.push("")
  lines.push(`brief_summary: ${input.brief.summary}`)
  lines.push("")

  if (input.prevChapterBeats.length) {
    lines.push("=== PREVIOUS CHAPTER (last beats — leading-in context) ===")
    for (const b of input.prevChapterBeats.slice(-8)) lines.push(fmtBeat(b))
    lines.push("")
  }

  lines.push("=== SCENE PROSE (verbatim — your evidence_quote MUST be a substring of this) ===")
  lines.push(input.prose)
  lines.push("")

  if (input.nextChapterBeats.length) {
    lines.push("=== NEXT CHAPTER (first beats — leading-out context) ===")
    for (const b of input.nextChapterBeats.slice(0, 8)) lines.push(fmtBeat(b))
    lines.push("")
  }

  lines.push("=== OUTPUT ===")
  lines.push("Return ONE JSON object matching the schema. No prose, no fences.")
  return lines.join("\n")
}
