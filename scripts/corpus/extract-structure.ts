#!/usr/bin/env bun
/**
 * Stage 6 driver — runs the value-charge + promise extractors against
 * a normalized per-book bundle. Smoke-only, hardcoded to a single book.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3 + §4.
 *
 * Pipeline:
 *   1. Run normalize-for-structure (per-book slice + canonical sort).
 *   2. Group beats → scenes for the value-charge pass.
 *   3. Run value-charge extractor PER SCENE (~139 calls for crystal_shard).
 *   4. Run promise extractor at the BOOK level (2-pass, ~2 calls total).
 *   5. Write outputs to novels/<key>/structure/<book>/.
 *
 * Outputs:
 *   - novels/<key>/structure/<book>/value-charge.jsonl
 *   - novels/<key>/structure/<book>/promises.json
 *   - novels/<key>/structure/<book>/extract-summary.json
 *
 * Usage:
 *   bun scripts/corpus/extract-structure.ts \
 *     --novel salvatore-icewind-dale --book crystal_shard \
 *     [--max-scenes N] [--skip-promise] [--skip-value-charge]
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { normalize } from "./normalize-for-structure"
import { extractValueCharge, type ValueChargeOutput } from "../../src/agents/structure-value-charge"
import { extractPromises, type FullPromise, type PromiseBeatRow } from "../../src/agents/structure-promise"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

interface Args {
  novel: string
  book: string
  maxScenes: number | null
  skipPromise: boolean
  skipValueCharge: boolean
}

function parseArgs(): Args {
  const map: Record<string, string | true> = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("--")) {
      const eq = a.indexOf("=")
      if (eq >= 0) { map[a.slice(2, eq)] = a.slice(eq + 1) }
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
        map[a.slice(2)] = argv[++i]!
      } else {
        map[a.slice(2)] = true
      }
    }
  }
  const novel = typeof map["novel"] === "string" ? map["novel"] : null
  const book = typeof map["book"] === "string" ? map["book"] : null
  if (!novel || !book) {
    console.error("Usage: bun scripts/corpus/extract-structure.ts --novel <key> --book <book> [--max-scenes N] [--skip-promise] [--skip-value-charge]")
    process.exit(2)
  }
  const maxScenesRaw = map["max-scenes"]
  const maxScenes = typeof maxScenesRaw === "string" ? Number(maxScenesRaw) : null
  return {
    novel, book,
    maxScenes: maxScenes === null || Number.isNaN(maxScenes) ? null : maxScenes,
    skipPromise: map["skip-promise"] === true,
    skipValueCharge: map["skip-value-charge"] === true,
  }
}

interface BeatRow {
  book: string
  chapter: string | number
  scene_id: string
  beat_idx: number
  summary: string
  first_sentence?: string
  text?: string
  _chapter_canonical_index: number
  _scene_ordinal: number
  [key: string]: unknown
}

interface SceneRow {
  book: string
  chapter: string | number
  scene_id: string
  scene_idx: number
  text: string
  _chapter_canonical_index: number
  _scene_ordinal: number
}

interface PairRow {
  brief: {
    book: string
    chapter: string | number
    scene_id: string
    summary: string
    characters?: string[]
    pov?: string | null
    setting?: string | null
    tone?: string | null
  }
  prose: unknown
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await Bun.file(path).text()
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T)
}

async function writeJsonl<T>(path: string, rows: T[]): Promise<void> {
  await Bun.write(path, rows.map(r => JSON.stringify(r)).join("\n") + "\n")
}

interface SceneTagOut {
  scene_id: string
  chapter_label: string
  chapter_index: number
  scene_ordinal: number
  output: ValueChargeOutput
  attempts: number
  ok: true
}

interface SceneTagFail {
  scene_id: string
  chapter_label: string
  chapter_index: number
  scene_ordinal: number
  error: string
  ok: false
}

type SceneTag = SceneTagOut | SceneTagFail

async function runValueChargeForBook(args: {
  bookKey: string
  scenes: SceneRow[]
  beats: BeatRow[]
  pairs: PairRow[]
  maxScenes: number | null
}): Promise<SceneTag[]> {
  const { scenes, beats, pairs, maxScenes } = args

  // Group beats by chapter for fast prev/next lookup. Beats are
  // already canonically ordered from the preflight; chapter buckets
  // preserve that.
  const beatsByChIndex = new Map<number, BeatRow[]>()
  for (const b of beats) {
    const arr = beatsByChIndex.get(b._chapter_canonical_index) ?? []
    arr.push(b)
    beatsByChIndex.set(b._chapter_canonical_index, arr)
  }
  const chapterIndices = [...beatsByChIndex.keys()].sort((a, b) => a - b)

  // Group pairs by scene_id so we can synthesize a scene-level brief
  // from per-beat briefs.
  const pairsByScene = new Map<string, PairRow[]>()
  for (const p of pairs) {
    const arr = pairsByScene.get(p.brief.scene_id) ?? []
    arr.push(p)
    pairsByScene.set(p.brief.scene_id, arr)
  }

  const targetScenes = maxScenes !== null ? scenes.slice(0, maxScenes) : scenes
  console.log(`[extract-structure] value-charge: ${targetScenes.length} scenes`)

  const out: SceneTag[] = []
  let i = 0
  for (const s of targetScenes) {
    i++
    const sceneId = s.scene_id
    const scenePairs = pairsByScene.get(sceneId) ?? []
    // Synthesize a scene-level brief by joining beat summaries.
    const summaryParts = scenePairs.map(p => p.brief.summary).filter(Boolean)
    const characterSet = new Set<string>()
    for (const p of scenePairs) for (const c of p.brief.characters ?? []) characterSet.add(c)
    const firstBrief = scenePairs[0]?.brief
    const brief = {
      summary: summaryParts.join(" / "),
      beat_id: sceneId,
      chapter: s.chapter,
      characters: [...characterSet],
      pov: firstBrief?.pov ?? null,
      setting: firstBrief?.setting ?? null,
      tone: firstBrief?.tone ?? null,
    }

    // Build ±1 chapter context from beat summaries.
    const chIdx = s._chapter_canonical_index
    const prevChIdx = chapterIndices.find((x, idx, arr) => arr[idx + 1] === chIdx)
    const nextChIdx = chapterIndices[chapterIndices.indexOf(chIdx) + 1]
    const prevChapterBeats = (prevChIdx !== undefined ? beatsByChIndex.get(prevChIdx) ?? [] : [])
      .map(b => ({ chapter: b.chapter, summary: b.summary }))
    const nextChapterBeats = (nextChIdx !== undefined ? beatsByChIndex.get(nextChIdx) ?? [] : [])
      .map(b => ({ chapter: b.chapter, summary: b.summary }))

    process.stdout.write(`  [${i}/${targetScenes.length}] ${sceneId} ... `)
    let attempts = 0
    let result = await extractValueCharge({
      brief, prose: s.text,
      prevChapterBeats, nextChapterBeats,
    })
    attempts++
    if (!result.ok) {
      // single retry — schemas mismatches happen on V4 Flash with
      // lower-temp prompts.
      result = await extractValueCharge({
        brief, prose: s.text, prevChapterBeats, nextChapterBeats,
      })
      attempts++
    }
    if (result.ok && result.output) {
      out.push({
        scene_id: sceneId,
        chapter_label: String(s.chapter),
        chapter_index: chIdx,
        scene_ordinal: s._scene_ordinal,
        output: result.output,
        attempts,
        ok: true,
      })
      console.log(`OK  polarity=${result.output.polarity} conf=${result.output.confidence.toFixed(2)} attempts=${attempts}`)
    } else {
      out.push({
        scene_id: sceneId,
        chapter_label: String(s.chapter),
        chapter_index: chIdx,
        scene_ordinal: s._scene_ordinal,
        error: result.error ?? "unknown",
        ok: false,
      })
      console.log(`FAIL ${result.error}`)
    }
  }
  return out
}

async function runPromiseForBook(args: {
  novelKey: string
  bookKey: string
  beats: BeatRow[]
}): Promise<{ promises: FullPromise[]; openOnlyCount: number; closuresCount: number; error?: string }> {
  const beatsForPromise: PromiseBeatRow[] = args.beats.map(b => ({
    chapter_label: String(b.chapter),
    chapter_index: b._chapter_canonical_index,
    beat_idx: b.beat_idx,
    scene_id: b.scene_id,
    summary: b.summary,
    first_sentence: b.first_sentence,
  }))
  console.log(`[extract-structure] promise: ${beatsForPromise.length} beats → 2-pass extraction`)
  const result = await extractPromises({
    novelKey: args.novelKey,
    bookKey: args.bookKey,
    beats: beatsForPromise,
  })
  if (!result.ok) {
    console.error(`[extract-structure] promise FAIL: ${result.error}`)
    return { promises: [], openOnlyCount: result.openOnly?.length ?? 0, closuresCount: 0, error: result.error }
  }
  console.log(`[extract-structure] promise OK: open=${result.openOnly?.length ?? 0}, closures=${result.closures?.length ?? 0}, merged=${result.promises?.length ?? 0}`)
  return {
    promises: result.promises ?? [],
    openOnlyCount: result.openOnly?.length ?? 0,
    closuresCount: result.closures?.length ?? 0,
  }
}

async function main() {
  const args = parseArgs()
  console.log(`[extract-structure] novel=${args.novel} book=${args.book}`)

  // Step 1 — normalize (preflight). Pure structural; no LLM.
  console.log(`[extract-structure] step 1: normalize`)
  await normalize({ novel: args.novel, book: args.book })

  // Step 2 — read normalized working files.
  const tmpDir = join(REPO_ROOT, "novels", args.novel, "structure-tmp", args.book)
  if (!existsSync(tmpDir)) throw new Error(`structure-tmp/${args.book} not found after normalize: ${tmpDir}`)
  const beats = await readJsonl<BeatRow>(join(tmpDir, "beats.jsonl"))
  const scenes = await readJsonl<SceneRow>(join(tmpDir, "scenes.jsonl"))
  const pairs = await readJsonl<PairRow>(join(tmpDir, "pairs.jsonl"))
  console.log(`[extract-structure] loaded normalized files: beats=${beats.length} scenes=${scenes.length} pairs=${pairs.length}`)

  const outDir = join(REPO_ROOT, "novels", args.novel, "structure", args.book)
  mkdirSync(outDir, { recursive: true })

  // Step 3 — value-charge per scene
  let valueChargeTags: SceneTag[] = []
  if (!args.skipValueCharge) {
    valueChargeTags = await runValueChargeForBook({
      bookKey: args.book,
      scenes, beats, pairs,
      maxScenes: args.maxScenes,
    })
    await writeJsonl(join(outDir, "value-charge.jsonl"), valueChargeTags)
  } else {
    console.log(`[extract-structure] step 3 (value-charge) skipped per --skip-value-charge`)
  }

  // Step 4 — promise (2-pass) for the whole book
  let promiseResult: { promises: FullPromise[]; openOnlyCount: number; closuresCount: number; error?: string } = {
    promises: [], openOnlyCount: 0, closuresCount: 0,
  }
  if (!args.skipPromise) {
    promiseResult = await runPromiseForBook({
      novelKey: args.novel, bookKey: args.book, beats,
    })
    await Bun.write(join(outDir, "promises.json"), JSON.stringify({
      novel: args.novel, book: args.book,
      promises: promiseResult.promises,
      openOnlyCount: promiseResult.openOnlyCount,
      closuresCount: promiseResult.closuresCount,
      error: promiseResult.error ?? null,
    }, null, 2))
  } else {
    console.log(`[extract-structure] step 4 (promise) skipped per --skip-promise`)
  }

  // Step 5 — summary
  const summary = {
    novel: args.novel,
    book: args.book,
    extractedAt: new Date().toISOString(),
    scenesProcessed: valueChargeTags.length,
    valueChargeOk: valueChargeTags.filter(t => t.ok).length,
    valueChargeFail: valueChargeTags.filter(t => !t.ok).length,
    promiseOpenCount: promiseResult.openOnlyCount,
    promiseClosureCount: promiseResult.closuresCount,
    promiseMerged: promiseResult.promises.length,
    promiseError: promiseResult.error ?? null,
  }
  await Bun.write(join(outDir, "extract-summary.json"), JSON.stringify(summary, null, 2))
  console.log(`[extract-structure] done → ${outDir}`)
  console.log(`[extract-structure] summary: ${JSON.stringify(summary, null, 2)}`)
}

main().catch(err => {
  console.error(`[extract-structure] fatal:`, err)
  process.exit(1)
})
