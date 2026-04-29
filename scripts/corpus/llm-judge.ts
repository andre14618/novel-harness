#!/usr/bin/env bun
/**
 * Stage 6 LLM-judge — re-runs the extractor prompts/schemas through a
 * stronger model and emits a `<dim>-gold.jsonl` file in the shape that
 * `compute-calibration.ts` expects to consume as gold.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R7 pivot —
 * pending Codex R7 review). Replaces the R6 single-human-rater gold
 * protocol. Independence is by capability gradient (V4 Pro reasoning
 * vs V4 Flash extractor) — NOT cross-family. Cross-family Sonnet /
 * Codex subagent judges are documented separately in
 * docs/structure-sonnet-judge-rubric.md.
 *
 * Inputs:
 *   - structure-gold/<book>/<dim>-prompts.jsonl   (from sample-for-adjudication.ts)
 *
 * Outputs:
 *   - structure-gold/<book>/<dim>-gold.jsonl       (judge labels in gold shape)
 *   - structure-gold/<book>/<dim>-judge-meta.json  (model + run metadata)
 *
 * Usage:
 *   bun scripts/corpus/llm-judge.ts \
 *     --novel salvatore-icewind-dale --book crystal_shard \
 *     --dim value-charge \
 *     [--max-prompts N]
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { extractValueCharge } from "../../src/agents/structure-value-charge"
import { extractPromises, type PromiseBeatRow } from "../../src/agents/structure-promise"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

interface Args {
  novel: string
  book: string
  dim: "value-charge" | "promise"
  maxPrompts: number | null
}

function parseArgs(): Args {
  const map: Record<string, string> = {}
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (m) map[m[1]!] = m[2]!
  }
  const novel = map["novel"]
  const book = map["book"]
  const dim = map["dim"]
  if (!novel || !book || !dim) {
    console.error("Usage: bun scripts/corpus/llm-judge.ts --novel=<key> --book=<book> --dim=<value-charge|promise> [--max-prompts=N]")
    process.exit(2)
  }
  if (dim !== "value-charge" && dim !== "promise") {
    console.error(`--dim must be one of: value-charge, promise. Got: ${dim}`)
    process.exit(2)
  }
  const maxPromptsRaw = map["max-prompts"]
  return {
    novel, book, dim,
    maxPrompts: maxPromptsRaw ? parseInt(maxPromptsRaw, 10) : null,
  }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await Bun.file(path).text()
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T)
}

async function writeJsonl<T>(path: string, rows: T[]): Promise<void> {
  await Bun.write(path, rows.map(r => JSON.stringify(r)).join("\n") + "\n")
}

interface ValueChargePrompt {
  sample_id: string
  scene_id: string
  chapter_label: string
  chapter_index: number
  scene_ordinal: number
  scene_text: string
}

interface PromisePrompt {
  sample_id: string
  chapter_index: number
  chapter_label: string
  beats: Array<{
    scene_id: string
    beat_idx: number
    summary: string
    first_sentence?: string
  }>
}

async function judgeValueCharge(args: Args, prompts: ValueChargePrompt[]) {
  // The judge needs ±1 chapter context like the extractor. Pull the
  // normalized beats so the judge sees the same surface as the
  // extractor — anything less is unfair to the comparison.
  const tmpBeatsPath = join(REPO_ROOT, "novels", args.novel, "structure-tmp", args.book, "beats.jsonl")
  const beats = await readJsonl<{ chapter: string | number; scene_id: string; beat_idx: number; summary: string; _chapter_canonical_index: number }>(tmpBeatsPath)
  const beatsByChIdx = new Map<number, typeof beats>()
  for (const b of beats) {
    const arr = beatsByChIdx.get(b._chapter_canonical_index) ?? []
    arr.push(b)
    beatsByChIdx.set(b._chapter_canonical_index, arr)
  }
  const chapterIndices = [...beatsByChIdx.keys()].sort((a, b) => a - b)

  const out: any[] = []
  let i = 0
  for (const p of prompts) {
    i++
    const chIdx = p.chapter_index
    const chPos = chapterIndices.indexOf(chIdx)
    const prevChIdx = chPos > 0 ? chapterIndices[chPos - 1] : undefined
    const nextChIdx = chPos < chapterIndices.length - 1 ? chapterIndices[chPos + 1] : undefined
    const prevChapterBeats = (prevChIdx !== undefined ? beatsByChIdx.get(prevChIdx) ?? [] : [])
      .map(b => ({ chapter: b.chapter, summary: b.summary }))
    const nextChapterBeats = (nextChIdx !== undefined ? beatsByChIdx.get(nextChIdx) ?? [] : [])
      .map(b => ({ chapter: b.chapter, summary: b.summary }))

    process.stdout.write(`  [${i}/${prompts.length}] judge ${p.scene_id} ... `)
    const result = await extractValueCharge({
      brief: {
        summary: "(judge re-tag — synthesize fresh from the prose)",
        beat_id: p.scene_id,
        chapter: p.chapter_label,
        characters: [],
        pov: null,
        setting: null,
        tone: null,
      },
      prose: p.scene_text,
      prevChapterBeats,
      nextChapterBeats,
    }, { agentName: "structure-value-charge-judge" })

    if (result.ok && result.output) {
      out.push({
        sample_id: p.sample_id,
        scene_id: p.scene_id,
        output: result.output,
      })
      console.log(`OK polarity=${result.output.polarity}`)
    } else {
      out.push({
        sample_id: p.sample_id,
        scene_id: p.scene_id,
        error: result.error ?? "unknown",
      })
      console.log(`FAIL ${result.error}`)
    }
  }
  return out
}

async function judgePromises(args: Args, prompts: PromisePrompt[]) {
  // Per R6 §2 promise gold protocol: the judge reads chapter beats fresh
  // and emits a promise list. We invoke extractPromises on the FULL
  // book's beats (re-flattening from chapter-grouped prompts) so the
  // judge sees the same cross-chapter context the extractor saw.
  const allBeats: PromiseBeatRow[] = []
  for (const p of prompts) {
    for (const b of p.beats) {
      allBeats.push({
        chapter_label: p.chapter_label,
        chapter_index: p.chapter_index,
        beat_idx: b.beat_idx,
        scene_id: b.scene_id,
        summary: b.summary,
        first_sentence: b.first_sentence,
      })
    }
  }
  // Sort canonically (chapter_index, then beat_idx within scene_id).
  allBeats.sort((a, b) => {
    if (a.chapter_index !== b.chapter_index) return a.chapter_index - b.chapter_index
    if (a.scene_id !== b.scene_id) return a.scene_id.localeCompare(b.scene_id)
    return a.beat_idx - b.beat_idx
  })

  console.log(`  [judge promise] running 2-pass on ${allBeats.length} beats via V4 Pro thinking-on`)
  const result = await extractPromises({
    novelKey: args.novel,
    bookKey: args.book,
    beats: allBeats,
  }, { agentName: "structure-promise-judge" })

  if (!result.ok) {
    console.error(`  [judge promise] FAIL: ${result.error}`)
    return []
  }
  const promises = result.promises ?? []
  console.log(`  [judge promise] OK: ${promises.length} promises identified`)

  // gold-jsonl shape per compute-calibration: {sample_id, promise_text, opened_chapter_label, opened_chapter_index, closed_chapter_label, closed_chapter_index}
  return promises.map(p => ({
    sample_id: p.promise_id,
    promise_text: p.promise_text,
    opened_chapter_label: p.opened_chapter_label,
    opened_chapter_index: p.opened_chapter_index,
    closed_chapter_label: p.closed_chapter_label,
    closed_chapter_index: p.closed_chapter_index,
    payoff_quality: p.payoff_quality,
    confidence: p.confidence,
  }))
}

async function main() {
  const args = parseArgs()
  console.log(`[llm-judge] novel=${args.novel} book=${args.book} dim=${args.dim} judge=V4 Pro`)

  const goldDir = join(REPO_ROOT, "novels", args.novel, "structure-gold", args.book)
  const promptsPath = join(goldDir, `${args.dim}-prompts.jsonl`)
  if (!existsSync(promptsPath)) {
    console.error(`[llm-judge] ${args.dim}-prompts.jsonl not found at ${promptsPath}; run sample-for-adjudication.ts first`)
    process.exit(1)
  }

  const promptsRaw = await readJsonl<any>(promptsPath)
  const prompts = args.maxPrompts !== null ? promptsRaw.slice(0, args.maxPrompts) : promptsRaw
  console.log(`[llm-judge] loaded ${promptsRaw.length} prompts (using ${prompts.length})`)

  let goldRows: any[] = []
  if (args.dim === "value-charge") {
    goldRows = await judgeValueCharge(args, prompts)
  } else {
    goldRows = await judgePromises(args, prompts)
  }

  mkdirSync(goldDir, { recursive: true })
  const goldPath = join(goldDir, `${args.dim}-gold.jsonl`)
  const metaPath = join(goldDir, `${args.dim}-judge-meta.json`)
  await writeJsonl(goldPath, goldRows)
  await Bun.write(metaPath, JSON.stringify({
    novel: args.novel,
    book: args.book,
    dim: args.dim,
    judgeAgent: args.dim === "value-charge" ? "structure-value-charge-judge" : "structure-promise-judge",
    judgeModel: "deepseek-v4-pro",
    extractorModel: "deepseek-v4-flash",
    promptsLoaded: promptsRaw.length,
    promptsJudged: prompts.length,
    goldRowsEmitted: goldRows.length,
    judgedAt: new Date().toISOString(),
    notes: "V4 Pro thinking-on as auto-judge. Independence is by capability gradient (Pro reasoning > Flash). For cross-family premium judgment, see docs/structure-sonnet-judge-rubric.md.",
  }, null, 2))
  console.log(`[llm-judge] wrote ${goldRows.length} gold rows → ${goldPath}`)
  console.log(`[llm-judge] wrote meta → ${metaPath}`)
  console.log(`[llm-judge] next: bun scripts/corpus/compute-calibration.ts --novel=${args.novel} --book=${args.book} --dim=${args.dim}`)
}

main().catch(err => {
  console.error(`[llm-judge] fatal:`, err)
  process.exit(1)
})
