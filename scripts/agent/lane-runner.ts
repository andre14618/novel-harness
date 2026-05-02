#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import {
  appendLaneEvent,
  buildLaneStatusReport,
  exitCodeForState,
  field,
  laneEventLogPath,
  laneIdFromPath,
  renderLaneStatus,
  type LaneRunState,
} from "./lane-core"

export interface RunnerArgs {
  lanePath: string | null
  maxCycles: number
  maxHours: number
  cycleTimeoutMinutes: number
  staleMinutes: number
  maxNoChangeCycles: number
  agent: string | null
  model: string | null
  title: string | null
  extraInstruction: string
  dryRun: boolean
  dangerouslySkipPermissions: boolean
}

export interface CycleRunResult {
  ok: boolean
  status: number | null
  stdout: string
  stderr: string
  error: string | null
  timedOut: boolean
}

function positiveInteger(value: string | undefined, label: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a positive integer`)
  return n
}

function positiveNumber(value: string | undefined, label: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be a positive number`)
  return n
}

export function parseArgs(argv: string[]): RunnerArgs {
  const out: RunnerArgs = {
    lanePath: null,
    maxCycles: 4,
    maxHours: 3,
    cycleTimeoutMinutes: 45,
    staleMinutes: 10,
    maxNoChangeCycles: 1,
    agent: null,
    model: null,
    title: null,
    extraInstruction: "",
    dryRun: false,
    dangerouslySkipPermissions: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--max-cycles") out.maxCycles = positiveInteger(argv[++i], "--max-cycles")
    else if (a === "--max-hours") out.maxHours = positiveNumber(argv[++i], "--max-hours")
    else if (a === "--cycle-timeout-minutes") out.cycleTimeoutMinutes = positiveNumber(argv[++i], "--cycle-timeout-minutes")
    else if (a === "--stale-minutes") out.staleMinutes = positiveNumber(argv[++i], "--stale-minutes")
    else if (a === "--max-no-change-cycles") out.maxNoChangeCycles = positiveInteger(argv[++i], "--max-no-change-cycles")
    else if (a === "--agent") out.agent = argv[++i] ?? null
    else if (a === "--model") out.model = argv[++i] ?? null
    else if (a === "--title") out.title = argv[++i] ?? null
    else if (a === "--instruction") out.extraInstruction = argv[++i] ?? ""
    else if (a === "--dry-run") out.dryRun = true
    else if (a === "--dangerously-skip-permissions") out.dangerouslySkipPermissions = true
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/agent/lane-runner.ts <docs/sessions/lane.md> [options]\n\n" +
          "Runs bounded OpenCode cycles while lane-status remains continue.\n\n" +
          "Options:\n" +
          "  --max-cycles <n>             Maximum OpenCode cycles (default: 4)\n" +
          "  --max-hours <n>              Wall-clock cap in hours (default: 3)\n" +
          "  --cycle-timeout-minutes <n>  Per-cycle OpenCode timeout (default: 45)\n" +
          "  --stale-minutes <n>          Heartbeat stale threshold for lane-status (default: 10)\n" +
          "  --max-no-change-cycles <n>   Stop after n consecutive no-worktree-change cycles (default: 1)\n" +
          "  --agent <name>               Pass --agent to opencode run\n" +
          "  --model <provider/model>     Pass --model to opencode run\n" +
          "  --title <text>               Pass --title to opencode run\n" +
          "  --instruction <text>         Extra instruction appended to each cycle prompt\n" +
          "  --dry-run                    Print the first OpenCode command and prompt, do not execute\n" +
          "  --dangerously-skip-permissions  Pass through to opencode run (not recommended)\n",
      )
      process.exit(0)
    } else if (!a.startsWith("--")) {
      out.lanePath = a
    } else {
      throw new Error(`unknown option: ${a}`)
    }
  }
  if (!out.lanePath) throw new Error("lane-runner requires a lane session doc path")
  if (out.agent === "") throw new Error("--agent requires a value")
  if (out.model === "") throw new Error("--model requires a value")
  return out
}

export function buildCyclePrompt(args: RunnerArgs, cycle: number, laneSummary: string): string {
  const lanePath = args.lanePath!
  const extra = args.extraInstruction.trim()
  return [
    `Run one bounded autonomous work cycle for Novel Harness lane ${lanePath}.`,
    `Cycle ${cycle}/${args.maxCycles}. Stop after one coherent work unit; the repo-side runner will decide whether another cycle starts.`,
    "",
    "Source of truth:",
    `- Lane doc: ${lanePath}`,
    "- Event log: output/agent-runs/<lane-id>/events.jsonl",
    "- Do not rely on chat history.",
    "",
    "Current lane status:",
    laneSummary,
    "",
    "Required workflow:",
    `1. Read ${lanePath} before editing.` ,
    `2. Record a heartbeat before substantial work: bun scripts/agent/lane-heartbeat.ts ${lanePath} --actor opencode --step "<current step>"`,
    "3. Work only on the declared primary lane and allowed support work.",
    "4. Do not touch deferred out-of-lane runtime changes.",
    "5. If blocked, record a heartbeat with --status blocked, human-needed, or infra-failure and stop.",
    "6. Run the narrowest relevant checks for any changes you make.",
    "7. Commit a coherent completed unit only if repo instructions allow it and checks pass; never push.",
    "8. Update the lane doc progress/results if the cycle reaches a durable finding.",
    "9. End with a concise status: what changed, checks run, next safe command.",
    extra ? "" : null,
    extra ? "Extra instruction:" : null,
    extra || null,
  ].filter((line): line is string => line !== null).join("\n")
}

export function buildOpencodeArgs(args: RunnerArgs, prompt: string, cycle: number): string[] {
  const out = ["run"]
  if (args.model) out.push("--model", args.model)
  if (args.agent) out.push("--agent", args.agent)
  if (args.title) out.push("--title", args.title)
  else out.push("--title", `${laneIdFromPath(args.lanePath!)} cycle ${cycle}`)
  if (args.dangerouslySkipPermissions) out.push("--dangerously-skip-permissions")
  out.push(prompt)
  return out
}

export function buildDisplayCommand(args: RunnerArgs, cycle: number): string {
  const displayArgs = buildOpencodeArgs(args, "<cycle-prompt>", cycle)
  return `opencode ${displayArgs.map(a => JSON.stringify(a)).join(" ")}`
}

function workspaceFingerprint(): string {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
  const status = spawnSync("git", ["status", "--short"], { encoding: "utf8" })
  return `${head.stdout.trim()}\n${status.stdout.trim()}`
}

function safeStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-")
}

function cycleDir(lanePath: string): string {
  return join("output", "agent-runs", laneIdFromPath(lanePath), "cycles")
}

function writeCycleArtifacts(lanePath: string, cycle: number, prompt: string, commandArgs: string[], result: CycleRunResult): string {
  const dir = cycleDir(lanePath)
  mkdirSync(dir, { recursive: true })
  const base = join(dir, `cycle-${String(cycle).padStart(2, "0")}-${safeStamp()}`)
  writeFileSync(`${base}.prompt.txt`, prompt)
  writeFileSync(`${base}.command.json`, JSON.stringify({ command: "opencode", args: commandArgs }, null, 2))
  writeFileSync(`${base}.stdout.log`, result.stdout)
  writeFileSync(`${base}.stderr.log`, result.stderr)
  writeFileSync(`${base}.result.json`, JSON.stringify(result, null, 2))
  return base
}

function runOpenCodeCycle(commandArgs: string[], timeoutMinutes: number): CycleRunResult {
  const result = spawnSync("opencode", commandArgs, {
    encoding: "utf8",
    timeout: Math.round(timeoutMinutes * 60_000),
    maxBuffer: 1024 * 1024 * 20,
  })
  const errorMessage = result.error ? String(result.error.message || result.error) : null
  const timedOut = Boolean(result.error && (result.error as any).code === "ETIMEDOUT")
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: errorMessage,
    timedOut,
  }
}

function appendRunnerEvent(lanePath: string, event: {
  type: string
  status?: LaneRunState
  step?: string
  message?: string
  command?: string
  [key: string]: unknown
}): void {
  appendLaneEvent(laneEventLogPath(lanePath), {
    ts: new Date().toISOString(),
    actor: "lane-runner",
    status: event.status ?? "continue",
    ...event,
  })
}

function laneSummaryForPrompt(lanePath: string, staleMinutes: number): { text: string; state: LaneRunState; reason: string; exitCode: number } {
  const report = buildLaneStatusReport({ lanePath, staleMinutes, panels: ["outside"] })
  return {
    text: renderLaneStatus(report),
    state: report.assessment.state,
    reason: report.assessment.reason,
    exitCode: exitCodeForState(report.assessment.state),
  }
}

function refreshStaleHeartbeatIfNeeded(lanePath: string, summary: ReturnType<typeof laneSummaryForPrompt>, step: string, staleMinutes: number): ReturnType<typeof laneSummaryForPrompt> {
  if (summary.state !== "blocked" || !summary.reason.includes("stale")) return summary
  appendRunnerEvent(lanePath, { type: "heartbeat", step })
  return laneSummaryForPrompt(lanePath, staleMinutes)
}

function elapsedHours(startMs: number): number {
  return (Date.now() - startMs) / 3_600_000
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  const lanePath = args.lanePath!
  const startMs = Date.now()
  let noChangeCycles = 0

  appendRunnerEvent(lanePath, {
    type: "runner_start",
    step: `maxCycles=${args.maxCycles} maxHours=${args.maxHours} cycleTimeoutMinutes=${args.cycleTimeoutMinutes}`,
  })

  for (let cycle = 1; cycle <= args.maxCycles; cycle++) {
    if (elapsedHours(startMs) >= args.maxHours) {
      appendRunnerEvent(lanePath, { type: "runner_limit", status: "human-needed", message: `max hours reached before cycle ${cycle}` })
      return 21
    }

    let summary = laneSummaryForPrompt(lanePath, args.staleMinutes)
    summary = refreshStaleHeartbeatIfNeeded(lanePath, summary, `lane-runner cycle ${cycle} status check`, args.staleMinutes)
    if (summary.state !== "continue") {
      appendRunnerEvent(lanePath, { type: "runner_stop", status: summary.state, message: `lane-status is ${summary.state}` })
      return summary.exitCode
    }

    const prompt = buildCyclePrompt(args, cycle, summary.text)
    const commandArgs = buildOpencodeArgs(args, prompt, cycle)
    const commandText = buildDisplayCommand(args, cycle)
    appendRunnerEvent(lanePath, { type: "cycle_start", step: `cycle ${cycle}/${args.maxCycles}`, command: commandText })

    if (args.dryRun) {
      const result = { ok: true, status: 0, stdout: "", stderr: "", error: null, timedOut: false }
      const artifactBase = writeCycleArtifacts(lanePath, cycle, prompt, commandArgs, result)
      console.log(commandText)
      console.log("\n--- prompt ---\n")
      console.log(prompt)
      appendRunnerEvent(lanePath, { type: "cycle_dry_run", step: `wrote ${artifactBase}.*`, command: commandText })
      return 0
    }

    const before = workspaceFingerprint()
    const result = runOpenCodeCycle(commandArgs, args.cycleTimeoutMinutes)
    const artifactBase = writeCycleArtifacts(lanePath, cycle, prompt, commandArgs, result)
    const after = workspaceFingerprint()
    const changed = before !== after

    if (!result.ok) {
      const reason = result.timedOut
        ? `cycle ${cycle} timed out after ${args.cycleTimeoutMinutes}m`
        : `cycle ${cycle} exited ${result.status ?? "unknown"}${result.error ? `: ${result.error}` : ""}`
      appendRunnerEvent(lanePath, { type: "cycle_failed", status: "infra-failure", message: `${reason}; artifacts=${artifactBase}.*`, command: commandText })
      return 22
    }

    let postSummary = laneSummaryForPrompt(lanePath, args.staleMinutes)
    postSummary = refreshStaleHeartbeatIfNeeded(lanePath, postSummary, `lane-runner cycle ${cycle} completed`, args.staleMinutes)

    appendRunnerEvent(lanePath, {
      type: "cycle_complete",
      status: postSummary.state,
      step: `cycle ${cycle}/${args.maxCycles}`,
      message: `changed=${changed}; lane_state=${postSummary.state}; artifacts=${artifactBase}.*`,
      command: commandText,
      changed,
    })

    if (postSummary.state !== "continue") return postSummary.exitCode

    noChangeCycles = changed ? 0 : noChangeCycles + 1
    if (noChangeCycles >= args.maxNoChangeCycles) {
      appendRunnerEvent(lanePath, {
        type: "runner_no_change_limit",
        status: "human-needed",
        message: `${noChangeCycles} consecutive cycle(s) made no tracked workspace change; inspect artifacts before continuing`,
      })
      return 21
    }
  }

  appendRunnerEvent(lanePath, { type: "runner_limit", status: "human-needed", message: `max cycles reached (${args.maxCycles})` })
  return 21
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error(`[lane-runner] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
