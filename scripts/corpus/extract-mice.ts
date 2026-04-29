#!/usr/bin/env bun
/**
 * Stage 6 driver — runs the MICE per-scene extractor against a normalized
 * per-book bundle. Standalone driver paralleling extract-structure.ts;
 * lives separately because Bucket 1 of the corpus-structural-decomposition
 * charter ships its dim agents one at a time and each gets its own driver
 * for cleaner cost / verdict accounting.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3 + §4 +
 * docs/research/writing-frameworks/SYNTHESIS.md §1 "Sanderson MICE-as-
 * balanced-parens."
 *
 * Pipeline:
 *   1. Run normalize-for-structure (per-book slice + canonical sort).
 *   2. Group beats → scenes for the per-scene MICE pass.
 *   3. Run MICE extractor PER SCENE (~139 calls for crystal_shard).
 *   4. Write outputs to novels/<key>/structure/<book>/mice.jsonl.
 *
 * Outputs:
 *   - novels/<key>/structure/<book>/mice.jsonl
 *   - novels/<key>/structure/<book>/extract-mice-summary.json
 *
 * Usage:
 *   bun scripts/corpus/extract-mice.ts \
 *     --novel salvatore-icewind-dale --book crystal_shard \
 *     [--max-scenes N]
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { normalize } from "./normalize-for-structure"
import { extractMice, type MiceOutput } from "../../src/agents/structure-mice"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

interface Args {
  novel: string
  book: string
  maxScenes: number | null
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
    console.error("Usage: bun scripts/corpus/extract-mice.ts --novel <key> --book <book> [--max-scenes N]")
    process.exit(2)
  }
  const maxScenesRaw = map["max-scenes"]
  const maxScenes = typeof maxScenesRaw === "string" ? Number(maxScenesRaw) : null
  return {
    novel, book,
    maxScenes: maxScenes === null || Number.isNaN(maxScenes) ? null : maxScenes,
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

interface MiceTagOk {
  scene_id: string
  chapter_label: string
  chapter_index: number
  scene_ordinal: number
  output: MiceOutput
  attempts: number
  ok: true
}

interface MiceTagFail {
  scene_id: string
  chapter_label: string
  chapter_index: number
  scene_ordinal: number
  error: string
  ok: false
}

type MiceTag = MiceTagOk | MiceTagFail

async function runMiceForBook(args: {
  bookKey: string
  scenes: SceneRow[]
  beats: BeatRow[]
  pairs: PairRow[]
  maxScenes: number | null
}): Promise<MiceTag[]> {
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
  console.log(`[extract-mice] scenes to tag: ${targetScenes.length}`)

  const out: MiceTag[] = []
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
    let result = await extractMice({
      brief, prose: s.text,
      prevChapterBeats, nextChapterBeats,
    })
    attempts++
    if (!result.ok) {
      // single retry — schema mismatches happen on V4 Flash with
      // lower-temp prompts.
      result = await extractMice({
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
      const sec = result.output.secondary_thread ?? "-"
      const oc = `${result.output.opens_thread ? "O" : "."}${result.output.closes_thread ? "C" : "."}`
      console.log(`OK  ${result.output.primary_thread}/${sec} ${oc} conf=${result.output.confidence.toFixed(2)} attempts=${attempts}`)
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

async function main() {
  const args = parseArgs()
  console.log(`[extract-mice] novel=${args.novel} book=${args.book}`)

  // Step 1 — normalize (preflight). Pure structural; no LLM.
  console.log(`[extract-mice] step 1: normalize`)
  await normalize({ novel: args.novel, book: args.book })

  // Step 2 — read normalized working files.
  const tmpDir = join(REPO_ROOT, "novels", args.novel, "structure-tmp", args.book)
  if (!existsSync(tmpDir)) throw new Error(`structure-tmp/${args.book} not found after normalize: ${tmpDir}`)
  const beats = await readJsonl<BeatRow>(join(tmpDir, "beats.jsonl"))
  const scenes = await readJsonl<SceneRow>(join(tmpDir, "scenes.jsonl"))
  const pairs = await readJsonl<PairRow>(join(tmpDir, "pairs.jsonl"))
  console.log(`[extract-mice] loaded normalized files: beats=${beats.length} scenes=${scenes.length} pairs=${pairs.length}`)

  const outDir = join(REPO_ROOT, "novels", args.novel, "structure", args.book)
  mkdirSync(outDir, { recursive: true })

  // Step 3 — MICE per scene
  const miceTags = await runMiceForBook({
    bookKey: args.book,
    scenes, beats, pairs,
    maxScenes: args.maxScenes,
  })
  await writeJsonl(join(outDir, "mice.jsonl"), miceTags)

  // Step 4 — summary
  const okTags = miceTags.filter((t): t is MiceTagOk => t.ok)
  const threadCounts = { M: 0, I: 0, C: 0, E: 0 }
  let opens = 0
  let closes = 0
  let secondarySet = 0
  for (const t of okTags) {
    threadCounts[t.output.primary_thread]++
    if (t.output.opens_thread) opens++
    if (t.output.closes_thread) closes++
    if (t.output.secondary_thread !== null) secondarySet++
  }

  const summary = {
    novel: args.novel,
    book: args.book,
    extractedAt: new Date().toISOString(),
    scenesProcessed: miceTags.length,
    miceOk: okTags.length,
    miceFail: miceTags.filter(t => !t.ok).length,
    primaryThreadCounts: threadCounts,
    opensCount: opens,
    closesCount: closes,
    secondaryThreadCount: secondarySet,
  }
  await Bun.write(join(outDir, "extract-mice-summary.json"), JSON.stringify(summary, null, 2))
  console.log(`[extract-mice] done → ${outDir}`)
  console.log(`[extract-mice] summary: ${JSON.stringify(summary, null, 2)}`)
}

main().catch(err => {
  console.error(`[extract-mice] fatal:`, err)
  process.exit(1)
})
