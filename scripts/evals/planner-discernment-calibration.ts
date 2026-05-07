#!/usr/bin/env bun
/**
 * DeepSeek discernment calibration for planning-quality rubrics.
 *
 * This is intentionally not pairwise. It tests whether a judge can classify
 * narrow, known-answer examples into anchored quality levels and cite evidence.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type Dimension = "characterAgency" | "worldPressure" | "endpointLanding"
type PromptMode = "direct-label" | "evidence-first" | "gate-derived"

interface CalibrationFixture {
  fixtureId: string
  description: string
  cases: CalibrationCase[]
}

interface CalibrationCase {
  caseId: string
  dimension: Dimension
  expectedLabel: string
  text: string
}

interface Args {
  fixturePath: string
  outputDir: string | null
  live: boolean
  model: "deepseek-v4-flash" | "deepseek-v4-pro"
  thinking: boolean
  maxTokens: number
  concurrency: number
  modes: PromptMode[]
  json: boolean
}

interface JudgeOutput {
  label: string
  confidence: number
  evidence: Record<string, string>
  missingForNextLevel: string
  gates: Record<string, boolean>
}

interface CalibrationResult {
  caseId: string
  dimension: Dimension
  promptMode: PromptMode
  expectedLabel: string
  predictedLabel: string
  exact: boolean
  offByOne: boolean
  overLabel: boolean
  severeOverLabel: boolean
  underLabel: boolean
  expectedOrdinal: number
  predictedOrdinal: number
  confidence: number
  evidenceFields: number
  output: JudgeOutput
}

interface ModeSummary {
  promptMode: PromptMode
  cases: number
  exactAccuracy: number
  offByOneAccuracy: number
  overLabelRate: number
  severeOverLabelRate: number
  underLabelRate: number
  meanError: number
  meanAbsoluteError: number
  meanConfidence: number
  verdict: string
}

interface CalibrationReport {
  generatedAt: string
  fixturePath: string
  fixtureId: string
  model: string
  thinking: boolean
  modes: PromptMode[]
  resultCount: number
  results: CalibrationResult[]
  summaries: ModeSummary[]
}

const DEFAULT_FIXTURE_PATH = "docs/fixtures/evals/planner-discernment-calibration-v0.json"
const DEFAULT_MODES: PromptMode[] = ["direct-label", "evidence-first", "gate-derived"]

export async function buildCalibrationReport(args: Args, generatedAt = new Date().toISOString()): Promise<CalibrationReport> {
  const fixture = loadFixture(args.fixturePath)
  const tasks: Array<() => Promise<CalibrationResult>> = []
  for (const promptMode of args.modes) {
    for (const calibrationCase of fixture.cases) {
      tasks.push(() => runCase(args, calibrationCase, promptMode))
    }
  }
  const results = await runBounded(tasks, args.concurrency)
  return {
    generatedAt,
    fixturePath: args.fixturePath,
    fixtureId: fixture.fixtureId,
    model: args.model,
    thinking: args.thinking,
    modes: args.modes,
    resultCount: results.length,
    results,
    summaries: summarizeResults(results),
  }
}

export function summarizeResults(results: CalibrationResult[]): ModeSummary[] {
  const byMode = new Map<PromptMode, CalibrationResult[]>()
  for (const result of results) {
    byMode.set(result.promptMode, [...(byMode.get(result.promptMode) ?? []), result])
  }
  return [...byMode.entries()].map(([promptMode, rows]) => {
    const exactAccuracy = ratio(rows.filter(row => row.exact).length, rows.length)
    const offByOneAccuracy = ratio(rows.filter(row => row.offByOne).length, rows.length)
    const overLabelRate = ratio(rows.filter(row => row.overLabel).length, rows.length)
    const severeOverLabelRate = ratio(rows.filter(row => row.severeOverLabel).length, rows.length)
    const underLabelRate = ratio(rows.filter(row => row.underLabel).length, rows.length)
    const errors = rows.map(row => row.predictedOrdinal - row.expectedOrdinal)
    const meanError = mean(errors)
    const meanAbsoluteError = mean(errors.map(value => Math.abs(value)))
    const meanConfidence = mean(rows.map(row => row.confidence))
    const verdict = exactAccuracy >= 0.75 && severeOverLabelRate <= 0.1
      ? "USEFUL"
      : offByOneAccuracy >= 0.85 && severeOverLabelRate <= 0.1
        ? "BORDERLINE"
        : "NOT-USEFUL"
    return {
      promptMode,
      cases: rows.length,
      exactAccuracy,
      offByOneAccuracy,
      overLabelRate,
      severeOverLabelRate,
      underLabelRate,
      meanError,
      meanAbsoluteError,
      meanConfidence,
      verdict,
    }
  })
}

export function renderCalibrationReport(report: CalibrationReport): string {
  const lines: string[] = []
  lines.push("Planner discernment calibration")
  lines.push(`fixture=${report.fixtureId}; model=${report.model}; thinking=${report.thinking}; results=${report.resultCount}`)
  lines.push("")
  lines.push("Summaries:")
  for (const summary of report.summaries) {
    lines.push(`- ${summary.promptMode}: ${summary.verdict}; exact=${formatPct(summary.exactAccuracy)}; offByOne=${formatPct(summary.offByOneAccuracy)}; over=${formatPct(summary.overLabelRate)}; severeOver=${formatPct(summary.severeOverLabelRate)}; meanAbsErr=${summary.meanAbsoluteError.toFixed(2)}`)
  }
  lines.push("")
  lines.push("Misses:")
  for (const result of report.results.filter(row => !row.exact)) {
    lines.push(`- ${result.promptMode} ${result.caseId}: expected ${result.expectedLabel}, got ${result.predictedLabel}; error=${result.predictedOrdinal - result.expectedOrdinal}`)
    if (result.output.missingForNextLevel) lines.push(`  missing: ${result.output.missingForNextLevel}`)
  }
  return lines.join("\n")
}

async function runCase(args: Args, calibrationCase: CalibrationCase, promptMode: PromptMode): Promise<CalibrationResult> {
  const output = args.live
    ? await callDeepSeekJudge(args, calibrationCase, promptMode)
    : syntheticOutput(calibrationCase, promptMode)
  const predictedLabel = promptMode === "gate-derived"
    ? deriveLabel(calibrationCase.dimension, output.gates)
    : normalizeLabel(output.label, calibrationCase.dimension)
  return scoreCase(calibrationCase, promptMode, predictedLabel, output)
}

export function scoreCase(
  calibrationCase: CalibrationCase,
  promptMode: PromptMode,
  predictedLabel: string,
  output: JudgeOutput,
): CalibrationResult {
  const expectedOrdinal = labelOrdinal(calibrationCase.expectedLabel)
  const predictedOrdinal = labelOrdinal(predictedLabel)
  const error = predictedOrdinal - expectedOrdinal
  return {
    caseId: calibrationCase.caseId,
    dimension: calibrationCase.dimension,
    promptMode,
    expectedLabel: calibrationCase.expectedLabel,
    predictedLabel,
    exact: error === 0,
    offByOne: Math.abs(error) <= 1,
    overLabel: error > 0,
    severeOverLabel: error >= 2,
    underLabel: error < 0,
    expectedOrdinal,
    predictedOrdinal,
    confidence: clampNumber(output.confidence, 0, 1),
    evidenceFields: Object.values(output.evidence ?? {}).filter(Boolean).length,
    output,
  }
}

async function callDeepSeekJudge(args: Args, calibrationCase: CalibrationCase, promptMode: PromptMode): Promise<JudgeOutput> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error("DEEPSEEK_API_KEY not set in environment")
  const timeoutMs = args.model === "deepseek-v4-pro" ? 180_000 : 90_000
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new Error(`DeepSeek ${args.model} timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    try {
      console.log(`  [discernment] ${args.model} ${promptMode} ${calibrationCase.caseId} attempt=${attempt}`)
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
            { role: "system", content: systemPrompt() },
            { role: "user", content: userPrompt(calibrationCase, promptMode) },
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
      console.log(`  [discernment] response ${promptTokens}+${completionTokens} tokens${cached > 0 ? ` [cache:${cached}]` : ""}; finish=${finishReason}`)
      if (finishReason === "length") throw new Error(`DeepSeek ${args.model} hit max token cap`)
      return normalizeOutput(JSON.parse(extractJsonObject(content)), calibrationCase.dimension)
    } catch (err) {
      lastError = err
      console.warn(`  [discernment] ${args.model} ${promptMode} ${calibrationCase.caseId} failed: ${err instanceof Error ? err.message : String(err)}`)
      if (attempt >= 2) break
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function systemPrompt(): string {
  return `You calibrate narrow semantic quality labels for upstream novel planning.

This is not pairwise. Classify one excerpt against one dimension.
Use the lowest label whose evidence requirements are fully satisfied. Do not reward polish, length, schema completeness, or genre excitement.

Character agency labels:
- AGENCY-0: No real protagonist choice. The protagonist observes, reacts, waits, or is moved by events.
- AGENCY-1: Choice exists but pressure, cost, or consequence is vague.
- AGENCY-2: Pressured choice with consequence. The protagonist wants something, faces opposition, chooses, and the choice changes the situation.
- AGENCY-3: Defining choice. The protagonist chooses between two costly values, reveals character, and creates an irreversible plot turn.

World pressure labels:
- WORLD-0: No meaningful world rule affects the scene; setting/lore is generic.
- WORLD-1: World rule is mentioned but decorative; it does not change what characters can do.
- WORLD-2: World rule creates an operational constraint, cost, or revelation in the scene.
- WORLD-3: World rule forces a major choice, irreversible consequence, or scene/chapter turn.

Endpoint landing labels:
- ENDPOINT-0: Declared endpoint is absent or disconnected from the final scene.
- ENDPOINT-1: Endpoint is stated weakly, delayed, or left as intention without concrete consequence.
- ENDPOINT-2: Endpoint lands through final action and consequence.
- ENDPOINT-3: Endpoint lands and creates forward propulsion: new danger, pursuit, obligation, reversal, or unavoidable next chapter.

Return only JSON.`
}

function userPrompt(calibrationCase: CalibrationCase, promptMode: PromptMode): string {
  const base = `Prompt mode: ${promptMode}
Dimension: ${calibrationCase.dimension}

Excerpt:
${calibrationCase.text}`
  if (promptMode === "gate-derived") {
    return `${base}

Do not provide a label. Fill the evidence gates only.

Return JSON:
{
  "confidence": 0.0-1.0,
  "evidence": {"choice": "", "pressure": "", "cost": "", "consequence": "", "worldRule": "", "endpoint": ""},
  "gates": {
    "hasChoice": true|false,
    "hasOpposition": true|false,
    "hasCost": true|false,
    "hasConsequence": true|false,
    "hasValueTradeoff": true|false,
    "referencesWorldRule": true|false,
    "ruleAffectsAction": true|false,
    "createsCostOrConstraint": true|false,
    "causesTurnOrConsequence": true|false,
    "declaredEndpoint": true|false,
    "finalActionMatchesEndpoint": true|false,
    "consequenceChangesNextChapter": true|false,
    "createsForwardQuestion": true|false
  },
  "missingForNextLevel": "what is missing for the next stronger level"
}`
  }
  if (promptMode === "evidence-first") {
    return `${base}

First extract concrete evidence, then choose the strictest label justified by that evidence.

Return JSON:
{
  "label": "AGENCY-0|AGENCY-1|AGENCY-2|AGENCY-3|WORLD-0|WORLD-1|WORLD-2|WORLD-3|ENDPOINT-0|ENDPOINT-1|ENDPOINT-2|ENDPOINT-3",
  "confidence": 0.0-1.0,
  "evidence": {"choice": "", "pressure": "", "cost": "", "consequence": "", "worldRule": "", "endpoint": ""},
  "gates": {},
  "missingForNextLevel": "what is missing for the next stronger level"
}`
  }
  return `${base}

Choose the one label that best fits. Use the lowest label whose evidence requirements are fully satisfied.

Return JSON:
{
  "label": "AGENCY-0|AGENCY-1|AGENCY-2|AGENCY-3|WORLD-0|WORLD-1|WORLD-2|WORLD-3|ENDPOINT-0|ENDPOINT-1|ENDPOINT-2|ENDPOINT-3",
  "confidence": 0.0-1.0,
  "evidence": {"choice": "", "pressure": "", "cost": "", "consequence": "", "worldRule": "", "endpoint": ""},
  "gates": {},
  "missingForNextLevel": "what is missing for the next stronger level"
}`
}

function normalizeOutput(raw: any, dimension: Dimension): JudgeOutput {
  return {
    label: normalizeLabel(String(raw?.label ?? ""), dimension),
    confidence: clampNumber(Number(raw?.confidence ?? 0.5), 0, 1),
    evidence: normalizeEvidence(raw?.evidence),
    missingForNextLevel: String(raw?.missingForNextLevel ?? ""),
    gates: normalizeGates(raw?.gates),
  }
}

function normalizeEvidence(raw: any): Record<string, string> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) out[key] = String(value ?? "")
  return out
}

function normalizeGates(raw: any): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw)) out[key] = value === true || value === "true"
  return out
}

export function deriveLabel(dimension: Dimension, gates: Record<string, boolean>): string {
  if (dimension === "characterAgency") {
    if (!gates.hasChoice) return "AGENCY-0"
    if (!gates.hasOpposition || !gates.hasCost || !gates.hasConsequence) return "AGENCY-1"
    if (!gates.hasValueTradeoff) return "AGENCY-2"
    return "AGENCY-3"
  }
  if (dimension === "worldPressure") {
    if (!gates.referencesWorldRule) return "WORLD-0"
    if (!gates.ruleAffectsAction) return "WORLD-1"
    if (!gates.causesTurnOrConsequence) return "WORLD-2"
    return "WORLD-3"
  }
  if (!gates.declaredEndpoint || !gates.finalActionMatchesEndpoint) return "ENDPOINT-0"
  if (!gates.consequenceChangesNextChapter) return "ENDPOINT-1"
  if (!gates.createsForwardQuestion) return "ENDPOINT-2"
  return "ENDPOINT-3"
}

function syntheticOutput(calibrationCase: CalibrationCase, promptMode: PromptMode): JudgeOutput {
  const gates = gatesForExpected(calibrationCase.dimension, calibrationCase.expectedLabel)
  return {
    label: promptMode === "gate-derived" ? "" : calibrationCase.expectedLabel,
    confidence: 1,
    evidence: { excerpt: calibrationCase.text },
    missingForNextLevel: "",
    gates,
  }
}

function gatesForExpected(dimension: Dimension, label: string): Record<string, boolean> {
  const ordinal = labelOrdinal(label)
  if (dimension === "characterAgency") {
    return {
      hasChoice: ordinal >= 1,
      hasOpposition: ordinal >= 2,
      hasCost: ordinal >= 2,
      hasConsequence: ordinal >= 2,
      hasValueTradeoff: ordinal >= 3,
    }
  }
  if (dimension === "worldPressure") {
    return {
      referencesWorldRule: ordinal >= 1,
      ruleAffectsAction: ordinal >= 2,
      createsCostOrConstraint: ordinal >= 2,
      causesTurnOrConsequence: ordinal >= 3,
    }
  }
  return {
    declaredEndpoint: ordinal >= 1,
    finalActionMatchesEndpoint: ordinal >= 2,
    consequenceChangesNextChapter: ordinal >= 2,
    createsForwardQuestion: ordinal >= 3,
  }
}

function normalizeLabel(raw: string, dimension: Dimension): string {
  const upper = raw.toUpperCase()
  const prefix = dimensionPrefix(dimension)
  const match = upper.match(new RegExp(`${prefix}-[0-3]`))
  return match?.[0] ?? `${prefix}-0`
}

function dimensionPrefix(dimension: Dimension): string {
  if (dimension === "characterAgency") return "AGENCY"
  if (dimension === "worldPressure") return "WORLD"
  return "ENDPOINT"
}

function labelOrdinal(label: string): number {
  const match = label.match(/-(\d)$/)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

function loadFixture(path: string): CalibrationFixture {
  const abs = resolve(process.cwd(), path)
  if (!existsSync(abs)) throw new Error(`fixture not found: ${abs}`)
  return JSON.parse(readFileSync(abs, "utf-8")) as CalibrationFixture
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
  let fixturePath = DEFAULT_FIXTURE_PATH
  let outputDir: string | null = null
  let live = false
  let model: Args["model"] = "deepseek-v4-flash"
  let thinking = false
  let maxTokens = 1400
  let concurrency = 4
  const modes: PromptMode[] = []
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--fixture") fixturePath = requireValue(argv, ++i, "--fixture")
    else if (arg.startsWith("--fixture=")) fixturePath = arg.slice("--fixture=".length)
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
    else if (arg === "--mode") modes.push(parseMode(requireValue(argv, ++i, "--mode")))
    else if (arg.startsWith("--mode=")) modes.push(parseMode(arg.slice("--mode=".length)))
    else if (arg === "--json") json = true
    else throw new Error(`unknown arg: ${arg}`)
  }
  if (model === "deepseek-v4-pro" && !argv.includes("--no-thinking")) thinking = true
  return { fixturePath, outputDir, live, model, thinking, maxTokens, concurrency, modes: modes.length ? modes : DEFAULT_MODES, json }
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

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`
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

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `output/method-pack-diagnostics/${stamp}/discernment-calibration`
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/planner-discernment-calibration.ts [--live] [--fixture <path>] [--mode direct-label|evidence-first|gate-derived] [--output-dir <dir>] [--model deepseek-v4-flash|deepseek-v4-pro] [--thinking|--no-thinking] [--json]")
    return 2
  }
  if (!args.outputDir) args.outputDir = defaultOutputDir()
  const report = await buildCalibrationReport(args)
  if (args.outputDir) {
    const abs = resolve(process.cwd(), args.outputDir)
    mkdirSync(abs, { recursive: true })
    writeFileSync(join(abs, "planner-discernment-calibration-report.json"), JSON.stringify(report, null, 2))
    writeFileSync(join(abs, "planner-discernment-calibration-report.md"), renderCalibrationReport(report))
  }
  console.log(args.json ? JSON.stringify(report, null, 2) : renderCalibrationReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
