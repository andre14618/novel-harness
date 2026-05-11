#!/usr/bin/env bun
/**
 * Convert production scene-semantic replay lows into Plan Readiness-compatible
 * groups.
 *
 * Diagnostic-only. It does not write to the DB, call an LLM, mutate plans, or
 * create proposals. The output shape can be consumed by the existing Plan
 * Readiness importer when an operator chooses to review and act on a finding.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import type { Dimension } from "./planner-discernment-calibration"
import type { SceneSemanticReplayReport, SceneSemanticReplayResult } from "./scene-semantic-review"

type Severity = "high" | "medium" | "low" | "info"
type SceneSemanticSourceAgent = "production-scene-semantic-review"

interface Args {
  reports: string[]
  labels: string[] | null
  maxOrdinal: number
  output: string | null
  json: string | null
}

interface SceneSemanticReadinessFinding {
  findingId: string
  sourceReport: string
  promptMode: string
  dimension: Dimension
  label: string
  severity: Severity
  fixIntent: string
  rationale: string
  missingForNextLevel: string
  evidence: Record<string, string>
}

interface SceneSemanticReadinessSourceIds {
  obligationIds: string[]
  characterIds: string[]
  worldFactIds: string[]
  sceneTurnIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  sourceIds: string[]
}

interface SceneSemanticReadinessGroup {
  groupId: string
  fixtureId: string
  armId: string
  methodPackEnabled: false
  unitType: "scene"
  chapterId: string
  sceneId: string
  sourceIds: SceneSemanticReadinessSourceIds
  highestSeverity: Severity
  fixIntents: string[]
  dimensions: Dimension[]
  findings: SceneSemanticReadinessFinding[]
  rewritePacket: {
    targetSummary: string
    rewriteGoals: string[]
    preserveIds: SceneSemanticReadinessSourceIds
    proposalCandidate: {
      action: "field_replace"
      target: {
        kind: "scene_plan"
        ref: string
        fieldPath: "description"
      }
      requiresProposedValue: true
      proposedValueStatus: "semantic_rewrite_required"
      safeToAutoApply: false
      sourceAgent: SceneSemanticSourceAgent
    }
  }
  excerpt: string
}

export interface SceneSemanticReadinessAggregate {
  generatedAt: string
  sourceReports: string[]
  labels: string[]
  maxOrdinal: number
  findingCount: number
  groupCount: number
  groups: SceneSemanticReadinessGroup[]
}

export interface SceneSemanticReadinessInput {
  report: SceneSemanticReplayReport
  sourceReport?: string
}

export interface SceneSemanticReadinessOptions {
  labels?: string[] | null
  maxOrdinal?: number
  generatedAt?: string
}

export function buildSceneSemanticReadinessAggregate(
  inputs: SceneSemanticReadinessInput[],
  options: SceneSemanticReadinessOptions = {},
): SceneSemanticReadinessAggregate {
  const labels = options.labels?.filter(Boolean) ?? null
  const maxOrdinal = options.maxOrdinal ?? 1
  const groupsByKey = new Map<string, SceneSemanticReadinessGroup>()
  const sourceReports = unique(inputs.map(input => input.sourceReport ?? "").filter(Boolean))

  for (const input of inputs) {
    const sourceReport = input.sourceReport ?? ""
    for (const result of input.report.results) {
      if (!isIncludedResult(result, { labels, maxOrdinal })) continue
      const groupKey = [
        input.report.novelId,
        input.report.setName,
        result.chapterNumber,
        result.sceneId,
      ].join(":")
      const finding = toFinding({
        result,
        report: input.report,
        sourceReport,
        findingIndex: 1,
      })
      const existing = groupsByKey.get(groupKey)
      if (existing) {
        existing.findings.push(finding)
        existing.highestSeverity = higherSeverity(existing.highestSeverity, finding.severity)
        existing.fixIntents = unique([...existing.fixIntents, finding.fixIntent])
        existing.dimensions = unique([...existing.dimensions, finding.dimension])
        existing.rewritePacket.rewriteGoals = unique([
          ...existing.rewritePacket.rewriteGoals,
          ...rewriteGoalsFor(finding),
        ])
        existing.excerpt = existing.excerpt || result.excerpt
      } else {
        const sourceIds = sourceIdsFor(result)
        groupsByKey.set(groupKey, {
          groupId: "000",
          fixtureId: input.report.novelId,
          armId: input.report.setName,
          methodPackEnabled: false,
          unitType: "scene",
          chapterId: `chapter:${result.chapterNumber}`,
          sceneId: result.sceneId,
          sourceIds,
          highestSeverity: finding.severity,
          fixIntents: [finding.fixIntent],
          dimensions: [finding.dimension],
          findings: [finding],
          rewritePacket: {
            targetSummary: `chapter ${result.chapterNumber} scene ${result.sceneIndex + 1} ${result.sceneId}`,
            rewriteGoals: rewriteGoalsFor(finding),
            preserveIds: sourceIds,
            proposalCandidate: {
              action: "field_replace",
              target: {
                kind: "scene_plan",
                ref: result.sceneId,
                fieldPath: "description",
              },
              requiresProposedValue: true,
              proposedValueStatus: "semantic_rewrite_required",
              safeToAutoApply: false,
              sourceAgent: "production-scene-semantic-review",
            },
          },
          excerpt: result.excerpt,
        })
      }
    }
  }

  const groups = [...groupsByKey.values()].sort((a, b) =>
    severityRank(b.highestSeverity) - severityRank(a.highestSeverity)
    || compareChapterLabels(a.chapterId, b.chapterId)
    || a.sceneId.localeCompare(b.sceneId)
    || a.dimensions.join(",").localeCompare(b.dimensions.join(","))
  )
  groups.forEach((group, groupIndex) => {
    group.groupId = `${groupIndex + 1}`.padStart(3, "0")
    group.findings.forEach((finding, findingIndex) => {
      finding.findingId = `${group.groupId}.${findingIndex + 1}`
    })
  })

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceReports,
    labels: labels ?? [],
    maxOrdinal,
    findingCount: groups.reduce((sum, group) => sum + group.findings.length, 0),
    groupCount: groups.length,
    groups,
  }
}

export function renderSceneSemanticReadinessAggregate(report: SceneSemanticReadinessAggregate): string {
  const lines: string[] = []
  lines.push("# Scene Semantic Readiness Candidates")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Groups: ${report.groupCount}`)
  lines.push(`Findings: ${report.findingCount}`)
  lines.push(`Max ordinal: ${report.maxOrdinal}`)
  if (report.labels.length > 0) lines.push(`Labels: ${report.labels.join(", ")}`)
  lines.push("")
  lines.push("These are manual Plan Readiness candidates. They do not auto-mutate the plan.")
  lines.push("")
  for (const group of report.groups) {
    lines.push(`## ${group.groupId} ${group.highestSeverity.toUpperCase()} ${group.chapterId}/${group.sceneId}`)
    lines.push("")
    lines.push(`Target: scene_plan:${group.sceneId}:description`)
    lines.push(`Dimensions: ${group.dimensions.join(", ")}`)
    lines.push(`Fix intents: ${group.fixIntents.join(", ")}`)
    lines.push(`Preserve obligations: ${group.sourceIds.obligationIds.join(", ") || "none"}`)
    lines.push(`Preserve characters: ${group.sourceIds.characterIds.join(", ") || "none"}`)
    lines.push(`Preserve world facts: ${group.sourceIds.worldFactIds.join(", ") || "none"}`)
    lines.push(`Preserve scene turns: ${group.sourceIds.sceneTurnIds.join(", ") || "none"}`)
    lines.push(`Preserve threads: ${group.sourceIds.threadIds.join(", ") || "none"}`)
    lines.push(`Preserve promises: ${group.sourceIds.promiseIds.join(", ") || "none"}`)
    lines.push(`Preserve payoffs: ${group.sourceIds.payoffIds.join(", ") || "none"}`)
    lines.push("")
    lines.push("Operator question:")
    lines.push(`- ${operatorQuestionFor(group)}`)
    lines.push("")
    lines.push("Rewrite goals if accepted:")
    for (const goal of group.rewritePacket.rewriteGoals) lines.push(`- ${goal}`)
    lines.push("")
    lines.push("Findings:")
    for (const finding of group.findings) {
      lines.push(`- ${finding.findingId} ${finding.label} ${finding.dimension}: ${finding.missingForNextLevel || finding.rationale}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function isIncludedResult(
  result: SceneSemanticReplayResult,
  options: { labels: string[] | null; maxOrdinal: number },
): boolean {
  if (options.labels && options.labels.length > 0) return options.labels.includes(result.label)
  return result.ordinal <= options.maxOrdinal
}

function toFinding(args: {
  result: SceneSemanticReplayResult
  report: SceneSemanticReplayReport
  sourceReport: string
  findingIndex: number
}): SceneSemanticReadinessFinding {
  const { result, report } = args
  return {
    findingId: `pending.${args.findingIndex}`,
    sourceReport: args.sourceReport,
    promptMode: result.promptMode,
    dimension: result.dimension,
    label: result.label,
    severity: severityFor(result),
    fixIntent: fixIntentFor(result.dimension),
    rationale: `Production scene-semantic replay labeled ${result.dimension} as ${result.label} for ${report.novelId} (${report.setName}).`,
    missingForNextLevel: result.missingForNextLevel || result.output?.missingForNextLevel || "",
    evidence: {
      ...normalizeEvidence(result.output?.evidence),
      taskId: result.taskId,
      chapterNumber: String(result.chapterNumber),
      sceneIndex: String(result.sceneIndex),
      confidence: String(result.confidence),
      evidenceFields: String(result.evidenceFields),
    },
  }
}

function sourceIdsFor(result: SceneSemanticReplayResult): SceneSemanticReadinessSourceIds {
  const characterIds = stringArray(result.relevantCharacterIds)
  const rawWorldFactIds = stringArray(result.relevantWorldFactIds)
  const worldFactIds = rawWorldFactIds.filter(isPlausibleWorldFactId)
  const sceneTurnIds = stringArray(result.sceneTurnIds)
  const threadIds = stringArray(result.threadIds)
  const promiseIds = stringArray(result.promiseIds)
  const payoffIds = stringArray(result.payoffIds)
  const sourceIds = unique([
    ...stringArray(result.sourceIds),
    ...characterIds,
    ...rawWorldFactIds,
    ...sceneTurnIds,
    ...threadIds,
    ...promiseIds,
    ...payoffIds,
  ])
  return {
    obligationIds: stringArray(result.obligationIds),
    characterIds,
    worldFactIds,
    sceneTurnIds,
    threadIds,
    promiseIds,
    payoffIds,
    sourceIds,
  }
}

function isPlausibleWorldFactId(id: string): boolean {
  if (/^(fact|world)-/u.test(id)) return true
  return !/^(know|state|char|thread|debt|payoff|turn|obl)-/u.test(id)
}

function rewriteGoalsFor(finding: SceneSemanticReadinessFinding): string[] {
  return unique([
    finding.missingForNextLevel || finding.rationale,
    rewriteGoalHintFor(finding.dimension),
  ].filter(Boolean))
}

function rewriteGoalHintFor(dimension: Dimension): string {
  const map: Record<string, string> = {
    endpointLanding: "Revise the scene contract so the endpoint lands through concrete action, consequence, and forward pressure.",
    sceneDramaturgy: "Revise the scene contract so goal, opposition, turn, outcome, and consequence are all playable.",
    threadProgression: "Clarify how this scene changes the declared thread state and creates downstream pressure.",
    promiseProgress: "Clarify how this scene changes the promise, pursuit, or complication state.",
    promisePayoff: "Make the declared promise/payoff land in visible evidence, reader understanding, and future pressure.",
    motivationSpecificity: "Sharpen the POV character's want, fear, value, tradeoff, and choice consequence.",
    characterMateriality: "Make required characters materially affect choice, conflict, outcome, or future pressure, or remove the requirement.",
    relationshipDelta: "Make the interaction change relationship state and plot pressure, or mark it as static contact.",
    worldFactPressure: "Make the required world fact constrain action, cost, outcome, or future pressure.",
    worldPressure: "Make the world rule visibly affect action, cost, turn, or consequence.",
    characterAgency: "Make the character's choice, pressure, cost, consequence, and value tradeoff visible.",
    causalMomentum: "Strengthen event causality, escalation, consequence, and forced next action.",
    stakesValueShift: "Make the stakes and value shift concrete through turn, ending state, cost, or escalation.",
  }
  return map[dimension] ?? "Review this scene contract before drafting."
}

function operatorQuestionFor(group: SceneSemanticReadinessGroup): string {
  const dimensions = new Set(group.dimensions)
  if (dimensions.has("endpointLanding")) {
    return "Should the scene contract make the endpoint land through concrete consequence and forward pressure before drafting?"
  }
  if (dimensions.has("sceneDramaturgy")) {
    return "Should the scene contract strengthen goal, opposition, turn, outcome, or consequence before drafting?"
  }
  if (dimensions.has("threadProgression") || dimensions.has("promiseProgress") || dimensions.has("promisePayoff")) {
    return "Should this scene contract clarify thread or promise movement before drafting?"
  }
  if (dimensions.has("characterMateriality") && dimensions.has("worldFactPressure")) {
    return "Should this scene contract make required characters and world facts operational, or remove those requirements?"
  }
  if (dimensions.has("characterMateriality")) {
    return "Should this scene contract make required characters materially affect choice, conflict, outcome, or pressure?"
  }
  if (dimensions.has("worldFactPressure")) {
    return "Should this scene contract make required world facts constrain action, cost, outcome, or pressure?"
  }
  return "Is this diagnostic a real planning issue, false positive, acceptable choice, or deferred concern?"
}

function fixIntentFor(dimension: Dimension): string {
  const map: Record<string, string> = {
    endpointLanding: "strengthen_endpoint_landing",
    sceneDramaturgy: "strengthen_scene_contract",
    threadProgression: "clarify_thread_progression",
    promiseProgress: "clarify_promise_progress",
    promisePayoff: "land_promise_payoff",
    motivationSpecificity: "sharpen_pov_motivation_tradeoff",
    characterMateriality: "make_required_character_material_or_remove_requirement",
    relationshipDelta: "make_relationship_state_change_concrete",
    worldFactPressure: "make_world_fact_operational_or_remove_requirement",
    worldPressure: "make_world_pressure_operational",
    characterAgency: "strengthen_character_agency",
    causalMomentum: "strengthen_causal_momentum",
    stakesValueShift: "make_stakes_value_shift_concrete",
  }
  return map[dimension] ?? "review_scene_contract"
}

function severityFor(result: SceneSemanticReplayResult): Severity {
  if (result.ordinal <= 0) return "high"
  if (result.ordinal === 1) return "medium"
  if (result.ordinal === 2) return "low"
  return "info"
}

function higherSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b
}

function severityRank(severity: Severity): number {
  return severity === "high" ? 4 : severity === "medium" ? 3 : severity === "low" ? 2 : 1
}

function normalizeEvidence(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim()) out[key] = value
  }
  return out
}

function compareChapterLabels(a: string, b: string): number {
  const aNumber = Number(a.replace(/\D+/g, ""))
  const bNumber = Number(b.replace(/\D+/g, ""))
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber
  return a.localeCompare(b)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.map(item => String(item)).filter(Boolean)) : []
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const reports: string[] = []
  let labels: string[] | null = null
  let maxOrdinal = 1
  let output: string | null = null
  let json: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--report") {
      const value = argv[index + 1]
      if (!value) throw new Error("--report requires a path")
      reports.push(value)
      index += 1
    } else if (arg === "--labels") {
      const value = argv[index + 1]
      if (!value) throw new Error("--labels requires comma-separated labels")
      labels = value.split(",").map(label => label.trim()).filter(Boolean)
      index += 1
    } else if (arg === "--max-ordinal") {
      const value = argv[index + 1]
      if (!value) throw new Error("--max-ordinal requires a value")
      maxOrdinal = positiveInt(value, "--max-ordinal")
      index += 1
    } else if (arg === "--output") {
      const value = argv[index + 1]
      if (!value) throw new Error("--output requires a path")
      output = value
      index += 1
    } else if (arg === "--json") {
      const value = argv[index + 1]
      if (!value) throw new Error("--json requires a path")
      json = value
      index += 1
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown arg: ${arg}`)
    } else {
      reports.push(arg)
    }
  }

  if (reports.length === 0) throw new Error("at least one --report or positional scene-semantic-review JSON path is required")
  return { reports, labels, maxOrdinal, output, json }
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`)
  return parsed
}

function readJson(path: string): SceneSemanticReplayReport {
  if (!existsSync(path)) throw new Error(`missing report: ${path}`)
  return JSON.parse(readFileSync(path, "utf8")) as SceneSemanticReplayReport
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/evals/scene-semantic-readiness.ts --report output/scene-semantic-review/<run>/scene-semantic-review.json
  bun scripts/evals/scene-semantic-readiness.ts <report.json> --output readiness.md --json readiness.json

Default selection is ordinal <= 1. Use --labels ENDPOINT-1,SCENE-1 for a narrower queue.
`)
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const inputs = args.reports.map(path => {
      const sourceReport = resolve(path)
      return { report: readJson(sourceReport), sourceReport }
    })
    const aggregate = buildSceneSemanticReadinessAggregate(inputs, {
      labels: args.labels,
      maxOrdinal: args.maxOrdinal,
    })
    const rendered = renderSceneSemanticReadinessAggregate(aggregate)
    if (args.output) writeOutput(args.output, rendered)
    if (args.json) writeOutput(args.json, `${JSON.stringify(aggregate, null, 2)}\n`)
    console.log(rendered)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
