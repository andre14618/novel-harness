#!/usr/bin/env bun

/**
 * conditioning-floor-pair-builder.ts
 *
 * Pre-registration step for the salvatore-distinctness-conditioning-floor A/B pilot.
 * Reads chapter_outlines for a source novel, filters to dialogue beats with
 * >=2 characters present, stratifies across chapters up to --max-beats, and
 * emits a JSONL of pre-registered beats.
 *
 * Pre-registration closes the post-hoc matched-pair selection problem described
 * in docs/charters/salvatore-distinctness-conditioning-floor.md §7.
 *
 * Usage:
 *   bun scripts/evals/conditioning-floor-pair-builder.ts \
 *     --source <novel-id> \
 *     [--out output/evals/conditioning-floor-pairs.jsonl] \
 *     [--max-beats 20]
 */

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import db from "../../src/db/connection"

// ── Types ────────────────────────────────────────────────────────────────────

type RawSceneBeat = {
  kind: string
  characters: string[]
  description: string
  requiredPayoffs?: unknown[]
}

type RawChapterOutline = {
  chapterNumber: number
  povCharacter?: string
  scenes?: RawSceneBeat[]
}

export type EligibleBeat = {
  chapter_number: number
  beat_index_in_chapter: number
  pov_character: string
  characters_present: string[]
  kind: string
  description: string
}

export type PairEntry = {
  novel_id_source: string
  chapter_number: number
  beat_index_in_chapter: number
  global_beat_index: number
  pov_character: string
  characters_present: string[]
  kind: string
  description: string
}

// ── Eligibility filter ───────────────────────────────────────────────────────

/**
 * Returns true when a beat is eligible for the conditioning-floor A/B:
 * - kind must be "dialogue"
 * - characters_present.length must be >= 2
 *
 * Exported for unit testing.
 */
export function isEligible(beat: { kind: string; characters_present: string[] }): boolean {
  return beat.kind === "dialogue" && beat.characters_present.length >= 2
}

// ── Stratification ───────────────────────────────────────────────────────────

/**
 * Stratify `beats` across chapters with round-robin selection so that the cap
 * is spread evenly across all chapters represented.
 *
 * Round-robin: iterate through each unique chapter in chapter-number order,
 * picking one beat at a time per chapter until we reach the cap or exhaust all.
 *
 * Exported for unit testing.
 */
export function stratifyBeats(beats: EligibleBeat[], cap: number): EligibleBeat[] {
  if (beats.length <= cap) return [...beats]

  // Group by chapter, preserving insertion order
  const byChapter = new Map<number, EligibleBeat[]>()
  for (const beat of beats) {
    let bucket = byChapter.get(beat.chapter_number)
    if (!bucket) {
      bucket = []
      byChapter.set(beat.chapter_number, bucket)
    }
    bucket.push(beat)
  }

  const chapters = [...byChapter.keys()].sort((a, b) => a - b)
  const pointers = new Map<number, number>(chapters.map((ch) => [ch, 0]))
  const selected: EligibleBeat[] = []

  // Round-robin across chapters
  while (selected.length < cap) {
    let anyPicked = false
    for (const ch of chapters) {
      if (selected.length >= cap) break
      const bucket = byChapter.get(ch)!
      const ptr = pointers.get(ch)!
      if (ptr < bucket.length) {
        selected.push(bucket[ptr])
        pointers.set(ch, ptr + 1)
        anyPicked = true
      }
    }
    if (!anyPicked) break // all exhausted
  }

  return selected
}

// ── DB query ─────────────────────────────────────────────────────────────────

type OutlineRow = {
  chapter_number: number
  outline_json: RawChapterOutline
}

async function fetchOutlines(novelId: string): Promise<OutlineRow[]> {
  const rows = await db<OutlineRow[]>`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  `
  return rows
}

// ── Outline parsing ───────────────────────────────────────────────────────────

/**
 * Parse a single chapter outline row into a list of eligible beats.
 * Warns (to stderr) and skips any row where the expected shape is missing.
 * Returns `null` if the outline cannot be parsed at all.
 */
function parseChapterBeats(row: OutlineRow): EligibleBeat[] | null {
  const outline = row.outline_json

  if (!outline || typeof outline !== "object") {
    console.warn(`  [warn] chapter ${row.chapter_number}: outline_json is not an object — skipping`)
    return null
  }

  if (!Array.isArray(outline.scenes)) {
    console.warn(`  [warn] chapter ${row.chapter_number}: outline_json.scenes is missing or not an array — skipping`)
    return null
  }

  const povCharacter = typeof outline.povCharacter === "string" ? outline.povCharacter : ""

  const beats: EligibleBeat[] = []
  for (let i = 0; i < outline.scenes.length; i++) {
    const scene = outline.scenes[i]
    if (!scene || typeof scene !== "object") {
      console.warn(`  [warn] chapter ${row.chapter_number} beat ${i}: scene is not an object — skipping`)
      continue
    }
    if (typeof scene.kind !== "string") {
      console.warn(`  [warn] chapter ${row.chapter_number} beat ${i}: missing "kind" field — skipping beat`)
      continue
    }
    if (!Array.isArray(scene.characters)) {
      console.warn(`  [warn] chapter ${row.chapter_number} beat ${i}: missing "characters" array — skipping beat`)
      continue
    }
    if (typeof scene.description !== "string") {
      console.warn(`  [warn] chapter ${row.chapter_number} beat ${i}: missing "description" field — skipping beat`)
      continue
    }

    beats.push({
      chapter_number: row.chapter_number,
      beat_index_in_chapter: i,
      pov_character: povCharacter,
      characters_present: scene.characters,
      kind: scene.kind,
      description: scene.description,
    })
  }

  return beats
}

// ── CLI arg parsing ───────────────────────────────────────────────────────────

type ParsedArgs = {
  sourceNovelId: string
  outPath: string
  maxBeats: number
}

function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag)
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "usage: bun scripts/evals/conditioning-floor-pair-builder.ts\n" +
      "  --source <novel-id>        source novel whose frozen plan to read\n" +
      "  [--out <path>]             JSONL output path (default: output/evals/conditioning-floor-pairs.jsonl)\n" +
      "  [--max-beats <n>]          cap on total beats to pre-register (default: 20)\n"
    )
    process.exit(0)
  }

  const sourceNovelId = get("--source")
  if (!sourceNovelId) {
    console.error("error: --source <novel-id> is required")
    console.error("usage: bun scripts/evals/conditioning-floor-pair-builder.ts --source <novel-id>")
    process.exit(1)
  }

  const outPath = get("--out") ?? "output/evals/conditioning-floor-pairs.jsonl"
  const maxBeatsRaw = get("--max-beats")
  const maxBeats = maxBeatsRaw !== undefined ? Number.parseInt(maxBeatsRaw, 10) : 20

  if (maxBeatsRaw !== undefined && (!Number.isInteger(maxBeats) || maxBeats < 1)) {
    console.error(`error: --max-beats must be a positive integer, got ${maxBeatsRaw}`)
    process.exit(1)
  }

  return { sourceNovelId, outPath, maxBeats }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function buildConditioningFloorPairs(args: ParsedArgs): Promise<PairEntry[]> {
  const { sourceNovelId, outPath, maxBeats } = args

  // 1. Query chapter_outlines
  console.log(`Fetching chapter outlines for novel: ${sourceNovelId}`)
  const rows = await fetchOutlines(sourceNovelId)

  if (rows.length === 0) {
    console.error(`error: no chapter_outlines rows found for novel_id="${sourceNovelId}"`)
    console.error("Check that the novel_id is correct and that drafting has completed.")
    process.exit(1)
  }
  console.log(`  Found ${rows.length} chapter outline(s)`)

  // 2. Parse and flatten beats
  let totalBeats = 0
  const skippedChapters: number[] = []
  const allBeats: EligibleBeat[] = []

  for (const row of rows) {
    const beats = parseChapterBeats(row)
    if (beats === null) {
      skippedChapters.push(row.chapter_number)
      continue
    }
    totalBeats += beats.length
    allBeats.push(...beats)
  }

  if (skippedChapters.length > 0) {
    console.warn(`  [warn] Skipped ${skippedChapters.length} chapter(s) with bad schema: ${skippedChapters.join(", ")}`)
  }

  console.log(`  Total beats across all parsed chapters: ${totalBeats}`)

  // 3. Filter to eligible beats
  const eligible = allBeats.filter(isEligible)
  console.log(`  Eligible (dialogue + >=2 characters): ${eligible.length}`)

  // Charter §8: stop if fewer than 10 eligible beats
  if (eligible.length < 10) {
    console.error(`\nerror: only ${eligible.length} eligible beats found — charter §8 requires >=10 to proceed.`)
    console.error("Ensure the source novel has enough dialogue beats with multiple characters before running the pilot.")
    process.exit(1)
  }

  // 4. Stratify across chapters
  const selected = stratifyBeats(eligible, maxBeats)
  console.log(`  Selected (after stratification, cap=${maxBeats}): ${selected.length}`)

  // 5. Assign global beat indexes and build output
  const pairs: PairEntry[] = selected.map((beat, idx) => ({
    novel_id_source: sourceNovelId,
    chapter_number: beat.chapter_number,
    beat_index_in_chapter: beat.beat_index_in_chapter,
    global_beat_index: idx,
    pov_character: beat.pov_character,
    characters_present: beat.characters_present,
    kind: beat.kind,
    description: beat.description,
  }))

  // 6. Write JSONL
  const resolvedOut = path.resolve(outPath)
  await mkdir(path.dirname(resolvedOut), { recursive: true })
  const jsonl = pairs.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
  await writeFile(resolvedOut, jsonl, "utf8")

  // 7. Summary
  const chapterDistribution = new Map<number, number>()
  for (const p of pairs) {
    chapterDistribution.set(p.chapter_number, (chapterDistribution.get(p.chapter_number) ?? 0) + 1)
  }

  console.log("\n── Summary ────────────────────────────────────────────────")
  console.log(`  Chapter outlines read:           ${rows.length}`)
  console.log(`  Total beats parsed:              ${totalBeats}`)
  console.log(`  Eligible (dialogue >=2 chars):   ${eligible.length}`)
  console.log(`  Selected for pre-registration:   ${selected.length}`)
  console.log(`  Output path:                     ${resolvedOut}`)
  console.log("  Distribution across chapters:")
  for (const [ch, count] of [...chapterDistribution.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    Chapter ${ch}: ${count} beat(s)`)
  }
  console.log("────────────────────────────────────────────────────────────")

  return pairs
}

async function main() {
  const args = parseArgs()
  await buildConditioningFloorPairs(args)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(1)
  })
}
