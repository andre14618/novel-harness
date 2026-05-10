import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import { logLLMCall as centralLogLLMCall, createRun, type LLMCallData } from "./db/ops"

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

/**
 * Initialize an experiment-scoped run for telemetry capture. Unlike a novel
 * run, this is keyed off a `tuning_experiments.id` instead of a novel_id, so
 * experiment workflows (replay runners, parity harnesses, judge wrappers) can
 * persist llm_calls rows that later join back to the experiment via
 * runs.experiment_id → tuning_experiments.id.
 *
 * Added 2026-04-20 after Codex telemetry audit finding #1: the conditioning-
 * floor replay was calling executeAndLog with novelId=undefined to avoid
 * polluting novel traces, which also bypassed the canonical llm_calls
 * ledger. With this path, the three writer calls per beat persist properly
 * and are SQL-joinable by experiment.
 */
export async function initExperimentRun(
  experimentId: number,
  runType: string,
  runRef?: string,
  label?: string,
): Promise<number> {
  currentRunId = await createRun(runType, runRef, label, experimentId)
  return currentRunId
}

export function getRunId(): number | null {
  return currentRunId
}

export function setRunIdForTest(runId: number | null): void {
  currentRunId = runId
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
  cachedTokens?: number
  totalLatencyMs: number
  tokensPerSec: number
  jsonExtractionSuccess: boolean
  jsonExtractionRetried: boolean
  zodValidationSuccess: boolean
  zodErrors: string[]
  cost: number
  httpAttempts: number
  retryErrors: Array<{ status: number; delay: number }>
  // Full prompt + response text and drill-down tags. Persisted to llm_calls
  // so the inspector view (src/orchestrator/novel-routes.ts → /api/novel/llm-calls)
  // can show what every agent received and produced. See sql/017_llm_call_inspection.sql.
  systemPrompt?: string
  userPrompt?: string
  responseContent?: string
  chapter?: number
  beatIndex?: number
  sceneId?: string
  beatId?: string
  attempt?: number
  // Failure capture (sql/018_llm_call_errors.sql) — every attempt produces a row,
  // even when the call throws. requestJson is the full LLMRequest envelope so the
  // call is reproducible from the row alone.
  requestJson?: Record<string, any>
  failed?: boolean
  errorText?: string
}

export async function logLLMCallStructured(novelId: string | null, entry: LLMCallLogEntry): Promise<number | null> {
  if (!currentRunId) {
    // Silent drop would leave llm_calls missing rows. Warn loudly so we notice
    // the moment a resume path forgets to call initNovelRun() / initExperimentRun().
    console.warn(`[logger] logLLMCallStructured called with no currentRunId — dropping ${entry.agent} call for ${novelId ? `novel ${novelId}` : "experiment-scoped path"}`)
    return null
  }

  // Determine phase from agent name
  const phase = getPhaseForAgent(entry.agent)

  return await centralLogLLMCall(currentRunId, {
    agent: entry.agent,
    phase,
    model: entry.model,
    provider: entry.provider,
    temperature: entry.temperature,
    maxTokens: entry.maxTokens,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    cachedTokens: entry.cachedTokens,
    latencyMs: entry.totalLatencyMs,
    cost: entry.cost ?? 0,
    jsonExtractionSuccess: entry.jsonExtractionSuccess,
    jsonExtractionRetried: entry.jsonExtractionRetried,
    zodValidationSuccess: entry.zodValidationSuccess,
    zodErrors: entry.zodErrors,
    httpAttempts: entry.httpAttempts,
    retryErrors: entry.retryErrors,
    systemPrompt: entry.systemPrompt,
    userPrompt: entry.userPrompt,
    responseContent: entry.responseContent,
    novelId: novelId ?? undefined,
    chapter: entry.chapter,
    beatIndex: entry.beatIndex,
    sceneId: entry.sceneId,
    beatId: entry.beatId,
    attempt: entry.attempt,
    requestJson: entry.requestJson,
    failed: entry.failed,
    errorText: entry.errorText,
  })
}

function getPhaseForAgent(agent: string): string {
  const PHASE_MAP: Record<string, string> = {
    "world-builder": "concept",
    "character-agent": "concept",
    "plotter": "concept",
    "planning-plotter": "planning",
    "planning-beats": "planning",
    "planning-state-mapper": "planning",
    "planning-state-repair": "planning",
    "planner-semantic-label-flash": "planning",
    "planner-semantic-label-pro": "planning",
    "writer": "drafting",
    "beat-writer": "drafting",
    "reference-resolver": "drafting",
    "adherence-events": "drafting",
    "halluc-ungrounded": "drafting",
    "functional-state-checker": "drafting",
    "chapter-plan-checker": "drafting",
    "continuity": "drafting",
    "lint-fixer": "drafting",
  }
  return PHASE_MAP[agent] ?? "unknown"
}
