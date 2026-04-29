import { z } from "zod"

/**
 * Per-scene value-charge schema (R6 §1, §2).
 *
 * Anchored to the Coyne / McKee / Yorke / Truby / Swain convergence
 * documented in docs/research/writing-frameworks/SYNTHESIS.md §2:
 * every scene tracks a "life value" that flips between in→out across
 * the scene boundary. Polarity captures the direction of the flip.
 *
 * Field semantics (R6 §1):
 *   - valueIn  : value-charge state at scene START
 *   - valueOut : value-charge state at scene END
 *   - lifeValue: which thematic axis the scene moves on (closed enum)
 *   - polarity : direction of in→out shift (+ rising, − falling, 0 flat)
 *   - confidence: extractor's self-rated reliability ∈ [0,1]
 *   - evidence_quote: verbatim source-text justifying the tag
 *   - abstain_reason: non-null when extractor cannot tag (e.g.
 *                     transitional/montage scene where no value moves)
 */
export const VALUE_CHARGE_ENUM = ["+", "-", "0"] as const

export const LIFE_VALUE_ENUM = [
  "life-death",
  "freedom-slavery",
  "justice-injustice",
  "love-hate",
  "truth-lie",
  "power-weakness",
  "hope-despair",
  "success-failure",
  "belief-doubt",
  "identity-unknown",
  "other",
] as const

export const valueChargeSchema = z.object({
  valueIn: z.enum(VALUE_CHARGE_ENUM),
  valueOut: z.enum(VALUE_CHARGE_ENUM),
  lifeValue: z.enum(LIFE_VALUE_ENUM),
  polarity: z.enum(VALUE_CHARGE_ENUM),
  confidence: z.number().min(0).max(1),
  evidence_quote: z.string().min(1),
  abstain_reason: z.string().nullable(),
})

export type ValueChargeOutput = z.infer<typeof valueChargeSchema>
