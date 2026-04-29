/**
 * User-prompt builder for the McKee Gap extractor.
 *
 * Per R6 §3 + SYNTHESIS.md §2.5 + mckee-story.md §6.1: input is the
 * per-beat summary + first sentence + verbatim prose, plus the prior
 * beat's summary as the lead-in that establishes the POV's
 * expectation entering this beat. POV is pulled from the per-scene
 * brief (pairs.jsonl).
 *
 * Per-beat scope at corpus volume (Crystal Shard ~858 beats) means
 * every saved input token compounds. The prompt is intentionally
 * tight: prior-beat summary only (NOT prior-beat prose), beat
 * metadata + summary + first sentence + the beat prose under tag.
 * Common preamble + system prompt prefix-cache after beat 0.
 */

export interface McKeeGapContextInput {
  /** Beat under tag — fields drawn from the augmented beats.jsonl row. */
  beat: {
    beat_id: string
    chapter: string | number
    scene_id: string
    beat_idx: number
    summary: string
    first_sentence?: string
    /** Verbatim beat prose. evidence_quote MUST be a substring of this. */
    text: string
  }
  /** POV character resolved from pairs.jsonl `brief.pov` for this beat's scene. */
  pov: string | null
  /** Prior-beat summary in narrative order. null when this is the first
   *  beat of a chapter (driver should already have skipped these, but
   *  the prompt handles null defensively). */
  priorBeat: {
    chapter: string | number
    scene_id: string
    beat_idx: number
    summary: string
  } | null
}

export function buildMckeeGapContext(input: McKeeGapContextInput): string {
  const lines: string[] = []
  lines.push("Tag the BEAT below with McKee Gap structural metadata.")
  lines.push("")
  lines.push("=== BEAT METADATA ===")
  lines.push(`beat_id: ${input.beat.beat_id}`)
  lines.push(`chapter: ${input.beat.chapter}`)
  lines.push(`scene_id: ${input.beat.scene_id}`)
  lines.push(`beat_idx: ${input.beat.beat_idx}`)
  lines.push(`pov: ${input.pov ?? "(unspecified)"}`)
  lines.push("")

  if (input.priorBeat) {
    lines.push("=== PRIOR BEAT (lead-in — establishes the POV's expectation entering this beat) ===")
    lines.push(`[ch ${input.priorBeat.chapter} / scene ${input.priorBeat.scene_id} / beat ${input.priorBeat.beat_idx}] ${input.priorBeat.summary}`)
    lines.push("")
  } else {
    lines.push("=== PRIOR BEAT ===")
    lines.push("(none — this beat has no preceding beat in the canonical sequence)")
    lines.push("")
  }

  lines.push("=== BEAT SUMMARY ===")
  lines.push(input.beat.summary)
  lines.push("")
  if (input.beat.first_sentence) {
    lines.push("=== BEAT FIRST SENTENCE ===")
    lines.push(input.beat.first_sentence)
    lines.push("")
  }
  lines.push("=== BEAT PROSE (verbatim — your evidence_quote MUST be a substring of this) ===")
  lines.push(input.beat.text)
  lines.push("")
  lines.push("=== OUTPUT ===")
  lines.push("Return ONE JSON object matching the schema. No prose, no fences.")
  return lines.join("\n")
}
