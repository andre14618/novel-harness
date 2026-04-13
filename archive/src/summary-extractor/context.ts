export function buildContext(draft: string): string {
  return `CHAPTER TEXT:\n${draft}\n\nSummarize this chapter for use as context in future chapters.`
}

export const buildSummaryContext = buildContext
