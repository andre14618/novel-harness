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

export type ProviderName = "cerebras" | "groq" | "openrouter" | "openai" | "deepseek" | "minimax" | "zai" | "mimo" | "together"

export interface CacheStrategy {
  /**
   * Provider prefix caching — reference info for cost estimation.
   * No transport-level intervention needed; providers handle caching automatically
   * when consecutive requests share the same prompt prefix.
   *
   * "automatic"  — provider caches repeated prefixes with no code changes or write cost.
   *                (OpenAI GPT-5.4: 90% off >1024 tokens, DeepSeek: 95% off any prefix)
   *
   * "none"       — provider has no caching mechanism.
   */
  type: "automatic" | "none"

  /** Minimum input tokens for caching to activate (provider-specific). */
  minTokens?: number

  /** Discount on cached input tokens (fraction, e.g. 0.90 = 90% off). */
  discount?: number
}

export interface ProviderDef {
  apiUrl: string
  envKey: string              // env var name for the API key
  tier: "fast" | "standard"   // fast = Cerebras/Groq inference hardware
  extraBody?: () => Record<string, any>
  /** Custom auth header name (default: "Authorization" with "Bearer " prefix). */
  authHeader?: string
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
    cache: { type: "automatic", minTokens: 128, discount: 0 },  // caches but no cost savings
  },
  groq: {
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    envKey: "GROQ_API_KEY",
    tier: "fast",
    cache: { type: "automatic", discount: 0.50 },
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
    cache: { type: "none" },  // proxies to underlying providers — caching varies
  },
  openai: {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    envKey: "OPENAI_API_KEY",
    tier: "standard",
    cache: { type: "automatic", minTokens: 1024, discount: 0.90 },  // GPT-5.4: 90% off cached input
    batchApi: { available: true, discount: 0.50, maxWindow: "24h" },
  },
  deepseek: {
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    envKey: "DEEPSEEK_API_KEY",
    tier: "standard",
    cache: { type: "automatic", minTokens: 0, discount: 0.95 },  // any shared prefix, 95% off
    // DeepSeek has no batch API — cost savings come from prefix caching only
  },
  minimax: {
    apiUrl: "https://api.minimax.io/v1/chat/completions",
    envKey: "MINIMAX_API_KEY",
    tier: "standard",
    extraBody: () => ({ reasoning_split: true }),  // puts <think> into separate field, keeps content clean
    cache: { type: "automatic", discount: 0.80 },  // M2.7: $0.06 read vs $0.30 input = 80% off; M2.5: $0.03 vs $0.30 = 90% off (varies by model)
  },
  zai: {
    apiUrl: "https://api.z.ai/api/paas/v4/chat/completions",
    envKey: "ZAI_API_KEY",
    tier: "standard",
    extraBody: () => ({ thinking: { type: "disabled", clear_thinking: true } }),  // disable thinking by default; reasoning goes to separate field anyway
    cache: { type: "automatic", discount: 0.80 },  // ~80% off cached input across models; storage currently free
  },
  mimo: {
    apiUrl: "https://api.xiaomimimo.com/v1/chat/completions",
    envKey: "MIMO_API_KEY",
    tier: "standard",
    authHeader: "api-key",  // MiMo uses "api-key: <key>" instead of "Authorization: Bearer <key>"
    cache: { type: "automatic", discount: 0.80 },  // Pro/Omni ~80% off; Flash ~90% off; cache writing free (limited time)
  },
  together: {
    apiUrl: "https://api.together.xyz/v1/chat/completions",
    envKey: "TOGETHER_API_KEY",
    tier: "standard",
    extraBody: () => ({ chat_template_kwargs: { enable_thinking: false } }),
    cache: { type: "none" },  // LoRA fine-tunes — no prefix caching
  },
}

// ── Model definitions ────────────────────────────────────────────────────

export interface ModelDef {
  id: string                  // model ID sent in API request (or logical ID for fine-tunes)
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
  /** Fine-tune fields — when set, transport sends baseModel as the API model and lora as a separate field. */
  baseModel?: string           // API model ID to send (e.g. "Qwen/Qwen3.5-9B")
  lora?: string                // LoRA adapter ID (e.g. Together AI fine-tunes)
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
    id: "gpt-5.4",
    label: "GPT-5.4",
    provider: "openai",
    params: "unknown",
    pricing: { input: 2.50, output: 15.00 },
    thinking: "optional",
    maxContext: 1_050_000,
    maxOutput: 128_000,
    useMaxCompletionTokens: true,
    notes: "Flagship. reasoning_effort: none (default), low, medium, high, xhigh. 90% cache discount ($0.25/M cached). Long-context 2x/1.5x above 272k input.",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    provider: "openai",
    params: "unknown",
    pricing: { input: 0.75, output: 4.50 },
    thinking: "disabled",
    maxContext: 1_050_000,
    maxOutput: 128_000,
    useMaxCompletionTokens: true,
    notes: "33% discrimination in calibration. Inconsistent (max spread 3). 90% cache discount ($0.075/M cached).",
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    provider: "openai",
    params: "unknown",
    pricing: { input: 0.20, output: 1.25 },
    thinking: "disabled",
    maxContext: 1_050_000,
    maxOutput: 128_000,
    useMaxCompletionTokens: true,
    notes: "Cheapest GPT-5.4 variant. 90% cache discount ($0.02/M cached). Untested in harness.",
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

  // ── MiniMax ────────────────────────────────────────────────────────

  {
    id: "MiniMax-M2.7",
    label: "MiniMax M2.7",
    provider: "minimax",
    params: "unknown",
    pricing: { input: 0.30, output: 1.20 },
    thinking: "enabled",
    maxContext: 204_800,
    notes: "Reasoning always on (slower). ~60 tps. reasoning_split keeps thinking out of content. Cache read $0.06/M (80% off), cache write $0.375/M.",
  },
  {
    id: "MiniMax-M2.7-highspeed",
    label: "MiniMax M2.7 Highspeed",
    provider: "minimax",
    params: "unknown",
    pricing: { input: 0.60, output: 2.40 },
    thinking: "enabled",
    maxContext: 204_800,
    notes: "M2.7 faster variant. Reasoning always on. ~100 tps. 2x price of standard. Cache read $0.06/M, cache write $0.375/M.",
  },
  {
    id: "MiniMax-M2.5",
    label: "MiniMax M2.5",
    provider: "minimax",
    params: "unknown",
    pricing: { input: 0.30, output: 1.20 },
    thinking: "enabled",
    maxContext: 204_800,
    notes: "Reasoning always on. ~60 tps. reasoning_split keeps thinking out of content. Cache read $0.03/M (90% off), cache write $0.375/M.",
  },
  {
    id: "MiniMax-M2.5-highspeed",
    label: "MiniMax M2.5 Highspeed",
    provider: "minimax",
    params: "unknown",
    pricing: { input: 0.60, output: 2.40 },
    thinking: "enabled",
    maxContext: 204_800,
    notes: "M2.5 faster variant. Reasoning always on. ~100 tps. 2x price of standard. Cache read $0.03/M, cache write $0.375/M.",
  },

  // ── Z.AI (ZhipuAI) ─────────────────────────────────────────────────

  {
    id: "GLM-5",
    label: "GLM-5",
    provider: "zai",
    params: "unknown",
    pricing: { input: 1.00, output: 3.20 },
    thinking: "enabled",
    maxOutput: 131_072,
    notes: "Flagship. Thinking forced when enabled. Cached input $0.20/M (80% off).",
  },
  {
    id: "GLM-5-Turbo",
    label: "GLM-5 Turbo",
    provider: "zai",
    params: "unknown",
    pricing: { input: 1.20, output: 4.00 },
    thinking: "enabled",
    maxOutput: 131_072,
    notes: "Turbo variant. Thinking forced when enabled. Cached input $0.24/M (80% off).",
  },
  {
    id: "GLM-5-Code",
    label: "GLM-5 Code",
    provider: "zai",
    params: "unknown",
    pricing: { input: 1.20, output: 5.00 },
    thinking: "enabled",
    maxOutput: 131_072,
    notes: "Code-specialized. Thinking forced when enabled. Cached input $0.30/M (75% off).",
  },
  {
    id: "GLM-4.7",
    label: "GLM-4.7",
    provider: "zai",
    params: "unknown",
    pricing: { input: 0.60, output: 2.20 },
    thinking: "enabled",
    maxOutput: 131_072,
    notes: "Also available on Cerebras. Thinking forced when enabled. Cached input $0.11/M (~82% off).",
  },
  {
    id: "GLM-4.7-FlashX",
    label: "GLM-4.7 FlashX",
    provider: "zai",
    params: "unknown",
    pricing: { input: 0.07, output: 0.40 },
    thinking: "disabled",
    notes: "Very cheap fast model. No thinking support. Cached input $0.01/M (~86% off).",
  },
  {
    id: "GLM-4.6",
    label: "GLM-4.6",
    provider: "zai",
    params: "unknown",
    pricing: { input: 0.60, output: 2.20 },
    thinking: "optional",
    maxOutput: 131_072,
    notes: "Thinking auto-determined when enabled. 128K max output. Cached input $0.11/M (~82% off).",
  },
  {
    id: "GLM-4.5",
    label: "GLM-4.5",
    provider: "zai",
    params: "unknown",
    pricing: { input: 0.60, output: 2.20 },
    thinking: "optional",
    maxOutput: 98_304,
    notes: "Thinking auto-determined when enabled. 96K max output. Cached input $0.11/M (~82% off).",
  },
  {
    id: "GLM-4.5-X",
    label: "GLM-4.5-X",
    provider: "zai",
    params: "unknown",
    pricing: { input: 2.20, output: 8.90 },
    thinking: "optional",
    maxOutput: 98_304,
    notes: "Premium variant. Thinking auto-determined. 96K max output. Cached input $0.45/M (~80% off). Expensive.",
  },
  {
    id: "GLM-4.5-Air",
    label: "GLM-4.5 Air",
    provider: "zai",
    params: "unknown",
    pricing: { input: 0.20, output: 1.10 },
    thinking: "optional",
    maxOutput: 98_304,
    notes: "Cheap mid-tier. Thinking auto-determined. 96K max output. Cached input $0.03/M (85% off).",
  },
  {
    id: "GLM-4.5-AirX",
    label: "GLM-4.5 AirX",
    provider: "zai",
    params: "unknown",
    pricing: { input: 1.10, output: 4.50 },
    thinking: "optional",
    maxOutput: 98_304,
    notes: "Faster Air variant. Thinking auto-determined. 96K max output. Cached input $0.22/M (80% off).",
  },
  {
    id: "GLM-4-32B-0414-128K",
    label: "GLM-4 32B 128K",
    provider: "zai",
    params: "32B",
    pricing: { input: 0.10, output: 0.10 },
    thinking: "disabled",
    maxContext: 128_000,
    maxOutput: 16_384,
    notes: "Open-weight 32B. Very cheap, no caching. 16K max output. Good candidate for extraction/validation.",
  },
  {
    id: "GLM-4.7-Flash",
    label: "GLM-4.7 Flash",
    provider: "zai",
    params: "unknown",
    pricing: { input: 0, output: 0 },
    thinking: "disabled",
    notes: "Free tier. Zero cost.",
  },
  {
    id: "GLM-4.5-Flash",
    label: "GLM-4.5 Flash",
    provider: "zai",
    params: "unknown",
    pricing: { input: 0, output: 0 },
    thinking: "optional",
    maxOutput: 98_304,
    notes: "Free tier. Zero cost. Thinking auto-determined. 96K max output.",
  },

  // ── Xiaomi MiMo ────────────────────────────────────────────────────────

  {
    id: "mimo-v2-pro",
    label: "MiMo V2 Pro",
    provider: "mimo",
    params: "unknown",
    pricing: { input: 1.00, output: 3.00 },
    thinking: "optional",
    maxContext: 1_000_000,
    maxOutput: 128_000,
    useMaxCompletionTokens: true,
    rateLimit: { requestsPerMin: 100, tokensPerMin: 10_000_000 },
    notes: "Flagship. Deep thinking + function call + JSON output. >256K context: $2.00/$6.00. Cached input $0.20/M (80% off).",
  },
  {
    id: "mimo-v2-omni",
    label: "MiMo V2 Omni",
    provider: "mimo",
    params: "unknown",
    pricing: { input: 0.40, output: 2.00 },
    thinking: "optional",
    maxContext: 256_000,
    maxOutput: 128_000,
    useMaxCompletionTokens: true,
    rateLimit: { requestsPerMin: 100, tokensPerMin: 10_000_000 },
    notes: "Multimodal understanding + deep thinking. Cached input $0.08/M (80% off).",
  },
  {
    id: "mimo-v2-flash",
    label: "MiMo V2 Flash",
    provider: "mimo",
    params: "unknown",
    pricing: { input: 0.10, output: 0.30 },
    thinking: "optional",
    maxContext: 256_000,
    maxOutput: 64_000,
    useMaxCompletionTokens: true,
    rateLimit: { requestsPerMin: 100, tokensPerMin: 10_000_000 },
    notes: "Cheapest MiMo. Deep thinking + function call + JSON output. Cached input $0.01/M (90% off).",
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

  // ── Together AI (LoRA fine-tunes) ───────────────────────────────────

  {
    id: "qwen3.5-9b-howard-tonal-v1",
    label: "Qwen 3.5 9B — Howard Tonal v1",
    provider: "together",
    params: "9B",
    pricing: { input: 0.10, output: 0.15 },
    thinking: "disabled",
    maxContext: 32_000,
    maxOutput: 2_048,
    baseModel: "Qwen/Qwen3.5-9B",
    lora: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v1-582d484b",
    notes: "LoRA fine-tune for tonal pass. Back-translated Howard style. Served serverless via Together AI.",
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

/**
 * Returns models that have API keys configured.
 * For hidden-model filtering, use the async variant or check hidden.ts directly.
 */
export function getAvailableModels(): ModelDef[] {
  return MODELS.filter(m => {
    const provider = PROVIDERS[m.provider]
    return !!process.env[provider.envKey]
  })
}

/**
 * Like getAvailableModels() but also filters out hidden models.
 * Use this in contexts where hidden models should be excluded.
 */
export async function getVisibleModels(): Promise<ModelDef[]> {
  const { isModelHidden } = await import("./hidden")
  return MODELS.filter(m => {
    const provider = PROVIDERS[m.provider]
    if (!process.env[provider.envKey]) return false
    if (isModelHidden(m.provider, m.id)) return false
    return true
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
