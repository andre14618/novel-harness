import { z } from "zod"

// Accept both camelCase and snake_case from the model
const causalLinkSchema = z.object({
  causeEventId: z.string().optional(),
  cause_event_id: z.string().optional(),
  effectEventId: z.string().optional(),
  effect_event_id: z.string().optional(),
  relationship: z.enum(["causes", "enables", "prevents", "motivates"]),
  confidence: z.number().min(0).max(1),
}).transform(d => ({
  causeEventId: d.causeEventId ?? d.cause_event_id ?? "",
  effectEventId: d.effectEventId ?? d.effect_event_id ?? "",
  relationship: d.relationship,
  confidence: d.confidence,
}))

const knowledgePropSchema = z.object({
  knowledgeId: z.string().optional(),
  knowledge_id: z.string().optional(),
  fromCharacterId: z.string().nullable().optional(),
  from_character_id: z.string().nullable().optional(),
  toCharacterId: z.string().optional(),
  to_character_id: z.string().optional(),
  viaEventId: z.string().nullable().optional(),
  via_event_id: z.string().nullable().optional(),
  propagationType: z.enum(["origin", "told", "overheard", "deduced", "discovered"]).optional(),
  propagation_type: z.enum(["origin", "told", "overheard", "deduced", "discovered"]).optional(),
  confidence: z.number().min(0).max(1).optional().default(1.0),
}).transform(d => ({
  knowledgeId: d.knowledgeId ?? d.knowledge_id ?? "",
  fromCharacterId: d.fromCharacterId ?? d.from_character_id ?? null,
  toCharacterId: d.toCharacterId ?? d.to_character_id ?? "",
  viaEventId: d.viaEventId ?? d.via_event_id ?? null,
  propagationType: d.propagationType ?? d.propagation_type ?? "origin",
  confidence: d.confidence,
}))

const themeSchema = z.object({
  sourceType: z.enum(["fact", "event", "summary", "knowledge"]).optional(),
  source_type: z.enum(["fact", "event", "summary", "knowledge"]).optional(),
  sourceId: z.string().optional(),
  source_id: z.string().optional(),
  theme: z.string(),
}).transform(d => ({
  sourceType: d.sourceType ?? d.source_type ?? "event",
  sourceId: d.sourceId ?? d.source_id ?? "",
  theme: d.theme,
}))

// Accept both "themes" and "thematicTags" keys
export const graphLinkerSchema = z.object({
  causalLinks: z.array(causalLinkSchema).optional().default([]),
  causal_links: z.array(causalLinkSchema).optional(),
  knowledgePropagation: z.array(knowledgePropSchema).optional().default([]),
  knowledge_propagation: z.array(knowledgePropSchema).optional(),
  themes: z.array(themeSchema).optional().default([]),
  thematicTags: z.array(themeSchema).optional(),
  thematic_tags: z.array(themeSchema).optional(),
}).transform(d => ({
  causalLinks: d.causalLinks.length > 0 ? d.causalLinks : (d.causal_links ?? []),
  knowledgePropagation: d.knowledgePropagation.length > 0 ? d.knowledgePropagation : (d.knowledge_propagation ?? []),
  themes: d.themes.length > 0 ? d.themes : (d.thematicTags ?? d.thematic_tags ?? []),
}))

export type GraphLinkerOutput = {
  causalLinks: Array<{ causeEventId: string; effectEventId: string; relationship: string; confidence: number }>
  knowledgePropagation: Array<{ knowledgeId: string; fromCharacterId: string | null; toCharacterId: string; viaEventId: string | null; propagationType: string; confidence: number }>
  themes: Array<{ sourceType: string; sourceId: string; theme: string }>
}
