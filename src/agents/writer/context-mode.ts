export const WRITER_CONTEXT_MODES = ["legacy", "thread-character-context-v1"] as const

export type WriterContextMode = typeof WRITER_CONTEXT_MODES[number]

export const DEFAULT_WRITER_CONTEXT_MODE: WriterContextMode = "thread-character-context-v1"

export function isWriterContextMode(value: unknown): value is WriterContextMode {
  return typeof value === "string" && WRITER_CONTEXT_MODES.includes(value as WriterContextMode)
}

/**
 * adjusted-B1: writer-prompt ID rendering ablation lever.
 *
 * - "raw" (default): emit raw machine IDs in Cluster-1 prose-writer
 *   render sites — Chapter ID, Beat ID, POV character ID, Active
 *   thread/promise/payoff refs, Missing character IDs, per-card
 *   `[characterId]` brackets, and per-card Source obligations / Active
 *   threads/promises/payoffs lines. Production default; preserves
 *   byte-parity for legacy callers.
 * - "suppress": omit those Cluster-1 lines from the prose-writer
 *   prompt. Trace metadata still carries every ID
 *   (`summarizeCharacterContextCapsules` is unaffected). The narrower
 *   ablation question per L099. Mapper / checker / reviewer / repair /
 *   plan-update prompts are NOT touched by this flag.
 *
 * Future "semantic" mode (replace IDs with prose-readable dependency
 * text) requires the slot builder to produce label/description payloads
 * and is deferred to a follow-up slice.
 */
export const WRITER_PROMPT_ID_RENDERINGS = ["raw", "suppress"] as const

export type WriterPromptIdRendering = typeof WRITER_PROMPT_ID_RENDERINGS[number]

export const DEFAULT_WRITER_PROMPT_ID_RENDERING: WriterPromptIdRendering = "raw"

export function isWriterPromptIdRendering(value: unknown): value is WriterPromptIdRendering {
  return typeof value === "string" && WRITER_PROMPT_ID_RENDERINGS.includes(value as WriterPromptIdRendering)
}
