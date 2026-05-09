#!/usr/bin/env bun
/**
 * Convert corpus recreation semantic lows into Plan Readiness-compatible groups.
 *
 * Diagnostic-only. It does not write to the DB, call an LLM, mutate plans, or
 * create proposals. The output shape can be consumed by the existing Plan
 * Readiness importer once an operator chooses to attach it to a real novel.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import {
  buildRunManifest,
  existingArtifactRefs,
  manifestPathForSidecar,
  parentManifestForPocDir,
  writeRunManifest,
} from "./run-manifest"

type Severity = "high" | "medium" | "low" | "info"

interface Args {
  pocDirs: string[]
  labels: string[]
  output: string | null
  json: string | null
}

interface CorpusReadinessFinding {
  findingId: string
  sourceReport: string
  promptMode: string
  dimension: string
  label: string
  severity: Severity
  fixIntent: string
  rationale: string
  missingForNextLevel: string
  evidence: Record<string, string>
}

interface CorpusReadinessGroup {
  groupId: string
  fixtureId: string
  armId: string
  methodPackEnabled: false
  unitType: "scene"
  chapterId: string
  sceneId: string
  sourceIds: {
    obligationIds: string[]
    characterIds: string[]
    worldFactIds: string[]
    threadIds: string[]
    promiseIds: string[]
    payoffIds: string[]
    sourceIds: string[]
  }
  highestSeverity: Severity
  fixIntents: string[]
  dimensions: string[]
  findings: CorpusReadinessFinding[]
  rewritePacket: {
    targetSummary: string
    rewriteGoals: string[]
    preserveIds: CorpusReadinessGroup["sourceIds"]
    proposalCandidate: {
      action: "field_replace"
      target: {
        kind: "beat_plan"
        ref: string
        fieldPath: "description"
      }
      requiresProposedValue: true
      proposedValueStatus: "semantic_rewrite_required"
      safeToAutoApply: false
      sourceAgent: "corpus-recreation-semantic-review"
    }
  }
  excerpt: string
}

export interface CorpusReadinessAggregate {
  generatedAt: string
  sourceReports: string[]
  labels: string[]
  findingCount: number
  groupCount: number
  groups: CorpusReadinessGroup[]
}

const DEFAULT_LABELS = ["SCENE-1", "MOTIVE-1", "WFACT-1", "REL-1"]

export function buildCorpusRecreationReadinessAggregate(
  pocDirs: string[],
  labels = DEFAULT_LABELS,
  generatedAt = new Date().toISOString(),
): CorpusReadinessAggregate {
  const groups: CorpusReadinessGroup[] = []
  const sourceReports: string[] = []

  for (const pocDir of pocDirs.map(dir => resolve(dir))) {
    const semanticPath = `${pocDir}/semantic-review-live/semantic-review.json`
    const planPath = `${pocDir}/plan.json`
    if (!existsSync(semanticPath)) continue
    const semantic = readJson(semanticPath)
    const plan = existsSync(planPath) ? readJson(planPath) : {}
    sourceReports.push(semanticPath)

    const results = Array.isArray(semantic.results) ? semantic.results : []
    for (const result of results) {
      const label = String(result.label ?? "")
      if (!labels.includes(label)) continue
      const sceneId = String(result.sceneId ?? "")
      if (!sceneId) continue
      const scene = Array.isArray(plan.scenes)
        ? plan.scenes.find((candidate: any) => String(candidate.sceneId ?? "") === sceneId)
        : null
      const obligations = Array.isArray(plan.obligations)
        ? plan.obligations.filter((obligation: any) => String(obligation.sceneId ?? "") === sceneId)
        : []
      groups.push(toGroup({
        result,
        scene,
        obligations,
        sourceReport: semanticPath,
        fixtureId: fixtureIdFor(pocDir, semantic),
        chapterId: String(plan.chapterId ?? semantic.source?.chapterLabel ?? ""),
        index: groups.length + 1,
      }))
    }
  }

  groups.sort((a, b) =>
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
    generatedAt,
    sourceReports,
    labels,
    findingCount: groups.reduce((sum, group) => sum + group.findings.length, 0),
    groupCount: groups.length,
    groups,
  }
}

export function renderCorpusRecreationReadinessAggregate(report: CorpusReadinessAggregate): string {
  const lines: string[] = []
  lines.push("# Corpus Recreation Readiness Candidates")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Groups: ${report.groupCount}`)
  lines.push(`Findings: ${report.findingCount}`)
  lines.push(`Labels: ${report.labels.join(", ")}`)
  lines.push("")
  lines.push("These are manual Plan Readiness candidates. They do not auto-mutate the plan.")
  lines.push("")
  for (const group of report.groups) {
    lines.push(`## ${group.groupId} ${group.highestSeverity.toUpperCase()} ${group.chapterId}/${group.sceneId}`)
    lines.push("")
    lines.push(`Target: beat_plan:${group.sceneId}:description`)
    lines.push(`Dimensions: ${group.dimensions.join(", ")}`)
    lines.push(`Fix intents: ${group.fixIntents.join(", ")}`)
    lines.push(`Preserve obligations: ${group.sourceIds.obligationIds.join(", ") || "none"}`)
    lines.push(`Preserve characters: ${group.sourceIds.characterIds.join(", ") || "none"}`)
    lines.push(`Preserve world facts: ${group.sourceIds.worldFactIds.join(", ") || "none"}`)
    lines.push(`Preserve threads: ${group.sourceIds.threadIds.join(", ") || "none"}`)
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
      lines.push(`- ${finding.findingId} ${finding.label} ${finding.dimension}: ${finding.missingForNextLevel}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function toGroup(args: {
  result: any
  scene: any
  obligations: any[]
  sourceReport: string
  fixtureId: string
  chapterId: string
  index: number
}): CorpusReadinessGroup {
  const sceneId = String(args.result.sceneId ?? "")
  const dimension = String(args.result.dimension ?? "")
  const label = String(args.result.label ?? "")
  const sourceIds = sourceIdsFor(args.result, args.obligations)
  const finding: CorpusReadinessFinding = {
    findingId: `${args.index}.1`,
    sourceReport: args.sourceReport,
    promptMode: String(args.result.promptMode ?? ""),
    dimension,
    label,
    severity: severityFor(label),
    fixIntent: fixIntentFor(dimension),
    rationale: rationaleFor(dimension, label),
    missingForNextLevel: String(args.result.missingForNextLevel ?? args.result.output?.missingForNextLevel ?? ""),
    evidence: normalizeEvidence(args.result.output?.evidence),
  }
  const rewriteGoals = rewriteGoalsFor(finding, args.scene)
  return {
    groupId: String(args.index).padStart(3, "0"),
    fixtureId: args.fixtureId,
    armId: "corpus-recreation:exact-id-scene",
    methodPackEnabled: false,
    unitType: "scene",
    chapterId: args.chapterId,
    sceneId,
    sourceIds,
    highestSeverity: finding.severity,
    fixIntents: [finding.fixIntent],
    dimensions: [dimension],
    findings: [finding],
    rewritePacket: {
      targetSummary: String(args.scene?.structuralRole ?? args.scene?.goal ?? sceneId),
      rewriteGoals,
      preserveIds: sourceIds,
      proposalCandidate: {
        action: "field_replace",
        target: {
          kind: "beat_plan",
          ref: sceneId,
          fieldPath: "description",
        },
        requiresProposedValue: true,
        proposedValueStatus: "semantic_rewrite_required",
        safeToAutoApply: false,
        sourceAgent: "corpus-recreation-semantic-review",
      },
    },
    excerpt: String(args.result.excerpt ?? ""),
  }
}

function sourceIdsFor(result: any, obligations: any[]): CorpusReadinessGroup["sourceIds"] {
  const obligationIds = unique([
    ...stringArray(result.obligationIds),
    ...obligations.map(obligation => String(obligation.obligationId ?? "")).filter(Boolean),
  ])
  const characterIds = unique(stringArray(result.relevantCharacterIds))
  const worldFactIds = unique(stringArray(result.relevantWorldFactIds))
  const threadIds = unique([
    ...stringArray(result.threadIds),
    ...obligations.map(obligation => String(obligation.threadId ?? "")).filter(Boolean),
  ])
  const promiseIds = unique([
    ...stringArray(result.promiseIds),
    ...obligations.map(obligation => String(obligation.promiseId ?? "")).filter(Boolean),
  ])
  const payoffIds = unique([
    ...stringArray(result.payoffIds),
    ...obligations.map(obligation => String(obligation.payoffId ?? "")).filter(Boolean),
  ])
  const sourceIds = unique([
    ...characterIds,
    ...worldFactIds,
    ...threadIds,
    ...promiseIds,
    ...payoffIds,
    ...obligations.map(obligation => String(obligation.sourceId ?? "")).filter(Boolean),
  ])
  return { obligationIds, characterIds, worldFactIds, threadIds, promiseIds, payoffIds, sourceIds }
}

function rewriteGoalsFor(finding: CorpusReadinessFinding, scene: any): string[] {
  const base = String(finding.missingForNextLevel || finding.rationale)
  const goals = [base]
  if (scene?.goal) goals.push(`Preserve scene goal: ${scene.goal}`)
  if (scene?.outcome) goals.push(`Preserve scene outcome: ${scene.outcome}`)
  if (scene?.consequence) goals.push(`Make the consequence concrete: ${scene.consequence}`)
  return unique(goals.filter(Boolean))
}

function operatorQuestionFor(group: CorpusReadinessGroup): string {
  const finding = group.findings[0]
  if (!finding) return "Is this scene ready to draft as planned?"
  if (finding.dimension === "worldFactPressure") {
    return "Should this world fact actively constrain choice/outcome here, or is background presence acceptable?"
  }
  if (finding.dimension === "relationshipDelta") {
    return "Should this interaction change relationship state here, or is static contact acceptable?"
  }
  if (finding.dimension === "motivationSpecificity") {
    return "Should the scene contract sharpen the POV character's specific want, fear, or tradeoff before drafting?"
  }
  if (finding.dimension === "sceneDramaturgy") {
    return "Should the scene contract strengthen goal, opposition, turn, outcome, or consequence before drafting?"
  }
  return "Is this diagnostic a real planning issue, false positive, acceptable choice, or deferred concern?"
}

function rationaleFor(dimension: string, label: string): string {
  return `Corpus recreation semantic review labeled ${dimension} as ${label}.`
}

function fixIntentFor(dimension: string): string {
  const map: Record<string, string> = {
    worldFactPressure: "make_world_fact_operational",
    relationshipDelta: "make_relationship_state_change_concrete",
    motivationSpecificity: "sharpen_pov_motivation_tradeoff",
    sceneDramaturgy: "strengthen_scene_contract",
  }
  return map[dimension] ?? "review_scene_contract"
}

function severityFor(label: string): Severity {
  if (label.endsWith("-0")) return "high"
  if (label.endsWith("-1")) return "medium"
  if (label.endsWith("-2")) return "low"
  return "info"
}

function severityRank(severity: Severity): number {
  return severity === "high" ? 4 : severity === "medium" ? 3 : severity === "low" ? 2 : 1
}

function fixtureIdFor(pocDir: string, semantic: any): string {
  const book = String(semantic.source?.book ?? "")
  const chapter = String(semantic.source?.chapterLabel ?? "")
  return [book, chapter].filter(Boolean).join(":") || basename(pocDir)
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"))
}

function normalizeEvidence(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim()) out[key] = value
  }
  return out
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const pocDirs: string[] = []
  let output: string | null = null
  let json: string | null = null
  let labels = DEFAULT_LABELS

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--poc-dir") {
      const value = argv[index + 1]
      if (!value) throw new Error("--poc-dir requires a path")
      pocDirs.push(value)
      index += 1
    } else if (arg === "--labels") {
      const value = argv[index + 1]
      if (!value) throw new Error("--labels requires comma-separated labels")
      labels = value.split(",").map(label => label.trim()).filter(Boolean)
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
      pocDirs.push(arg)
    }
  }

  if (pocDirs.length === 0) throw new Error("at least one --poc-dir or positional POC directory is required")
  return { pocDirs, labels, output, json }
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/evals/corpus-recreation-readiness.ts --poc-dir <dir> [--poc-dir <dir> ...]
  bun scripts/evals/corpus-recreation-readiness.ts <dir> --labels WFACT-1,REL-1 --output output/readiness.md
`)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function compareChapterLabels(a: string, b: string): number {
  const aNumber = Number(a.replace(/\D+/g, ""))
  const bNumber = Number(b.replace(/\D+/g, ""))
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber
  return a.localeCompare(b)
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const report = buildCorpusRecreationReadinessAggregate(args.pocDirs, args.labels)
    const rendered = renderCorpusRecreationReadinessAggregate(report)
    if (args.output) writeOutput(args.output, rendered)
    if (args.json) writeOutput(args.json, `${JSON.stringify(report, null, 2)}\n`)
    writeManifestIfArtifactProduced(args, report)
    console.log(rendered)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

function writeManifestIfArtifactProduced(args: Args, report: CorpusReadinessAggregate): void {
  const primaryOutput = args.json ?? args.output
  if (!primaryOutput) return
  const parentManifests = args.pocDirs
    .map(dir => parentManifestForPocDir(dir))
    .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
  writeRunManifest(manifestPathForSidecar(primaryOutput), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-readiness",
    variantId: "readiness",
    parentRunId: parentManifests.length === 1 ? parentManifests[0]!.runId : null,
    rootRunId: parentManifests.length === 1 ? parentManifests[0]!.rootRunId : null,
    command: {
      name: "diagnostics:corpus-recreation-readiness",
      argv: process.argv.slice(2),
    },
    inputs: readinessInputRefs(args.pocDirs),
    outputs: existingArtifactRefs([
      ...(args.output ? [{ path: args.output, role: "readiness-markdown" }] : []),
      ...(args.json ? [{ path: args.json, role: "readiness-json" }] : []),
    ]),
    relatedRunIds: parentManifests.map(manifest => manifest.runId),
    discriminator: `groups-${report.groupCount}`,
    metadata: {
      pocDirs: args.pocDirs,
      labels: args.labels,
      groupCount: report.groupCount,
      findingCount: report.findingCount,
    },
  }))
}

function readinessInputRefs(pocDirs: string[]) {
  return pocDirs.flatMap(dir => {
    const resolved = resolve(dir)
    return existingArtifactRefs([
      { path: `${resolved}/run-manifest.json`, role: "parent-run-manifest" },
      { path: `${resolved}/plan.json`, role: "plan" },
      { path: `${resolved}/semantic-review-live/semantic-review.json`, role: "semantic-review-json" },
    ])
  })
}
