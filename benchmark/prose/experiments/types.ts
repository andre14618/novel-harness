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
  variants?: Variant[]           // explicit variants
  runsPerSeed?: number          // default 2
  seedFilter?: string[]         // run only these seeds (by name); empty = all
  matrix?: {                    // auto-generate variants from cartesian product
    models?: Array<{ id: string; provider: string; label: string }>
    prompts?: Array<{ label: string; systemPrompt: string }>
    temperatures?: number[]
  }
}

export interface VariantScore {
  variant: string
  seed: string
  run: number
  dim: Dimension
  count: number
  wordCount: number
}
