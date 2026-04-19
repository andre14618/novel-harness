import { z } from "zod"
import { logLLMCallStructured, type LLMCallLogEntry } from "./logger"
import { emit } from "./events"
import { traceAgentStart, traceAgentComplete, traceAgentFail, traceLLMCallStart, broadcastLLMToken } from "./trace"
import {
  PROVIDERS, getApiKey, getTokenCost, getModel,
  type ProviderName, type ProviderDef,
} from "./models/registry"
import { getModelForAgent, getAgentConfig, type ModelAssignment } from "./models/roles"
import { getTransport, type LLMResponse } from "./transport"

export type { ProviderName } from "./models/registry"

// ── Provider resolution ──────────────────────────────────────────────────

interface ProviderConfig {
  apiUrl: string
  getApiKey: () => string
  extraBody: () => Record<string, any>
}

function toProviderConfig(name: ProviderName): ProviderConfig {
  const def = PROVIDERS[name]
  return {
    apiUrl: def.apiUrl,
    getApiKey: () => getApiKey(name),
    extraBody: () => def.extraBody?.() ?? {},
  }
}

const MODEL_DEFAULTS: Record<string, string> = {
  cerebras: "qwen-3-235b-a22b-instruct-2507",
  groq: "qwen/qwen3-32b",
  openrouter: "qwen/qwen3-32b",
  openai: "gpt-5.4-mini",
  deepseek: "deepseek-chat",
}

// Global defaults from .env
const DEFAULT_PROVIDER = (process.env.LLM_PROVIDER ?? "openrouter") as ProviderName
const DEFAULT_MODEL = process.env.MODEL ?? MODEL_DEFAULTS[DEFAULT_PROVIDER] ?? "qwen/qwen3-32b"

function resolveProvider(override?: ProviderName): ProviderConfig {
  const name = override ?? DEFAULT_PROVIDER
  return toProviderConfig(name)
}

function resolveModel(providerOverride?: ProviderName, modelOverride?: string): string {
  if (modelOverride) return modelOverride
  if (providerOverride) return MODEL_DEFAULTS[providerOverride] ?? DEFAULT_MODEL
  return DEFAULT_MODEL
}

function resolveProviderName(override?: ProviderName): ProviderName {
  return override ?? DEFAULT_PROVIDER
}

// ── Interfaces ────────────────────────────────────────────────────────────

interface AgentConfig<T> {
  systemPrompt: string
  userPrompt: string
  schema: z.ZodSchema<T>
  temperature?: number
  maxTokens?: number
  thinking?: boolean
  novelId?: string
  agentName?: string
  provider?: ProviderName  // override global provider for this call
  model?: string           // override global model for this call
  // Drill-down tags persisted to llm_calls for the inspector view.
  // Pass these from callers that know which beat / chapter / attempt
  // they're working in (drafting loop, retry loops, etc.).
  chapter?: number
  beatIndex?: number
  attempt?: number
}

interface AgentResult<T> {
  output: T
  tokensUsed: { prompt: number; completion: number }
}

interface MakeRequestResult {
  content: string
  usage: { prompt_tokens: number; completion_tokens: number; cached_tokens: number }
  totalLatencyMs: number
  httpAttempts: number
  retryErrors: Array<{ status: number; delay: number }>
}

// ── Agent Module Interface ────────────────────────────────────────────────

export interface AgentModule<T> {
  prompt: string
  schema: z.ZodSchema<T>
  config: {
    name: string
    temperature: number
    maxTokens: number
    thinking: boolean
  }
}

export async function runAgent<T>(
  agent: AgentModule<T>,
  userPrompt: string,
  novelId?: string,
): Promise<AgentResult<T>> {
  // Centralized config (roles.ts) takes precedence over agent module config
  const role = getAgentConfig(agent.config.name)

  return callAgent({
    systemPrompt: agent.prompt,
    schema: agent.schema,
    temperature: role?.temperature ?? agent.config.temperature,
    maxTokens: role?.maxTokens ?? agent.config.maxTokens,
    thinking: role?.thinking ?? agent.config.thinking,
    provider: role?.provider,
    model: role?.model,
    userPrompt,
    novelId,
    agentName: agent.config.name,
  })
}

// ── JSON Extraction ───────────────────────────────────────────────────────

export function extractJSON(raw: string): string {
  try { JSON.parse(raw); return raw } catch {}

  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (codeBlockMatch) {
    try { JSON.parse(codeBlockMatch[1].trim()); return codeBlockMatch[1].trim() } catch {}
  }

  const braceStart = raw.indexOf("{")
  const bracketStart = raw.indexOf("[")
  let start = -1
  if (braceStart >= 0 && (bracketStart < 0 || braceStart < bracketStart)) start = braceStart
  else if (bracketStart >= 0) start = bracketStart

  if (start >= 0) {
    const openChar = raw[start]
    const closeChar = openChar === "{" ? "}" : "]"
    let depth = 0
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === openChar) depth++
      else if (raw[i] === closeChar) depth--
      if (depth === 0) {
        const candidate = raw.slice(start, i + 1)
        try { JSON.parse(candidate); return candidate } catch {}
      }
    }
  }

  throw new Error(`Could not extract JSON from response:\n${raw.slice(0, 500)}`)
}

// ── Direct Transport Wrapper with Logging ────────────────────────────────
// For callers that bypass callAgent (e.g. beat-writer, lint fixers — they need
// raw text output instead of JSON+schema validation). Wraps transport.execute()
// so the call still lands in the llm_calls table for queryable timing analysis.

// Optional drill-down tags for executeAndLog. Pass these from agents that
// know which beat / chapter / attempt they're working on (e.g. beat-writer,
// adherence-checker inside the drafting loop) so the inspector view can
// filter llm_calls down to a specific beat/attempt.
export interface ExecuteTags {
  chapter?: number
  beatIndex?: number
  attempt?: number
}

// Execution options — streaming toggles token-level SSE broadcasts so the live
// pipeline view can render prose as it's generated. meta carries human-readable
// fields (beat description, total beats, etc.) surfaced in the llm-call-start
// event so the UI can render "Writing beat 3: Eliza confronts Marcus…" titles.
export interface ExecuteOpts {
  stream?: boolean
  meta?: Record<string, unknown>
}

// Strip prompts from the request envelope before serializing — they're stored
// in dedicated columns (system_prompt, user_prompt) for easy querying. This
// keeps request_json focused on the OTHER call shape that matters for
// reproducibility: model, provider, temperature, responseFormat, extraBody,
// useMaxCompletionTokens, callerId.
function requestEnvelopeForLog(req: import("./transport").LLMRequest): Record<string, any> {
  const { systemPrompt: _sp, userPrompt: _up, ...rest } = req
  return rest
}

function formatErrorForLog(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`
  }
  try {
    return typeof err === "string" ? err : JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// Guarantee: every call to executeAndLog produces exactly one row in llm_calls
// when novelId is set, regardless of whether the underlying execute() succeeded
// or threw. On failure, the row has failed=true and error_text populated.
// The error is re-thrown so caller behavior is unchanged.
export async function executeAndLog(
  request: import("./transport").LLMRequest,
  novelId: string | undefined,
  agentName: string,
  tags?: ExecuteTags,
  opts?: ExecuteOpts,
): Promise<LLMResponse> {
  const startedAt = Date.now()
  let response: LLMResponse | null = null
  let caughtError: unknown = null

  // Broadcast call-start before firing the request so the live UI can show
  // an in-flight row immediately. Persisted so the trace view can also see it.
  if (novelId) {
    try {
      await traceLLMCallStart(novelId, {
        agent: agentName,
        chapter: tags?.chapter,
        beatIndex: tags?.beatIndex,
        attempt: tags?.attempt,
        model: request.model,
        provider: request.provider,
        meta: opts?.meta,
      })
    } catch (err) {
      console.error(`[trace] llm-call-start failed for ${agentName}:`, err)
    }
  }

  // If the caller asked for streaming, wire a streaming request that forwards
  // every content delta onto the SSE bus as an llm-token event. The accumulated
  // content is still returned via the normal LLMResponse.content so callers
  // don't need to care about the stream.
  const effectiveRequest: import("./transport").LLMRequest =
    opts?.stream && novelId
      ? {
          ...request,
          streaming: true,
          onChunk: (delta: string) => {
            broadcastLLMToken(novelId, {
              agent: agentName,
              chapter: tags?.chapter,
              beatIndex: tags?.beatIndex,
              delta,
            })
          },
        }
      : request

  // In-flight heartbeat — emits a trace:llm-in-flight event every 5s while
  // the fetch is open. Gives test watchers a liveness signal during
  // non-streaming calls (concept/planning/checkers) that would otherwise
  // sit silent for 30-60s on slow providers like DeepSeek. Non-persistent
  // (SSE-only, not written to pipeline_events) to avoid DB noise. Codex
  // review a13ff46cc19e58d5a recommended this shape vs global streaming.
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  if (novelId) {
    heartbeatTimer = setInterval(() => {
      try {
        emit(novelId, {
          type: "trace" as any,
          data: {
            eventType: "llm-in-flight",
            agent: agentName,
            provider: request.provider,
            model: request.model,
            chapter: tags?.chapter,
            beatIndex: tags?.beatIndex,
            attempt: tags?.attempt,
            elapsedMs: Date.now() - startedAt,
          },
          timestamp: new Date().toISOString(),
        })
      } catch { /* ignore emit errors — liveness only */ }
    }, 5000)
  }

  try {
    response = await getTransport().execute(effectiveRequest)
    return response
  } catch (err) {
    caughtError = err
    throw err
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (novelId) {
      const failed = caughtError != null
      const latencyMs = response?.latencyMs ?? (Date.now() - startedAt)
      const promptTokens = response?.usage.prompt_tokens ?? 0
      const completionTokens = response?.usage.completion_tokens ?? 0
      const cachedTokens = response?.usage.cached_tokens ?? 0
      const tps = latencyMs > 0 && completionTokens > 0
        ? Math.round(completionTokens / (latencyMs / 1000))
        : 0
      const cost = response
        ? getTokenCost(request.provider, request.model, promptTokens, completionTokens, cachedTokens)
        : 0
      let llmCallId: number | null = null
      try {
        llmCallId = await logLLMCallStructured(novelId, {
          timestamp: new Date().toISOString(),
          agent: agentName,
          model: request.model,
          provider: request.provider,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          thinking: false,
          systemPromptLength: request.systemPrompt.length,
          userPromptLength: request.userPrompt.length,
          contentPreview: response?.content.slice(0, 200) ?? "",
          promptTokens,
          completionTokens,
          cachedTokens,
          totalLatencyMs: Math.round(latencyMs),
          tokensPerSec: tps,
          cost,
          jsonExtractionSuccess: !failed,
          jsonExtractionRetried: false,
          zodValidationSuccess: !failed,
          zodErrors: [],
          httpAttempts: response?.httpAttempts ?? 0,
          retryErrors: response?.retryErrors ?? [],
          systemPrompt: request.systemPrompt,
          userPrompt: request.userPrompt,
          responseContent: response?.content,
          chapter: tags?.chapter,
          beatIndex: tags?.beatIndex,
          attempt: tags?.attempt,
          requestJson: requestEnvelopeForLog(request),
          failed,
          errorText: caughtError ? formatErrorForLog(caughtError) : undefined,
        })
      } catch (logErr) {
        console.error(`[llm-inspector] failed to log ${agentName} call:`, logErr)
      }

      // Unified trace: persists to pipeline_events + broadcasts via SSE.
      try {
        if (failed) {
          await traceAgentFail(novelId, agentName, formatErrorForLog(caughtError).slice(0, 500), {
            chapter: tags?.chapter,
            beatIndex: tags?.beatIndex,
            llmCallId,
            durationMs: Math.round(latencyMs),
          })
        } else {
          await traceAgentComplete(novelId, agentName, {
            chapter: tags?.chapter,
            beatIndex: tags?.beatIndex,
            attempt: tags?.attempt,
            llmCallId,
            durationMs: Math.round(latencyMs),
            tokens: { prompt: promptTokens, completion: completionTokens },
            cost,
          })
        }
      } catch (traceErr) {
        console.error(`[trace] failed for ${agentName}:`, traceErr)
      }
    }
  }
}

// ── HTTP Request ──────────────────────────────────────────────────────────
// Delegates to the active LLMTransport (see src/transport.ts).
// Direct and batch modes are handled by the transport layer.

async function makeRequest(
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
  provider: ProviderConfig,
  model: string,
  providerName: ProviderName,
): Promise<MakeRequestResult> {
  const response: LLMResponse = await getTransport().execute({
    systemPrompt,
    userPrompt,
    model,
    provider: providerName,
    temperature,
    maxTokens,
    responseFormat: { type: "json_object" },
    extraBody: provider.extraBody(),
  })
  return {
    content: response.content,
    usage: response.usage,
    totalLatencyMs: response.latencyMs,
    httpAttempts: response.httpAttempts,
    retryErrors: response.retryErrors,
  }
}

// ── Token Tracking ────────────────────────────────────────────────────────

let totalTokens = { prompt: 0, completion: 0 }

export function getTokenUsage() {
  return { ...totalTokens }
}

// ── callAgent ─────────────────────────────────────────────────────────────

export async function callAgent<T>(config: AgentConfig<T>): Promise<AgentResult<T>> {
  // Look up agent in roles.ts — use as base, explicit config values override.
  // Falls back to base agent name (strip -retry) if no exact match.
  const role = config.agentName
    ? (getAgentConfig(config.agentName) ?? getAgentConfig(config.agentName.replace(/-retry$/, "")))
    : undefined
  const temperature = config.temperature ?? role?.temperature ?? 0.7
  const maxTokens = config.maxTokens ?? role?.maxTokens ?? 4096
  const thinking = config.thinking ?? role?.thinking ?? false
  const effectiveProvider = config.provider ?? role?.provider
  const effectiveModel = config.model ?? role?.model
  const providerName = resolveProviderName(effectiveProvider)
  const provider = resolveProvider(effectiveProvider)
  const model = resolveModel(effectiveProvider, effectiveModel)

  // /nothink is a Qwen convention — only apply to models that explicitly declare it
  const modelDef = getModel(model, providerName)
  const needsNothink = !thinking && !!modelDef?.needsNothink
  console.log(`  [LLM] Calling ${model} (temp=${temperature}${needsNothink ? ", nothink" : ""})...`)

  const userPrompt = needsNothink ? `/nothink\n${config.userPrompt}` : config.userPrompt

  let content = ""
  let requestResult: MakeRequestResult | null = null
  let jsonExtractionSuccess = false
  let jsonExtractionRetried = false
  let zodValidationSuccess = false
  let zodErrors: string[] = []
  let caughtError: unknown = null
  const startedAt = Date.now()

  // Broadcast call-start so the live UI can render an in-flight row before
  // the LLM actually returns. Fire-and-forget — failures never block the call.
  if (config.novelId) {
    traceLLMCallStart(config.novelId, {
      agent: config.agentName ?? "unknown",
      chapter: config.chapter,
      beatIndex: config.beatIndex,
      attempt: config.attempt,
      model,
      provider: providerName,
    }).catch(err => console.error(`[trace] llm-call-start failed:`, err))
  }

  // In-flight heartbeat — emits trace:llm-in-flight every 5s while the
  // request is open. Matches the executeAndLog pattern. Required for
  // test watchers to distinguish "slow DeepSeek call" from "stalled
  // pipeline" during concept/planning/checker phases that don't stream.
  // Non-persistent SSE-only. Codex review a13ff46cc19e58d5a.
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  if (config.novelId) {
    heartbeatTimer = setInterval(() => {
      try {
        emit(config.novelId!, {
          type: "trace" as any,
          data: {
            eventType: "llm-in-flight",
            agent: config.agentName ?? "unknown",
            provider: providerName,
            model,
            chapter: config.chapter,
            beatIndex: config.beatIndex,
            attempt: config.attempt,
            elapsedMs: Date.now() - startedAt,
          },
          timestamp: new Date().toISOString(),
        })
      } catch { /* ignore emit errors — liveness only */ }
    }, 5000)
  }

  try {
    requestResult = await makeRequest(config.systemPrompt, userPrompt, temperature, maxTokens, provider, model, providerName)
    content = requestResult.content

    totalTokens.prompt += requestResult.usage.prompt_tokens
    totalTokens.completion += requestResult.usage.completion_tokens
    const callCost = getTokenCost(providerName, model, requestResult.usage.prompt_tokens, requestResult.usage.completion_tokens, requestResult.usage.cached_tokens)
    const cachedSuffix = requestResult.usage.cached_tokens > 0 ? ` [cache:${requestResult.usage.cached_tokens}]` : ""
    console.log(`  [LLM] Response: ${requestResult.usage.prompt_tokens}+${requestResult.usage.completion_tokens} tokens ($${callCost.toFixed(4)})${cachedSuffix}`)

    let jsonStr: string
    try {
      jsonStr = extractJSON(content)
      jsonExtractionSuccess = true
    } catch (e) {
      console.log("  [LLM] JSON extraction failed, retrying...")
      jsonExtractionRetried = true
      const retryResult = await makeRequest(
        config.systemPrompt + "\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown, no commentary.",
        config.userPrompt, temperature, maxTokens, provider, model, providerName,
      )
      requestResult = retryResult
      content = retryResult.content
      jsonStr = extractJSON(content)
      jsonExtractionSuccess = true
    }

    const parsed = JSON.parse(jsonStr)
    if (parsed === null || parsed === undefined) throw new Error("LLM returned null/undefined instead of a JSON object")

    const result = config.schema.safeParse(parsed)
    if (!result.success) {
      zodErrors = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`)
      console.error("  [LLM] Zod validation failed:", result.error.issues)
      console.error("  [LLM] Raw parsed JSON keys:", Object.keys(parsed))
      throw new Error(`LLM output doesn't match schema: ${zodErrors.join(", ")}`)
    }

    zodValidationSuccess = true
    return {
      output: result.data,
      tokensUsed: { prompt: requestResult.usage.prompt_tokens, completion: requestResult.usage.completion_tokens },
    }
  } catch (err) {
    // Capture the error so the finally block can record it. We re-throw below
    // so caller behavior is unchanged.
    caughtError = err
    throw err
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    // Always log when we have a novel context — even when makeRequest threw
    // (requestResult is null) or zod validation failed. This is the troubleshooting
    // guarantee: every attempt produces exactly one row.
    if (config.novelId) {
      const failed = caughtError != null
      const latency = requestResult?.totalLatencyMs ?? (Date.now() - startedAt)
      const promptTokens = requestResult?.usage.prompt_tokens ?? 0
      const completionTokens = requestResult?.usage.completion_tokens ?? 0
      const cachedTokens = requestResult?.usage.cached_tokens ?? 0
      const tps = latency > 0 && completionTokens > 0
        ? Math.round(completionTokens / (latency / 1000))
        : 0
      const cost = requestResult
        ? getTokenCost(providerName, model, promptTokens, completionTokens, cachedTokens)
        : 0

      const entry: LLMCallLogEntry = {
        timestamp: new Date().toISOString(),
        agent: config.agentName ?? "unknown",
        model,
        provider: providerName,
        temperature, maxTokens, thinking,
        systemPromptLength: config.systemPrompt.length,
        userPromptLength: config.userPrompt.length,
        contentPreview: content.slice(0, 200),
        promptTokens,
        completionTokens,
        cachedTokens,
        totalLatencyMs: Math.round(latency),
        tokensPerSec: tps,
        cost,
        jsonExtractionSuccess, jsonExtractionRetried,
        zodValidationSuccess, zodErrors,
        httpAttempts: requestResult?.httpAttempts ?? 0,
        retryErrors: requestResult?.retryErrors ?? [],
        systemPrompt: config.systemPrompt,
        userPrompt: config.userPrompt,
        responseContent: content || undefined,
        chapter: config.chapter,
        beatIndex: config.beatIndex,
        attempt: config.attempt,
        // Reconstruct the request envelope for reproducibility. We don't have
        // the literal extraBody/responseFormat from inside makeRequest here,
        // so we re-derive from the same provider config makeRequest used.
        requestJson: {
          model,
          provider: providerName,
          temperature,
          maxTokens,
          thinking,
          responseFormat: { type: "json_object" },
          extraBody: provider.extraBody(),
          needsNothink,
        },
        failed,
        errorText: caughtError ? formatErrorForLog(caughtError) : undefined,
      }

      // Awaited so the always-log guarantee is strict: when this function
      // returns or throws, the row exists. Log errors are surfaced to stderr
      // but never replace the original LLM error from the try block.
      let llmCallId: number | null = null
      try {
        llmCallId = await logLLMCallStructured(config.novelId, entry)
      } catch (logErr) {
        console.error(`[llm-inspector] failed to log ${entry.agent} call:`, logErr)
      }

      // Unified trace: persists to pipeline_events + broadcasts via SSE.
      try {
        if (failed) {
          await traceAgentFail(config.novelId, entry.agent, formatErrorForLog(caughtError).slice(0, 500), {
            chapter: config.chapter,
            beatIndex: config.beatIndex,
            llmCallId,
            durationMs: Math.round(latency),
          })
        } else {
          await traceAgentComplete(config.novelId, entry.agent, {
            chapter: config.chapter,
            beatIndex: config.beatIndex,
            attempt: config.attempt,
            llmCallId,
            durationMs: Math.round(latency),
            tokens: { prompt: promptTokens, completion: completionTokens },
            cost,
          })
        }
      } catch (traceErr) {
        console.error(`[trace] failed for ${entry.agent}:`, traceErr)
      }
    }
  }
}
