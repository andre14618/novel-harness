import { describe, test, expect, afterAll, beforeAll } from "bun:test"
import { rmSync } from "node:fs"
import { log, logLLMCallStructured, initNovelRun, getRunId, type LLMCallLogEntry } from "../src/logger"
import { initDB } from "../src/db"

let hasDB = false

const testNovelId = `test-logger-${crypto.randomUUID()}`
const logDir = `output/${testNovelId}`

beforeAll(async () => {
  initDB(testNovelId)
  try {
    await initNovelRun(testNovelId)
    hasDB = true
  } catch {
    // Postgres unreachable — DB integration tests will be skipped
  }
})

afterAll(() => {
  try { rmSync(logDir, { recursive: true, force: true }) } catch {}
})

describe("log", () => {
  test("creates directory and writes log file", () => {
    log(testNovelId, "info", "Test message")
    const content = require("node:fs").readFileSync(`${logDir}/harness.log`, "utf-8")
    expect(content).toContain("Test message")
  })

  test("writes ISO timestamp", () => {
    log(testNovelId, "info", "Timestamp test")
    const content = require("node:fs").readFileSync(`${logDir}/harness.log`, "utf-8")
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  test("appends multiple lines", () => {
    log(testNovelId, "info", "Line 1")
    log(testNovelId, "warn", "Line 2")
    const content = require("node:fs").readFileSync(`${logDir}/harness.log`, "utf-8")
    expect(content).toContain("[INFO]")
    expect(content).toContain("[WARN]")
  })
})

function makeLogEntry(overrides: Partial<LLMCallLogEntry> = {}): LLMCallLogEntry {
  return {
    timestamp: new Date().toISOString(),
    agent: "test-agent",
    model: "test-model",
    provider: "test",
    temperature: 0.7,
    maxTokens: 4096,
    thinking: false,
    systemPromptLength: 100,
    userPromptLength: 500,
    contentPreview: '{"prose": "test content..."}',
    promptTokens: 150,
    completionTokens: 400,
    totalLatencyMs: 2500,
    tokensPerSec: 160,
    jsonExtractionSuccess: true,
    jsonExtractionRetried: false,
    zodValidationSuccess: true,
    zodErrors: [],
    httpAttempts: 1,
    retryErrors: [],
    ...overrides,
  }
}

describe("logLLMCallStructured", () => {
  // These tests require a running Postgres — skipped when unreachable

  test("creates a run and logs to central DB", () => {
    if (!hasDB) return
    const runId = getRunId()
    expect(runId).not.toBeNull()
  })

  test("inserts a row into central llm_calls table", async () => {
    if (!hasDB) return
    const db = (await import("../data/connection")).default
    await logLLMCallStructured(testNovelId, makeLogEntry({ agent: "world-builder-test" }))
    const runId = getRunId()!
    const rows = await db`SELECT agent, model FROM llm_calls WHERE run_id = ${runId} AND agent = ${"world-builder-test"}`
    const row = rows[0] as any
    expect(row).not.toBeNull()
    expect(row.agent).toBe("world-builder-test")
    expect(row.model).toBe("test-model")
  })

  test("tracks phase from agent name", async () => {
    if (!hasDB) return
    const db = (await import("../data/connection")).default
    await logLLMCallStructured(testNovelId, makeLogEntry({ agent: "writer" }))
    const runId = getRunId()!
    const rows = await db`SELECT phase FROM llm_calls WHERE run_id = ${runId} AND agent = 'writer' LIMIT 1`
    const row = rows[0] as any
    expect(row.phase).toBe("drafting")
  })

  test("captures error tracking fields", async () => {
    if (!hasDB) return
    const db = (await import("../data/connection")).default
    await logLLMCallStructured(testNovelId, makeLogEntry({
      agent: "continuity-err-test",
      zodValidationSuccess: false,
      zodErrors: ["issues.0.chapter: Expected number"],
      httpAttempts: 2,
      retryErrors: [{ status: 429, delay: 5000 }],
    }))
    const runId = getRunId()!
    const rows = await db`SELECT zod_validation_success, zod_errors, http_attempts, retry_errors FROM llm_calls WHERE run_id = ${runId} AND agent = ${"continuity-err-test"}`
    const row = rows[0] as any
    expect(row.zod_validation_success).toBe(false)
    expect(row.zod_errors).toContain("Expected number")
    expect(row.http_attempts).toBe(2)
    const retryErrors = JSON.parse(row.retry_errors!)
    expect(retryErrors[0].status).toBe(429)
  })

  test("stores token counts and computes TPS", async () => {
    if (!hasDB) return
    const db = (await import("../data/connection")).default
    await logLLMCallStructured(testNovelId, makeLogEntry({
      agent: "token-test",
      promptTokens: 500,
      completionTokens: 1200,
      totalLatencyMs: 3500,
    }))
    const runId = getRunId()!
    const rows = await db`SELECT prompt_tokens, completion_tokens, latency_ms, tokens_per_sec FROM llm_calls WHERE run_id = ${runId} AND agent = ${"token-test"}`
    const row = rows[0] as any
    expect(row.prompt_tokens).toBe(500)
    expect(row.completion_tokens).toBe(1200)
    expect(row.latency_ms).toBe(3500)
    expect(row.tokens_per_sec).toBeGreaterThan(0)
  })

  test("snapshots model config in run_agents", async () => {
    if (!hasDB) return
    const db = (await import("../data/connection")).default
    const runId = getRunId()!
    const agents = await db`SELECT agent, provider, model FROM run_agents WHERE run_id = ${runId}` as any[]
    expect(agents.length).toBeGreaterThan(0)
    const agentNames = agents.map((a: any) => a.agent)
    expect(agentNames).toContain("writer")
    expect(agentNames).toContain("continuity")
    expect(agentNames).toContain("summary-extractor")
  })
})
