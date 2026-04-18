import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"

/**
 * Render the grounded-context check prompt. Keeps strictly to the
 * training-shape fields from `scripts/hallucination/format-v3-two-adapters.ts`:
 *
 *   BEAT BRIEF    — summary / kind / pov / characters / setting
 *   WORLD BIBLE   — locations / cultures / systems (names only)
 *   SPEAKERS      — only the character profiles matching the beat,
 *                   rendered as "name: speechPattern"
 *   PROSE TO CHECK — the prose being evaluated
 *
 * Deliberate exclusions (not in training shape): goals, avoids, traits,
 * establishedFacts, resolved refs, world-bible descriptions/rules. Including
 * them would broaden the grounded surface beyond what the adapter was taught
 * to treat as ground truth.
 */
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
    "",
    "SPEAKERS:",
    ...(speakers.length > 0 ? speakers.map(s => `  ${s}`) : ["  (none)"]),
    "",
    "PROSE TO CHECK:",
    prose,
  ].join("\n")
}
