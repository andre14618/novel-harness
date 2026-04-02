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

export interface CacheStrategy {
  /**
   * How this provider handles prompt/prefix caching.
   *
   * "automatic"  — provider caches repeated prefixes with no code changes.
   *                Sequential same-prefix calls maximize hits.
   *                (DeepSeek: 95% input discount, OpenAI: 50% input >1024 tokens)
   *
   * "explicit"   — provider requires cache_control markers in the message body.
   *                Transport must transform the request before sending.
   *                (Anthropic: 90% input discount on cached blocks)
   *
   * "none"       — provider has no caching mechanism.
   */
  type: "automatic" | "explicit" | "none"

  /** Sequential same-prefix calls improve cache hit rate. */
  benefitsFromSequential: boolean

  /** Minimum input tokens for caching to activate (provider-specific). */
  minTokens?: number

  /** Input token discount when cached (fraction, e.g. 0.95 = 95% off). */
  discount?: number

  /**
   * Transform request for explicit caching (e.g., add cache_control blocks).
   * Only called when type is "explicit".
   */
  transformRequest?: (messages: Array<{ role: string; content: any }>) => Array<{ role: string; content: any }>
}

export interface ProviderDef {
  apiUrl: string
  envKey: string              // env var name for the API key
  tier: "fast" | "standard"   // fast = Cerebras/Groq inference hardware
  extraBody?: () => Record<string, any>
  cache?: CacheStrategy
  /** Provider offers an async batch API (JSONL upload, collect later). */
  batchApi?: {
    available: boolean
    discount: number          // fraction off, e.g. 0.50 = 50% off
    maxWindow?: string        // max completion window, e.g. "24h", "7d"
  }
}

export const PROVIDERS: Record<ProviderName, ProviderDef> = {
  cerebras: {
    apiUrl: "https://api.cerebras.ai/v1/chat/completions",
    envKey: "CEREBRAS_API_KEY",
    tier: "fast",
    cache: {
      type: "automatic",
      benefitsFromSequential: true,
      minTokens: 128,  // 128-token blocks, matches segments in ephemeral memory
      discount: 0,     // Cerebras caches but does not discount — no cost savings
    },
  },
  groq: {
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    envKey: "GROQ_API_KEY",
    tier: "fast",
    cache: {
      type: "automatic",
      benefitsFromSequential: false,  // matches recent requests, not strictly sequential
      discount: 0.50,
    },
    batchApi: { available: true, discount: 0.50, maxWindow: "7d" },
  },
  openrouter: {
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    envKey: "OPENROUTER_API_KEY",
    tier: "standard",
    extraBody: () => {
      const provider = process.env.PROVIDER
      return provider ? { provider: { order: [provider], allow_fallbacks: false } } : {}
    },
    // OpenRouter proxies to underlying providers — caching depends on which
    // provider is selected. Conservative: treat as none.
    cache: { type: "none", benefitsFromSequential: false },
  },
  openai: {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    envKey: "OPENAI_API_KEY",
    tier: "standard",
    cache: {
      type: "automatic",
      benefitsFromSequential: true,
      minTokens: 1024,   // 1024-token minimum, 128-token block increments
      discount: 0.50,    // GPT-4o/o-series: 50%, GPT-4.1: 75%, GPT-5: 90%
    },
    batchApi: { available: true, discount: 0.50, maxWindow: "24h" },
  },
  deepseek: {
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    envKey: "DEEPSEEK_API_KEY",
    tier: "standard",
    cache: {
      type: "automatic",
      benefitsFromSequential: true,
      minTokens: 0,   // no minimum — any shared prefix is cached
      discount: 0.95,  // $0.014/M vs $0.28/M
    },
    // DeepSeek has no batch API — cost savings come from prefix caching only
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
    id: "openai/gpt-oss-20b",
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
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "groq",
    params: "120B",
    pricing: { input: 0.15, output: 0.60 },
    thinking: "disabled",
    maxContext: 128_000,
    providerStatus: "production",
    notes: "Same model as Cerebras gpt-oss-120b but cheaper on Groq.",
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
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
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    provider: "groq",
    params: "70B",
    pricing: { input: 0.59, output: 0.79 },
    thinking: "disabled",
    observedTps: 150,
    maxContext: 128_000,
    providerStatus: "production",
    notes: "33% judge discrimination (MID=STRONG on show-tell/dialogue). Perfect consistency. 150 tok/s. Generous scorer.",
  },
  {
    id: "moonshotai/kimi-k2-instruct-0905",
    label: "Kimi K2",
    provider: "groq",
    params: "1T (32B active) MoE",
    pricing: { input: 1.00, output: 3.00 },
    thinking: "disabled",
    maxContext: 131_000,
    maxOutput: 32_000,
    providerStatus: "preview",
    notes: "Rank 7 on lechmazur creative writing (8.33). Prompt caching available ($0.50 cached input). Batch API = 50% off ($0.50/$1.50). 67% judge discrimination in calibration.",
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
    observedTps: 551,
    maxContext: 131_000,
    maxOutput: 40_000,
    rateLimit: { requestsPerMin: 1000, tokensPerMin: 1_000_000 },
    providerStatus: "production",
    notes: "0% judge discrimination (MID=STRONG). 551 tok/s observed. Reasoning via reasoning_effort param. May hallucinate tool calls.",
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
    notes: "100% discrimination in calibration. Perfect consistency. Expensive on OpenRouter ($0.50/$3.00). Currently 404 on OR (2026-04-01).",
  },
  {
    id: "google/gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash Lite",
    provider: "openrouter",
    params: "unknown",
    pricing: { input: 0.25, output: 1.50 },
    thinking: "disabled",
    maxContext: 1_000_000,
    maxOutput: 65_536,
    notes: "Extremely cheap. Untested as judge.",
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
    pricing: { input: 0.40, output: 2.00 },
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
