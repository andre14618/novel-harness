import db from "./connection"
import type { WorldBible, CharacterProfile, StorySpine } from "../types"

type Executor = typeof db

export async function saveWorldBible(novelId: string, bible: WorldBible): Promise<void> {
  await db`INSERT INTO world_bibles (novel_id, content_json) VALUES (${novelId}, ${bible})
           ON CONFLICT (novel_id) DO UPDATE SET content_json = EXCLUDED.content_json`
}

export async function getWorldBible(
  novelId: string,
  opts: { executor?: Executor; forUpdate?: boolean } = {},
): Promise<WorldBible> {
  const executor = opts.executor ?? db
  const rows = (opts.forUpdate === true
    ? await executor`
        SELECT content_json FROM world_bibles
        WHERE novel_id = ${novelId}
        FOR UPDATE
      `
    : await executor`
        SELECT content_json FROM world_bibles
        WHERE novel_id = ${novelId}
      `) as Array<{ content_json: WorldBible }>
  if (!rows.length) throw new Error(`No world bible for novel ${novelId}`)
  return rows[0].content_json as WorldBible
}

export async function saveCharacter(novelId: string, profile: CharacterProfile): Promise<void> {
  await db`INSERT INTO characters (id, novel_id, name, profile_json) VALUES (${profile.id}, ${novelId}, ${profile.name}, ${profile})
           ON CONFLICT (novel_id, id) DO UPDATE SET name = EXCLUDED.name, profile_json = EXCLUDED.profile_json`
}

export async function getCharacters(novelId: string): Promise<CharacterProfile[]> {
  // ORDER BY id guarantees stable result order across runs. Prompt rendering in
  // buildSceneContext consumes this order directly, so any nondeterminism here
  // would leak into prompt bytes between A/B arms (Codex conditioning-floor
  // review leak #3, 2026-04-20).
  const rows = await db`SELECT profile_json FROM characters WHERE novel_id = ${novelId} ORDER BY id`
  return rows.map((r: any) => r.profile_json as CharacterProfile)
}

export async function getCharacterById(
  novelId: string,
  characterId: string,
  opts: { executor?: Executor; forUpdate?: boolean } = {},
): Promise<CharacterProfile | null> {
  const executor = opts.executor ?? db
  const rows = (opts.forUpdate === true
    ? await executor`
        SELECT profile_json FROM characters
        WHERE novel_id = ${novelId} AND id = ${characterId}
        FOR UPDATE
      `
    : await executor`
        SELECT profile_json FROM characters
        WHERE novel_id = ${novelId} AND id = ${characterId}
      `) as Array<{ profile_json: CharacterProfile }>
  return rows[0]?.profile_json ?? null
}

export async function saveStorySpine(novelId: string, spine: StorySpine): Promise<void> {
  await db`INSERT INTO story_spines (novel_id, content_json) VALUES (${novelId}, ${spine})
           ON CONFLICT (novel_id) DO UPDATE SET content_json = EXCLUDED.content_json`
}

export async function getStorySpine(
  novelId: string,
  opts: { executor?: Executor; forUpdate?: boolean } = {},
): Promise<StorySpine> {
  const executor = opts.executor ?? db
  const rows = (opts.forUpdate === true
    ? await executor`
        SELECT content_json FROM story_spines
        WHERE novel_id = ${novelId}
        FOR UPDATE
      `
    : await executor`
        SELECT content_json FROM story_spines
        WHERE novel_id = ${novelId}
      `) as Array<{ content_json: StorySpine }>
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
  executor?: typeof db,
): Promise<CharacterProfile> {
  // Codex round-4 MEDIUM 2: the rename path is multi-statement (character
  // row + two relationship_states rewrites). Without a transaction, a
  // failure on either follow-up leaves `characters.name` and
  // `relationship_states` inconsistent — and a retry then looks stale
  // because the name has already moved. We always wrap the internal work
  // in a transaction so the rename either fully applies or fully rolls
  // back. The optional `executor` lets a caller (e.g., the
  // proposal-envelope resolve route) thread its own transaction through
  // for outer atomicity (same-tx hash precondition + apply).
  if (executor === undefined) {
    return await db.begin(async (tx: typeof db) =>
      updateCharacterFields(novelId, characterId, patch, tx),
    )
  }
  const rows = await executor`SELECT profile_json FROM characters WHERE novel_id = ${novelId} AND id = ${characterId}`
  if (!rows.length) throw new Error(`Character ${characterId} not found`)
  const current = rows[0].profile_json as CharacterProfile
  const next: any = { ...current }
  for (const k of EDITABLE_CHARACTER_FIELDS) {
    if (k in patch) next[k] = patch[k]
  }
  const oldName = current.name
  const newName = next.name
  await executor`UPDATE characters SET name = ${newName}, profile_json = ${next}
           WHERE novel_id = ${novelId} AND id = ${characterId}`

  if (oldName !== newName) {
    await executor`UPDATE relationship_states SET character_a = ${newName}
             WHERE novel_id = ${novelId} AND character_a = ${oldName}`
    await executor`UPDATE relationship_states SET character_b = ${newName}
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
  executor: typeof db = db,
): Promise<WorldBible> {
  const rows = await executor`SELECT content_json FROM world_bibles WHERE novel_id = ${novelId}`
  if (!rows.length) throw new Error(`No world bible for novel ${novelId}`)
  const current = rows[0].content_json as WorldBible
  const next: any = { ...current }
  for (const k of EDITABLE_WORLD_FIELDS) {
    if (k in patch) next[k] = patch[k]
  }
  await executor`UPDATE world_bibles SET content_json = ${next} WHERE novel_id = ${novelId}`
  return next
}

const EDITABLE_SPINE_FIELDS = ["centralConflict", "theme", "endingDirection"] as const

export async function updateStorySpineFields(
  novelId: string,
  patch: Record<string, unknown>,
  executor: typeof db = db,
): Promise<StorySpine> {
  const rows = await executor`SELECT content_json FROM story_spines WHERE novel_id = ${novelId}`
  if (!rows.length) throw new Error(`No story spine for novel ${novelId}`)
  const current = rows[0].content_json as StorySpine
  const next: any = { ...current }
  for (const k of EDITABLE_SPINE_FIELDS) {
    if (k in patch) next[k] = patch[k]
  }
  await executor`UPDATE story_spines SET content_json = ${next} WHERE novel_id = ${novelId}`
  return next
}
