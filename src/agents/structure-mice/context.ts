/**
 * User-prompt builder for the MICE-per-scene extractor.
 *
 * Per R6 §3 + the SYNTHESIS.md §1 "Sanderson MICE-as-balanced-parens"
 * convergence: input is the per-scene brief (from `pairs.jsonl`) plus the
 * ±1-chapter beat context surrounding the scene. The MICE judgment needs
 * the surrounding chapter context to disambiguate "did this scene open
 * a new thread" vs. "did it merely progress one already open" — the
 * scene's own prose looks identical in both cases.
 *
 * Inputs are identical to the value-charge extractor's by design (R6 §3
 * "extractor decomposability"); this keeps the gold-set sampler and
 * calibration script reusable across the two per-scene extractors.
 */

export interface MiceContextInput {
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

export function buildMiceContext(input: MiceContextInput): string {
  const lines: string[] = []
  lines.push("Tag the SCENE below with MICE-thread structural metadata (Sanderson).")
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
