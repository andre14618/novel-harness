import { describe, test, expect, afterAll } from "bun:test"
import { rmSync, readFileSync } from "node:fs"
import { log, logLLMCall, logLLMCallStructured, type LLMCallLogEntry } from "../src/logger"

const testNovelId = `test-logger-${crypto.randomUUID()}`
const logDir = `output/${testNovelId}`

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

describe("logLLMCall", () => {
  test("logs agent name and token counts", () => {
    logLLMCall(testNovelId, "writer", { prompt: 500, completion: 1200 })
    const content = require("node:fs").readFileSync(`${logDir}/harness.log`, "utf-8")
    expect(content).toContain("LLM [writer]")
    expect(content).toContain("500")
    expect(content).toContain("1200")
    expect(content).toContain("1700") // total
  })
})

// ── Structured JSONL Logging ──────────────────────────────────────────────

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
  test("creates JSONL file with valid JSON lines", () => {
    logLLMCallStructured(testNovelId, makeLogEntry({ agent: "world-builder" }))
    const content = readFileSync(`${logDir}/llm-calls.jsonl`, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const parsed = JSON.parse(lines[lines.length - 1])
    expect(parsed.agent).toBe("world-builder")
    expect(parsed.model).toBe("test-model")
  })

  test("appends multiple entries", () => {
    logLLMCallStructured(testNovelId, makeLogEntry({ agent: "call-1" }))
    logLLMCallStructured(testNovelId, makeLogEntry({ agent: "call-2" }))
    const content = readFileSync(`${logDir}/llm-calls.jsonl`, "utf-8")
    const lines = content.trim().split("\n")
    const agents = lines.map(l => JSON.parse(l).agent)
    expect(agents).toContain("call-1")
    expect(agents).toContain("call-2")
  })

  test("captures all fields", () => {
    const entry = makeLogEntry({
      agent: "continuity",
      temperature: 0.2,
      zodValidationSuccess: false,
      zodErrors: ["issues.0.chapter: Expected number"],
      httpAttempts: 2,
      retryErrors: [{ status: 429, delay: 5000 }],
    })
    logLLMCallStructured(testNovelId, entry)
    const content = readFileSync(`${logDir}/llm-calls.jsonl`, "utf-8")
    const lines = content.trim().split("\n")
    const parsed = JSON.parse(lines[lines.length - 1])
    expect(parsed.agent).toBe("continuity")
    expect(parsed.temperature).toBe(0.2)
    expect(parsed.zodValidationSuccess).toBe(false)
    expect(parsed.zodErrors).toContain("issues.0.chapter: Expected number")
    expect(parsed.httpAttempts).toBe(2)
    expect(parsed.retryErrors[0].status).toBe(429)
  })
})
