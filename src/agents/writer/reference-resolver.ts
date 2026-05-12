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

import { callAgent } from "../../llm"
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

export const IMPLICIT_REFERENCE_MARKERS = [
  "their last", "the letter", "what she learned", "what he learned",
  "consequences of", "tension from", "after the", "because of",
  "what happened", "the incident", "the argument", "the fight",
  "the deal", "the offer", "the promise", "the secret",
  "the truth about", "the lie", "what they said",
  "earlier", "last time", "before the", "since the",
]

export function beatDescriptionHasImplicitReference(description: string): boolean {
  const desc = description.toLowerCase()
  return IMPLICIT_REFERENCE_MARKERS.some(marker =>
    desc.includes(marker) && !isSelfContainedTemporalAnchor(desc, marker)
  )
}

function isSelfContainedTemporalAnchor(description: string, marker: string): boolean {
  if (marker !== "before the" && marker !== "after the") return false
  return [
    /\bbefore the hall opens\b/,
    /\bafter the hall closes\b/,
  ].some(pattern => pattern.test(description))
}

const lookupResponseSchema = z.object({
  lookups: z.array(z.object({
    type: z.enum(["recent_events", "relationship", "location_events", "knowledge"]),
    characters: z.array(z.string()).optional(),
    location: z.string().optional(),
    topic: z.string().optional(),
  })),
})

export async function resolveReferences(
  beat: SceneBeat,
  outline: ChapterOutline,
  novelId: string,
  chapterNumber: number,
  characters: CharacterProfile[],
): Promise<ResolvedReferences> {
  // Step 1: Check if beat has implicit references
  if (!beatDescriptionHasImplicitReference(beat.description)) {
    return { context: "", lookupCount: 0, llmUsed: false }
  }

  // Step 2: Try LLM resolution
  let lookups: z.infer<typeof lookupResponseSchema>["lookups"] = []
  let llmUsed = false

  try {
    const result = await callAgent({
      novelId,
      agentName: "reference-resolver",
      chapter: chapterNumber,
      systemPrompt: "You identify what background information a scene beat needs. Return JSON with specific lookups.",
      userPrompt: `Beat: "${beat.description}"
Characters: ${beat.characters.join(", ")}
Setting: ${outline.setting}
Chapter: ${chapterNumber}

What specific background does the writer need? Return JSON:
{ "lookups": [{ "type": "recent_events"|"relationship"|"location_events"|"knowledge", "characters": ["name"], "location": "place", "topic": "subject" }] }

Only include lookups for things implicitly referenced. Return empty lookups array if the beat is self-contained.`,
      schema: lookupResponseSchema,
    })
    lookups = result.output.lookups
    llmUsed = true
  } catch {
    // LLM failed — fall back to heuristic lookups based on beat characters
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
