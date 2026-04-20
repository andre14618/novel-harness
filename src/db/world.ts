import db from "./connection"
import type { WorldBible, CharacterProfile, StorySpine } from "../types"

export async function saveWorldBible(novelId: string, bible: WorldBible): Promise<void> {
  await db`INSERT INTO world_bibles (novel_id, content_json) VALUES (${novelId}, ${bible})
           ON CONFLICT (novel_id) DO UPDATE SET content_json = EXCLUDED.content_json`
}

export async function getWorldBible(novelId: string): Promise<WorldBible> {
  const rows = await db`SELECT content_json FROM world_bibles WHERE novel_id = ${novelId}`
  if (!rows.length) throw new Error(`No world bible for novel ${novelId}`)
  return rows[0].content_json as WorldBible
}

export async function saveCharacter(novelId: string, profile: CharacterProfile): Promise<void> {
  await db`INSERT INTO characters (id, novel_id, name, profile_json) VALUES (${profile.id}, ${novelId}, ${profile.name}, ${profile})
           ON CONFLICT (novel_id, id) DO UPDATE SET name = EXCLUDED.name, profile_json = EXCLUDED.profile_json`
}

export async function getCharacters(novelId: string): Promise<CharacterProfile[]> {
  // ORDER BY id guarantees stable result order across runs. Prompt rendering in
  // buildBeatContext consumes this order directly, so any nondeterminism here
  // would leak into prompt bytes between A/B arms (Codex conditioning-floor
  // review leak #3, 2026-04-20).
  const rows = await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} ORDER BY id`
  return rows.map(r => r.profile_json as CharacterProfile)
}

export async function saveStorySpine(novelId: string, spine: StorySpine): Promise<void> {
  await db`INSERT INTO story_spines (novel_id, content_json) VALUES (${novelId}, ${spine})
           ON CONFLICT (novel_id) DO UPDATE SET content_json = EXCLUDED.content_json`
}

export async function getStorySpine(novelId: string): Promise<StorySpine> {
  const rows = await db`SELECT content_json FROM story_spines WHERE novel_id = ${novelId}`
  if (!rows.length) throw new Error(`No story spine for novel ${novelId}`)
  return rows[0].content_json as StorySpine
}

// ── Partial-update helpers (UI artifact edits) ───────────────────────────

const EDITABLE_CHARACTER_FIELDS = [
  "name", "role", "backstory", "traits", "speechPattern",
  "internalConflict", "avoids", "goals", "fears",
] as const

export async function updateCharacterFields(
  novelId: string,
  characterId: string,
  patch: Record<string, unknown>,
): Promise<CharacterProfile> {
  const rows = await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = ${characterId}`
  if (!rows.length) throw new Error(`Character ${characterId} not found`)
  const current = rows[0].profile_json as CharacterProfile
  const next: any = { ...current }
  for (const k of EDITABLE_CHARACTER_FIELDS) {
    if (k in patch) next[k] = patch[k]
  }
  const oldName = current.name
  const newName = next.name
  await db`UPDATE characters SET name = ${newName}, profile_json = ${next}
           WHERE novel_id = ${novelId} AND id = ${characterId}`

  if (oldName !== newName) {
    await db`UPDATE relationship_states SET character_a = ${newName}
             WHERE novel_id = ${novelId} AND character_a = ${oldName}`
    await db`UPDATE relationship_states SET character_b = ${newName}
             WHERE novel_id = ${novelId} AND character_b = ${oldName}`
  }

  return next
}

const EDITABLE_WORLD_FIELDS = [
  "setting", "timePeriod", "geography", "politicalStructure",
  "technologyConstraints", "sensoryPalette", "culture", "history",
  "socialCustoms", "rules",
] as const

export async function updateWorldBibleFields(
  novelId: string,
  patch: Record<string, unknown>,
): Promise<WorldBible> {
  const rows = await db`SELECT content_json FROM world_bibles WHERE novel_id = ${novelId}`
  if (!rows.length) throw new Error(`No world bible for novel ${novelId}`)
  const current = rows[0].content_json as WorldBible
  const next: any = { ...current }
  for (const k of EDITABLE_WORLD_FIELDS) {
    if (k in patch) next[k] = patch[k]
  }
  await db`UPDATE world_bibles SET content_json = ${next} WHERE novel_id = ${novelId}`
  return next
}

const EDITABLE_SPINE_FIELDS = ["centralConflict", "theme", "endingDirection"] as const

export async function updateStorySpineFields(
  novelId: string,
  patch: Record<string, unknown>,
): Promise<StorySpine> {
  const rows = await db`SELECT content_json FROM story_spines WHERE novel_id = ${novelId}`
  if (!rows.length) throw new Error(`No story spine for novel ${novelId}`)
  const current = rows[0].content_json as StorySpine
  const next: any = { ...current }
  for (const k of EDITABLE_SPINE_FIELDS) {
    if (k in patch) next[k] = patch[k]
  }
  await db`UPDATE story_spines SET content_json = ${next} WHERE novel_id = ${novelId}`
  return next
}
