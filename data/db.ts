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
  seedLintPatterns(db)
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
      label TEXT,
      experiment_id INTEGER REFERENCES tuning_experiments(id)
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
      experiment_type TEXT NOT NULL,  -- 'probe', 'calibration', 'shootout', 'ab-test', 'methodology', 'experiment', 'system-test'
      description TEXT NOT NULL,
      config TEXT NOT NULL,           -- JSON: models, rubrics, samples, runs, etc.
      conclusion TEXT                 -- what we learned (persisted findings)
    );

    -- Deterministic lint patterns (the spec — each row is a detection rule)
    CREATE TABLE IF NOT EXISTS lint_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tier INTEGER NOT NULL,           -- 1=zero ambiguity, 2=context-aware, 3=needs LLM
      category TEXT NOT NULL,          -- FILLER_PHRASE, REDUNDANT_BODY, etc.
      pattern TEXT NOT NULL,           -- regex string (without flags)
      flags TEXT NOT NULL DEFAULT 'gi', -- regex flags
      fix_template TEXT NOT NULL,      -- rewrite instruction for the rewriter
      dialogue_ok INTEGER NOT NULL DEFAULT 0,  -- 1=flag even inside dialogue
      enabled INTEGER NOT NULL DEFAULT 1,
      rationale TEXT,                  -- why this pattern matters (craft reason)
      edge_cases TEXT,                 -- known false positive scenarios
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Deterministic lint issues (per-instance, linked to pattern)
    CREATE TABLE IF NOT EXISTS lint_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation_id INTEGER NOT NULL REFERENCES generations(id),
      pattern_id INTEGER NOT NULL REFERENCES lint_patterns(id),
      char_offset INTEGER NOT NULL,  -- position in prose string
      match TEXT NOT NULL,           -- the flagged text
      sentence TEXT NOT NULL,        -- surrounding sentence for rewriter context
      resolved INTEGER NOT NULL DEFAULT 0,  -- 0=pending, 1=rewritten, 2=skipped
      rewrite_result TEXT            -- what the rewriter did (null until processed)
    );

    -- Batch processing: async judge calls via provider batch APIs
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES runs(id),
      provider TEXT NOT NULL,             -- 'openai', 'anthropic', etc.
      provider_batch_id TEXT,             -- provider's batch ID (set after submission)
      status TEXT NOT NULL DEFAULT 'pending',  -- pending, submitted, processing, completed, failed, expired
      judge_model TEXT NOT NULL,          -- model used for judging
      request_count INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT,
      completed_at TEXT,
      input_file TEXT,                    -- path to submitted JSONL (for reference)
      output_file TEXT,                   -- path to results file
      error TEXT                          -- error message if failed
    );

    CREATE TABLE IF NOT EXISTS batch_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id),
      custom_id TEXT NOT NULL,            -- unique ID for matching results back
      generation_id INTEGER NOT NULL REFERENCES generations(id),
      dimension TEXT NOT NULL,            -- 'telling', 'dead-weight', 'dialogue-problems'
      status TEXT NOT NULL DEFAULT 'pending',  -- pending, completed, failed
      score INTEGER,                      -- populated on collection
      issues_json TEXT                    -- populated on collection
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

  // Migrations for existing DBs
  const addColumnIfMissing = (table: string, column: string, type: string) => {
    const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()
    if (!cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    }
  }
  addColumnIfMissing("runs", "experiment_id", "INTEGER REFERENCES tuning_experiments(id)")
  addColumnIfMissing("tuning_experiments", "conclusion", "TEXT")
  addColumnIfMissing("tuning_experiments", "summary", "TEXT")
  addColumnIfMissing("generations", "variant_label", "TEXT")
}

// ── Lint pattern seeding ─────────────────────────────────────────────────

function seedLintPatterns(db: Database) {
  const insert = db.prepare(`
    INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, rationale, edge_cases)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const count = (db.query("SELECT COUNT(*) as c FROM lint_patterns WHERE tier = 1").get() as any).c
  if (count > 0) {
    // Tier 1 already seeded — just check Tier 2
    seedTier2Patterns(db, insert)
    return
  }

  const patterns: [number, string, string, string, string, number, string, string | null][] = [
    // ── Tier 1: Filler phrases ───────────────────────────────────
    [1, "FILLER_PHRASE", "\\b(began|started|continued|proceeded)\\s+to\\s+\\w+", "gi",
      "Remove the revving-up verb — write the action directly.", 0,
      "Revving-up verbs add a layer of indirection. 'She began to run' is weaker than 'She ran.' The action itself is what matters.",
      "Gradual-onset actions like 'began to blur' or 'began to ring' may be intentional — the rewriter should judge whether the onset is meaningful. Natural in dialogue."],

    [1, "FILLER_PHRASE", "\\bin order to\\b", "gi",
      "Replace with 'to'.", 1,
      "Always replaceable with 'to' — adds words without meaning.",
      null],

    [1, "FILLER_PHRASE", "\\bthe fact that\\b", "gi",
      "Cut 'the fact that' — rephrase the clause directly.", 0,
      "Nominalization that bloats sentences. 'Despite the fact that' → 'Although'. 'Aware of the fact that' → 'Aware that'. Natural in dialogue — skip in speech.",
      null],

    [1, "FILLER_PHRASE", "\\bdue to the fact that\\b", "gi",
      "Replace with 'because'.", 1,
      "Five words that always mean 'because'.",
      null],

    [1, "FILLER_PHRASE", "\\bin spite of the fact that\\b", "gi",
      "Replace with 'although' or 'despite'.", 1,
      "Six words that always mean 'although'.",
      null],

    [1, "FILLER_PHRASE", "\\bat this point in time\\b", "gi",
      "Replace with 'now'.", 1,
      "Five words that always mean 'now'.",
      null],

    [1, "FILLER_PHRASE", "\\bfor the purpose of\\b", "gi",
      "Replace with 'to' or 'for'.", 1,
      "Four words that always mean 'to' or 'for'.",
      null],

    [1, "FILLER_PHRASE", "\\bhas the ability to\\b", "gi",
      "Replace with 'can'.", 1,
      "Four words that always mean 'can'.",
      null],

    // ── Tier 1: Redundant body language ──────────────────────────
    [1, "REDUNDANT_BODY", "\\bnodded\\s+(his|her|their)\\s+head", "gi",
      "Remove redundant body part — 'nodded' is sufficient.", 0,
      "You can only nod your head. The body part adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\bshrugged\\s+(his|her|their)\\s+shoulders", "gi",
      "Remove redundant body part — 'shrugged' is sufficient.", 0,
      "You can only shrug your shoulders. The body part adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\bblinked\\s+(his|her|their)\\s+eyes", "gi",
      "Remove redundant body part — 'blinked' is sufficient.", 0,
      "You can only blink your eyes. The body part adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\bclenched\\s+(his|her|their)\\s+fists", "gi",
      "'clenched' already implies fists unless the body part disambiguates or sets up a subsequent detail.", 0,
      "Clenching defaults to fists. But sometimes 'fists' sets up a follow-on detail ('clenched her fists, nails digging into palms').",
      "When 'fists' is load-bearing for a subsequent detail, the rewriter should keep it."],

    [1, "REDUNDANT_BODY", "\\bsat\\s+down\\b", "gi",
      "Remove 'down' — 'sat' implies downward.", 0,
      "Sitting is inherently downward. 'Down' adds nothing.",
      null],

    [1, "REDUNDANT_BODY", "\\b(?:she|he|they|I|we)\\s+stood\\s+up\\b", "gi",
      "Remove 'up' — 'stood' implies upward.", 0,
      "Standing is inherently upward. 'Up' adds nothing.",
      "Must have a person subject — 'hair stood up' is a different meaning."],

    [1, "REDUNDANT_BODY", "\\breturned\\s+back\\b", "gi",
      "Remove 'back' — 'returned' already means going back.", 0,
      "Returning is inherently backward.",
      null],

    [1, "REDUNDANT_BODY", "\\brose\\s+up\\b", "gi",
      "Remove 'up' — 'rose' implies upward.", 0,
      "Rising is inherently upward.",
      null],

    // ── Tier 1: Redundant adverb + verb ──────────────────────────
    [1, "REDUNDANT_ADVERB_VERB", "\\bwhispered\\s+softly\\b", "gi",
      "Remove 'softly' — whispering is inherently soft.", 0,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bshouted\\s+loudly\\b", "gi",
      "Remove 'loudly' — shouting is inherently loud.", 0,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bscreamed\\s+loudly\\b", "gi",
      "Remove 'loudly' — screaming is inherently loud.", 0,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bmurmured\\s+softly\\b", "gi",
      "Remove 'softly' — murmuring is inherently soft.", 0,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bcrept\\s+quietly\\b", "gi",
      "Remove 'quietly' — creeping implies stealth.", 0,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bstrolled\\s+leisurely\\b", "gi",
      "Remove 'leisurely' — strolling implies a leisurely pace.", 0,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bgripped\\s+firmly\\b", "gi",
      "Remove 'firmly' — gripping implies firmness.", 0,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\brushed\\s+quickly\\b", "gi",
      "Remove 'quickly' — rushing implies speed.", 0,
      "The adverb restates what the verb already communicates.",
      null],

    [1, "REDUNDANT_ADVERB_VERB", "\\bhurried\\s+quickly\\b", "gi",
      "Remove 'quickly' — hurrying implies speed.", 0,
      "The adverb restates what the verb already communicates.",
      null],

    // ── Tier 1: Empty transitions ────────────────────────────────
    [1, "EMPTY_TRANSITION", "(?:^|(?<=\\.\\s{1,2}))And then\\b", "gm",
      "Cut 'And then' — start with the action.", 0,
      "Empty connector that delays the action. The reader already knows events are sequential.",
      "Occasionally used as a deliberate dramatic beat — the rewriter should judge."],

    [1, "EMPTY_TRANSITION", "(?:^|(?<=\\.\\s{1,2}))After that\\b", "gm",
      "Cut 'After that' — start with the action.", 0,
      "Empty connector that delays the action.",
      null],

    [1, "EMPTY_TRANSITION", "(?:^|(?<=\\.\\s{1,2}))All of a sudden\\b", "gm",
      "Cut 'All of a sudden' — just describe what happened.", 0,
      "Telling the reader something is sudden instead of making the prose feel sudden through pacing.",
      null],
  ]

  for (const p of patterns) {
    insert.run(...p)
  }

  seedTier2Patterns(db, insert)
}

function seedTier2Patterns(db: Database, insert: ReturnType<Database["prepare"]>) {
  // Check if Tier 2 patterns already exist
  const tier2Count = (db.query("SELECT COUNT(*) as c FROM lint_patterns WHERE tier = 2").get() as any).c
  if (tier2Count > 0) return

  const patterns: [number, string, string, string, string, number, string, string | null][] = [
    // ── Tier 2: Filter words (narrator distancing) ──────────────
    [2, "FILTER_WORD", "\\bseemed\\s+to\\b", "gi",
      "Remove distancing — describe the action or sensation directly.", 0,
      "'Seemed to' adds a narrator hedge between the reader and the experience. 'The rain seemed to pause' → 'The rain paused.' The POV character observes, not the narrator.",
      "Legitimate in genuinely uncertain perception: 'He seemed to recognize her' (POV character is unsure). In dialogue, natural hedging — skip."],

    [2, "FILTER_WORD", "\\bcould\\s+feel\\b", "gi",
      "Remove 'could feel' — describe the sensation directly.", 0,
      "'She could feel the cold' filters through ability ('could') instead of experience. 'The cold bit her fingers' or 'Her skin prickled' is direct perception.",
      "In dialogue, natural phrasing — skip. 'Could feel' before abstract nouns ('could feel the tension') may need more than just cutting the filter."],

    [2, "FILTER_WORD", "\\bcould\\s+see\\b", "gi",
      "Remove 'could see' — describe what is seen directly.", 0,
      "'She could see the tower' filters through ability. 'The tower rose' or 'The tower stood at the far end' is direct perception. The POV character's senses report — they don't narrate their own noticing.",
      "Exception: emphasis on ability or constraint ('From here she could see the whole valley' — the vantage point matters). In dialogue, skip."],

    [2, "FILTER_WORD", "\\bcould\\s+hear\\b", "gi",
      "Remove 'could hear' — describe the sound directly.", 0,
      "'She could hear boots on stone' → 'Boots scraped against stone.' Direct perception is always stronger.",
      "Exception: emphasis on distance or effort ('She could barely hear him'). In dialogue, skip."],

    [2, "FILTER_WORD", "\\bfound\\s+(herself|himself|themselves|itself)\\b", "gi",
      "Remove 'found herself' — describe the action directly.", 0,
      "'She found herself staring' → 'She stared.' The 'found' construction implies surprise at one's own action, but is almost always just a distancing habit.",
      "Occasionally the surprise is intentional (genuine dissociation or absent-mindedness). Rewriter should judge."],

    [2, "FILTER_WORD", "\\bcould\\s+smell\\b", "gi",
      "Remove 'could smell' — describe the scent directly.", 0,
      "'She could smell smoke' → 'Smoke hung in the air' or 'The sharp tang of smoke reached her.' Direct sensory is stronger.",
      "In dialogue, skip."],

    [2, "FILTER_WORD", "\\bcould\\s+taste\\b", "gi",
      "Remove 'could taste' — describe the taste directly.", 0,
      "'He could taste blood' → 'Blood coated his tongue' or 'Copper filled his mouth.' Direct sensory is stronger.",
      "In dialogue, skip."],
  ]

  for (const p of patterns) {
    insert.run(...p)
  }
}

// ── Run management ───────────────────────────────────────────────────────

export function snapshotModelConfig(): string {
  return JSON.stringify(AGENT_MODELS)
}

export function createRun(runType: string, runRef?: string, label?: string, experimentId?: number): number {
  const db = getCentralDB()
  const config = snapshotModelConfig()
  const result = db.run(
    "INSERT INTO runs (run_type, run_ref, model_config, label, experiment_id) VALUES (?, ?, ?, ?, ?)",
    [runType, runRef ?? null, config, label ?? null, experimentId ?? null],
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
  data: { prose?: string; wordCount?: number; latencyMs?: number; tokensPerSec?: number; completionTokens?: number; passed: boolean; variantLabel?: string },
): number {
  const db = getCentralDB()
  const result = db.run(
    `INSERT INTO generations (run_id, seed, attempt, prose, word_count, latency_ms, tokens_per_sec, completion_tokens, passed, variant_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [runId, seed, attempt, data.prose ?? null, data.wordCount ?? null, data.latencyMs ?? null,
     data.tokensPerSec ?? null, data.completionTokens ?? null, data.passed ? 1 : 0, data.variantLabel ?? null],
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

export function concludeExperiment(experimentId: number, conclusion: string) {
  const db = getCentralDB()
  db.run("UPDATE tuning_experiments SET conclusion = ? WHERE id = ?", [conclusion, experimentId])
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

// ── Experiment queries (unified) ────────────────────────────────────────

export function getExperimentRuns(experimentId: number): Array<{
  runId: number; label: string | null; variantLabel: string | null; timestamp: string
}> {
  const db = getCentralDB()
  return db.query<any, [number]>(`
    SELECT r.id as runId, r.label, g.variant_label as variantLabel, r.timestamp
    FROM runs r
    LEFT JOIN generations g ON g.run_id = r.id AND g.variant_label IS NOT NULL
    WHERE r.experiment_id = ?
    GROUP BY r.id
    ORDER BY r.id
  `).all(experimentId)
}

export function getExperimentScores(experimentId: number): Array<{
  variantLabel: string; dimension: string; avg: number; stddev: number; count: number
}> {
  const db = getCentralDB()
  return db.query<any, [number]>(`
    SELECT COALESCE(g.variant_label, r.label) as variantLabel,
           s.dimension,
           ROUND(AVG(s.score), 2) as avg,
           ROUND(SQRT(AVG(s.score * s.score) - AVG(s.score) * AVG(s.score)), 2) as stddev,
           COUNT(*) as count
    FROM scores s
    JOIN generations g ON g.id = s.generation_id
    JOIN runs r ON r.id = g.run_id
    WHERE r.experiment_id = ? AND g.passed = 1
    GROUP BY variantLabel, s.dimension
    ORDER BY variantLabel, s.dimension
  `).all(experimentId)
}

export function getExperimentLintSummary(experimentId: number): Array<{
  variantLabel: string; category: string; count: number
}> {
  const db = getCentralDB()
  return db.query<any, [number]>(`
    SELECT COALESCE(g.variant_label, r.label) as variantLabel,
           lp.category,
           COUNT(*) as count
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    JOIN generations g ON g.id = li.generation_id
    JOIN runs r ON r.id = g.run_id
    WHERE r.experiment_id = ?
    GROUP BY variantLabel, lp.category
    ORDER BY variantLabel, count DESC
  `).all(experimentId)
}

export function getExperimentCost(experimentId: number): Array<{
  variantLabel: string; totalCost: number; totalCalls: number
}> {
  const db = getCentralDB()
  return db.query<any, [number]>(`
    SELECT r.label as variantLabel,
           ROUND(SUM(lc.cost), 6) as totalCost,
           COUNT(*) as totalCalls
    FROM llm_calls lc
    JOIN runs r ON r.id = lc.run_id
    WHERE r.experiment_id = ?
    GROUP BY r.label
    ORDER BY r.label
  `).all(experimentId)
}

export function saveExperimentSummary(experimentId: number, summary: string) {
  const db = getCentralDB()
  db.run("UPDATE tuning_experiments SET summary = ? WHERE id = ?", [summary, experimentId])
}

/**
 * Delete an experiment and all its cascading data.
 * Handles FK order: scores/lint_issues → generations → run_agents/llm_calls → runs → experiment.
 */
export function deleteExperiment(experimentId: number) {
  const db = getCentralDB()
  const runIds = db.query<{ id: number }, [number]>(
    "SELECT id FROM runs WHERE experiment_id = ?"
  ).all(experimentId).map(r => r.id)

  if (runIds.length > 0) {
    const runList = runIds.join(",")
    const genIds = db.query<{ id: number }, []>(
      `SELECT id FROM generations WHERE run_id IN (${runList})`
    ).all().map(g => g.id)

    if (genIds.length > 0) {
      const genList = genIds.join(",")
      db.exec(`DELETE FROM scores WHERE generation_id IN (${genList})`)
      db.exec(`DELETE FROM lint_issues WHERE generation_id IN (${genList})`)
      db.exec(`DELETE FROM generations WHERE id IN (${genList})`)
    }
    db.exec(`DELETE FROM llm_calls WHERE run_id IN (${runList})`)
    db.exec(`DELETE FROM run_agents WHERE run_id IN (${runList})`)
    db.exec(`DELETE FROM runs WHERE id IN (${runList})`)
  }
  db.exec(`DELETE FROM tuning_experiments WHERE id = ${experimentId}`)
}

// ── Batch processing ───────────────────────────────────────────────────

export function createBatch(runId: number, provider: string, judgeModel: string): number {
  const db = getCentralDB()
  const result = db.run(
    "INSERT INTO batches (run_id, provider, judge_model) VALUES (?, ?, ?)",
    [runId, provider, judgeModel],
  )
  return Number(result.lastInsertRowid)
}

export function addBatchRequest(batchId: number, customId: string, generationId: number, dimension: string) {
  const db = getCentralDB()
  db.run(
    "INSERT INTO batch_requests (batch_id, custom_id, generation_id, dimension) VALUES (?, ?, ?, ?)",
    [batchId, customId, generationId, dimension],
  )
}

export function updateBatchSubmitted(batchId: number, providerBatchId: string, inputFile: string, requestCount: number) {
  const db = getCentralDB()
  db.run(
    `UPDATE batches SET provider_batch_id = ?, input_file = ?, request_count = ?,
     status = 'submitted', submitted_at = datetime('now') WHERE id = ?`,
    [providerBatchId, inputFile, requestCount, batchId],
  )
}

export function updateBatchStatus(batchId: number, status: string, error?: string) {
  const db = getCentralDB()
  const completedAt = (status === "completed" || status === "failed") ? ", completed_at = datetime('now')" : ""
  const errorClause = error ? `, error = '${error.replace(/'/g, "''")}'` : ""
  db.exec(`UPDATE batches SET status = '${status}'${completedAt}${errorClause} WHERE id = ${batchId}`)
}

export function updateBatchOutput(batchId: number, outputFile: string) {
  const db = getCentralDB()
  db.run("UPDATE batches SET output_file = ? WHERE id = ?", [outputFile, batchId])
}

export function completeBatchRequest(customId: string, score: number, issuesJson: string) {
  const db = getCentralDB()
  db.run(
    "UPDATE batch_requests SET status = 'completed', score = ?, issues_json = ? WHERE custom_id = ?",
    [score, issuesJson, customId],
  )
}

export function failBatchRequest(customId: string) {
  const db = getCentralDB()
  db.run("UPDATE batch_requests SET status = 'failed' WHERE custom_id = ?", [customId])
}

export function getPendingBatches(): Array<{
  id: number; runId: number; provider: string; providerBatchId: string; judgeModel: string; requestCount: number; status: string
}> {
  const db = getCentralDB()
  return db.query(
    "SELECT id, run_id as runId, provider, provider_batch_id as providerBatchId, judge_model as judgeModel, request_count as requestCount, status FROM batches WHERE status IN ('pending', 'submitted', 'validating', 'processing') ORDER BY id"
  ).all() as any[]
}

export function getBatchRequests(batchId: number): Array<{
  id: number; customId: string; generationId: number; dimension: string; status: string; score: number | null; issuesJson: string | null
}> {
  const db = getCentralDB()
  return db.query<any, [number]>(
    "SELECT id, custom_id as customId, generation_id as generationId, dimension, status, score, issues_json as issuesJson FROM batch_requests WHERE batch_id = ? ORDER BY id"
  ).all(batchId) as any[]
}

export function getBatchForRun(runId: number): Array<{
  id: number; provider: string; status: string; judgeModel: string; requestCount: number; submittedAt: string | null; completedAt: string | null
}> {
  const db = getCentralDB()
  return db.query<any, [number]>(
    "SELECT id, provider, status, judge_model as judgeModel, request_count as requestCount, submitted_at as submittedAt, completed_at as completedAt FROM batches WHERE run_id = ? ORDER BY id"
  ).all(runId) as any[]
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
