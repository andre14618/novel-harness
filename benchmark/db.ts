import { Database } from "bun:sqlite"

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
      benchmark_type TEXT NOT NULL,
      label TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      model_config TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS run_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      agent TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES runs(id),
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      call_type TEXT NOT NULL,
      agent TEXT,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      tokens_per_sec INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      seed TEXT,
      dimension TEXT,
      attempt INTEGER
    );
  `)
}

// ── Model config snapshot ────────────────────────────────────────────────

import { AGENT_MODELS, type ModelAssignment } from "../models/roles"

export function snapshotModelConfig(): string {
  return JSON.stringify(AGENT_MODELS)
}

export function getModelConfigDiff(configA: string, configB: string): Array<{ agent: string; from: string; to: string }> {
  const a = JSON.parse(configA) as Record<string, ModelAssignment>
  const b = JSON.parse(configB) as Record<string, ModelAssignment>
  const diffs: Array<{ agent: string; from: string; to: string }> = []
  const allAgents = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const agent of allAgents) {
    const modelA = a[agent] ? `${a[agent].provider}/${a[agent].model}` : "—"
    const modelB = b[agent] ? `${b[agent].provider}/${b[agent].model}` : "—"
    if (modelA !== modelB) diffs.push({ agent, from: modelA, to: modelB })
  }
  return diffs
}

// ── Write operations ─────────────────────────────────────────────────────

export function createRun(benchmarkType: string, seedsCount: number, runsPerSeed: number, label?: string): number {
  const db = getDB()
  const config = snapshotModelConfig()
  const result = db.run(
    "INSERT INTO runs (benchmark_type, label, model_config, seeds_count, runs_per_seed) VALUES (?, ?, ?, ?, ?)",
    [benchmarkType, label ?? null, config, seedsCount, runsPerSeed],
  )
  const runId = Number(result.lastInsertRowid)

  // Populate run_agents for queryable per-agent model tracking
  for (const [agent, assignment] of Object.entries(AGENT_MODELS)) {
    db.run(
      "INSERT INTO run_agents (run_id, agent, provider, model) VALUES (?, ?, ?, ?)",
      [runId, agent, assignment.provider, assignment.model],
    )
  }

  return runId
}

export function saveLLMCall(
  runId: number | null,
  callType: "writer" | "judge" | "calibration",
  agent: string | null,
  model: string, provider: string,
  promptTokens: number, completionTokens: number,
  latencyMs: number, cost: number,
  meta?: { seed?: string; dimension?: string; attempt?: number },
) {
  const db = getDB()
  const tps = latencyMs > 0 && completionTokens > 0 ? Math.round(completionTokens / (latencyMs / 1000)) : 0
  db.run(
    `INSERT INTO llm_calls (run_id, call_type, agent, model, provider, prompt_tokens, completion_tokens, latency_ms, tokens_per_sec, cost, seed, dimension, attempt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [runId, callType, agent, model, provider, promptTokens, completionTokens, Math.round(latencyMs), tps, cost, meta?.seed ?? null, meta?.dimension ?? null, meta?.attempt ?? null],
  )
}

export function getCallSummary(runId: number): Array<{ callType: string; agent: string | null; model: string; calls: number; totalCost: number; avgTps: number; totalPrompt: number; totalCompletion: number }> {
  const db = getDB()
  return db.query<{ callType: string; agent: string | null; model: string; calls: number; totalCost: number; avgTps: number; totalPrompt: number; totalCompletion: number }, [number]>(`
    SELECT call_type as callType, agent, model, COUNT(*) as calls,
           ROUND(SUM(cost), 6) as totalCost,
           ROUND(AVG(CASE WHEN tokens_per_sec > 0 THEN tokens_per_sec END)) as avgTps,
           SUM(prompt_tokens) as totalPrompt,
           SUM(completion_tokens) as totalCompletion
    FROM llm_calls WHERE run_id = ?
    GROUP BY call_type, agent, model
    ORDER BY call_type, totalCost DESC
  `).all(runId)
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

export function markBaseline(runId: number, benchmarkType: string) {
  const db = getDB()
  db.run("UPDATE runs SET is_baseline = 0 WHERE is_baseline = 1 AND benchmark_type = ?", [benchmarkType])
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

export function getBaselineAverages(benchmarkType: string): DimensionAvg[] | null {
  const db = getDB()
  const baseline = db.query<{ id: number }, [string]>("SELECT id FROM runs WHERE is_baseline = 1 AND benchmark_type = ? LIMIT 1").get(benchmarkType)
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

// ── Model comparison queries ─────────────────────────────────────────────

export function getRecentRuns(benchmarkType: string, limit: number = 10): Array<{
  id: number; label: string | null; timestamp: string; modelConfig: string; isBaseline: boolean; mean: number
}> {
  const db = getDB()
  return db.query<{ id: number; label: string | null; timestamp: string; modelConfig: string; isBaseline: number; mean: number }, [string, number]>(`
    SELECT r.id, r.label, r.timestamp, r.model_config as modelConfig, r.is_baseline as isBaseline,
           ROUND(AVG(s.score), 1) as mean
    FROM runs r
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    WHERE r.benchmark_type = ? AND g.passed = 1
    GROUP BY r.id
    ORDER BY r.timestamp DESC
    LIMIT ?
  `).all(benchmarkType, limit).map(r => ({ ...r, isBaseline: Boolean(r.isBaseline) }))
}

export function getRunsForAgentModel(agent: string, provider: string, model: string, benchmarkType: string): Array<{
  runId: number; label: string | null; timestamp: string; mean: number
}> {
  const db = getDB()
  return db.query<{ runId: number; label: string | null; timestamp: string; mean: number }, [string, string, string, string]>(`
    SELECT r.id as runId, r.label, r.timestamp, ROUND(AVG(s.score), 1) as mean
    FROM runs r
    JOIN run_agents ra ON ra.run_id = r.id
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    WHERE ra.agent = ? AND ra.provider = ? AND ra.model = ?
      AND r.benchmark_type = ? AND g.passed = 1
    GROUP BY r.id
    ORDER BY r.timestamp DESC
  `).all(agent, provider, model, benchmarkType)
}

export function getAgentModelScores(benchmarkType: string): Array<{
  agent: string; provider: string; model: string; runs: number; avgScore: number; avgTps: number; avgCost: number
}> {
  const db = getDB()
  return db.query<{
    agent: string; provider: string; model: string; runs: number; avgScore: number; avgTps: number; avgCost: number
  }, [string]>(`
    SELECT ra.agent, ra.provider, ra.model,
           COUNT(DISTINCT r.id) as runs,
           ROUND(AVG(s.score), 1) as avgScore,
           ROUND(AVG(CASE WHEN lc.tokens_per_sec > 0 THEN lc.tokens_per_sec END)) as avgTps,
           ROUND(AVG(lc.cost), 6) as avgCost
    FROM run_agents ra
    JOIN runs r ON r.id = ra.run_id
    JOIN generations g ON g.run_id = r.id
    JOIN scores s ON s.generation_id = g.id
    LEFT JOIN llm_calls lc ON lc.run_id = r.id AND lc.agent = ra.agent
    WHERE r.benchmark_type = ? AND g.passed = 1
    GROUP BY ra.agent, ra.provider, ra.model
    ORDER BY ra.agent, avgScore DESC
  `).all(benchmarkType)
}

export function compareRuns(runIdA: number, runIdB: number): {
  configDiff: Array<{ agent: string; from: string; to: string }>;
  scoreDiff: Array<{ dimension: string; scoreA: number; scoreB: number; delta: number }>;
  costDiff: { costA: number; costB: number; delta: number };
  tpsDiff: Array<{ callType: string; model: string; tpsA: number; tpsB: number }>;
} {
  const db = getDB()

  // Config diff
  const runA = db.query<{ modelConfig: string }, [number]>("SELECT model_config as modelConfig FROM runs WHERE id = ?").get(runIdA)
  const runB = db.query<{ modelConfig: string }, [number]>("SELECT model_config as modelConfig FROM runs WHERE id = ?").get(runIdB)
  const configDiff = (runA && runB) ? getModelConfigDiff(runA.modelConfig, runB.modelConfig) : []

  // Score diff per dimension
  const avgsA = getRunAverages(runIdA)
  const avgsB = getRunAverages(runIdB)
  const allDims = new Set([...avgsA.map(a => a.dimension), ...avgsB.map(b => b.dimension)])
  const scoreDiff = [...allDims].map(dim => {
    const a = avgsA.find(x => x.dimension === dim)?.avg ?? 0
    const b = avgsB.find(x => x.dimension === dim)?.avg ?? 0
    return { dimension: dim, scoreA: a, scoreB: b, delta: Math.round((b - a) * 10) / 10 }
  })

  // Cost diff
  const costA = db.query<{ total: number }, [number]>("SELECT COALESCE(SUM(cost), 0) as total FROM llm_calls WHERE run_id = ?").get(runIdA)?.total ?? 0
  const costB = db.query<{ total: number }, [number]>("SELECT COALESCE(SUM(cost), 0) as total FROM llm_calls WHERE run_id = ?").get(runIdB)?.total ?? 0

  // TPS diff per call type + model
  const tpsA = db.query<{ callType: string; model: string; avgTps: number }, [number]>(`
    SELECT call_type as callType, model, ROUND(AVG(tokens_per_sec)) as avgTps
    FROM llm_calls WHERE run_id = ? AND tokens_per_sec > 0 GROUP BY call_type, model
  `).all(runIdA)
  const tpsB = db.query<{ callType: string; model: string; avgTps: number }, [number]>(`
    SELECT call_type as callType, model, ROUND(AVG(tokens_per_sec)) as avgTps
    FROM llm_calls WHERE run_id = ? AND tokens_per_sec > 0 GROUP BY call_type, model
  `).all(runIdB)

  const tpsKeys = new Set([...tpsA.map(t => `${t.callType}|${t.model}`), ...tpsB.map(t => `${t.callType}|${t.model}`)])
  const tpsDiff = [...tpsKeys].map(key => {
    const [callType, model] = key.split("|")
    const a = tpsA.find(t => t.callType === callType && t.model === model)?.avgTps ?? 0
    const b = tpsB.find(t => t.callType === callType && t.model === model)?.avgTps ?? 0
    return { callType, model, tpsA: a, tpsB: b }
  })

  return { configDiff, scoreDiff, costDiff: { costA, costB, delta: Math.round((costB - costA) * 10000) / 10000 }, tpsDiff }
}
