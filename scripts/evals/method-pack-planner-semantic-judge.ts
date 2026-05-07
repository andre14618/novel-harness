#!/usr/bin/env bun
/**
 * Blind semantic judge for method-pack planner cohorts.
 *
 * This consumes saved planner-cohort cell reports and asks an LLM judge to
 * compare the control/method plans as unlabeled Plan A vs Plan B. The goal is
 * to test story-usefulness signals that deterministic schema checks cannot
 * measure: character agency, causal momentum, world-as-engine, endpoint force,
 * and prose-readiness.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, join, relative, resolve } from "node:path"

import { loadFixture, type DiagnosticReport, type PlannerContractPlan, type PlannerDiagnosticFixture } from "./method-pack-planner-diagnostic"

type PlanSide = "A" | "B"
type SemanticWinner = PlanSide | "TIE"

interface Args {
  cohortDir: string
  cellPaths: string[]
  outputDir: string | null
  concurrency: number
  model: "deepseek-v4-flash" | "deepseek-v4-pro"
  thinking: boolean
  maxTokens: number
  json: boolean
}

interface SemanticDimensionScores {
  characterAgency: number
  causalMomentum: number
  worldAsEngine: number
  endpointForce: number
  proseReadiness: number
}

interface SemanticJudgeOutput {
  winner: SemanticWinner
  confidence: number
  scores: Record<PlanSide, SemanticDimensionScores & { total: number }>
  rationale: string
  decisiveEvidence: string[]
  concerns: Record<PlanSide, string[]>
}

interface SemanticCellResult {
  cellPath: string
  diagnosticId: string
  fixturePath: string
  replicate: number
  planAArmId: string
  planBArmId: string
  methodSide: PlanSide
  controlSide: PlanSide
  winner: SemanticWinner
  methodWon: boolean
  controlWon: boolean
  tie: boolean
  methodScore: number
  controlScore: number
  methodDelta: number
  confidence: number
  judgment: SemanticJudgeOutput
}

interface SemanticAggregate {
  cells: number
  methodWins: number
  controlWins: number
  ties: number
  methodWinRate: number
  controlWinRate: number
  tieRate: number
  meanMethodDelta: number
  medianMethodDelta: number
  meanConfidence: number
  verdict: string
  reason: string
}

interface SemanticJudgeReport {
  generatedAt: string
  cohortDir: string
  outputDir: string | null
  model: string
  thinking: boolean
  maxTokens: number
  cellCount: number
  cells: SemanticCellResult[]
  aggregate: SemanticAggregate
}

const DEFAULT_COHORT_DIR = "output/method-pack-diagnostics/2026-05-07T13-51-44-961Z/cohort"

export async function buildSemanticJudgeReport(args: Args, generatedAt = new Date().toISOString()): Promise<SemanticJudgeReport> {
  const cellPaths = args.cellPaths.length > 0 ? args.cellPaths : collectCellPaths(args.cohortDir)
  if (cellPaths.length === 0) throw new Error(`no cell JSON files found under ${args.cohortDir}`)
  const tasks = cellPaths.map(cellPath => async () => judgeCell(args, cellPath))
  const cells = await runBounded(tasks, args.concurrency)
  return {
    generatedAt,
    cohortDir: args.cohortDir,
    outputDir: args.outputDir,
    model: args.model,
    thinking: args.thinking,
    maxTokens: args.maxTokens,
    cellCount: cells.length,
    cells,
    aggregate: summarizeSemanticCells(cells),
  }
}

export function summarizeSemanticCells(cells: SemanticCellResult[]): SemanticAggregate {
  const methodWins = cells.filter(cell => cell.methodWon).length
  const controlWins = cells.filter(cell => cell.controlWon).length
  const ties = cells.filter(cell => cell.tie).length
  const deltas = cells.map(cell => cell.methodDelta)
  const confidences = cells.map(cell => cell.confidence)
  const meanMethodDelta = mean(deltas)
  const methodWinRate = ratio(methodWins, cells.length)
  const controlWinRate = ratio(controlWins, cells.length)
  const tieRate = ratio(ties, cells.length)
  const { verdict, reason } = semanticVerdict(meanMethodDelta, methodWinRate, controlWinRate)
  return {
    cells: cells.length,
    methodWins,
    controlWins,
    ties,
    methodWinRate,
    controlWinRate,
    tieRate,
    meanMethodDelta,
    medianMethodDelta: median(deltas),
    meanConfidence: mean(confidences),
    verdict,
    reason,
  }
}

export function renderSemanticJudgeReport(report: SemanticJudgeReport): string {
  const lines: string[] = []
  lines.push("Method-pack planner semantic judge")
  lines.push(`model=${report.model}; thinking=${report.thinking}; cells=${report.cellCount}`)
  lines.push(`cohort=${report.cohortDir}`)
  lines.push("")
  lines.push(`Aggregate verdict: ${report.aggregate.verdict}`)
  lines.push(`Reason: ${report.aggregate.reason}`)
  lines.push(`Method wins: ${report.aggregate.methodWins}/${report.aggregate.cells} (${formatPct(report.aggregate.methodWinRate)})`)
  lines.push(`Control wins: ${report.aggregate.controlWins}/${report.aggregate.cells} (${formatPct(report.aggregate.controlWinRate)})`)
  lines.push(`Ties: ${report.aggregate.ties}/${report.aggregate.cells} (${formatPct(report.aggregate.tieRate)})`)
  lines.push(`Mean method score delta: ${formatSigned(report.aggregate.meanMethodDelta)}; median: ${formatSigned(report.aggregate.medianMethodDelta)}`)
  lines.push(`Mean confidence: ${report.aggregate.meanConfidence.toFixed(2)}`)
  lines.push("")
  lines.push("Cells:")
  for (const cell of report.cells) {
    const winner = cell.tie ? "tie" : cell.methodWon ? "method" : "control"
    lines.push(`- r${cell.replicate + 1} ${cell.diagnosticId}: ${winner}; delta=${formatSigned(cell.methodDelta)}; confidence=${cell.confidence.toFixed(2)}`)
    const evidence = cell.judgment.decisiveEvidence.slice(0, 2).join(" / ")
    if (evidence) lines.push(`  evidence: ${evidence}`)
  }
  if (report.outputDir) {
    lines.push("")
    lines.push(`Artifacts: ${resolve(process.cwd(), report.outputDir)}`)
  }
  return lines.join("\n")
}

function semanticVerdict(meanDelta: number, methodWinRate: number, controlWinRate: number): { verdict: string; reason: string } {
  const twoThirds = 2 / 3
  if (methodWinRate >= twoThirds && meanDelta >= 2) {
    return { verdict: "SEMANTIC-PASS", reason: "Blind judge prefers the method plan in at least two-thirds of cells with a meaningful mean score lift." }
  }
  if (controlWinRate >= twoThirds && meanDelta <= -2) {
    return { verdict: "SEMANTIC-NO-PROMOTION", reason: "Blind judge prefers the no-method control in at least two-thirds of cells with a meaningful score deficit for method." }
  }
  return { verdict: "SEMANTIC-HOLD", reason: "Blind semantic preference is too small or inconsistent for promotion." }
}

async function judgeCell(args: Args, cellPath: string): Promise<SemanticCellResult> {
  const report = readDiagnosticReport(cellPath)
  const fixture = loadFixture(report.fixturePath)
  const control = report.arms.find(arm => !arm.methodPackEnabled)
  const method = report.arms.find(arm => arm.methodPackEnabled)
  if (!control || !method) throw new Error(`${cellPath} needs one control arm and one method arm`)

  const swap = shouldSwap(report.diagnosticId, parseReplicate(cellPath))
  const planA = swap ? method.plan : control.plan
  const planB = swap ? control.plan : method.plan
  const planAArmId = swap ? method.armId : control.armId
  const planBArmId = swap ? control.armId : method.armId
  const methodSide: PlanSide = swap ? "A" : "B"
  const controlSide: PlanSide = swap ? "B" : "A"

  const judgment = await callDeepSeekJudge({
    model: args.model,
    thinking: args.thinking,
    maxTokens: args.maxTokens,
    systemPrompt: judgeSystemPrompt(),
    userPrompt: judgeUserPrompt(fixture, planA, planB),
  })
  const methodScore = judgment.scores[methodSide].total
  const controlScore = judgment.scores[controlSide].total
  const winner = judgment.winner
  const methodWon = winner === methodSide
  const controlWon = winner === controlSide
  const tie = winner === "TIE"
  return {
    cellPath,
    diagnosticId: report.diagnosticId,
    fixturePath: report.fixturePath,
    replicate: parseReplicate(cellPath),
    planAArmId,
    planBArmId,
    methodSide,
    controlSide,
    winner,
    methodWon,
    controlWon,
    tie,
    methodScore,
    controlScore,
    methodDelta: methodScore - controlScore,
    confidence: clampNumber(judgment.confidence, 0, 1),
    judgment,
  }
}

function judgeSystemPrompt(): string {
  return `You are a blind semantic judge for upstream novel planning contracts.

You compare Plan A and Plan B for likely usefulness in producing a compelling commercial fantasy/adventure novel.
Do not reward schema completeness by itself. Do not reward a plan for using named methodology, templates, IDs, or formal labels.
Prefer the plan that gives a future scene/chapter writer stronger semantic material.

Score each plan 1-5 on:
- characterAgency: characters want specific things, make choices under pressure, and change the plot.
- causalMomentum: chapters/scenes escalate through cause and effect instead of listing events.
- worldAsEngine: world facts/rules create costs, constraints, revelations, or turns, not just decoration.
- endpointForce: chapter endpoints/hooks land as consequences that create forward momentum.
- proseReadiness: the plan is specific, dramatizable, and likely to produce vivid prose without inventing core context.

Use this scale:
1 = generic, inert, or unusable.
2 = some useful material but mostly vague/list-like.
3 = workable but uneven; a writer would need to repair it.
4 = strong; a writer can draft from it with limited repair.
5 = excellent; clear story engine, pressure, turns, and consequences.

Return only JSON:
{
  "winner": "A" | "B" | "TIE",
  "confidence": 0.0-1.0,
  "scores": {
    "A": {"characterAgency": 1-5, "causalMomentum": 1-5, "worldAsEngine": 1-5, "endpointForce": 1-5, "proseReadiness": 1-5, "total": 5-25},
    "B": {"characterAgency": 1-5, "causalMomentum": 1-5, "worldAsEngine": 1-5, "endpointForce": 1-5, "proseReadiness": 1-5, "total": 5-25}
  },
  "rationale": "one concise paragraph",
  "decisiveEvidence": ["quote or paraphrase concrete evidence from the plans"],
  "concerns": {"A": ["specific concern"], "B": ["specific concern"]}
}`
}

function judgeUserPrompt(fixture: PlannerDiagnosticFixture, planA: PlannerContractPlan, planB: PlannerContractPlan): string {
  const sharedPrefix = `Semantic planner judge task.
This shared prefix is stable across calls for prefix-cache reuse.
Compare the two plans as unlabeled planning artifacts. They target the same frozen concept and same six chapter jobs.

Frozen concept:
${JSON.stringify({
    premise: fixture.concept.premise,
    readerPromise: fixture.concept.readerPromise,
    centralConflict: fixture.concept.centralConflict,
    protagonist: fixture.concept.protagonist,
    characters: fixture.concept.characters,
    worldFacts: fixture.concept.worldFacts,
    storyPromise: fixture.concept.storyPromise,
  }, null, 2)}

Intended chapter jobs, in order:
${JSON.stringify(fixture.targetSlots.map((slot, index) => ({
    chapter: index + 1,
    structureJob: slot.structureJob,
    planningTest: slot.planningTest,
  })), null, 2)}

Judge only semantic story usefulness. Ignore whether either plan appears to follow a named template.`

  return `${sharedPrefix}

Plan A:
${JSON.stringify(sanitizePlanForJudge(planA), null, 2)}

Plan B:
${JSON.stringify(sanitizePlanForJudge(planB), null, 2)}`
}

function sanitizePlanForJudge(plan: PlannerContractPlan): unknown {
  return {
    chapters: plan.chapters.map((chapter, chapterIndex) => ({
      chapter: chapterIndex + 1,
      function: chapter.chapterFunction,
      protagonistPressure: chapter.protagonistPressure,
      centralConflict: chapter.centralConflict,
      irreversibleChange: chapter.irreversibleChange,
      endpointOrHook: chapter.endpointOrHook,
      characterWork: chapter.requiredCharacterWork,
      worldWork: chapter.requiredWorldWork,
      storyDebtWork: chapter.requiredStoryDebtWork,
      obligations: chapter.obligations.map(obligation => ({
        sourceKind: obligation.sourceKind,
        requirement: obligation.requirementText,
        linkedCharacters: obligation.linkedCharacterIds,
        linkedWorldFacts: obligation.linkedWorldFactIds,
      })),
      scenes: chapter.scenes.map((scene, sceneIndex) => ({
        scene: sceneIndex + 1,
        function: scene.sceneFunction,
        arena: scene.locationOrArena,
        goal: scene.goal,
        conflict: scene.conflict,
        turn: scene.turnOrValueShift,
        outcome: scene.outcome,
        consequence: scene.consequence,
        requiredCharacters: scene.requiredCharacterIds,
        requiredWorldFacts: scene.requiredWorldFactIds,
      })),
    })),
  }
}

async function callDeepSeekJudge(options: {
  model: "deepseek-v4-flash" | "deepseek-v4-pro"
  thinking: boolean
  maxTokens: number
  systemPrompt: string
  userPrompt: string
}): Promise<SemanticJudgeOutput> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error("DEEPSEEK_API_KEY not set in environment")
  const timeoutMs = options.model === "deepseek-v4-pro" ? 180_000 : 120_000
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new Error(`DeepSeek ${options.model} judge timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    try {
      console.log(`  [judge] ${options.model} thinking=${options.thinking ? "on" : "off"} attempt=${attempt}`)
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: options.systemPrompt },
            { role: "user", content: options.userPrompt },
          ],
          temperature: 0,
          max_tokens: options.maxTokens,
          response_format: { type: "json_object" },
          thinking: { type: options.thinking ? "enabled" : "disabled" },
        }),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`DeepSeek ${options.model} ${response.status}: ${text.slice(0, 500)}`)
      const data = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number }
      }
      const content = data.choices?.[0]?.message?.content ?? ""
      const finishReason = data.choices?.[0]?.finish_reason ?? "unknown"
      const promptTokens = data.usage?.prompt_tokens ?? 0
      const completionTokens = data.usage?.completion_tokens ?? 0
      const cached = data.usage?.prompt_cache_hit_tokens ?? 0
      console.log(`  [judge] response ${promptTokens}+${completionTokens} tokens${cached > 0 ? ` [cache:${cached}]` : ""}; finish=${finishReason}`)
      if (finishReason === "length") throw new Error(`DeepSeek ${options.model} judge hit max token cap`)
      return normalizeJudgeOutput(JSON.parse(extractJsonObject(content)))
    } catch (err) {
      lastError = err
      console.warn(`  [judge] ${options.model} attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`)
      if (attempt >= 2) break
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function normalizeJudgeOutput(raw: any): SemanticJudgeOutput {
  const winnerRaw = String(raw?.winner ?? "TIE").toUpperCase()
  const winner: SemanticWinner = winnerRaw === "A" || winnerRaw === "B" ? winnerRaw : "TIE"
  const scores = {
    A: normalizeScores(raw?.scores?.A),
    B: normalizeScores(raw?.scores?.B),
  }
  return {
    winner,
    confidence: clampNumber(Number(raw?.confidence ?? 0.5), 0, 1),
    scores,
    rationale: String(raw?.rationale ?? ""),
    decisiveEvidence: Array.isArray(raw?.decisiveEvidence) ? raw.decisiveEvidence.map(String) : [],
    concerns: {
      A: Array.isArray(raw?.concerns?.A) ? raw.concerns.A.map(String) : [],
      B: Array.isArray(raw?.concerns?.B) ? raw.concerns.B.map(String) : [],
    },
  }
}

function normalizeScores(raw: any): SemanticDimensionScores & { total: number } {
  const scores: SemanticDimensionScores = {
    characterAgency: scoreValue(raw?.characterAgency),
    causalMomentum: scoreValue(raw?.causalMomentum),
    worldAsEngine: scoreValue(raw?.worldAsEngine),
    endpointForce: scoreValue(raw?.endpointForce),
    proseReadiness: scoreValue(raw?.proseReadiness),
  }
  return { ...scores, total: scores.characterAgency + scores.causalMomentum + scores.worldAsEngine + scores.endpointForce + scores.proseReadiness }
}

function readDiagnosticReport(path: string): DiagnosticReport {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf-8")) as DiagnosticReport
}

function collectCellPaths(cohortDir: string): string[] {
  const root = resolve(process.cwd(), cohortDir)
  const cellsDir = join(root, "cells")
  if (!existsSync(cellsDir)) throw new Error(`cell dir not found: ${cellsDir}`)
  const out: string[] = []
  for (const entry of readdirSync(cellsDir).sort()) {
    const abs = join(cellsDir, entry)
    if (statSync(abs).isFile() && entry.endsWith(".json")) out.push(relative(process.cwd(), abs))
  }
  return out
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
  const cellPaths: string[] = []
  let outputDir: string | null = null
  let concurrency = 2
  let model: Args["model"] = "deepseek-v4-flash"
  let thinking = false
  let maxTokens = 3000
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--cohort-dir") cohortDir = requireValue(argv, ++i, "--cohort-dir")
    else if (arg.startsWith("--cohort-dir=")) cohortDir = arg.slice("--cohort-dir=".length)
    else if (arg === "--cell") cellPaths.push(requireValue(argv, ++i, "--cell"))
    else if (arg.startsWith("--cell=")) cellPaths.push(arg.slice("--cell=".length))
    else if (arg === "--output-dir") outputDir = requireValue(argv, ++i, "--output-dir")
    else if (arg.startsWith("--output-dir=")) outputDir = arg.slice("--output-dir=".length)
    else if (arg === "--concurrency") concurrency = parsePositiveInt(requireValue(argv, ++i, "--concurrency"), "--concurrency")
    else if (arg.startsWith("--concurrency=")) concurrency = parsePositiveInt(arg.slice("--concurrency=".length), "--concurrency")
    else if (arg === "--model") model = parseModel(requireValue(argv, ++i, "--model"))
    else if (arg.startsWith("--model=")) model = parseModel(arg.slice("--model=".length))
    else if (arg === "--thinking") thinking = true
    else if (arg === "--no-thinking") thinking = false
    else if (arg === "--max-tokens") maxTokens = parsePositiveInt(requireValue(argv, ++i, "--max-tokens"), "--max-tokens")
    else if (arg.startsWith("--max-tokens=")) maxTokens = parsePositiveInt(arg.slice("--max-tokens=".length), "--max-tokens")
    else if (arg === "--json") json = true
    else throw new Error(`unknown arg: ${arg}`)
  }
  if (model === "deepseek-v4-pro" && !argv.includes("--no-thinking")) thinking = true
  return { cohortDir, cellPaths, outputDir, concurrency, model, thinking, maxTokens, json }
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

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function parseReplicate(cellPath: string): number {
  const match = basename(cellPath).match(/-r(\d+)\.json$/)
  return match ? Number.parseInt(match[1]!, 10) - 1 : 0
}

function shouldSwap(diagnosticId: string, replicate: number): boolean {
  const key = `${diagnosticId}:${replicate}`
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return hash % 2 === 0
}

function extractJsonObject(raw: string): string {
  let text = raw.trim()
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim()
  }
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error(`No JSON object in judge response: ${text.slice(0, 200)}`)
  return text.slice(start, end + 1)
}

function scoreValue(value: unknown): number {
  return clampNumber(Math.round(Number(value)), 1, 5)
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length === 0) return 0
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatSigned(value: number): string {
  const sign = value >= 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}`
}

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `output/method-pack-diagnostics/${stamp}/semantic-judge`
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/method-pack-planner-semantic-judge.ts [--cohort-dir <dir>] [--cell <path> ...] [--output-dir <dir>] [--concurrency <n>] [--model deepseek-v4-flash|deepseek-v4-pro] [--thinking|--no-thinking] [--json]")
    return 2
  }
  if (!args.outputDir) args.outputDir = defaultOutputDir()
  const report = await buildSemanticJudgeReport(args)
  if (args.outputDir) {
    const abs = resolve(process.cwd(), args.outputDir)
    mkdirSync(abs, { recursive: true })
    writeFileSync(join(abs, "semantic-judge-report.json"), JSON.stringify(report, null, 2))
    writeFileSync(join(abs, "semantic-judge-report.md"), renderSemanticJudgeReport(report))
  }
  console.log(args.json ? JSON.stringify(report, null, 2) : renderSemanticJudgeReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
