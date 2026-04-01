import { appendFileSync, existsSync, mkdirSync } from "node:fs"

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

export function logLLMCall(novelId: string, agent: string, tokens: { prompt: number; completion: number }): void {
  log(novelId, "info", `LLM [${agent}]: ${tokens.prompt}+${tokens.completion} tokens (${tokens.prompt + tokens.completion} total)`)
}

// ── Structured JSONL Logging ──────────────────────────────────────────────

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
  const dir = `output/${novelId}`
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(`${dir}/llm-calls.jsonl`, JSON.stringify(entry) + "\n")
}
