// Per-million token pricing by provider + model
// Update these when pricing changes

export interface ModelPricing {
  input: number   // $ per million input tokens
  output: number  // $ per million output tokens
}

export const PRICING: Record<string, Record<string, ModelPricing>> = {
  cerebras: {
    "qwen-3-235b-a22b-instruct-2507": { input: 0.60, output: 1.20 },
    "gpt-oss-120b": { input: 0.35, output: 0.75 },
    "llama3.1-8b": { input: 0.10, output: 0.10 },
  },
  groq: {
    "qwen/qwen3-32b": { input: 0.29, output: 0.59 },
    "meta-llama/llama-3.3-70b-instruct": { input: 0.59, output: 0.79 },
    "moonshotai/kimi-k2-instruct": { input: 1.00, output: 3.00 },
  },
  openrouter: {
    "qwen/qwen3-32b": { input: 0.29, output: 0.59 },
    "google/gemini-3-flash-preview": { input: 0.15, output: 0.60 },
  },
}

export function getTokenCost(provider: string, model: string, promptTokens: number, completionTokens: number): number {
  const pricing = PRICING[provider]?.[model]
  if (!pricing) return 0
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000
}
