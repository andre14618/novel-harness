export function buildContext(draft: string): string {
  return `CHAPTER TEXT:\n${draft}\n\nExtract all concrete, specific facts established in this chapter.`
}

export const buildFactExtractionContext = buildContext
