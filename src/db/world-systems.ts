import db from "../../data/connection"

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorldSystem {
  id: string
  name: string
  type: string // magic|religion|politics|economy|technology|social
  description: string
  rules: string[]
  manifestations: string[]
  vocabulary: string[]
  constraints: string[]
}

export interface Culture {
  id: string
  name: string
  description: string
  values: string[]
  taboos: string[]
  speechInfluences: string
  customs: string[]
  systemViews: Record<string, string> // systemId → perspective
}

export interface CharacterCulture {
  characterId: string
  cultureId: string
  relationship: string // native|adopted|outsider|rebel|exile
}

export interface CharacterSystemAwareness {
  characterId: string
  systemId: string
  awarenessLevel: string // ignorant|rumors|aware|practitioner|expert
  perspective: string
  chapterEstablished: number
}

// ── World Systems ──────────────────────────────────────────────────────────

export async function saveWorldSystem(novelId: string, system: WorldSystem): Promise<void> {
  await db`INSERT INTO world_systems (id, novel_id, name, type, description, rules_json, manifestations_json, vocabulary_json, constraints_json)
           VALUES (${system.id}, ${novelId}, ${system.name}, ${system.type}, ${system.description},
                   ${system.rules}, ${system.manifestations},
                   ${system.vocabulary}, ${system.constraints})
           ON CONFLICT (novel_id, id) DO UPDATE SET
             name = EXCLUDED.name, type = EXCLUDED.type, description = EXCLUDED.description,
             rules_json = EXCLUDED.rules_json, manifestations_json = EXCLUDED.manifestations_json,
             vocabulary_json = EXCLUDED.vocabulary_json, constraints_json = EXCLUDED.constraints_json`
}

export async function getWorldSystems(novelId: string): Promise<WorldSystem[]> {
  const rows = await db`SELECT * FROM world_systems WHERE novel_id = ${novelId}`
  return rows.map(mapWorldSystem)
}

export async function getWorldSystem(novelId: string, systemId: string): Promise<WorldSystem | null> {
  const rows = await db`SELECT * FROM world_systems WHERE novel_id = ${novelId} AND id = ${systemId}`
  if (!rows.length) return null
  return mapWorldSystem(rows[0])
}

function mapWorldSystem(r: any): WorldSystem {
  return {
    id: r.id, name: r.name, type: r.type, description: r.description,
    rules: r.rules_json as string[], manifestations: r.manifestations_json as string[],
    vocabulary: r.vocabulary_json as string[], constraints: r.constraints_json as string[],
  }
}

// ── Cultures ───────────────────────────────────────────────────────────────

export async function saveCulture(novelId: string, culture: Culture): Promise<void> {
  await db`INSERT INTO cultures (id, novel_id, name, description, values_json, taboos_json, speech_influences, customs_json, system_views_json)
           VALUES (${culture.id}, ${novelId}, ${culture.name}, ${culture.description},
                   ${culture.values}, ${culture.taboos},
                   ${culture.speechInfluences}, ${culture.customs},
                   ${culture.systemViews})
           ON CONFLICT (novel_id, id) DO UPDATE SET
             name = EXCLUDED.name, description = EXCLUDED.description,
             values_json = EXCLUDED.values_json, taboos_json = EXCLUDED.taboos_json,
             speech_influences = EXCLUDED.speech_influences, customs_json = EXCLUDED.customs_json,
             system_views_json = EXCLUDED.system_views_json`
}

export async function getCultures(novelId: string): Promise<Culture[]> {
  const rows = await db`SELECT * FROM cultures WHERE novel_id = ${novelId}`
  return rows.map(mapCulture)
}

export async function getCulture(novelId: string, cultureId: string): Promise<Culture | null> {
  const rows = await db`SELECT * FROM cultures WHERE novel_id = ${novelId} AND id = ${cultureId}`
  if (!rows.length) return null
  return mapCulture(rows[0])
}

function mapCulture(r: any): Culture {
  return {
    id: r.id, name: r.name, description: r.description,
    values: r.values_json as string[], taboos: r.taboos_json as string[],
    speechInfluences: r.speech_influences, customs: r.customs_json as string[],
    systemViews: r.system_views_json as Record<string, string>,
  }
}

// ── Character ↔ Culture ────────────────────────────────────────────────────

export async function saveCharacterCulture(novelId: string, cc: CharacterCulture): Promise<void> {
  await db`INSERT INTO character_cultures (novel_id, character_id, culture_id, relationship)
           VALUES (${novelId}, ${cc.characterId}, ${cc.cultureId}, ${cc.relationship})
           ON CONFLICT (novel_id, character_id, culture_id) DO UPDATE SET relationship = EXCLUDED.relationship`
}

export async function getCharacterCultures(novelId: string, characterId: string): Promise<(CharacterCulture & { culture: Culture })[]> {
  const rows = await db`
    SELECT cc.character_id, cc.culture_id, cc.relationship,
           c.name, c.description, c.values_json, c.taboos_json, c.speech_influences, c.customs_json, c.system_views_json
    FROM character_cultures cc
    JOIN cultures c ON cc.culture_id = c.id AND cc.novel_id = c.novel_id
    WHERE cc.novel_id = ${novelId} AND cc.character_id = ${characterId}`
  return rows.map(r => ({
    characterId: r.character_id, cultureId: r.culture_id, relationship: r.relationship,
    culture: {
      id: r.culture_id, name: r.name, description: r.description,
      values: r.values_json as string[], taboos: r.taboos_json as string[],
      speechInfluences: r.speech_influences, customs: r.customs_json as string[],
      systemViews: r.system_views_json as Record<string, string>,
    },
  }))
}

// ── Character ↔ System Awareness ───────────────────────────────────────────

export async function saveCharacterSystemAwareness(novelId: string, csa: CharacterSystemAwareness): Promise<void> {
  await db`INSERT INTO character_system_awareness (novel_id, character_id, system_id, awareness_level, perspective, chapter_established)
           VALUES (${novelId}, ${csa.characterId}, ${csa.systemId}, ${csa.awarenessLevel}, ${csa.perspective}, ${csa.chapterEstablished})
           ON CONFLICT (novel_id, character_id, system_id) DO UPDATE SET
             awareness_level = EXCLUDED.awareness_level, perspective = EXCLUDED.perspective,
             chapter_established = EXCLUDED.chapter_established`
}

export async function getCharacterSystemAwareness(novelId: string, characterId: string): Promise<(CharacterSystemAwareness & { system: WorldSystem })[]> {
  const rows = await db`
    SELECT csa.character_id, csa.system_id, csa.awareness_level, csa.perspective, csa.chapter_established,
           ws.name, ws.type, ws.description, ws.rules_json, ws.manifestations_json, ws.vocabulary_json, ws.constraints_json
    FROM character_system_awareness csa
    JOIN world_systems ws ON csa.system_id = ws.id AND csa.novel_id = ws.novel_id
    WHERE csa.novel_id = ${novelId} AND csa.character_id = ${characterId}`
  return rows.map(r => ({
    characterId: r.character_id, systemId: r.system_id,
    awarenessLevel: r.awareness_level, perspective: r.perspective,
    chapterEstablished: r.chapter_established,
    system: {
      id: r.system_id, name: r.name, type: r.type, description: r.description,
      rules: r.rules_json as string[], manifestations: r.manifestations_json as string[],
      vocabulary: r.vocabulary_json as string[], constraints: r.constraints_json as string[],
    },
  }))
}
