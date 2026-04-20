/**
 * Shared beat-entity derivation for the beat-entity-list charter
 * (docs/charters/beat-entity-list-v1.md).
 *
 * Both the halluc-ungrounded checker (V1 toggle) and the beat writer
 * (V2 toggle) consume the same derived entity list. Centralising the
 * extractor here guarantees they see an identical view and prevents
 * the two sides from drifting when the extraction logic evolves.
 *
 * The derivation is intentionally narrow — it only reads fields both
 * V1 and V2 legitimately have at their respective call sites:
 *   - `outline.establishedFacts[*].fact`  (planner-declared grounding)
 *   - `prevBeat.description`              (within-chapter continuity)
 *
 * Per charter §3, each source is surfaced independently so the
 * mechanism-falsifier can tag fired entities with `derived_outline_fact`
 * vs `derived_prior_beat` rather than collapsing to a single `derived`
 * bucket.
 */

import type { ChapterOutline, SceneBeat } from "../types"

const PROPER_NOUN_STOPWORDS = new Set([
  "The", "A", "An",
  "He", "She", "It", "They", "We", "I", "You", "Me", "Him", "Her", "Them", "Us",
  "His", "Hers", "Its", "Their", "Our", "My", "Your", "Mine", "Yours", "Theirs",
  "This", "That", "These", "Those",
  "But", "And", "Or", "Nor", "So", "Yet", "For",
  "If", "When", "Then", "Now", "Before", "After", "While", "Until", "Since",
  "Where", "Why", "How", "What", "Who", "Whom", "Whose", "Which",
  "Perhaps", "Maybe", "Sometimes", "Always", "Never", "Often", "Once",
  "Yes", "No", "Well", "Still", "Just",
])

const LEADING_STRIP_STOPWORDS = new Set([
  "He", "She", "It", "They", "We", "I", "You",
  "His", "Her", "Their", "Our", "My", "Your",
  "This", "That", "These", "Those",
  "But", "And", "Or", "Nor", "So", "Yet",
  "If", "When", "Then", "Now", "Before", "After", "While", "Until", "Since",
  "Where", "Why", "How", "What", "Who", "Whom", "Whose", "Which",
  "Perhaps", "Maybe", "Sometimes", "Always", "Never", "Often", "Once",
  "Yes", "No", "Well", "Still", "Just",
])

/**
 * Extract capitalized multi-word proper-noun spans from a short text.
 * Returns deduped names in first-appearance order, filtered to spans
 * that look like real proper nouns (not sentence-initial stopwords).
 *
 * Moved from `src/agents/halluc-ungrounded/context.ts` (2026-04-20) so
 * both the halluc-ungrounded checker and the beat-writer can consume
 * the same extractor via `deriveBeatEntities`. The checker still
 * re-exports this symbol to preserve its existing unit tests.
 */
export function extractProperNouns(text: string): string[] {
  if (!text) return []
  const pattern = /\b[A-Z][A-Za-z'’\-]*(?:\s+(?:of|the|and|de|la|le|du|von|'s|[A-Z][A-Za-z'’\-]*))*\b/g
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(pattern)) {
    let raw = m[0].trim()
    while (raw.includes(" ")) {
      const firstWord = raw.slice(0, raw.indexOf(" "))
      if (!LEADING_STRIP_STOPWORDS.has(firstWord)) break
      raw = raw.slice(raw.indexOf(" ") + 1).trim()
    }
    const isSingleWord = !raw.includes(" ")
    if (isSingleWord && PROPER_NOUN_STOPWORDS.has(raw)) continue
    if (raw.length < 3) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push(raw)
  }
  return out
}

export interface BeatEntityDerivation {
  /** Union list across all sources, deduped, first-appearance order. */
  entities: string[]
  /** Per-source provenance. Each array is independent — an entity can
   *  appear in more than one bucket if multiple sources name it.
   *  Mechanism-falsifier reads these to tag fired entities. */
  sources: {
    derivedOutlineFact: string[]
    derivedPriorBeat: string[]
  }
}

/**
 * Derive the beat-entity list for a single beat from the planner-declared
 * fields both the checker and writer have in-hand at call time.
 *
 * Inputs:
 *   - `outline.establishedFacts[*].fact`: planner's declared grounding
 *     for the chapter — anything the planner committed to should be
 *     visible to the checker when prose legitimately references it.
 *   - `prevBeat?.description`: the immediately preceding beat in the
 *     same chapter, if any. Entities introduced there are legitimately
 *     carried forward via the writer's transition bridge.
 *
 * Does not consume `beat.description` — the checker already sees that
 * through its `From-brief` line, so re-extracting here would double
 * count without adding signal.
 */
export function deriveBeatEntities(
  _beat: SceneBeat,
  outline: ChapterOutline,
  prevBeat?: SceneBeat,
): BeatEntityDerivation {
  const factText = (outline.establishedFacts ?? [])
    .map(f => f?.fact ?? "")
    .filter(Boolean)
    .join("\n")
  const derivedOutlineFact = extractProperNouns(factText)

  const derivedPriorBeat = extractProperNouns(prevBeat?.description ?? "")

  const seen = new Set<string>()
  const entities: string[] = []
  for (const name of [...derivedOutlineFact, ...derivedPriorBeat]) {
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entities.push(name)
  }

  return {
    entities,
    sources: { derivedOutlineFact, derivedPriorBeat },
  }
}
