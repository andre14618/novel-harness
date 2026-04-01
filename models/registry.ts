/**
 * Central model registry.
 *
 * Single source of truth for all available models, providers, pricing,
 * and observed performance. Everything that touches an LLM should
 * resolve models through this registry.
 *
 * Pricing last verified: 2026-04-01 (Groq pricing page, Cerebras limits page)
 */

// ── Provider definitions ─────────────────────────────────────────────────

export type ProviderName = "cerebras" | "groq" | "openrouter" | "openai" | "deepseek"

export interface ProviderDef {
  apiUrl: string
  envKey: string              // env var name for the API key
  tier: "fast" | "standard"   // fast = Cerebras/Groq inference hardware
  extraBody?: () => Record<string, any>
}

export const PROVIDERS: Record<ProviderName, ProviderDef> = {
  cerebras: {
    apiUrl: "https://api.cerebras.ai/v1/chat/completions",
    envKey: "CEREBRAS_API_KEY",
    tier: "fast",
  },
  groq: {
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    envKey: "GROQ_API_KEY",
    tier: "fast",
  },
  openrouter: {
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    envKey: "OPENROUTER_API_KEY",
    tier: "standard",
    extraBody: () => {
      const provider = process.env.PROVIDER
      return provider ? { provider: { order: [provider], allow_fallbacks: false } } : {}
    },
  },
  openai: {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    envKey: "OPENAI_API_KEY",
    tier: "standard",
  },
  deepseek: {
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    envKey: "DEEPSEEK_API_KEY",
    tier: "standard",
  },
}

// ── Model definitions ────────────────────────────────────────────────────

export interface ModelDef {
  id: string                  // model ID sent in API request
  label: string               // human-readable name
  provider: ProviderName
  params: string              // parameter count for reference
  pricing: {
    input: number             // $ per million input tokens
    output: number            // $ per million output tokens
  }
  thinking?: "enabled" | "disabled" | "optional"  // whether model supports thinking mode
  observedTps?: number         // measured tokens/sec from harness runs — updated by benchmark/calibrate
  maxContext?: number          // max context window in tokens
  maxOutput?: number           // max output tokens
  rateLimit?: {               // known rate limits
    requestsPerMin: number
    tokensPerMin: number
  }
  providerStatus?: "production" | "preview"
  notes?: string
  needsNothink?: boolean      // Qwen3 on Groq/OpenRouter needs /nothink prefix
  useMaxCompletionTokens?: boolean
}

export const MODELS: ModelDef[] = [

  // ── Groq (fast inference, prioritize for iteration) ────────────────────

  {
    id: "gpt-oss-20b-128k",
    label: "GPT-OSS 20B",
    provider: "groq",
    params: "20B",
    pricing: { input: 0.075, output: 0.30 },
    thinking: "disabled",
    maxContext: 128_000,
    providerStatus: "production",
    notes: "Cheapest fast model on Groq. Untested in harness — worth testing as extractor/validator.",
  },
  {
    id: "gpt-oss-120b-128k",
    label: "GPT-OSS 120B",
    provider: "groq",
    params: "120B",
    pricing: { input: 0.15, output: 0.60 },
    thinking: "disabled",
    maxContext: 128_000,
    providerStatus: "production",
    notes: "Same model as Cerebras gpt-oss-120b but cheaper on Groq. Strong mid-tier option.",
  },
  {
    id: "llama-4-scout-17bx16e-128k",
    label: "Llama 4 Scout",
    provider: "groq",
    params: "17Bx16E MoE",
    pricing: { input: 0.11, output: 0.34 },
    thinking: "disabled",
    maxContext: 128_000,
    providerStatus: "production",
    notes: "Meta Llama 4 MoE. Very cheap, fast. Untested in harness.",
  },
  {
    id: "qwen/qwen3-32b",
    label: "Qwen3 32B",
    provider: "groq",
    params: "32B",
    pricing: { input: 0.29, output: 0.59 },
    thinking: "optional",
    maxContext: 131_000,
    needsNothink: true,
    providerStatus: "production",
    notes: "Current default writer model. 100% judge discrimination in calibration. Has thinking mode — use /nothink to disable.",
  },
  {
    id: "meta-llama/llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    provider: "groq",
    params: "70B",
    pricing: { input: 0.59, output: 0.79 },
    thinking: "disabled",
    maxContext: 128_000,
    providerStatus: "production",
    notes: "404'd in calibration (2026-04-01) — may need correct model ID. Listed on Groq pricing page.",
  },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B",
    provider: "groq",
    params: "8B",
    pricing: { input: 0.05, output: 0.08 },
    thinking: "disabled",
    maxContext: 128_000,
    providerStatus: "production",
    notes: "Cheapest option anywhere. Too small for judging/creative work. May work for simple extraction.",
  },

  // ── Cerebras (fast inference, prioritize for iteration) ────────────────

  {
    id: "qwen-3-235b-a22b-instruct-2507",
    label: "Qwen3 235B",
    provider: "cerebras",
    params: "235B (22B active)",
    pricing: { input: 0.60, output: 1.20 },
    thinking: "disabled",
    maxContext: 131_000,
    maxOutput: 40_000,
    rateLimit: { requestsPerMin: 500, tokensPerMin: 500_000 },
    providerStatus: "preview",
    notes: "MoE, 22B active. Cerebras serves non-thinking instruct version only. Generous judge (33% discrimination).",
  },
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "cerebras",
    params: "120B",
    pricing: { input: 0.35, output: 0.75 },
    thinking: "optional",
    maxContext: 131_000,
    maxOutput: 40_000,
    rateLimit: { requestsPerMin: 1000, tokensPerMin: 1_000_000 },
    providerStatus: "production",
    notes: "Reasoning via reasoning_effort param (default: medium). May hallucinate tool calls. Also on Groq at lower cost.",
  },
  {
    id: "llama3.1-8b",
    label: "Llama 3.1 8B",
    provider: "cerebras",
    params: "8B",
    pricing: { input: 0.10, output: 0.10 },
    thinking: "disabled",
    maxContext: 32_768,
    maxOutput: 8_000,
    rateLimit: { requestsPerMin: 2000, tokensPerMin: 2_000_000 },
    providerStatus: "production",
    notes: "Highest rate limits on Cerebras. 8k max output, 32k context. Limited for creative work.",
  },
  {
    id: "zai-glm-4.7",
    label: "ZAI-GLM 4.7",
    provider: "cerebras",
    params: "unknown",
    pricing: { input: 2.25, output: 2.75 },
    thinking: "optional",
    maxContext: 131_072,
    maxOutput: 40_000,
    rateLimit: { requestsPerMin: 500, tokensPerMin: 500_000 },
    providerStatus: "preview",
    notes: "Reasoning enabled by default. Strong coding/tool-use. Supports structured outputs. Use clear_thinking param for agentic flows. Expensive.",
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────

  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4-mini",
    provider: "openai",
    params: "unknown",
    pricing: { input: 0.40, output: 1.60 },
    thinking: "disabled",
    maxContext: 400_000,
    maxOutput: 128_000,
    useMaxCompletionTokens: true,
    notes: "33% discrimination in calibration. Inconsistent (max spread 3). Expensive for mediocre signal.",
  },

  // ── DeepSeek ───────────────────────────────────────────────────────────

  {
    id: "deepseek-chat",
    label: "DeepSeek V3.2",
    provider: "deepseek",
    params: "685B MoE",
    pricing: { input: 0.28, output: 0.42 },
    thinking: "disabled",
    maxContext: 128_000,
    maxOutput: 8_000,
    notes: "V3.2 non-thinking. Cache hits drop input to $0.028/M. Default 4k output (max 8k). Supports JSON output + tool calls. Untested.",
  },
  {
    id: "deepseek-reasoner",
    label: "DeepSeek V3.2 Reasoner",
    provider: "deepseek",
    params: "685B MoE",
    pricing: { input: 0.28, output: 0.42 },
    thinking: "enabled",
    maxContext: 128_000,
    maxOutput: 64_000,
    notes: "V3.2 thinking mode. Same pricing as chat. Default 32k output (max 64k). Supports JSON output + tool calls. Untested.",
  },

  // ── OpenRouter (fallback to closed-source labs) ────────────────────────

  {
    id: "google/gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    provider: "openrouter",
    params: "unknown",
    pricing: { input: 0.50, output: 3.00 },
    thinking: "disabled",
    maxContext: 1_000_000,
    maxOutput: 64_000,
    notes: "100% discrimination in calibration. Perfect consistency. Expensive on OpenRouter ($0.50/$3.00).",
  },
  {
    id: "qwen/qwen3-32b",
    label: "Qwen3 32B",
    provider: "openrouter",
    params: "32B",
    pricing: { input: 0.29, output: 0.59 },
    thinking: "optional",
    needsNothink: true,
    notes: "Same model as Groq but slower. Has thinking mode — use /nothink to disable. Use Groq when available.",
  },
  {
    id: "moonshotai/kimi-k2-0905",
    label: "Kimi K2",
    provider: "openrouter",
    params: "1T (32B active) MoE",
    pricing: { input: 1.00, output: 3.00 },
    thinking: "disabled",
    maxContext: 256_000,
    maxOutput: 32_000,
    notes: "67% discrimination in calibration (via Groq proxy). Dialogue scoring inconsistent (max spread 3).",
  },
]

// ── Lookup helpers ───────────────────────────────────────────────────────

export function getModel(id: string, provider?: ProviderName): ModelDef | undefined {
  if (provider) return MODELS.find(m => m.id === id && m.provider === provider)
  return MODELS.find(m => m.id === id)
}

export function getModelsByProvider(provider: ProviderName): ModelDef[] {
  return MODELS.filter(m => m.provider === provider)
}

export function getAvailableModels(): ModelDef[] {
  return MODELS.filter(m => {
    const provider = PROVIDERS[m.provider]
    return !!process.env[provider.envKey]
  })
}

export function getProvider(name: ProviderName): ProviderDef {
  return PROVIDERS[name]
}

export function getApiKey(provider: ProviderName): string {
  const def = PROVIDERS[provider]
  const key = process.env[def.envKey]
  if (!key) throw new Error(`${def.envKey} not set in .env`)
  return key
}

export function getTokenCost(provider: ProviderName, modelId: string, promptTokens: number, completionTokens: number): number {
  const model = getModel(modelId, provider)
  if (!model) return 0
  return (promptTokens * model.pricing.input + completionTokens * model.pricing.output) / 1_000_000
}
