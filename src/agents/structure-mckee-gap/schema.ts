import { z } from "zod"

/**
 * Per-beat McKee Gap schema (R6 §1, §2 + SYNTHESIS.md §1, §2.5).
 *
 * Anchored to Robert McKee's Story (1997) Ch. 6 "The Gap" — the
 * difference between what the POV character EXPECTED to happen on
 * this beat and what the world ACTUALLY delivered. Per SYNTHESIS.md
 * §1 exec summary the Gap is named as the cheap-LLM-detectable
 * complement to value-charge: a beat with no gap = "no beat" in
 * McKee's terms.
 *
 * Field semantics (R6 §1, §2.5, mckee-story.md §4.1 + §6.1):
 *   - povExpectation : 1-sentence expectation of POV at beat ENTRY,
 *                      reconstructed from the prior-beat lead-in
 *                      and what the POV is about to do
 *   - actualOutcome  : 1-sentence what actually HAPPENS by beat exit
 *   - gap_size       : magnitude of divergence between the two
 *                      (`none | small | medium | large`)
 *   - gap_type       : categorical signal of HOW the outcome
 *                      diverged (`none | reversal | escalation |
 *                      revelation | undermining | other`)
 *   - confidence     : extractor's self-rated reliability ∈ [0,1]
 *   - evidence_quote : verbatim source-text justifying the tag
 *                      (must appear as a substring of the input
 *                      beat prose)
 *   - abstain_reason : non-null when the beat is purely transitional
 *                      / connective and no defensible expectation
 *                      could be reconstructed
 *
 * Hard rules (enforced both at prompt level and via downstream
 * audit; the schema enforces shape, not the size↔type joint):
 *   - gap_size = "none" REQUIRES gap_type = "none"
 *   - gap_size != "none" REQUIRES gap_type != "none"
 *   - evidence_quote must be a substring of the input beat prose
 */

export const GAP_SIZE_ENUM = ["none", "small", "medium", "large"] as const

export const GAP_TYPE_ENUM = [
  "none",
  "reversal",
  "escalation",
  "revelation",
  "undermining",
  "other",
] as const

export const mckeeGapSchema = z.object({
  povExpectation: z.string().min(1).max(200),
  actualOutcome: z.string().min(1).max(200),
  gap_size: z.enum(GAP_SIZE_ENUM),
  gap_type: z.enum(GAP_TYPE_ENUM),
  confidence: z.number().min(0).max(1),
  evidence_quote: z.string().min(1),
  abstain_reason: z.string().nullable(),
})

export type McKeeGapOutput = z.infer<typeof mckeeGapSchema>
