/**
 * Re-run deterministic graph analysis + LLM validation on existing novels.
 * Skips steps 1 (LLM extraction) and 2 (embedding) — uses data already in DB.
 *
 * Usage:
 *   bun scripts/re-extract-graph.ts novel-123 novel-456
 */

import db from "../data/connection"
import { getCharacters } from "../src/db"
import { getTimelineEventsForChapter, getTimelineEventsUpToChapter } from "../src/db/timeline"
import { getKnowledgeForChapter } from "../src/db/knowledge"
import { callAgent } from "../src/llm"
import { GRAPH_LINKER_PROMPT } from "../src/prompts"
import * as harness from "../src/harness"
import { z } from "zod"

const novelIds = process.argv.slice(2)
if (novelIds.length === 0) {
  console.error("Usage: bun scripts/re-extract-graph.ts <novel-id> [novel-id...]")
  process.exit(1)
}

async function tryGet<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() } catch { return null }
}

async function reExtract(novelId: string) {
  const novel = (await db`SELECT * FROM novels WHERE id = ${novelId}`)[0]
  if (!novel) { console.error(`Novel ${novelId} not found`); return }

  const totalChapters = novel.total_chapters
  console.log(`\n${novelId}: ${totalChapters} chapters`)

  // Clear existing causal links (keep knowledge propagation)
  const causalDeleted = await db`DELETE FROM event_causes WHERE novel_id = ${novelId} RETURNING id`
  console.log(`  Cleared: ${causalDeleted.length} causal links`)

  const characters = await getCharacters(novelId)
  const detConfig = await harness.deterministic.getDeterministicConfig(novelId)

  let totalCausalAuto = 0, totalCausalLLM = 0, totalCandidates = 0

  for (let ch = 1; ch <= totalChapters; ch++) {
    const [thisChapterEvents, priorEvents, knowledgeGains] = await Promise.all([
      getTimelineEventsForChapter(novelId, ch),
      getTimelineEventsUpToChapter(novelId, ch),
      getKnowledgeForChapter(novelId, ch),
    ])

    if (thisChapterEvents.length === 0) {
      console.log(`  ch${ch}: no events, skipping`)
      continue
    }

    // Step 3: Deterministic analysis
    const det = await harness.deterministic.runDeterministicAnalysis(
      novelId, ch, thisChapterEvents, priorEvents,
      knowledgeGains, characters, detConfig,
    )

    // Save auto-accepted causal links
    const autoCausal = det.causalCandidates.filter(c => c.score >= detConfig.causalAutoThreshold)
    if (autoCausal.length > 0) {
      await harness.graph.saveCausalLinks(novelId, autoCausal.map(c => ({
        causeEventId: c.causeEventId, effectEventId: c.effectEventId,
        relationship: "causes", confidence: c.score, chapterEstablished: ch,
      })))
      totalCausalAuto += autoCausal.length
    }

    // Step 4: LLM validates ambiguous candidates
    const ambiguous = det.causalCandidates.filter(c =>
      c.score >= detConfig.causalCandidateThreshold && c.score < detConfig.causalAutoThreshold
    )
    totalCandidates += ambiguous.length

    if (ambiguous.length > 0) {
      const sections: string[] = []
      sections.push(`CHARACTERS:\n${characters.map(c => `- ${c.name} (${c.role})`).join("\n")}`)
      sections.push(`CAUSAL LINK CANDIDATES — confirm or reject each:\n${ambiguous.map((c, i) => {
        const cause = thisChapterEvents.concat(priorEvents).find(e => e.id === c.causeEventId)
        const effect = thisChapterEvents.find(e => e.id === c.effectEventId)
        return `${i + 1}. "${cause?.event ?? "unknown"}" → "${effect?.event ?? "unknown"}" (score: ${c.score.toFixed(2)}, signals: ${c.signals.join(", ")})`
      }).join("\n")}`)

      try {
        const result = await callAgent({
          novelId, agentName: "graph-linker",
          systemPrompt: GRAPH_LINKER_PROMPT,
          userPrompt: sections.join("\n\n"),
          schema: z.object({
            causalDecisions: z.array(z.object({
              candidate: z.number(),
              decision: z.string().transform(v => v.toLowerCase().includes("confirm") ? "confirm" : "reject"),
            })).default([]),
            knowledgePropagation: z.array(z.object({
              characterName: z.string(),
              knowledge: z.string(),
              fromCharacterName: z.string().nullable().default(null),
              propagationType: z.string().default("origin"),
              confidence: z.number().min(0).max(1).default(1.0),
            })).default([]),
          }).passthrough(),
        })

        const confirmed = (result.output.causalDecisions ?? []).filter(d => d.decision === "confirm")
        for (const d of confirmed) {
          if (d.candidate >= 1 && d.candidate <= ambiguous.length) {
            const c = ambiguous[d.candidate - 1]
            await harness.graph.saveCausalLinks(novelId, [{
              causeEventId: c.causeEventId, effectEventId: c.effectEventId,
              relationship: "causes", confidence: c.score, chapterEstablished: ch,
            }])
            totalCausalLLM++
          }
        }

        console.log(`  ch${ch}: ${autoCausal.length} causal auto, ${confirmed.length}/${ambiguous.length} LLM confirmed`)
      } catch (err) {
        console.log(`  ch${ch}: ${autoCausal.length} causal auto, LLM failed: ${err instanceof Error ? err.message : err}`)
      }
    } else {
      console.log(`  ch${ch}: ${autoCausal.length} causal auto, 0 candidates`)
    }
  }

  console.log(`\n  TOTAL: ${totalCausalAuto} causal auto + ${totalCausalLLM} LLM confirmed = ${totalCausalAuto + totalCausalLLM} causal links`)
  console.log(`  ${totalCandidates} candidates sent to LLM`)
}

async function main() {
  for (const id of novelIds) {
    await reExtract(id)
  }
  process.exit(0)
}

main()
