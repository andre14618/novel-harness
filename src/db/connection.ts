import { Database } from "bun:sqlite"
import { mkdirSync, existsSync } from "node:fs"

let db: Database

export function initDB(novelId: string): void {
  const dir = `output/${novelId}`
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  db = new Database(`${dir}/novel.db`)
  db.exec("PRAGMA journal_mode=WAL")
  migrate()
}

export function getDB(): Database {
  return db
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'concept',
      seed_json TEXT NOT NULL,
      current_chapter INTEGER DEFAULT 1,
      total_chapters INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS world_bibles (
      novel_id TEXT PRIMARY KEY,
      content_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      profile_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS story_spines (
      novel_id TEXT PRIMARY KEY,
      content_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapter_outlines (
      novel_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      outline_json TEXT NOT NULL,
      PRIMARY KEY (novel_id, chapter_number)
    );

    CREATE TABLE IF NOT EXISTS chapter_drafts (
      novel_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      prose TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, chapter_number, version)
    );

    CREATE TABLE IF NOT EXISTS chapter_summaries (
      novel_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      summary TEXT NOT NULL,
      key_events_json TEXT NOT NULL,
      emotional_state TEXT NOT NULL DEFAULT '',
      open_threads_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (novel_id, chapter_number)
    );

    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      fact TEXT NOT NULL,
      category TEXT NOT NULL,
      established_in_chapter INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS character_states (
      novel_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      PRIMARY KEY (novel_id, character_id, chapter_number)
    );

    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      severity TEXT NOT NULL,
      description TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      conflicts_with TEXT,
      suggested_fix TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS validation_passes (
      novel_id TEXT NOT NULL,
      pass_number INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      issues_found INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (novel_id, pass_number, chapter_number)
    );

    -- ── World Knowledge Graph ──────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS world_systems (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      rules_json TEXT NOT NULL DEFAULT '[]',
      manifestations_json TEXT NOT NULL DEFAULT '[]',
      vocabulary_json TEXT NOT NULL DEFAULT '[]',
      constraints_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS cultures (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      values_json TEXT NOT NULL DEFAULT '[]',
      taboos_json TEXT NOT NULL DEFAULT '[]',
      speech_influences TEXT NOT NULL DEFAULT '',
      customs_json TEXT NOT NULL DEFAULT '[]',
      system_views_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS character_cultures (
      novel_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      culture_id TEXT NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'native',
      PRIMARY KEY (novel_id, character_id, culture_id)
    );

    CREATE TABLE IF NOT EXISTS character_system_awareness (
      novel_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      system_id TEXT NOT NULL,
      awareness_level TEXT NOT NULL DEFAULT 'ignorant',
      perspective TEXT NOT NULL DEFAULT '',
      chapter_established INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (novel_id, character_id, system_id)
    );

    CREATE TABLE IF NOT EXISTS relationship_states (
      novel_id TEXT NOT NULL,
      character_a TEXT NOT NULL,
      character_b TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      trust_level TEXT NOT NULL DEFAULT 'neutral',
      dynamic TEXT NOT NULL,
      tension TEXT NOT NULL DEFAULT '',
      recent_shift TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (novel_id, character_a, character_b, chapter_number)
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      chapter_number INTEGER NOT NULL,
      event TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      participants_json TEXT NOT NULL DEFAULT '[]',
      witnesses_json TEXT NOT NULL DEFAULT '[]',
      consequences TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS character_knowledge (
      id TEXT PRIMARY KEY,
      novel_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      knowledge TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      chapter_learned INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'event',
      is_false INTEGER NOT NULL DEFAULT 0
    );

    -- LLM call tracking moved to central data/harness.db
  `)

  // Add columns to existing databases
  try {
    db.exec("ALTER TABLE chapter_summaries ADD COLUMN emotional_state TEXT NOT NULL DEFAULT ''")
  } catch {}
  try {
    db.exec("ALTER TABLE chapter_summaries ADD COLUMN open_threads_json TEXT NOT NULL DEFAULT '[]'")
  } catch {}
}
