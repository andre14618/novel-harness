export function buildContext(prose: string, chapterNum: number): string {
  return `CHAPTER ${chapterNum} DRAFT:\n${prose}\n\nReview this chapter for show-don't-tell violations and cliché usage. Return the most impactful issues.`
}

export const buildProseQualityContext = buildContext
