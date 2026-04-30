import { z } from "zod"

/**
 * Per-scene MICE-thread schema.
 *
 * Anchored to Sanderson's MICE quotient (Card → Sanderson, BYU 318R 2020):
 * every story thread is one of four types — Milieu, Idea/Inquiry, Character,
 * Event — and threads nest LIFO so that "every open closes" forms a balanced
 * parens sequence (docs/research/writing-frameworks/SYNTHESIS.md §1, §3 / §6
 * "MICE Quotient as a Programmatic Structure"; sanderson-lectures.md §3.1).
 *
 * R6's value-charge is per-scene; MICE is also tagged per-scene so that a
 * downstream stack-walk validator can treat each scene as a single open /
 * progress / close event in narrative order (planning emits MICE at chapter
 * granularity in the harness; corpus extraction works at scene granularity
 * because that's the unit available in pairs.jsonl).
 *
 * Field semantics:
 *   - primary_thread   : DOMINANT MICE type the scene is on (single letter)
 *   - secondary_thread : ONLY non-null when a clear second thread is woven
 *                         through (e.g. an event-character compound). Most
 *                         scenes are pure single-thread; secondary should
 *                         only fire when both threads carry weight in the
 *                         scene, not when a second thread is incidentally
 *                         touched.
 *   - opens_thread     : true if this scene OPENS a (new) thread. A scene
 *                         can both open and close (self-contained chapter).
 *   - closes_thread    : true if this scene CLOSES a previously-opened thread.
 *   - thread_descriptor: ≤200 chars, names the SPECIFIC thread (which place,
 *                         which question, which role-shift, which event).
 *                         Generic descriptors ("fight scene", "travel chapter")
 *                         are wrong by definition.
 *   - confidence       : extractor's self-rated reliability ∈ [0,1]
 *   - evidence_quote   : verbatim source-text snippet justifying the tag
 *   - abstain_reason   : non-null when extractor cannot confidently tag (e.g.
 *                         a montage / connective scene where no one thread
 *                         dominates)
 */
export const MICE_THREAD_ENUM = ["M", "I", "C", "E"] as const

export const miceSchema = z.object({
  primary_thread: z.enum(MICE_THREAD_ENUM),
  secondary_thread: z.enum(MICE_THREAD_ENUM).nullable(),
  opens_thread: z.boolean(),
  closes_thread: z.boolean(),
  thread_descriptor: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
  evidence_quote: z.string().min(1),
  abstain_reason: z.string().nullable(),
})

export type MiceOutput = z.infer<typeof miceSchema>
