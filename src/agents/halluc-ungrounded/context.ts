import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"

/**
 * Render the grounded-context check prompt. Keeps strictly to the
 * training-shape fields from `scripts/hallucination/format-v3-two-adapters.ts`:
 *
 *   BEAT BRIEF    — summary / kind / pov / characters / setting
 *   WORLD BIBLE   — locations / cultures / systems (names only)
 *                 + From-brief: proper nouns extracted from the brief itself,
 *                   surfacing them in the shape the adapter attends best to.
 *                   The training prompt already treats brief.summary as
 *                   grounded, but the 2026-04-20 production audit found the
 *                   adapter under-attends to prose-form Summary text and
 *                   flags brief-named entities (e.g. "Heartstone" from a
 *                   Summary saying "a cursed artifact called the Heartstone").
 *                   Duplicating those entities into the names-only list
 *                   gives the adapter a second, shape-preferred signal.
 *                   See docs/halluc-v3-production-report-2026-04-20.md.
 *   SPEAKERS      — only the character profiles matching the beat,
 *                   rendered as "name: speechPattern"
 *   PROSE TO CHECK — the prose being evaluated
 *
 * Deliberate exclusions (not in training shape): goals, avoids, traits,
 * establishedFacts, resolved refs, world-bible descriptions/rules. Including
 * them would broaden the grounded surface beyond what the adapter was taught
 * to treat as ground truth.
 */

/** Common sentence-initial words that look like proper nouns after
 *  capitalization but aren't. Used to drop *single-word* matches. Kept narrow
 *  — over-filtering here re-opens the FP class we're trying to close.
 *  Titles like Marshal/Captain/Lord/Lady are excluded because standalone
 *  "Marshal" can stand in for a named Marshal, and multi-word "Marshal Vex"
 *  already escapes this filter (see the multi-word logic below). */
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

/** Sentence-starter stopwords that also need to be stripped from the FRONT
 *  of multi-word matches. E.g., "When Rynn stopped..." would otherwise
 *  surface "When Rynn" as a brief entity. "The"/"An"/"A" are NOT in this
 *  set because they legitimately start place names like "The Ashen Wastes". */
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

/** Extract capitalized multi-word proper-noun spans from a short text.
 *  Returns deduped names in order of first appearance, filtered to spans
 *  that look like real proper nouns (not sentence-initial stopwords). */
function extractProperNouns(text: string): string[] {
  if (!text) return []
  // Match a capitalized head followed by 0+ chained tokens that are either
  // low-case connectors ("of", "the", …) or additional capitalized words.
  // Examples: "Heartstone", "Iron Spine Garrison", "Baldur's Gate", "Spine of the World".
  const pattern = /\b[A-Z][A-Za-z'’\-]*(?:\s+(?:of|the|and|de|la|le|du|von|'s|[A-Z][A-Za-z'’\-]*))*\b/g
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(pattern)) {
    let raw = m[0].trim()
    // For multi-word spans that start with a sentence-starter stopword,
    // strip successive leading stopwords so "When Rynn" → "Rynn" and
    // "But Kael said" → "Kael". Repeat to handle chains like "And Then".
    while (raw.includes(" ")) {
      const firstWord = raw.slice(0, raw.indexOf(" "))
      if (!LEADING_STRIP_STOPWORDS.has(firstWord)) break
      raw = raw.slice(raw.indexOf(" ") + 1).trim()
    }
    // Now apply the full single-word stopword filter to either a genuinely
    // single-word match or the remainder after stripping.
    const isSingleWord = !raw.includes(" ")
    if (isSingleWord && PROPER_NOUN_STOPWORDS.has(raw)) continue
    // Skip spans of length < 3 — typically noise ("Go", "No").
    if (raw.length < 3) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push(raw)
  }
  return out
}

export function buildContext(
  prose: string,
  beat: SceneBeat,
  outline: ChapterOutline,
  characters: CharacterProfile[],
  worldBible: any,
): string {
  const beatChars = new Set(beat.characters.map(n => n.toLowerCase()))
  const speakers = characters
    .filter(c => beatChars.has(c.name.toLowerCase()))
    .map(c => `${c.name}: ${c.speechPattern ?? ""}`)

  const locs = (worldBible?.locations ?? []).map((l: any) => l?.name).filter(Boolean)
  const cultures = (worldBible?.cultures ?? []).map((c: any) => c?.name).filter(Boolean)
  const systems = (worldBible?.systems ?? []).map((s: any) => s?.name).filter(Boolean)

  // Extract brief-introduced proper nouns and expose them to the adapter.
  // Dedupe against the canonical bible lists so we don't echo names the
  // adapter already sees.
  const bibleKnown = new Set<string>()
  for (const n of [...locs, ...cultures, ...systems, ...beat.characters, outline.povCharacter]) {
    if (n) bibleKnown.add(String(n).toLowerCase())
  }
  const briefSources = [
    beat.description ?? "",
    outline.setting ?? "",
  ].join(" \n ")
  const briefEntities = extractProperNouns(briefSources).filter(
    e => !bibleKnown.has(e.toLowerCase()),
  )

  const briefLines = [
    `Summary: ${beat.description}`,
    `Kind: ${beat.kind ?? "action"}`,
    `POV: ${outline.povCharacter ?? ""}`,
    `Characters: ${beat.characters.join(", ")}`,
    `Setting: ${outline.setting ?? ""}`,
  ]

  return [
    "BEAT BRIEF:",
    ...briefLines.map(l => `  ${l}`),
    "",
    "WORLD BIBLE (relevant, names only):",
    `  Locations: ${locs.join(", ") || "(none)"}`,
    `  Cultures:  ${cultures.join(", ") || "(none)"}`,
    `  Systems:   ${systems.join(", ") || "(none)"}`,
    `  From-brief: ${briefEntities.join(", ") || "(none)"}`,
    "",
    "SPEAKERS:",
    ...(speakers.length > 0 ? speakers.map(s => `  ${s}`) : ["  (none)"]),
    "",
    "PROSE TO CHECK:",
    prose,
  ].join("\n")
}

// Exported for unit tests.
export { extractProperNouns }
