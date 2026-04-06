/**
 * Test MiMo V2 Flash vs Cerebras Qwen 235B on relationship-timeline and graph-linker agents.
 * Uses real novel data from DB, builds same context as pipeline.
 */

import { getCharacters, getRelationshipStatesAtChapter, getWorldSystems } from "../src/db"
import { getTimelineEventsForChapter, getTimelineEventsUpToChapter } from "../src/db/timeline"
import { getKnowledgeForChapter } from "../src/db/knowledge"
import {
  RELATIONSHIP_TIMELINE_PROMPT, GRAPH_LINKER_PROMPT,
} from "../src/prompts"
import { buildContext as buildRelTimelineContext } from "../src/agents/relationship-timeline/context"
import { relationshipTimelineSchema } from "../src/types"
import { getTransport } from "../src/transport"
import { PROVIDERS } from "../models/registry"
import { getTokenCost } from "../src/config/pricing"
import db from "../data/connection"

const NOVEL_ID = process.env.NOVEL_ID ?? "novel-1775433433216"
const CHAPTERS = (process.env.CHAPTERS ?? "3,5,8").split(",").map(Number)

interface ModelSpec {
  label: string
  provider: "mimo" | "cerebras"
  model: string
}

const MODELS: ModelSpec[] = [
  { label: "MiMo V2 Flash", provider: "mimo", model: "mimo-v2-flash" },
  { label: "Qwen 235B", provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
]

async function testRelationshipTimeline(
  spec: ModelSpec, novelId: string, chapterNum: number, prose: string,
  characters: any[], relationships: any[], worldSystems: any[],
) {
  const context = buildRelTimelineContext(prose, characters, relationships, worldSystems)
  const start = performance.now()

  try {
    const response = await getTransport().execute({
      systemPrompt: RELATIONSHIP_TIMELINE_PROMPT,
      userPrompt: context,
      model: spec.model,
      provider: spec.provider,
      temperature: 0.2,
      maxTokens: 8192,
      responseFormat: { type: "json_object" },
      callerId: "relationship-timeline",
    })

    const latency = performance.now() - start
    const parsed = relationshipTimelineSchema.safeParse(JSON.parse(response.content))
    const cost = getTokenCost(spec.provider, spec.model, response.usage.prompt_tokens, response.usage.completion_tokens)

    return {
      success: true,
      valid: parsed.success,
      errors: parsed.success ? null : parsed.error.issues.slice(0, 3),
      latencyMs: Math.round(latency),
      cost,
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      data: parsed.success ? parsed.data : null,
      raw: response.content,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function testGraphLinker(
  spec: ModelSpec, novelId: string, chapterNum: number, characters: any[],
) {
  // Build the same context the pipeline builds for graph-linker
  const [thisChapterEvents, priorEvents, knowledgeGains] = await Promise.all([
    getTimelineEventsForChapter(novelId, chapterNum),
    getTimelineEventsUpToChapter(novelId, chapterNum),
    getKnowledgeForChapter(novelId, chapterNum),
  ])

  if (thisChapterEvents.length === 0) {
    return { success: false, error: "No timeline events for this chapter" }
  }

  // Simulate ambiguous causal candidates (take pairs of events)
  const candidates = []
  for (let i = 0; i < Math.min(priorEvents.length, 3); i++) {
    if (thisChapterEvents[0]) {
      candidates.push({
        cause: priorEvents[i],
        effect: thisChapterEvents[0],
        score: 0.5,
      })
    }
  }

  const sections: string[] = []
  sections.push(`CHARACTERS:\n${characters.map((c: any) => `- ${c.name}`).join("\n")}`)

  if (candidates.length > 0) {
    sections.push(`CAUSAL LINK CANDIDATES — confirm or reject each:\n${candidates.map((c, i) =>
      `${i + 1}. "${c.cause.event}" → "${c.effect.event}" (score: ${c.score.toFixed(2)})`
    ).join("\n")}`)
  }

  if (knowledgeGains.length > 0) {
    sections.push(`KNOWLEDGE NEEDING PROPAGATION TYPE:\n${knowledgeGains.slice(0, 5).map((k: any) =>
      `- ${k.character_id}: "${k.knowledge}" (source: ${k.source})`
    ).join("\n")}`)
  }

  sections.push("For causal candidates: respond with the candidate number and 'confirm' or 'reject'. For knowledge: provide propagationType and fromCharacterName if applicable.")

  const start = performance.now()
  try {
    const response = await getTransport().execute({
      systemPrompt: GRAPH_LINKER_PROMPT,
      userPrompt: sections.join("\n\n"),
      model: spec.model,
      provider: spec.provider,
      temperature: 0.2,
      maxTokens: 4096,
      responseFormat: { type: "json_object" },
      callerId: "graph-linker",
    })

    const latency = performance.now() - start
    const parsed = JSON.parse(response.content)
    const cost = getTokenCost(spec.provider, spec.model, response.usage.prompt_tokens, response.usage.completion_tokens)

    const hasCausal = Array.isArray(parsed.causalDecisions) || Array.isArray(parsed.causalLinks)
    const hasKnowledge = Array.isArray(parsed.knowledgePropagation)

    return {
      success: true,
      validStructure: hasCausal || hasKnowledge,
      latencyMs: Math.round(latency),
      cost,
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      causalCount: (parsed.causalDecisions ?? parsed.causalLinks ?? []).length,
      knowledgeCount: (parsed.knowledgePropagation ?? []).length,
      data: parsed,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function main() {
  console.log(`\nTesting relationship-timeline + graph-linker`)
  console.log(`Novel: ${NOVEL_ID}, Chapters: ${CHAPTERS.join(", ")}\n`)

  const characters = await getCharacters(NOVEL_ID)
  const worldSystems = await getWorldSystems(NOVEL_ID).catch(() => [])
  console.log(`Characters: ${characters.map((c: any) => c.name).join(", ")}`)
  console.log(`World systems: ${worldSystems.length}\n`)

  // ── Relationship-Timeline ─────────────────────────────────��───────────
  console.log("=" .repeat(60))
  console.log("  RELATIONSHIP-TIMELINE")
  console.log("=".repeat(60))

  for (const ch of CHAPTERS) {
    const drafts = await db`SELECT prose FROM chapter_drafts WHERE novel_id = ${NOVEL_ID} AND chapter_number = ${ch} ORDER BY version DESC LIMIT 1`
    if (!drafts[0]?.prose) { console.log(`  ch${ch}: no prose, skipping`); continue }
    const prose = drafts[0].prose
    const rels = await getRelationshipStatesAtChapter(NOVEL_ID, ch)

    console.log(`\n  Chapter ${ch} (${prose.split(/\s+/).length}w, ${rels.length} existing rels):`)

    for (const spec of MODELS) {
      const result = await testRelationshipTimeline(spec, NOVEL_ID, ch, prose, characters, rels, worldSystems)
      if (!result.success) {
        console.log(`    ${spec.label}: FAIL — ${(result as any).error}`)
        continue
      }
      const r = result as any
      const d = r.data
      console.log(`    ${spec.label}: ${r.latencyMs}ms $${r.cost.toFixed(4)} | valid=${r.valid} | rels=${d?.relationshipChanges?.length ?? '?'} events=${d?.timelineEvents?.length ?? '?'} knowledge=${d?.knowledgeGains?.length ?? '?'} awareness=${d?.awarenessChanges?.length ?? '?'}`)
      if (!r.valid) console.log(`      Schema errors: ${JSON.stringify(r.errors)}`)
    }
  }

  // ── Graph-Linker ──────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60))
  console.log("  GRAPH-LINKER")
  console.log("=".repeat(60))

  for (const ch of CHAPTERS) {
    console.log(`\n  Chapter ${ch}:`)
    for (const spec of MODELS) {
      const result = await testGraphLinker(spec, NOVEL_ID, ch, characters)
      if (!result.success) {
        console.log(`    ${spec.label}: FAIL — ${(result as any).error}`)
        continue
      }
      const r = result as any
      console.log(`    ${spec.label}: ${r.latencyMs}ms $${r.cost.toFixed(4)} | structure=${r.validStructure} | causal=${r.causalCount} knowledge=${r.knowledgeCount}`)
    }
  }

  // done
  console.log("\n")
  process.exit(0)
}

main()
