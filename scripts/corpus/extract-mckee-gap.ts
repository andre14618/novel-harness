#!/usr/bin/env bun
/**
 * Stage 6 driver — runs the McKee Gap extractor against a normalized
 * per-book bundle. Per-beat scope (the value-charge driver is
 * per-scene; this one is per-beat), so the call volume is roughly
 * 6× higher (~858 beats vs ~139 scenes on crystal_shard).
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3 +
 * docs/research/writing-frameworks/SYNTHESIS.md §2.5 + §1 exec
 * summary (McKee Gap as the cheap-LLM-detectable per-beat change
 * signal).
 *
 * Pipeline:
 *   1. Run normalize-for-structure (per-book slice + canonical sort).
 *   2. Read structure-tmp/<book>/beats.jsonl (already canonically ordered).
 *   3. Read structure-tmp/<book>/pairs.jsonl to recover POV per scene
 *      (from `brief.pov`).
 *   4. For each beat (skipping the first beat per chapter — no prior
 *      beat to anchor expectation), build context with the prior
 *      beat's summary and call extractMckeeGap.
 *   5. Write outputs to novels/<key>/structure/<book>/.
 *
 * Outputs:
 *   - novels/<key>/structure/<book>/mckee-gap.jsonl
 *   - novels/<key>/structure/<book>/extract-mckee-gap-summary.json
 *
 * Usage:
 *   bun scripts/corpus/extract-mckee-gap.ts \
 *     --novel salvatore-icewind-dale --book crystal_shard \
 *     [--max-beats N]
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { normalize } from "./normalize-for-structure"
import { extractMckeeGap, type McKeeGapOutput } from "../../src/agents/structure-mckee-gap"

const REPO_ROOT = new URL("../..", import.meta.url).pathname
const PROGRESS_LOG_EVERY = 50

interface Args {
  novel: string
  book: string
  maxBeats: number | null
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
    console.error("Usage: bun scripts/corpus/extract-mckee-gap.ts --novel <key> --book <book> [--max-beats N]")
    process.exit(2)
  }
  const maxBeatsRaw = map["max-beats"]
  const maxBeats = typeof maxBeatsRaw === "string" ? Number(maxBeatsRaw) : null
  return {
    novel, book,
    maxBeats: maxBeats === null || Number.isNaN(maxBeats) ? null : maxBeats,
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

interface PairRow {
  brief: {
    book: string
    chapter: string | number
    scene_id: string
    beat_id: string
    summary: string
    pov?: string | null
    [key: string]: unknown
  }
  prose: unknown
}

interface BeatGapOut {
  beat_id: string
  chapter_label: string
  chapter_index: number
  scene_id: string
  beat_idx: number
  scene_ordinal: number
  output: McKeeGapOutput
  attempts: number
  ok: true
}

interface BeatGapFail {
  beat_id: string
  chapter_label: string
  chapter_index: number
  scene_id: string
  beat_idx: number
  scene_ordinal: number
  error: string
  ok: false
}

type BeatGap = BeatGapOut | BeatGapFail

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await Bun.file(path).text()
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T)
}

async function writeJsonl<T>(path: string, rows: T[]): Promise<void> {
  await Bun.write(path, rows.map(r => JSON.stringify(r)).join("\n") + "\n")
}

/** Build a beat_id used as a stable key. The augmented beats.jsonl
 *  rows do not carry beat_id directly (only scene_id + beat_idx);
 *  pairs.jsonl carries `brief.beat_id` in the form
 *  `<book>_ch<chapter>_s<scene_ordinal>_b<beat_idx>`. We recompute
 *  it here from scene_id + beat_idx so the output keys stay stable
 *  across both files. */
function beatIdFor(b: BeatRow): string {
  return `${b.scene_id}_b${b.beat_idx}`
}

async function runMckeeGapForBook(args: {
  beats: BeatRow[]
  pairs: PairRow[]
  maxBeats: number | null
}): Promise<BeatGap[]> {
  const { beats, pairs, maxBeats } = args

  // Build POV index: scene_id → POV string. pairs.jsonl is the
  // authoritative source for POV (brief.pov). Beats inherit their
  // scene's POV.
  const povByScene = new Map<string, string | null>()
  for (const p of pairs) {
    if (!povByScene.has(p.brief.scene_id)) {
      povByScene.set(p.brief.scene_id, p.brief.pov ?? null)
    }
  }

  // Group beats by canonical chapter index so we can identify the
  // "first beat of a chapter" (skip — no prior beat to anchor
  // expectation) cheaply. Beats are already canonically ordered
  // from the preflight (I2 sort stability invariant).
  const beatsByChIndex = new Map<number, BeatRow[]>()
  for (const b of beats) {
    const arr = beatsByChIndex.get(b._chapter_canonical_index) ?? []
    arr.push(b)
    beatsByChIndex.set(b._chapter_canonical_index, arr)
  }

  // Walk the canonically-ordered beats, building (beat, priorBeat)
  // pairs. First beat of each chapter is skipped (no prior beat to
  // anchor expectation per the agent's hard-rule "no prior-beat
  // lead-in" abstain path — we'd just abstain on every chapter
  // opener, so save the call).
  const tasks: Array<{ beat: BeatRow; priorBeat: BeatRow | null }> = []
  for (const b of beats) {
    const chBeats = beatsByChIndex.get(b._chapter_canonical_index)!
    const idxInCh = chBeats.indexOf(b)
    if (idxInCh === 0) continue // skip chapter-first beats
    tasks.push({ beat: b, priorBeat: chBeats[idxInCh - 1]! })
  }

  const targets = maxBeats !== null ? tasks.slice(0, maxBeats) : tasks
  console.log(`[extract-mckee-gap] beats total=${beats.length} taggable=${tasks.length} target=${targets.length} (skipped ${beats.length - tasks.length} chapter-opener beats)`)

  const out: BeatGap[] = []
  let i = 0
  for (const t of targets) {
    i++
    const b = t.beat
    const pov = povByScene.get(b.scene_id) ?? null
    const beatId = beatIdFor(b)
    const proseText = b.text ?? b.first_sentence ?? b.summary
    const ctxInput = {
      beat: {
        beat_id: beatId,
        chapter: b.chapter,
        scene_id: b.scene_id,
        beat_idx: b.beat_idx,
        summary: b.summary,
        first_sentence: b.first_sentence,
        text: proseText,
      },
      pov,
      priorBeat: {
        chapter: t.priorBeat!.chapter,
        scene_id: t.priorBeat!.scene_id,
        beat_idx: t.priorBeat!.beat_idx,
        summary: t.priorBeat!.summary,
      },
    }

    let attempts = 0
    let result = await extractMckeeGap(ctxInput)
    attempts++
    if (!result.ok) {
      // Single retry on schema-mismatch path (V4 Flash low-temp can
      // occasionally drop a field; mirrors the value-charge driver).
      result = await extractMckeeGap(ctxInput)
      attempts++
    }

    if (result.ok && result.output) {
      out.push({
        beat_id: beatId,
        chapter_label: String(b.chapter),
        chapter_index: b._chapter_canonical_index,
        scene_id: b.scene_id,
        beat_idx: b.beat_idx,
        scene_ordinal: b._scene_ordinal,
        output: result.output,
        attempts,
        ok: true,
      })
    } else {
      out.push({
        beat_id: beatId,
        chapter_label: String(b.chapter),
        chapter_index: b._chapter_canonical_index,
        scene_id: b.scene_id,
        beat_idx: b.beat_idx,
        scene_ordinal: b._scene_ordinal,
        error: result.error ?? "unknown",
        ok: false,
      })
    }

    if (i % PROGRESS_LOG_EVERY === 0 || i === targets.length) {
      const okCount = out.filter(r => r.ok).length
      const failCount = out.filter(r => !r.ok).length
      console.log(`[extract-mckee-gap] progress ${i}/${targets.length}  ok=${okCount} fail=${failCount}`)
    }
  }
  return out
}

async function main() {
  const args = parseArgs()
  console.log(`[extract-mckee-gap] novel=${args.novel} book=${args.book}`)

  // Step 1 — normalize (preflight). Pure structural; no LLM.
  console.log(`[extract-mckee-gap] step 1: normalize`)
  await normalize({ novel: args.novel, book: args.book })

  // Step 2 — read normalized working files.
  const tmpDir = join(REPO_ROOT, "novels", args.novel, "structure-tmp", args.book)
  if (!existsSync(tmpDir)) throw new Error(`structure-tmp/${args.book} not found after normalize: ${tmpDir}`)
  const beats = await readJsonl<BeatRow>(join(tmpDir, "beats.jsonl"))
  const pairs = await readJsonl<PairRow>(join(tmpDir, "pairs.jsonl"))
  console.log(`[extract-mckee-gap] loaded normalized files: beats=${beats.length} pairs=${pairs.length}`)

  const outDir = join(REPO_ROOT, "novels", args.novel, "structure", args.book)
  mkdirSync(outDir, { recursive: true })

  // Step 3 — McKee Gap per beat
  const gapTags = await runMckeeGapForBook({
    beats, pairs,
    maxBeats: args.maxBeats,
  })
  await writeJsonl(join(outDir, "mckee-gap.jsonl"), gapTags)

  // Step 4 — summary
  const oks = gapTags.filter(t => t.ok) as BeatGapOut[]
  const sizeCounts = { none: 0, small: 0, medium: 0, large: 0 } as Record<string, number>
  const typeCounts = { none: 0, reversal: 0, escalation: 0, revelation: 0, undermining: 0, other: 0 } as Record<string, number>
  let abstainCount = 0
  for (const t of oks) {
    sizeCounts[t.output.gap_size] = (sizeCounts[t.output.gap_size] ?? 0) + 1
    typeCounts[t.output.gap_type] = (typeCounts[t.output.gap_type] ?? 0) + 1
    if (t.output.abstain_reason !== null) abstainCount++
  }
  const summary = {
    novel: args.novel,
    book: args.book,
    extractedAt: new Date().toISOString(),
    beatsTotal: beats.length,
    beatsTagged: gapTags.length,
    beatsSkippedChapterOpeners: beats.length - gapTags.length,
    ok: oks.length,
    fail: gapTags.filter(t => !t.ok).length,
    abstain: abstainCount,
    gapSizeCounts: sizeCounts,
    gapTypeCounts: typeCounts,
  }
  await Bun.write(join(outDir, "extract-mckee-gap-summary.json"), JSON.stringify(summary, null, 2))
  console.log(`[extract-mckee-gap] done → ${outDir}`)
  console.log(`[extract-mckee-gap] summary: ${JSON.stringify(summary, null, 2)}`)
}

main().catch(err => {
  console.error(`[extract-mckee-gap] fatal:`, err)
  process.exit(1)
})
