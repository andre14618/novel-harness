/**
 * Batch provider registry.
 *
 * Maps provider names to their batch adapter implementations.
 * Add new providers here as they become available.
 */

import type { BatchProvider } from "./types"
import { OpenAIBatchProvider } from "./openai"

const providers: Record<string, () => BatchProvider> = {
  openai: () => new OpenAIBatchProvider(),
}

export function getBatchProvider(name: string): BatchProvider {
  const factory = providers[name]
  if (!factory) {
    throw new Error(`No batch provider for '${name}'. Available: ${Object.keys(providers).join(", ")}`)
  }
  return factory()
}

export function listBatchProviders(): string[] {
  return Object.keys(providers)
}
