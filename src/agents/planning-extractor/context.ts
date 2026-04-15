import { type ChatTurn, sanitizeHistory } from "../planning-conversationalist/context"

export function buildContext(args: {
  seed: { premise: string; genre: string; chapterCount?: number }
  history: ChatTurn[]
}): string {
  const { seed } = args
  const history = sanitizeHistory(args.history)

  const seedSection = `PREMISE: ${seed.premise}
GENRE: ${seed.genre}${seed.chapterCount ? `\nTARGET CHAPTER COUNT: ${seed.chapterCount}` : ""}`

  const transcriptSection = history.length === 0
    ? "CONVERSATION: (no conversation yet — return empty directives)"
    : `CONVERSATION:\n${history.map(t => `${t.role === "user" ? "AUTHOR" : "CONVERSATIONALIST"}: ${t.content}`).join("\n\n")}`

  return `${seedSection}

${transcriptSection}

Extract the author's declared intent into a PlanningDirectives JSON object. Capture only what the author stated or clearly implied. Fidelity over completeness. Output valid JSON only, matching the schema exactly.`
}
