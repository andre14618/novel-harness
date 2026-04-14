export interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

export function buildContext(args: {
  seed: { premise: string; genre: string; chapterCount?: number }
  history: ChatTurn[]
  userMessage: string
}): string {
  const { seed, history, userMessage } = args

  const seedSection = `PREMISE: ${seed.premise}
GENRE: ${seed.genre}${seed.chapterCount ? `\nTARGET CHAPTER COUNT: ${seed.chapterCount}` : ""}`

  const historySection = history.length === 0
    ? "CONVERSATION SO FAR: (this is your opening turn — greet briefly and ask about the single most useful dimension for this premise)"
    : `CONVERSATION SO FAR:\n${history.map(t => `${t.role === "user" ? "AUTHOR" : "YOU"}: ${t.content}`).join("\n\n")}`

  return `${seedSection}

${historySection}

AUTHOR: ${userMessage}

Respond with the next turn of the conversation. Plain text only. Under 80 words. Acknowledge briefly, then ask the single most useful follow-up — the dimension that's most underdeveloped given what's been said so far.`
}
