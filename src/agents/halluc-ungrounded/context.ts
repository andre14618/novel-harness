import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { extractProperNouns } from "../../phases/beat-entity-list"

/**
 * Build the novel-spanning character roster from the full character-agent output.
 *
 * All character names (not just those present in the current beat) are included
 * so the checker treats established novel characters as grounded, even when they
 * appear as "Lord Sorcerer Brennan" (title + full name) or "Brennan" (surname
 * alone) in prose. The four-tier normalizeForGroundedMatch logic in
 * `buildNerGroundedSet` handles title-prefix and partial-name matching.
 *
 * L20: closes the FP cluster from L17 (exp #335) where characters like
 * "Brennan", "Aldric", "Collector Marwick" were flagged as ungrounded because
 * only beat.characters (a subset) reached the grounded surface.
 */
export function buildCharacterRoster(characters: CharacterProfile[]): string[] {
  return characters
    .map(c => c.name)
    .filter(Boolean)
}

/**
 * Extract planner-emitted named entities from the chapter outline.
 *
 * The chapter outline carries names in three places that the writer may
 * reference in prose:
 *   1. `outline.setting` — the chapter's primary location (e.g. "Eastern Reach")
 *   2. `outline.scenes[*].description` — beat-level action descriptions that
 *      name locations, factions, and minor characters
 *   3. `outline.establishedFacts[*].fact` — facts the planner established that
 *      may carry named locations or characters
 *
 * `extractProperNouns` is the same RFC-extracter used for the From-brief line,
 * so its coverage matches the LLM checker's training shape.
 *
 * L20: covers locations like "Silver Street", "Temple of Mercy", "Eastern Reach"
 * that appear in beat descriptions / established facts but are absent from the
 * world-bible `locations` array.
 */
export function buildOutlineEntityList(outline: ChapterOutline): string[] {
  const corpus: string[] = [outline.setting ?? ""]
  for (const scene of outline.scenes ?? []) {
    if (scene.description) corpus.push(scene.description)
  }
  for (const fact of outline.establishedFacts ?? []) {
    if (fact.fact) corpus.push(fact.fact)
  }
  // Use ". " as separator so extractProperNouns treats each chunk as a
  // sentence boundary. " \n " would be absorbed into multi-word spans by
  // the capitalizedMultiWordRegex and produce spurious cross-chunk entries.
  const rawEntities = extractProperNouns(corpus.join(". "))
  return rawEntities
}

/**
 * Render the grounded-context check prompt. Keeps the checker bounded to a
 * writer-visible evidence surface:
 *
 *   BEAT BRIEF    — summary / kind / pov / characters / setting
 *   WORLD BIBLE   — locations / cultures / systems (names only)
 *                 + From-brief: proper nouns extracted from the brief itself,
 *                   surfacing them in the shape the checker attends best to.
 *                   The training prompt already treats brief.summary as
 *                   grounded, but the 2026-04-20 production audit found the
 *                   prior checker under-attended to prose-form Summary text and
 *                   flags brief-named entities (e.g. "Heartstone" from a
 *                   Summary saying "a cursed artifact called the Heartstone").
 *                   Duplicating those entities into the names-only list
 *                   gives the checker a second, shape-preferred signal.
 *                   See docs/halluc-v3-production-report-2026-04-20.md.
 *                 + Beat-entities (V1+ only): derived proper nouns from
 *                   outline.establishedFacts + prior-beat description,
 *                   per docs/charters/beat-entity-list-v1.md. Off by
 *                   default; caller toggles via the `beatEntities`
 *                   parameter.
 *                 + Allowed-new-entities: planner-sanctioned new named
 *                   entities the writer is permitted to introduce in
 *                   THIS beat, sourced from
 *                   `scene.obligations.allowedNewEntities`. These are
 *                   grounded for the purposes of this checker — the
 *                   planner explicitly authorized them as walk-ons /
 *                   props / minor lore introductions.
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
  opts?: {
    beatEntities?: string[]
    /** Novel-spanning character roster from character-agent outputs (L20). */
    characterRoster?: string[]
    /** Planner-emitted named entities from chapter outline text (L20). */
    outlineEntities?: string[]
  },
): string {
  const beatChars = new Set(beat.characters.map(n => n.toLowerCase()))
  const speakers = characters
    .filter(c => beatChars.has(c.name.toLowerCase()))
    .map(c => `${c.name}: ${c.speechPattern ?? ""}`)

  const locs = (worldBible?.locations ?? []).map((l: any) => l?.name).filter(Boolean)
  const cultures = (worldBible?.cultures ?? []).map((c: any) => c?.name).filter(Boolean)
  const systems = (worldBible?.systems ?? []).map((s: any) => s?.name).filter(Boolean)

  // Extract brief-introduced proper nouns and expose them to the checker.
  // Dedupe against the canonical bible lists so we don't echo names the
  // checker already sees.
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

  // Allowed-new-entities: planner-sanctioned walk-ons / props / lore
  // names the writer may introduce in this beat. Sourced from
  // `beat.obligations.allowedNewEntities` (planner schema, see
  // src/schemas/shared.ts beatObligationsSchema). Filter empties +
  // dedupe against bible / brief / beat-entities so the sub-line only
  // carries *additional* grounding signal.
  const beatEntitiesKnown = new Set(beatEntitiesFiltered.map(e => e.toLowerCase()))
  const allowedNewRaw = (beat.obligations?.allowedNewEntities ?? []) as string[]
  const allowedNewEntities = allowedNewRaw
    .map(e => (typeof e === "string" ? e.trim() : ""))
    .filter(Boolean)
    .filter(e => {
      const k = e.toLowerCase()
      return !bibleKnown.has(k) && !briefKnown.has(k) && !beatEntitiesKnown.has(k)
    })

  // Character-roster (L20): all novel characters from character-agent outputs.
  // Deduped against the already-known surface (beat.characters is a subset of
  // the roster; POV is also there) so the sub-line only carries *additional*
  // grounding signal the checker can't already see.
  const allowedNewKnown = new Set(allowedNewEntities.map(e => e.toLowerCase()))
  const characterRosterRaw = (opts?.characterRoster ?? [])
  const characterRosterFiltered = characterRosterRaw
    .map(n => (typeof n === "string" ? n.trim() : ""))
    .filter(Boolean)
    .filter(n => {
      const k = n.toLowerCase()
      return !bibleKnown.has(k) && !briefKnown.has(k) && !beatEntitiesKnown.has(k) && !allowedNewKnown.has(k)
    })

  // Outline-entities (L20): planner-emitted named entities extracted from
  // the chapter outline's setting, beat descriptions, and established facts.
  // Deduped against all prior buckets.
  const rosterKnown = new Set(characterRosterFiltered.map(e => e.toLowerCase()))
  const outlineEntitiesRaw = (opts?.outlineEntities ?? [])
  const outlineEntitiesFiltered = outlineEntitiesRaw
    .map(n => (typeof n === "string" ? n.trim() : ""))
    .filter(Boolean)
    .filter(n => {
      const k = n.toLowerCase()
      return !bibleKnown.has(k) && !briefKnown.has(k) && !beatEntitiesKnown.has(k) && !allowedNewKnown.has(k) && !rosterKnown.has(k)
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
  worldBibleBlock.push(`  Allowed-new-entities: ${allowedNewEntities.join(", ") || "(none)"}`)
  // L20: character roster and outline-entities — only added when caller provides them
  // (opts present with non-undefined values). Keeps v0/v2 context byte-identical.
  if (opts?.characterRoster !== undefined) {
    worldBibleBlock.push(`  Character-roster: ${characterRosterFiltered.join(", ") || "(none)"}`)
  }
  if (opts?.outlineEntities !== undefined) {
    worldBibleBlock.push(`  Outline-entities: ${outlineEntitiesFiltered.join(", ") || "(none)"}`)
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
