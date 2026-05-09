#!/usr/bin/env bun
/**
 * Diagnostic-only AI prose quality review for corpus recreation POC outputs.
 *
 * This is a pre-review triage layer. It reads local artifacts, optionally calls
 * DeepSeek, and writes advisory JSON/Markdown. It does not block, rewrite,
 * mutate plans, create proposals, or promote variants.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  RUN_MANIFEST_FILENAME,
  artifactRef,
  buildRunManifest,
  existingArtifactRefs,
  parentManifestForPocDir,
  writeRunManifest,
} from "./run-manifest"

type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro"
type ProseDimension = "dramatization" | "commercialPacing" | "povVoice" | "payoffPropulsion"
type Attention = "skip" | "skim" | "review"

interface Args {
  pocDir: string
  outputDir: string | null
  live: boolean
  model: ModelId
  thinking: boolean
  maxTokens: number
  concurrency: number
  dimensions: ProseDimension[]
}

interface Packet {
  sourceReference?: { book?: string; chapterLabel?: string }
  originalAnalogSeed?: {
    genreLane?: string
    premise?: string
    readerPromise?: string
    protagonist?: {
      name?: string
      want?: string
      need?: string
      lie?: string
      truth?: string
    }
  }
  diagnosticConfig?: { plannerVariant?: string }
}

interface Plan {
  chapterId: string
  title: string
  chapterFunction: string
  endpointOrHook: string
  scenes: ScenePlan[]
  obligations: Obligation[]
}

interface ScenePlan {
  sceneId: string
  referenceSceneOrdinal: number
  targetWords: number
  structuralRole: string
  goal: string
  opposition: string
  turningPoint: string
  crisisChoice: string
  outcome: string
  consequence: string
  valueIn: string
  valueOut: string
  miceThread: string
  beatHints?: Array<{ kind: string; purpose: string }>
}

interface Obligation {
  obligationId: string
  sceneId: string
  sourceId: string
  threadId?: string
  promiseId?: string
  payoffId?: string
  requirementText: string
  materialityTest?: string
}

interface Chapter {
  scenes: Array<{ sceneId: string; prose: string }>
}

export interface ProseReviewTask {
  taskId: string
  pocDir: string
  sceneId: string
  sceneIndex: number
  dimension: ProseDimension
  prompt: string
}

export interface ProseJudgeOutput {
  label: string
  confidence: number
  evidence: {
    strength: string
    weakness: string
    cue: string
  }
  missingForNextLevel: string
}

export interface ProseReviewResult extends ProseReviewTask {
  label: string
  ordinal: number
  confidence: number
  attention: Attention
  output: ProseJudgeOutput
}

export interface ProseReviewReport {
  generatedAt: string
  pocDir: string
  source: {
    book: string | null
    chapterLabel: string | null
  }
  plannerVariant: string
  live: boolean
  model: ModelId
  thinking: boolean
  dimensions: ProseDimension[]
  sceneCount: number
  resultCount: number
  results: ProseReviewResult[]
  summaries: Array<{
    dimension: ProseDimension
    count: number
    meanOrdinal: number
    lowCount: number
    reviewCount: number
    labelCounts: Record<string, number>
  }>
  operatorAttention: Array<{
    sceneId: string
    dimensions: ProseDimension[]
    reasons: string[]
  }>
}

const DEFAULT_POC_DIR = "output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1"
const DEFAULT_DIMENSIONS: ProseDimension[] = [
  "dramatization",
  "commercialPacing",
  "povVoice",
  "payoffPropulsion",
]

export async function buildCorpusRecreationProseReviewReport(
  args: Args,
  generatedAt = new Date().toISOString(),
): Promise<ProseReviewReport> {
  const absPocDir = resolve(process.cwd(), args.pocDir)
  const packet = readJson<Packet>(join(absPocDir, "packet.json"))
  const plan = readJson<Plan>(join(absPocDir, "plan.json"))
  const chapter = readJson<Chapter>(join(absPocDir, "chapter.json"))
  const tasks = buildProseReviewTasks({
    pocDir: args.pocDir,
    packet,
    plan,
    chapter,
    dimensions: args.dimensions,
  })
  const results = await runBounded(
    tasks.map(task => async () => {
      const output = args.live
        ? await callDeepSeekProseJudge(args, task)
        : syntheticOutput(task)
      const label = normalizeLabel(output.label, task.dimension)
      const ordinal = labelOrdinal(label)
      const confidence = clampNumber(output.confidence, 0, 1)
      return {
        ...task,
        label,
        ordinal,
        confidence,
        attention: attentionFor(ordinal, confidence),
        output: { ...output, label, confidence },
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
    plannerVariant: packet.diagnosticConfig?.plannerVariant ?? "baseline",
    live: args.live,
    model: args.model,
    thinking: args.thinking,
    dimensions: args.dimensions,
    sceneCount: plan.scenes.length,
    resultCount: results.length,
    results,
    summaries: summarizeResults(results),
    operatorAttention: buildAttentionQueue(results),
  }
}

export function buildProseReviewTasks(input: {
  pocDir: string
  packet: Packet
  plan: Plan
  chapter: Chapter
  dimensions: ProseDimension[]
}): ProseReviewTask[] {
  const tasks: ProseReviewTask[] = []
  for (let sceneIndex = 0; sceneIndex < input.plan.scenes.length; sceneIndex += 1) {
    const scene = input.plan.scenes[sceneIndex]!
    const prose = input.chapter.scenes.find(row => row.sceneId === scene.sceneId)?.prose ?? ""
    const obligations = input.plan.obligations.filter(row => row.sceneId === scene.sceneId)
    for (const dimension of input.dimensions) {
      tasks.push({
        taskId: `${scene.sceneId}:${dimension}`,
        pocDir: input.pocDir,
        sceneId: scene.sceneId,
        sceneIndex,
        dimension,
        prompt: renderSceneQualityPrompt({
          packet: input.packet,
          plan: input.plan,
          scene,
          prose,
          obligations,
          dimension,
        }),
      })
    }
  }
  return tasks
}

export function renderProseReviewReport(report: ProseReviewReport): string {
  const lines: string[] = []
  lines.push("# Corpus Recreation Prose Review")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`POC dir: ${report.pocDir}`)
  lines.push(`Source: ${report.source.book ?? "unknown"} chapter ${report.source.chapterLabel ?? "?"}`)
  lines.push(`Variant: ${report.plannerVariant}`)
  lines.push(`Model: ${report.model}; live=${report.live}; thinking=${report.thinking}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push("| Dimension | Count | Mean | Low | Review | Labels |")
  lines.push("| --- | ---: | ---: | ---: | ---: | --- |")
  for (const summary of report.summaries) {
    lines.push([
      `| ${summary.dimension}`,
      summary.count,
      summary.meanOrdinal.toFixed(2),
      summary.lowCount,
      summary.reviewCount,
      `${formatCounts(summary.labelCounts)} |`,
    ].join(" | "))
  }
  lines.push("")
  lines.push("## Operator Attention")
  lines.push("")
  if (report.operatorAttention.length === 0) {
    lines.push("- none")
  } else {
    for (const item of report.operatorAttention) {
      lines.push(`- ${item.sceneId}: ${item.dimensions.join(", ")} - ${item.reasons.join("; ")}`)
    }
  }
  lines.push("")
  lines.push("## Findings")
  for (const result of report.results.filter(row => row.attention !== "skip")) {
    lines.push(`- ${result.sceneId} ${result.dimension} ${result.label} (${result.attention}): ${result.output.missingForNextLevel}`)
  }
  return `${lines.join("\n")}\n`
}

function renderSceneQualityPrompt(input: {
  packet: Packet
  plan: Plan
  scene: ScenePlan
  prose: string
  obligations: Obligation[]
  dimension: ProseDimension
}): string {
  const seed = input.packet.originalAnalogSeed ?? {}
  return `REQUIRED EVIDENCE

Genre lane: ${seed.genreLane ?? ""}
Premise: ${seed.premise ?? ""}
Reader promise: ${seed.readerPromise ?? ""}
Protagonist: ${seed.protagonist?.name ?? ""}
Want: ${seed.protagonist?.want ?? ""}
Need: ${seed.protagonist?.need ?? ""}
Lie: ${seed.protagonist?.lie ?? ""}
Truth: ${seed.protagonist?.truth ?? ""}

Chapter title: ${input.plan.title}
Chapter function: ${input.plan.chapterFunction}
Chapter endpoint/hook: ${input.plan.endpointOrHook}

Scene contract:
${JSON.stringify({
    sceneId: input.scene.sceneId,
    targetWords: input.scene.targetWords,
    structuralRole: input.scene.structuralRole,
    goal: input.scene.goal,
    opposition: input.scene.opposition,
    turningPoint: input.scene.turningPoint,
    crisisChoice: input.scene.crisisChoice,
    outcome: input.scene.outcome,
    consequence: input.scene.consequence,
    valueShift: `${input.scene.valueIn} -> ${input.scene.valueOut}`,
    miceThread: input.scene.miceThread,
    obligations: input.obligations,
  }, null, 2)}

Dimension to judge: ${input.dimension}

Scene prose:
${input.prose}`
}

async function callDeepSeekProseJudge(args: Args, task: ProseReviewTask): Promise<ProseJudgeOutput> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error("DEEPSEEK_API_KEY not set in environment")
  const timeoutMs = args.model === "deepseek-v4-pro" ? 180_000 : 90_000
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new Error(`DeepSeek ${args.model} timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    try {
      console.log(`  [prose-review] ${args.model} ${task.taskId} attempt=${attempt}`)
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: args.model,
          messages: [
            { role: "system", content: stableProseJudgePrompt(task.dimension) },
            { role: "user", content: task.prompt },
          ],
          temperature: 0,
          max_tokens: args.maxTokens,
          response_format: { type: "json_object" },
          thinking: { type: args.thinking ? "enabled" : "disabled" },
        }),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`DeepSeek ${args.model} ${response.status}: ${text.slice(0, 500)}`)
      const data = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number }
      }
      const content = data.choices?.[0]?.message?.content ?? ""
      const finishReason = data.choices?.[0]?.finish_reason ?? "unknown"
      const cached = data.usage?.prompt_cache_hit_tokens ?? 0
      const promptTokens = data.usage?.prompt_tokens ?? 0
      const completionTokens = data.usage?.completion_tokens ?? 0
      console.log(`  [prose-review] response ${promptTokens}+${completionTokens} tokens${cached > 0 ? ` [cache:${cached}]` : ""}; finish=${finishReason}`)
      if (finishReason === "length") throw new Error(`DeepSeek ${args.model} hit max token cap`)
      return normalizeOutput(JSON.parse(extractJsonObject(content)), task.dimension)
    } catch (error) {
      lastError = error
      console.warn(`  [prose-review] ${task.taskId} failed: ${error instanceof Error ? error.message : String(error)}`)
      if (attempt >= 2) break
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function stableProseJudgePrompt(dimension: ProseDimension): string {
  return `You are a diagnostic prose quality reviewer for Novel Harness.

Review one generated fiction scene against one prose-quality dimension.
This is advisory pre-review triage, not a blocker, rewrite instruction, or promotion decision.
Judge the prose against the provided scene contract and commercial fantasy-adventure reader promise.
Do not judge source similarity. Do not reward length by itself. Use concrete evidence from the scene prose.

Dimension: ${dimension}

${labelDefinitions(dimension)}

Return JSON only:
{
  "label": "${labelAlternatives(dimension)}",
  "confidence": 0.0-1.0,
  "evidence": {
    "strength": "specific strength visible in the prose",
    "weakness": "specific weakness visible in the prose",
    "cue": "short cue or paraphrase from the prose/contract"
  },
  "missingForNextLevel": "what is missing for the next stronger level"
}`
}

function labelDefinitions(dimension: ProseDimension): string {
  if (dimension === "dramatization") {
    return `Dramatization labels:
- DRAMA-0: Mostly synopsis, exposition, or plan restatement. Little playable action.
- DRAMA-1: Some dramatized action exists, but the scene still summarizes key turns or skips lived beats.
- DRAMA-2: Playable dramatized scene with concrete action, setting, interior pressure, and visible turn.
- DRAMA-3: Immersive dramatized scene with action/dialogue/interiority integrated into a felt consequential turn.`
  }
  if (dimension === "commercialPacing") {
    return `Commercial pacing labels:
- PACE-0: Confusing, inert, or hard to read as commercial fiction.
- PACE-1: Clear enough, but flat, padded, rushed, or exposition-heavy.
- PACE-2: Clear commercial pacing with forward motion, readable paragraphs, and controlled exposition.
- PACE-3: Strong page-turning rhythm with escalation, varied beats, and momentum through the scene ending.`
  }
  if (dimension === "povVoice") {
    return `POV voice labels:
- VOICE-0: Generic narration; POV character could be swapped without changing prose.
- VOICE-1: POV motive is named but voice/interiority remains generic or explanatory.
- VOICE-2: POV desire, fear, value, or flaw shapes choices, attention, and interior pressure.
- VOICE-3: Distinct character lens with motive, subtext, and emotional contradiction shaping sentence-level choices.`
  }
  return `Payoff propulsion labels:
- PAYOFF-0: Scene turn, outcome, or consequence from the plan is absent.
- PAYOFF-1: Turn/consequence is stated but weak, static, or not felt in the prose.
- PAYOFF-2: Planned turn and consequence land clearly and change the local situation.
- PAYOFF-3: Turn lands with strong forward propulsion: new danger, obligation, reveal, reversal, or next-page pull.`
}

function summarizeResults(results: ProseReviewResult[]): ProseReviewReport["summaries"] {
  const byDimension = new Map<ProseDimension, ProseReviewResult[]>()
  for (const result of results) byDimension.set(result.dimension, [...(byDimension.get(result.dimension) ?? []), result])
  return [...byDimension.entries()].map(([dimension, rows]) => {
    const labelCounts: Record<string, number> = {}
    for (const row of rows) labelCounts[row.label] = (labelCounts[row.label] ?? 0) + 1
    return {
      dimension,
      count: rows.length,
      meanOrdinal: round(mean(rows.map(row => row.ordinal))),
      lowCount: rows.filter(row => row.ordinal <= 1).length,
      reviewCount: rows.filter(row => row.attention === "review").length,
      labelCounts,
    }
  })
}

function buildAttentionQueue(results: ProseReviewResult[]): ProseReviewReport["operatorAttention"] {
  const byScene = new Map<string, ProseReviewResult[]>()
  for (const result of results.filter(row => row.attention === "review")) {
    byScene.set(result.sceneId, [...(byScene.get(result.sceneId) ?? []), result])
  }
  return [...byScene.entries()].map(([sceneId, rows]) => ({
    sceneId,
    dimensions: rows.map(row => row.dimension),
    reasons: rows.map(row => `${row.dimension} ${row.label}: ${row.output.missingForNextLevel}`).filter(Boolean),
  }))
}

function attentionFor(ordinal: number, confidence: number): Attention {
  if (ordinal <= 1) return "review"
  if (ordinal === 2 && confidence < 0.6) return "skim"
  return "skip"
}

function normalizeOutput(raw: any, dimension: ProseDimension): ProseJudgeOutput {
  return {
    label: normalizeLabel(String(raw?.label ?? ""), dimension),
    confidence: clampNumber(Number(raw?.confidence ?? 0.5), 0, 1),
    evidence: {
      strength: String(raw?.evidence?.strength ?? ""),
      weakness: String(raw?.evidence?.weakness ?? ""),
      cue: String(raw?.evidence?.cue ?? ""),
    },
    missingForNextLevel: String(raw?.missingForNextLevel ?? ""),
  }
}

function syntheticOutput(task: ProseReviewTask): ProseJudgeOutput {
  const prefix = dimensionPrefix(task.dimension)
  return {
    label: `${prefix}-2`,
    confidence: 0.75,
    evidence: {
      strength: "synthetic pass evidence",
      weakness: "synthetic missing nuance",
      cue: task.sceneId,
    },
    missingForNextLevel: "synthetic report only; run with --live for model judgment",
  }
}

function normalizeLabel(label: string, dimension: ProseDimension): string {
  const prefix = dimensionPrefix(dimension)
  const match = label.toUpperCase().match(/([A-Z]+)-?([0-3])/u)
  if (!match) return `${prefix}-0`
  const ordinal = match[2]
  return `${prefix}-${ordinal}`
}

function labelAlternatives(dimension: ProseDimension): string {
  const prefix = dimensionPrefix(dimension)
  return `${prefix}-0|${prefix}-1|${prefix}-2|${prefix}-3`
}

function labelOrdinal(label: string): number {
  const match = label.match(/([0-3])$/u)
  return match ? Number(match[1]) : 0
}

function dimensionPrefix(dimension: ProseDimension): string {
  if (dimension === "dramatization") return "DRAMA"
  if (dimension === "commercialPacing") return "PACE"
  if (dimension === "povVoice") return "VOICE"
  return "PAYOFF"
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const values: Record<string, string | true> = {}
  const dimensions: ProseDimension[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === "--dimension") {
      const value = argv[index + 1]
      if (!value) throw new Error("--dimension requires a value")
      dimensions.push(parseDimension(value))
      index += 1
    } else if (arg.startsWith("--")) {
      const eq = arg.indexOf("=")
      if (eq >= 0) {
        values[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else if (index + 1 < argv.length && !argv[index + 1]!.startsWith("--")) {
        values[arg.slice(2)] = argv[++index]!
      } else {
        values[arg.slice(2)] = true
      }
    }
  }
  const model = parseModel(typeof values.model === "string" ? values.model : "deepseek-v4-flash")
  return {
    pocDir: typeof values["poc-dir"] === "string" ? values["poc-dir"] : DEFAULT_POC_DIR,
    outputDir: typeof values["output-dir"] === "string" ? values["output-dir"] : null,
    live: values.live === true,
    model,
    thinking: values.thinking === true || (model === "deepseek-v4-pro" && values["no-thinking"] !== true),
    maxTokens: typeof values["max-tokens"] === "string" ? positiveInt(values["max-tokens"], "--max-tokens") : 1200,
    concurrency: typeof values.concurrency === "string" ? positiveInt(values.concurrency, "--concurrency") : 4,
    dimensions: dimensions.length ? dimensions : DEFAULT_DIMENSIONS,
  }
}

function parseModel(value: string): ModelId {
  if (value === "deepseek-v4-flash" || value === "deepseek-v4-pro") return value
  throw new Error(`--model must be deepseek-v4-flash or deepseek-v4-pro; got ${value}`)
}

function parseDimension(value: string): ProseDimension {
  if (DEFAULT_DIMENSIONS.includes(value as ProseDimension)) return value as ProseDimension
  throw new Error(`unknown dimension: ${value}; expected ${DEFAULT_DIMENSIONS.join(", ")}`)
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next
      next += 1
      results[index] = await tasks[index]!()
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, () => worker()))
  return results
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error(`no JSON object in response: ${trimmed.slice(0, 200)}`)
  return trimmed.slice(start, end + 1)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function writeReport(outputDir: string, report: ProseReviewReport): void {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "prose-review.json"), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outputDir, "prose-review.md"), renderProseReviewReport(report))
}

function writeManifest(outputDir: string, report: ProseReviewReport, args: Args): void {
  const absPocDir = resolve(process.cwd(), args.pocDir)
  const parent = parentManifestForPocDir(args.pocDir)
  writeRunManifest(join(outputDir, RUN_MANIFEST_FILENAME), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-prose-review",
    variantId: report.plannerVariant,
    parentRunId: parent?.runId ?? null,
    rootRunId: parent?.rootRunId ?? null,
    command: {
      name: "diagnostics:corpus-recreation-prose-review",
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
      artifactRef(join(outputDir, "prose-review.json"), "prose-review-json"),
      artifactRef(join(outputDir, "prose-review.md"), "prose-review-markdown"),
    ],
    relatedRunIds: parent ? [parent.runId] : [],
    discriminator: `${report.source.book ?? "unknown"}-${report.source.chapterLabel ?? "unknown"}-${report.plannerVariant}`,
    metadata: {
      pocDir: args.pocDir,
      live: args.live,
      dimensions: args.dimensions,
      resultCount: report.resultCount,
    },
  }))
}

function outputDirFor(args: Args): string {
  return args.outputDir ?? join(args.pocDir, "prose-quality-live")
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}:${value}`)
    .join(", ") || "none"
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const report = await buildCorpusRecreationProseReviewReport(args)
    const outputDir = outputDirFor(args)
    writeReport(outputDir, report)
    writeManifest(outputDir, report, args)
    console.log(renderProseReviewReport(report))
    console.log(`wrote ${resolve(process.cwd(), outputDir)}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
