import db from "../../data/connection"
import type { WorldBible, CharacterProfile, StorySpine } from "../types"

export async function saveWorldBible(novelId: string, bible: WorldBible): Promise<void> {
  await db`INSERT INTO world_bibles (novel_id, content_json) VALUES (${novelId}, ${JSON.stringify(bible)})
           ON CONFLICT (novel_id) DO UPDATE SET content_json = EXCLUDED.content_json`
}

export async function getWorldBible(novelId: string): Promise<WorldBible> {
  const rows = await db`SELECT content_json FROM world_bibles WHERE novel_id = ${novelId}`
  if (!rows.length) throw new Error(`No world bible for novel ${novelId}`)
  return rows[0].content_json as WorldBible
}

export async function saveCharacter(novelId: string, profile: CharacterProfile): Promise<void> {
  await db`INSERT INTO characters (id, novel_id, name, profile_json) VALUES (${profile.id}, ${novelId}, ${profile.name}, ${JSON.stringify(profile)})
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, profile_json = EXCLUDED.profile_json`
}

export async function getCharacters(novelId: string): Promise<CharacterProfile[]> {
  const rows = await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId}`
  return rows.map(r => r.profile_json as CharacterProfile)
}

export async function saveStorySpine(novelId: string, spine: StorySpine): Promise<void> {
  await db`INSERT INTO story_spines (novel_id, content_json) VALUES (${novelId}, ${JSON.stringify(spine)})
           ON CONFLICT (novel_id) DO UPDATE SET content_json = EXCLUDED.content_json`
}

export async function getStorySpine(novelId: string): Promise<StorySpine> {
  const rows = await db`SELECT content_json FROM story_spines WHERE novel_id = ${novelId}`
  if (!rows.length) throw new Error(`No story spine for novel ${novelId}`)
  return rows[0].content_json as StorySpine
}
