export interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

/**
 * Strip Qwen-style <think>…</think> reasoning blocks (closed and truncated)
 * from a turn's content before it's replayed into any LLM context. Reasoning
 * is internal-only; feeding it back in wastes tokens and pollutes extraction.
 */
export function stripThinking(content: string): string {
  let out = content.replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
  const unclosed = out.indexOf("<think>")
  if (unclosed !== -1) out = out.slice(0, unclosed)
  return out.trim()
}

export function sanitizeHistory(history: ChatTurn[]): ChatTurn[] {
  return history.map(t => ({ ...t, content: stripThinking(t.content) }))
}

export function buildContext(args: {
  seed: { premise: string; genre: string; chapterCount?: number }
  history: ChatTurn[]
  userMessage: string
}): string {
  const { seed, userMessage } = args
  const history = sanitizeHistory(args.history)

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
