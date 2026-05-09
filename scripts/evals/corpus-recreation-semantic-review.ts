#!/usr/bin/env bun
/**
 * Diagnostic-only semantic review for corpus recreation POC outputs.
 *
 * This adapts the existing planner-discernment narrow judge shape to the new
 * scene-first POC artifact shape. It does not rewrite, block, or promote.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  judgePlanningExcerpt,
  type Dimension,
  type JudgeOutput,
  type PromptMode,
} from "./planner-discernment-calibration"
import {
  RUN_MANIFEST_FILENAME,
  artifactRef,
  buildRunManifest,
  existingArtifactRefs,
  parentManifestForPocDir,
  writeRunManifest,
} from "./run-manifest"
import { corpusRecreationVariantLabel } from "./corpus-recreation-variant"

type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro"

interface Args {
  pocDir: string
  outputDir: string | null
  live: boolean
  model: ModelId
  thinking: boolean
  maxTokens: number
  concurrency: number
  promptMode: PromptMode
  dimensions: Dimension[]
  json: boolean
}

interface CorpusReviewPacket {
  sourceReference?: {
    book?: string
    chapterLabel?: string
  }
  diagnosticConfig?: {
    plannerVariant?: string
    writerContextMode?: string
  }
  originalAnalogSeed: {
    conceptId: string
    genreLane: string
    premise: string
    readerPromise: string
    protagonist: {
      characterId: string
      name: string
      want: string
      need: string
      lie: string
      truth: string
    }
    supportingCharacters: Array<{
      characterId: string
      name: string
      role: string
      pressure: string
    }>
    worldFacts: Array<{
      worldFactId: string
      fact: string
      operationalUse: string
    }>
    storyThreads?: Array<{
      threadId: string
      kind?: string
      label?: string
      description?: string
    }>
    storyDebts: Array<{
      storyDebtId: string
      threadId?: string
      promiseText: string
    }>
    storyPayoffs?: Array<{
      payoffId: string
      threadId?: string
      storyDebtId?: string
      payoffText?: string
    }>
  }
}

interface CorpusReviewPlan {
  chapterId: string
  title: string
  chapterFunction: string
  endpointOrHook: string
  scenes: CorpusReviewScenePlan[]
  obligations: Array<{
    obligationId: string
    sceneId: string
    sourceId: string
    threadId?: string
    promiseId?: string
    payoffId?: string
    requirementText: string
    materialityTest?: string
  }>
}

interface CorpusReviewScenePlan {
  sceneId: string
  referenceSceneOrdinal: number
  targetWords: number
  structuralRole: string
  povCharacterId: string
  locationOrArena: string
  goal: string
  opposition: string
  turningPoint: string
  crisisChoice: string
  climaxAction: string
  outcome: string
  consequence: string
  valueIn: string
  valueOut: string
  miceThread: string
  beatHints: Array<{
    kind: string
    boundarySignal: string
    gapSize: string
    purpose: string
  }>
}

interface CorpusReviewChapter {
  chapterTitle: string
  scenes: Array<{
    sceneId: string
    prose: string
  }>
}

export interface SceneSemanticTask {
  taskId: string
  sceneId: string
  sceneIndex: number
  dimension: Dimension
  promptMode: PromptMode
  excerpt: string
  relevantWorldFactIds: string[]
  relevantCharacterIds: string[]
  obligationIds: string[]
}

export interface SceneSemanticSkip {
  sceneId: string
  sceneIndex: number
  dimension: Dimension
  reason: string
}

export interface SceneSemanticResult extends SceneSemanticTask {
  label: string
  ordinal: number
  confidence: number
  evidenceFields: number
  missingForNextLevel: string
  output: JudgeOutput
}

export interface CorpusSemanticReviewReport {
  generatedAt: string
  pocDir: string
  source: {
    book: string | null
    chapterLabel: string | null
  }
  variantLabel: string
  live: boolean
  model: ModelId
  thinking: boolean
  promptMode: PromptMode
  dimensions: Dimension[]
  sceneCount: number
  taskCount: number
  skipCount: number
  results: SceneSemanticResult[]
  skips: SceneSemanticSkip[]
  summaries: Array<{
    dimension: Dimension
    count: number
    meanOrdinal: number
    lowCount: number
    labelCounts: Record<string, number>
  }>
}

const DEFAULT_POC_DIR = "output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls-r4"
const DEFAULT_DIMENSIONS: Dimension[] = [
  "sceneDramaturgy",
  "threadProgression",
  "promisePayoff",
  "motivationSpecificity",
  "worldFactPressure",
  "relationshipDelta",
]

export function buildSceneSemanticTasks(input: {
  packet: CorpusReviewPacket
  plan: CorpusReviewPlan
  chapter: CorpusReviewChapter
  dimensions: Dimension[]
  promptMode: PromptMode
}): { tasks: SceneSemanticTask[]; skips: SceneSemanticSkip[] } {
  const tasks: SceneSemanticTask[] = []
  const skips: SceneSemanticSkip[] = []
  for (let sceneIndex = 0; sceneIndex < input.plan.scenes.length; sceneIndex++) {
    const scene = input.plan.scenes[sceneIndex]!
    const prose = input.chapter.scenes.find(row => row.sceneId === scene.sceneId)?.prose ?? ""
    const obligations = input.plan.obligations.filter(row => row.sceneId === scene.sceneId)
    const relevantWorldFacts = relevantWorldFactsForScene(input.packet, obligations)
    const relevantCharacters = relevantCharactersForScene(input.packet, obligations)
    const threadRefCount = obligations.filter(row => row.threadId).length
    const promiseOrPayoffRefCount = obligations.filter(row => row.promiseId || row.payoffId).length

    for (const dimension of input.dimensions) {
      const skipReason = applicabilitySkipReason(dimension, {
        worldFactCount: relevantWorldFacts.length,
        characterCount: relevantCharacters.length,
        threadRefCount,
        promiseOrPayoffRefCount,
      })
      if (skipReason) {
        skips.push({ sceneId: scene.sceneId, sceneIndex, dimension, reason: skipReason })
        continue
      }
      tasks.push({
        taskId: `${scene.sceneId}:${dimension}`,
        sceneId: scene.sceneId,
        sceneIndex,
        dimension,
        promptMode: input.promptMode,
        excerpt: renderSceneSemanticExcerpt({
          packet: input.packet,
          plan: input.plan,
          scene,
          prose,
          obligations,
          relevantWorldFacts,
          relevantCharacters,
        }),
        relevantWorldFactIds: relevantWorldFacts.map(row => row.worldFactId),
        relevantCharacterIds: relevantCharacters.map(row => row.characterId),
        obligationIds: obligations.map(row => row.obligationId),
      })
    }
  }
  return { tasks, skips }
}

export async function buildCorpusSemanticReviewReport(args: Args, generatedAt = new Date().toISOString()): Promise<CorpusSemanticReviewReport> {
  const absPocDir = resolve(process.cwd(), args.pocDir)
  const packet = readJson<CorpusReviewPacket>(join(absPocDir, "packet.json"))
  const plan = readJson<CorpusReviewPlan>(join(absPocDir, "plan.json"))
  const chapter = readJson<CorpusReviewChapter>(join(absPocDir, "chapter.json"))
  const taskPlan = buildSceneSemanticTasks({
    packet,
    plan,
    chapter,
    dimensions: args.dimensions,
    promptMode: args.promptMode,
  })
  const results = await runBounded(
    taskPlan.tasks.map(task => async () => {
      const judged = await judgePlanningExcerpt({
        live: args.live,
        model: args.model,
        thinking: args.thinking,
        maxTokens: args.maxTokens,
        dimension: task.dimension,
        promptMode: task.promptMode,
        caseId: task.taskId,
        text: task.excerpt,
      })
      return {
        ...task,
        label: judged.label,
        ordinal: labelOrdinal(judged.label),
        confidence: clampNumber(Number(judged.output.confidence ?? 0), 0, 1),
        evidenceFields: Object.values(judged.output.evidence ?? {}).filter(Boolean).length,
        missingForNextLevel: judged.output.missingForNextLevel ?? "",
        output: judged.output,
      }
    }),
    args.concurrency,
  )
  return {
    generatedAt,
    pocDir: args.pocDir,
    source: {
      book: packet.sourceReference?.book ?? null,
      chapterLabel: packet.sourceReference?.chapterLabel ?? null,
    },
    variantLabel: corpusRecreationVariantLabel(packet.diagnosticConfig),
    live: args.live,
    model: args.model,
    thinking: args.thinking,
    promptMode: args.promptMode,
    dimensions: args.dimensions,
    sceneCount: plan.scenes.length,
    taskCount: taskPlan.tasks.length,
    skipCount: taskPlan.skips.length,
    results,
    skips: taskPlan.skips,
    summaries: summarizeResults(results),
  }
}

export function renderCorpusSemanticReviewReport(report: CorpusSemanticReviewReport): string {
  const lines: string[] = []
  lines.push("# Corpus Recreation Semantic Review")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`POC: ${report.pocDir}`)
  lines.push(`Source: ${report.source.book ?? "unknown"} chapter ${report.source.chapterLabel ?? "unknown"}`)
  lines.push(`Variant: ${report.variantLabel}`)
  lines.push(`Mode: ${report.live ? "live" : "dry"}; model=${report.model}; thinking=${report.thinking}; promptMode=${report.promptMode}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`- Scenes: ${report.sceneCount}`)
  lines.push(`- Semantic tasks: ${report.taskCount}`)
  lines.push(`- Applicability skips: ${report.skipCount}`)
  for (const summary of report.summaries) {
    const counts = Object.entries(summary.labelCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => `${label}:${count}`)
      .join(" ")
    lines.push(`- ${summary.dimension}: count=${summary.count}; mean=${summary.meanOrdinal.toFixed(2)}; low=${summary.lowCount}; ${counts}`)
  }
  const lowRows = report.results.filter(row => row.ordinal <= 1)
  lines.push("")
  lines.push("## Low-Signal Findings")
  lines.push("")
  if (lowRows.length === 0) {
    lines.push("- none")
  } else {
    for (const row of lowRows) {
      lines.push(`- ${row.sceneId} ${row.dimension} ${row.label}: ${row.missingForNextLevel || "no next-level note"}`)
    }
  }
  if (report.skips.length > 0) {
    lines.push("")
    lines.push("## Applicability Skips")
    lines.push("")
    for (const row of summarizeSkips(report.skips)) {
      lines.push(`- ${row.dimension}: ${row.count}; ${row.reason}`)
    }
  }
  lines.push("")
  lines.push("## Next")
  lines.push("")
  lines.push("- Treat findings as diagnostic/readiness evidence, not blockers.")
  lines.push("- Operator review should inspect low-signal scenes before any planner or writer change.")
  return `${lines.join("\n")}\n`
}

function renderSceneSemanticExcerpt(input: {
  packet: CorpusReviewPacket
  plan: CorpusReviewPlan
  scene: CorpusReviewScenePlan
  prose: string
  obligations: CorpusReviewPlan["obligations"]
  relevantWorldFacts: CorpusReviewPacket["originalAnalogSeed"]["worldFacts"]
  relevantCharacters: CorpusReviewPacket["originalAnalogSeed"]["supportingCharacters"]
}): string {
  return [
    `CHAPTER: ${input.plan.title}`,
    `CHAPTER FUNCTION: ${input.plan.chapterFunction}`,
    `CHAPTER ENDPOINT/HOOK: ${input.plan.endpointOrHook}`,
    "",
    "ORIGINAL ANALOG SEED:",
    `Premise: ${input.packet.originalAnalogSeed.premise}`,
    `Reader promise: ${input.packet.originalAnalogSeed.readerPromise}`,
    `Protagonist: ${input.packet.originalAnalogSeed.protagonist.name}`,
    `Want: ${input.packet.originalAnalogSeed.protagonist.want}`,
    `Need: ${input.packet.originalAnalogSeed.protagonist.need}`,
    `Lie: ${input.packet.originalAnalogSeed.protagonist.lie}`,
    `Truth: ${input.packet.originalAnalogSeed.protagonist.truth}`,
    "",
    "SCENE CONTRACT:",
    `Scene id: ${input.scene.sceneId}`,
    `Structural role: ${input.scene.structuralRole}`,
    `POV character id: ${input.scene.povCharacterId}`,
    `Location/arena: ${input.scene.locationOrArena}`,
    `Goal: ${input.scene.goal}`,
    `Opposition: ${input.scene.opposition}`,
    `Turning point: ${input.scene.turningPoint}`,
    `Crisis choice: ${input.scene.crisisChoice}`,
    `Climax action: ${input.scene.climaxAction}`,
    `Outcome: ${input.scene.outcome}`,
    `Consequence: ${input.scene.consequence}`,
    `Value shift: ${input.scene.valueIn} -> ${input.scene.valueOut}`,
    `MICE/thread: ${input.scene.miceThread}`,
    "",
    "RELEVANT SUPPORTING CHARACTERS:",
    ...formatList(input.relevantCharacters.map(row => `${row.characterId}: ${row.name}; role=${row.role}; pressure=${row.pressure}`)),
    "",
    "RELEVANT WORLD FACTS:",
    ...formatList(input.relevantWorldFacts.map(row => `${row.worldFactId}: ${row.fact}; operational use=${row.operationalUse}`)),
    "",
    "RELEVANT THREAD/PAYOFF REFS:",
    ...formatList(relevantThreadLines(input.packet, input.obligations)),
    "",
    "SCENE OBLIGATIONS:",
    ...formatList(input.obligations.map(row => {
      const materiality = row.materialityTest ? ` materialityTest=${row.materialityTest}` : ""
      const thread = row.threadId ? ` threadId=${row.threadId}` : ""
      const promise = row.promiseId ? ` promiseId=${row.promiseId}` : ""
      const payoff = row.payoffId ? ` payoffId=${row.payoffId}` : ""
      return `${row.obligationId} (${row.sourceId}):${thread}${promise}${payoff} ${row.requirementText}${materiality}`
    })),
    "",
    "BEAT HINTS AS INTERNAL ANNOTATIONS:",
    ...formatList(input.scene.beatHints.map((row, index) => `${index + 1}. ${row.kind}; ${row.boundarySignal}; ${row.gapSize}; ${row.purpose}`)),
    "",
    "SCENE PROSE:",
    input.prose,
  ].join("\n")
}

function relevantThreadLines(packet: CorpusReviewPacket, obligations: CorpusReviewPlan["obligations"]): string[] {
  const threadIds = new Set(obligations.map(row => row.threadId).filter(Boolean) as string[])
  const promiseIds = new Set(obligations.map(row => row.promiseId).filter(Boolean) as string[])
  const payoffIds = new Set(obligations.map(row => row.payoffId).filter(Boolean) as string[])
  const threads = (packet.originalAnalogSeed.storyThreads ?? [])
    .filter(thread => threadIds.has(thread.threadId))
    .map(thread => `${thread.threadId}: ${thread.label ?? thread.kind ?? "thread"}; ${thread.description ?? ""}`.trim())
  const promises = packet.originalAnalogSeed.storyDebts
    .filter(debt => promiseIds.has(debt.storyDebtId))
    .map(debt => `${debt.storyDebtId}: ${debt.promiseText}`)
  const payoffs = (packet.originalAnalogSeed.storyPayoffs ?? [])
    .filter(payoff => payoffIds.has(payoff.payoffId))
    .map(payoff => `${payoff.payoffId}: ${payoff.payoffText ?? ""}`.trim())
  return [...threads, ...promises, ...payoffs]
}

function relevantWorldFactsForScene(
  packet: CorpusReviewPacket,
  obligations: CorpusReviewPlan["obligations"],
): CorpusReviewPacket["originalAnalogSeed"]["worldFacts"] {
  const sourceIds = new Set(obligations.map(row => row.sourceId))
  return packet.originalAnalogSeed.worldFacts.filter(fact => sourceIds.has(fact.worldFactId))
}

function relevantCharactersForScene(
  packet: CorpusReviewPacket,
  obligations: CorpusReviewPlan["obligations"],
): CorpusReviewPacket["originalAnalogSeed"]["supportingCharacters"] {
  const sourceIds = new Set(obligations.map(row => row.sourceId))
  return packet.originalAnalogSeed.supportingCharacters.filter(character => sourceIds.has(character.characterId))
}

function applicabilitySkipReason(dimension: Dimension, counts: {
  worldFactCount: number
  characterCount: number
  threadRefCount: number
  promiseOrPayoffRefCount: number
}): string | null {
  if (dimension === "threadProgression" && counts.threadRefCount === 0) return "no threadId obligation declared for this scene"
  if (dimension === "promisePayoff" && counts.promiseOrPayoffRefCount === 0) return "no promiseId or payoffId obligation declared for this scene"
  if (dimension === "worldFactPressure" && counts.worldFactCount === 0) return "no world-fact sourceId obligation declared for this scene"
  if (dimension === "relationshipDelta" && counts.characterCount === 0) return "no supporting-character sourceId obligation declared for this scene"
  if (dimension === "characterMateriality" && counts.characterCount === 0) return "no supporting-character sourceId obligation declared for this scene"
  return null
}

function summarizeResults(results: SceneSemanticResult[]): CorpusSemanticReviewReport["summaries"] {
  const byDimension = new Map<Dimension, SceneSemanticResult[]>()
  for (const result of results) {
    byDimension.set(result.dimension, [...(byDimension.get(result.dimension) ?? []), result])
  }
  return [...byDimension.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dimension, rows]) => ({
      dimension,
      count: rows.length,
      meanOrdinal: mean(rows.map(row => row.ordinal)),
      lowCount: rows.filter(row => row.ordinal <= 1).length,
      labelCounts: countBy(rows.map(row => row.label)),
    }))
}

function summarizeSkips(skips: SceneSemanticSkip[]): Array<{ dimension: Dimension; reason: string; count: number }> {
  const counts = new Map<string, { dimension: Dimension; reason: string; count: number }>()
  for (const skip of skips) {
    const key = `${skip.dimension}:${skip.reason}`
    const current = counts.get(key) ?? { dimension: skip.dimension, reason: skip.reason, count: 0 }
    current.count++
    counts.set(key, current)
  }
  return [...counts.values()].sort((a, b) => a.dimension.localeCompare(b.dimension) || a.reason.localeCompare(b.reason))
}

function formatList(rows: string[]): string[] {
  return rows.length > 0 ? rows.map(row => `- ${row}`) : ["- none"]
}

function labelOrdinal(label: string): number {
  const match = label.match(/-(\d)$/)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`missing required artifact: ${path}`)
  return JSON.parse(readFileSync(path, "utf-8")) as T
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]!()
    }
  })
  await Promise.all(workers)
  return results
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const values: Record<string, string | true | string[]> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2)
    const value = eq >= 0 ? arg.slice(eq + 1) : (i + 1 < argv.length && !argv[i + 1]!.startsWith("--") ? argv[++i]! : true)
    if (key === "dimension") {
      values.dimension = [...(Array.isArray(values.dimension) ? values.dimension : []), String(value)]
    } else {
      values[key] = value
    }
  }
  const model = parseModel(typeof values.model === "string" ? values.model : "deepseek-v4-flash")
  const thinking = values.thinking === true || (model === "deepseek-v4-pro" && values["no-thinking"] !== true)
  return {
    pocDir: typeof values["poc-dir"] === "string" ? values["poc-dir"] : DEFAULT_POC_DIR,
    outputDir: typeof values["output-dir"] === "string" ? values["output-dir"] : null,
    live: values.live === true,
    model,
    thinking,
    maxTokens: typeof values["max-tokens"] === "string" ? positiveInt(values["max-tokens"], "--max-tokens") : 1400,
    concurrency: typeof values.concurrency === "string" ? positiveInt(values.concurrency, "--concurrency") : 4,
    promptMode: parsePromptMode(typeof values.mode === "string" ? values.mode : "evidence-first"),
    dimensions: parseDimensions(Array.isArray(values.dimension) ? values.dimension : []),
    json: values.json === true,
  }
}

function parseDimensions(values: string[]): Dimension[] {
  return values.length === 0 ? DEFAULT_DIMENSIONS : values.map(parseDimension)
}

function parseDimension(value: string): Dimension {
  const allowed: Dimension[] = [
    "characterAgency",
    "worldPressure",
    "endpointLanding",
    "causalMomentum",
    "sceneDramaturgy",
    "threadProgression",
    "promiseProgress",
    "promisePayoff",
    "motivationSpecificity",
    "characterMateriality",
    "relationshipDelta",
    "worldFactPressure",
    "stakesValueShift",
  ]
  if (allowed.includes(value as Dimension)) return value as Dimension
  throw new Error(`unsupported dimension: ${value}`)
}

function parseModel(value: string): ModelId {
  if (value === "deepseek-v4-flash" || value === "deepseek-v4-pro") return value
  throw new Error(`unsupported model: ${value}`)
}

function parsePromptMode(value: string): PromptMode {
  if (value === "direct-label" || value === "evidence-first" || value === "gate-derived") return value
  throw new Error(`unsupported mode: ${value}`)
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function defaultOutputDir(pocDir: string): string {
  return join(pocDir, "semantic-review")
}

async function main(): Promise<void> {
  const args = parseArgs()
  const report = await buildCorpusSemanticReviewReport(args)
  const outputDir = resolve(process.cwd(), args.outputDir ?? defaultOutputDir(args.pocDir))
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "semantic-review.json"), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outputDir, "semantic-review.md"), renderCorpusSemanticReviewReport(report))
  writeManifest(outputDir, report, args)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderCorpusSemanticReviewReport(report))
  console.log(`wrote ${join(outputDir, "semantic-review.json")}`)
  console.log(`wrote ${join(outputDir, "semantic-review.md")}`)
}

if (import.meta.main) await main()

function writeManifest(outputDir: string, report: CorpusSemanticReviewReport, args: Args): void {
  const absPocDir = resolve(process.cwd(), args.pocDir)
  const parent = parentManifestForPocDir(args.pocDir)
  writeRunManifest(join(outputDir, RUN_MANIFEST_FILENAME), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-semantic-review",
    variantId: readOptionalVariantLabel(absPocDir) ?? "baseline",
    parentRunId: parent?.runId ?? null,
    rootRunId: parent?.rootRunId ?? null,
    command: {
      name: "diagnostics:corpus-recreation-semantic-review",
      argv: process.argv.slice(2),
    },
    model: {
      provider: "deepseek",
      model: args.model,
      thinking: args.thinking,
    },
    inputs: existingArtifactRefs([
      { path: join(absPocDir, RUN_MANIFEST_FILENAME), role: "parent-run-manifest" },
      { path: join(absPocDir, "packet.json"), role: "packet" },
      { path: join(absPocDir, "plan.json"), role: "plan" },
      { path: join(absPocDir, "chapter.json"), role: "chapter-json" },
    ]),
    outputs: [
      artifactRef(join(outputDir, "semantic-review.json"), "semantic-review-json"),
      artifactRef(join(outputDir, "semantic-review.md"), "semantic-review-markdown"),
    ],
    relatedRunIds: parent ? [parent.runId] : [],
    discriminator: `${report.source.book ?? "unknown"}-${report.source.chapterLabel ?? "unknown"}`,
    metadata: {
      pocDir: args.pocDir,
      live: args.live,
      promptMode: args.promptMode,
      dimensions: args.dimensions,
      taskCount: report.taskCount,
      skipCount: report.skipCount,
    },
  }))
}

function readOptionalVariantLabel(absPocDir: string): string | null {
  const packetPath = join(absPocDir, "packet.json")
  if (!existsSync(packetPath)) return null
  const packet = JSON.parse(readFileSync(packetPath, "utf8")) as { diagnosticConfig?: { plannerVariant?: string; writerContextMode?: string } }
  return corpusRecreationVariantLabel(packet.diagnosticConfig)
}
