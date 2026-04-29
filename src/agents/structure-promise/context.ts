/**
 * User-prompt builders for the promise extractor (R6 §3 two-pass).
 *
 * Pass 1 (open) input shape: per-book canonically-ordered beats with
 * (chapter_label, chapter_index) annotations on each beat so the
 * extractor's output can echo both fields back unchanged.
 *
 * Pass 2 (closure) input shape: same beats + the open-pass output list,
 * joined by promise_id for closure decisions.
 */

import type { OpenPromise } from "./schema"

export interface PromiseBeatRow {
  chapter_label: string
  chapter_index: number
  beat_idx: number
  scene_id: string
  summary: string
  /** Optional verbatim first sentence of the beat — gives the extractor
   *  more grounding for evidence quotes. Trimmed; NOT mandatory. */
  first_sentence?: string
}

export interface PromiseOpenContextInput {
  novelKey: string
  bookKey: string
  /** Beats sorted in canonical narrative order. */
  beats: PromiseBeatRow[]
}

export interface PromiseCloseContextInput {
  novelKey: string
  bookKey: string
  beats: PromiseBeatRow[]
  openPromises: OpenPromise[]
}

function fmtBeats(beats: PromiseBeatRow[]): string {
  return beats.map(b => {
    const head = `[ch_label=${b.chapter_label} / ch_index=${b.chapter_index} / scene=${b.scene_id} / beat=${b.beat_idx}]`
    const sent = b.first_sentence ? `\n    first: ${b.first_sentence}` : ""
    return `${head} ${b.summary}${sent}`
  }).join("\n")
}

export function buildPromiseOpenContext(input: PromiseOpenContextInput): string {
  const lines: string[] = []
  lines.push(`Identify promises across the FULL book "${input.bookKey}" of "${input.novelKey}".`)
  lines.push("")
  lines.push("Each beat below shows: chapter label, canonical chapter index, scene id, beat index, summary.")
  lines.push("Echo BOTH chapter_label and chapter_index verbatim into your output for the opening beat of each promise.")
  lines.push("")
  lines.push("=== BEATS (canonical narrative order) ===")
  lines.push(fmtBeats(input.beats))
  lines.push("")
  lines.push("=== OUTPUT ===")
  lines.push("Return ONE JSON object: {\"promises\": [...]}. No prose, no fences.")
  return lines.join("\n")
}

export function buildPromiseCloseContext(input: PromiseCloseContextInput): string {
  const lines: string[] = []
  lines.push(`Closure pass for book "${input.bookKey}" of "${input.novelKey}".`)
  lines.push("")
  lines.push("=== OPEN PROMISES (from pass 1 — emit ONE closure per row, matched by promise_id) ===")
  for (const p of input.openPromises) {
    lines.push(`- ${p.promise_id} | opened ch_label=${p.opened_chapter_label} ch_index=${p.opened_chapter_index} | "${p.promise_text}"`)
  }
  lines.push("")
  lines.push("=== BEATS (canonical narrative order — search for closure here) ===")
  lines.push(fmtBeats(input.beats))
  lines.push("")
  lines.push("=== OUTPUT ===")
  lines.push("Return ONE JSON object: {\"closures\": [...]}. EVERY input promise_id MUST appear in closures (open-at-end-of-book emits null fields).")
  return lines.join("\n")
}
