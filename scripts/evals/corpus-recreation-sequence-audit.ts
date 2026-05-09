#!/usr/bin/env bun
/**
 * Audit cross-chapter thread/promise/payoff shape for corpus recreation POCs.
 *
 * Diagnostic-only. Reads ignored local POC artifacts and reports sequence-level
 * ID reuse that per-chapter checks cannot see. It does not call an LLM, mutate
 * plans, create proposals, or promote runtime behavior.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
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

interface Packet {
  sourceReference?: {
    book?: string
    chapterLabel?: string
  }
}

interface Plan {
  chapterId?: string
  scenes?: Array<{ sceneId?: string }>
  obligations?: Array<{
    obligationId?: string
    sceneId?: string
    threadId?: string
    promiseId?: string
    payoffId?: string
    payoffEventId?: string
    storyDebtStage?: string
    sourceId?: string
    requirementText?: string
  }>
}

export interface SequenceMovement {
  pocDir: string
  chapterLabel: string
  chapterOrder: number
  sceneId: string
  sceneOrder: number
  obligationId: string
  threadId: string | null
  promiseId: string | null
  payoffId: string | null
  payoffEventId: string | null
  storyDebtStage: string | null
  sourceId: string | null
  movement: "thread" | "promise_progress" | "promise_payoff"
}

export interface SequenceFinding {
  code: "payoff_id_reused_without_event_id" | "payoff_event_id_reused_across_chapters" | "promise_continues_after_final_payoff"
  severity: "advisory"
  ref: string
  chapterLabels: string[]
  sceneIds: string[]
  message: string
}

export interface SequencePromiseSummary {
  promiseId: string
  threadIds: string[]
  progressSceneIds: string[]
  payoffSceneIds: string[]
  payoffIds: string[]
  payoffEventIds: string[]
  firstProgress: string | null
  firstFinalPayoff: string | null
  progressAfterFinalPayoff: string[]
}

export interface SequencePayoffSummary {
  payoffId: string
  payoffEventIds: string[]
  promiseIds: string[]
  threadIds: string[]
  chapterLabels: string[]
  sceneIds: string[]
}

export interface CorpusRecreationSequenceAudit {
  generatedAt: string
  pocDirCount: number
  movementCount: number
  findingCount: number
  movements: SequenceMovement[]
  findings: SequenceFinding[]
  promises: SequencePromiseSummary[]
  payoffs: SequencePayoffSummary[]
}

export function buildCorpusRecreationSequenceAudit(
  pocDirs: string[],
  generatedAt = new Date().toISOString(),
): CorpusRecreationSequenceAudit {
  if (pocDirs.length === 0) throw new Error("at least one --poc-dir or positional POC directory is required")
  const runs = pocDirs.map((pocDir, index) => readPocRun(pocDir, index))
  const movements = runs
    .flatMap(run => run.movements)
    .sort(compareMovements)
  const promises = summarizePromises(movements)
  const payoffs = summarizePayoffs(movements)
  const findings = [
    ...findPayoffEventIssues(payoffs),
    ...findPromiseProgressAfterFinalPayoff(promises),
  ].sort((a, b) => a.code.localeCompare(b.code) || a.ref.localeCompare(b.ref))

  return {
    generatedAt,
    pocDirCount: pocDirs.length,
    movementCount: movements.length,
    findingCount: findings.length,
    movements,
    findings,
    promises,
    payoffs,
  }
}

export function renderCorpusRecreationSequenceAudit(report: CorpusRecreationSequenceAudit): string {
  const lines: string[] = []
  lines.push("# Corpus Recreation Sequence Audit")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`POC dirs: ${report.pocDirCount}`)
  lines.push(`Movements: ${report.movementCount}`)
  lines.push(`Findings: ${report.findingCount}`)
  lines.push("")
  lines.push("## Findings")
  lines.push("")
  if (report.findings.length === 0) {
    lines.push("- none")
  } else {
    lines.push("| Code | Ref | Chapters | Scenes | Message |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const finding of report.findings) {
      lines.push([
        `| ${cell(finding.code)}`,
        cell(finding.ref),
        cell(finding.chapterLabels.join(", ")),
        cell(finding.sceneIds.join(", ")),
        `${cell(finding.message)} |`,
      ].join(" | "))
    }
  }

  lines.push("")
  lines.push("## Promises")
  lines.push("")
  lines.push("| Promise | Threads | Progress Scenes | Payoff Scenes | Payoffs | Payoff Events | Progress After Final Payoff |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- |")
  for (const promise of report.promises) {
    lines.push([
      `| ${cell(promise.promiseId)}`,
      cell(promise.threadIds.join(", ") || "none"),
      cell(promise.progressSceneIds.join(", ") || "none"),
      cell(promise.payoffSceneIds.join(", ") || "none"),
      cell(promise.payoffIds.join(", ") || "none"),
      cell(promise.payoffEventIds.join(", ") || "none"),
      `${cell(promise.progressAfterFinalPayoff.join(", ") || "none")} |`,
    ].join(" | "))
  }

  lines.push("")
  lines.push("## Payoffs")
  lines.push("")
  lines.push("| Payoff | Payoff Events | Promises | Threads | Chapters | Scenes |")
  lines.push("| --- | --- | --- | --- | --- | --- |")
  for (const payoff of report.payoffs) {
    lines.push([
      `| ${cell(payoff.payoffId)}`,
      cell(payoff.payoffEventIds.join(", ") || "none"),
      cell(payoff.promiseIds.join(", ") || "none"),
      cell(payoff.threadIds.join(", ") || "none"),
      cell(payoff.chapterLabels.join(", ") || "none"),
      `${cell(payoff.sceneIds.join(", ") || "none")} |`,
    ].join(" | "))
  }

  lines.push("")
  lines.push("## Interpretation Boundary")
  lines.push("")
  lines.push("- This audit is advisory sequence evidence, not a blocker.")
  lines.push("- Parent payoffId values may repeat when distinct local payoffEventId values distinguish the concrete payoff events.")
  lines.push("- Progress after final_payoff often means the planner is reusing a local chapter contract as if it were a sequence contract.")
  return `${lines.join("\n")}\n`
}

function readPocRun(pocDir: string, inputOrder: number): { movements: SequenceMovement[] } {
  const resolved = resolve(process.cwd(), pocDir)
  const packet = readJson<Packet>(join(resolved, "packet.json"))
  const plan = readJson<Plan>(join(resolved, "plan.json"))
  const chapterLabel = String(packet.sourceReference?.chapterLabel ?? plan.chapterId ?? inputOrder + 1)
  const chapterOrder = chapterSortOrder(chapterLabel, inputOrder)
  const sceneOrder = new Map<string, number>()
  for (const [index, scene] of (plan.scenes ?? []).entries()) {
    if (scene.sceneId) sceneOrder.set(scene.sceneId, index)
  }

  const movements: SequenceMovement[] = []
  for (const [index, obligation] of (plan.obligations ?? []).entries()) {
    const sceneId = textOrNull(obligation.sceneId) ?? `unknown-scene-${index + 1}`
    const promiseId = textOrNull(obligation.promiseId)
    const payoffId = textOrNull(obligation.payoffId)
    const payoffEventId = textOrNull(obligation.payoffEventId)
    const storyDebtStage = textOrNull(obligation.storyDebtStage)
    const threadId = textOrNull(obligation.threadId)
    if (!threadId && !promiseId && !payoffId) continue
    movements.push({
      pocDir: resolved,
      chapterLabel,
      chapterOrder,
      sceneId,
      sceneOrder: sceneOrder.get(sceneId) ?? index,
      obligationId: textOrNull(obligation.obligationId) ?? `obligation-${index + 1}`,
      threadId,
      promiseId,
      payoffId,
      payoffEventId,
      storyDebtStage,
      sourceId: textOrNull(obligation.sourceId),
      movement: payoffId || isPayoffStage(storyDebtStage) ? "promise_payoff" : promiseId ? "promise_progress" : "thread",
    })
  }
  return { movements }
}

function summarizePromises(movements: SequenceMovement[]): SequencePromiseSummary[] {
  const groups = groupBy(movements.filter(row => row.promiseId), row => row.promiseId!)
  return [...groups.entries()].map(([promiseId, rows]) => {
    const orderedRows = [...rows].sort(compareMovements)
    const payoffRows = orderedRows.filter(row => row.payoffId)
    const finalPayoffRows = payoffRows.filter(isFinalPayoff)
    const firstFinalPayoff = finalPayoffRows[0] ?? null
    const progressAfterFinalPayoff = firstFinalPayoff
      ? orderedRows
        .filter(row => !row.payoffId && compareMovements(row, firstFinalPayoff) > 0)
        .map(formatSceneRef)
      : []
    return {
      promiseId,
      threadIds: unique(orderedRows.map(row => row.threadId).filter(isString)),
      progressSceneIds: unique(orderedRows.filter(row => !row.payoffId).map(formatSceneRef)),
      payoffSceneIds: unique(payoffRows.map(formatSceneRef)),
      payoffIds: unique(payoffRows.map(row => row.payoffId).filter(isString)),
      payoffEventIds: unique(payoffRows.map(row => row.payoffEventId).filter(isString)),
      firstProgress: orderedRows.find(row => !row.payoffId) ? formatSceneRef(orderedRows.find(row => !row.payoffId)!) : null,
      firstFinalPayoff: firstFinalPayoff ? formatSceneRef(firstFinalPayoff) : null,
      progressAfterFinalPayoff,
    }
  }).sort((a, b) => a.promiseId.localeCompare(b.promiseId))
}

function summarizePayoffs(movements: SequenceMovement[]): SequencePayoffSummary[] {
  const groups = groupBy(movements.filter(row => row.payoffId), row => row.payoffId!)
  return [...groups.entries()].map(([payoffId, rows]) => ({
    payoffId,
    payoffEventIds: unique(rows.map(row => row.payoffEventId).filter(isString)),
    promiseIds: unique(rows.map(row => row.promiseId).filter(isString)),
    threadIds: unique(rows.map(row => row.threadId).filter(isString)),
    chapterLabels: unique(rows.map(row => row.chapterLabel)),
    sceneIds: unique(rows.map(formatSceneRef)),
  })).sort((a, b) => a.payoffId.localeCompare(b.payoffId))
}

function findPayoffEventIssues(payoffs: SequencePayoffSummary[]): SequenceFinding[] {
  const findings: SequenceFinding[] = []
  for (const payoff of payoffs) {
    if (payoff.chapterLabels.length <= 1) continue
    if (payoff.payoffEventIds.length === 0) {
      findings.push({
        code: "payoff_id_reused_without_event_id",
        severity: "advisory",
        ref: payoff.payoffId,
        chapterLabels: payoff.chapterLabels,
        sceneIds: payoff.sceneIds,
        message: `parent payoffId ${payoff.payoffId} appears in multiple chapters without child payoffEventId refs.`,
      })
    } else if (payoff.payoffEventIds.length < payoff.sceneIds.length) {
      findings.push({
        code: "payoff_event_id_reused_across_chapters",
        severity: "advisory",
        ref: payoff.payoffId,
        chapterLabels: payoff.chapterLabels,
        sceneIds: payoff.sceneIds,
        message: `payoffId ${payoff.payoffId} has fewer child payoffEventIds than payoff scenes; each concrete payoff event should have a unique child id.`,
      })
    }
  }
  return findings
}

function findPromiseProgressAfterFinalPayoff(promises: SequencePromiseSummary[]): SequenceFinding[] {
  return promises
    .filter(promise => promise.progressAfterFinalPayoff.length > 0)
    .map(promise => ({
      code: "promise_continues_after_final_payoff" as const,
      severity: "advisory" as const,
      ref: promise.promiseId,
      chapterLabels: unique(promise.progressAfterFinalPayoff.map(ref => ref.split("/")[0] ?? ref)),
      sceneIds: promise.progressAfterFinalPayoff,
      message: `promiseId ${promise.promiseId} has progress after final payoff ${promise.firstFinalPayoff}; use a child promise/payoff chain or mark later rows as aftermath/escalation.`,
    }))
}

function isPayoffStage(stage: string | null): boolean {
  return stage === "partial_payoff" || stage === "final_payoff"
}

function isFinalPayoff(row: SequenceMovement): boolean {
  return row.storyDebtStage ? row.storyDebtStage === "final_payoff" : Boolean(row.payoffId)
}

function compareMovements(a: SequenceMovement, b: SequenceMovement): number {
  return a.chapterOrder - b.chapterOrder
    || compareChapterLabels(a.chapterLabel, b.chapterLabel)
    || a.sceneOrder - b.sceneOrder
    || a.sceneId.localeCompare(b.sceneId)
    || a.obligationId.localeCompare(b.obligationId)
}

function compareChapterLabels(a: string, b: string): number {
  const aNum = numericChapter(a)
  const bNum = numericChapter(b)
  if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum
  return a.localeCompare(b, undefined, { numeric: true })
}

function chapterSortOrder(label: string, inputOrder: number): number {
  return numericChapter(label) ?? inputOrder + 100000
}

function numericChapter(label: string): number | null {
  const match = label.match(/\d+/u)
  if (!match) return null
  const value = Number.parseInt(match[0]!, 10)
  return Number.isFinite(value) ? value : null
}

function formatSceneRef(row: SequenceMovement): string {
  return `${row.chapterLabel}/${row.sceneId}`
}

function groupBy<T>(rows: T[], keyFor: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyFor(row)
    out.set(key, [...(out.get(key) ?? []), row])
  }
  return out
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function isString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`missing required artifact: ${path}`)
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const pocDirs: string[] = []
  let output: string | null = null
  let json: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
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
  bun scripts/evals/corpus-recreation-sequence-audit.ts --poc-dir <dir> [--poc-dir <dir> ...]
  bun scripts/evals/corpus-recreation-sequence-audit.ts <dir> <dir> --output output/sequence-audit.md --json output/sequence-audit.json
`)
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeManifestIfArtifactProduced(args: Args, report: CorpusRecreationSequenceAudit): void {
  const primaryOutput = args.json ?? args.output
  if (!primaryOutput) return
  const generatedAt = report.generatedAt
  const parentManifests = args.pocDirs
    .map(dir => parentManifestForPocDir(dir))
    .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
  writeRunManifest(manifestPathForSidecar(primaryOutput), buildRunManifest({
    generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-sequence-audit",
    variantId: "sequence-audit",
    parentRunId: parentManifests.length === 1 ? parentManifests[0]!.runId : null,
    rootRunId: parentManifests.length === 1 ? parentManifests[0]!.rootRunId : null,
    command: {
      name: "diagnostics:corpus-recreation-sequence-audit",
      argv: process.argv.slice(2),
    },
    model: null,
    inputs: existingArtifactRefs([
      ...args.pocDirs.flatMap(dir => [
        { path: join(dir, "run-manifest.json"), role: "parent-run-manifest" },
        { path: join(dir, "packet.json"), role: "packet" },
        { path: join(dir, "plan.json"), role: "plan" },
      ]),
    ]),
    outputs: existingArtifactRefs([
      ...(args.output ? [{ path: args.output, role: "sequence-audit-markdown" }] : []),
      ...(args.json ? [{ path: args.json, role: "sequence-audit-json" }] : []),
    ]),
    relatedRunIds: parentManifests.map(manifest => manifest.runId),
    discriminator: `dirs-${args.pocDirs.length}`,
    metadata: {
      pocDirs: args.pocDirs,
      movementCount: report.movementCount,
      findingCount: report.findingCount,
    },
  }))
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const report = buildCorpusRecreationSequenceAudit(args.pocDirs)
    const rendered = renderCorpusRecreationSequenceAudit(report)
    if (args.output) writeOutput(args.output, rendered)
    if (args.json) writeOutput(args.json, `${JSON.stringify(report, null, 2)}\n`)
    writeManifestIfArtifactProduced(args, report)
    console.log(rendered)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
