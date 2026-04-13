/**
 * Generate extraction training pairs for chapters missing prompt data.
 *
 * Phase 2 of extractor SFT pipeline. Runs production-identical extraction
 * calls on approved chapters that don't have saved prompts in llm_calls,
 * then appends results to the JSONL files from Phase 1.
 *
 * Uses the exact same system prompts, context builders, and schemas as
 * the production pipeline (src/state-extraction.ts).
 *
 * Usage:
 *   bun scripts/generate-extractor-data.ts                      # all 4 extractors
 *   bun scripts/generate-extractor-data.ts --agent fact-extractor  # single agent
 *   bun scripts/generate-extractor-data.ts --limit 20           # cap chapters
 *   bun scripts/generate-extractor-data.ts --dry-run            # count only
 */

import { appendFileSync } from "fs"
import { join } from "path"
import {
  SUMMARY_EXTRACTOR_PROMPT, FACT_EXTRACTOR_PROMPT,
  CHARACTER_STATE_PROMPT, RELATIONSHIP_TIMELINE_PROMPT,
} from "../src/prompts"
import { buildContext as buildSummaryContext } from "../src/agents/summary-extractor/context"
import { buildContext as buildFactContext } from "../src/agents/fact-extractor/context"
import { buildContext as buildCharStateContext } from "../src/agents/character-state/context"
import { buildContext as buildRelTimelineContext } from "../src/agents/relationship-timeline/context"
import { callAgent } from "../src/llm"
import { chapterSummarySchema, factExtractionSchema, characterStateUpdateSchema, relationshipTimelineSchema } from "../src/types"
import { getCharacters, getRelationshipStatesAtChapter } from "../src/db"
import { getWorldSystems } from "../src/db/world-systems"
import { createTuningExperiment, concludeExperiment } from "../data/db"

const sql = (await import("../data/connection.ts")).default

const AGENT_ARG = process.argv.indexOf("--agent")
const AGENT_FILTER = AGENT_ARG !== -1 ? process.argv[AGENT_ARG + 1] : null
const LIMIT_ARG = process.argv.indexOf("--limit")
const LIMIT = LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1]) : 200
const DRY_RUN = process.argv.includes("--dry-run")

const AGENTS = ["fact-extractor", "summary-extractor", "character-state", "relationship-timeline"]
const targets = AGENT_FILTER ? [AGENT_FILTER] : AGENTS

interface AgentDef {
  name: string
  systemPrompt: string
  schema: any
  buildContext: (prose: string, ...args: any[]) => string
  needsCharacters: boolean
  needsRelationships: boolean
  needsWorldSystems: boolean
}

const AGENT_DEFS: Record<string, AgentDef> = {
  "fact-extractor": {
    name: "fact-extractor",
    systemPrompt: FACT_EXTRACTOR_PROMPT,
    schema: factExtractionSchema,
    buildContext: (prose: string) => buildFactContext(prose),
    needsCharacters: false,
    needsRelationships: false,
    needsWorldSystems: false,
  },
  "summary-extractor": {
    name: "summary-extractor",
    systemPrompt: SUMMARY_EXTRACTOR_PROMPT,
    schema: chapterSummarySchema,
    buildContext: (prose: string) => buildSummaryContext(prose),
    needsCharacters: false,
    needsRelationships: false,
    needsWorldSystems: false,
  },
  "character-state": {
    name: "character-state",
    systemPrompt: CHARACTER_STATE_PROMPT,
    schema: characterStateUpdateSchema,
    buildContext: (prose: string, characters: any[]) => buildCharStateContext(prose, characters),
    needsCharacters: true,
    needsRelationships: false,
    needsWorldSystems: false,
  },
  "relationship-timeline": {
    name: "relationship-timeline",
    systemPrompt: RELATIONSHIP_TIMELINE_PROMPT,
    schema: relationshipTimelineSchema,
    buildContext: (prose: string, characters: any[], relationships: any[], worldSystems: any[]) =>
      buildRelTimelineContext(prose, characters, relationships, worldSystems),
    needsCharacters: true,
    needsRelationships: true,
    needsWorldSystems: true,
  },
}

// Find chapters that need extraction (missing from llm_calls for each agent)
async function findMissingChapters(agent: string): Promise<Array<{ novel_id: string; chapter_number: number; prose: string }>> {
  const rows = await sql`
    SELECT cd.novel_id, cd.chapter_number, cd.prose
    FROM chapter_drafts cd
    WHERE cd.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM llm_calls lc
        WHERE lc.novel_id = cd.novel_id
          AND lc.chapter = cd.chapter_number
          AND lc.agent = ${agent}
          AND lc.system_prompt IS NOT NULL
          AND lc.response_content IS NOT NULL
          AND NOT lc.failed
      )
    ORDER BY cd.novel_id, cd.chapter_number
    LIMIT ${LIMIT}
  `
  return rows.map(r => ({
    novel_id: r.novel_id,
    chapter_number: r.chapter_number,
    prose: r.prose,
  }))
}

console.log(`\n${"=".repeat(70)}`)
console.log(`  Extractor Data Generation — Phase 2`)
console.log(`  Mode: ${DRY_RUN ? "DRY RUN" : "GENERATE"}`)
console.log(`  Agents: ${targets.join(", ")}`)
console.log(`  Limit: ${LIMIT} chapters per agent`)
console.log(`${"=".repeat(70)}\n`)

const expId = DRY_RUN ? null : await createTuningExperiment(
  "data-generation",
  `Extractor SFT data — Phase 2 backfill for ${targets.join(", ")}`,
  { agents: targets, limit: LIMIT, source: "approved chapters without saved prompts" },
  { target: "extractors", dimension: "data-generation" },
)

let totalGenerated = 0

for (const agentName of targets) {
  const def = AGENT_DEFS[agentName]
  if (!def) {
    console.log(`Unknown agent: ${agentName}`)
    continue
  }

  const missing = await findMissingChapters(agentName)
  console.log(`--- ${agentName} ---`)
  console.log(`  Missing chapters: ${missing.length}`)

  if (DRY_RUN || missing.length === 0) {
    console.log()
    continue
  }

  const outPath = join(import.meta.dir, `../lora-data/${agentName}-pairs.jsonl`)
  let generated = 0
  let failed = 0

  // Process in batches of 5 parallel calls
  const BATCH_SIZE = 5
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE)

    const results = await Promise.allSettled(
      batch.map(async (ch) => {
        // Assemble context (same as production)
        let userPrompt: string

        if (def.needsCharacters || def.needsRelationships || def.needsWorldSystems) {
          const characters = await getCharacters(ch.novel_id)
          const relationships = def.needsRelationships
            ? await getRelationshipStatesAtChapter(ch.novel_id, ch.chapter_number)
            : []
          const worldSystems = def.needsWorldSystems
            ? await getWorldSystems(ch.novel_id)
            : []

          if (def.needsWorldSystems) {
            userPrompt = def.buildContext(ch.prose, characters, relationships, worldSystems)
          } else {
            userPrompt = def.buildContext(ch.prose, characters)
          }
        } else {
          userPrompt = def.buildContext(ch.prose)
        }

        // Call production model
        const result = await callAgent({
          novelId: ch.novel_id,
          agentName: def.name,
          chapter: ch.chapter_number,
          systemPrompt: def.systemPrompt,
          userPrompt,
          schema: def.schema,
        })

        return { ch, userPrompt, result }
      }),
    )

    for (const r of results) {
      if (r.status === "rejected") {
        failed++
        continue
      }
      const { ch, userPrompt, result } = r.value

      // Build training pair
      const pair = {
        messages: [
          { role: "system", content: def.systemPrompt },
          { role: "user", content: userPrompt },
          { role: "assistant", content: JSON.stringify(result.output) },
        ],
        _meta: {
          source: "generate-extractor-data",
          agent: agentName,
          novel_id: ch.novel_id,
          chapter: ch.chapter_number,
          generated_at: new Date().toISOString(),
        },
      }
      appendFileSync(outPath, JSON.stringify(pair) + "\n")
      generated++
    }

    const progress = Math.min(i + BATCH_SIZE, missing.length)
    process.stdout.write(`\r  Progress: ${progress}/${missing.length} (${generated} ok, ${failed} err)`)
  }

  console.log(`\n  Generated: ${generated}, Failed: ${failed}`)
  console.log(`  Appended to: lora-data/${agentName}-pairs.jsonl`)
  console.log()
  totalGenerated += generated
}

if (expId) {
  await concludeExperiment(expId, `Generated ${totalGenerated} extraction pairs across ${targets.length} agents. Phase 2 backfill complete.`)
}

console.log(`\nTotal generated: ${totalGenerated} new pairs`)
console.log(`Combined with Phase 1 exports, JSONL files now contain production-ready training data.`)

process.exit(0)
