import { z } from "zod"

/**
 * Per-novel PromiseRegistry schema — R6 §2 + §3.
 *
 * Promises are extracted in TWO passes:
 *   1. Open-pass    — identify promises and their opening chapter
 *   2. Closure-pass — for each promise, identify whether/when it pays off
 *
 * R6 unifies the chapter representation on (label + index) end-to-end:
 *   - *_label is the raw source label (e.g. "10", "prelude", "epilogue")
 *   - *_index is the canonical integer ordering (e.g. 10, -1, 1000)
 * Matching policy in §2 joins on *_index for the chapter-window check;
 * raw labels are preserved for source-fidelity (prelude is structurally
 * distinct from chapter 1 even if both are "early in the novel").
 */

export const PAYOFF_QUALITY_ENUM = [
  "satisfied",
  "partially_satisfied",
  "unsatisfied",
  "unclear",
] as const

/** First-pass output — promises with opening info ONLY.
 *  hint arrays are optional in the model output (LLMs sometimes omit
 *  them when there are no hints); index.ts normalizes them to [] before
 *  emitting the merged FullPromise rows. */
export const openPromiseSchema = z.object({
  promise_id: z.string().min(1),
  promise_text: z.string().min(1).max(200),
  opened_chapter_label: z.string().min(1),
  opened_chapter_index: z.number().int(),
  hint_chapter_labels: z.array(z.string()).optional(),
  hint_chapter_indices: z.array(z.number().int()).optional(),
  evidence_quote_open: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export const openPromiseListSchema = z.object({
  promises: z.array(openPromiseSchema),
})

/** Second-pass per-promise closure decision. */
export const closurePromiseSchema = z.object({
  promise_id: z.string().min(1),
  closed_chapter_label: z.string().nullable(),
  closed_chapter_index: z.number().int().nullable(),
  payoff_quality: z.enum(PAYOFF_QUALITY_ENUM),
  evidence_quote_close: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

export const closurePromiseListSchema = z.object({
  closures: z.array(closurePromiseSchema),
})

/** Final per-promise row — open-pass merged with closure-pass. */
export const fullPromiseSchema = z.object({
  promise_id: z.string(),
  promise_text: z.string(),
  opened_chapter_label: z.string(),
  opened_chapter_index: z.number().int(),
  closed_chapter_label: z.string().nullable(),
  closed_chapter_index: z.number().int().nullable(),
  hint_chapter_labels: z.array(z.string()),
  hint_chapter_indices: z.array(z.number().int()),
  payoff_quality: z.enum(PAYOFF_QUALITY_ENUM),
  evidence_quote_open: z.string(),
  evidence_quote_close: z.string().nullable(),
  confidence: z.number().min(0).max(1),
})

export type OpenPromise = z.infer<typeof openPromiseSchema>
export type ClosurePromise = z.infer<typeof closurePromiseSchema>
export type FullPromise = z.infer<typeof fullPromiseSchema>
