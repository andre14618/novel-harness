/**
 * Embedding client for semantic context retrieval.
 * Ported from openbrain/src/embed.ts — same model, same OpenRouter endpoint.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const EMBEDDING_MODEL = "openai/text-embedding-3-large"
const MAX_TOKENS = 8000 // leave headroom under 8191 limit

export async function getEmbedding(text: string): Promise<number[]> {
  const results = await getEmbeddings([text])
  return results[0]
}

/**
 * Batch embed multiple texts in a single API call.
 * Returns embeddings in the same order as input texts.
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set — cannot embed")
  if (texts.length === 0) return []

  const truncated = texts.map(t =>
    t.length > MAX_TOKENS * 4 ? t.slice(0, MAX_TOKENS * 4) : t
  )

  const doFetch = () =>
    fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: truncated }),
    })

  let res = await doFetch()

  // Retry once on transient errors
  if (!res.ok && (res.status === 429 || res.status >= 500)) {
    await Bun.sleep(1000)
    res = await doFetch()
  }

  if (!res.ok) {
    throw new Error(`Embedding failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  return data.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((d: any) => d.embedding)
}

// ── Embedding text templates ──────────────────────────────────────────────

export function buildFactEmbedText(category: string, fact: string): string {
  return `[${category}] ${fact}`
}

export function buildEventEmbedText(event: string, location: string, participants: string[], consequences: string): string {
  const parts = [event]
  if (location) parts.push(`at ${location}`)
  if (participants.length) parts.push(`Participants: ${participants.join(", ")}`)
  if (consequences) parts.push(`Consequences: ${consequences}`)
  return parts.join(". ")
}

export function buildSummaryEmbedText(chapterNum: number, summary: string, keyEvents: string[], emotionalState: string): string {
  const parts = [`Chapter ${chapterNum}: ${summary}`]
  if (keyEvents.length) parts.push(`Key events: ${keyEvents.join("; ")}`)
  if (emotionalState) parts.push(`Emotional state: ${emotionalState}`)
  return parts.join(". ")
}

export function buildCharStateEmbedText(name: string, location: string, emotionalState: string, knows: string[], doesNotKnow: string[]): string {
  const parts = [`${name} in ${location || "unknown location"}: ${emotionalState || "unspecified state"}`]
  if (knows.length) parts.push(`Knows: ${knows.join("; ")}`)
  if (doesNotKnow.length) parts.push(`Doesn't know: ${doesNotKnow.join("; ")}`)
  return parts.join(". ")
}

export function buildRelationshipEmbedText(charA: string, charB: string, trustLevel: string, dynamic: string, tension: string, recentShift: string): string {
  const parts = [`${charA} and ${charB}: [${trustLevel}] ${dynamic}`]
  if (tension) parts.push(`Tension: ${tension}`)
  if (recentShift) parts.push(`Shift: ${recentShift}`)
  return parts.join(". ")
}

export function buildKnowledgeEmbedText(characterName: string, source: string, knowledge: string, isFalse: boolean): string {
  let text = `${characterName} ${source} that ${knowledge}`
  if (isFalse) text += " [BELIEVED BUT FALSE]"
  return text
}
