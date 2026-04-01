/**
 * Central operational database.
 *
 * Single source of truth for all LLM calls, run configs, model assignments,
 * and benchmark scores across both novel runs and benchmark runs.
 *
 * Per-novel creative content (drafts, outlines, facts) stays in output/{novelId}/novel.db.
 * This DB tracks the operational/performance layer only.
 */

import { Database } from "bun:sqlite"
import { mkdirSync, existsSync } from "node:fs"
import { AGENT_MODELS, type ModelAssignment } from "../models/roles"

const DB_DIR = new URL(".", import.meta.url).pathname
const DB_PATH = `${DB_DIR}/harness.db`

let db: Database | null = null

export function getCentralDB(): Database {
  if (db) return db
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true })
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
      run_type TEXT NOT NULL,
      run_ref TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      model_config TEXT NOT NULL,
      label TEXT
    );

    CREATE TABLE IF NOT EXISTS run_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      agent TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      agent TEXT NOT NULL,
      phase TEXT,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      temperature REAL,
      max_tokens INTEGER,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      tokens_per_sec INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      chapter INTEGER,
      seed TEXT,
      dimension TEXT,
      json_extraction_success INTEGER DEFAULT 1,
      json_extraction_retried INTEGER DEFAULT 0,
      zod_validation_success INTEGER DEFAULT 1,
      zod_errors TEXT,
      http_attempts INTEGER DEFAULT 1,
      retry_errors TEXT
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

    CREATE TABLE IF NOT EXISTS baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      benchmark_type TEXT NOT NULL UNIQUE,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      set_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tuning experiments: probes, calibrations, model shootouts
    CREATE TABLE IF NOT EXISTS tuning_experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      experiment_type TEXT NOT NULL,  -- 'probe', 'calibration', 'shootout', 'ab-test'
      description TEXT NOT NULL,
      config TEXT NOT NULL            -- JSON: models, rubrics, samples, runs, etc.
    );

    CREATE TABLE IF NOT EXISTS tuning_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL REFERENCES tuning_experiments(id),
      model TEXT NOT NULL,
      rubric TEXT NOT NULL,
      sample TEXT NOT NULL,           -- 'WEAK', 'MID', 'STRONG', or seed name
      run INTEGER NOT NULL,
      score REAL,                     -- issue count or 1-10 score depending on experiment
      issues TEXT,                    -- JSON array of issues (for penalty rubrics)
      reasoning TEXT,
      latency_ms INTEGER,
      failed INTEGER NOT NULL DEFAULT 0
    );
  `)
}

// ── Run management ───────────────────────────────────────────────────────

export function snapshotModelConfig(): string {
  return JSON.stringify(AGENT_MODELS)
}

export function createRun(runType: string, runRef?: string, label?: string): number {
  const db = getCentralDB()
  const config = snapshotModelConfig()
  const result = db.run(
    "INSERT INTO runs (run_type, run_ref, model_config, label) VALUES (?, ?, ?, ?)",
    [runType, runRef ?? null, config, label ?? null],
  )
  const runId = Number(result.lastInsertRowid)

  for (const [agent, assignment] of Object.entries(AGENT_MODELS)) {
    db.run(
      "INSERT INTO run_agents (run_id, agent, provider, model) VALUES (?, ?, ?, ?)",
      [runId, agent, assignment.provider, assignment.model],
    )
  }

  return runId
}

// ── LLM call logging ─────────────────────────────────────────────────────

export interface LLMCallData {
  agent: string
  phase?: string
  model: string
  provider: string
  temperature?: number
  maxTokens?: number
  promptTokens: number
  completionTokens: number
  latencyMs: number
  cost: number
  chapter?: number
  seed?: string
  dimension?: string
  jsonExtractionSuccess?: boolean
  jsonExtractionRetried?: boolean
  zodValidationSuccess?: boolean
  zodErrors?: string[]
  httpAttempts?: number
  retryErrors?: Array<{ status: number; delay: number }>
}

export function logLLMCall(runId: number, data: LLMCallData) {
  const db = getCentralDB()
  const tps = data.latencyMs > 0 && data.completionTokens > 0
    ? Math.round(data.completionTokens / (data.latencyMs / 1000))
    : 0

  db.run(`
    INSERT INTO llm_calls (
      run_id, agent, phase, model, provider, temperature, max_tokens,
      prompt_tokens, completion_tokens, latency_ms, tokens_per_sec, cost,
      chapter, seed, dimension,
      json_extraction_success, json_extraction_retried,
      zod_validation_success, zod_errors, http_attempts, retry_errors
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId, data.agent, data.phase ?? null, data.model, data.provider,
      data.temperature ?? null, data.maxTokens ?? null,
      data.promptTokens, data.completionTokens,
      Math.round(data.latencyMs), tps, data.cost,
      data.chapter ?? null, data.seed ?? null, data.dimension ?? null,
      (data.jsonExtractionSuccess ?? true) ? 1 : 0,
      (data.jsonExtractionRetried ?? false) ? 1 : 0,
      (data.zodValidationSuccess ?? true) ? 1 : 0,
      data.zodErrors?.length ? JSON.stringify(data.zodErrors) : null,
      data.httpAttempts ?? 1,
      data.retryErrors?.length ? JSON.stringify(data.retryErrors) : null,
    ],
  )
}

// ── Benchmark generations & scores ───────────────────────────────────────

export function saveGeneration(
  runId: number, seed: string, attempt: number,
  data: { prose?: string; wordCount?: number; latencyMs?: number; tokensPerSec?: number; completionTokens?: number; passed: boolean },
): number {
  const db = getCentralDB()
  const result = db.run(
    `INSERT INTO generations (run_id, seed, attempt, prose, word_count, latency_ms, tokens_per_sec, completion_tokens, passed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [runId, seed, attempt, data.prose ?? null, data.wordCount ?? null, data.latencyMs ?? null,
     data.tokensPerSec ?? null, data.completionTokens ?? null, data.passed ? 1 : 0],
  )
  return Number(result.lastInsertRowid)
}

export function saveScore(generationId: number, judge: string, dimension: string, score: number, reasoning: string) {
  const db = getCentralDB()
  db.run(
    "INSERT INTO scores (generation_id, judge, dimension, score, reasoning) VALUES (?, ?, ?, ?, ?)",
    [generationId, judge, dimension, score, reasoning],
  )
}

export function markBaseline(runId: number, benchmarkType: string) {
  const db = getCentralDB()
  db.run("INSERT OR REPLACE INTO baselines (benchmark_type, run_id) VALUES (?, ?)", [benchmarkType, runId])
}

// ── Query: per-run ───────────────────────────────────────────────────────

export interface DimensionAvg { dimension: string; avg: number; stddev: number }

export function getRunAverages(runId: number): DimensionAvg[] {
  const db = getCentralDB()
  return db.query<DimensionAvg, [number]>(`
    SELECT s.dimension,
           ROUND(AVG(s.score), 1) as avg,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score)), 1) as stddev
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ? AND g.passed = 1
    GROUP BY s.dimension
  `).all(runId)
}

export function getOverallAvg(runId: number): { mean: number; stddev: number } {
  const db = getCentralDB()
  const result = db.query<{ mean: number; stddev: number }, [number]>(`
    SELECT ROUND(AVG(s.score), 1) as mean,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score)), 1) as stddev
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ? AND g.passed = 1
  `).get(runId)
  return result ?? { mean: 0, stddev: 0 }
}

export function getBaselineAverages(benchmarkType: string): DimensionAvg[] | null {
  const db = getCentralDB()
  const baseline = db.query<{ run_id: number }, [string]>(
    "SELECT run_id FROM baselines WHERE benchmark_type = ?",
  ).get(benchmarkType)
  if (!baseline) return null
  return getRunAverages(baseline.run_id)
}

export function getPerSeedAverages(runId: number): Array<{ seed: string; dimension: string; avg: number }> {
  const db = getCentralDB()
  return db.query<{ seed: string; dimension: string; avg: number }, [number]>(`
    SELECT g.seed, s.dimension, ROUND(AVG(s.score), 1) as avg
    FROM scores s
    JOIN generations g ON s.generation_id = g.id
    WHERE g.run_id = ? AND g.passed = 1
    GROUP BY g.seed, s.dimension
    ORDER BY g.seed, s.dimension
  `).all(runId)
}

export function getWeakestGenerations(runId: number, limit: number = 3): Array<{
  generationId: number; seed: string; attempt: number; avgScore: number; prose: string
}> {
  const db = getCentralDB()
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
  const db = getCentralDB()
  return db.query<{ judge: string; dimension: string; score: number; reasoning: string }, [number]>(
    "SELECT judge, dimension, score, reasoning FROM scores WHERE generation_id = ?",
  ).all(generationId)
}

// ── Query: cost & TPS ────────────────────────────────────────────────────

export function getCallSummary(runId: number): Array<{
  agent: string; model: string; calls: number; totalCost: number; avgTps: number; totalPrompt: number; totalCompletion: number
}> {
  const db = getCentralDB()
  return db.query<{
    agent: string; model: string; calls: number; totalCost: number; avgTps: number; totalPrompt: number; totalCompletion: number
  }, [number]>(`
    SELECT agent, model, COUNT(*) as calls,
           ROUND(SUM(cost), 6) as totalCost,
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END)) as avgTps,
           SUM(prompt_tokens) as totalPrompt,
           SUM(completion_tokens) as totalCompletion
    FROM llm_calls WHERE run_id = ?
    GROUP BY agent, model
    ORDER BY agent, totalCost DESC
  `).all(runId)
}

// ── Query: cross-run model comparison ────────────────────────────────────

export function getRecentRuns(runType: string, limit: number = 10): Array<{
  id: number; label: string | null; runRef: string | null; timestamp: string; mean: number
}> {
  const db = getCentralDB()
  return db.query<{ id: number; label: string | null; runRef: string | null; timestamp: string; mean: number }, [string, number]>(`
    SELECT r.id, r.label, r.run_ref as runRef, r.timestamp,
           ROUND(AVG(s.score), 1) as mean
    FROM runs r
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    WHERE r.run_type = ? AND g.passed = 1
    GROUP BY r.id
    ORDER BY r.timestamp DESC
    LIMIT ?
  `).all(runType, limit)
}

export function getAgentModelScores(runType: string): Array<{
  agent: string; provider: string; model: string; runs: number; avgScore: number; avgTps: number; avgCostPerCall: number
}> {
  const db = getCentralDB()
  return db.query<{
    agent: string; provider: string; model: string; runs: number; avgScore: number; avgTps: number; avgCostPerCall: number
  }, [string]>(`
    SELECT ra.agent, ra.provider, ra.model,
           COUNT(DISTINCT r.id) as runs,
           ROUND(AVG(s.score), 1) as avgScore,
           ROUND(AVG(CASE WHEN lc.tokens_per_sec > 0 THEN lc.tokens_per_sec END)) as avgTps,
           ROUND(AVG(lc.cost), 6) as avgCostPerCall
    FROM run_agents ra
    JOIN runs r ON r.id = ra.run_id
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    LEFT JOIN llm_calls lc ON lc.run_id = r.id AND lc.agent = ra.agent
    WHERE r.run_type = ? AND g.passed = 1
    GROUP BY ra.agent, ra.provider, ra.model
    ORDER BY ra.agent, avgScore DESC
  `).all(runType)
}

export function compareRuns(runIdA: number, runIdB: number): {
  configDiff: Array<{ agent: string; from: string; to: string }>;
  scoreDiff: Array<{ dimension: string; scoreA: number; scoreB: number; delta: number }>;
  costDiff: { costA: number; costB: number; delta: number };
} {
  const db = getCentralDB()

  const runA = db.query<{ model_config: string }, [number]>("SELECT model_config FROM runs WHERE id = ?").get(runIdA)
  const runB = db.query<{ model_config: string }, [number]>("SELECT model_config FROM runs WHERE id = ?").get(runIdB)

  const configDiff: Array<{ agent: string; from: string; to: string }> = []
  if (runA && runB) {
    const a = JSON.parse(runA.model_config) as Record<string, ModelAssignment>
    const b = JSON.parse(runB.model_config) as Record<string, ModelAssignment>
    for (const agent of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ma = a[agent] ? `${a[agent].provider}/${a[agent].model}` : "—"
      const mb = b[agent] ? `${b[agent].provider}/${b[agent].model}` : "—"
      if (ma !== mb) configDiff.push({ agent, from: ma, to: mb })
    }
  }

  const avgsA = getRunAverages(runIdA)
  const avgsB = getRunAverages(runIdB)
  const allDims = new Set([...avgsA.map(a => a.dimension), ...avgsB.map(b => b.dimension)])
  const scoreDiff = [...allDims].map(dim => {
    const a = avgsA.find(x => x.dimension === dim)?.avg ?? 0
    const b = avgsB.find(x => x.dimension === dim)?.avg ?? 0
    return { dimension: dim, scoreA: a, scoreB: b, delta: Math.round((b - a) * 10) / 10 }
  })

  const costA = db.query<{ total: number }, [number]>("SELECT COALESCE(SUM(cost), 0) as total FROM llm_calls WHERE run_id = ?").get(runIdA)?.total ?? 0
  const costB = db.query<{ total: number }, [number]>("SELECT COALESCE(SUM(cost), 0) as total FROM llm_calls WHERE run_id = ?").get(runIdB)?.total ?? 0

  return { configDiff, scoreDiff, costDiff: { costA, costB, delta: Math.round((costB - costA) * 1e4) / 1e4 } }
}

// ── Query: global aggregates ─────────────────────────────────────────────

export function getModelStats(): Array<{
  provider: string; model: string; totalCalls: number; totalCost: number; avgTps: number; avgLatencyMs: number
}> {
  const db = getCentralDB()
  return db.query<{
    provider: string; model: string; totalCalls: number; totalCost: number; avgTps: number; avgLatencyMs: number
  }, []>(`
    SELECT provider, model,
           COUNT(*) as totalCalls,
           ROUND(SUM(cost), 4) as totalCost,
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END)) as avgTps,
           ROUND(AVG(latency_ms)) as avgLatencyMs
    FROM llm_calls
    GROUP BY provider, model
    ORDER BY totalCalls DESC
  `).all()
}

export function getAgentStats(): Array<{
  agent: string; totalCalls: number; totalCost: number; avgTps: number; avgLatencyMs: number
}> {
  const db = getCentralDB()
  return db.query<{
    agent: string; totalCalls: number; totalCost: number; avgTps: number; avgLatencyMs: number
  }, []>(`
    SELECT agent,
           COUNT(*) as totalCalls,
           ROUND(SUM(cost), 4) as totalCost,
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END)) as avgTps,
           ROUND(AVG(latency_ms)) as avgLatencyMs
    FROM llm_calls
    GROUP BY agent
    ORDER BY totalCost DESC
  `).all()
}

// ── Tuning experiments ──────────────────────────────────────────────────

export function createTuningExperiment(
  type: string, description: string, config: Record<string, any>,
): number {
  const db = getCentralDB()
  const result = db.run(
    "INSERT INTO tuning_experiments (experiment_type, description, config) VALUES (?, ?, ?)",
    [type, description, JSON.stringify(config)],
  )
  return Number(result.lastInsertRowid)
}

export function saveTuningResult(
  experimentId: number,
  data: {
    model: string; rubric: string; sample: string; run: number;
    score?: number; issues?: Array<{ quote: string; problem: string }>;
    reasoning?: string; latencyMs?: number; failed?: boolean;
  },
) {
  const db = getCentralDB()
  db.run(
    `INSERT INTO tuning_results (experiment_id, model, rubric, sample, run, score, issues, reasoning, latency_ms, failed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      experimentId, data.model, data.rubric, data.sample, data.run,
      data.score ?? null, data.issues ? JSON.stringify(data.issues) : null,
      data.reasoning ?? null, data.latencyMs ?? null, data.failed ? 1 : 0,
    ],
  )
}

export function getTuningExperiments(type?: string): Array<{
  id: number; timestamp: string; experimentType: string; description: string; config: string
}> {
  const db = getCentralDB()
  if (type) {
    return db.query<any, [string]>(
      "SELECT id, timestamp, experiment_type as experimentType, description, config FROM tuning_experiments WHERE experiment_type = ? ORDER BY id DESC",
    ).all(type)
  }
  return db.query<any, []>(
    "SELECT id, timestamp, experiment_type as experimentType, description, config FROM tuning_experiments ORDER BY id DESC",
  ).all()
}

export function getTuningResults(experimentId: number): Array<{
  model: string; rubric: string; sample: string; run: number;
  score: number | null; issues: string | null; reasoning: string | null;
  latencyMs: number | null; failed: number
}> {
  const db = getCentralDB()
  return db.query<any, [number]>(
    "SELECT model, rubric, sample, run, score, issues, reasoning, latency_ms as latencyMs, failed FROM tuning_results WHERE experiment_id = ? ORDER BY rubric, sample, run",
  ).all(experimentId)
}

export function getPhaseStats(): Array<{
  phase: string; totalCalls: number; totalCost: number; avgTps: number
}> {
  const db = getCentralDB()
  return db.query<{
    phase: string; totalCalls: number; totalCost: number; avgTps: number
  }, []>(`
    SELECT COALESCE(phase, 'unknown') as phase,
           COUNT(*) as totalCalls,
           ROUND(SUM(cost), 4) as totalCost,
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END)) as avgTps
    FROM llm_calls
    GROUP BY phase
    ORDER BY totalCost DESC
  `).all()
}
