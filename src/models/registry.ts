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

export type ProviderName = "cerebras" | "groq" | "openrouter" | "openai" | "deepseek" | "minimax" | "zai" | "mimo" | "together" | "fireworks" | "wandb"

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
  fireworks: {
    apiUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
    envKey: "FIREWORKS_API_KEY",
    tier: "standard",  // FireAttention on H100s — much faster than Together standard tier per benchmarks, but not LPU/WSE-class
    // No provider-wide extraBody. Fireworks REJECTS chat_template_kwargs entirely
    // ("Extra inputs are not permitted") so the Together-style kwarg breaks every call.
    // Thinking control is per-model: gpt-oss uses reasoning_effort, Qwen uses /nothink
    // prefix via needsNothink, the explicit Instruct/Thinking variants need nothing.
    cache: { type: "none" },  // verify on Fireworks pricing page; conservative default
    // NOTE: Fireworks only supports custom LoRAs via dedicated GPU rental
    // (~$2-5/hr per H100), not the serverless pay-per-token tier. For
    // solo-developer volume that's economically wrong. Use W&B Inference
    // for fine-tune serving instead. See docs/lessons-learned.md.
  },
  wandb: {
    apiUrl: "https://api.inference.wandb.ai/v1/chat/completions",
    envKey: "WANDB_API_KEY",
    tier: "standard",  // CoreWeave-backed. The chosen home for fine-tune serving.
    // Pay-per-token at base-model rates with no LoRA surcharge. Standard
    // OpenAI-compatible auth (Authorization: Bearer). The OpenPipe/Qwen3-14B
    // base is W&B's preferred fine-tune base post the CoreWeave/OpenPipe
    // acquisition (Sept 2025) and proved viable in tuning_experiment id=94.
    cache: { type: "none" },
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
  /** Reasoning-effort param for OpenAI-style reasoning models (gpt-oss, gpt-5.4 family).
   *  When set, transport sends `reasoning_effort: <value>` in the request body. */
  reasoningEffort?: "low" | "medium" | "high"
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
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    params: "unknown",
    pricing: { input: 0.14, output: 0.28 },
    thinking: "optional",
    maxContext: 128_000,
    maxOutput: 64_000,
    notes: "V4 Flash. Thinking mode toggled via `thinking: {type:'enabled'}` request param (plumbed via roles.ts:thinking flag). Same pricing in both modes. Cache hit input drops to $0.0028/M (98% off). Default for production roles; thinking enabled for chapter-plan-checker, chapter-plan-reviser, and planning-beats only.",
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    params: "unknown",
    // Base pricing per https://api-docs.deepseek.com/quick_start/pricing.
    // Currently 75% discounted until 2026-05-31 15:59 UTC: input $0.435 / output $0.87.
    // Cache hit drops input to $0.0145/M (75%-off: $0.003625/M).
    pricing: { input: 1.74, output: 3.48 },
    thinking: "enabled",
    maxContext: 128_000,
    maxOutput: 64_000,
    notes: "V4 Pro. Reasoning-tier; thinking default-on. ~12x output cost of Flash at base rate ($3.48 vs $0.28/M); ~3x at the current 75%-off promo. NOT routed in roles.ts — Flash with thinking flag covers reasoning agents at lower cost. Reserved as a manual escalation for tasks where Flash thinking proves insufficient.",
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

  // ── Fireworks AI (fast custom-LoRA hosting on H100s) ────────────────
  // Model IDs use the format "accounts/fireworks/models/<slug>". Verify exact slugs
  // against the Fireworks catalog page after setting FIREWORKS_API_KEY — these are
  // the best guesses from the public catalog (2026-04-07) and may need adjustment.
  // Pricing matches what Fireworks publishes; not yet measured for latency in-harness.

  {
    id: "accounts/fireworks/models/qwen3-vl-30b-a3b-instruct",
    label: "Qwen3 VL 30B A3B Instruct (Fireworks)",
    provider: "fireworks",
    params: "30B (3B active) MoE",
    pricing: { input: 0.15, output: 0.60 },
    thinking: "disabled",
    maxContext: 262_000,
    notes: "MoE 30B/3B-active. Vision-language but works fine for text-only. Strong candidate for extractor tier (replacing mimo-v2-flash) and fact/character-state agents — same family as the eventual fine-tunes, tunable on Fireworks. Untested for latency in harness.",
  },
  {
    id: "accounts/fireworks/models/qwen3-vl-30b-a3b-thinking",
    label: "Qwen3 VL 30B A3B Thinking (Fireworks)",
    provider: "fireworks",
    params: "30B (3B active) MoE",
    pricing: { input: 0.15, output: 0.60 },
    thinking: "enabled",
    maxContext: 262_000,
    notes: "Thinking variant. Candidate for chapter-plan-checker A/B vs gpt-oss-120b — analytical tasks benefit from explicit reasoning. Set generous max_tokens (3-10x output of non-thinking).",
  },
  {
    id: "accounts/fireworks/models/qwen3-8b",
    label: "Qwen3 8B (Fireworks)",
    provider: "fireworks",
    params: "8B",
    pricing: { input: 0.20, output: 0.20 },
    thinking: "optional",
    maxContext: 40_000,
    needsNothink: true,
    notes: "Small dense Qwen3. Candidate for reference-resolver / adherence-checker fine-tune base on Fireworks — same family as the rest of the Qwen fine-tune story, tunable + fast hosting in one place. Replaces the failed Together Qwen 9B experiment from this session.",
  },
  {
    id: "accounts/fireworks/models/gpt-oss-120b",
    label: "GPT-OSS 120B (Fireworks)",
    provider: "fireworks",
    params: "120B MoE",
    pricing: { input: 0.15, output: 0.60 },
    thinking: "optional",
    reasoningEffort: "low",  // Fireworks gpt-oss reasons by default; "low" keeps reasoning_content short. Increase for analytical slots that benefit from explicit reasoning.
    maxContext: 131_000,
    notes: "Same model as the Groq gpt-oss-120b that's currently serving chapter-plan-checker. Same price. Difference is Fireworks supports fine-tuning, so once we accumulate plan-check training data we can train a LoRA against this base in-place. A/B latency vs Groq before any swap.",
  },
  {
    id: "accounts/fireworks/models/gpt-oss-20b",
    label: "GPT-OSS 20B (Fireworks)",
    provider: "fireworks",
    params: "20B",
    pricing: { input: 0.07, output: 0.30 },
    thinking: "optional",
    reasoningEffort: "low",
    maxContext: 131_000,
    notes: "Cheapest analytical-tier candidate. Tunable. Worth A/B testing as a chapter-plan-checker once the persistence + training-data pipeline exists — if 20B is good enough fine-tuned, it's the cost floor.",
  },

  // ── W&B Inference (CoreWeave-backed serverless LoRA hosting) ────────
  // Chosen as the default home for fine-tuned analytical agents per the
  // 2026-04-07 latency probe (tuning_experiment id=94). Pay-per-token, no
  // LoRA surcharge, standard OpenAI-compatible API. The OpenPipe/Qwen3-14B
  // base is W&B's preferred fine-tune base — this is where the multi-task
  // adherence/reference/plan-check LoRA will live.

  {
    id: "OpenPipe/Qwen3-14B-Instruct",
    label: "Qwen3 14B Instruct (OpenPipe)",
    provider: "wandb",
    params: "14B",
    pricing: { input: 0.05, output: 0.22 },
    thinking: "disabled",
    maxContext: 33_000,
    notes: "Cheapest serverless tier on W&B. Designed by OpenPipe (acquired by CoreWeave Sept 2025) as a finetune-friendly fork of Qwen3-14B with non-thinking-default chat template — no /nothink prefix needed. Probe (exp #94) showed 1.3x baseline on beat-writer shape, FASTER than Cerebras 235B on adherence-checker (157ms vs 365ms). Chosen as the multi-task analytical LoRA base. NOTE: LoRA adapters served here are billed at these same rates ($0.05/$0.22 per 1M) — NOT free. The wandb-artifact:/// URI used for LoRA calls does not match this id, so getTokenCost() requires a special-case fallback (see below) to avoid logging $0.",
  },
  {
    id: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    label: "Qwen3 30B A3B Instruct 2507 (W&B)",
    provider: "wandb",
    params: "30B (3B active) MoE",
    pricing: { input: 0.10, output: 0.30 },
    thinking: "disabled",
    maxContext: 256_000,
    notes: "Was the leading candidate before the probe — killed by latency (10.7x baseline on writer shape, 33s p95 outlier on adherence-checker). W&B serving doesn't seem to keep this model warm. Available in the registry for future re-evaluation if cold-start improves; not currently assigned to any agent.",
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (W&B)",
    provider: "wandb",
    params: "120B MoE",
    pricing: { input: 0.15, output: 0.60 },
    thinking: "disabled",
    maxContext: 131_000,
    notes: "Same model as the existing chapter-plan-checker on Groq. Marginal on the W&B latency probe (4.8x baseline) but available as a fallback for chapter-plan-checker specifically if the 14B LoRA can't match its analytical depth. Tunable on W&B unlike the Groq instance.",
  },
  {
    id: "meta-llama/Llama-3.1-8B-Instruct",
    label: "Llama 3.1 8B Instruct (W&B)",
    provider: "wandb",
    params: "8B",
    pricing: { input: 0.22, output: 0.22 },
    thinking: "disabled",
    maxContext: 131_000,
    notes: "On W&B's supported list. Worse than OpenPipe/Qwen3-14B in every dimension (smaller AND more expensive AND no fine-tune-friendly chat template). Listed for completeness only — no agent currently routes to this.",
  },

  // ── Together AI (base models + LoRA fine-tunes) ─────────────────────

  {
    id: "Qwen/Qwen3.5-9B",
    label: "Qwen 3.5 9B (base)",
    provider: "together",
    params: "9B",
    pricing: { input: 0.10, output: 0.15 },
    thinking: "disabled",
    maxContext: 32_000,
    maxOutput: 8_000,
    notes: "Base Qwen 3.5 9B served via Together AI serverless. Retained as a cheap stock-model option; no active runtime agent routes here.",
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

export function getTokenCost(
  provider: ProviderName,
  modelId: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens: number = 0,
): number {
  const resolveModel = () => {
    const m = getModel(modelId, provider)
    if (m) return m
    // W&B LoRA artifact URIs (wandb-artifact:///...) don't match any id in MODELS,
    // but they are served on OpenPipe/Qwen3-14B-Instruct at standard Qwen3-14B rates
    // with no LoRA surcharge. Fall back to that base model's pricing so llm_calls
    // records real cost instead of $0.
    if (provider === "wandb" && modelId.startsWith("wandb-artifact:///")) {
      return getModel("OpenPipe/Qwen3-14B-Instruct", "wandb")
    }
    return null
  }
  const model = resolveModel()
  if (!model) return 0

  // cached_tokens is a SUBSET of prompt_tokens. Bill the miss portion at the
  // full input rate and the cached portion at the discounted rate. Only apply
  // cached-rate math when the provider advertises automatic caching AND the
  // caller observed a non-zero cachedTokens; otherwise fall back to the plain
  // input rate so providers with cache.type === "none" don't produce NaN.
  const cache = PROVIDERS[provider]?.cache
  const cacheActive = cache?.type === "automatic" && cachedTokens > 0
  const discount = cacheActive ? (cache.discount ?? 0) : 0
  const cachedRate = model.pricing.input * (1 - discount)
  const cached = cacheActive ? Math.min(cachedTokens, promptTokens) : 0
  const miss = promptTokens - cached

  return (miss * model.pricing.input + cached * cachedRate + completionTokens * model.pricing.output) / 1_000_000
}
