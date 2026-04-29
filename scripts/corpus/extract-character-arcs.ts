#!/usr/bin/env bun
/**
 * Stage 6 driver — runs the character-arcs (Lie/Truth/Want/Need)
 * extractor against a normalized per-book bundle. Single-pass per-book.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3 + the
 * Weiland canonical Lie/Truth/Want/Need formulation captured in
 * docs/research/writing-frameworks/SYNTHESIS.md §2.3.
 *
 * Pipeline:
 *   1. Run normalize-for-structure (per-book slice + canonical sort).
 *   2. Read structure-tmp/<book>/beats.jsonl.
 *   3. Project beats → CharacterArcsBeatRow shape.
 *   4. Run extractCharacterArcs() once at the BOOK level.
 *   5. Write outputs to novels/<key>/structure/<book>/.
 *
 * Outputs:
 *   - novels/<key>/structure/<book>/character-arcs.json
 *   - novels/<key>/structure/<book>/extract-character-arcs-summary.json
 *
 * Usage:
 *   bun scripts/corpus/extract-character-arcs.ts \
 *     --novel salvatore-icewind-dale --book crystal_shard
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { normalize } from "./normalize-for-structure"
import {
  extractCharacterArcs,
  type CharacterArc, type CharacterArcsBeatRow,
} from "../../src/agents/structure-character-arcs"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

interface Args {
  novel: string
  book: string
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
    console.error("Usage: bun scripts/corpus/extract-character-arcs.ts --novel <key> --book <book>")
    process.exit(2)
  }
  return { novel, book }
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

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await Bun.file(path).text()
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T)
}

async function runCharacterArcsForBook(args: {
  novelKey: string
  bookKey: string
  beats: BeatRow[]
}): Promise<{ arcs: CharacterArc[]; error?: string }> {
  const beatsForArcs: CharacterArcsBeatRow[] = args.beats.map(b => ({
    chapter_label: String(b.chapter),
    chapter_index: b._chapter_canonical_index,
    beat_idx: b.beat_idx,
    scene_id: b.scene_id,
    summary: b.summary,
    first_sentence: b.first_sentence,
  }))
  console.log(`[extract-character-arcs] character-arcs: ${beatsForArcs.length} beats → single-pass extraction`)
  const result = await extractCharacterArcs({
    novelKey: args.novelKey,
    bookKey: args.bookKey,
    beats: beatsForArcs,
  })
  if (!result.ok) {
    console.error(`[extract-character-arcs] FAIL: ${result.error}`)
    return { arcs: [], error: result.error }
  }
  console.log(`[extract-character-arcs] OK: ${result.arcs?.length ?? 0} character arcs`)
  return { arcs: result.arcs ?? [] }
}

async function main() {
  const args = parseArgs()
  console.log(`[extract-character-arcs] novel=${args.novel} book=${args.book}`)

  // Step 1 — normalize (preflight). Pure structural; no LLM.
  console.log(`[extract-character-arcs] step 1: normalize`)
  await normalize({ novel: args.novel, book: args.book })

  // Step 2 — read normalized working files.
  const tmpDir = join(REPO_ROOT, "novels", args.novel, "structure-tmp", args.book)
  if (!existsSync(tmpDir)) throw new Error(`structure-tmp/${args.book} not found after normalize: ${tmpDir}`)
  const beats = await readJsonl<BeatRow>(join(tmpDir, "beats.jsonl"))
  console.log(`[extract-character-arcs] loaded normalized beats: ${beats.length}`)

  const outDir = join(REPO_ROOT, "novels", args.novel, "structure", args.book)
  mkdirSync(outDir, { recursive: true })

  // Step 3 — character-arcs (single pass) for the whole book
  const result = await runCharacterArcsForBook({
    novelKey: args.novel, bookKey: args.book, beats,
  })
  await Bun.write(join(outDir, "character-arcs.json"), JSON.stringify({
    novel: args.novel, book: args.book,
    arcs: result.arcs,
    error: result.error ?? null,
  }, null, 2))

  // Step 4 — summary
  const summary = {
    novel: args.novel,
    book: args.book,
    extractedAt: new Date().toISOString(),
    beatsRead: beats.length,
    arcsCount: result.arcs.length,
    arcsByResolution: result.arcs.reduce<Record<string, number>>((acc, a) => {
      acc[a.arc_resolution] = (acc[a.arc_resolution] ?? 0) + 1
      return acc
    }, {}),
    error: result.error ?? null,
  }
  await Bun.write(join(outDir, "extract-character-arcs-summary.json"), JSON.stringify(summary, null, 2))
  console.log(`[extract-character-arcs] done → ${outDir}`)
  console.log(`[extract-character-arcs] summary: ${JSON.stringify(summary, null, 2)}`)
}

main().catch(err => {
  console.error(`[extract-character-arcs] fatal:`, err)
  process.exit(1)
})
