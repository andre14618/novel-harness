import { describe, test, expect, afterAll } from "bun:test"
import { rmSync } from "node:fs"
import { log, logLLMCall } from "../src/logger"

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
