#!/usr/bin/env bun
/**
 * Apply calibrated planner-discernment labels to real planner cohort outputs.
 *
 * This is diagnostic-only. It does not promote, block, rewrite, or change
 * runtime planner behavior.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import {
  DIMENSIONS,
  judgePlanningExcerpt,
  type Dimension,
  type JudgeOutput,
  type PromptMode,
} from "./planner-discernment-calibration"
import {
  loadFixture,
  type DiagnosticReport,
  type PlannerDiagnosticFixture,
} from "./method-pack-planner-diagnostic"

type UnitType = "chapter" | "scene"

interface Args {
  cohortDir: string
  cellPaths: string[]
  outputDir: string | null
  live: boolean
  model: "deepseek-v4-flash" | "deepseek-v4-pro"
  thinking: boolean
  maxTokens: number
  concurrency: number
  promptMode: PromptMode
  dimensions: Dimension[]
  chapterLimit: number | null
  replicate: number | null
  json: boolean
}

interface PlannerExcerpt {
  excerptId: string
  cellPath: string
  diagnosticId: string
  fixturePath: string
  fixtureId: string
  armId: string
  methodPackEnabled: boolean
  unitType: UnitType
  chapterId: string
  chapterIndex: number
  sceneId: string | null
  sceneIndex: number | null
  povCharacterId: string | null
  requiredCharacterIds: string[]
  text: string
}

interface DiscernmentResult {
  excerptId: string
  cellPath: string
  diagnosticId: string
  fixturePath: string
  fixtureId: string
  armId: string
  methodPackEnabled: boolean
  unitType: UnitType
  chapterId: string
  chapterIndex: number
  sceneId: string | null
  sceneIndex: number | null
  dimension: Dimension
  promptMode: PromptMode
  label: string
  ordinal: number
  confidence: number
  evidenceFields: number
  missingForNextLevel: string
  output: JudgeOutput
}

interface ArmDimensionSummary {
  armId: string
  methodPackEnabled: boolean
  dimension: Dimension
  unitType: UnitType
  count: number
  meanOrdinal: number
  highRate: number
  lowRate: number
  labelCounts: Record<string, number>
}

interface DimensionComparison {
  dimension: Dimension
  unitType: UnitType
  controlArmId: string | null
  testArmId: string | null
  controlMean: number | null
  testMean: number | null
  delta: number | null
  controlHighRate: number | null
  testHighRate: number | null
  highRateDelta: number | null
}

interface ApplicabilitySkip {
  excerptId: string
  cellPath: string
  fixtureId: string
  armId: string
  methodPackEnabled: boolean
  unitType: UnitType
  chapterId: string
  sceneId: string | null
  dimension: Dimension
  reason: string
}

interface RealDataReport {
  generatedAt: string
  cohortDir: string
  cellPaths: string[]
  live: boolean
  model: string
  thinking: boolean
  promptMode: PromptMode
  dimensions: Dimension[]
  chapterLimit: number | null
  replicate: number | null
  excerptCount: number
  resultCount: number
  applicabilitySkipCount: number
  results: DiscernmentResult[]
  applicabilitySkips: ApplicabilitySkip[]
  summaries: ArmDimensionSummary[]
  comparisons: DimensionComparison[]
}

const DEFAULT_COHORT_DIR = "output/method-pack-diagnostics/2026-05-07T13-51-44-961Z/cohort"
const DEFAULT_PROMPT_MODE: PromptMode = "direct-label"
const DEFAULT_CONCURRENCY = 8
const DEFAULT_MAX_TOKENS = 1400
const SCENE_DIMENSIONS = new Set<Dimension>([
  "sceneDramaturgy",
  "motivationSpecificity",
  "relationshipDelta",
  "stakesValueShift",
])

export async function buildRealDataReport(args: Args, generatedAt = new Date().toISOString()): Promise<RealDataReport> {
  const cellPaths = collectCellPaths(args)
  const excerpts = collectExcerpts(cellPaths, args)
  const taskPlan = buildTaskPlan(excerpts, args)
  const results = args.live
    ? await runBounded(taskPlan.tasks, args.concurrency)
    : await Promise.all(taskPlan.tasks.map(task => task()))
  return {
    generatedAt,
    cohortDir: args.cohortDir,
    cellPaths,
    live: args.live,
    model: args.model,
    thinking: args.thinking,
    promptMode: args.promptMode,
    dimensions: args.dimensions,
    chapterLimit: args.chapterLimit,
    replicate: args.replicate,
    excerptCount: excerpts.length,
    resultCount: results.length,
    applicabilitySkipCount: taskPlan.applicabilitySkips.length,
    results,
    applicabilitySkips: taskPlan.applicabilitySkips,
    summaries: summarize(results),
    comparisons: compareArms(results),
  }
}

export function renderRealDataReport(report: RealDataReport): string {
  const lines: string[] = []
  lines.push("Planner discernment real-data report")
  lines.push(`cohort=${report.cohortDir}; cells=${report.cellPaths.length}; excerpts=${report.excerptCount}; results=${report.resultCount}; applicabilitySkips=${report.applicabilitySkipCount}`)
  lines.push(`model=${report.model}; thinking=${report.thinking}; mode=${report.promptMode}; live=${report.live}`)
  lines.push("")
  lines.push("Dimension comparisons:")
  for (const row of report.comparisons) {
    const delta = row.delta === null ? "n/a" : formatSigned(row.delta)
    const highDelta = row.highRateDelta === null ? "n/a" : formatSignedPct(row.highRateDelta)
    lines.push(`- ${row.dimension} (${row.unitType}): control=${formatMean(row.controlMean)} test=${formatMean(row.testMean)} delta=${delta}; highRateDelta=${highDelta}`)
  }
  lines.push("")
  lines.push("Arm summaries:")
  for (const row of report.summaries) {
    const counts = Object.entries(row.labelCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => `${label}:${count}`)
      .join(" ")
    lines.push(`- ${row.armId} ${row.dimension}: mean=${row.meanOrdinal.toFixed(2)} high=${formatPct(row.highRate)} low=${formatPct(row.lowRate)} ${counts}`)
  }
  if (report.applicabilitySkips.length > 0) {
    lines.push("")
    lines.push("Applicability skips:")
    for (const row of summarizeApplicabilitySkips(report.applicabilitySkips)) {
      lines.push(`- ${row.dimension} ${row.armId}: skipped=${row.count}; ${row.reason}`)
    }
  }
  lines.push("")
  lines.push("Lowest-label examples:")
  for (const row of report.results.filter(result => result.ordinal <= 1).slice(0, 20)) {
    lines.push(`- ${row.label} ${row.dimension} ${row.armId} ${row.fixtureId} ${row.chapterId}${row.sceneId ? `/${row.sceneId}` : ""}: ${row.missingForNextLevel || "no next-level note"}`)
  }
  return lines.join("\n")
}

function collectCellPaths(args: Args): string[] {
  const paths = args.cellPaths.length > 0
    ? args.cellPaths
    : readdirSync(resolve(process.cwd(), args.cohortDir, "cells"))
      .filter(name => name.endsWith(".json"))
      .map(name => join(args.cohortDir, "cells", name))
  const filtered = args.replicate === null
    ? paths
    : paths.filter(path => basename(path).includes(`-r${String(args.replicate).padStart(2, "0")}.json`))
  return filtered.sort()
}

function collectExcerpts(cellPaths: string[], args: Args): PlannerExcerpt[] {
  const excerpts: PlannerExcerpt[] = []
  for (const cellPath of cellPaths) {
    const report = loadCellReport(cellPath)
    const fixture = loadFixture(report.fixturePath)
    const fixtureId = fixtureIdFromPath(report.fixturePath)
    for (const arm of report.arms) {
      const chapters = args.chapterLimit === null
        ? arm.plan.chapters
        : arm.plan.chapters.slice(0, args.chapterLimit)
      for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
        const chapter = chapters[chapterIndex]!
        excerpts.push({
          excerptId: `${basename(cellPath, ".json")}:${arm.armId}:${chapter.chapterId}`,
          cellPath,
          diagnosticId: report.diagnosticId,
          fixturePath: report.fixturePath,
          fixtureId,
          armId: arm.armId,
          methodPackEnabled: arm.methodPackEnabled,
          unitType: "chapter",
          chapterId: chapter.chapterId,
          chapterIndex,
          sceneId: null,
          sceneIndex: null,
          povCharacterId: null,
          requiredCharacterIds: [],
          text: renderChapterExcerpt(fixture, arm.plan.armId, chapter),
        })
        for (let sceneIndex = 0; sceneIndex < chapter.scenes.length; sceneIndex++) {
          const scene = chapter.scenes[sceneIndex]!
          excerpts.push({
            excerptId: `${basename(cellPath, ".json")}:${arm.armId}:${scene.sceneId}`,
            cellPath,
            diagnosticId: report.diagnosticId,
            fixturePath: report.fixturePath,
            fixtureId,
            armId: arm.armId,
            methodPackEnabled: arm.methodPackEnabled,
            unitType: "scene",
            chapterId: chapter.chapterId,
            chapterIndex,
            sceneId: scene.sceneId,
            sceneIndex,
            povCharacterId: scene.povCharacterId,
            requiredCharacterIds: scene.requiredCharacterIds ?? [],
            text: renderSceneExcerpt(fixture, arm.plan.armId, chapter, scene),
          })
        }
      }
    }
  }
  return excerpts
}

function buildTaskPlan(excerpts: PlannerExcerpt[], args: Args): {
  tasks: Array<() => Promise<DiscernmentResult>>
  applicabilitySkips: ApplicabilitySkip[]
} {
  const tasks: Array<() => Promise<DiscernmentResult>> = []
  const applicabilitySkips: ApplicabilitySkip[] = []
  for (const dimension of args.dimensions) {
    const unitType = unitTypeForDimension(dimension)
    for (const excerpt of excerpts.filter(row => row.unitType === unitType)) {
      const skipReason = applicabilitySkipReason(dimension, excerpt)
      if (skipReason) {
        applicabilitySkips.push({
          excerptId: excerpt.excerptId,
          cellPath: excerpt.cellPath,
          fixtureId: excerpt.fixtureId,
          armId: excerpt.armId,
          methodPackEnabled: excerpt.methodPackEnabled,
          unitType: excerpt.unitType,
          chapterId: excerpt.chapterId,
          sceneId: excerpt.sceneId,
          dimension,
          reason: skipReason,
        })
        continue
      }
      tasks.push(async () => {
        const caseId = `${excerpt.excerptId}:${dimension}`
        const judged = await judgePlanningExcerpt({
          live: args.live,
          model: args.model,
          thinking: args.thinking,
          maxTokens: args.maxTokens,
          dimension,
          promptMode: args.promptMode,
          caseId,
          text: excerpt.text,
        })
        return {
          ...excerpt,
          dimension,
          promptMode: args.promptMode,
          label: judged.label,
          ordinal: labelOrdinal(judged.label),
          confidence: clamp(Number(judged.output.confidence), 0, 1),
          evidenceFields: Object.values(judged.output.evidence ?? {}).filter(Boolean).length,
          missingForNextLevel: judged.output.missingForNextLevel,
          output: judged.output,
        }
      })
    }
  }
  return { tasks, applicabilitySkips }
}

function unitTypeForDimension(dimension: Dimension): UnitType {
  return SCENE_DIMENSIONS.has(dimension) ? "scene" : "chapter"
}

function applicabilitySkipReason(dimension: Dimension, excerpt: PlannerExcerpt): string | null {
  if (dimension !== "relationshipDelta") return null
  const otherRequiredCharacters = new Set(excerpt.requiredCharacterIds.filter(id => id !== excerpt.povCharacterId))
  if (otherRequiredCharacters.size === 0) return "scene does not require a non-POV character"
  if (!RELATIONSHIP_PRESSURE_PATTERN.test(excerpt.text)) {
    return "scene has multiple characters but no deterministic relationship-pressure signal"
  }
  return null
}

const RELATIONSHIP_PRESSURE_PATTERN = /\b(ally|alliance|betray|betrayal|blackmail|debt|deal|distrust|friend|honor|intimacy|leverage|loyal|loyalty|owes?|partner|power|promise|rival|rivalry|suspicion|trust|warns?|watches|withholds?)\b/i

function summarize(results: DiscernmentResult[]): ArmDimensionSummary[] {
  const groups = new Map<string, DiscernmentResult[]>()
  for (const result of results) {
    const key = `${result.armId}\t${result.methodPackEnabled}\t${result.dimension}\t${result.unitType}`
    groups.set(key, [...(groups.get(key) ?? []), result])
  }
  return [...groups.values()].map(rows => {
    const first = rows[0]!
    const labelCounts: Record<string, number> = {}
    for (const row of rows) labelCounts[row.label] = (labelCounts[row.label] ?? 0) + 1
    return {
      armId: first.armId,
      methodPackEnabled: first.methodPackEnabled,
      dimension: first.dimension,
      unitType: first.unitType,
      count: rows.length,
      meanOrdinal: mean(rows.map(row => row.ordinal)),
      highRate: ratio(rows.filter(row => row.ordinal >= 2).length, rows.length),
      lowRate: ratio(rows.filter(row => row.ordinal <= 1).length, rows.length),
      labelCounts,
    }
  }).sort((a, b) => a.dimension.localeCompare(b.dimension) || Number(a.methodPackEnabled) - Number(b.methodPackEnabled))
}

function compareArms(results: DiscernmentResult[]): DimensionComparison[] {
  const dimensions = [...new Set(results.map(result => result.dimension))]
  return dimensions.map(dimension => {
    const rows = results.filter(result => result.dimension === dimension)
    const control = rows.filter(row => !row.methodPackEnabled)
    const test = rows.filter(row => row.methodPackEnabled)
    const unitType = rows[0]?.unitType ?? "chapter"
    const controlMean = control.length ? mean(control.map(row => row.ordinal)) : null
    const testMean = test.length ? mean(test.map(row => row.ordinal)) : null
    const controlHighRate = control.length ? ratio(control.filter(row => row.ordinal >= 2).length, control.length) : null
    const testHighRate = test.length ? ratio(test.filter(row => row.ordinal >= 2).length, test.length) : null
    return {
      dimension,
      unitType,
      controlArmId: control[0]?.armId ?? null,
      testArmId: test[0]?.armId ?? null,
      controlMean,
      testMean,
      delta: controlMean === null || testMean === null ? null : testMean - controlMean,
      controlHighRate,
      testHighRate,
      highRateDelta: controlHighRate === null || testHighRate === null ? null : testHighRate - controlHighRate,
    }
  })
}

function summarizeApplicabilitySkips(skips: ApplicabilitySkip[]): Array<{
  armId: string
  dimension: Dimension
  reason: string
  count: number
}> {
  const groups = new Map<string, ApplicabilitySkip[]>()
  for (const skip of skips) {
    const key = `${skip.armId}\t${skip.dimension}\t${skip.reason}`
    groups.set(key, [...(groups.get(key) ?? []), skip])
  }
  return [...groups.values()].map(rows => ({
    armId: rows[0]!.armId,
    dimension: rows[0]!.dimension,
    reason: rows[0]!.reason,
    count: rows.length,
  })).sort((a, b) => a.dimension.localeCompare(b.dimension) || a.armId.localeCompare(b.armId) || a.reason.localeCompare(b.reason))
}

function renderChapterExcerpt(fixture: PlannerDiagnosticFixture, planArmId: string, chapter: DiagnosticReport["arms"][number]["plan"]["chapters"][number]): string {
  return `Concept:
Premise: ${fixture.concept.premise}
Reader promise: ${fixture.concept.readerPromise}
Central conflict: ${fixture.concept.centralConflict}
Story promise: ${fixture.concept.storyPromise.text}
Protagonist: ${fixture.concept.protagonist.name}; desire=${fixture.concept.protagonist.desire}; fear=${fixture.concept.protagonist.fear}; flaw=${fixture.concept.protagonist.flaw}

Plan arm: ${planArmId}
Chapter: ${chapter.chapterId}; slot=${chapter.structureSlotId}
Chapter function: ${chapter.chapterFunction}
Protagonist pressure: ${chapter.protagonistPressure}
Central conflict: ${chapter.centralConflict}
Irreversible change: ${chapter.irreversibleChange}
Endpoint or hook: ${chapter.endpointOrHook}
Required character work: ${chapter.requiredCharacterWork}
Required world work: ${chapter.requiredWorldWork}
Required story debt work: ${chapter.requiredStoryDebtWork}

Obligations:
${chapter.obligations.map(obligation => `- ${obligation.obligationId} (${obligation.sourceKind}:${obligation.sourceId}; ${obligation.coveragePolicy}): ${obligation.requirementText}`).join("\n") || "- none"}

Scenes:
${chapter.scenes.map(scene => `- ${scene.sceneId}: function=${scene.sceneFunction}; goal=${scene.goal}; conflict=${scene.conflict}; turn=${scene.turnOrValueShift}; outcome=${scene.outcome}; consequence=${scene.consequence}`).join("\n")}`
}

function renderSceneExcerpt(
  fixture: PlannerDiagnosticFixture,
  planArmId: string,
  chapter: DiagnosticReport["arms"][number]["plan"]["chapters"][number],
  scene: DiagnosticReport["arms"][number]["plan"]["chapters"][number]["scenes"][number],
): string {
  return `Concept:
Premise: ${fixture.concept.premise}
Reader promise: ${fixture.concept.readerPromise}
Central conflict: ${fixture.concept.centralConflict}
Protagonist: ${fixture.concept.protagonist.name}; desire=${fixture.concept.protagonist.desire}; fear=${fixture.concept.protagonist.fear}; flaw=${fixture.concept.protagonist.flaw}
Key characters:
${fixture.concept.characters.map(character => `- ${character.characterId}: ${character.name}; role=${character.role}; materiality=${character.materiality}`).join("\n") || "- none"}

Plan arm: ${planArmId}
Parent chapter: ${chapter.chapterId}; function=${chapter.chapterFunction}; endpoint=${chapter.endpointOrHook}
Required chapter work: character=${chapter.requiredCharacterWork}; world=${chapter.requiredWorldWork}; storyDebt=${chapter.requiredStoryDebtWork}

Scene: ${scene.sceneId}
Scene function: ${scene.sceneFunction}
POV character: ${scene.povCharacterId}
Location or arena: ${scene.locationOrArena}
Goal: ${scene.goal}
Opposition/conflict: ${scene.conflict}
Turn or value shift: ${scene.turnOrValueShift}
Outcome: ${scene.outcome}
Consequence: ${scene.consequence}
Required obligation IDs: ${scene.requiredObligationIds.join(", ")}
Required character IDs: ${scene.requiredCharacterIds.join(", ")}
Required world fact IDs: ${scene.requiredWorldFactIds.join(", ")}`
}

function loadCellReport(path: string): DiagnosticReport {
  const abs = resolve(process.cwd(), path)
  if (!existsSync(abs)) throw new Error(`cell not found: ${abs}`)
  return JSON.parse(readFileSync(abs, "utf-8")) as DiagnosticReport
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

function parseArgs(argv: string[]): Args {
  let cohortDir = DEFAULT_COHORT_DIR
  let outputDir: string | null = null
  let live = false
  let model: Args["model"] = "deepseek-v4-flash"
  let thinking = false
  let maxTokens = DEFAULT_MAX_TOKENS
  let concurrency = DEFAULT_CONCURRENCY
  let promptMode = DEFAULT_PROMPT_MODE
  let chapterLimit: number | null = null
  let replicate: number | null = null
  let json = false
  const cellPaths: string[] = []
  const dimensions: Dimension[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--cohort-dir") cohortDir = requireValue(argv, ++i, "--cohort-dir")
    else if (arg.startsWith("--cohort-dir=")) cohortDir = arg.slice("--cohort-dir=".length)
    else if (arg === "--cell") cellPaths.push(requireValue(argv, ++i, "--cell"))
    else if (arg.startsWith("--cell=")) cellPaths.push(arg.slice("--cell=".length))
    else if (arg === "--output-dir") outputDir = requireValue(argv, ++i, "--output-dir")
    else if (arg.startsWith("--output-dir=")) outputDir = arg.slice("--output-dir=".length)
    else if (arg === "--live") live = true
    else if (arg === "--model") model = parseModel(requireValue(argv, ++i, "--model"))
    else if (arg.startsWith("--model=")) model = parseModel(arg.slice("--model=".length))
    else if (arg === "--thinking") thinking = true
    else if (arg === "--no-thinking") thinking = false
    else if (arg === "--max-tokens") maxTokens = parsePositiveInt(requireValue(argv, ++i, "--max-tokens"), "--max-tokens")
    else if (arg.startsWith("--max-tokens=")) maxTokens = parsePositiveInt(arg.slice("--max-tokens=".length), "--max-tokens")
    else if (arg === "--concurrency") concurrency = parsePositiveInt(requireValue(argv, ++i, "--concurrency"), "--concurrency")
    else if (arg.startsWith("--concurrency=")) concurrency = parsePositiveInt(arg.slice("--concurrency=".length), "--concurrency")
    else if (arg === "--mode") promptMode = parseMode(requireValue(argv, ++i, "--mode"))
    else if (arg.startsWith("--mode=")) promptMode = parseMode(arg.slice("--mode=".length))
    else if (arg === "--dimension") dimensions.push(parseDimension(requireValue(argv, ++i, "--dimension")))
    else if (arg.startsWith("--dimension=")) dimensions.push(parseDimension(arg.slice("--dimension=".length)))
    else if (arg === "--chapter-limit") chapterLimit = parsePositiveInt(requireValue(argv, ++i, "--chapter-limit"), "--chapter-limit")
    else if (arg.startsWith("--chapter-limit=")) chapterLimit = parsePositiveInt(arg.slice("--chapter-limit=".length), "--chapter-limit")
    else if (arg === "--replicate") replicate = parsePositiveInt(requireValue(argv, ++i, "--replicate"), "--replicate")
    else if (arg.startsWith("--replicate=")) replicate = parsePositiveInt(arg.slice("--replicate=".length), "--replicate")
    else if (arg === "--json") json = true
    else throw new Error(`unknown arg: ${arg}`)
  }
  if (model === "deepseek-v4-pro" && !argv.includes("--no-thinking")) thinking = true
  return {
    cohortDir,
    cellPaths,
    outputDir,
    live,
    model,
    thinking,
    maxTokens,
    concurrency,
    promptMode,
    dimensions: dimensions.length > 0 ? dimensions : DIMENSIONS,
    chapterLimit,
    replicate,
    json,
  }
}

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `output/method-pack-diagnostics/${stamp}/planner-discernment-real-data`
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/planner-discernment-real-data.ts [--live] [--cohort-dir <dir>] [--cell <path> ...] [--replicate <n>] [--chapter-limit <n>] [--dimension <name>] [--mode direct-label|evidence-first|gate-derived] [--output-dir <dir>] [--json]")
    return 2
  }
  if (!args.outputDir) args.outputDir = defaultOutputDir()
  const report = await buildRealDataReport(args)
  if (args.outputDir) {
    const abs = resolve(process.cwd(), args.outputDir)
    mkdirSync(abs, { recursive: true })
    writeFileSync(join(abs, "planner-discernment-real-data-report.json"), JSON.stringify(report, null, 2))
    writeFileSync(join(abs, "planner-discernment-real-data-report.md"), renderRealDataReport(report))
  }
  console.log(args.json ? JSON.stringify(report, null, 2) : renderRealDataReport(report))
  return 0
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function parseModel(value: string): Args["model"] {
  if (value === "deepseek-v4-flash" || value === "deepseek-v4-pro") return value
  throw new Error(`unsupported model: ${value}`)
}

function parseMode(value: string): PromptMode {
  if (value === "direct-label" || value === "evidence-first" || value === "gate-derived") return value
  throw new Error(`unsupported mode: ${value}`)
}

function parseDimension(value: string): Dimension {
  if (DIMENSIONS.includes(value as Dimension)) return value as Dimension
  throw new Error(`unsupported dimension: ${value}`)
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function fixtureIdFromPath(path: string): string {
  return basename(path).replace(/\.json$/, "")
}

function labelOrdinal(label: string): number {
  const match = label.match(/-(\d)$/)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function formatMean(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2)
}

function formatSigned(value: number): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}`
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatSignedPct(value: number): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${Math.round(value * 100)}%`
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
