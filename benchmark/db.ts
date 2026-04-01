import { Database } from "bun:sqlite"
import { DIMENSIONS, type Dimension } from "./judges/schema"

const DB_PATH = new URL("./results/benchmark.db", import.meta.url).pathname

let db: Database | null = null

export function getDB(): Database {
  if (db) return db
  db = new Database(DB_PATH, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  migrate(db)
  return db
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      writer_provider TEXT NOT NULL,
      writer_model TEXT NOT NULL,
      seeds_count INTEGER NOT NULL,
      runs_per_seed INTEGER NOT NULL,
      is_baseline INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      seed TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      prose TEXT,
      word_count INTEGER,
      latency_ms INTEGER,
      tokens_per_sec REAL,
      completion_tokens INTEGER,
      passed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_id INTEGER NOT NULL REFERENCES generations(id),
      judge TEXT NOT NULL,
      dimension TEXT NOT NULL,
      score INTEGER NOT NULL,
      reasoning TEXT
    );
  `)
}

// ── Write operations ─────────────────────────────────────────────────────

export function createRun(writerProvider: string, writerModel: string, seedsCount: number, runsPerSeed: number): number {
  const db = getDB()
  const result = db.run(
    "INSERT INTO runs (writer_provider, writer_model, seeds_count, runs_per_seed) VALUES (?, ?, ?, ?)",
    [writerProvider, writerModel, seedsCount, runsPerSeed],
  )
  return Number(result.lastInsertRowid)
}

export function saveGeneration(
  runId: number, seed: string, attempt: number,
  data: { prose?: string; wordCount?: number; latencyMs?: number; tokensPerSec?: number; completionTokens?: number; passed: boolean },
): number {
  const db = getDB()
  const result = db.run(
    `INSERT INTO generations (run_id, seed, attempt, prose, word_count, latency_ms, tokens_per_sec, completion_tokens, passed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [runId, seed, attempt, data.prose ?? null, data.wordCount ?? null, data.latencyMs ?? null,
     data.tokensPerSec ?? null, data.completionTokens ?? null, data.passed ? 1 : 0],
  )
  return Number(result.lastInsertRowid)
}

export function saveScore(generationId: number, judge: string, dimension: string, score: number, reasoning: string) {
  const db = getDB()
  db.run(
    "INSERT INTO scores (generation_id, judge, dimension, score, reasoning) VALUES (?, ?, ?, ?, ?)",
    [generationId, judge, dimension, score, reasoning],
  )
}

export function markBaseline(runId: number) {
  const db = getDB()
  db.run("UPDATE runs SET is_baseline = 0 WHERE is_baseline = 1")
  db.run("UPDATE runs SET is_baseline = 1 WHERE id = ?", [runId])
}

// ── Read operations ──────────────────────────────────────────────────────

export interface DimensionAvg { dimension: string; avg: number; stddev: number }

export function getRunAverages(runId: number): DimensionAvg[] {
  const db = getDB()
  return db.query<{ dimension: string; avg: number; stddev: number }, [number]>(`
    SELECT s.dimension,
           ROUND(AVG(s.score), 1) as avg,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score)), 1) as stddev
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ? AND g.passed = 1
    GROUP BY s.dimension
  `).all(runId)
}

export function getBaselineAverages(): DimensionAvg[] | null {
  const db = getDB()
  const baseline = db.query<{ id: number }, []>("SELECT id FROM runs WHERE is_baseline = 1 LIMIT 1").get()
  if (!baseline) return null
  return getRunAverages(baseline.id)
}

export function getOverallAvg(runId: number): { mean: number; stddev: number } {
  const db = getDB()
  const result = db.query<{ mean: number; stddev: number }, [number]>(`
    SELECT ROUND(AVG(s.score), 1) as mean,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score)), 1) as stddev
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ? AND g.passed = 1
  `).get(runId)
  return result ?? { mean: 0, stddev: 0 }
}

export function getWeakestGenerations(runId: number, limit: number = 3): Array<{ generationId: number; seed: string; attempt: number; avgScore: number; prose: string }> {
  const db = getDB()
  return db.query<{ generationId: number; seed: string; attempt: number; avgScore: number; prose: string }, [number, number]>(`
    SELECT g.id as generationId, g.seed, g.attempt,
           ROUND(AVG(s.score), 1) as avgScore, g.prose
    FROM generations g
    JOIN scores s ON s.generation_id = g.id
    WHERE g.run_id = ? AND g.passed = 1
    GROUP BY g.id
    ORDER BY avgScore ASC
    LIMIT ?
  `).all(runId, limit)
}

export function getScoresForGeneration(generationId: number): Array<{ judge: string; dimension: string; score: number; reasoning: string }> {
  const db = getDB()
  return db.query<{ judge: string; dimension: string; score: number; reasoning: string }, [number]>(
    "SELECT judge, dimension, score, reasoning FROM scores WHERE generation_id = ?",
  ).all(generationId)
}

export function getPerSeedAverages(runId: number): Array<{ seed: string; dimension: string; avg: number }> {
  const db = getDB()
  return db.query<{ seed: string; dimension: string; avg: number }, [number]>(`
    SELECT g.seed, s.dimension, ROUND(AVG(s.score), 1) as avg
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ? AND g.passed = 1
    GROUP BY g.seed, s.dimension
    ORDER BY g.seed, s.dimension
  `).all(runId)
}

export function getRecentRuns(limit: number = 10): Array<{ id: number; timestamp: string; writerModel: string; isBaseline: boolean; mean: number }> {
  const db = getDB()
  return db.query<{ id: number; timestamp: string; writerModel: string; isBaseline: number; mean: number }, [number]>(`
    SELECT r.id, r.timestamp, r.writer_model as writerModel, r.is_baseline as isBaseline,
           ROUND(AVG(s.score), 1) as mean
    FROM runs r
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    WHERE g.passed = 1
    GROUP BY r.id
    ORDER BY r.timestamp DESC
    LIMIT ?
  `).all(limit).map(r => ({ ...r, isBaseline: Boolean(r.isBaseline) }))
}
