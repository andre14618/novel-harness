/**
 * OpenAI Batch API adapter.
 * 50% discount on input and output tokens, up to 24h turnaround.
 */

import { OpenAICompatibleBatchProvider } from "./openai-compatible"

export class OpenAIBatchProvider extends OpenAICompatibleBatchProvider {
  constructor() {
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new Error("OPENAI_API_KEY not set")
    super("openai", "https://api.openai.com/v1", () => key)
  }
}
