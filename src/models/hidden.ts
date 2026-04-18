/**
 * Hidden models — models excluded from all selection dropdowns.
 *
 * Persisted to state/hidden-models.json at the repo root (gitignored).
 * Previously wrote to src/data/hidden-models.json, which put mutable
 * runtime state under src/ and drifted the working tree on every toggle.
 * Keyed by "provider:modelId" since the same model ID can appear on
 * multiple providers.
 */

import { resolve, dirname } from "node:path"
import { mkdirSync } from "node:fs"

const STATE_DIR = resolve(dirname(new URL(import.meta.url).pathname), "../../state")
const HIDDEN_FILE = resolve(STATE_DIR, "hidden-models.json")

let hiddenModels = new Set<string>()

function makeKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`
}

export async function loadHiddenModels(): Promise<void> {
  try {
    const file = Bun.file(HIDDEN_FILE)
    if (await file.exists()) {
      const data = await file.json() as { hidden: string[] }
      hiddenModels = new Set(data.hidden)
    }
  } catch {
    // File doesn't exist yet — fine
  }
}

async function save(): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true })
  await Bun.write(
    HIDDEN_FILE,
    JSON.stringify({ hidden: [...hiddenModels].sort() }, null, 2) + "\n",
  )
}

export async function setModelHidden(provider: string, modelId: string, hidden: boolean): Promise<void> {
  const key = makeKey(provider, modelId)
  if (hidden) hiddenModels.add(key)
  else hiddenModels.delete(key)
  await save()
}

export function isModelHidden(provider: string, modelId: string): boolean {
  return hiddenModels.has(makeKey(provider, modelId))
}

export function getHiddenModels(): string[] {
  return [...hiddenModels].sort()
}

// Load on import
await loadHiddenModels()
