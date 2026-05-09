#!/usr/bin/env bun
/**
 * Builds a local corpus-derived chapter/scene reference scaffold from Stage 6
 * structural annotations. The default report is metrics-only; pass
 * --include-summaries to include corpus-derived beat summaries in ignored
 * output/ artifacts for private structural review.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

interface Args {
  novel: string
  book: string
  outputDir: string
  includeSummaries: boolean
}

interface SceneRow {
  chapter: string | number
  scene_id: string
  words: number
  boundary?: string
  _chapter_canonical_index: number
  _scene_ordinal: number
}

interface BeatRow {
  chapter: string | number
  scene_id: string
  beat_idx: number
  words: number
  kind: string
  boundary_signal: string
  summary?: string
  _chapter_canonical_index: number
  _scene_ordinal: number
}

interface ValueChargeRow {
  scene_id: string
  ok: boolean
  output?: {
    valueIn?: string
    valueOut?: string
    lifeValue?: string
    polarity?: string
    confidence?: number
    abstain_reason?: string | null
  }
}

interface MiceRow {
  scene_id: string
  ok: boolean
  output?: {
    primary_thread?: string
    secondary_thread?: string | null
    opens_thread?: boolean
    closes_thread?: boolean
    thread_descriptor?: string
    confidence?: number
    abstain_reason?: string | null
  }
}

interface McKeeGapRow {
  scene_id: string
  beat_idx: number
  ok: boolean
  output?: {
    gap_size?: string
    gap_type?: string
    confidence?: number
    abstain_reason?: string | null
  }
}

interface SceneReference {
  sceneId: string
  chapterLabel: string
  sceneOrdinal: number
  wordCount: number
  beatCount: number
  beatKindCounts: Record<string, number>
  boundarySignalCounts: Record<string, number>
  gapSizeCounts: Record<string, number>
  valueShift: {
    valueIn: string | null
    valueOut: string | null
    lifeValue: string | null
    polarity: string | null
  } | null
  mice: {
    primaryThread: string | null
    secondaryThread: string | null
    opensThread: boolean
    closesThread: boolean
  } | null
  plotPointSummary?: string
  beatSummaries?: string[]
}

interface ChapterReference {
  chapterLabel: string
  chapterIndex: number
  sceneCount: number
  beatCount: number
  wordCount: number
  averageBeatsPerScene: number
  beatKindCounts: Record<string, number>
  boundarySignalCounts: Record<string, number>
  scenePolarityCounts: Record<string, number>
  micePrimaryCounts: Record<string, number>
  gapSizeCounts: Record<string, number>
  scenes: SceneReference[]
}

interface CorpusStructureReference {
  schemaVersion: "1.0"
  generatedAt: string
  source: {
    novel: string
    book: string
    scenesPath: string
    beatsPath: string
    valueChargePath: string | null
    micePath: string | null
    mckeeGapPath: string | null
  }
  mode: {
    includeSummaries: boolean
  }
  aggregate: {
    chapterCount: number
    sceneCount: number
    beatCount: number
    wordCount: number
    medianScenesPerChapter: number
    medianBeatsPerScene: number
    medianWordsPerScene: number
    medianWordsPerBeat: number
    meanScenesPerChapter: number
    meanBeatsPerScene: number
    meanWordsPerScene: number
    meanWordsPerBeat: number
  }
  chapters: ChapterReference[]
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const values: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    if (eq >= 0) {
      values[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
      values[arg.slice(2)] = argv[++i]!
    } else {
      values[arg.slice(2)] = true
    }
  }

  const novel = typeof values.novel === "string" ? values.novel : "salvatore-icewind-dale"
  const book = typeof values.book === "string" ? values.book : "crystal_shard"
  const outputDir = typeof values["output-dir"] === "string"
    ? values["output-dir"]
    : `output/corpus-structure-reference/${book}`

  return {
    novel,
    book,
    outputDir,
    includeSummaries: values["include-summaries"] === true,
  }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await Bun.file(path).text()
  return text
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as T)
}

function latestStampedOrCanonical(dir: string, base: string, ext: "json" | "jsonl"): string | null {
  if (!existsSync(dir)) return null
  const exact = join(dir, `${base}.${ext}`)
  const candidates = readdirSync(dir)
    .map(file => {
      const match = file.match(new RegExp(`^${escapeRegExp(base)}(?:\\.(\\d{8}T\\d{6})(?:\\.[^.]+)?)?\\.${ext}$`, "u"))
      if (!match) return null
      return {
        path: join(dir, file),
        stamp: match[1] ?? (file === basename(exact) ? "00000000T000000" : ""),
      }
    })
    .filter((item): item is { path: string; stamp: string } => item !== null)
    .sort((a, b) => a.stamp.localeCompare(b.stamp))
  return candidates.at(-1)?.path ?? (existsSync(exact) ? exact : null)
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function increment(counts: Record<string, number>, key: string | null | undefined): void {
  const safeKey = key && key.trim() ? key.trim() : "unknown"
  counts[safeKey] = (counts[safeKey] ?? 0) + 1
}

function mergeCounts(rows: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) out[key] = (out[key] ?? 0) + value
  }
  return out
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function buildCorpusStructureReference(input: {
  novel: string
  book: string
  generatedAt: string
  includeSummaries: boolean
  scenesPath: string
  beatsPath: string
  valueChargePath: string | null
  micePath: string | null
  mckeeGapPath: string | null
  scenes: SceneRow[]
  beats: BeatRow[]
  valueTags: ValueChargeRow[]
  miceTags: MiceRow[]
  gapTags: McKeeGapRow[]
}): CorpusStructureReference {
  const beatsByScene = groupBy(input.beats, row => row.scene_id)
  const valueByScene = new Map(input.valueTags.map(row => [row.scene_id, row]))
  const miceByScene = new Map(input.miceTags.map(row => [row.scene_id, row]))
  const gapsByScene = groupBy(input.gapTags, row => row.scene_id)
  const scenesByChapter = groupBy(input.scenes, row => `${row._chapter_canonical_index}:${String(row.chapter)}`)

  const chapters: ChapterReference[] = [...scenesByChapter.entries()]
    .map(([, chapterScenes]) => {
      const sortedScenes = [...chapterScenes].sort((a, b) => a._scene_ordinal - b._scene_ordinal)
      const firstScene = sortedScenes[0]!
      const sceneRefs = sortedScenes.map(scene => {
        const sceneBeats = [...(beatsByScene.get(scene.scene_id) ?? [])].sort((a, b) => a.beat_idx - b.beat_idx)
        const value = valueByScene.get(scene.scene_id)
        const mice = miceByScene.get(scene.scene_id)
        const gaps = gapsByScene.get(scene.scene_id) ?? []
        const beatKindCounts: Record<string, number> = {}
        const boundarySignalCounts: Record<string, number> = {}
        const gapSizeCounts: Record<string, number> = {}
        for (const beat of sceneBeats) {
          increment(beatKindCounts, beat.kind)
          increment(boundarySignalCounts, beat.boundary_signal)
        }
        for (const gap of gaps) increment(gapSizeCounts, gap.output?.gap_size)

        const sceneRef: SceneReference = {
          sceneId: scene.scene_id,
          chapterLabel: String(scene.chapter),
          sceneOrdinal: scene._scene_ordinal,
          wordCount: scene.words,
          beatCount: sceneBeats.length,
          beatKindCounts,
          boundarySignalCounts,
          gapSizeCounts,
          valueShift: value?.ok && value.output ? {
            valueIn: value.output.valueIn ?? null,
            valueOut: value.output.valueOut ?? null,
            lifeValue: value.output.lifeValue ?? null,
            polarity: value.output.polarity ?? null,
          } : null,
          mice: mice?.ok && mice.output ? {
            primaryThread: mice.output.primary_thread ?? null,
            secondaryThread: mice.output.secondary_thread ?? null,
            opensThread: mice.output.opens_thread ?? false,
            closesThread: mice.output.closes_thread ?? false,
          } : null,
        }
        if (input.includeSummaries) {
          const summaries = sceneBeats.map(beat => beat.summary).filter((summary): summary is string => Boolean(summary))
          sceneRef.beatSummaries = summaries
          sceneRef.plotPointSummary = summaries.join(" / ")
        }
        return sceneRef
      })

      const scenePolarityCounts: Record<string, number> = {}
      const micePrimaryCounts: Record<string, number> = {}
      for (const scene of sceneRefs) {
        increment(scenePolarityCounts, scene.valueShift?.polarity)
        increment(micePrimaryCounts, scene.mice?.primaryThread)
      }

      const beatCount = sceneRefs.reduce((sum, scene) => sum + scene.beatCount, 0)
      return {
        chapterLabel: String(firstScene.chapter),
        chapterIndex: firstScene._chapter_canonical_index,
        sceneCount: sceneRefs.length,
        beatCount,
        wordCount: sceneRefs.reduce((sum, scene) => sum + scene.wordCount, 0),
        averageBeatsPerScene: round(beatCount / Math.max(1, sceneRefs.length)),
        beatKindCounts: mergeCounts(sceneRefs.map(scene => scene.beatKindCounts)),
        boundarySignalCounts: mergeCounts(sceneRefs.map(scene => scene.boundarySignalCounts)),
        scenePolarityCounts,
        micePrimaryCounts,
        gapSizeCounts: mergeCounts(sceneRefs.map(scene => scene.gapSizeCounts)),
        scenes: sceneRefs,
      }
    })
    .sort((a, b) => a.chapterIndex - b.chapterIndex)

  const chapterSceneCounts = chapters.map(chapter => chapter.sceneCount)
  const sceneBeatCounts = chapters.flatMap(chapter => chapter.scenes.map(scene => scene.beatCount))
  const sceneWordCounts = chapters.flatMap(chapter => chapter.scenes.map(scene => scene.wordCount))
  const beatWordCounts = input.beats.map(beat => beat.words)

  return {
    schemaVersion: "1.0",
    generatedAt: input.generatedAt,
    source: {
      novel: input.novel,
      book: input.book,
      scenesPath: input.scenesPath,
      beatsPath: input.beatsPath,
      valueChargePath: input.valueChargePath,
      micePath: input.micePath,
      mckeeGapPath: input.mckeeGapPath,
    },
    mode: { includeSummaries: input.includeSummaries },
    aggregate: {
      chapterCount: chapters.length,
      sceneCount: input.scenes.length,
      beatCount: input.beats.length,
      wordCount: input.scenes.reduce((sum, scene) => sum + scene.words, 0),
      medianScenesPerChapter: round(median(chapterSceneCounts)),
      medianBeatsPerScene: round(median(sceneBeatCounts)),
      medianWordsPerScene: round(median(sceneWordCounts)),
      medianWordsPerBeat: round(median(beatWordCounts)),
      meanScenesPerChapter: round(mean(chapterSceneCounts)),
      meanBeatsPerScene: round(mean(sceneBeatCounts)),
      meanWordsPerScene: round(mean(sceneWordCounts)),
      meanWordsPerBeat: round(mean(beatWordCounts)),
    },
    chapters,
  }
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyFn(row)
    const group = out.get(key) ?? []
    group.push(row)
    out.set(key, group)
  }
  return out
}

export function renderCorpusStructureReference(reference: CorpusStructureReference): string {
  const lines: string[] = []
  lines.push(`# Corpus Structure Reference: ${reference.source.book}`)
  lines.push("")
  lines.push(`Generated: ${reference.generatedAt}`)
  lines.push(`Novel bundle: \`${reference.source.novel}\``)
  lines.push(`Summaries included: ${reference.mode.includeSummaries ? "yes" : "no"}`)
  lines.push("")
  lines.push("## Aggregate")
  lines.push("")
  lines.push("| Metric | Value |")
  lines.push("| --- | ---: |")
  lines.push(`| Chapters | ${reference.aggregate.chapterCount} |`)
  lines.push(`| Scenes | ${reference.aggregate.sceneCount} |`)
  lines.push(`| Beats | ${reference.aggregate.beatCount} |`)
  lines.push(`| Words | ${reference.aggregate.wordCount} |`)
  lines.push(`| Median scenes/chapter | ${reference.aggregate.medianScenesPerChapter} |`)
  lines.push(`| Median beats/scene | ${reference.aggregate.medianBeatsPerScene} |`)
  lines.push(`| Median words/scene | ${reference.aggregate.medianWordsPerScene} |`)
  lines.push(`| Median words/beat | ${reference.aggregate.medianWordsPerBeat} |`)
  lines.push("")
  lines.push("## Chapter Granularity")
  lines.push("")
  lines.push("| Chapter | Scenes | Beats | Words | Beats/Scene | Polarity | MICE |")
  lines.push("| --- | ---: | ---: | ---: | ---: | --- | --- |")
  for (const chapter of reference.chapters) {
    lines.push([
      `| ${chapter.chapterLabel}`,
      chapter.sceneCount,
      chapter.beatCount,
      chapter.wordCount,
      chapter.averageBeatsPerScene,
      compactCounts(chapter.scenePolarityCounts),
      `${compactCounts(chapter.micePrimaryCounts)} |`,
    ].join(" | "))
  }
  lines.push("")
  lines.push("## Interpretation")
  lines.push("")
  lines.push("- Use scene rows as the planner granularity target.")
  lines.push("- Use beat rows as annotation granularity inside a scene, not as the writer call unit.")
  lines.push("- Compare generated planner contracts against scene counts, scene functions, value turns, thread opens/closes, and chapter endpoint propulsion before prose tests.")
  lines.push("- Keep source-derived summaries in ignored output only; do not commit a recreated copyrighted outline.")
  return `${lines.join("\n")}\n`
}

function compactCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (entries.length === 0) return "-"
  return entries.map(([key, value]) => `${key}:${value}`).join(", ")
}

async function main(): Promise<void> {
  const args = parseArgs()
  const root = process.cwd()
  const bundleDir = resolve(root, "novels", args.novel)
  const tmpDir = join(bundleDir, "structure-tmp", args.book)
  const structureDir = join(bundleDir, "structure", args.book)
  const scenesPath = join(tmpDir, "scenes.jsonl")
  const beatsPath = join(tmpDir, "beats.jsonl")
  if (!existsSync(scenesPath) || !existsSync(beatsPath)) {
    throw new Error(`missing normalized corpus files; run: bun scripts/corpus/normalize-for-structure.ts --novel ${args.novel} --book ${args.book}`)
  }

  const valueChargePath = latestStampedOrCanonical(structureDir, "value-charge", "jsonl")
  const micePath = latestStampedOrCanonical(structureDir, "mice", "jsonl")
  const mckeeGapPath = latestStampedOrCanonical(structureDir, "mckee-gap", "jsonl")

  const [scenes, beats, valueTags, miceTags, gapTags] = await Promise.all([
    readJsonl<SceneRow>(scenesPath),
    readJsonl<BeatRow>(beatsPath),
    valueChargePath ? readJsonl<ValueChargeRow>(valueChargePath) : Promise.resolve([]),
    micePath ? readJsonl<MiceRow>(micePath) : Promise.resolve([]),
    mckeeGapPath ? readJsonl<McKeeGapRow>(mckeeGapPath) : Promise.resolve([]),
  ])

  const reference = buildCorpusStructureReference({
    novel: args.novel,
    book: args.book,
    generatedAt: new Date().toISOString(),
    includeSummaries: args.includeSummaries,
    scenesPath,
    beatsPath,
    valueChargePath,
    micePath,
    mckeeGapPath,
    scenes,
    beats,
    valueTags,
    miceTags,
    gapTags,
  })

  const outDir = resolve(root, args.outputDir)
  mkdirSync(outDir, { recursive: true })
  const jsonPath = join(outDir, "reference.json")
  const mdPath = join(outDir, "reference.md")
  writeFileSync(jsonPath, `${JSON.stringify(reference, null, 2)}\n`)
  writeFileSync(mdPath, renderCorpusStructureReference(reference))

  console.log(`wrote ${jsonPath}`)
  console.log(`wrote ${mdPath}`)
  console.log(`source files: ${dirname(scenesPath)}`)
}

if (import.meta.main) await main()
