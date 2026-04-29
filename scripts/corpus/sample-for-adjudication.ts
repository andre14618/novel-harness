#!/usr/bin/env bun
/**
 * Sample extractor outputs for human gold adjudication.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §2 +
 * §3 "Gold-set adjudication procedure": uniformly sample 30-50 rows
 * per dimension, hide the LLM tags, present source data fresh to the
 * adjudicator. Self-disagreement retest (10%) is appended at the end.
 *
 * Two modes:
 *   --dim value-charge  →  samples scenes from value-charge.jsonl
 *   --dim promise       →  samples promises from promises.json
 *
 * Output:
 *   novels/<key>/structure-gold/<book>/<dim>-prompts.jsonl
 *     One row per sample with the source-only fields the adjudicator
 *     needs to label fresh. LLM tags STRIPPED.
 *   novels/<key>/structure-gold/<book>/<dim>-key.jsonl
 *     Hidden key file mapping sample row IDs back to LLM outputs.
 *     The adjudicator should NOT open this file until after labeling.
 *
 * Usage:
 *   bun scripts/corpus/sample-for-adjudication.ts \
 *     --novel salvatore-icewind-dale --book crystal_shard \
 *     --dim value-charge --n 50
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

interface Args {
  novel: string
  book: string
  dim: "value-charge" | "promise"
  n: number
  /** Seed for the RNG so sampling is reproducible across runs. */
  seed: number
  /** Fraction of samples to also include in the silent retest pool. */
  retestPct: number
}

function parseArgs(): Args {
  const map: Record<string, string> = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith("--")) {
      const eq = a.indexOf("=")
      if (eq >= 0) { map[a.slice(2, eq)] = a.slice(eq + 1) }
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
        map[a.slice(2)] = argv[++i]!
      }
    }
  }
  const novel = map["novel"]
  const book = map["book"]
  const dim = map["dim"]
  if (!novel || !book || !dim) {
    console.error("Usage: bun scripts/corpus/sample-for-adjudication.ts --novel <key> --book <book> --dim <value-charge|promise> [--n 50] [--seed 42] [--retest-pct 0.10]")
    process.exit(2)
  }
  if (dim !== "value-charge" && dim !== "promise") {
    console.error(`--dim must be one of: value-charge, promise. Got: ${dim}`)
    process.exit(2)
  }
  return {
    novel, book, dim,
    n: map["n"] ? parseInt(map["n"], 10) : 50,
    seed: map["seed"] ? parseInt(map["seed"], 10) : 42,
    retestPct: map["retest-pct"] ? parseFloat(map["retest-pct"]) : 0.10,
  }
}

/** Mulberry32 — small deterministic PRNG so seed N gives stable
 *  samples across runs. The smoke's reproducibility relies on this. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await Bun.file(path).text()
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T)
}

async function writeJsonl<T>(path: string, rows: T[]): Promise<void> {
  await Bun.write(path, rows.map(r => JSON.stringify(r)).join("\n") + "\n")
}

interface ValueChargeRow {
  scene_id: string
  chapter_label: string
  chapter_index: number
  scene_ordinal: number
  output?: unknown
  ok: boolean
}

interface PromisesDoc {
  novel: string
  book: string
  promises: Array<{
    promise_id: string
    promise_text: string
    opened_chapter_label: string
    opened_chapter_index: number
    closed_chapter_label: string | null
    closed_chapter_index: number | null
    payoff_quality: string
    confidence: number
    [k: string]: unknown
  }>
}

interface SceneTextRow {
  scene_id: string
  chapter: string | number
  text: string
  _chapter_canonical_index?: number
  _scene_ordinal?: number
}

async function sampleValueCharge(args: Args): Promise<{ prompts: any[]; key: any[] }> {
  const bundleDir = join(REPO_ROOT, "novels", args.novel)
  const tagsPath = join(bundleDir, "structure", args.book, "value-charge.jsonl")
  if (!existsSync(tagsPath)) throw new Error(`value-charge tags not found: ${tagsPath}`)
  const tags = await readJsonl<ValueChargeRow>(tagsPath)
  const okTags = tags.filter(t => t.ok)
  if (okTags.length < args.n) {
    console.warn(`[sample] only ${okTags.length} value-charge OK rows available; requested ${args.n}`)
  }

  // Pull the scene text (verbatim) so the adjudicator labels from
  // source, not from extractor output. Use the normalized per-book
  // file so chapter ordering is consistent with the extraction pass.
  const tmpScenesPath = join(bundleDir, "structure-tmp", args.book, "scenes.jsonl")
  const scenes = await readJsonl<SceneTextRow>(tmpScenesPath)
  const sceneById = new Map(scenes.map(s => [s.scene_id, s]))

  const rng = mulberry32(args.seed)
  const shuffled = shuffleInPlace([...okTags], rng)
  const sampled = shuffled.slice(0, Math.min(args.n, shuffled.length))

  const retestCount = Math.max(1, Math.round(sampled.length * args.retestPct))
  const retestPool = sampled.slice(0, retestCount)

  const prompts: any[] = []
  const key: any[] = []

  for (const t of sampled) {
    const scene = sceneById.get(t.scene_id)
    if (!scene) {
      console.warn(`[sample] scene not found in normalized scenes.jsonl: ${t.scene_id}`)
      continue
    }
    const sampleId = randomUUID()
    prompts.push({
      sample_id: sampleId,
      dim: "value-charge",
      retest: false,
      scene_id: t.scene_id,
      chapter_label: t.chapter_label,
      chapter_index: t.chapter_index,
      scene_ordinal: t.scene_ordinal,
      scene_text: scene.text,
    })
    key.push({
      sample_id: sampleId,
      scene_id: t.scene_id,
      llm_output: t.output,
    })
  }

  // Append silent-retest rows: same source data, different sample_id,
  // shuffled into the prompt list. Adjudicator does NOT see retest=true
  // (we strip it from the file emitted to disk via post-process below).
  for (const t of retestPool) {
    const scene = sceneById.get(t.scene_id)
    if (!scene) continue
    const sampleId = randomUUID()
    prompts.push({
      sample_id: sampleId,
      dim: "value-charge",
      retest: true,
      scene_id: t.scene_id,
      chapter_label: t.chapter_label,
      chapter_index: t.chapter_index,
      scene_ordinal: t.scene_ordinal,
      scene_text: scene.text,
    })
    key.push({
      sample_id: sampleId,
      scene_id: t.scene_id,
      llm_output: t.output,
      is_retest_of_prior_sample: true,
    })
  }

  shuffleInPlace(prompts, mulberry32(args.seed + 1))
  return { prompts, key }
}

async function samplePromises(args: Args): Promise<{ prompts: any[]; key: any[] }> {
  const bundleDir = join(REPO_ROOT, "novels", args.novel)
  const docPath = join(bundleDir, "structure", args.book, "promises.json")
  if (!existsSync(docPath)) throw new Error(`promises.json not found: ${docPath}`)
  const doc = JSON.parse(await Bun.file(docPath).text()) as PromisesDoc

  // For PromiseRegistry, the gold protocol per R6 §2 is: the adjudicator
  // reads chapter beats fresh and identifies promises directly (NOT
  // sampled from extractor output). So the prompts emitted here are
  // the chapter-beat sequence the adjudicator should read; the key
  // file is the LLM's full registry, used later as the predicted set
  // when matching predicted ↔ gold via the §2 matching policy.
  const tmpBeatsPath = join(bundleDir, "structure-tmp", args.book, "beats.jsonl")
  const beats = await readJsonl<{ chapter: string | number; scene_id: string; beat_idx: number; summary: string; first_sentence?: string; _chapter_canonical_index: number }>(tmpBeatsPath)
  const beatsByCh = new Map<number, typeof beats>()
  for (const b of beats) {
    const arr = beatsByCh.get(b._chapter_canonical_index) ?? []
    arr.push(b)
    beatsByCh.set(b._chapter_canonical_index, arr)
  }
  const chapterIndices = [...beatsByCh.keys()].sort((a, b) => a - b)
  const prompts = chapterIndices.map(idx => ({
    sample_id: randomUUID(),
    dim: "promise",
    chapter_index: idx,
    chapter_label: String(beatsByCh.get(idx)![0]!.chapter),
    beats: beatsByCh.get(idx)!.map(b => ({
      scene_id: b.scene_id,
      beat_idx: b.beat_idx,
      summary: b.summary,
      first_sentence: b.first_sentence,
    })),
  }))
  const key = doc.promises  // use the full predicted registry for join later
  return { prompts, key }
}

async function main() {
  const args = parseArgs()
  console.log(`[sample] novel=${args.novel} book=${args.book} dim=${args.dim} n=${args.n} seed=${args.seed}`)

  const { prompts, key } = args.dim === "value-charge"
    ? await sampleValueCharge(args)
    : await samplePromises(args)

  const outDir = join(REPO_ROOT, "novels", args.novel, "structure-gold", args.book)
  mkdirSync(outDir, { recursive: true })

  const promptsPath = join(outDir, `${args.dim}-prompts.jsonl`)
  const keyPath = join(outDir, `${args.dim}-key.jsonl`)

  // Strip retest flag from the prompt file so adjudicator doesn't see
  // which samples are retests.
  const promptsWithoutRetest = prompts.map(p => {
    const { retest, ...rest } = p
    return rest
  })
  await writeJsonl(promptsPath, promptsWithoutRetest)
  await writeJsonl(keyPath, key)

  console.log(`[sample] wrote ${prompts.length} prompts → ${promptsPath}`)
  console.log(`[sample] wrote ${key.length} key rows → ${keyPath}`)
  console.log(`[sample] adjudicate by labeling each prompt fresh in <dim>-gold.jsonl, then run compute-calibration.ts`)
}

main().catch(err => {
  console.error(`[sample] fatal:`, err)
  process.exit(1)
})
