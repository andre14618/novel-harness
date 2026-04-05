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

const themeSchema = z.record(z.any()).transform(d => {
  // Extract theme string from whatever key the model used
  const theme = String(d.theme ?? d.tag ?? d.name ?? d.label ?? d.value ?? d.thematic_tag ?? d.text ?? "")
  return {
    sourceType: ["fact", "event", "summary", "knowledge"].includes(d.sourceType ?? d.source_type ?? d.type)
      ? (d.sourceType ?? d.source_type ?? d.type)
      : "event",
    sourceId: String(d.sourceId ?? d.source_id ?? d.id ?? d.event_id ?? d.fact_id ?? ""),
    theme,
  }
}).pipe(z.object({
  sourceType: z.string(),
  sourceId: z.string(),
  theme: z.string().min(1),
}))

// Accept any key naming for the top-level arrays
export const graphLinkerSchema = z.record(z.any()).transform(d => ({
  causalLinks: Array.isArray(d.causalLinks ?? d.causal_links) ? (d.causalLinks ?? d.causal_links) : [],
  knowledgePropagation: Array.isArray(d.knowledgePropagation ?? d.knowledge_propagation) ? (d.knowledgePropagation ?? d.knowledge_propagation) : [],
  themes: Array.isArray(d.themes ?? d.thematicTags ?? d.thematic_tags) ? (d.themes ?? d.thematicTags ?? d.thematic_tags) : [],
})).pipe(z.object({
  causalLinks: z.array(causalLinkSchema).default([]),
  knowledgePropagation: z.array(knowledgePropSchema).default([]),
  themes: z.array(themeSchema).default([]),
}))

export type GraphLinkerOutput = {
  causalLinks: Array<{ causeEventId: string; effectEventId: string; relationship: string; confidence: number }>
  knowledgePropagation: Array<{ knowledgeId: string; fromCharacterId: string | null; toCharacterId: string; viaEventId: string | null; propagationType: string; confidence: number }>
  themes: Array<{ sourceType: string; sourceId: string; theme: string }>
}
