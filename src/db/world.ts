import { getDB } from "./connection"
import type { WorldBible, CharacterProfile, StorySpine } from "../types"

export function saveWorldBible(novelId: string, bible: WorldBible): void {
  getDB().prepare("INSERT OR REPLACE INTO world_bibles (novel_id, content_json) VALUES (?, ?)").run(novelId, JSON.stringify(bible))
}

export function getWorldBible(novelId: string): WorldBible {
  const row = getDB().prepare("SELECT content_json FROM world_bibles WHERE novel_id = ?").get(novelId) as any
  if (!row) throw new Error(`No world bible for novel ${novelId}`)
  return JSON.parse(row.content_json)
}

export function saveCharacter(novelId: string, profile: CharacterProfile): void {
  getDB().prepare("INSERT OR REPLACE INTO characters (id, novel_id, name, profile_json) VALUES (?, ?, ?, ?)").run(profile.id, novelId, profile.name, JSON.stringify(profile))
}

export function getCharacters(novelId: string): CharacterProfile[] {
  const rows = getDB().prepare("SELECT profile_json FROM characters WHERE novel_id = ?").all(novelId) as any[]
  return rows.map(r => JSON.parse(r.profile_json))
}

export function saveStorySpine(novelId: string, spine: StorySpine): void {
  getDB().prepare("INSERT OR REPLACE INTO story_spines (novel_id, content_json) VALUES (?, ?)").run(novelId, JSON.stringify(spine))
}

export function getStorySpine(novelId: string): StorySpine {
  const row = getDB().prepare("SELECT content_json FROM story_spines WHERE novel_id = ?").get(novelId) as any
  if (!row) throw new Error(`No story spine for novel ${novelId}`)
  return JSON.parse(row.content_json)
}
