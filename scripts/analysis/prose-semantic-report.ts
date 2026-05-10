#!/usr/bin/env bun
/**
 * Advisory prose-semantic diagnostics for real novel drafts.
 *
 * This attaches cheap DeepSeek V4 Flash prose-quality data to generated
 * chapters without changing planner, writer, checker, proposal, or promotion
 * behavior. Judge calls are persisted through `llm_calls`; a compact summary
 * is also written to `pipeline_events` when the run is live.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { z } from "zod"
import db from "../../src/db/connection"
import { callAgent } from "../../src/llm"
import { initNovelRun } from "../../src/logger"
import { setAutoMode, setResolverMode } from "../../src/cli"
import { getMode } from "../../src/gates"
import { trace } from "../../src/trace"

export type ProseSemanticDimension =
  | "dramatization"
  | "earnedLength"
  | "povVoice"
  | "payoffPropulsion"

export interface Args {
  novelId: string | null
  dimensions: ProseSemanticDimension[]
  dryRun: boolean
  json: boolean
  outputDir: string | null
  concurrency: number
  maxChapters: number
  approvedOnly: boolean
  traceSummary: boolean
}

export interface ProseSemanticChapterInput {
  novelId: string
  chapterNumber: number
  draftVersion: number | null
  draftStatus: string | null
  prose: string
  proseWords: number
  outline: any
}

export interface ProseSemanticResult {
  novelId: string
  chapterNumber: number
  draftVersion: number | null
  draftStatus: string | null
  chapterTitle: string
  dimension: ProseSemanticDimension
  label: string
  ordinal: number
  confidence: number
  evidence: {
    strength: string
    burden: string
    cue: string
  }
  reasoning: string
  missingForNextLevel: string
  targetWords: number | null
  proseWords: number
  wordRatio: number | null
  error?: string
}

export interface ProseSemanticReport {
  generatedAt: string
  novelId: string
  mode: "dry-run" | "DeepSeek V4 Flash"
  dimensions: ProseSemanticDimension[]
  chaptersJudged: number
  resultCount: number
  summaries: Array<{
    dimension: ProseSemanticDimension
    count: number
    meanOrdinal: number
    lowCount: number
    labelCounts: Record<string, number>
  }>
  saturationNotes: string[]
  telemetry: ProseSemanticTelemetry
  advisoryRecommendation: string
  results: ProseSemanticResult[]
}

export interface ProseSemanticTelemetry {
  lowRows: number
  errorRows: number
  highConfidenceLowRows: number
  saturatedDimensions: ProseSemanticDimension[]
  lowVarianceDimensions: ProseSemanticDimension[]
  dimensionMeans: Partial<Record<ProseSemanticDimension, number>>
  wordShape: {
    chaptersWithTargets: number
    meanWordRatio: number | null
    overTargetChapters: number
    severeOverTargetChapters: number
    underTargetChapters: number
  }
  chapterSummaries: Array<{
    chapterNumber: number
    draftVersion: number | null
    draftStatus: string | null
    targetWords: number | null
    proseWords: number
    wordRatio: number | null
    labels: Partial<Record<ProseSemanticDimension, string>>
    ordinals: Partial<Record<ProseSemanticDimension, number>>
    lowDimensions: ProseSemanticDimension[]
    errorDimensions: ProseSemanticDimension[]
  }>
  harnessGuidance: {
    lengthSignal: "not_falsified_as_padding" | "compression_candidate" | "incomplete" | "inconclusive"
    qualityRisk: "low" | "mixed" | "incomplete"
    nextProbe: string
  }
}

const DEFAULT_DIMENSIONS: ProseSemanticDimension[] = [
  "dramatization",
  "earnedLength",
  "povVoice",
  "payoffPropulsion",
]

const judgeSchema = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence: z.object({
    strength: z.string(),
    burden: z.string(),
    cue: z.string(),
  }),
  reasoning: z.string(),
  missingForNextLevel: z.string(),
})

export function parseArgs(argv: string[]): Args {
  let novelId: string | null = null
  const dimensions: ProseSemanticDimension[] = []
  let dryRun = false
  let json = false
  let outputDir: string | null = null
  let concurrency = 4
  let maxChapters = 50
  let approvedOnly = false
  let traceSummary = true

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eat = (): string => {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }
    if (arg === "--novel") { novelId = eat(); continue }
    if (arg === "--dimension") { dimensions.push(parseDimension(eat())); continue }
    if (arg === "--dry-run") { dryRun = true; continue }
    if (arg === "--json") { json = true; continue }
    if (arg === "--output-dir") { outputDir = eat(); continue }
    if (arg === "--concurrency") { concurrency = positiveInt(eat(), "--concurrency"); continue }
    if (arg === "--max-chapters") { maxChapters = positiveInt(eat(), "--max-chapters"); continue }
    if (arg === "--approved-only") { approvedOnly = true; continue }
    if (arg === "--no-trace-summary") { traceSummary = false; continue }
    throw new Error(`unknown arg: ${arg}`)
  }

  return {
    novelId,
    dimensions: dimensions.length > 0 ? dimensions : DEFAULT_DIMENSIONS,
    dryRun,
    json,
    outputDir,
    concurrency,
    maxChapters,
    approvedOnly,
    traceSummary,
  }
}

function parseDimension(value: string): ProseSemanticDimension {
  if (DEFAULT_DIMENSIONS.includes(value as ProseSemanticDimension)) return value as ProseSemanticDimension
  throw new Error(`unsupported --dimension ${value}; expected ${DEFAULT_DIMENSIONS.join(", ")}`)
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

export async function loadDbChapterInputs(
  novelId: string,
  opts: { maxChapters?: number; approvedOnly?: boolean } = {},
): Promise<ProseSemanticChapterInput[]> {
  const maxChapters = opts.maxChapters ?? 50
  const rows = opts.approvedOnly
    ? await db`
        SELECT DISTINCT ON (co.chapter_number)
          co.chapter_number,
          co.outline_json,
          cd.prose,
          cd.word_count,
          cd.version,
          cd.status
        FROM chapter_outlines co
        JOIN chapter_drafts cd
          ON cd.novel_id = co.novel_id
         AND cd.chapter_number = co.chapter_number
         AND cd.status = 'approved'
        WHERE co.novel_id = ${novelId}
          AND co.chapter_number <= ${maxChapters}
        ORDER BY co.chapter_number ASC, cd.version DESC
      `
    : await db`
        SELECT DISTINCT ON (co.chapter_number)
          co.chapter_number,
          co.outline_json,
          cd.prose,
          cd.word_count,
          cd.version,
          cd.status
        FROM chapter_outlines co
        JOIN chapter_drafts cd
          ON cd.novel_id = co.novel_id
         AND cd.chapter_number = co.chapter_number
        WHERE co.novel_id = ${novelId}
          AND co.chapter_number <= ${maxChapters}
        ORDER BY co.chapter_number ASC, cd.version DESC
      `

  return rows.map((row: any) => ({
    novelId,
    chapterNumber: Number(row.chapter_number),
    draftVersion: nullableNumber(row.version),
    draftStatus: typeof row.status === "string" ? row.status : null,
    prose: String(row.prose ?? ""),
    proseWords: Number(row.word_count ?? countWords(String(row.prose ?? ""))),
    outline: normalizeJson(row.outline_json),
  }))
}

function normalizeJson(value: unknown): any {
  if (typeof value === "string") {
    try { return JSON.parse(value) } catch { return {} }
  }
  return value && typeof value === "object" ? value : {}
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function renderChapterJudgePrompt(chapter: ProseSemanticChapterInput, dimension: ProseSemanticDimension): string {
  const outline = chapter.outline ?? {}
  const scenes = Array.isArray(outline.scenes) ? outline.scenes : []
  const sceneLines = scenes.map((scene: any, index: number) => {
    const contract = scene.contract ?? {}
    const valueIn = firstString(contract.valueIn, scene.valueIn)
    const valueOut = firstString(contract.valueOut, scene.valueOut)
    const valueShift = valueIn || valueOut ? `${valueIn ?? ""} -> ${valueOut ?? ""}` : "(none declared)"
    return [
      `Scene ${index + 1}:`,
      `  Kind: ${firstString(scene.kind, scene.structuralRole) ?? "(unspecified)"}`,
      `  Description: ${firstString(scene.description, scene.summary, scene.purpose) ?? "(none)"}`,
      `  Characters: ${formatCharacters(scene.characters)}`,
      `  Goal: ${firstString(contract.goal, scene.goal) ?? "(none)"}`,
      `  Opposition: ${firstString(contract.opposition, scene.opposition) ?? "(none)"}`,
      `  Turning point: ${firstString(contract.turningPoint, scene.turningPoint) ?? "(none)"}`,
      `  Crisis choice: ${firstString(contract.crisisChoice, scene.crisisChoice) ?? "(none)"}`,
      `  Outcome: ${firstString(contract.outcome, scene.outcome) ?? "(none)"}`,
      `  Consequence: ${firstString(contract.consequence, scene.consequence) ?? "(none)"}`,
      `  Value shift: ${valueShift}`,
    ].join("\n")
  })

  return [
    `DIMENSION TO JUDGE: ${dimension}`,
    ``,
    `CHAPTER CONTEXT`,
    `Chapter ${chapter.chapterNumber}: ${firstString(outline.title, outline.chapterTitle) ?? "(untitled)"}`,
    `POV: ${firstString(outline.povCharacter, outline.pov) ?? "(unspecified)"}`,
    `Purpose / endpoint: ${chapterPurpose(outline)}`,
    `Target words: ${targetWords(outline) ?? "(unspecified)"}`,
    `Actual words: ${chapter.proseWords}`,
    ``,
    `PLAN SUMMARIES (IDs intentionally omitted from judge prompt)`,
    sceneLines.join("\n\n") || "(no scenes)",
    ``,
    `CHAPTER PROSE`,
    chapter.prose.trim(),
  ].join("\n")
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

function formatCharacters(value: unknown): string {
  if (!Array.isArray(value)) return "(unspecified)"
  return value.map(item => typeof item === "string" ? item : item?.name ?? item?.id ?? "")
    .filter(Boolean)
    .join(", ") || "(unspecified)"
}

function chapterPurpose(outline: any): string {
  return firstString(
    outline.purpose,
    outline.endpointOrHook,
    outline.chapterFunction,
    outline.storyTurn,
    outline.summary,
  ) ?? "(none)"
}

function targetWords(outline: any): number | null {
  return typeof outline.targetWords === "number" && Number.isFinite(outline.targetWords)
    ? outline.targetWords
    : null
}

function stableProseJudgePrompt(dimension: ProseSemanticDimension): string {
  return `You are a diagnostic fiction-prose judge for Novel Harness.

Judge one generated chapter against one prose-effectiveness dimension.
This is advisory telemetry only. Do not rewrite, compact, block, or enforce a template.
Do not reward length by itself, schema completeness, IDs, tag names, or plot-template conformity.
Use the plan context only to understand intended chapter/scene work; judge what the prose itself earns on the page.
Use the lowest label whose evidence requirements are fully satisfied.
If longer prose earns its space through pressure, character lens, consequence, or reader pull, do not penalize it for being long.

Dimension: ${dimension}

${labelDefinitions(dimension)}

Return JSON only:
{
  "label": "${labelAlternatives(dimension)}",
  "confidence": 0.0-1.0,
  "evidence": {
    "strength": "short quote or concrete cue showing the strongest useful prose work",
    "burden": "short quote or concrete cue showing drag, padding, or missing work; write 'none obvious' if none",
    "cue": "short neutral cue naming where you saw the evidence"
  },
  "reasoning": "two concise sentences max",
  "missingForNextLevel": "what would need to be on the page for the next stronger label"
}`
}

function labelDefinitions(dimension: ProseSemanticDimension): string {
  if (dimension === "dramatization") {
    return `Dramatization labels:
- DRAMA-0: mostly synopsis, exposition, logistics, or plan restatement; little lived scene.
- DRAMA-1: some dramatized action exists, but key turns are summarized or skipped.
- DRAMA-2: playable dramatized chapter with concrete action/dialogue/interiority and visible turns.
- DRAMA-3: immersive dramatization where action, dialogue, interiority, and consequence integrate into felt scene turns.`
  }
  if (dimension === "earnedLength") {
    return `Earned-length labels:
- LENGTH-0: over-target prose is mostly drag: repetition, static description, re-explanation, or unsupported transition.
- LENGTH-1: some extra prose helps, but noticeable padding or delay weakens momentum; a shorter plan would likely improve it.
- LENGTH-2: most extra prose is earned by pressure, character reaction, specificity, consequence, or reader comprehension; some compression may still be possible.
- LENGTH-3: the length is fully earned; cutting materially would remove tension, character lens, causal clarity, or payoff force.`
  }
  if (dimension === "povVoice") {
    return `POV voice labels:
- VOICE-0: generic narration; the POV character could be swapped with little prose change.
- VOICE-1: POV motive is named, but voice/interiority remains mostly explanatory or generic.
- VOICE-2: POV desire, fear, value, or flaw shapes attention, choices, and interior pressure.
- VOICE-3: distinct character lens with motive, subtext, contradiction, and sentence-level selectivity.`
  }
  return `Payoff-propulsion labels:
- PAYOFF-0: planned chapter/scene turn, outcome, or consequence is absent.
- PAYOFF-1: turn/consequence is stated but weak, static, or not felt dramatically.
- PAYOFF-2: turn and consequence land clearly and change the local situation.
- PAYOFF-3: turn lands with strong forward propulsion: new danger, obligation, reveal, reversal, or next-page pull.`
}

function labelAlternatives(dimension: ProseSemanticDimension): string {
  const prefix = dimensionPrefix(dimension)
  return `${prefix}-0|${prefix}-1|${prefix}-2|${prefix}-3`
}

function dimensionPrefix(dimension: ProseSemanticDimension): string {
  if (dimension === "dramatization") return "DRAMA"
  if (dimension === "earnedLength") return "LENGTH"
  if (dimension === "povVoice") return "VOICE"
  return "PAYOFF"
}

export async function buildProseSemanticReport(
  input: {
    novelId: string
    chapters: ProseSemanticChapterInput[]
    dimensions: ProseSemanticDimension[]
    dryRun: boolean
    concurrency: number
  },
  generatedAt = new Date().toISOString(),
): Promise<ProseSemanticReport> {
  const tasks: Array<() => Promise<ProseSemanticResult>> = []
  for (const chapter of input.chapters) {
    for (const dimension of input.dimensions) {
      tasks.push(() => judgeChapter(chapter, dimension, input.dryRun))
    }
  }
  const results = await runBounded(tasks, input.concurrency)
  const summaries = input.dimensions.map(dimension => summarizeDimension(
    dimension,
    results.filter(row => row.dimension === dimension && !row.error),
  ))
  const report: ProseSemanticReport = {
    generatedAt,
    novelId: input.novelId,
    mode: input.dryRun ? "dry-run" : "DeepSeek V4 Flash",
    dimensions: input.dimensions,
    chaptersJudged: new Set(results.map(row => row.chapterNumber)).size,
    resultCount: results.length,
    summaries,
    saturationNotes: saturationNotes(input.dimensions, results),
    telemetry: buildTelemetry(input.dimensions, summaries, results),
    advisoryRecommendation: advisoryRecommendation(summaries, results),
    results,
  }
  return report
}

async function judgeChapter(
  chapter: ProseSemanticChapterInput,
  dimension: ProseSemanticDimension,
  dryRun: boolean,
): Promise<ProseSemanticResult> {
  const outline = chapter.outline ?? {}
  const target = targetWords(outline)
  const base = {
    novelId: chapter.novelId,
    chapterNumber: chapter.chapterNumber,
    draftVersion: chapter.draftVersion,
    draftStatus: chapter.draftStatus,
    chapterTitle: firstString(outline.title, outline.chapterTitle) ?? `Chapter ${chapter.chapterNumber}`,
    dimension,
    targetWords: target,
    proseWords: chapter.proseWords,
    wordRatio: target && target > 0 ? chapter.proseWords / target : null,
  }

  if (dryRun) {
    const prefix = dimensionPrefix(dimension)
    return {
      ...base,
      label: `${prefix}-2`,
      ordinal: 2,
      confidence: 0.75,
      evidence: { strength: "synthetic strength", burden: "synthetic burden", cue: "dry-run" },
      reasoning: "Synthetic dry-run result.",
      missingForNextLevel: "Run without --dry-run for DeepSeek judgment.",
    }
  }

  try {
    const response = await callAgent({
      novelId: chapter.novelId,
      agentName: `prose-semantic-${dimension}`,
      chapter: chapter.chapterNumber,
      systemPrompt: stableProseJudgePrompt(dimension),
      userPrompt: renderChapterJudgePrompt(chapter, dimension),
      schema: judgeSchema,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      temperature: 0.1,
      maxTokens: 700,
      logMetadata: {
        diagnostic: "prose-semantic",
        dimension,
        draftVersion: chapter.draftVersion,
        draftStatus: chapter.draftStatus,
      },
    })
    const output = normalizeOutput(response.output, dimension)
    return {
      ...base,
      label: output.label,
      ordinal: labelOrdinal(output.label),
      confidence: output.confidence,
      evidence: output.evidence,
      reasoning: output.reasoning,
      missingForNextLevel: output.missingForNextLevel,
    }
  } catch (err) {
    const prefix = dimensionPrefix(dimension)
    return {
      ...base,
      label: `${prefix}-0`,
      ordinal: 0,
      confidence: 0,
      evidence: { strength: "", burden: "", cue: "" },
      reasoning: "",
      missingForNextLevel: "",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function normalizeOutput(raw: unknown, dimension: ProseSemanticDimension): z.infer<typeof judgeSchema> & { label: string } {
  const parsed = judgeSchema.parse(raw)
  return {
    ...parsed,
    label: normalizeLabel(parsed.label, dimension),
  }
}

function normalizeLabel(label: string, dimension: ProseSemanticDimension): string {
  const prefix = dimensionPrefix(dimension)
  const match = label.toUpperCase().match(/([A-Z]+)-?([0-3])/u)
  if (!match) return `${prefix}-0`
  return `${prefix}-${match[2]}`
}

function labelOrdinal(label: string): number {
  const match = label.match(/([0-3])$/u)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

function summarizeDimension(dimension: ProseSemanticDimension, rows: ProseSemanticResult[]): ProseSemanticReport["summaries"][number] {
  const labelCounts: Record<string, number> = {}
  for (const row of rows) labelCounts[row.label] = (labelCounts[row.label] ?? 0) + 1
  return {
    dimension,
    count: rows.length,
    meanOrdinal: round(mean(rows.map(row => row.ordinal))),
    lowCount: rows.filter(row => row.ordinal <= 1).length,
    labelCounts,
  }
}

function saturationNotes(dimensions: ProseSemanticDimension[], results: ProseSemanticResult[]): string[] {
  const notes: string[] = []
  for (const dimension of dimensions) {
    const rows = results.filter(row => row.dimension === dimension && !row.error)
    if (rows.length < 4) continue
    const labels = new Set(rows.map(row => row.label))
    if (labels.size === 1) {
      const label = [...labels][0]!
      notes.push(`${dimension} saturated at ${label} across ${rows.length} judgments; treat it as a floor check, not a discriminator.`)
      continue
    }
    const ordinals = new Set(rows.map(row => row.ordinal))
    if (ordinals.size === 2 && Math.max(...ordinals) - Math.min(...ordinals) === 1) {
      const majority = mostCommonLabel(rows.map(row => row.label))
      if (majority.count / rows.length >= 0.8) {
        notes.push(`${dimension} is low-variance (${majority.label} in ${majority.count}/${rows.length} judgments); use evidence quotes before drawing run-level conclusions.`)
      }
    }
  }
  return notes
}

function buildTelemetry(
  dimensions: ProseSemanticDimension[],
  summaries: ProseSemanticReport["summaries"],
  results: ProseSemanticResult[],
): ProseSemanticTelemetry {
  const lowRows = results.filter(row => !row.error && row.ordinal <= 1).length
  const errorRows = results.filter(row => row.error).length
  const highConfidenceLowRows = results.filter(row => !row.error && row.ordinal <= 1 && row.confidence >= 0.75).length
  const saturatedDimensions: ProseSemanticDimension[] = []
  const lowVarianceDimensions: ProseSemanticDimension[] = []
  for (const dimension of dimensions) {
    const rows = results.filter(row => row.dimension === dimension && !row.error)
    if (rows.length < 4) continue
    const labels = new Set(rows.map(row => row.label))
    if (labels.size === 1) {
      saturatedDimensions.push(dimension)
      continue
    }
    const ordinals = new Set(rows.map(row => row.ordinal))
    if (ordinals.size === 2 && Math.max(...ordinals) - Math.min(...ordinals) === 1) {
      const majority = mostCommonLabel(rows.map(row => row.label))
      if (majority.count / rows.length >= 0.8) lowVarianceDimensions.push(dimension)
    }
  }

  const dimensionMeans = Object.fromEntries(
    summaries.map(summary => [summary.dimension, summary.meanOrdinal]),
  ) as Partial<Record<ProseSemanticDimension, number>>
  const chapterSummaries = buildChapterSummaries(results)
  const ratios = chapterSummaries.map(row => row.wordRatio).filter((value): value is number => value !== null)
  const wordShape = {
    chaptersWithTargets: ratios.length,
    meanWordRatio: ratios.length > 0 ? round(mean(ratios)) : null,
    overTargetChapters: ratios.filter(value => value > 1.25).length,
    severeOverTargetChapters: ratios.filter(value => value > 1.5).length,
    underTargetChapters: ratios.filter(value => value < 0.75).length,
  }
  return {
    lowRows,
    errorRows,
    highConfidenceLowRows,
    saturatedDimensions,
    lowVarianceDimensions,
    dimensionMeans,
    wordShape,
    chapterSummaries,
    harnessGuidance: harnessGuidance({
      errorRows,
      lowRows,
      earnedMean: dimensionMeans.earnedLength ?? null,
      severeOverTargetChapters: wordShape.severeOverTargetChapters,
      saturatedDimensions,
      lowVarianceDimensions,
    }),
  }
}

function buildChapterSummaries(results: ProseSemanticResult[]): ProseSemanticTelemetry["chapterSummaries"] {
  const byChapter = new Map<number, ProseSemanticTelemetry["chapterSummaries"][number]>()
  for (const row of results) {
    const current = byChapter.get(row.chapterNumber) ?? {
      chapterNumber: row.chapterNumber,
      draftVersion: row.draftVersion,
      draftStatus: row.draftStatus,
      targetWords: row.targetWords,
      proseWords: row.proseWords,
      wordRatio: row.wordRatio,
      labels: {},
      ordinals: {},
      lowDimensions: [],
      errorDimensions: [],
    }
    current.labels[row.dimension] = row.label
    current.ordinals[row.dimension] = row.ordinal
    if (row.error) current.errorDimensions.push(row.dimension)
    else if (row.ordinal <= 1) current.lowDimensions.push(row.dimension)
    byChapter.set(row.chapterNumber, current)
  }
  return [...byChapter.values()].sort((a, b) => a.chapterNumber - b.chapterNumber)
}

function harnessGuidance(input: {
  errorRows: number
  lowRows: number
  earnedMean: number | null
  severeOverTargetChapters: number
  saturatedDimensions: readonly ProseSemanticDimension[]
  lowVarianceDimensions: readonly ProseSemanticDimension[]
}): ProseSemanticTelemetry["harnessGuidance"] {
  const qualityRisk = input.errorRows > 0 ? "incomplete" : input.lowRows > 0 ? "mixed" : "low"
  let lengthSignal: ProseSemanticTelemetry["harnessGuidance"]["lengthSignal"] = "inconclusive"
  if (input.errorRows > 0) lengthSignal = "incomplete"
  else if (input.earnedMean !== null && input.earnedMean < 2 && input.severeOverTargetChapters > 0) lengthSignal = "compression_candidate"
  else if (input.earnedMean !== null && input.earnedMean >= 2) lengthSignal = "not_falsified_as_padding"

  const flat = [...input.saturatedDimensions, ...input.lowVarianceDimensions]
  const nextProbe = flat.length > 0
    ? `Refine or calibrate low-variance dimensions before treating ${flat.join(", ")} as optimization targets.`
    : lengthSignal === "compression_candidate"
      ? "Compare planner scope and scene-contract load against low earned-length rows."
      : "Use this run as comparative telemetry; do not convert advisory labels into gates."

  return { lengthSignal, qualityRisk, nextProbe }
}

function advisoryRecommendation(
  summaries: ProseSemanticReport["summaries"],
  results: ProseSemanticResult[],
): string {
  const errors = results.filter(row => row.error).length
  const lows = results.filter(row => !row.error && row.ordinal <= 1).length
  if (errors > 0) return `Advisory telemetry incomplete: ${errors} judge call(s) errored; preserve the artifact but do not interpret missing rows as quality signal.`
  if (lows > 0) return `Advisory review: inspect ${lows} low semantic row(s) before using this run as positive evidence.`
  const earned = summaries.find(row => row.dimension === "earnedLength")?.meanOrdinal ?? null
  if (earned !== null && earned >= 2) {
    return "Advisory review: prose length is not currently falsified as padding; use evidence quotes and saturation notes before changing planner scope."
  }
  return "Advisory review: no blocking conclusion; preserve the data point for comparison across runs."
}

function mostCommonLabel(labels: string[]): { label: string; count: number } {
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  let best = { label: "", count: 0 }
  for (const [label, count] of counts) {
    if (count > best.count) best = { label, count }
  }
  return best
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

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function renderProseSemanticReport(report: ProseSemanticReport): string {
  const lines: string[] = []
  lines.push("# Prose Semantic Diagnostics")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Novel: ${report.novelId}`)
  lines.push(`Mode: ${report.mode}`)
  lines.push(`Dimensions: ${report.dimensions.join(", ")}`)
  lines.push(`Chapters judged: ${report.chaptersJudged}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push("| Dimension | Mean | Low | Labels |")
  lines.push("| --- | ---: | ---: | --- |")
  for (const summary of report.summaries) {
    const counts = Object.entries(summary.labelCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => `${label}:${count}`)
      .join(" ")
    lines.push(`| ${summary.dimension} | ${summary.meanOrdinal.toFixed(2)} | ${summary.lowCount}/${summary.count} | ${counts} |`)
  }
  lines.push("")
  lines.push(`Recommendation: ${report.advisoryRecommendation}`)
  lines.push("")
  lines.push("## Telemetry")
  lines.push("")
  lines.push(`- Rows: total=${report.resultCount}, low=${report.telemetry.lowRows}, high-confidence-low=${report.telemetry.highConfidenceLowRows}, errors=${report.telemetry.errorRows}`)
  lines.push(`- Word shape: chaptersWithTargets=${report.telemetry.wordShape.chaptersWithTargets}, meanRatio=${report.telemetry.wordShape.meanWordRatio === null ? "?" : report.telemetry.wordShape.meanWordRatio.toFixed(2)}, overTarget=${report.telemetry.wordShape.overTargetChapters}, severeOverTarget=${report.telemetry.wordShape.severeOverTargetChapters}, underTarget=${report.telemetry.wordShape.underTargetChapters}`)
  lines.push(`- Harness guidance: lengthSignal=${report.telemetry.harnessGuidance.lengthSignal}, qualityRisk=${report.telemetry.harnessGuidance.qualityRisk}`)
  lines.push(`- Next probe: ${report.telemetry.harnessGuidance.nextProbe}`)

  if (report.saturationNotes.length > 0) {
    lines.push("")
    lines.push("## Saturation Notes")
    lines.push("")
    for (const note of report.saturationNotes) lines.push(`- ${note}`)
  }

  const attention = report.results.filter(row => row.error || row.ordinal <= 1)
  if (attention.length > 0) {
    lines.push("")
    lines.push("## Low / Error Rows")
    lines.push("")
    for (const row of attention) {
      lines.push(`- ch${row.chapterNumber} ${row.dimension} ${row.label}: ${row.error ?? row.missingForNextLevel}`)
    }
  }

  lines.push("")
  lines.push("## Chapter Rows")
  lines.push("")
  for (const row of report.results) {
    lines.push(`- ch${row.chapterNumber} v${row.draftVersion ?? "?"} ${row.dimension} ${row.label} confidence=${row.confidence.toFixed(2)} ratio=${row.wordRatio === null ? "?" : row.wordRatio.toFixed(2)}`)
  }

  lines.push("")
  lines.push("## Guardrails")
  lines.push("")
  lines.push("- Diagnostic only: results do not rewrite, compact, block, or promote prose.")
  lines.push("- Raw traceability IDs are omitted from judge prompts and remain metadata only.")
  lines.push("- Treat saturated dimensions as telemetry, not proof.")
  return `${lines.join("\n")}\n`
}

export async function writeProseSemanticReport(report: ProseSemanticReport, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, "prose-semantic-report.json"), JSON.stringify(report, null, 2), "utf8")
  await writeFile(join(outputDir, "prose-semantic-report.md"), renderProseSemanticReport(report), "utf8")
}

export async function traceProseSemanticSummary(report: ProseSemanticReport, outputDir: string | null): Promise<void> {
  await trace(report.novelId, {
    eventType: "prose-semantic-eval",
    agent: "diagnostics:prose-semantic",
    payload: {
      generatedAt: report.generatedAt,
      mode: report.mode,
      dimensions: report.dimensions,
      chaptersJudged: report.chaptersJudged,
      resultCount: report.resultCount,
      lowRows: report.results.filter(row => !row.error && row.ordinal <= 1).length,
      errorRows: report.results.filter(row => row.error).length,
      summaries: report.summaries,
      saturationNotes: report.saturationNotes,
      telemetry: report.telemetry,
      outputDir,
    },
  })
}

export async function runProseSemanticForNovel(opts: {
  novelId: string
  dimensions?: ProseSemanticDimension[]
  dryRun?: boolean
  concurrency?: number
  maxChapters?: number
  approvedOnly?: boolean
  outputDir?: string | null
  initRun?: boolean
  traceSummary?: boolean
  generatedAt?: string
}): Promise<{ report: ProseSemanticReport; outputDir: string }> {
  if (!opts.dryRun && opts.initRun !== false) await initNovelRun(opts.novelId)
  const chapters = await loadDbChapterInputs(opts.novelId, {
    maxChapters: opts.maxChapters ?? 50,
    approvedOnly: opts.approvedOnly ?? false,
  })
  if (chapters.length === 0) throw new Error(`no drafted chapters found for ${opts.novelId}`)
  const report = await buildProseSemanticReport({
    novelId: opts.novelId,
    chapters,
    dimensions: opts.dimensions ?? DEFAULT_DIMENSIONS,
    dryRun: opts.dryRun ?? false,
    concurrency: opts.concurrency ?? 4,
  }, opts.generatedAt)
  const outputDir = resolve(process.cwd(), opts.outputDir ?? defaultOutputDir(opts.novelId))
  await writeProseSemanticReport(report, outputDir)
  if (!opts.dryRun && opts.traceSummary !== false) await traceProseSemanticSummary(report, outputDir)
  return { report, outputDir }
}

function defaultOutputDir(novelId: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `output/prose-semantic-eval/${safePathSegment(novelId)}/${stamp}`
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "novel"
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/prose-semantic-report.ts --novel <novelId> [--dry-run] [--dimension earnedLength] [--output-dir <dir>]")
    return 2
  }
  if (!args.novelId) {
    console.error("usage: bun scripts/analysis/prose-semantic-report.ts --novel <novelId> [--dry-run] [--dimension earnedLength] [--output-dir <dir>]")
    return 2
  }

  setAutoMode(true)
  setResolverMode(getMode(true))

  try {
    const { report, outputDir } = await runProseSemanticForNovel({
      novelId: args.novelId,
      dimensions: args.dimensions,
      dryRun: args.dryRun,
      concurrency: args.concurrency,
      maxChapters: args.maxChapters,
      approvedOnly: args.approvedOnly,
      outputDir: args.outputDir,
      traceSummary: args.traceSummary,
    })
    console.log(args.json ? JSON.stringify(report, null, 2) : renderProseSemanticReport(report))
    console.log(`wrote ${join(outputDir, "prose-semantic-report.json")}`)
    console.log(`wrote ${join(outputDir, "prose-semantic-report.md")}`)
    return 0
  } finally {
    await db.end().catch(() => {})
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
