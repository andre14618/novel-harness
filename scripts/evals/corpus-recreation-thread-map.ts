#!/usr/bin/env bun
/**
 * Build a deterministic thread/payoff map from corpus recreation POC artifacts.
 *
 * Diagnostic-only. Reads local POC output dirs, writes JSON/Markdown, and does
 * not call an LLM, mutate plans, create proposals, or change writer context.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import {
  buildRunManifest,
  existingArtifactRefs,
  manifestPathForSidecar,
  parentManifestForPocDir,
  writeRunManifest,
} from "./run-manifest"

interface Args {
  pocDirs: string[]
  output: string | null
  json: string | null
}

interface SeedThread {
  threadId: string
  kind?: string
  label?: string
  description?: string
}

interface SeedDebt {
  storyDebtId: string
  threadId?: string
  promiseText?: string
}

interface SeedPayoff {
  payoffId: string
  threadId?: string
  storyDebtId?: string
  payoffText?: string
}

interface POCPlan {
  chapterId?: string
  scenes?: Array<{ sceneId?: string; consequence?: string }>
  obligations?: Array<{
    obligationId?: string
    sceneId?: string
    sourceId?: string
    threadId?: string
    promiseId?: string
    payoffId?: string
    requirementText?: string
    materialityTest?: string
  }>
}

interface POCArtifact {
  pocDir: string
  chapterId: string
  chapterLabel: string
  plannerVariant: string
  threads: SeedThread[]
  promises: SeedDebt[]
  payoffs: SeedPayoff[]
  plan: POCPlan
}

export interface ThreadMovementRow {
  pocDir: string
  chapterId: string
  chapterLabel: string
  plannerVariant: string
  sceneId: string
  obligationId: string
  sourceId: string
  threadId: string | null
  promiseId: string | null
  payoffId: string | null
  movement: "thread_pressure" | "promise_progress" | "payoff" | "unrouted_story_debt" | "unrouted"
  requirementText: string
  materialityTest: string
  issues: string[]
}

export interface ThreadSummary {
  threadId: string
  label: string
  kind: string
  obligationCount: number
  sceneIds: string[]
  promiseIds: string[]
  payoffIds: string[]
}

export interface PromiseSummary {
  promiseId: string
  threadId: string | null
  progressSceneIds: string[]
  payoffSceneIds: string[]
  payoffIds: string[]
  issueCount: number
}

export interface ThreadImpactRow {
  refKind: "thread" | "promise" | "payoff"
  ref: string
  affectedSceneIds: string[]
  affectedObligationIds: string[]
}

export interface SceneThreadSummary {
  sceneId: string
  chapterId: string
  consequence: string
  movementCount: number
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  issueCount: number
}

export interface CorpusThreadMapReport {
  generatedAt: string
  pocDirs: string[]
  rowCount: number
  issueCount: number
  scenes: SceneThreadSummary[]
  threads: ThreadSummary[]
  promises: PromiseSummary[]
  impacts: ThreadImpactRow[]
  rows: ThreadMovementRow[]
  issues: Array<{
    code: string
    ref: string
    detail: string
  }>
}

export function buildCorpusRecreationThreadMap(
  pocDirs: string[],
  generatedAt = new Date().toISOString(),
): CorpusThreadMapReport {
  if (pocDirs.length === 0) throw new Error("at least one --poc-dir or positional POC directory is required")
  const artifacts = pocDirs.map(readPocArtifact)
  const rows = artifacts.flatMap(buildMovementRows)
  const issues = [
    ...rows.flatMap(row => row.issues.map(issue => ({ code: issueCode(issue), ref: row.obligationId, detail: issue }))),
    ...promiseCoverageIssues(artifacts, rows),
    ...threadCoverageIssues(artifacts, rows),
  ]
  return {
    generatedAt,
    pocDirs: artifacts.map(artifact => artifact.pocDir),
    rowCount: rows.length,
    issueCount: issues.length,
    scenes: summarizeScenes(artifacts, rows, issues),
    threads: summarizeThreads(artifacts, rows),
    promises: summarizePromises(artifacts, rows),
    impacts: buildImpacts(rows),
    rows,
    issues,
  }
}

export function renderCorpusRecreationThreadMap(report: CorpusThreadMapReport): string {
  const lines: string[] = []
  lines.push("# Corpus Recreation Thread Map")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`POC dirs: ${report.pocDirs.length}`)
  lines.push(`Movement rows: ${report.rowCount}`)
  lines.push(`Issues: ${report.issueCount}`)
  lines.push("")
  lines.push("## Scenes")
  lines.push("")
  lines.push("| Scene | Movements | Threads | Promises | Payoffs | Issues | Consequence |")
  lines.push("| --- | ---: | --- | --- | --- | ---: | --- |")
  for (const scene of report.scenes) {
    lines.push(`| ${cell(scene.sceneId)} | ${scene.movementCount} | ${cell(scene.threadIds.join(", ") || "none")} | ${cell(scene.promiseIds.join(", ") || "none")} | ${cell(scene.payoffIds.join(", ") || "none")} | ${scene.issueCount} | ${cell(scene.consequence || "none")} |`)
  }
  lines.push("")
  lines.push("## Threads")
  lines.push("")
  lines.push("| Thread | Kind | Obligations | Scenes | Promises | Payoffs |")
  lines.push("| --- | --- | ---: | --- | --- | --- |")
  for (const thread of report.threads) {
    lines.push(`| ${cell(thread.threadId)} | ${cell(thread.kind)} | ${thread.obligationCount} | ${cell(thread.sceneIds.join(", ") || "none")} | ${cell(thread.promiseIds.join(", ") || "none")} | ${cell(thread.payoffIds.join(", ") || "none")} |`)
  }
  lines.push("")
  lines.push("## Promises")
  lines.push("")
  lines.push("| Promise | Thread | Progress Scenes | Payoff Scenes | Payoffs | Issues |")
  lines.push("| --- | --- | --- | --- | --- | ---: |")
  for (const promise of report.promises) {
    lines.push(`| ${cell(promise.promiseId)} | ${cell(promise.threadId ?? "unknown")} | ${cell(promise.progressSceneIds.join(", ") || "none")} | ${cell(promise.payoffSceneIds.join(", ") || "none")} | ${cell(promise.payoffIds.join(", ") || "none")} | ${promise.issueCount} |`)
  }
  lines.push("")
  lines.push("## Impact Preview")
  lines.push("")
  lines.push("| Ref | Type | Scenes | Obligations |")
  lines.push("| --- | --- | --- | --- |")
  for (const impact of report.impacts) {
    lines.push(`| ${cell(impact.ref)} | ${impact.refKind} | ${cell(impact.affectedSceneIds.join(", ") || "none")} | ${cell(impact.affectedObligationIds.join(", ") || "none")} |`)
  }
  lines.push("")
  lines.push("## Issues")
  lines.push("")
  if (report.issues.length === 0) {
    lines.push("- none")
  } else {
    for (const issue of report.issues) {
      lines.push(`- ${issue.code} ${issue.ref}: ${issue.detail}`)
    }
  }
  return `${lines.join("\n")}\n`
}

function readPocArtifact(pocDir: string): POCArtifact {
  const resolved = resolve(pocDir)
  const packet = readJson(`${resolved}/packet.json`)
  const plan = readJson(`${resolved}/plan.json`) as POCPlan
  const seed = packet.originalAnalogSeed ?? {}
  return {
    pocDir: resolved,
    chapterId: String(plan.chapterId ?? ""),
    chapterLabel: String(packet.sourceReference?.chapterLabel ?? ""),
    plannerVariant: String(packet.diagnosticConfig?.plannerVariant ?? "baseline"),
    threads: Array.isArray(seed.storyThreads) ? seed.storyThreads : [],
    promises: Array.isArray(seed.storyDebts) ? seed.storyDebts : [],
    payoffs: Array.isArray(seed.storyPayoffs) ? seed.storyPayoffs : [],
    plan,
  }
}

function buildMovementRows(artifact: POCArtifact): ThreadMovementRow[] {
  const knownThreads = new Set(artifact.threads.map(thread => thread.threadId))
  const promiseById = new Map(artifact.promises.map(promise => [promise.storyDebtId, promise]))
  const payoffById = new Map(artifact.payoffs.map(payoff => [payoff.payoffId, payoff]))
  return (artifact.plan.obligations ?? []).map(obligation => {
    const threadId = textOrNull(obligation.threadId)
    const promiseId = textOrNull(obligation.promiseId)
    const payoffId = textOrNull(obligation.payoffId)
    const sourceId = String(obligation.sourceId ?? "")
    const sourceDebt = promiseById.get(sourceId)
    const issues: string[] = []
    if (!threadId) issues.push("missing threadId")
    else if (!knownThreads.has(threadId)) issues.push(`unknown threadId ${threadId}`)
    const promise = promiseId ? promiseById.get(promiseId) : null
    if (promiseId && !promise) issues.push(`unknown promiseId ${promiseId}`)
    if (!promiseId && sourceDebt) issues.push(`sourceId ${sourceId} is a story debt but promiseId is missing`)
    if (promise && promise.threadId && threadId && promise.threadId !== threadId) {
      issues.push(`promiseId ${promiseId} belongs to thread ${promise.threadId}, not ${threadId}`)
    }
    if (payoffId) {
      const payoff = payoffById.get(payoffId)
      if (!payoff) issues.push(`unknown payoffId ${payoffId}`)
      if (!promiseId) issues.push(`payoffId ${payoffId} has no promiseId`)
      if (payoff && promiseId && payoff.storyDebtId !== promiseId) {
        issues.push(`payoffId ${payoffId} belongs to ${payoff.storyDebtId}, not ${promiseId}`)
      }
      if (payoff && payoff.threadId && threadId && payoff.threadId !== threadId) {
        issues.push(`payoffId ${payoffId} belongs to thread ${payoff.threadId}, not ${threadId}`)
      }
    }
    return {
      pocDir: artifact.pocDir,
      chapterId: artifact.chapterId,
      chapterLabel: artifact.chapterLabel,
      plannerVariant: artifact.plannerVariant,
      sceneId: String(obligation.sceneId ?? ""),
      obligationId: String(obligation.obligationId ?? ""),
      sourceId,
      threadId,
      promiseId,
      payoffId,
      movement: movementFor({ threadId, promiseId, payoffId, sourceDebtId: sourceDebt?.storyDebtId ?? null }),
      requirementText: String(obligation.requirementText ?? ""),
      materialityTest: String(obligation.materialityTest ?? ""),
      issues,
    }
  })
}

function movementFor(input: {
  threadId: string | null
  promiseId: string | null
  payoffId: string | null
  sourceDebtId: string | null
}): ThreadMovementRow["movement"] {
  if (input.payoffId) return "payoff"
  if (input.promiseId) return "promise_progress"
  if (input.sourceDebtId) return "unrouted_story_debt"
  if (input.threadId) return "thread_pressure"
  return "unrouted"
}

function summarizeScenes(
  artifacts: POCArtifact[],
  rows: ThreadMovementRow[],
  issues: CorpusThreadMapReport["issues"],
): SceneThreadSummary[] {
  const sceneIssueCounts = new Map<string, number>()
  for (const row of rows) {
    if (row.issues.length === 0) continue
    const key = `${row.pocDir}:${row.sceneId}`
    sceneIssueCounts.set(key, (sceneIssueCounts.get(key) ?? 0) + row.issues.length)
  }
  for (const issue of issues) {
    if (!issue.ref.startsWith("scene:")) continue
    const [, pocDir, sceneId] = issue.ref.split(":", 3)
    const key = `${pocDir}:${sceneId}`
    sceneIssueCounts.set(key, (sceneIssueCounts.get(key) ?? 0) + 1)
  }
  return artifacts.flatMap(artifact => (artifact.plan.scenes ?? []).map(scene => {
    const sceneId = String(scene.sceneId ?? "")
    const related = rows.filter(row => row.pocDir === artifact.pocDir && row.sceneId === sceneId)
    return {
      sceneId,
      chapterId: artifact.chapterId,
      consequence: String(scene.consequence ?? ""),
      movementCount: related.filter(row => row.movement !== "unrouted").length,
      threadIds: unique(related.map(row => row.threadId).filter(Boolean) as string[]),
      promiseIds: unique(related.map(row => row.promiseId).filter(Boolean) as string[]),
      payoffIds: unique(related.map(row => row.payoffId).filter(Boolean) as string[]),
      issueCount: sceneIssueCounts.get(`${artifact.pocDir}:${sceneId}`) ?? 0,
    }
  })).sort((a, b) => a.chapterId.localeCompare(b.chapterId) || a.sceneId.localeCompare(b.sceneId))
}

function summarizeThreads(artifacts: POCArtifact[], rows: ThreadMovementRow[]): ThreadSummary[] {
  const threadDefs = new Map<string, SeedThread>()
  for (const artifact of artifacts) for (const thread of artifact.threads) threadDefs.set(thread.threadId, thread)
  const ids = new Set([...threadDefs.keys(), ...rows.map(row => row.threadId).filter(Boolean) as string[]])
  return [...ids].sort().map(threadId => {
    const related = rows.filter(row => row.threadId === threadId)
    const def = threadDefs.get(threadId)
    return {
      threadId,
      label: def?.label ?? threadId,
      kind: def?.kind ?? "unknown",
      obligationCount: related.length,
      sceneIds: unique(related.map(row => row.sceneId).filter(Boolean)),
      promiseIds: unique(related.map(row => row.promiseId).filter(Boolean) as string[]),
      payoffIds: unique(related.map(row => row.payoffId).filter(Boolean) as string[]),
    }
  })
}

function summarizePromises(artifacts: POCArtifact[], rows: ThreadMovementRow[]): PromiseSummary[] {
  const promiseDefs = new Map<string, SeedDebt>()
  for (const artifact of artifacts) for (const promise of artifact.promises) promiseDefs.set(promise.storyDebtId, promise)
  const ids = new Set([...promiseDefs.keys(), ...rows.map(row => row.promiseId).filter(Boolean) as string[]])
  const issueCounts = countIssuesByRef(rows)
  return [...ids].sort().map(promiseId => {
    const related = rows.filter(row => row.promiseId === promiseId)
    const progress = related.filter(row => row.movement === "promise_progress")
    const payoff = related.filter(row => row.movement === "payoff")
    return {
      promiseId,
      threadId: promiseDefs.get(promiseId)?.threadId ?? related.find(row => row.threadId)?.threadId ?? null,
      progressSceneIds: unique(progress.map(row => row.sceneId).filter(Boolean)),
      payoffSceneIds: unique(payoff.map(row => row.sceneId).filter(Boolean)),
      payoffIds: unique(payoff.map(row => row.payoffId).filter(Boolean) as string[]),
      issueCount: issueCounts.get(promiseId) ?? 0,
    }
  })
}

function buildImpacts(rows: ThreadMovementRow[]): ThreadImpactRow[] {
  const byRef = new Map<string, ThreadImpactRow>()
  for (const row of rows) {
    addImpact(byRef, "thread", row.threadId, row)
    addImpact(byRef, "promise", row.promiseId, row)
    addImpact(byRef, "payoff", row.payoffId, row)
  }
  return [...byRef.values()].sort((a, b) => a.refKind.localeCompare(b.refKind) || a.ref.localeCompare(b.ref))
}

function addImpact(byRef: Map<string, ThreadImpactRow>, refKind: ThreadImpactRow["refKind"], ref: string | null, row: ThreadMovementRow): void {
  if (!ref) return
  const key = `${refKind}:${ref}`
  const current = byRef.get(key) ?? {
    refKind,
    ref,
    affectedSceneIds: [],
    affectedObligationIds: [],
  }
  current.affectedSceneIds = unique([...current.affectedSceneIds, row.sceneId].filter(Boolean))
  current.affectedObligationIds = unique([...current.affectedObligationIds, row.obligationId].filter(Boolean))
  byRef.set(key, current)
}

function promiseCoverageIssues(artifacts: POCArtifact[], rows: ThreadMovementRow[]): CorpusThreadMapReport["issues"] {
  const issues: CorpusThreadMapReport["issues"] = []
  for (const artifact of artifacts) {
    for (const promise of artifact.promises) {
      const movementRows = rows.filter(row => row.pocDir === artifact.pocDir && row.promiseId === promise.storyDebtId)
      if (movementRows.length === 0) {
        issues.push({
          code: "promise_without_movement",
          ref: promise.storyDebtId,
          detail: `no obligation references promiseId ${promise.storyDebtId}`,
        })
      }
      const payoffRows = movementRows.filter(row => row.payoffId)
      if (payoffRows.length === 0) {
        issues.push({
          code: "promise_without_payoff",
          ref: promise.storyDebtId,
          detail: `no obligation pays off promiseId ${promise.storyDebtId}`,
        })
      }
    }
    for (const payoff of artifact.payoffs) {
      if (!rows.some(row => row.pocDir === artifact.pocDir && row.payoffId === payoff.payoffId)) {
        issues.push({
          code: "payoff_without_scene",
          ref: payoff.payoffId,
          detail: `no obligation references payoffId ${payoff.payoffId}`,
        })
      }
    }
  }
  return issues
}

function threadCoverageIssues(artifacts: POCArtifact[], rows: ThreadMovementRow[]): CorpusThreadMapReport["issues"] {
  const issues: CorpusThreadMapReport["issues"] = []
  for (const artifact of artifacts) {
    for (const thread of artifact.threads) {
      if (!rows.some(row => row.pocDir === artifact.pocDir && row.threadId === thread.threadId)) {
        issues.push({
          code: "thread_without_obligation",
          ref: thread.threadId,
          detail: `no obligation references threadId ${thread.threadId}`,
        })
      }
    }
    for (const scene of artifact.plan.scenes ?? []) {
      const sceneId = String(scene.sceneId ?? "")
      const related = rows.filter(row => row.pocDir === artifact.pocDir && row.sceneId === sceneId)
      if (related.length > 0 && !related.some(row => row.threadId)) {
        issues.push({
          code: "scene_without_thread_movement",
          ref: `scene:${artifact.pocDir}:${sceneId}`,
          detail: `scene ${sceneId} has obligations but no thread-linked movement`,
        })
      }
    }
  }
  return issues
}

function countIssuesByRef(rows: ThreadMovementRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    if (!row.promiseId || row.issues.length === 0) continue
    out.set(row.promiseId, (out.get(row.promiseId) ?? 0) + row.issues.length)
  }
  return out
}

function issueCode(issue: string): string {
  if (issue.startsWith("missing threadId")) return "missing_thread_id"
  if (issue.startsWith("unknown threadId")) return "unknown_thread_id"
  if (issue.startsWith("unknown promiseId")) return "unknown_promise_id"
  if (issue.startsWith("unknown payoffId")) return "unknown_payoff_id"
  if (issue.includes("story debt but promiseId is missing")) return "story_debt_without_promise_ref"
  if (issue.includes("has no promiseId")) return "payoff_without_promise"
  if (issue.startsWith("promiseId") && issue.includes("belongs to thread")) return "promise_thread_mismatch"
  if (issue.startsWith("payoffId") && issue.includes("belongs to thread")) return "payoff_thread_mismatch"
  if (issue.includes("belongs to")) return "payoff_promise_mismatch"
  return "thread_ref_issue"
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const pocDirs: string[] = []
  let output: string | null = null
  let json: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--poc-dir") {
      const value = argv[index + 1]
      if (!value) throw new Error("--poc-dir requires a path")
      pocDirs.push(value)
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
  return { pocDirs, output, json }
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/evals/corpus-recreation-thread-map.ts --poc-dir <dir> [--poc-dir <dir> ...]
  bun scripts/evals/corpus-recreation-thread-map.ts <dir> --output output/thread-map.md --json output/thread-map.json
`)
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeManifestIfArtifactProduced(args: Args, report: CorpusThreadMapReport): void {
  const primaryOutput = args.json ?? args.output
  if (!primaryOutput) return
  const parentManifests = args.pocDirs
    .map(dir => parentManifestForPocDir(dir))
    .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
  writeRunManifest(manifestPathForSidecar(primaryOutput), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-thread-map",
    variantId: "thread-map",
    parentRunId: parentManifests.length === 1 ? parentManifests[0]!.runId : null,
    rootRunId: parentManifests.length === 1 ? parentManifests[0]!.rootRunId : null,
    command: {
      name: "diagnostics:corpus-recreation-thread-map",
      argv: process.argv.slice(2),
    },
    inputs: threadMapInputRefs(args.pocDirs),
    outputs: existingArtifactRefs([
      ...(args.output ? [{ path: args.output, role: "thread-map-markdown" }] : []),
      ...(args.json ? [{ path: args.json, role: "thread-map-json" }] : []),
    ]),
    relatedRunIds: parentManifests.map(manifest => manifest.runId),
    discriminator: `rows-${report.rowCount}`,
    metadata: {
      pocDirs: args.pocDirs,
      rowCount: report.rowCount,
      issueCount: report.issueCount,
    },
  }))
}

function threadMapInputRefs(pocDirs: string[]) {
  return pocDirs.flatMap(dir => {
    const resolved = resolve(dir)
    return existingArtifactRefs([
      { path: `${resolved}/run-manifest.json`, role: "parent-run-manifest" },
      { path: `${resolved}/packet.json`, role: "packet" },
      { path: `${resolved}/plan.json`, role: "plan" },
      { path: `${resolved}/plan-comparison.json`, role: "plan-comparison" },
    ])
  })
}

function readJson(path: string): any {
  if (!existsSync(path)) throw new Error(`missing required artifact: ${path}`)
  return JSON.parse(readFileSync(path, "utf8"))
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const report = buildCorpusRecreationThreadMap(args.pocDirs)
    const rendered = renderCorpusRecreationThreadMap(report)
    if (args.output) writeOutput(args.output, rendered)
    if (args.json) writeOutput(args.json, `${JSON.stringify(report, null, 2)}\n`)
    writeManifestIfArtifactProduced(args, report)
    console.log(rendered)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
