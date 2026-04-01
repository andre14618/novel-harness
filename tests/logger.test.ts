import { describe, test, expect, afterAll, beforeAll } from "bun:test"
import { rmSync } from "node:fs"
import { Database } from "bun:sqlite"
import { log, logLLMCallStructured, type LLMCallLogEntry } from "../src/logger"
import { initDB, getDB } from "../src/db"

const testNovelId = `test-logger-${crypto.randomUUID()}`
const logDir = `output/${testNovelId}`

beforeAll(() => {
  initDB(testNovelId)
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

// ── Structured LLM Call Logging (SQLite) ─────────────────────────────────

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
  test("inserts a row into llm_calls table", () => {
    logLLMCallStructured(testNovelId, makeLogEntry({ agent: "world-builder" }))
    const db = getDB()
    const row = db.query<{ agent: string; model: string }, []>(
      "SELECT agent, model FROM llm_calls WHERE novel_id = ? AND agent = ?",
    ).get(testNovelId, "world-builder")
    expect(row).not.toBeNull()
    expect(row!.agent).toBe("world-builder")
    expect(row!.model).toBe("test-model")
  })

  test("appends multiple entries", () => {
    logLLMCallStructured(testNovelId, makeLogEntry({ agent: "call-1" }))
    logLLMCallStructured(testNovelId, makeLogEntry({ agent: "call-2" }))
    const db = getDB()
    const rows = db.query<{ agent: string }, []>(
      "SELECT agent FROM llm_calls WHERE novel_id = ? AND agent IN ('call-1', 'call-2')",
    ).all(testNovelId)
    const agents = rows.map(r => r.agent)
    expect(agents).toContain("call-1")
    expect(agents).toContain("call-2")
  })

  test("captures all fields", () => {
    const entry = makeLogEntry({
      agent: "continuity-test",
      temperature: 0.2,
      zodValidationSuccess: false,
      zodErrors: ["issues.0.chapter: Expected number"],
      httpAttempts: 2,
      retryErrors: [{ status: 429, delay: 5000 }],
    })
    logLLMCallStructured(testNovelId, entry)
    const db = getDB()
    const row = db.query<{
      agent: string; temperature: number; zod_validation_success: number;
      zod_errors: string | null; http_attempts: number; retry_errors: string | null;
    }, []>(
      "SELECT agent, temperature, zod_validation_success, zod_errors, http_attempts, retry_errors FROM llm_calls WHERE novel_id = ? AND agent = ?",
    ).get(testNovelId, "continuity-test")
    expect(row).not.toBeNull()
    expect(row!.agent).toBe("continuity-test")
    expect(row!.temperature).toBe(0.2)
    expect(row!.zod_validation_success).toBe(0)
    expect(row!.zod_errors).toContain("issues.0.chapter: Expected number")
    expect(row!.http_attempts).toBe(2)
    const retryErrors = JSON.parse(row!.retry_errors!)
    expect(retryErrors[0].status).toBe(429)
  })

  test("stores token counts and latency", () => {
    logLLMCallStructured(testNovelId, makeLogEntry({
      agent: "token-test",
      promptTokens: 500,
      completionTokens: 1200,
      totalLatencyMs: 3500,
      tokensPerSec: 343,
    }))
    const db = getDB()
    const row = db.query<{
      prompt_tokens: number; completion_tokens: number;
      total_latency_ms: number; tokens_per_sec: number;
    }, []>(
      "SELECT prompt_tokens, completion_tokens, total_latency_ms, tokens_per_sec FROM llm_calls WHERE novel_id = ? AND agent = ?",
    ).get(testNovelId, "token-test")
    expect(row!.prompt_tokens).toBe(500)
    expect(row!.completion_tokens).toBe(1200)
    expect(row!.total_latency_ms).toBe(3500)
    expect(row!.tokens_per_sec).toBe(343)
  })
})
