import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { getDB } from "./db"

type LogLevel = "info" | "warn" | "error" | "checkpoint"

const LEVEL_LABELS: Record<LogLevel, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  checkpoint: "CHKPT",
}

export function log(novelId: string, level: LogLevel, message: string): void {
  const dir = `output/${novelId}`
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] [${LEVEL_LABELS[level]}] ${message}\n`

  appendFileSync(`${dir}/harness.log`, line)
}

// ── Structured LLM Call Logging (SQLite) ─────────────────────────────────

export interface LLMCallLogEntry {
  timestamp: string
  agent: string
  model: string
  provider: string
  temperature: number
  maxTokens: number
  thinking: boolean
  systemPromptLength: number
  userPromptLength: number
  contentPreview: string
  promptTokens: number
  completionTokens: number
  totalLatencyMs: number
  tokensPerSec: number
  jsonExtractionSuccess: boolean
  jsonExtractionRetried: boolean
  zodValidationSuccess: boolean
  zodErrors: string[]
  httpAttempts: number
  retryErrors: Array<{ status: number; delay: number }>
}

export function logLLMCallStructured(novelId: string, entry: LLMCallLogEntry): void {
  const db = getDB()
  db.run(
    `INSERT INTO llm_calls (
      novel_id, timestamp, agent, model, provider, temperature, max_tokens, thinking,
      system_prompt_length, user_prompt_length, prompt_tokens, completion_tokens,
      total_latency_ms, tokens_per_sec, json_extraction_success, json_extraction_retried,
      zod_validation_success, zod_errors, http_attempts, retry_errors
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      novelId,
      entry.timestamp,
      entry.agent,
      entry.model,
      entry.provider,
      entry.temperature,
      entry.maxTokens,
      entry.thinking ? 1 : 0,
      entry.systemPromptLength,
      entry.userPromptLength,
      entry.promptTokens,
      entry.completionTokens,
      Math.round(entry.totalLatencyMs),
      entry.tokensPerSec,
      entry.jsonExtractionSuccess ? 1 : 0,
      entry.jsonExtractionRetried ? 1 : 0,
      entry.zodValidationSuccess ? 1 : 0,
      entry.zodErrors.length > 0 ? JSON.stringify(entry.zodErrors) : null,
      entry.httpAttempts,
      entry.retryErrors.length > 0 ? JSON.stringify(entry.retryErrors) : null,
    ],
  )
}
