import { z } from "zod"

// ── Flexible schemas that accept various LLM output formats ───────────────
// Models return inconsistent key names (camelCase, snake_case, abbreviations).
// Each schema accepts common variants and normalizes to a canonical form.

const CAUSAL_TYPES = ["causes", "enables", "prevents", "motivates"] as const

const causalLinkSchema = z.record(z.any()).transform(d => ({
  causeEventId: String(d.causeEventId ?? d.cause_event_id ?? d.cause ?? d.from ?? d.source ?? ""),
  effectEventId: String(d.effectEventId ?? d.effect_event_id ?? d.effect ?? d.to ?? d.target ?? ""),
  relationship: CAUSAL_TYPES.includes(d.relationship ?? d.type ?? d.relation) ? (d.relationship ?? d.type ?? d.relation) : "causes",
  confidence: Number(d.confidence ?? d.conf ?? 0.8),
}))

const knowledgePropSchema = z.record(z.any()).transform(d => ({
  knowledgeId: String(d.knowledgeId ?? d.knowledge_id ?? d.id ?? ""),
  fromCharacterId: d.fromCharacterId ?? d.from_character_id ?? d.from ?? d.source_character ?? null,
  toCharacterId: String(d.toCharacterId ?? d.to_character_id ?? d.to ?? d.character ?? d.recipient ?? ""),
  viaEventId: d.viaEventId ?? d.via_event_id ?? d.event ?? d.via ?? null,
  propagationType: ["origin", "told", "overheard", "deduced", "discovered"].includes(d.propagationType ?? d.propagation_type ?? d.type ?? d.method)
    ? (d.propagationType ?? d.propagation_type ?? d.type ?? d.method)
    : "origin",
  confidence: Number(d.confidence ?? d.conf ?? 1.0),
}))

// Theme entries can come in two formats:
// 1. { sourceType, sourceId, theme } — one tag per entry
// 2. { targetId, tags: ["theme1", "theme2"] } — multiple tags per entry
// We normalize both to flat { sourceType, sourceId, theme } entries
const themeEntrySchema = z.record(z.any())

function normalizeThemes(raw: any[]): Array<{ sourceType: string; sourceId: string; theme: string }> {
  const results: Array<{ sourceType: string; sourceId: string; theme: string }> = []
  for (const d of raw) {
    const sourceId = String(d.sourceId ?? d.source_id ?? d.id ?? d.targetId ?? d.target_id ?? d.event_id ?? d.fact_id ?? "")
    const sourceType = ["fact", "event", "summary", "knowledge"].includes(d.sourceType ?? d.source_type ?? d.type)
      ? (d.sourceType ?? d.source_type ?? d.type)
      : "event"

    // Format 2: { targetId, tags: [...] }
    if (Array.isArray(d.tags)) {
      for (const tag of d.tags) {
        if (typeof tag === "string" && tag.length > 0) {
          results.push({ sourceType, sourceId, theme: tag })
        }
      }
      continue
    }

    // Format 1: single theme string
    const theme = String(d.theme ?? d.tag ?? d.name ?? d.label ?? d.value ?? "")
    if (theme.length > 0) {
      results.push({ sourceType, sourceId, theme })
    }
  }
  return results
}

// Accept any key naming for the top-level arrays
export const graphLinkerSchema = z.record(z.any()).transform(d => {
  const rawCausal = Array.isArray(d.causalLinks ?? d.causal_links) ? (d.causalLinks ?? d.causal_links) : []
  const rawKnowledge = Array.isArray(d.knowledgePropagation ?? d.knowledge_propagation) ? (d.knowledgePropagation ?? d.knowledge_propagation) : []
  const rawThemes = Array.isArray(d.themes ?? d.thematicTags ?? d.thematic_tags) ? (d.themes ?? d.thematicTags ?? d.thematic_tags) : []

  return {
    causalLinks: rawCausal,
    knowledgePropagation: rawKnowledge,
    themes: rawThemes,
  }
}).pipe(z.object({
  causalLinks: z.array(causalLinkSchema).default([]),
  knowledgePropagation: z.array(knowledgePropSchema).default([]),
  themes: z.array(themeEntrySchema).default([]),
}).transform(d => ({
  causalLinks: d.causalLinks,
  knowledgePropagation: d.knowledgePropagation,
  themes: normalizeThemes(d.themes),
})))

export type GraphLinkerOutput = {
  causalLinks: Array<{ causeEventId: string; effectEventId: string; relationship: string; confidence: number }>
  knowledgePropagation: Array<{ knowledgeId: string; fromCharacterId: string | null; toCharacterId: string; viaEventId: string | null; propagationType: string; confidence: number }>
  themes: Array<{ sourceType: string; sourceId: string; theme: string }>
}
