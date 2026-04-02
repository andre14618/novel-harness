import { z } from "zod"
import { logLLMCallStructured, type LLMCallLogEntry } from "./logger"
import {
  PROVIDERS, getApiKey, getTokenCost, getModel,
  type ProviderName, type ProviderDef,
} from "../models/registry"
import { getModelForAgent, getAgentConfig, type ModelAssignment } from "../models/roles"
import { getTransport, type LLMResponse } from "./transport"

export type { ProviderName } from "../models/registry"

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
}

interface AgentResult<T> {
  output: T
  tokensUsed: { prompt: number; completion: number }
}

interface MakeRequestResult {
  content: string
  usage: { prompt_tokens: number; completion_tokens: number }
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

// ── HTTP Request ──────────────────────────────────────────────────────────
// Delegates to the active LLMTransport (see src/transport.ts).
// Direct, batch, and cache-aware modes are all handled by the transport layer.

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
  const temperature = config.temperature ?? 0.7
  const maxTokens = config.maxTokens ?? 4096
  const thinking = config.thinking ?? false
  const providerName = resolveProviderName(config.provider)
  const provider = resolveProvider(config.provider)
  const model = resolveModel(config.provider, config.model)

  // /nothink only needed for Qwen 3 on Groq/OpenRouter (Cerebras model doesn't support thinking)
  const needsNothink = !thinking && providerName !== "cerebras"
  console.log(`  [LLM] Calling ${model} (temp=${temperature}${needsNothink ? ", nothink" : ""})...`)

  const userPrompt = needsNothink ? `/nothink\n${config.userPrompt}` : config.userPrompt

  let content = ""
  let requestResult: MakeRequestResult | null = null
  let jsonExtractionSuccess = false
  let jsonExtractionRetried = false
  let zodValidationSuccess = false
  let zodErrors: string[] = []

  try {
    requestResult = await makeRequest(config.systemPrompt, userPrompt, temperature, maxTokens, provider, model, providerName)
    content = requestResult.content

    totalTokens.prompt += requestResult.usage.prompt_tokens
    totalTokens.completion += requestResult.usage.completion_tokens
    const callCost = getTokenCost(providerName, model, requestResult.usage.prompt_tokens, requestResult.usage.completion_tokens)
    console.log(`  [LLM] Response: ${requestResult.usage.prompt_tokens}+${requestResult.usage.completion_tokens} tokens ($${callCost.toFixed(4)})`)

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
  } finally {
    if (config.novelId && requestResult) {
      const latency = requestResult.totalLatencyMs
      const completionTokens = requestResult.usage.completion_tokens
      const tps = latency > 0 ? Math.round(completionTokens / (latency / 1000)) : 0

      const entry: LLMCallLogEntry = {
        timestamp: new Date().toISOString(),
        agent: config.agentName ?? "unknown",
        model,
        provider: providerName,
        temperature, maxTokens, thinking,
        systemPromptLength: config.systemPrompt.length,
        userPromptLength: config.userPrompt.length,
        contentPreview: content.slice(0, 200),
        promptTokens: requestResult.usage.prompt_tokens,
        completionTokens,
        totalLatencyMs: Math.round(latency),
        tokensPerSec: tps,
        jsonExtractionSuccess, jsonExtractionRetried,
        zodValidationSuccess, zodErrors,
        httpAttempts: requestResult.httpAttempts,
        retryErrors: requestResult.retryErrors,
      }

      try { logLLMCallStructured(config.novelId, entry) } catch {}
    }
  }
}
