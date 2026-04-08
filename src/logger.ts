import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { logLLMCall as centralLogLLMCall, createRun, type LLMCallData } from "../data/db"

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

// ── Central DB run tracking ──────────────────────────────────────────────

let currentRunId: number | null = null

export async function initNovelRun(novelId: string): Promise<number> {
  currentRunId = await createRun("novel", novelId)
  return currentRunId
}

export function getRunId(): number | null {
  return currentRunId
}

// ── Structured LLM Call Logging ──────────────────────────────────────────

// Keep the interface for backwards compatibility with src/llm.ts
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
  cost: number
  httpAttempts: number
  retryErrors: Array<{ status: number; delay: number }>
}

export async function logLLMCallStructured(novelId: string, entry: LLMCallLogEntry): Promise<void> {
  if (!currentRunId) return

  // Determine phase from agent name
  const phase = getPhaseForAgent(entry.agent)

  await centralLogLLMCall(currentRunId, {
    agent: entry.agent,
    phase,
    model: entry.model,
    provider: entry.provider,
    temperature: entry.temperature,
    maxTokens: entry.maxTokens,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    latencyMs: entry.totalLatencyMs,
    cost: entry.cost ?? 0,
    jsonExtractionSuccess: entry.jsonExtractionSuccess,
    jsonExtractionRetried: entry.jsonExtractionRetried,
    zodValidationSuccess: entry.zodValidationSuccess,
    zodErrors: entry.zodErrors,
    httpAttempts: entry.httpAttempts,
    retryErrors: entry.retryErrors,
  })
}

function getPhaseForAgent(agent: string): string {
  const PHASE_MAP: Record<string, string> = {
    "world-builder": "concept",
    "character-agent": "concept",
    "plotter": "concept",
    "planning-plotter": "planning",
    "writer": "drafting",
    "continuity": "drafting",
    "summary-extractor": "extraction",
    "fact-extractor": "extraction",
    "character-state": "extraction",
    "rewriter": "validation",
  }
  return PHASE_MAP[agent] ?? "unknown"
}
