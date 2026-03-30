import { Database } from "bun:sqlite"
import { mkdirSync, existsSync } from "node:fs"
import type {
  Phase, SeedInput, WorldBible, CharacterProfile, StorySpine,
  ChapterOutline, Fact, CharacterState, ChapterSummary, NovelState,
  ContinuityIssue,
} from "./types"

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
  `)
}

// ── Novel CRUD ─────────────────────────────────────────────────────────────

export function createNovel(id: string, seed: SeedInput): void {
  db.prepare(
    "INSERT INTO novels (id, seed_json) VALUES (?, ?)"
  ).run(id, JSON.stringify(seed))
}

export function getNovel(id: string): NovelState {
  const row = db.prepare("SELECT * FROM novels WHERE id = ?").get(id) as any
  if (!row) throw new Error(`Novel ${id} not found`)
  return {
    id: row.id,
    phase: row.phase as Phase,
    seed: JSON.parse(row.seed_json),
    currentChapter: row.current_chapter,
    totalChapters: row.total_chapters,
  }
}

export function updatePhase(novelId: string, phase: Phase): void {
  db.prepare("UPDATE novels SET phase = ?, updated_at = datetime('now') WHERE id = ?")
    .run(phase, novelId)
}

export function updateCurrentChapter(novelId: string, chapter: number): void {
  db.prepare("UPDATE novels SET current_chapter = ?, updated_at = datetime('now') WHERE id = ?")
    .run(chapter, novelId)
}

export function updateTotalChapters(novelId: string, total: number): void {
  db.prepare("UPDATE novels SET total_chapters = ?, updated_at = datetime('now') WHERE id = ?")
    .run(total, novelId)
}

// ── World Bible ────────────────────────────────────────────────────────────

export function saveWorldBible(novelId: string, bible: WorldBible): void {
  db.prepare(
    "INSERT OR REPLACE INTO world_bibles (novel_id, content_json) VALUES (?, ?)"
  ).run(novelId, JSON.stringify(bible))
}

export function getWorldBible(novelId: string): WorldBible {
  const row = db.prepare("SELECT content_json FROM world_bibles WHERE novel_id = ?").get(novelId) as any
  if (!row) throw new Error(`No world bible for novel ${novelId}`)
  return JSON.parse(row.content_json)
}

// ── Characters ─────────────────────────────────────────────────────────────

export function saveCharacter(novelId: string, profile: CharacterProfile): void {
  db.prepare(
    "INSERT OR REPLACE INTO characters (id, novel_id, name, profile_json) VALUES (?, ?, ?, ?)"
  ).run(profile.id, novelId, profile.name, JSON.stringify(profile))
}

export function getCharacters(novelId: string): CharacterProfile[] {
  const rows = db.prepare("SELECT profile_json FROM characters WHERE novel_id = ?").all(novelId) as any[]
  return rows.map(r => JSON.parse(r.profile_json))
}

// ── Story Spine ────────────────────────────────────────────────────────────

export function saveStorySpine(novelId: string, spine: StorySpine): void {
  db.prepare(
    "INSERT OR REPLACE INTO story_spines (novel_id, content_json) VALUES (?, ?)"
  ).run(novelId, JSON.stringify(spine))
}

export function getStorySpine(novelId: string): StorySpine {
  const row = db.prepare("SELECT content_json FROM story_spines WHERE novel_id = ?").get(novelId) as any
  if (!row) throw new Error(`No story spine for novel ${novelId}`)
  return JSON.parse(row.content_json)
}

// ── Chapter Outlines ───────────────────────────────────────────────────────

export function saveChapterOutline(novelId: string, outline: ChapterOutline): void {
  db.prepare(
    "INSERT OR REPLACE INTO chapter_outlines (novel_id, chapter_number, outline_json) VALUES (?, ?, ?)"
  ).run(novelId, outline.chapterNumber, JSON.stringify(outline))
}

export function getChapterOutline(novelId: string, chapterNum: number): ChapterOutline {
  const row = db.prepare(
    "SELECT outline_json FROM chapter_outlines WHERE novel_id = ? AND chapter_number = ?"
  ).get(novelId, chapterNum) as any
  if (!row) throw new Error(`No outline for chapter ${chapterNum}`)
  return JSON.parse(row.outline_json)
}

export function getChapterOutlines(novelId: string): ChapterOutline[] {
  const rows = db.prepare(
    "SELECT outline_json FROM chapter_outlines WHERE novel_id = ? ORDER BY chapter_number"
  ).all(novelId) as any[]
  return rows.map(r => JSON.parse(r.outline_json))
}

// ── Chapter Drafts ─────────────────────────────────────────────────────────

export function saveChapterDraft(novelId: string, chapterNum: number, prose: string, wordCount: number): void {
  const existing = db.prepare(
    "SELECT MAX(version) as v FROM chapter_drafts WHERE novel_id = ? AND chapter_number = ?"
  ).get(novelId, chapterNum) as any
  const version = (existing?.v ?? 0) + 1

  db.prepare(
    "INSERT INTO chapter_drafts (novel_id, chapter_number, prose, word_count, version) VALUES (?, ?, ?, ?, ?)"
  ).run(novelId, chapterNum, prose, wordCount, version)
}

export function approveChapterDraft(novelId: string, chapterNum: number): void {
  const latest = db.prepare(
    "SELECT MAX(version) as v FROM chapter_drafts WHERE novel_id = ? AND chapter_number = ?"
  ).get(novelId, chapterNum) as any
  if (!latest?.v) return

  db.prepare(
    "UPDATE chapter_drafts SET status = 'approved' WHERE novel_id = ? AND chapter_number = ? AND version = ?"
  ).run(novelId, chapterNum, latest.v)
}

// ── Chapter Summaries ──────────────────────────────────────────────────────

export function saveChapterSummary(novelId: string, chapterNum: number, summary: string, keyEvents: string[]): void {
  db.prepare(
    "INSERT OR REPLACE INTO chapter_summaries (novel_id, chapter_number, summary, key_events_json) VALUES (?, ?, ?, ?)"
  ).run(novelId, chapterNum, summary, JSON.stringify(keyEvents))
}

export function getRecentSummaries(novelId: string, chapterNum: number, count: number): ChapterSummary[] {
  const rows = db.prepare(
    "SELECT chapter_number, summary, key_events_json FROM chapter_summaries WHERE novel_id = ? AND chapter_number < ? ORDER BY chapter_number DESC LIMIT ?"
  ).all(novelId, chapterNum, count) as any[]

  return rows.reverse().map(r => ({
    chapterNumber: r.chapter_number,
    summary: r.summary,
    keyEvents: JSON.parse(r.key_events_json),
  }))
}

// ── Facts ──────────────────────────────────────────────────────────────────

export function saveFact(novelId: string, fact: Omit<Fact, "id">): void {
  const id = crypto.randomUUID()
  db.prepare(
    "INSERT INTO facts (id, novel_id, fact, category, established_in_chapter) VALUES (?, ?, ?, ?, ?)"
  ).run(id, novelId, fact.fact, fact.category, fact.establishedInChapter)
}

export function getFactsUpToChapter(novelId: string, chapterNum: number): Fact[] {
  const rows = db.prepare(
    "SELECT id, fact, category, established_in_chapter FROM facts WHERE novel_id = ? AND established_in_chapter <= ? ORDER BY established_in_chapter"
  ).all(novelId, chapterNum) as any[]

  return rows.map(r => ({
    id: r.id,
    fact: r.fact,
    category: r.category,
    establishedInChapter: r.established_in_chapter,
  }))
}

// ── Character States ───────────────────────────────────────────────────────

export function saveCharacterState(novelId: string, charId: string, chapterNum: number, state: CharacterState): void {
  db.prepare(
    "INSERT OR REPLACE INTO character_states (novel_id, character_id, chapter_number, state_json) VALUES (?, ?, ?, ?)"
  ).run(novelId, charId, chapterNum, JSON.stringify(state))
}

export function getCharacterStatesAtChapter(novelId: string, chapterNum: number): CharacterState[] {
  // Get the latest state for each character up to this chapter
  const rows = db.prepare(`
    SELECT cs.state_json FROM character_states cs
    INNER JOIN (
      SELECT character_id, MAX(chapter_number) as max_ch
      FROM character_states
      WHERE novel_id = ? AND chapter_number < ?
      GROUP BY character_id
    ) latest ON cs.character_id = latest.character_id AND cs.chapter_number = latest.max_ch
    WHERE cs.novel_id = ?
  `).all(novelId, chapterNum, novelId) as any[]

  return rows.map(r => JSON.parse(r.state_json))
}

// ── Issues ─────────────────────────────────────────────────────────────────

export function saveIssue(novelId: string, issue: { severity: string; description: string; chapter: number; conflictsWith?: string; suggestedFix?: string }): void {
  const id = crypto.randomUUID()
  db.prepare(
    "INSERT INTO issues (id, novel_id, severity, description, chapter, conflicts_with, suggested_fix) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, novelId, issue.severity, issue.description, issue.chapter, issue.conflictsWith ?? null, issue.suggestedFix ?? null)
}

export function getOpenIssues(novelId: string, chapterNum?: number): ContinuityIssue[] {
  let sql = "SELECT severity, description, conflicts_with, suggested_fix FROM issues WHERE novel_id = ? AND status = 'open'"
  const params: any[] = [novelId]

  if (chapterNum !== undefined) {
    sql += " AND chapter = ?"
    params.push(chapterNum)
  }

  const rows = db.prepare(sql).all(...params) as any[]
  return rows.map(r => ({
    severity: r.severity,
    description: r.description,
    conflictsWith: r.conflicts_with ?? undefined,
    suggestedFix: r.suggested_fix ?? undefined,
  }))
}

export function resolveIssuesForChapter(novelId: string, chapterNum: number): void {
  db.prepare(
    "UPDATE issues SET status = 'resolved' WHERE novel_id = ? AND chapter = ? AND status = 'open'"
  ).run(novelId, chapterNum)
}
