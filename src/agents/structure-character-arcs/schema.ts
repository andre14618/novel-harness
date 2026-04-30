import { z } from "zod"

/**
 * Per-book character-arc schema (Lie / Truth / Want / Need).
 *
 * Anchored to the densest 8-framework convergence in the corpus
 * (Weiland canonical, Truby, Yorke, Harmon, STC, Maass, McKee,
 * Sanderson) — see docs/research/writing-frameworks/SYNTHESIS.md §2.3
 * "Character must have an internal contradiction."
 *
 * Field semantics (Weiland canonical formulation):
 *   - lie    : false belief at the start (about self or world)
 *   - truth  : the corrective belief the character must come to
 *   - want   : conscious goal driven by the lie
 *   - need   : unconscious requirement the truth provides
 *   - arc_resolution: how the arc lands by end of book
 *       fulfilled         — character embraces the truth
 *       partial           — character glimpses but doesn't fully embrace
 *       unresolved        — book ends with the contradiction open (series fiction)
 *       tragic_inversion  — character doubles down on the lie (negative arc)
 *   - evidence_quote_lie  : verbatim quote (substring of input) showing
 *                           the lie operating in the character
 *   - evidence_quote_truth: verbatim quote showing the truth-moment;
 *                           null when arc_resolution = "unresolved"
 *   - confidence: extractor's self-rated reliability ∈ [0,1]
 */

export const ARC_RESOLUTION_ENUM = [
  "fulfilled",
  "partial",
  "unresolved",
  "tragic_inversion",
] as const

export const characterArcSchema = z.object({
  character_name: z.string().min(1),
  lie: z.string().min(1).max(200),
  truth: z.string().min(1).max(200),
  want: z.string().min(1).max(200),
  need: z.string().min(1).max(200),
  arc_resolution: z.enum(ARC_RESOLUTION_ENUM),
  evidence_quote_lie: z.string().min(1),
  evidence_quote_truth: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

export const characterArcsListSchema = z.object({
  arcs: z.array(characterArcSchema),
})

export type CharacterArc = z.infer<typeof characterArcSchema>
export type CharacterArcsList = z.infer<typeof characterArcsListSchema>
