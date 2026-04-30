/**
 * User-prompt builder for the character-arcs extractor.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3 + the
 * Weiland canonical Lie/Truth/Want/Need formulation captured in
 * docs/research/writing-frameworks/SYNTHESIS.md §2.3.
 *
 * Input shape: per-book canonically-ordered beats with
 * (chapter_label, chapter_index) annotations on each beat — same shape
 * the promise extractor consumes, so the corpus driver can reuse the
 * normalized beats.jsonl rows without an additional projection step.
 *
 * Output shape: ONE row per main character (4-8 most-prominent
 * characters in the book). Book-scoped, NOT per-scene — mirrors the
 * promise extractor's "look at the whole novel, emit one structured
 * artifact" pattern.
 */

export interface CharacterArcsBeatRow {
  chapter_label: string
  chapter_index: number
  beat_idx: number
  scene_id: string
  summary: string
  /** Optional verbatim first sentence of the beat — gives the
   *  extractor more grounding for evidence quotes. NOT mandatory. */
  first_sentence?: string
}

export interface CharacterArcsContextInput {
  novelKey: string
  bookKey: string
  /** Beats sorted in canonical narrative order. */
  beats: CharacterArcsBeatRow[]
}

function fmtBeats(beats: CharacterArcsBeatRow[]): string {
  return beats.map(b => {
    const head = `[ch_label=${b.chapter_label} / ch_index=${b.chapter_index} / scene=${b.scene_id} / beat=${b.beat_idx}]`
    const sent = b.first_sentence ? `\n    first: ${b.first_sentence}` : ""
    return `${head} ${b.summary}${sent}`
  }).join("\n")
}

export function buildCharacterArcsContext(input: CharacterArcsContextInput): string {
  const lines: string[] = []
  lines.push(`Identify Lie/Truth/Want/Need character arcs across the FULL book "${input.bookKey}" of "${input.novelKey}".`)
  lines.push("")
  lines.push("Read the beat sequence below and identify the 4-8 most-prominent characters.")
  lines.push("Emit ONE row per main character with the canonical Weiland four-field arc.")
  lines.push("")
  lines.push("Each beat below shows: chapter label, canonical chapter index, scene id, beat index, summary.")
  lines.push("Your evidence_quote_lie and evidence_quote_truth MUST be verbatim substrings of the beat summaries shown.")
  lines.push("")
  lines.push("=== BEATS (canonical narrative order) ===")
  lines.push(fmtBeats(input.beats))
  lines.push("")
  lines.push("=== OUTPUT ===")
  lines.push("Return ONE JSON object: {\"arcs\": [...]}. No prose, no fences.")
  return lines.join("\n")
}
