#!/usr/bin/env bun
/**
 * Sample extractor outputs for human gold adjudication.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §2 +
 * §3 "Gold-set adjudication procedure": uniformly sample 30-50 rows
 * per dimension, hide the LLM tags, present source data fresh to the
 * adjudicator. Self-disagreement retest (10%) is appended at the end.
 *
 * Supported dims:
 *   --dim value-charge    →  samples scenes from value-charge.jsonl
 *   --dim promise         →  samples promises from promises.json
 *   --dim mice            →  samples scenes from mice.jsonl
 *   --dim mckee-gap       →  samples beats from mckee-gap.jsonl
 *   --dim character-arcs  →  emits single book-level row from character-arcs.json
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

import { nowStamp, stampedPath, resolveLatestInput, resolveExactStamp } from "./_run-stamp"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

/** Resolve a structure-file source for the sampler.
 *  Default: latest stamped, no variant, with legacy un-stamped fallback.
 *  --source-stamp pins against an exact stamp; --source-variant filters by variant tag. */
function resolveSource(opts: {
  bundleDir: string
  book: string
  base: string
  ext: string
  stamp: string | null
  variant: string | null
}): string {
  const dir = join(opts.bundleDir, "structure", opts.book)
  if (opts.stamp) {
    const exact = resolveExactStamp({ dir, base: opts.base, ext: opts.ext, stamp: opts.stamp, variant: opts.variant })
    if (!exact) throw new Error(`source not found at exact stamp: ${opts.base}.${opts.stamp}${opts.variant ? "." + opts.variant : ""}.${opts.ext}`)
    return exact.path
  }
  const latest = resolveLatestInput({ dir, base: opts.base, ext: opts.ext, variant: opts.variant })
  if (!latest) throw new Error(`source not found: ${opts.base}${opts.variant ? "." + opts.variant : ""}.${opts.ext} (no stamped or legacy file in ${dir})`)
  return latest.path
}

interface Args {
  novel: string
  book: string
  dim: "value-charge" | "promise" | "mice" | "mckee-gap" | "character-arcs"
  n: number
  /** Seed for the RNG so sampling is reproducible across runs. */
  seed: number
  /** Fraction of samples to also include in the silent retest pool. */
  retestPct: number
  /** Pin source extraction to an exact stamp (default: latest matching variant). */
  sourceStamp: string | null
  /** Variant filter on source extraction (e.g. "pro", "pro-t0", "sonnet"). */
  sourceVariant: string | null
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
  const validDims = ["value-charge", "promise", "mice", "mckee-gap", "character-arcs"]
  if (!novel || !book || !dim) {
    console.error("Usage: bun scripts/corpus/sample-for-adjudication.ts --novel <key> --book <book> --dim <value-charge|promise|mice|mckee-gap|character-arcs> [--n 50] [--seed 42] [--retest-pct 0.10]")
    process.exit(2)
  }
  if (!validDims.includes(dim)) {
    console.error(`--dim must be one of: ${validDims.join(", ")}. Got: ${dim}`)
    process.exit(2)
  }
  return {
    novel, book, dim,
    n: map["n"] ? parseInt(map["n"], 10) : 50,
    seed: map["seed"] ? parseInt(map["seed"], 10) : 42,
    retestPct: map["retest-pct"] ? parseFloat(map["retest-pct"]) : 0.10,
    sourceStamp: map["source-stamp"] ?? null,
    sourceVariant: map["source-variant"] ?? null,
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
  const tagsPath = resolveSource({
    bundleDir, book: args.book, base: "value-charge", ext: "jsonl",
    stamp: args.sourceStamp, variant: args.sourceVariant,
  })
  console.log(`[sample] value-charge source: ${tagsPath}`)
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

interface MiceRow {
  scene_id: string
  chapter_label: string
  chapter_index: number
  scene_ordinal: number
  output?: unknown
  ok: boolean
  attempts?: number
}

interface McKeeGapRow {
  scene_id: string
  beat_idx: number
  chapter_label: string
  chapter_index: number
  scene_ordinal: number
  output?: unknown
  ok: boolean
  attempts?: number
}

interface BeatRow {
  beat_idx: number
  scene_id: string
  chapter: string | number
  summary: string
  first_sentence?: string
  text?: string
  _chapter_canonical_index: number
  _scene_ordinal: number
}

interface CharacterArcsDoc {
  novel: string
  book: string
  arcs: Array<{
    character_name: string
    lie: string
    truth: string
    want: string
    need: string
    arc_resolution: string
    evidence_quote_lie: string
    evidence_quote_truth: string | null
    confidence: number
    [k: string]: unknown
  }>
}

/** Build a Map<scene_id, pov> from novels/<key>/pairs.jsonl.
 *  Returns an empty map (not an error) if the file is missing. */
async function buildPovMap(bundleDir: string): Promise<Map<string, string | null>> {
  const pairsPath = join(bundleDir, "pairs.jsonl")
  if (!existsSync(pairsPath)) return new Map()
  const rows = await readJsonl<{ scene_id?: string; brief?: { pov?: string | null } }>(pairsPath)
  const m = new Map<string, string | null>()
  for (const r of rows) {
    if (r.scene_id !== undefined) {
      m.set(r.scene_id, r.brief?.pov ?? null)
    }
  }
  return m
}

async function sampleMice(args: Args): Promise<{ prompts: any[]; key: any[] }> {
  const bundleDir = join(REPO_ROOT, "novels", args.novel)
  const tagsPath = resolveSource({
    bundleDir, book: args.book, base: "mice", ext: "jsonl",
    stamp: args.sourceStamp, variant: args.sourceVariant,
  })
  console.log(`[sample] mice source: ${tagsPath}`)
  const tags = await readJsonl<MiceRow>(tagsPath)
  const okTags = tags.filter(t => t.ok)
  if (okTags.length < args.n) {
    console.warn(`[sample] only ${okTags.length} mice OK rows available; requested ${args.n}`)
  }

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
      dim: "mice",
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

  for (const t of retestPool) {
    const scene = sceneById.get(t.scene_id)
    if (!scene) continue
    const sampleId = randomUUID()
    prompts.push({
      sample_id: sampleId,
      dim: "mice",
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

async function sampleMckeeGap(args: Args): Promise<{ prompts: any[]; key: any[] }> {
  const bundleDir = join(REPO_ROOT, "novels", args.novel)
  const tagsPath = resolveSource({
    bundleDir, book: args.book, base: "mckee-gap", ext: "jsonl",
    stamp: args.sourceStamp, variant: args.sourceVariant,
  })
  console.log(`[sample] mckee-gap source: ${tagsPath}`)
  const tags = await readJsonl<McKeeGapRow>(tagsPath)
  const okTags = tags.filter(t => t.ok)
  if (okTags.length < args.n) {
    console.warn(`[sample] only ${okTags.length} mckee-gap OK rows available; requested ${args.n}`)
  }

  const tmpBeatsPath = join(bundleDir, "structure-tmp", args.book, "beats.jsonl")
  const beats = await readJsonl<BeatRow>(tmpBeatsPath)

  // Build a lookup by (scene_id, beat_idx)
  const beatByKey = new Map<string, BeatRow>()
  for (const b of beats) {
    beatByKey.set(`${b.scene_id}::${b.beat_idx}`, b)
  }

  // Build canonical order for prior-beat lookup:
  // sort by (_chapter_canonical_index, _scene_ordinal, beat_idx)
  const beatsSorted = [...beats].sort((a, b) => {
    if (a._chapter_canonical_index !== b._chapter_canonical_index)
      return a._chapter_canonical_index - b._chapter_canonical_index
    if (a._scene_ordinal !== b._scene_ordinal)
      return a._scene_ordinal - b._scene_ordinal
    return a.beat_idx - b.beat_idx
  })
  // Build a position map to look up prior beat quickly
  const beatPositionByKey = new Map<string, number>()
  for (let i = 0; i < beatsSorted.length; i++) {
    const b = beatsSorted[i]!
    beatPositionByKey.set(`${b.scene_id}::${b.beat_idx}`, i)
  }

  // POV map from pairs.jsonl
  const povMap = await buildPovMap(bundleDir)

  // Skip chapter-opener beats (first beat of each chapter, i.e. no prior beat
  // within same chapter). The extract-mckee-gap.ts driver skips these because
  // povExpectation cannot be reconstructed without a prior-beat lead-in.
  // A beat is a chapter-opener when it has no preceding beat with the same
  // _chapter_canonical_index.
  const firstBeatPerChapter = new Set<string>()
  const seenChapters = new Set<number>()
  for (const b of beatsSorted) {
    if (!seenChapters.has(b._chapter_canonical_index)) {
      seenChapters.add(b._chapter_canonical_index)
      firstBeatPerChapter.add(`${b.scene_id}::${b.beat_idx}`)
    }
  }

  const eligibleTags = okTags.filter(t => !firstBeatPerChapter.has(`${t.scene_id}::${t.beat_idx}`))
  if (eligibleTags.length < args.n) {
    console.warn(`[sample] only ${eligibleTags.length} mckee-gap eligible (non-opener) OK rows; requested ${args.n}`)
  }

  const rng = mulberry32(args.seed)
  const shuffled = shuffleInPlace([...eligibleTags], rng)
  const sampled = shuffled.slice(0, Math.min(args.n, shuffled.length))

  const retestCount = Math.max(1, Math.round(sampled.length * args.retestPct))
  const retestPool = sampled.slice(0, retestCount)

  const prompts: any[] = []
  const key: any[] = []

  const buildPromptRow = (t: McKeeGapRow, retest: boolean): any | null => {
    const beat = beatByKey.get(`${t.scene_id}::${t.beat_idx}`)
    if (!beat) {
      console.warn(`[sample] beat not found in beats.jsonl: scene=${t.scene_id} beat=${t.beat_idx}`)
      return null
    }
    const pos = beatPositionByKey.get(`${t.scene_id}::${t.beat_idx}`)
    let priorBeat: { chapter: string | number; scene_id: string; beat_idx: number; summary: string } | null = null
    if (pos !== undefined && pos > 0) {
      const prev = beatsSorted[pos - 1]!
      // Only set prior_beat when the previous beat is within the same chapter
      if (prev._chapter_canonical_index === beat._chapter_canonical_index) {
        priorBeat = {
          chapter: prev.chapter,
          scene_id: prev.scene_id,
          beat_idx: prev.beat_idx,
          summary: prev.summary,
        }
      }
    }
    const pov = povMap.get(t.scene_id) ?? null
    return {
      sample_id: null as unknown as string, // filled by caller
      dim: "mckee-gap",
      retest,
      scene_id: t.scene_id,
      beat_idx: t.beat_idx,
      chapter_label: t.chapter_label,
      chapter_index: t.chapter_index,
      scene_ordinal: t.scene_ordinal,
      beat_summary: beat.summary,
      beat_first_sentence: beat.first_sentence ?? null,
      beat_text: beat.text ?? null,
      pov,
      prior_beat: priorBeat,
    }
  }

  for (const t of sampled) {
    const row = buildPromptRow(t, false)
    if (!row) continue
    const sampleId = randomUUID()
    row.sample_id = sampleId
    prompts.push(row)
    key.push({
      sample_id: sampleId,
      scene_id: t.scene_id,
      beat_idx: t.beat_idx,
      llm_output: t.output,
    })
  }

  for (const t of retestPool) {
    const row = buildPromptRow(t, true)
    if (!row) continue
    const sampleId = randomUUID()
    row.sample_id = sampleId
    prompts.push(row)
    key.push({
      sample_id: sampleId,
      scene_id: t.scene_id,
      beat_idx: t.beat_idx,
      llm_output: t.output,
      is_retest_of_prior_sample: true,
    })
  }

  shuffleInPlace(prompts, mulberry32(args.seed + 1))
  return { prompts, key }
}

async function sampleCharacterArcs(args: Args): Promise<{ prompts: any[]; key: any[] }> {
  const bundleDir = join(REPO_ROOT, "novels", args.novel)
  const docPath = resolveSource({
    bundleDir, book: args.book, base: "character-arcs", ext: "json",
    stamp: args.sourceStamp, variant: args.sourceVariant,
  })
  console.log(`[sample] character-arcs source: ${docPath}`)
  const doc = JSON.parse(await Bun.file(docPath).text()) as CharacterArcsDoc

  const tmpBeatsPath = join(bundleDir, "structure-tmp", args.book, "beats.jsonl")
  const beats = await readJsonl<BeatRow>(tmpBeatsPath)

  // Sort beats canonically: (_chapter_canonical_index, _scene_ordinal, beat_idx)
  const beatsSorted = [...beats].sort((a, b) => {
    if (a._chapter_canonical_index !== b._chapter_canonical_index)
      return a._chapter_canonical_index - b._chapter_canonical_index
    if (a._scene_ordinal !== b._scene_ordinal)
      return a._scene_ordinal - b._scene_ordinal
    return a.beat_idx - b.beat_idx
  })

  // Determine chapter_label per _chapter_canonical_index from the first beat seen
  const chapterLabelByIndex = new Map<number, string>()
  for (const b of beatsSorted) {
    if (!chapterLabelByIndex.has(b._chapter_canonical_index)) {
      chapterLabelByIndex.set(b._chapter_canonical_index, String(b.chapter))
    }
  }

  const beatList = beatsSorted.map(b => ({
    chapter_label: chapterLabelByIndex.get(b._chapter_canonical_index) ?? String(b.chapter),
    chapter_index: b._chapter_canonical_index,
    scene_id: b.scene_id,
    beat_idx: b.beat_idx,
    summary: b.summary,
    first_sentence: b.first_sentence ?? null,
  }))

  const sampleId = randomUUID()
  const prompt = {
    sample_id: sampleId,
    dim: "character-arcs",
    novel: doc.novel,
    book: doc.book,
    beats: beatList,
  }
  const keyRow = {
    sample_id: sampleId,
    predicted_character_arcs: doc.arcs,
  }

  return { prompts: [prompt], key: [keyRow] }
}

async function samplePromises(args: Args): Promise<{ prompts: any[]; key: any[] }> {
  const bundleDir = join(REPO_ROOT, "novels", args.novel)
  const docPath = resolveSource({
    bundleDir, book: args.book, base: "promises", ext: "json",
    stamp: args.sourceStamp, variant: args.sourceVariant,
  })
  console.log(`[sample] promises source: ${docPath}`)
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
  const runStamp = nowStamp()
  console.log(`[sample] novel=${args.novel} book=${args.book} dim=${args.dim} n=${args.n} seed=${args.seed} stamp=${runStamp}`)

  let result: { prompts: any[]; key: any[] }
  if (args.dim === "value-charge") {
    result = await sampleValueCharge(args)
  } else if (args.dim === "mice") {
    result = await sampleMice(args)
  } else if (args.dim === "mckee-gap") {
    result = await sampleMckeeGap(args)
  } else if (args.dim === "character-arcs") {
    result = await sampleCharacterArcs(args)
  } else {
    result = await samplePromises(args)
  }
  const { prompts, key } = result

  const outDir = join(REPO_ROOT, "novels", args.novel, "structure-gold", args.book)
  mkdirSync(outDir, { recursive: true })

  // Stamped paired output per memory `feedback_no_overwrite_runs.md`.
  // Prompts and key share the same stamp so they remain joinable.
  const promptsPath = stampedPath({ dir: outDir, base: `${args.dim}-prompts`, stamp: runStamp, ext: "jsonl" })
  const keyPath = stampedPath({ dir: outDir, base: `${args.dim}-key`, stamp: runStamp, ext: "jsonl" })

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
  console.log(`[sample] adjudicate by labeling each prompt fresh in <dim>-gold.<stamp>.jsonl, then run compute-calibration.ts`)
}

main().catch(err => {
  console.error(`[sample] fatal:`, err)
  process.exit(1)
})
