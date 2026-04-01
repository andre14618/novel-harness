import type { Dimension } from "../judges/schema"

export interface Variant {
  label: string
  systemPrompt: string
  contextModifier?: (seedPrompt: string) => string
  temperature?: number          // default 0.8
  model?: { id: string; provider: string }
}

export interface ExperimentBatch {
  name: string
  description: string
  variants: Variant[]
  runsPerSeed?: number          // default 2
  seedFilter?: string[]         // run only these seeds (by name); empty = all
}

export interface VariantScore {
  variant: string
  seed: string
  run: number
  dim: Dimension
  count: number
}
