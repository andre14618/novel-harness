/**
 * Groq Batch API adapter.
 * 50% discount, same OpenAI-compatible protocol, up to 7d turnaround.
 */

import { OpenAICompatibleBatchProvider } from "./openai-compatible"

export class GroqBatchProvider extends OpenAICompatibleBatchProvider {
  constructor() {
    const key = process.env.GROQ_API_KEY
    if (!key) throw new Error("GROQ_API_KEY not set")
    super("groq", "https://api.groq.com/openai/v1", () => key)
  }
}
