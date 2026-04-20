import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { extractProperNouns } from "../../phases/beat-entity-list"

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
 *                 + Beat-entities (V1+ only): derived proper nouns from
 *                   outline.establishedFacts + prior-beat description,
 *                   per docs/charters/beat-entity-list-v1.md. Off by
 *                   default; caller toggles via the `beatEntities`
 *                   parameter.
 *   SPEAKERS      — only the character profiles matching the beat,
 *                   rendered as "name: speechPattern"
 *   PROSE TO CHECK — the prose being evaluated
 */

export function buildContext(
  prose: string,
  beat: SceneBeat,
  outline: ChapterOutline,
  characters: CharacterProfile[],
  worldBible: any,
  opts?: { beatEntities?: string[] },
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

  // Beat-entities toggle — charter V1+. Dedupe against bible AND brief
  // so the line carries only *additional* grounding signal. Empty list
  // means the caller didn't enable the toggle; omit the sub-line entirely
  // so V0 prompts stay byte-identical with the 2026-04-20 shipped shape.
  const briefKnown = new Set(briefEntities.map(e => e.toLowerCase()))
  const beatEntitiesFiltered = (opts?.beatEntities ?? []).filter(e => {
    const k = e.toLowerCase()
    return !bibleKnown.has(k) && !briefKnown.has(k)
  })

  const briefLines = [
    `Summary: ${beat.description}`,
    `Kind: ${beat.kind ?? "action"}`,
    `POV: ${outline.povCharacter ?? ""}`,
    `Characters: ${beat.characters.join(", ")}`,
    `Setting: ${outline.setting ?? ""}`,
  ]

  const worldBibleBlock = [
    "WORLD BIBLE (relevant, names only):",
    `  Locations: ${locs.join(", ") || "(none)"}`,
    `  Cultures:  ${cultures.join(", ") || "(none)"}`,
    `  Systems:   ${systems.join(", ") || "(none)"}`,
    `  From-brief: ${briefEntities.join(", ") || "(none)"}`,
  ]
  if (opts?.beatEntities !== undefined) {
    worldBibleBlock.push(`  Beat-entities: ${beatEntitiesFiltered.join(", ") || "(none)"}`)
  }

  return [
    "BEAT BRIEF:",
    ...briefLines.map(l => `  ${l}`),
    "",
    ...worldBibleBlock,
    "",
    "SPEAKERS:",
    ...(speakers.length > 0 ? speakers.map(s => `  ${s}`) : ["  (none)"]),
    "",
    "PROSE TO CHECK:",
    prose,
  ].join("\n")
}

// Re-exported for unit tests (historical location).
export { extractProperNouns }
