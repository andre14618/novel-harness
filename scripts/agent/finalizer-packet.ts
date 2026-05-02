#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import {
  field,
  laneEventLogPath,
  laneIdFromPath,
  laneMessageLogPath,
  parseLaneDoc,
  readLaneEvents,
  readLaneMessages,
  reduceLaneMessages,
  type LaneEvent,
  type LaneMessage,
} from "./lane-core"

export interface FinalizerPacketArgs {
  lanePath: string | null
  result: string | null
  commits: string[]
  evidence: string[]
  cost: string | null
  message: string | null
  outputPath: string | null
  print: boolean
}

export interface FinalizerPacket {
  generatedAt: string
  lanePath: string
  laneId: string
  result: string | null
  cost: string | null
  requestedDocsCommitMessage: string | null
  required: {
    laneFields: Record<string, string>
    suppliedCommits: string[]
    suppliedEvidence: string[]
    currentResults: Record<string, string>
  }
  supporting: {
    git: {
      branch: string
      head: string
      statusShort: string[]
      commitsSinceStartingCommit: string[]
      suppliedCommitSummaries: string[]
    }
    recentEvents: LaneEvent[]
    activeMessages: LaneMessage[]
    resolvedMessages: LaneMessage[]
  }
  inventory: {
    eventLogPath: string
    messageLogPath: string
    durableDocs: string[]
    warnings: string[]
  }
}

function usage(): string {
  return [
    "Usage: bun scripts/agent/finalizer-packet.ts <docs/sessions/lane.md> [options]",
    "",
    "Builds a deterministic handoff packet for docs-finalizer.",
    "",
    "Options:",
    "  --result <text>       Result classification when known",
    "  --commit <sha>        Commit SHA/range to include; repeatable",
    "  --evidence <ref>      Evidence ref; repeatable",
    "  --cost <text>         Cost string to include",
    "  --message <text>      Requested docs commit message",
    "  --output <path>       Packet output path (default: output/agent-runs/<lane>/finalizer-packet-<ts>.md)",
    "  --print               Print packet markdown after writing",
  ].join("\n")
}

export function parseArgs(argv: string[]): FinalizerPacketArgs {
  const out: FinalizerPacketArgs = {
    lanePath: null,
    result: null,
    commits: [],
    evidence: [],
    cost: null,
    message: null,
    outputPath: null,
    print: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--result") out.result = argv[++i] ?? null
    else if (a === "--commit") out.commits.push(argv[++i] ?? "")
    else if (a === "--evidence" || a === "--ref") out.evidence.push(argv[++i] ?? "")
    else if (a === "--cost") out.cost = argv[++i] ?? null
    else if (a === "--message") out.message = argv[++i] ?? null
    else if (a === "--output") out.outputPath = argv[++i] ?? null
    else if (a === "--print") out.print = true
    else if (a === "--help" || a === "-h") {
      console.log(usage())
      process.exit(0)
    } else if (!a.startsWith("--")) {
      if (!out.lanePath) out.lanePath = a
      else throw new Error(`unexpected positional argument: ${a}`)
    } else {
      throw new Error(`unknown option: ${a}`)
    }
  }
  out.commits = out.commits.map(value => value.trim()).filter(Boolean)
  out.evidence = out.evidence.map(value => value.trim()).filter(Boolean)
  if (!out.lanePath) throw new Error("finalizer-packet requires a lane/session doc path")
  return out
}

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8", timeout: 10_000 })
  if (result.status !== 0) return ""
  return result.stdout.trim()
}

function compactLines(value: string, limit = 80): string[] {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  return lines.slice(0, limit)
}

function safeStatusLines(): string[] {
  return runGit(["status", "--short"])
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .slice(0, 200)
}

function pathFromStatusLine(line: string): string {
  const porcelainPath = line.length > 3 && line[2] === " " ? line.slice(3) : null
  return (porcelainPath ?? line.replace(/^[^\s]+\s+/, "")).trim()
}

function isAllowedDirtyPath(path: string): boolean {
  return path.startsWith("docs/") ||
    path.startsWith(".opencode/agent/") ||
    path.startsWith("scripts/agent/finalizer-packet") ||
    path.startsWith("scripts/agent/finalize-docs") ||
    path === "package.json"
}

function suppliedCommitSummary(commit: string): string {
  const summary = runGit(["show", "--stat", "--oneline", "--no-renames", "--format=medium", commit])
  return summary || `(git show failed for ${commit})`
}

function defaultPacketPath(lanePath: string, date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-")
  return join("output", "agent-runs", laneIdFromPath(lanePath), `finalizer-packet-${stamp}.md`)
}

export function buildFinalizerPacket(args: FinalizerPacketArgs, date = new Date()): FinalizerPacket {
  const lanePath = args.lanePath!
  const laneText = readFileSync(lanePath, "utf8")
  const lane = parseLaneDoc(laneText, lanePath)
  const eventLogPath = laneEventLogPath(lanePath)
  const messageLogPath = laneMessageLogPath(lanePath)
  const events = readLaneEvents(eventLogPath)
  const messages = reduceLaneMessages(readLaneMessages(messageLogPath))
  const startingCommit = field(lane, "loop contract", "starting commit")
  const commitsSinceStartingCommit = startingCommit
    ? compactLines(runGit(["log", "--oneline", `${startingCommit}..HEAD`]), 80)
    : []
  const activeMessages = messages.filter(message => message.status === "open" || message.status === "claimed")
  const resolvedMessages = messages.filter(message => message.status === "resolved").slice(-12)
  const durableDocs = [
    lanePath,
    "docs/current-state.md",
    "docs/todo.md",
    "docs/decisions.md",
    "docs/lessons-learned.md",
    "docs/agent-lane-protocol.md",
  ]
  const warnings: string[] = []
  const statusShort = safeStatusLines()
  const nonDocsDirty = statusShort.filter(line => !isAllowedDirtyPath(pathFromStatusLine(line)))
  if (nonDocsDirty.length > 0) warnings.push(`non-doc/tool dirty files present: ${nonDocsDirty.join("; ")}`)
  for (const docPath of durableDocs) {
    if (!existsSync(docPath)) warnings.push(`expected durable doc missing: ${docPath}`)
  }

  return {
    generatedAt: date.toISOString(),
    lanePath,
    laneId: lane.laneId,
    result: args.result,
    cost: args.cost,
    requestedDocsCommitMessage: args.message,
    required: {
      laneFields: {
        objective: field(lane, "loop contract", "objective"),
        experimentId: field(lane, "loop contract", "experiment id"),
        primaryLane: field(lane, "loop contract", "primary lane"),
        causalHypothesis: field(lane, "loop contract", "causal hypothesis"),
        baseline: field(lane, "loop contract", "baseline"),
        changedRuntimeLever: field(lane, "loop contract", "changed runtime lever"),
        feedbackSignal: field(lane, "loop contract", "feedback signal"),
        stopGate: field(lane, "loop contract", "stop gate"),
        evidenceArtifact: field(lane, "loop contract", "evidence artifact"),
      },
      suppliedCommits: args.commits,
      suppliedEvidence: args.evidence,
      currentResults: {
        outcome: field(lane, "results", "outcome"),
        stopGateFired: field(lane, "results", "stop gate fired"),
        evidence: field(lane, "results", "evidence link/row/path"),
        cost: field(lane, "results", "cost"),
        commits: field(lane, "results", "commit(s)"),
      },
    },
    supporting: {
      git: {
        branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
        head: runGit(["rev-parse", "--short", "HEAD"]),
        statusShort,
        commitsSinceStartingCommit,
        suppliedCommitSummaries: args.commits.map(suppliedCommitSummary),
      },
      recentEvents: events.slice(-15),
      activeMessages,
      resolvedMessages,
    },
    inventory: {
      eventLogPath,
      messageLogPath,
      durableDocs,
      warnings,
    },
  }
}

function bulletLines(lines: string[]): string[] {
  return lines.length > 0 ? lines.map(line => `- ${line}`) : ["- (none)"]
}

function fencedJson(value: unknown): string[] {
  return ["```json", JSON.stringify(value, null, 2), "```"]
}

export function renderFinalizerPacket(packet: FinalizerPacket): string {
  const out: string[] = []
  out.push("# Finalizer Handoff Packet")
  out.push("")
  out.push(`- Generated at: ${packet.generatedAt}`)
  out.push(`- Lane: ${packet.laneId}`)
  out.push(`- Lane doc: ${packet.lanePath}`)
  out.push(`- Result classification: ${packet.result ?? "(not supplied)"}`)
  out.push(`- Requested docs commit message: ${packet.requestedDocsCommitMessage ?? "(not supplied)"}`)
  out.push("")
  out.push("## Required Evidence")
  out.push("")
  out.push("### Lane Fields")
  out.push(...fencedJson(packet.required.laneFields))
  out.push("")
  out.push("### Supplied Commits")
  out.push(...bulletLines(packet.required.suppliedCommits))
  out.push("")
  out.push("### Supplied Evidence Refs")
  out.push(...bulletLines(packet.required.suppliedEvidence))
  out.push("")
  out.push("### Current Lane Results")
  out.push(...fencedJson(packet.required.currentResults))
  out.push("")
  out.push("## Supporting Context")
  out.push("")
  out.push("### Git State")
  out.push(...fencedJson(packet.supporting.git))
  out.push("")
  out.push("### Recent Lane Events")
  out.push(...fencedJson(packet.supporting.recentEvents))
  out.push("")
  out.push("### Active Lane Messages")
  out.push(...fencedJson(packet.supporting.activeMessages))
  out.push("")
  out.push("### Resolved Lane Messages")
  out.push(...fencedJson(packet.supporting.resolvedMessages))
  out.push("")
  out.push("## Inventory")
  out.push("")
  out.push("### Durable Docs To Consider")
  out.push(...bulletLines(packet.inventory.durableDocs))
  out.push("")
  out.push("### Logs")
  out.push(`- Event log: ${packet.inventory.eventLogPath}`)
  out.push(`- Message log: ${packet.inventory.messageLogPath}`)
  out.push("")
  out.push("### Warnings")
  out.push(...bulletLines(packet.inventory.warnings))
  out.push("")
  return out.join("\n")
}

export function writeFinalizerPacket(args: FinalizerPacketArgs, date = new Date()): { path: string; markdown: string; packet: FinalizerPacket } {
  const path = args.outputPath ?? defaultPacketPath(args.lanePath!, date)
  const packet = buildFinalizerPacket(args, date)
  const markdown = renderFinalizerPacket(packet)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, markdown)
  return { path, markdown, packet }
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  const { path, markdown } = writeFinalizerPacket(args)
  console.log(`[finalizer-packet] wrote ${path}`)
  if (args.print) console.log(markdown)
  return 0
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error(`[finalizer-packet] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
