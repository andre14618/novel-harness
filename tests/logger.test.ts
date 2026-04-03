import { describe, test, expect, afterAll, beforeAll } from "bun:test"
import { rmSync } from "node:fs"
import { log, logLLMCallStructured, initNovelRun, getRunId, type LLMCallLogEntry } from "../src/logger"
import { initDB } from "../src/db"
import { getCentralDB } from "../data/db"

const testNovelId = `test-logger-${crypto.randomUUID()}`
const logDir = `output/${testNovelId}`

beforeAll(async () => {
  initDB(testNovelId)
  await initNovelRun(testNovelId)
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

  test("uses correct level labels", () => {
    log(testNovelId, "info", "info-test")
    log(testNovelId, "warn", "warn-test")
    log(testNovelId, "error", "error-test")
    log(testNovelId, "checkpoint", "checkpoint-test")
    const content = require("node:fs").readFileSync(`${logDir}/harness.log`, "utf-8")
    expect(content).toContain("[INFO]")
    expect(content).toContain("[WARN]")
    expect(content).toContain("[ERROR]")
    expect(content).toContain("[CHKPT]")
  })

  test("appends multiple lines", () => {
    log(testNovelId, "info", "line-one")
    log(testNovelId, "info", "line-two")
    const content = require("node:fs").readFileSync(`${logDir}/harness.log`, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines.length).toBeGreaterThanOrEqual(2)
  })
})

// ── Structured LLM Call Logging (Central DB) ─────────────────────────────

function makeLogEntry(overrides?: Partial<LLMCallLogEntry>): LLMCallLogEntry {
  return {
    timestamp: new Date().toISOString(),
    agent: "writer",
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
  test("creates a run and logs to central DB", () => {
    const runId = getRunId()
    expect(runId).not.toBeNull()
  })

  test("inserts a row into central llm_calls table", async () => {
    await logLLMCallStructured(testNovelId, makeLogEntry({ agent: "world-builder-test" }))
    const db = getCentralDB()
    const runId = getRunId()!
    const row = db.query<{ agent: string; model: string }, [number, string]>(
      "SELECT agent, model FROM llm_calls WHERE run_id = ? AND agent = ?",
    ).get(runId, "world-builder-test")
    expect(row).not.toBeNull()
    expect(row!.agent).toBe("world-builder-test")
    expect(row!.model).toBe("test-model")
  })

  test("tracks phase from agent name", async () => {
    await logLLMCallStructured(testNovelId, makeLogEntry({ agent: "writer" }))
    const db = getCentralDB()
    const runId = getRunId()!
    const row = db.query<{ phase: string }, [number]>(
      "SELECT phase FROM llm_calls WHERE run_id = ? AND agent = 'writer' LIMIT 1",
    ).get(runId)
    expect(row!.phase).toBe("drafting")
  })

  test("captures error tracking fields", async () => {
    await logLLMCallStructured(testNovelId, makeLogEntry({
      agent: "continuity-err-test",
      zodValidationSuccess: false,
      zodErrors: ["issues.0.chapter: Expected number"],
      httpAttempts: 2,
      retryErrors: [{ status: 429, delay: 5000 }],
    }))
    const db = getCentralDB()
    const runId = getRunId()!
    const row = db.query<{
      zod_validation_success: number; zod_errors: string | null;
      http_attempts: number; retry_errors: string | null;
    }, [number, string]>(
      "SELECT zod_validation_success, zod_errors, http_attempts, retry_errors FROM llm_calls WHERE run_id = ? AND agent = ?",
    ).get(runId, "continuity-err-test")
    expect(row!.zod_validation_success).toBe(0)
    expect(row!.zod_errors).toContain("Expected number")
    expect(row!.http_attempts).toBe(2)
    const retryErrors = JSON.parse(row!.retry_errors!)
    expect(retryErrors[0].status).toBe(429)
  })

  test("stores token counts and computes TPS", async () => {
    await logLLMCallStructured(testNovelId, makeLogEntry({
      agent: "token-test",
      promptTokens: 500,
      completionTokens: 1200,
      totalLatencyMs: 3500,
    }))
    const db = getCentralDB()
    const runId = getRunId()!
    const row = db.query<{
      prompt_tokens: number; completion_tokens: number;
      latency_ms: number; tokens_per_sec: number;
    }, [number, string]>(
      "SELECT prompt_tokens, completion_tokens, latency_ms, tokens_per_sec FROM llm_calls WHERE run_id = ? AND agent = ?",
    ).get(runId, "token-test")
    expect(row!.prompt_tokens).toBe(500)
    expect(row!.completion_tokens).toBe(1200)
    expect(row!.latency_ms).toBe(3500)
    expect(row!.tokens_per_sec).toBeGreaterThan(0)
  })

  test("snapshots model config in run_agents", () => {
    const db = getCentralDB()
    const runId = getRunId()!
    const agents = db.query<{ agent: string; provider: string; model: string }, [number]>(
      "SELECT agent, provider, model FROM run_agents WHERE run_id = ?",
    ).all(runId)
    expect(agents.length).toBeGreaterThan(0)
    // Should have all 12 agents from roles.ts
    const agentNames = agents.map(a => a.agent)
    expect(agentNames).toContain("writer")
    expect(agentNames).toContain("continuity")
    expect(agentNames).toContain("summary-extractor")
  })
})
