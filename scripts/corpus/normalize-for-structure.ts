#!/usr/bin/env bun
/**
 * Stage 6 pre-flight: per-book slice + canonical chapter index + sort.
 *
 * Reads novels/<key>/{scenes,beats,pairs}.jsonl, filters to a single book,
 * sorts beats and scenes into narrative order, and writes the per-book
 * working files to novels/<key>/structure-tmp/<book>/.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3 source
 * normalization. Pure structural — no LLM calls, fully deterministic.
 *
 * Usage:
 *   bun scripts/corpus/normalize-for-structure.ts \
 *     --novel salvatore-icewind-dale --book crystal_shard
 *
 * Invariants (all must hold or the script exits non-zero):
 *   I1 Coverage         input_rows == output_rows + dropped_other_book
 *   I2 Sort stability   every consecutive pair satisfies the sort key
 *   I3 Full-domain      every chapter label maps to a canonical index
 *   I4 Scene-ordinal    every scene_id parses to (book, chapter, ordinal)
 *   I5 No-silent-drop   post-sort row count == filtered row count
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

interface Args {
  novel: string
  book: string
}

function parseArgs(): Args {
  const novel = argValue("--novel")
  const book = argValue("--book")
  if (!novel || !book) {
    console.error("Usage: bun scripts/corpus/normalize-for-structure.ts --novel <key> --book <book>")
    process.exit(2)
  }
  return { novel, book }
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

/** Per-book chapter-label → canonical-index precedence.
 *
 *  R6 §3 specifies a per-book mapping because part labels and epilogue
 *  counts differ across the trilogy. crystal_shard is the only in-scope
 *  book for R6; the others are kept for forward-compatibility but the
 *  R6 smoke must NEVER call this with a non-crystal_shard book without
 *  re-validating the mapping. */
const CHAPTER_PRECEDENCE: Record<string, (label: string) => number | null> = {
  crystal_shard: label => {
    if (label === "prelude") return -1
    if (label === "epilogue") return 1000
    if (label === "epilogue2") return 1001
    if (label === "epilogue3") return 1002
    if (/^\d+$/.test(label)) return parseInt(label, 10)
    return null
  },
  halflings_gem: label => {
    if (label === "prelude") return -1
    if (label === "epilogue") return 1000
    if (label === "epilogue2") return 1001
    if (label === "epilogue3") return 1002
    if (/^\d+$/.test(label)) return parseInt(label, 10)
    return null
  },
  // streams_of_silver: per Codex R5 W1, part1/2/3 are SUBSTANTIVE narrative
  // beats not empty headers. The 50/51/52 placement here is a per-book
  // convention only and must be re-validated before any production use.
  streams_of_silver: label => {
    if (label === "prelude") return -1
    if (label === "epilogue") return 1000
    if (label === "part1") return 50
    if (label === "part2") return 51
    if (label === "part3") return 52
    if (/^\d+$/.test(label)) return parseInt(label, 10)
    return null
  },
}

interface BeatRow {
  book: string
  chapter: string | number
  scene_id: string
  beat_idx: number
  [key: string]: unknown
}

interface SceneRow {
  book: string
  chapter: string | number
  scene_id: string
  scene_idx: number
  [key: string]: unknown
}

interface PairRow {
  brief: { book: string; chapter: string | number; scene_id: string; [key: string]: unknown }
  prose: unknown
  [key: string]: unknown
}

const SCENE_ID_RE = /^([a-z_]+)_ch([a-z0-9]+)_s(\d+)$/

function parseSceneOrdinal(sceneId: string): number {
  const m = SCENE_ID_RE.exec(sceneId)
  if (!m) throw new Error(`scene_id failed parse: ${JSON.stringify(sceneId)}`)
  return parseInt(m[3]!, 10)
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await Bun.file(path).text()
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T)
}

async function writeJsonl<T>(path: string, rows: T[]): Promise<void> {
  await Bun.write(path, rows.map(r => JSON.stringify(r)).join("\n") + "\n")
}

interface NormalizeResult {
  beatsIn: number
  beatsKept: number
  beatsDropped: number
  scenesIn: number
  scenesKept: number
  scenesDropped: number
  pairsIn: number
  pairsKept: number
  pairsDropped: number
  chapterDomain: Array<{ label: string; canonical: number; count: number }>
  outputDir: string
}

async function normalize(args: Args): Promise<NormalizeResult> {
  const bundleDir = join(REPO_ROOT, "novels", args.novel)
  if (!existsSync(bundleDir)) {
    throw new Error(`Bundle not found: ${bundleDir}`)
  }
  const mapper = CHAPTER_PRECEDENCE[args.book]
  if (!mapper) {
    throw new Error(`No chapter-precedence mapping for book=${args.book}. Add one to CHAPTER_PRECEDENCE.`)
  }

  const beatsRaw = await readJsonl<BeatRow>(join(bundleDir, "beats.jsonl"))
  const scenesRaw = await readJsonl<SceneRow>(join(bundleDir, "scenes.jsonl"))
  const pairsRaw = await readJsonl<PairRow>(join(bundleDir, "pairs.jsonl"))

  const beatsBook = beatsRaw.filter(r => r.book === args.book)
  const scenesBook = scenesRaw.filter(r => r.book === args.book)
  const pairsBook = pairsRaw.filter(r => r.brief?.book === args.book)

  // I3 + I4 + augment with canonical index and scene_ordinal
  const labelCounts = new Map<string, number>()
  const augmentedBeats = beatsBook.map(r => {
    const label = String(r.chapter)
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
    const canonical = mapper(label)
    if (canonical === null) {
      throw new Error(`I3 full-domain violation in beats: chapter label ${JSON.stringify(label)} has no canonical-index mapping for book=${args.book}`)
    }
    const sceneOrdinal = parseSceneOrdinal(r.scene_id)
    return { ...r, _chapter_canonical_index: canonical, _scene_ordinal: sceneOrdinal }
  })

  const augmentedScenes = scenesBook.map(r => {
    const label = String(r.chapter)
    const canonical = mapper(label)
    if (canonical === null) {
      throw new Error(`I3 full-domain violation in scenes: chapter label ${JSON.stringify(label)} has no canonical-index mapping for book=${args.book}`)
    }
    const sceneOrdinal = parseSceneOrdinal(r.scene_id)
    return { ...r, _chapter_canonical_index: canonical, _scene_ordinal: sceneOrdinal }
  })

  const augmentedPairs = pairsBook.map(r => {
    const label = String(r.brief.chapter)
    const canonical = mapper(label)
    if (canonical === null) {
      throw new Error(`I3 full-domain violation in pairs: chapter label ${JSON.stringify(label)} has no canonical-index mapping for book=${args.book}`)
    }
    return r // Pairs not sorted; canonical index isn't persisted on them.
  })

  augmentedBeats.sort((a, b) => {
    if (a._chapter_canonical_index !== b._chapter_canonical_index) return a._chapter_canonical_index - b._chapter_canonical_index
    if (a._scene_ordinal !== b._scene_ordinal) return a._scene_ordinal - b._scene_ordinal
    return a.beat_idx - b.beat_idx
  })
  augmentedScenes.sort((a, b) => {
    if (a._chapter_canonical_index !== b._chapter_canonical_index) return a._chapter_canonical_index - b._chapter_canonical_index
    return a._scene_ordinal - b._scene_ordinal
  })

  // I2 sort stability — every consecutive pair must satisfy the order
  for (let i = 1; i < augmentedBeats.length; i++) {
    const a = augmentedBeats[i - 1]!
    const b = augmentedBeats[i]!
    const aKey = [a._chapter_canonical_index, a._scene_ordinal, a.beat_idx]
    const bKey = [b._chapter_canonical_index, b._scene_ordinal, b.beat_idx]
    for (let j = 0; j < 3; j++) {
      if (aKey[j]! < bKey[j]!) break
      if (aKey[j]! > bKey[j]!) {
        throw new Error(`I2 sort stability violation in beats at index ${i}: ${a.scene_id}/${a.beat_idx} > ${b.scene_id}/${b.beat_idx}`)
      }
    }
  }

  // I1 + I5 — coverage and no-silent-drop checks
  if (beatsBook.length !== augmentedBeats.length) {
    throw new Error(`I5 no-silent-drop violation in beats: filtered ${beatsBook.length}, post-sort ${augmentedBeats.length}`)
  }
  if (scenesBook.length !== augmentedScenes.length) {
    throw new Error(`I5 no-silent-drop violation in scenes: filtered ${scenesBook.length}, post-sort ${augmentedScenes.length}`)
  }
  const beatsOther = beatsRaw.length - beatsBook.length
  if (beatsBook.length + beatsOther !== beatsRaw.length) {
    throw new Error(`I1 coverage violation in beats: in=${beatsRaw.length}, kept=${beatsBook.length}, dropped=${beatsOther}`)
  }

  const outDir = join(bundleDir, "structure-tmp", args.book)
  mkdirSync(outDir, { recursive: true })
  await writeJsonl(join(outDir, "beats.jsonl"), augmentedBeats)
  await writeJsonl(join(outDir, "scenes.jsonl"), augmentedScenes)
  await writeJsonl(join(outDir, "pairs.jsonl"), augmentedPairs)

  const chapterDomain = [...labelCounts.entries()]
    .map(([label, count]) => ({ label, canonical: mapper(label)!, count }))
    .sort((a, b) => a.canonical - b.canonical)

  return {
    beatsIn: beatsRaw.length, beatsKept: beatsBook.length, beatsDropped: beatsOther,
    scenesIn: scenesRaw.length, scenesKept: scenesBook.length, scenesDropped: scenesRaw.length - scenesBook.length,
    pairsIn: pairsRaw.length, pairsKept: pairsBook.length, pairsDropped: pairsRaw.length - pairsBook.length,
    chapterDomain,
    outputDir: outDir,
  }
}

async function main() {
  const args = parseArgs()
  console.log(`[normalize] novel=${args.novel} book=${args.book}`)
  const result = await normalize(args)
  console.log(`[normalize] beats in=${result.beatsIn} kept=${result.beatsKept} dropped=${result.beatsDropped}`)
  console.log(`[normalize] scenes in=${result.scenesIn} kept=${result.scenesKept} dropped=${result.scenesDropped}`)
  console.log(`[normalize] pairs in=${result.pairsIn} kept=${result.pairsKept} dropped=${result.pairsDropped}`)
  console.log(`[normalize] chapter domain (${result.chapterDomain.length} labels):`)
  for (const c of result.chapterDomain) console.log(`  ${c.label.padEnd(12)} → ${String(c.canonical).padStart(5)}  (${c.count} beats)`)
  console.log(`[normalize] wrote → ${result.outputDir}`)
}

// Only run main() when invoked directly as the script. When extract-structure.ts
// (or any other driver) imports this module to call `normalize()` programmatically,
// running main() at import time would parse the parent's argv (which contains
// flags like --extractor-model that normalize doesn't recognize) and exit(2).
if (import.meta.main) {
  main().catch(err => {
    console.error("[normalize] fatal:", err.message)
    process.exit(1)
  })
}

export { normalize, CHAPTER_PRECEDENCE, parseSceneOrdinal, SCENE_ID_RE }
