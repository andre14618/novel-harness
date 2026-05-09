#!/usr/bin/env bun
/**
 * Build deterministic per-scene thread context packets for corpus recreation.
 *
 * Diagnostic-only. This previews the compact thread ledger a future scene
 * writer experiment could receive. It does not call an LLM, mutate plans,
 * create proposals, or change writer context.
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
import {
  buildCorpusRecreationThreadMap,
  type CorpusThreadMapReport,
  type ThreadMovementRow,
} from "./corpus-recreation-thread-map"

interface Args {
  pocDir: string
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
  title?: string
  scenes?: Array<{
    sceneId?: string
    structuralRole?: string
    goal?: string
    opposition?: string
    turningPoint?: string
    outcome?: string
    consequence?: string
  }>
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

interface Packet {
  sourceReference?: {
    book?: string
    chapterLabel?: string
  }
  diagnosticConfig?: {
    plannerVariant?: string
  }
  originalAnalogSeed?: {
    storyThreads?: SeedThread[]
    storyDebts?: SeedDebt[]
    storyPayoffs?: SeedPayoff[]
  }
}

export interface ThreadContextLedgerLine {
  refKind: "thread" | "promise" | "payoff"
  ref: string
  text: string
}

export interface ThreadContextMovementRef {
  sceneId: string
  obligationId: string
  ref: string
  movement: ThreadMovementRow["movement"]
  summary: string
}

export interface SceneThreadContextPacket {
  sceneId: string
  sceneIndex: number
  sceneGoal: string
  sceneTurn: string
  sceneOutcome: string
  sceneConsequence: string
  activeThreadIds: string[]
  activePromiseIds: string[]
  activePayoffIds: string[]
  requiredObligationIds: string[]
  currentResponsibilities: string[]
  ledger: ThreadContextLedgerLine[]
  priorMovements: ThreadContextMovementRef[]
  futureImpactPreview: Array<{
    refKind: "thread" | "promise" | "payoff"
    ref: string
    affectedSceneIds: string[]
  }>
  structuralIssues: string[]
}

export interface CorpusThreadContextReport {
  generatedAt: string
  pocDir: string
  source: {
    book: string | null
    chapterLabel: string | null
  }
  plannerVariant: string
  sceneCount: number
  contextCount: number
  issueCount: number
  contexts: SceneThreadContextPacket[]
  threadMapIssues: CorpusThreadMapReport["issues"]
}

export function buildCorpusRecreationThreadContext(
  pocDir: string,
  generatedAt = new Date().toISOString(),
): CorpusThreadContextReport {
  const resolved = resolve(process.cwd(), pocDir)
  const packet = readJson<Packet>(join(resolved, "packet.json"))
  const plan = readJson<POCPlan>(join(resolved, "plan.json"))
  const threadMap = buildCorpusRecreationThreadMap([resolved], generatedAt)
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : []
  const contexts = scenes.map((scene, sceneIndex) => buildSceneContext({
    packet,
    plan,
    threadMap,
    sceneId: String(scene.sceneId ?? `scene-${sceneIndex + 1}`),
    sceneIndex,
    scene,
  }))

  return {
    generatedAt,
    pocDir: resolved,
    source: {
      book: packet.sourceReference?.book ?? null,
      chapterLabel: packet.sourceReference?.chapterLabel ?? null,
    },
    plannerVariant: packet.diagnosticConfig?.plannerVariant ?? "baseline",
    sceneCount: scenes.length,
    contextCount: contexts.length,
    issueCount: contexts.reduce((sum, context) => sum + context.structuralIssues.length, 0) + threadMap.issueCount,
    contexts,
    threadMapIssues: threadMap.issues,
  }
}

export function renderCorpusRecreationThreadContext(report: CorpusThreadContextReport): string {
  const lines: string[] = []
  lines.push("# Corpus Recreation Thread Context")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`POC: ${report.pocDir}`)
  lines.push(`Source: ${report.source.book ?? "unknown"} chapter ${report.source.chapterLabel ?? "unknown"}`)
  lines.push(`Variant: ${report.plannerVariant}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`- Scenes: ${report.sceneCount}`)
  lines.push(`- Context packets: ${report.contextCount}`)
  lines.push(`- Structural/thread-map issues: ${report.issueCount}`)
  lines.push("")
  lines.push("## Writer Context Boundary")
  lines.push("")
  lines.push("- This is a deterministic preview of compact per-scene thread context.")
  lines.push("- It is not injected into the writer and is not promotion evidence by itself.")
  lines.push("- Future impact preview names affected scene IDs only; it avoids feeding future prose or detailed future turns.")
  lines.push("")
  for (const context of report.contexts) {
    lines.push(`## Scene ${context.sceneIndex + 1}: ${context.sceneId}`)
    lines.push("")
    lines.push(`Goal: ${context.sceneGoal || "none"}`)
    lines.push(`Turn: ${context.sceneTurn || "none"}`)
    lines.push(`Outcome: ${context.sceneOutcome || "none"}`)
    lines.push(`Consequence: ${context.sceneConsequence || "none"}`)
    lines.push(`Threads: ${context.activeThreadIds.join(", ") || "none"}`)
    lines.push(`Promises: ${context.activePromiseIds.join(", ") || "none"}`)
    lines.push(`Payoffs: ${context.activePayoffIds.join(", ") || "none"}`)
    lines.push("")
    lines.push("Current responsibilities:")
    lines.push(...formatList(context.currentResponsibilities))
    lines.push("")
    lines.push("Ledger:")
    lines.push(...formatList(context.ledger.map(row => `${row.refKind}:${row.ref} ${row.text}`)))
    lines.push("")
    lines.push("Prior movements:")
    lines.push(...formatList(context.priorMovements.map(row => `${row.sceneId} ${row.movement} ${row.ref}: ${row.summary}`)))
    lines.push("")
    lines.push("Future impact preview:")
    lines.push(...formatList(context.futureImpactPreview.map(row => `${row.refKind}:${row.ref} -> ${row.affectedSceneIds.join(", ") || "none"}`)))
    if (context.structuralIssues.length > 0) {
      lines.push("")
      lines.push("Structural issues:")
      lines.push(...formatList(context.structuralIssues))
    }
    lines.push("")
  }
  if (report.threadMapIssues.length > 0) {
    lines.push("## Thread Map Issues")
    lines.push("")
    lines.push(...formatList(report.threadMapIssues.map(issue => `${issue.code} ${issue.ref}: ${issue.detail}`)))
  }
  return `${lines.join("\n")}\n`
}

function buildSceneContext(input: {
  packet: Packet
  plan: POCPlan
  threadMap: CorpusThreadMapReport
  sceneId: string
  sceneIndex: number
  scene: NonNullable<POCPlan["scenes"]>[number]
}): SceneThreadContextPacket {
  const obligations = (input.plan.obligations ?? []).filter(row => row.sceneId === input.sceneId)
  const rows = input.threadMap.rows.filter(row => row.sceneId === input.sceneId)
  const activeThreadIds = unique(obligations.map(row => row.threadId).filter(Boolean) as string[])
  const activePromiseIds = unique(obligations.map(row => row.promiseId).filter(Boolean) as string[])
  const activePayoffIds = unique(obligations.map(row => row.payoffId).filter(Boolean) as string[])
  const relevantRefs = new Set([...activeThreadIds, ...activePromiseIds, ...activePayoffIds])
  const priorRows = input.threadMap.rows.filter(row => {
    const rowSceneIndex = sceneIndexFor(input.plan, row.sceneId)
    return rowSceneIndex >= 0 && rowSceneIndex < input.sceneIndex && sharesRelevantRef(row, relevantRefs)
  })
  const futureRows = input.threadMap.rows.filter(row => {
    const rowSceneIndex = sceneIndexFor(input.plan, row.sceneId)
    return rowSceneIndex > input.sceneIndex && sharesRelevantRef(row, relevantRefs)
  })

  return {
    sceneId: input.sceneId,
    sceneIndex: input.sceneIndex,
    sceneGoal: String(input.scene.goal ?? ""),
    sceneTurn: String(input.scene.turningPoint ?? ""),
    sceneOutcome: String(input.scene.outcome ?? ""),
    sceneConsequence: String(input.scene.consequence ?? ""),
    activeThreadIds,
    activePromiseIds,
    activePayoffIds,
    requiredObligationIds: obligations.map(row => String(row.obligationId ?? "")).filter(Boolean),
    currentResponsibilities: obligations.map(formatResponsibility),
    ledger: buildLedger(input.packet, activeThreadIds, activePromiseIds, activePayoffIds),
    priorMovements: priorRows.map(row => movementRef(input.plan, row)),
    futureImpactPreview: buildFutureImpactPreview(futureRows),
    structuralIssues: rows.flatMap(row => row.issues.map(issue => `${row.obligationId}: ${issue}`)),
  }
}

function buildLedger(
  packet: Packet,
  threadIds: string[],
  promiseIds: string[],
  payoffIds: string[],
): ThreadContextLedgerLine[] {
  const seed = packet.originalAnalogSeed ?? {}
  return [
    ...(seed.storyThreads ?? [])
      .filter(row => threadIds.includes(row.threadId))
      .map(row => ({
        refKind: "thread" as const,
        ref: row.threadId,
        text: [row.label, row.kind, row.description].filter(Boolean).join("; "),
      })),
    ...(seed.storyDebts ?? [])
      .filter(row => promiseIds.includes(row.storyDebtId))
      .map(row => ({
        refKind: "promise" as const,
        ref: row.storyDebtId,
        text: row.promiseText ?? "",
      })),
    ...(seed.storyPayoffs ?? [])
      .filter(row => payoffIds.includes(row.payoffId))
      .map(row => ({
        refKind: "payoff" as const,
        ref: row.payoffId,
        text: row.payoffText ?? "",
      })),
  ]
}

function formatResponsibility(obligation: NonNullable<POCPlan["obligations"]>[number]): string {
  const refs = [
    obligation.threadId ? `thread=${obligation.threadId}` : "",
    obligation.promiseId ? `promise=${obligation.promiseId}` : "",
    obligation.payoffId ? `payoff=${obligation.payoffId}` : "",
    obligation.sourceId ? `source=${obligation.sourceId}` : "",
  ].filter(Boolean).join(" ")
  const materiality = obligation.materialityTest ? ` Materiality: ${obligation.materialityTest}` : ""
  return `${obligation.obligationId ?? "obligation"} ${refs}: ${obligation.requirementText ?? ""}${materiality}`.trim()
}

function movementRef(plan: POCPlan, row: ThreadMovementRow): ThreadContextMovementRef {
  const scene = (plan.scenes ?? []).find(item => item.sceneId === row.sceneId)
  return {
    sceneId: row.sceneId,
    obligationId: row.obligationId,
    ref: row.payoffId ?? row.promiseId ?? row.threadId ?? row.sourceId,
    movement: row.movement,
    summary: scene?.consequence ? String(scene.consequence) : row.requirementText,
  }
}

function buildFutureImpactPreview(rows: ThreadMovementRow[]): SceneThreadContextPacket["futureImpactPreview"] {
  const out = new Map<string, SceneThreadContextPacket["futureImpactPreview"][number]>()
  for (const row of rows) {
    for (const [refKind, ref] of [
      ["thread", row.threadId],
      ["promise", row.promiseId],
      ["payoff", row.payoffId],
    ] as Array<["thread" | "promise" | "payoff", string | null]>) {
      if (!ref) continue
      const key = `${refKind}:${ref}`
      const current = out.get(key) ?? { refKind, ref, affectedSceneIds: [] }
      current.affectedSceneIds = unique([...current.affectedSceneIds, row.sceneId])
      out.set(key, current)
    }
  }
  return [...out.values()].sort((a, b) => a.refKind.localeCompare(b.refKind) || a.ref.localeCompare(b.ref))
}

function sharesRelevantRef(row: ThreadMovementRow, refs: Set<string>): boolean {
  return Boolean(
    (row.threadId && refs.has(row.threadId))
    || (row.promiseId && refs.has(row.promiseId))
    || (row.payoffId && refs.has(row.payoffId)),
  )
}

function sceneIndexFor(plan: POCPlan, sceneId: string): number {
  return (plan.scenes ?? []).findIndex(scene => scene.sceneId === sceneId)
}

function parseArgs(argv = process.argv.slice(2)): Args {
  let pocDir: string | null = null
  let output: string | null = null
  let json: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--poc-dir") {
      const value = argv[index + 1]
      if (!value) throw new Error("--poc-dir requires a path")
      pocDir = value
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
      pocDir = arg
    }
  }
  if (!pocDir) throw new Error("--poc-dir or positional POC directory is required")
  return { pocDir, output, json }
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/evals/corpus-recreation-thread-context.ts --poc-dir <dir>
  bun scripts/evals/corpus-recreation-thread-context.ts <dir> --output output/thread-context.md --json output/thread-context.json
`)
}

function defaultOutputPaths(pocDir: string): { output: string; json: string } {
  return {
    output: join(pocDir, "thread-context.md"),
    json: join(pocDir, "thread-context.json"),
  }
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeManifest(args: Args, report: CorpusThreadContextReport, output: string, json: string): void {
  const parent = parentManifestForPocDir(args.pocDir)
  writeRunManifest(manifestPathForSidecar(json), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-thread-context",
    variantId: "thread-context",
    parentRunId: parent?.runId ?? null,
    rootRunId: parent?.rootRunId ?? null,
    command: {
      name: "diagnostics:corpus-recreation-thread-context",
      argv: process.argv.slice(2),
    },
    inputs: existingArtifactRefs([
      { path: join(resolve(args.pocDir), "run-manifest.json"), role: "parent-run-manifest" },
      { path: join(resolve(args.pocDir), "packet.json"), role: "packet" },
      { path: join(resolve(args.pocDir), "plan.json"), role: "plan" },
      { path: join(resolve(args.pocDir), "thread-map.json"), role: "thread-map-json" },
    ]),
    outputs: existingArtifactRefs([
      { path: output, role: "thread-context-markdown" },
      { path: json, role: "thread-context-json" },
    ]),
    relatedRunIds: parent ? [parent.runId] : [],
    discriminator: `contexts-${report.contextCount}`,
    metadata: {
      pocDir: args.pocDir,
      sceneCount: report.sceneCount,
      contextCount: report.contextCount,
      issueCount: report.issueCount,
    },
  }))
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`missing required artifact: ${path}`)
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function formatList(values: string[]): string[] {
  return values.length > 0 ? values.map(value => `- ${value}`) : ["- none"]
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const defaults = defaultOutputPaths(args.pocDir)
    const output = args.output ?? defaults.output
    const json = args.json ?? defaults.json
    const report = buildCorpusRecreationThreadContext(args.pocDir)
    const rendered = renderCorpusRecreationThreadContext(report)
    writeOutput(output, rendered)
    writeOutput(json, `${JSON.stringify(report, null, 2)}\n`)
    writeManifest(args, report, output, json)
    console.log(rendered)
    console.log(`wrote ${resolve(process.cwd(), output)}`)
    console.log(`wrote ${resolve(process.cwd(), json)}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
