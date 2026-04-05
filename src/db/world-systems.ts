import { getDB } from "./connection"

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

export function saveWorldSystem(novelId: string, system: WorldSystem): void {
  getDB().prepare(
    `INSERT OR REPLACE INTO world_systems (id, novel_id, name, type, description, rules_json, manifestations_json, vocabulary_json, constraints_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    system.id, novelId, system.name, system.type, system.description,
    JSON.stringify(system.rules), JSON.stringify(system.manifestations),
    JSON.stringify(system.vocabulary), JSON.stringify(system.constraints),
  )
}

export function getWorldSystems(novelId: string): WorldSystem[] {
  const rows = getDB().prepare("SELECT * FROM world_systems WHERE novel_id = ?").all(novelId) as any[]
  return rows.map(r => ({
    id: r.id, name: r.name, type: r.type, description: r.description,
    rules: JSON.parse(r.rules_json), manifestations: JSON.parse(r.manifestations_json),
    vocabulary: JSON.parse(r.vocabulary_json), constraints: JSON.parse(r.constraints_json),
  }))
}

export function getWorldSystem(novelId: string, systemId: string): WorldSystem | null {
  const r = getDB().prepare("SELECT * FROM world_systems WHERE novel_id = ? AND id = ?").get(novelId, systemId) as any
  if (!r) return null
  return {
    id: r.id, name: r.name, type: r.type, description: r.description,
    rules: JSON.parse(r.rules_json), manifestations: JSON.parse(r.manifestations_json),
    vocabulary: JSON.parse(r.vocabulary_json), constraints: JSON.parse(r.constraints_json),
  }
}

// ── Cultures ───────────────────────────────────────────────────────────────

export function saveCulture(novelId: string, culture: Culture): void {
  getDB().prepare(
    `INSERT OR REPLACE INTO cultures (id, novel_id, name, description, values_json, taboos_json, speech_influences, customs_json, system_views_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    culture.id, novelId, culture.name, culture.description,
    JSON.stringify(culture.values), JSON.stringify(culture.taboos),
    culture.speechInfluences, JSON.stringify(culture.customs),
    JSON.stringify(culture.systemViews),
  )
}

export function getCultures(novelId: string): Culture[] {
  const rows = getDB().prepare("SELECT * FROM cultures WHERE novel_id = ?").all(novelId) as any[]
  return rows.map(r => ({
    id: r.id, name: r.name, description: r.description,
    values: JSON.parse(r.values_json), taboos: JSON.parse(r.taboos_json),
    speechInfluences: r.speech_influences, customs: JSON.parse(r.customs_json),
    systemViews: JSON.parse(r.system_views_json),
  }))
}

export function getCulture(novelId: string, cultureId: string): Culture | null {
  const r = getDB().prepare("SELECT * FROM cultures WHERE novel_id = ? AND id = ?").get(novelId, cultureId) as any
  if (!r) return null
  return {
    id: r.id, name: r.name, description: r.description,
    values: JSON.parse(r.values_json), taboos: JSON.parse(r.taboos_json),
    speechInfluences: r.speech_influences, customs: JSON.parse(r.customs_json),
    systemViews: JSON.parse(r.system_views_json),
  }
}

// ── Character ↔ Culture ────────────────────────────────────────────────────

export function saveCharacterCulture(novelId: string, cc: CharacterCulture): void {
  getDB().prepare(
    `INSERT OR REPLACE INTO character_cultures (novel_id, character_id, culture_id, relationship) VALUES (?, ?, ?, ?)`
  ).run(novelId, cc.characterId, cc.cultureId, cc.relationship)
}

export function getCharacterCultures(novelId: string, characterId: string): (CharacterCulture & { culture: Culture })[] {
  const rows = getDB().prepare(
    `SELECT cc.*, c.name, c.description, c.values_json, c.taboos_json, c.speech_influences, c.customs_json, c.system_views_json
     FROM character_cultures cc JOIN cultures c ON cc.culture_id = c.id AND cc.novel_id = c.novel_id
     WHERE cc.novel_id = ? AND cc.character_id = ?`
  ).all(novelId, characterId) as any[]
  return rows.map(r => ({
    characterId: r.character_id, cultureId: r.culture_id, relationship: r.relationship,
    culture: {
      id: r.culture_id, name: r.name, description: r.description,
      values: JSON.parse(r.values_json), taboos: JSON.parse(r.taboos_json),
      speechInfluences: r.speech_influences, customs: JSON.parse(r.customs_json),
      systemViews: JSON.parse(r.system_views_json),
    },
  }))
}

// ── Character ↔ System Awareness ───────────────────────────────────────────

export function saveCharacterSystemAwareness(novelId: string, csa: CharacterSystemAwareness): void {
  getDB().prepare(
    `INSERT OR REPLACE INTO character_system_awareness (novel_id, character_id, system_id, awareness_level, perspective, chapter_established)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(novelId, csa.characterId, csa.systemId, csa.awarenessLevel, csa.perspective, csa.chapterEstablished)
}

export function getCharacterSystemAwareness(novelId: string, characterId: string): (CharacterSystemAwareness & { system: WorldSystem })[] {
  const rows = getDB().prepare(
    `SELECT csa.*, ws.name, ws.type, ws.description, ws.rules_json, ws.manifestations_json, ws.vocabulary_json, ws.constraints_json
     FROM character_system_awareness csa JOIN world_systems ws ON csa.system_id = ws.id AND csa.novel_id = ws.novel_id
     WHERE csa.novel_id = ? AND csa.character_id = ?`
  ).all(novelId, characterId) as any[]
  return rows.map(r => ({
    characterId: r.character_id, systemId: r.system_id,
    awarenessLevel: r.awareness_level, perspective: r.perspective,
    chapterEstablished: r.chapter_established,
    system: {
      id: r.system_id, name: r.name, type: r.type, description: r.description,
      rules: JSON.parse(r.rules_json), manifestations: JSON.parse(r.manifestations_json),
      vocabulary: JSON.parse(r.vocabulary_json), constraints: JSON.parse(r.constraints_json),
    },
  }))
}
