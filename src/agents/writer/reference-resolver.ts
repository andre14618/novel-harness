/**
 * Reference resolver — resolves implicit references in beat descriptions
 * to specific DB entities using deterministic lookups + cheap LLM fallback.
 *
 * Example: "tension from their last encounter" → lookup recent events
 * involving both characters → return the specific event as context.
 *
 * The LLM call is only made when the beat description contains unresolved
 * implicit references that the deterministic pass can't handle.
 */

import { executeBestOfN } from "../../llm"
import { unionByKey } from "../../aggregators"
import {
  getRecentEventsForCharacters,
  getRelationshipBetween,
  getEventsAtLocation,
  getCharacterKnowledgeUpToChapter,
} from "../../db"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { z } from "zod"

export interface ResolvedReferences {
  context: string
  lookupCount: number
  llmUsed: boolean
}

const IMPLICIT_MARKERS = [
  "their last", "the letter", "what she learned", "what he learned",
  "consequences of", "tension from", "after the", "because of",
  "what happened", "the incident", "the argument", "the fight",
  "the deal", "the offer", "the promise", "the secret",
  "the truth about", "the lie", "what they said",
  "earlier", "last time", "before the", "since the",
]

const lookupResponseSchema = z.object({
  lookups: z.array(z.object({
    type: z.enum(["recent_events", "relationship", "location_events", "knowledge"]),
    characters: z.array(z.string()).optional(),
    location: z.string().optional(),
    topic: z.string().optional(),
  })),
})

type LookupResponse = z.infer<typeof lookupResponseSchema>
type Lookup = LookupResponse["lookups"][number]

/** Coarse key for cross-call deduplication. Drops free-text topic except for
 *  knowledge lookups (where the retrieval engine actually uses topic to filter). */
function lookupKey(l: Lookup): string {
  const chars = (l.characters ?? []).map(c => c.toLowerCase().trim()).sort().join(",")
  const loc = (l.location ?? "").toLowerCase().trim()
  const topicHint = l.type === "knowledge"
    ? "|" + (l.topic ?? "").toLowerCase().trim().split(/\s+/).slice(0, 3).join(" ")
    : ""
  return `${l.type}|${chars}|${loc}${topicHint}`
}

/** Aggregator for parallel-N calls. Set union by lookup key — improves recall
 *  by ~7pp (relative +23%) vs single-shot per the best-of-N benchmark on 30
 *  real beats. The recall gain is the right tradeoff for reference-resolver
 *  because extra lookups are low-cost (writer reads more context) while missed
 *  lookups are higher-cost (writer doesn't know about something). See
 *  docs/lessons-learned.md for the full benchmark write-up. */
function aggregateLookupsUnion(outputs: LookupResponse[]): LookupResponse {
  const merged = unionByKey(outputs.map(o => o.lookups ?? []), lookupKey)
  return { lookups: merged }
}

export async function resolveReferences(
  beat: SceneBeat,
  outline: ChapterOutline,
  novelId: string,
  chapterNumber: number,
  characters: CharacterProfile[],
): Promise<ResolvedReferences> {
  const desc = beat.description.toLowerCase()

  // Step 1: Check if beat has implicit references
  const hasImplicit = IMPLICIT_MARKERS.some(m => desc.includes(m))
  if (!hasImplicit) {
    return { context: "", lookupCount: 0, llmUsed: false }
  }

  // Step 2: Try LLM resolution
  let lookups: z.infer<typeof lookupResponseSchema>["lookups"] = []
  let llmUsed = false

  try {
    const result = await executeBestOfN<LookupResponse>({
      novelId,
      agentName: "reference-resolver",
      systemPrompt: "You identify what background information a scene beat needs. Return JSON with specific lookups.",
      userPrompt: `Beat: "${beat.description}"
Characters: ${beat.characters.join(", ")}
Setting: ${outline.setting}
Chapter: ${chapterNumber}

What specific background does the writer need? Return JSON:
{ "lookups": [{ "type": "recent_events"|"relationship"|"location_events"|"knowledge", "characters": ["name"], "location": "place", "topic": "subject" }] }

Only include lookups for things implicitly referenced. Return empty lookups array if the beat is self-contained.`,
      schema: lookupResponseSchema,
    }, 3, aggregateLookupsUnion)
    lookups = result.output.lookups
    llmUsed = true
  } catch {
    // All N parallel attempts failed — fall back to heuristic lookups based on beat characters
    lookups = [{ type: "recent_events", characters: beat.characters }]
  }

  // Step 3: Execute lookups
  const contextParts: string[] = []
  let lookupCount = 0

  for (const lookup of lookups.slice(0, 3)) {
    try {
      switch (lookup.type) {
        case "recent_events": {
          const charNames = lookup.characters ?? beat.characters
          const events = await getRecentEventsForCharacters(novelId, chapterNumber, charNames, 3)
          for (const e of events) {
            contextParts.push(`Ch${e.chapterNumber}: ${e.event}${e.consequences ? ` → ${e.consequences}` : ""}`)
          }
          lookupCount++
          break
        }
        case "relationship": {
          const chars = lookup.characters ?? beat.characters
          if (chars.length >= 2) {
            const charA = characters.find(c => c.name.toLowerCase() === chars[0].toLowerCase())
            const charB = characters.find(c => c.name.toLowerCase() === chars[1].toLowerCase())
            if (charA && charB) {
              const rel = await getRelationshipBetween(novelId, charA.id, charB.id, chapterNumber)
              if (rel) {
                contextParts.push(`${charA.name}↔${charB.name}: [${rel.trustLevel}] ${rel.dynamic}${rel.tension ? ` (tension: ${rel.tension})` : ""}`)
              }
            }
          }
          lookupCount++
          break
        }
        case "location_events": {
          const loc = lookup.location ?? outline.setting
          const events = await getEventsAtLocation(novelId, loc, chapterNumber)
          for (const e of events.slice(0, 2)) {
            contextParts.push(`At ${loc}, ch${e.chapterNumber}: ${e.event}`)
          }
          lookupCount++
          break
        }
        case "knowledge": {
          const charName = lookup.characters?.[0] ?? outline.povCharacter
          const char = characters.find(c => c.name.toLowerCase() === charName?.toLowerCase())
          if (char) {
            const knowledge = await getCharacterKnowledgeUpToChapter(novelId, char.id, chapterNumber)
            const topicLower = (lookup.topic ?? "").toLowerCase()
            const relevant = topicLower
              ? knowledge.filter(k => k.knowledge.toLowerCase().includes(topicLower)).slice(0, 2)
              : knowledge.slice(0, 3)
            for (const k of relevant) {
              contextParts.push(`${char.name} knows: ${k.knowledge} (ch${k.chapterLearned})`)
            }
          }
          lookupCount++
          break
        }
      }
    } catch { /* skip failed lookups */ }
  }

  const context = contextParts.length > 0
    ? `BACKGROUND:\n${contextParts.map(p => `- ${p}`).join("\n")}`
    : ""

  return { context, lookupCount, llmUsed }
}
