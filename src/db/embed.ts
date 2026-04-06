/**
 * Embedding client for semantic context retrieval.
 * Ported from openbrain/src/embed.ts — same model, same OpenRouter endpoint.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const EMBEDDING_MODEL = "openai/text-embedding-3-large"
const EMBEDDING_DIMS = 1536 // Truncated from 3072 — pgvector 0.6 HNSW max is 2000 dims
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
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: truncated, dimensions: EMBEDDING_DIMS }),
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

// ── Embedding text templates (DB-backed, autoresearcher-tunable) ─────────

import db from "../../data/connection"

const DEFAULT_TEMPLATES: Record<string, string> = {
  fact: "[{category}] {fact}",
  event: "{event}. at {location}. Participants: {participants}. Consequences: {consequences}",
  summary: "Chapter {chapterNum}: {summary}. Key events: {keyEvents}. Emotional state: {emotionalState}",
  char_state: "{name} in {location}: {emotionalState}. Knows: {knows}. Doesn't know: {doesNotKnow}",
  relationship: "{charA} and {charB}: [{trustLevel}] {dynamic}. Tension: {tension}. Shift: {recentShift}",
  knowledge: "{characterName} {source} that {knowledge}{isFalseTag}",
}

// Cache loaded templates (invalidated on save)
let templateCache: Record<string, string> | null = null

async function getTemplate(sourceType: string): Promise<string> {
  if (!templateCache) {
    templateCache = { ...DEFAULT_TEMPLATES }
    try {
      const rows = await db`SELECT source_type, template FROM embedding_templates`
      for (const r of rows) templateCache[r.source_type] = r.template
    } catch {
      // DB not available (tests, local dev) — use defaults
    }
  }
  return templateCache[sourceType] ?? DEFAULT_TEMPLATES[sourceType] ?? ""
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "")
    .replace(/\.\s*\./g, ".") // collapse empty sections
    .replace(/:\s*\./g, ".") // collapse "label: ."
    .trim()
}

/** Save a template (for autoresearcher tuning) */
export async function saveEmbeddingTemplate(sourceType: string, template: string): Promise<void> {
  await db`INSERT INTO embedding_templates (source_type, template, updated_at)
           VALUES (${sourceType}, ${template}, now())
           ON CONFLICT (source_type) DO UPDATE SET template = EXCLUDED.template, updated_at = now()`
  templateCache = null // invalidate cache
}

/** Get current template text (for display / improver context) */
export async function getEmbeddingTemplate(sourceType: string): Promise<string> {
  return getTemplate(sourceType)
}

/** Get all templates */
export async function getAllEmbeddingTemplates(): Promise<Record<string, string>> {
  // Force reload
  templateCache = null
  await getTemplate("fact") // triggers load
  return { ...templateCache! }
}

export async function buildFactEmbedText(category: string, fact: string): Promise<string> {
  const tpl = await getTemplate("fact")
  return interpolate(tpl, { category, fact })
}

export async function buildEventEmbedText(event: string, location: string, participants: string[], consequences: string): Promise<string> {
  const tpl = await getTemplate("event")
  return interpolate(tpl, { event, location, participants: participants.join(", "), consequences })
}

export async function buildSummaryEmbedText(chapterNum: number, summary: string, keyEvents: string[], emotionalState: string): Promise<string> {
  const tpl = await getTemplate("summary")
  return interpolate(tpl, { chapterNum: String(chapterNum), summary, keyEvents: keyEvents.join("; "), emotionalState })
}

export async function buildCharStateEmbedText(name: string, location: string, emotionalState: string, knows: string[], doesNotKnow: string[]): Promise<string> {
  const tpl = await getTemplate("char_state")
  return interpolate(tpl, { name, location: location || "unknown location", emotionalState: emotionalState || "unspecified state", knows: knows.join("; "), doesNotKnow: doesNotKnow.join("; ") })
}

export async function buildRelationshipEmbedText(charA: string, charB: string, trustLevel: string, dynamic: string, tension: string, recentShift: string): Promise<string> {
  const tpl = await getTemplate("relationship")
  return interpolate(tpl, { charA, charB, trustLevel, dynamic, tension, recentShift })
}

export async function buildKnowledgeEmbedText(characterName: string, source: string, knowledge: string, isFalse: boolean): Promise<string> {
  const tpl = await getTemplate("knowledge")
  return interpolate(tpl, { characterName, source, knowledge, isFalseTag: isFalse ? " [BELIEVED BUT FALSE]" : "" })
}
