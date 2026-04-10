#!/usr/bin/env bun
/**
 * Extract beat/prose pairs from production novels and oracle-label them
 * for adherence-checker SFT training.
 *
 * Pulls approved chapters from Postgres, splits prose by beat boundaries
 * ("\n\n"), zips with the ChapterOutline.scenes array, runs each pair through
 * the 4 decomposed oracle calls (events / setting / tangent / character),
 * and writes training examples in OpenAI chat format.
 *
 * This data is the highest-leverage addition to the synthetic training set
 * because it represents the actual distribution the model sees in production:
 * real planner output, real 235B writer prose, real edge cases.
 *
 * Output merges with the curated synthetic data for the final training file.
 *
 * Usage:
 *   bun scripts/extract-production-adherence-data.ts
 *   bun scripts/extract-production-adherence-data.ts --limit 20   # chapters
 *   bun scripts/extract-production-adherence-data.ts --dry-run     # count only
 */

import { appendFileSync, writeFileSync } from "fs"
import { join } from "path"
import db from "../data/connection"
import { createTuningExperiment, concludeExperiment } from "../data/db.ts"
import { getTransport } from "../src/transport"
import type { ChapterOutline, SceneBeat } from "../src/types"
import type { ProviderName } from "../models/registry"

const ORACLE_PROVIDER: ProviderName = "cerebras"
const ORACLE_MODEL = "qwen-3-235b-a22b-instruct-2507"

const LIMIT_ARG = process.argv.indexOf("--limit")
const CHAPTER_LIMIT = LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1]) : 999
const DRY_RUN = process.argv.includes("--dry-run")
const OUT_PATH = join(import.meta.dir, "../lora-data/adherence-production.jsonl")

// ── Production system prompts (must match adherence-checker.ts exactly) ──

const EVENTS_SYSTEM = `You verify whether the prose ENACTS a specific scene beat on-page.

Find the passage where the beat's action happens — characters performing the action, dialogue, narration of the action as it occurs in scene.

Rules:
- "Enacted" means the action happens IN SCENE during this prose. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized in narration as backstory) does NOT count as enacted.
- Characters being merely present in the scene is NOT enough — the beat's specific action must occur.
- If you cannot find a passage where the beat is enacted, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

const SETTING_SYSTEM = `You verify whether the prose CONTRADICTS the expected setting for a scene beat.

The expected setting is a brief description (e.g., "a crowded tavern, evening, smoky torchlight"). This beat may be one of several in a chapter — the prose often inherits setting from earlier beats and does NOT re-establish it. That is normal craft and not a mismatch.

ONLY flag setting_matches=false when the prose places the scene in a CLEARLY DIFFERENT setting than expected. Examples of real contradictions:
- Different named location (tavern vs castle, kitchen vs garden)
- Different building or room when the beat names a specific one
- Outdoors vs indoors when the beat is explicit about which
- Different time of day when the beat is explicit (dawn vs midnight)
- Different city, region, or world

If the prose simply doesn't mention setting markers — it's continuing a scene from a prior beat, focused on dialogue, character interiority, or close action — return setting_matches=true. Absence of setting markers is NOT a mismatch. Only POSITIVE evidence of a different setting counts.

Respond with ONLY valid JSON in this exact shape:
{
  "setting_matches": true | false,
  "expected_setting": "<the expected setting, restated>",
  "actual_setting": "<the setting the prose establishes, or 'inherited from prior beat' if not re-established>",
  "reasoning": "<one sentence>"
}`

const TANGENT_SYSTEM = `You measure whether the prose has DRIFTED OFF the scene beat into unrelated content.

A "tangent" is the prose abandoning the beat to pursue something the beat does not call for: an unrelated subplot, scene drift to another character's storyline, lengthy unrelated backstory dump, or the prose pivoting away from the beat entirely.

The following are NOT tangents — they are normal prose craft and must NOT be flagged:
- Atmospheric description (weather, sensory details, environmental texture)
- Character interiority (POV character's thoughts, feelings, memories triggered by what's happening)
- Sensory grounding (what the character sees, hears, smells, touches)
- Emotional reactions to the beat's action
- Brief flashes of backstory the beat itself implies
- Dialogue that develops the beat's situation, even if it briefly digresses
- Pacing variation, internal monologue, descriptive flourishes

The threshold for is_tangent=true is HIGH: more than ~60% of the prose must be doing something completely unrelated to the beat. If the beat is happening anywhere in the prose — even surrounded by atmospheric and interior detail — is_tangent=false.

Estimate the off-spec fraction (0.0 = entirely on-spec, 1.0 = entirely off-spec). Only quote a passage if you are flagging is_tangent=true.

Respond with ONLY valid JSON in this exact shape:
{
  "off_spec_fraction": 0.0,
  "off_spec_quote": "<quoted passage, or empty string>",
  "is_tangent": true | false,
  "reasoning": "<one sentence>"
}`

const CHARACTER_SYSTEM = `You verify whether characters in the prose behave consistently with their roles in a scene beat.

A character "acts contrary to their role" when they do something the beat says they should NOT do, or when they take an action that reverses the beat's intended dynamic (e.g., the beat calls for the character to refuse but the prose has them immediately agree, or the beat calls for confrontation but the prose has them stay silent).

Do NOT flag normal creative interpretation: dialogue rewording, gesture additions, emotional shading, or pacing variation. Only flag clear contradictions.

Respond with ONLY valid JSON in this exact shape:
{
  "character_contradiction": true | false,
  "evidence": "<quoted passage where contradiction occurs, or empty string>",
  "reasoning": "<one sentence>"
}`

type CallType = "events" | "setting" | "tangent" | "character"

const CALL_CONFIGS: Record<CallType, { system: string; buildUser: (beat: string, setting: string, chars: string, prose: string) => string }> = {
  events: {
    system: EVENTS_SYSTEM,
    buildUser: (beat, _setting, chars, prose) =>
      `BEAT: ${beat}\nCHARACTERS EXPECTED: ${chars}\n\nPROSE:\n---\n${prose}\n---`,
  },
  setting: {
    system: SETTING_SYSTEM,
    buildUser: (beat, setting, _chars, prose) =>
      `BEAT: ${beat}\nEXPECTED SETTING: ${setting}\n\nPROSE:\n---\n${prose}\n---`,
  },
  tangent: {
    system: TANGENT_SYSTEM,
    buildUser: (beat, _setting, _chars, prose) =>
      `BEAT: ${beat}\n\nPROSE:\n---\n${prose}\n---`,
  },
  character: {
    system: CHARACTER_SYSTEM,
    buildUser: (beat, _setting, chars, prose) =>
      `BEAT: ${beat}\nCHARACTERS EXPECTED: ${chars}\n\nPROSE:\n---\n${prose}\n---`,
  },
}

const CALL_TYPES: CallType[] = ["events", "setting", "tangent", "character"]

// ── Data fetching ──────────────────────────────────────────────────────

interface ChapterData {
  novelId: string
  chapterNumber: number
  prose: string
  outline: ChapterOutline
}

async function fetchChapters(lim: number): Promise<ChapterData[]> {
  const rows = await db`
    SELECT cd.novel_id, cd.chapter_number, cd.prose, co.outline_json
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.status = 'approved'
    ORDER BY cd.novel_id, cd.chapter_number
    LIMIT ${lim}
  `
  return rows.map((r: any) => ({
    novelId: r.novel_id,
    chapterNumber: r.chapter_number,
    prose: r.prose,
    outline: typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json,
  }))
}

// ── Oracle call ────────────────────────────────────────────────────────

async function callOracle(systemPrompt: string, userPrompt: string): Promise<string | null> {
  try {
    const response = await getTransport().execute({
      systemPrompt,
      userPrompt,
      model: ORACLE_MODEL,
      provider: ORACLE_PROVIDER,
      temperature: 0.1,
      maxTokens: 1024,
      responseFormat: { type: "json_object" },
      callerId: "adherence-production-oracle",
    })
    let content = response.content?.trim() ?? ""
    // Fix broken unicode escapes
    content = content.replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u")
    // Validate JSON
    JSON.parse(content)
    return content
  } catch (e) {
    return null
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const chapters = await fetchChapters(CHAPTER_LIMIT)

  // Build beat/prose pairs by splitting chapter prose on "\n\n"
  interface BeatProsePair {
    novelId: string
    chapterNumber: number
    beatIndex: number
    beat: SceneBeat
    prose: string
    setting: string
  }

  const pairs: BeatProsePair[] = []
  let skippedMismatch = 0

  for (const ch of chapters) {
    const beats = ch.outline.scenes ?? []
    if (beats.length === 0) continue

    // Split chapter prose into beat-level chunks
    // Beats are joined with "\n\n" in drafting.ts:190
    const proseParts = ch.prose.split("\n\n")

    // If count mismatch, skip — prose was likely edited or from the chapter-level fallback path
    if (proseParts.length !== beats.length) {
      // Try merging short paragraphs that might be sub-paragraphs within a beat
      // Some beats produce multi-paragraph prose. Use a heuristic: if there are
      // more prose parts than beats, greedily group consecutive parts.
      if (proseParts.length > beats.length) {
        const groupSize = Math.ceil(proseParts.length / beats.length)
        const grouped: string[] = []
        for (let i = 0; i < proseParts.length; i += groupSize) {
          grouped.push(proseParts.slice(i, i + groupSize).join("\n\n"))
        }
        if (grouped.length === beats.length) {
          for (let i = 0; i < beats.length; i++) {
            const proseChunk = grouped[i].trim()
            if (proseChunk.length < 50) continue // skip empty/tiny chunks
            pairs.push({
              novelId: ch.novelId,
              chapterNumber: ch.chapterNumber,
              beatIndex: i,
              beat: beats[i],
              prose: proseChunk,
              setting: ch.outline.setting ?? "",
            })
          }
          continue
        }
      }
      skippedMismatch++
      continue
    }

    for (let i = 0; i < beats.length; i++) {
      const proseChunk = proseParts[i].trim()
      if (proseChunk.length < 50) continue // skip empty/tiny chunks
      pairs.push({
        novelId: ch.novelId,
        chapterNumber: ch.chapterNumber,
        beatIndex: i,
        beat: beats[i],
        prose: proseChunk,
        setting: ch.outline.setting ?? "",
      })
    }
  }

  console.log(`Chapters fetched: ${chapters.length}`)
  console.log(`Beat/prose pairs: ${pairs.length} (${skippedMismatch} chapters skipped — beat/prose count mismatch)`)
  console.log(`Oracle calls needed: ${pairs.length * 4}`)
  console.log(`Estimated cost: $${(pairs.length * 4 * 0.0006 * 1.2).toFixed(2)} (@ $0.60/M input, ~1200 tokens/call)`)
  console.log()

  if (DRY_RUN) {
    // Show sample pairs
    console.log("Sample pairs:")
    for (const p of pairs.slice(0, 3)) {
      console.log(`  ${p.novelId} ch${p.chapterNumber} beat${p.beatIndex}: "${p.beat.description.slice(0, 80)}..."`)
      console.log(`    chars: ${p.beat.characters.join(", ")}`)
      console.log(`    prose: ${p.prose.slice(0, 100)}...`)
      console.log()
    }
    console.log("DRY RUN — no oracle calls or output.")
    process.exit(0)
  }

  // Create experiment
  const expId = await createTuningExperiment(
    "adherence-production-data",
    `Extract production beat/prose pairs and oracle-label for adherence SFT. ${pairs.length} pairs from ${chapters.length} chapters.`,
    { pairs: pairs.length, chapters: chapters.length, oracleModel: ORACLE_MODEL },
  )
  console.log(`Experiment: ${expId}`)

  writeFileSync(OUT_PATH, "") // clear
  console.log(`Writing to ${OUT_PATH}`)
  console.log()

  let totalExamples = 0
  let oracleErrors = 0
  const flagCounts: Record<CallType, { flagged: number; clean: number }> = {
    events: { flagged: 0, clean: 0 },
    setting: { flagged: 0, clean: 0 },
    tangent: { flagged: 0, clean: 0 },
    character: { flagged: 0, clean: 0 },
  }

  // Process in batches of 4 pairs (= 16 oracle calls) for parallelism
  const BATCH_SIZE = 4
  for (let b = 0; b < pairs.length; b += BATCH_SIZE) {
    const batch = pairs.slice(b, b + BATCH_SIZE)

    const batchResults = await Promise.allSettled(
      batch.map(async (pair) => {
        const proseTrimmed = pair.prose.slice(0, 2000)
        const charsLine = pair.beat.characters.join(", ")
        const examples: string[] = []

        // Run 4 oracle calls in parallel
        const oracleResults = await Promise.allSettled(
          CALL_TYPES.map(async (ct) => {
            const config = CALL_CONFIGS[ct]
            const userPrompt = config.buildUser(pair.beat.description, pair.setting, charsLine, proseTrimmed)
            const content = await callOracle(config.system, userPrompt)
            if (!content) return null

            // Track flag rates
            const parsed = JSON.parse(content)
            const flagged =
              (ct === "events" && !parsed.events_present) ||
              (ct === "setting" && !parsed.setting_matches) ||
              (ct === "tangent" && parsed.is_tangent) ||
              (ct === "character" && parsed.character_contradiction)
            if (flagged) flagCounts[ct].flagged++
            else flagCounts[ct].clean++

            return {
              callType: ct,
              example: JSON.stringify({
                messages: [
                  { role: "system", content: config.system },
                  { role: "user", content: userPrompt },
                  { role: "assistant", content },
                ],
                _meta: {
                  source: "production",
                  novel_id: pair.novelId,
                  chapter: pair.chapterNumber,
                  beat_index: pair.beatIndex,
                  call_type: ct,
                },
              }),
            }
          }),
        )

        for (const r of oracleResults) {
          if (r.status === "fulfilled" && r.value) {
            examples.push(r.value.example)
          } else {
            oracleErrors++
          }
        }
        return examples
      }),
    )

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        for (const ex of r.value) {
          appendFileSync(OUT_PATH, ex + "\n")
          totalExamples++
        }
      }
    }

    const done = Math.min(b + BATCH_SIZE, pairs.length)
    if (done % 20 === 0 || done === pairs.length) {
      console.log(`  [${done}/${pairs.length}] → ${totalExamples} examples`)
    }
  }

  // Summary
  console.log()
  console.log("═".repeat(70))
  console.log("PRODUCTION DATA EXTRACTION COMPLETE")
  console.log("═".repeat(70))
  console.log(`  Pairs processed: ${pairs.length}`)
  console.log(`  Training examples: ${totalExamples} (${oracleErrors} oracle errors)`)
  console.log(`  Output: ${OUT_PATH}`)
  console.log()
  console.log("Oracle label distribution:")
  for (const ct of CALL_TYPES) {
    const total = flagCounts[ct].flagged + flagCounts[ct].clean
    console.log(`  ${ct.padEnd(12)} flagged=${flagCounts[ct].flagged}/${total} (${total ? Math.round((flagCounts[ct].flagged / total) * 100) : 0}%)  clean=${flagCounts[ct].clean}/${total}`)
  }

  await concludeExperiment(expId,
    `Extracted ${totalExamples} production adherence training examples from ${pairs.length} beat/prose pairs across ${chapters.length} chapters. Oracle errors: ${oracleErrors}.`,
  )
  console.log(`\nExperiment ${expId} concluded.`)

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
