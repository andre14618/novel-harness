/**
 * Scene-first novella POC — diagnostic prose-effectiveness panel.
 *
 * This is intentionally advisory. It judges generated prose, not ID/schema
 * compliance, and does not rewrite, compact, block, or promote anything.
 *
 * The judge prompt hides raw traceability IDs. IDs remain in result metadata
 * only so reports can be traced back to artifacts without encouraging the
 * model to reward tag completeness.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { z } from "zod"
import { callAgent } from "../../src/llm"
import { initNovelRun } from "../../src/logger"
import { setAutoMode, setResolverMode } from "../../src/cli"
import { getMode } from "../../src/gates"

export type ProseEvalDimension =
  | "dramatization"
  | "earnedLength"
  | "povVoice"
  | "payoffPropulsion"

export interface Args {
  runDirs: string[]
  dimensions: ProseEvalDimension[]
  dryRun: boolean
  outputDir: string | null
  concurrency: number
  maxChapters: number
}

interface ChapterArtifact {
  runDir: string
  runId: string
  chapterNumber: number
  prose: string
  contracts: any
}

interface ReviewSummary {
  reviewStats?: {
    proseWords?: number
    targetWords?: number
  }
  diagnosticStats?: {
    endpointScores?: number[]
  }
}

export interface ProseEvalResult {
  runId: string
  chapterNumber: number
  chapterTitle: string
  dimension: ProseEvalDimension
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

export interface RunProseEvalReport {
  runId: string
  runDir: string
  wordRatio: number | null
  words: string
  endpointScores: number[]
  chaptersJudged: number
  dimensions: ProseEvalDimension[]
  summaries: Array<{
    dimension: ProseEvalDimension
    count: number
    meanOrdinal: number
    lowCount: number
    labelCounts: Record<string, number>
  }>
  recommendation: string
  results: ProseEvalResult[]
}

export interface ProseEvalBatchReport {
  generatedAt: string
  evalRunId: string
  dryRun: boolean
  dimensions: ProseEvalDimension[]
  runReports: RunProseEvalReport[]
}

const DEFAULT_DIMENSIONS: ProseEvalDimension[] = [
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
  const runDirs: string[] = []
  const dimensions: ProseEvalDimension[] = []
  let dryRun = false
  let outputDir: string | null = null
  let concurrency = 4
  let maxChapters = 50

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eat = (): string => {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }
    if (arg === "--run-dir") { runDirs.push(eat()); continue }
    if (arg === "--dimension") { dimensions.push(parseDimension(eat())); continue }
    if (arg === "--dry-run") { dryRun = true; continue }
    if (arg === "--output-dir") { outputDir = eat(); continue }
    if (arg === "--concurrency") { concurrency = positiveInt(eat(), "--concurrency"); continue }
    if (arg === "--max-chapters") { maxChapters = positiveInt(eat(), "--max-chapters"); continue }
    if (arg.startsWith("--")) throw new Error(`unknown arg: ${arg}`)
    runDirs.push(arg)
  }

  if (runDirs.length === 0) throw new Error("at least one --run-dir <path> or positional run directory is required")
  return {
    runDirs,
    dimensions: dimensions.length > 0 ? dimensions : DEFAULT_DIMENSIONS,
    dryRun,
    outputDir,
    concurrency,
    maxChapters,
  }
}

function parseDimension(value: string): ProseEvalDimension {
  if (DEFAULT_DIMENSIONS.includes(value as ProseEvalDimension)) return value as ProseEvalDimension
  throw new Error(`unsupported --dimension ${value}; expected ${DEFAULT_DIMENSIONS.join(", ")}`)
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

export async function loadChapterArtifacts(runDir: string, maxChapters = 50): Promise<ChapterArtifact[]> {
  const runId = basename(runDir.replace(/\/$/, ""))
  const chapters: ChapterArtifact[] = []
  for (let chapterNumber = 1; chapterNumber <= maxChapters; chapterNumber++) {
    const prosePath = join(runDir, `chapter-${chapterNumber}.md`)
    const contractsPath = join(runDir, `chapter-${chapterNumber}.scene-contracts.json`)
    const proseFile = Bun.file(prosePath)
    const contractsFile = Bun.file(contractsPath)
    if (!await proseFile.exists() || !await contractsFile.exists()) {
      if (chapterNumber > 1) break
      continue
    }
    const rawProse = await readFile(prosePath, "utf8")
    const contracts = JSON.parse(await readFile(contractsPath, "utf8"))
    chapters.push({
      runDir,
      runId,
      chapterNumber,
      prose: stripChapterHeader(rawProse),
      contracts,
    })
  }
  return chapters
}

function stripChapterHeader(raw: string): string {
  return raw.replace(/^# Chapter [^\n]*\n\n(?:\*[^\n]*\n)+\n/m, "").trim()
}

export function renderChapterJudgePrompt(chapter: ChapterArtifact, dimension: ProseEvalDimension): string {
  const scenes = Array.isArray(chapter.contracts.scenes) ? chapter.contracts.scenes : []
  const sceneLines = scenes.map((scene: any, index: number) => {
    const contract = scene.contract ?? {}
    const valueShift = contract.valueIn || contract.valueOut ? `${contract.valueIn ?? ""} -> ${contract.valueOut ?? ""}` : "(none declared)"
    return [
      `Scene ${index + 1}:`,
      `  Kind: ${scene.kind ?? "(unspecified)"}`,
      `  Description: ${scene.description ?? "(none)"}`,
      `  Characters: ${Array.isArray(scene.characters) ? scene.characters.join(", ") : "(unspecified)"}`,
      `  Goal: ${contract.goal ?? "(none)"}`,
      `  Opposition: ${contract.opposition ?? "(none)"}`,
      `  Turning point: ${contract.turningPoint ?? "(none)"}`,
      `  Crisis choice: ${contract.crisisChoice ?? "(none)"}`,
      `  Outcome: ${contract.outcome ?? "(none)"}`,
      `  Consequence: ${contract.consequence ?? "(none)"}`,
      `  Value shift: ${valueShift}`,
    ].join("\n")
  })

  return [
    `DIMENSION TO JUDGE: ${dimension}`,
    ``,
    `CHAPTER CONTEXT`,
    `Chapter ${chapter.chapterNumber}: ${chapter.contracts.title ?? "(untitled)"}`,
    `POV: ${chapter.contracts.povCharacter ?? "(unspecified)"}`,
    `Purpose / endpoint: ${chapter.contracts.purpose ?? "(none)"}`,
    `Target words: ${chapter.contracts.targetWords ?? "(unspecified)"}`,
    `Actual words: ${chapter.contracts.proseWordCount ?? countWords(chapter.prose)}`,
    ``,
    `SCENE CONTRACTS (summaries only; IDs intentionally omitted from judge prompt)`,
    sceneLines.join("\n\n") || "(no scenes)",
    ``,
    `CHAPTER PROSE`,
    chapter.prose,
  ].join("\n")
}

function stableProseJudgePrompt(dimension: ProseEvalDimension): string {
  return `You are a diagnostic fiction-prose judge for Novel Harness.

Judge one generated chapter against one prose-effectiveness dimension.
This is advisory evidence only. Do not rewrite, compact, or enforce a template.
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

function labelDefinitions(dimension: ProseEvalDimension): string {
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

function labelAlternatives(dimension: ProseEvalDimension): string {
  const prefix = dimensionPrefix(dimension)
  return `${prefix}-0|${prefix}-1|${prefix}-2|${prefix}-3`
}

function dimensionPrefix(dimension: ProseEvalDimension): string {
  if (dimension === "dramatization") return "DRAMA"
  if (dimension === "earnedLength") return "LENGTH"
  if (dimension === "povVoice") return "VOICE"
  return "PAYOFF"
}

async function judgeChapter(evalRunId: string, chapter: ChapterArtifact, dimension: ProseEvalDimension, dryRun: boolean): Promise<ProseEvalResult> {
  const targetWords = typeof chapter.contracts.targetWords === "number" ? chapter.contracts.targetWords : null
  const proseWords = typeof chapter.contracts.proseWordCount === "number" ? chapter.contracts.proseWordCount : countWords(chapter.prose)
  const base = {
    runId: chapter.runId,
    chapterNumber: chapter.chapterNumber,
    chapterTitle: String(chapter.contracts.title ?? `Chapter ${chapter.chapterNumber}`),
    dimension,
    targetWords,
    proseWords,
    wordRatio: targetWords && targetWords > 0 ? proseWords / targetWords : null,
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
      novelId: evalRunId,
      agentName: `poc-judge-prose-${dimension}`,
      chapter: chapter.chapterNumber,
      systemPrompt: stableProseJudgePrompt(dimension),
      userPrompt: renderChapterJudgePrompt(chapter, dimension),
      schema: judgeSchema,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      temperature: 0.1,
      maxTokens: 700,
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

function normalizeOutput(raw: unknown, dimension: ProseEvalDimension): z.infer<typeof judgeSchema> & { label: string } {
  const parsed = judgeSchema.parse(raw)
  return {
    ...parsed,
    label: normalizeLabel(parsed.label, dimension),
  }
}

function normalizeLabel(label: string, dimension: ProseEvalDimension): string {
  const prefix = dimensionPrefix(dimension)
  const match = label.toUpperCase().match(/([A-Z]+)-?([0-3])/u)
  if (!match) return `${prefix}-0`
  return `${prefix}-${match[2]}`
}

function labelOrdinal(label: string): number {
  const match = label.match(/([0-3])$/u)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

async function readReviewSummary(runDir: string): Promise<ReviewSummary | null> {
  const file = Bun.file(join(runDir, "review-summary.json"))
  if (!await file.exists()) return null
  return JSON.parse(await file.text()) as ReviewSummary
}

function summarizeRun(runDir: string, results: ProseEvalResult[], review: ReviewSummary | null, dimensions: ProseEvalDimension[]): RunProseEvalReport {
  const runId = basename(runDir.replace(/\/$/, ""))
  const proseWords = review?.reviewStats?.proseWords
  const targetWords = review?.reviewStats?.targetWords
  const summaries = dimensions.map(dimension => summarizeDimension(dimension, results.filter(row => row.dimension === dimension && !row.error)))
  const endpointScores = review?.diagnosticStats?.endpointScores ?? []
  return {
    runId,
    runDir,
    wordRatio: proseWords && targetWords ? proseWords / targetWords : null,
    words: proseWords && targetWords ? `${proseWords}/${targetWords}` : "n/a",
    endpointScores,
    chaptersJudged: new Set(results.map(row => row.chapterNumber)).size,
    dimensions,
    summaries,
    recommendation: recommendationForRun(summaries, endpointScores),
    results,
  }
}

function summarizeDimension(dimension: ProseEvalDimension, rows: ProseEvalResult[]): RunProseEvalReport["summaries"][number] {
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

function recommendationForRun(summaries: RunProseEvalReport["summaries"], endpointScores: number[]): string {
  const byDimension = new Map(summaries.map(summary => [summary.dimension, summary.meanOrdinal]))
  const earned = byDimension.get("earnedLength") ?? 0
  const drama = byDimension.get("dramatization") ?? 0
  const voice = byDimension.get("povVoice") ?? 0
  const payoff = byDimension.get("payoffPropulsion") ?? 0
  const endpointsStrong = endpointScores.length > 0 && endpointScores.every(score => score >= 3)
  if (!endpointsStrong) return "Semantic hold: endpoint quality is not stable enough; shorter prose is not evidence of success."
  if (earned >= 2 && drama >= 2 && voice >= 2 && payoff >= 2) {
    return "Longer prose is semantically defensible. Do not compact prose; inspect planner scope only if product budget requires it."
  }
  if (earned < 2) return "Planner-scope compression candidate: extra words are not consistently earning semantic value."
  return "Mixed: preserve prose for now, inspect low-scoring dimensions before changing planner or writer behavior."
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export async function buildProseEvalBatchReport(args: Args, generatedAt = new Date().toISOString()): Promise<ProseEvalBatchReport> {
  const evalRunId = `poc-prose-eval-${Date.now()}`
  if (!args.dryRun) await initNovelRun(evalRunId)

  const chaptersByRun = new Map<string, ChapterArtifact[]>()
  for (const runDir of args.runDirs) {
    const chapters = await loadChapterArtifacts(runDir, args.maxChapters)
    if (chapters.length === 0) throw new Error(`no chapter artifacts found in ${runDir}`)
    chaptersByRun.set(runDir, chapters)
  }

  const tasks: Array<() => Promise<ProseEvalResult>> = []
  for (const chapters of chaptersByRun.values()) {
    for (const chapter of chapters) {
      for (const dimension of args.dimensions) {
        tasks.push(() => judgeChapter(evalRunId, chapter, dimension, args.dryRun))
      }
    }
  }
  const results = await runBounded(tasks, args.concurrency)

  const runReports: RunProseEvalReport[] = []
  for (const runDir of args.runDirs) {
    const runId = basename(runDir.replace(/\/$/, ""))
    const runResults = results.filter(row => row.runId === runId)
    runReports.push(summarizeRun(runDir, runResults, await readReviewSummary(runDir), args.dimensions))
  }

  return {
    generatedAt,
    evalRunId,
    dryRun: args.dryRun,
    dimensions: args.dimensions,
    runReports,
  }
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

export function renderProseEvalMarkdown(report: ProseEvalBatchReport): string {
  const lines: string[] = []
  lines.push("# Scene-First Prose Semantic Eval")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Eval run: ${report.evalRunId}`)
  lines.push(`Mode: ${report.dryRun ? "dry-run" : "DeepSeek V4 Flash"}`)
  lines.push(`Dimensions: ${report.dimensions.join(", ")}`)
  lines.push("")
  lines.push("## Run Summary")
  lines.push("")
  lines.push("| Run | Words | Endpoints | Drama | Earned length | POV voice | Payoff | Recommendation |")
  lines.push("| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |")
  for (const run of report.runReports) {
    const mean = (dimension: ProseEvalDimension): string => {
      const summary = run.summaries.find(row => row.dimension === dimension)
      return summary ? summary.meanOrdinal.toFixed(2) : "n/a"
    }
    lines.push([
      `| ${run.runId}`,
      run.words,
      run.endpointScores.join(", ") || "n/a",
      mean("dramatization"),
      mean("earnedLength"),
      mean("povVoice"),
      mean("payoffPropulsion"),
      `${run.recommendation} |`,
    ].join(" | "))
  }

  const saturationNotes = proseEvalSaturationNotes(report)
  if (saturationNotes.length > 0) {
    lines.push("")
    lines.push("## Saturation Notes")
    lines.push("")
    for (const note of saturationNotes) lines.push(`- ${note}`)
  }

  for (const run of report.runReports) {
    lines.push("")
    lines.push(`## ${run.runId}`)
    lines.push("")
    for (const summary of run.summaries) {
      const counts = Object.entries(summary.labelCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, count]) => `${label}:${count}`)
        .join(" ")
      lines.push(`- ${summary.dimension}: mean=${summary.meanOrdinal.toFixed(2)} low=${summary.lowCount}/${summary.count}; ${counts}`)
    }
    const attention = run.results.filter(row => row.error || row.ordinal <= 1)
    if (attention.length > 0) {
      lines.push("")
      lines.push("Low-signal / Error Rows:")
      for (const row of attention) {
        lines.push(`- ch${row.chapterNumber} ${row.dimension} ${row.label}: ${row.error ?? row.missingForNextLevel}`)
      }
    }
  }

  lines.push("")
  lines.push("## Interpretation Guardrails")
  lines.push("")
  lines.push("- Diagnostic only: results do not rewrite, compact, block, or promote prose.")
  lines.push("- IDs are omitted from judge prompts and retained only in local artifacts for traceability.")
  lines.push("- Longer prose should be penalized only when it creates drag or repeated explanation, not merely because it exceeds target words.")
  return `${lines.join("\n")}\n`
}

function proseEvalSaturationNotes(report: ProseEvalBatchReport): string[] {
  const notes: string[] = []
  for (const dimension of report.dimensions) {
    const rows = report.runReports.flatMap(run => run.results.filter(row => row.dimension === dimension && !row.error))
    if (rows.length < 4) continue

    const labels = new Set(rows.map(row => row.label))
    if (labels.size === 1) {
      const label = [...labels][0]!
      notes.push(`${dimension} saturated at ${label} across ${rows.length} judgments; treat it as a floor check, not a discriminator for promotion or compression.`)
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

function mostCommonLabel(labels: string[]): { label: string; count: number } {
  const counts = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  let best = { label: "", count: 0 }
  for (const [label, count] of counts) {
    if (count > best.count) best = { label, count }
  }
  return best
}

async function writeReports(report: ProseEvalBatchReport, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, "prose-eval-summary.json"), JSON.stringify(report, null, 2), "utf8")
  await writeFile(join(outputDir, "prose-eval-summary.md"), renderProseEvalMarkdown(report), "utf8")
  for (const run of report.runReports) {
    await writeFile(join(run.runDir, "prose-eval.json"), JSON.stringify(run, null, 2), "utf8")
    await writeFile(join(run.runDir, "prose-eval.md"), renderProseEvalMarkdown({
      generatedAt: report.generatedAt,
      evalRunId: report.evalRunId,
      dryRun: report.dryRun,
      dimensions: report.dimensions,
      runReports: [run],
    }), "utf8")
  }
}

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `output/scene-first-prose-eval/${stamp}`
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  setAutoMode(true)
  setResolverMode(getMode(true))
  const report = await buildProseEvalBatchReport(args)
  const outputDir = resolve(process.cwd(), args.outputDir ?? defaultOutputDir())
  await writeReports(report, outputDir)
  console.log(renderProseEvalMarkdown(report))
  console.log(`wrote ${join(outputDir, "prose-eval-summary.json")}`)
  console.log(`wrote ${join(outputDir, "prose-eval-summary.md")}`)
  process.exit(0)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
