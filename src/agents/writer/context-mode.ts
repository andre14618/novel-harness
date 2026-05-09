export const WRITER_CONTEXT_MODES = ["legacy", "thread-character-context-v1"] as const

export type WriterContextMode = typeof WRITER_CONTEXT_MODES[number]

export const DEFAULT_WRITER_CONTEXT_MODE: WriterContextMode = "thread-character-context-v1"

export function isWriterContextMode(value: unknown): value is WriterContextMode {
  return typeof value === "string" && WRITER_CONTEXT_MODES.includes(value as WriterContextMode)
}
