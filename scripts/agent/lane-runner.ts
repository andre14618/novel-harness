#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import {
  appendLaneEvent,
  buildLaneStatusReport,
  exitCodeForState,
  field,
  laneEventLogPath,
  laneIdFromPath,
  readLaneDoc,
  renderLaneStatus,
  type LaneRunState,
} from "./lane-core"

export type RunnerEngine = "opencode" | "claude"
export type WorkerIo = "capture" | "terminal"

export interface RunnerArgs {
  lanePath: string | null
  engine: RunnerEngine
  maxCycles: number
  maxHours: number
  cycleTimeoutMinutes: number
  staleMinutes: number
  maxNoChangeCycles: number
  agent: string | null
  model: string | null
  permissionMode: string | null
  workerIo: WorkerIo
  workerRole: string
  workerId: string | null
  queuePath: string | null
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

export interface LaneQueue {
  active: string[]
  next: string[]
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
    engine: "opencode",
    maxCycles: 4,
    maxHours: 3,
    cycleTimeoutMinutes: 45,
    staleMinutes: 10,
    maxNoChangeCycles: 1,
    agent: null,
    model: null,
    permissionMode: null,
    workerIo: "capture",
    workerRole: "captain",
    workerId: null,
    queuePath: null,
    title: null,
    extraInstruction: "",
    dryRun: false,
    dangerouslySkipPermissions: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--engine") {
      const value = argv[++i]
      if (value !== "opencode" && value !== "claude") throw new Error("--engine must be one of opencode|claude")
      out.engine = value
    }
    else if (a === "--max-cycles") out.maxCycles = positiveInteger(argv[++i], "--max-cycles")
    else if (a === "--max-hours") out.maxHours = positiveNumber(argv[++i], "--max-hours")
    else if (a === "--cycle-timeout-minutes") out.cycleTimeoutMinutes = positiveNumber(argv[++i], "--cycle-timeout-minutes")
    else if (a === "--stale-minutes") out.staleMinutes = positiveNumber(argv[++i], "--stale-minutes")
    else if (a === "--max-no-change-cycles") out.maxNoChangeCycles = positiveInteger(argv[++i], "--max-no-change-cycles")
    else if (a === "--agent") out.agent = argv[++i] ?? null
    else if (a === "--model") out.model = argv[++i] ?? null
    else if (a === "--permission-mode") out.permissionMode = argv[++i] ?? null
    else if (a === "--worker-io") {
      const value = argv[++i]
      if (value !== "capture" && value !== "terminal") throw new Error("--worker-io must be one of capture|terminal")
      out.workerIo = value
    }
    else if (a === "--interactive") out.workerIo = "terminal"
    else if (a === "--worker-role") out.workerRole = argv[++i] ?? out.workerRole
    else if (a === "--worker-id") out.workerId = argv[++i] ?? null
    else if (a === "--queue") out.queuePath = argv[++i] ?? null
    else if (a === "--title") out.title = argv[++i] ?? null
    else if (a === "--instruction") out.extraInstruction = argv[++i] ?? ""
    else if (a === "--dry-run") out.dryRun = true
    else if (a === "--dangerously-skip-permissions") out.dangerouslySkipPermissions = true
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/agent/lane-runner.ts <docs/sessions/lane.md> [options]\n\n" +
          "Runs bounded OpenCode or Claude cycles while lane-status remains continue.\n\n" +
          "Options:\n" +
          "  --engine <name>              Worker engine: opencode|claude (default: opencode)\n" +
          "  --max-cycles <n>             Maximum worker cycles (default: 4)\n" +
          "  --max-hours <n>              Wall-clock cap in hours (default: 3)\n" +
          "  --cycle-timeout-minutes <n>  Per-cycle worker timeout (default: 45)\n" +
          "  --stale-minutes <n>          Heartbeat stale threshold for lane-status (default: 10)\n" +
          "  --max-no-change-cycles <n>   Stop after n consecutive no-worktree-change cycles (default: 1)\n" +
          "  --agent <name>               Pass --agent to the worker\n" +
          "  --model <provider/model>     Pass --model to the worker\n" +
          "  --permission-mode <mode>     Claude only: pass --permission-mode\n" +
          "  --worker-io <mode>           Worker I/O: capture|terminal (default: capture)\n" +
          "  --interactive                Alias for --worker-io terminal\n" +
          "  --worker-role <role>         Durable role label: captain|evidence|support|review (default: captain)\n" +
          "  --worker-id <id>             Durable actor id for heartbeats/messages (default: <role>-<engine>)\n" +
          "  --queue <path>               Markdown queue of pre-created lane docs\n" +
          "  --title <text>               Pass --title/--name to the worker\n" +
          "  --instruction <text>         Extra instruction appended to each cycle prompt\n" +
          "  --dry-run                    Print the first worker command and prompt, do not execute\n" +
          "  --dangerously-skip-permissions  Pass through to the worker (not recommended)\n",
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
  if (out.permissionMode === "") throw new Error("--permission-mode requires a value")
  if (out.workerRole === "") throw new Error("--worker-role requires a value")
  if (out.workerId === "") throw new Error("--worker-id requires a value")
  if (out.engine === "opencode" && out.workerIo === "terminal" && out.dangerouslySkipPermissions) {
    throw new Error("--dangerously-skip-permissions is not supported for opencode terminal mode")
  }
  if (out.queuePath === "") throw new Error("--queue requires a value")
  return out
}

export function workerIdentity(args: RunnerArgs): string {
  return args.workerId ?? `${args.workerRole}-${args.engine}`
}

function workerEventFields(args: RunnerArgs): Record<string, string> {
  return {
    workerId: workerIdentity(args),
    workerRole: args.workerRole,
    workerEngine: args.engine,
    workerIo: args.workerIo,
  }
}

export function buildCyclePrompt(args: RunnerArgs, cycle: number, laneSummary: string): string {
  const lanePath = args.lanePath!
  const extra = args.extraInstruction.trim()
  const actor = workerIdentity(args)
  const terminalNote = args.workerIo === "terminal"
    ? [
      "",
      "Terminal worker mode:",
      "- You are running in an attached terminal; communicate visible status there and durable status via lane-heartbeat events.",
      "- If you launch background validation, either stay in the session to monitor it or record an explicit heartbeat/status that says what should be checked next.",
    ]
    : []
  const queueNote = args.queuePath
    ? `- Queue handoff is configured at ${args.queuePath}; complete finalization before writing a stop gate so the runner can advance deterministically.`
    : "- No queue handoff is configured; still complete finalization before stopping so pickup is clean."
  return [
    `Run one bounded autonomous ${args.engine} work cycle for Novel Harness lane ${lanePath}.`,
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
    "Agent identity:",
    `- Your durable actor id is ${actor}. Use exactly this value in lane-heartbeat and lane-message --actor fields.`,
    `- Your role is ${args.workerRole}; engine=${args.engine}; worker_io=${args.workerIo}.`,
    "- If you delegate work, send it to a role such as evidence, support, review, or human, then continue only after the message is claimed/resolved or you have an explicit reason to proceed.",
    "",
    "Required workflow:",
    `1. Read ${lanePath} before editing.` ,
    `2. Record a heartbeat before substantial work: bun scripts/agent/lane-heartbeat.ts ${lanePath} --actor ${actor} --step "<current step>"`,
    "3. Work only on the declared primary lane and allowed support work.",
    "4. Do not touch deferred out-of-lane runtime changes.",
    "5. If blocked, record a heartbeat with --status blocked, human-needed, or infra-failure and stop.",
    "6. Run the narrowest relevant checks for any changes you make.",
    "7. Commit a coherent completed unit only if repo instructions allow it and checks pass; never push.",
    "8. Update the lane doc progress/results if the cycle reaches a durable finding.",
    "9. End with a concise status: what changed, checks run, next safe command.",
    "",
    "Operational coordination:",
    `- Use lane messages for cross-agent requests, claims, monitoring handoffs, questions, and results: bun scripts/agent/lane-message.ts send ${lanePath} --actor ${actor} --to evidence --kind request --subject "<short task>" --body "<details>"`,
    `- Claim work before doing delegated monitoring/support: bun scripts/agent/lane-message.ts claim ${lanePath} <msg-id> --actor ${actor} --lease-minutes 30`,
    `- Resolve delegated work with evidence refs: bun scripts/agent/lane-message.ts resolve ${lanePath} <msg-id> --actor ${actor} --result "<finding>" --ref "<path/row/id>"`,
    "- Use monitor --panel coordination to see open messages and expired leases.",
    ...terminalNote,
    "",
    "Lane finalization before stop or queue handoff:",
    "- Do not merely emit a stop event when the lane has a durable result.",
    "- First update Results: Outcome, Stop gate fired, Evidence link/row/path, Cost, and Commit(s).",
    "- Update persistent docs that should survive chat: docs/current-state.md, docs/todo.md, docs/decisions.md, docs/lessons-learned.md, and the lane doc as applicable.",
    "- Conclude the Experiment ID with bun scripts/agent/conclude-experiment.ts --id <id> --conclusion \"<summary>\" when the lane result is known.",
    "- Resolve classified pending plan-assist gates with scripts/agent/resolve-stale-gates.ts after a dry-run; preserve evidence as orphaned, never delete rows.",
    "- Run bun scripts/preflight-docs-impact.ts --strict and git diff --check before the finalization commit.",
    "- Commit the final docs/cleanup unit if checks pass; never push.",
    "- Only after those steps should the lane doc contain a stop gate that allows the runner to stop or advance.",
    queueNote,
    extra ? "" : null,
    extra ? "Extra instruction:" : null,
    extra || null,
  ].filter((line): line is string => line !== null).join("\n")
}

export function buildOpencodeArgs(args: RunnerArgs, prompt: string, cycle: number): string[] {
  if (args.workerIo === "terminal") {
    const out = ["."]
    if (args.model) out.push("--model", args.model)
    if (args.agent) out.push("--agent", args.agent)
    out.push("--prompt", prompt)
    return out
  }
  const out = ["run"]
  if (args.model) out.push("--model", args.model)
  if (args.agent) out.push("--agent", args.agent)
  if (args.title) out.push("--title", args.title)
  else out.push("--title", `${laneIdFromPath(args.lanePath!)} ${args.workerRole} cycle ${cycle}`)
  if (args.dangerouslySkipPermissions) out.push("--dangerously-skip-permissions")
  out.push(prompt)
  return out
}

export function buildClaudeArgs(args: RunnerArgs, prompt: string, cycle: number): string[] {
  const out = args.workerIo === "capture" ? ["-p"] : []
  if (args.model) out.push("--model", args.model)
  if (args.agent) out.push("--agent", args.agent)
  if (args.permissionMode) out.push("--permission-mode", args.permissionMode)
  if (args.title) out.push("--name", args.title)
  else out.push("--name", `${laneIdFromPath(args.lanePath!)} ${args.workerRole} cycle ${cycle}`)
  if (args.dangerouslySkipPermissions) out.push("--dangerously-skip-permissions")
  out.push(prompt)
  return out
}

export function commandForEngine(engine: RunnerEngine): string {
  return engine === "claude" ? "claude" : "opencode"
}

export function buildWorkerArgs(args: RunnerArgs, prompt: string, cycle: number): string[] {
  return args.engine === "claude" ? buildClaudeArgs(args, prompt, cycle) : buildOpencodeArgs(args, prompt, cycle)
}

export function buildDisplayCommand(args: RunnerArgs, cycle: number): string {
  const displayArgs = buildWorkerArgs(args, "<cycle-prompt>", cycle)
  return `${commandForEngine(args.engine)} ${displayArgs.map(a => JSON.stringify(a)).join(" ")}`
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

function writeCycleArtifacts(lanePath: string, cycle: number, command: string, prompt: string, commandArgs: string[], result: CycleRunResult): string {
  const dir = cycleDir(lanePath)
  mkdirSync(dir, { recursive: true })
  const base = join(dir, `cycle-${String(cycle).padStart(2, "0")}-${safeStamp()}`)
  writeFileSync(`${base}.prompt.txt`, prompt)
  writeFileSync(`${base}.command.json`, JSON.stringify({ command, args: commandArgs }, null, 2))
  writeFileSync(`${base}.stdout.log`, result.stdout)
  writeFileSync(`${base}.stderr.log`, result.stderr)
  writeFileSync(`${base}.result.json`, JSON.stringify(result, null, 2))
  return base
}

function runWorkerCycle(command: string, commandArgs: string[], timeoutMinutes: number, workerIo: WorkerIo): CycleRunResult {
  if (workerIo === "terminal") {
    const result = spawnSync(command, commandArgs, {
      stdio: "inherit",
      timeout: Math.round(timeoutMinutes * 60_000),
    })
    const errorMessage = result.error ? String(result.error.message || result.error) : null
    const timedOut = Boolean(result.error && (result.error as any).code === "ETIMEDOUT")
    return {
      ok: result.status === 0 && !result.error,
      status: result.status,
      stdout: "[terminal worker mode: stdout was inherited by the parent terminal and was not captured]\n",
      stderr: "[terminal worker mode: stderr was inherited by the parent terminal and was not captured]\n",
      error: errorMessage,
      timedOut,
    }
  }
  const result = spawnSync(command, commandArgs, {
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
  const report = buildLaneStatusReport({ lanePath, staleMinutes, panels: ["outside", "coordination"] })
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

export function parseLaneQueue(text: string): LaneQueue {
  const queue: LaneQueue = { active: [], next: [] }
  let section: keyof LaneQueue | null = null
  for (const line of text.split(/\r?\n/)) {
    const sectionMatch = line.match(/^##\s+(Active|Next)\s*$/i)
    if (sectionMatch) {
      section = sectionMatch[1]!.toLowerCase() as keyof LaneQueue
      continue
    }
    if (!section) continue
    const matches = line.match(/docs\/sessions\/[^\s)`]+\.md/g) ?? []
    for (const match of matches) {
      if (!queue[section].includes(match)) queue[section].push(match)
    }
  }
  return queue
}

export function nextLaneFromQueueText(text: string, currentLanePath: string): string | null {
  const queue = parseLaneQueue(text)
  const normalizedCurrent = currentLanePath.replace(/^\.\//, "")
  const activeIndex = queue.active.indexOf(normalizedCurrent)
  if (activeIndex >= 0) return queue.next[0] ?? null
  const nextIndex = queue.next.indexOf(normalizedCurrent)
  if (nextIndex >= 0) return queue.next[nextIndex + 1] ?? null
  return queue.next[0] ?? null
}

export function missingConclusionFields(lanePath: string): string[] {
  const doc = readLaneDoc(lanePath)
  const missing: string[] = []
  if (!field(doc, "results", "outcome")) missing.push("Results: Outcome")
  if (!field(doc, "results", "stop gate fired")) missing.push("Results: Stop gate fired")
  if (!field(doc, "results", "evidence link/row/path")) missing.push("Results: Evidence link/row/path")
  if (!field(doc, "results", "commit(s)")) missing.push("Results: Commit(s)")
  return missing
}

function tryAdvanceLane(lanePath: string, queuePath: string | null): { lanePath: string | null; exitCode: number | null; message: string } {
  if (!queuePath) return { lanePath: null, exitCode: 10, message: "lane stopped and no queue was configured" }
  const missing = missingConclusionFields(lanePath)
  if (missing.length > 0) {
    return { lanePath: null, exitCode: 21, message: `lane stopped but conclusion is incomplete: ${missing.join(", ")}` }
  }
  if (!existsSync(queuePath)) return { lanePath: null, exitCode: 21, message: `queue file not found: ${queuePath}` }
  const next = nextLaneFromQueueText(readFileSync(queuePath, "utf8"), lanePath)
  if (!next) return { lanePath: null, exitCode: 10, message: `lane stopped and queue has no next lane after ${lanePath}` }
  if (!existsSync(next)) return { lanePath: null, exitCode: 21, message: `next lane doc does not exist: ${next}` }
  return { lanePath: next, exitCode: null, message: `advancing from ${lanePath} to ${next}` }
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  let lanePath = args.lanePath!
  const startMs = Date.now()
  let noChangeCycles = 0

  appendRunnerEvent(lanePath, {
    ...workerEventFields(args),
    type: "runner_start",
    step: `worker=${workerIdentity(args)} role=${args.workerRole} maxCycles=${args.maxCycles} maxHours=${args.maxHours} cycleTimeoutMinutes=${args.cycleTimeoutMinutes} workerIo=${args.workerIo}`,
  })

  if (args.workerIo === "terminal" && !args.dryRun && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    appendRunnerEvent(lanePath, {
      ...workerEventFields(args),
      type: "runner_terminal_unavailable",
      status: "human-needed",
      message: "--worker-io terminal requires an attached TTY; use capture mode for background/nohup runs",
    })
    return 21
  }

  for (let cycle = 1; cycle <= args.maxCycles; cycle++) {
    if (elapsedHours(startMs) >= args.maxHours) {
      appendRunnerEvent(lanePath, { ...workerEventFields(args), type: "runner_limit", status: "human-needed", message: `max hours reached before cycle ${cycle}` })
      return 21
    }

    let summary = laneSummaryForPrompt(lanePath, args.staleMinutes)
    summary = refreshStaleHeartbeatIfNeeded(lanePath, summary, `lane-runner cycle ${cycle} status check`, args.staleMinutes)
    if (summary.state !== "continue") {
      if (summary.state === "stop") {
        const advance = tryAdvanceLane(lanePath, args.queuePath)
        appendRunnerEvent(lanePath, { ...workerEventFields(args), type: advance.lanePath ? "runner_advance" : "runner_stop", status: advance.lanePath ? "continue" : (advance.exitCode === 21 ? "human-needed" : "stop"), message: advance.message })
        if (advance.lanePath) {
          lanePath = advance.lanePath
          noChangeCycles = 0
          appendRunnerEvent(lanePath, { ...workerEventFields(args), type: "runner_advance_start", step: `continued from queue ${args.queuePath}`, message: advance.message })
          continue
        }
        return advance.exitCode ?? 10
      }
      appendRunnerEvent(lanePath, { ...workerEventFields(args), type: "runner_stop", status: summary.state, message: `lane-status is ${summary.state}` })
      return summary.exitCode
    }

    const cycleArgs: RunnerArgs = { ...args, lanePath }
    const prompt = buildCyclePrompt(cycleArgs, cycle, summary.text)
    const command = commandForEngine(args.engine)
    const commandArgs = buildWorkerArgs(cycleArgs, prompt, cycle)
    const commandText = buildDisplayCommand(cycleArgs, cycle)
    appendRunnerEvent(lanePath, { ...workerEventFields(cycleArgs), type: "cycle_start", step: `cycle ${cycle}/${args.maxCycles}`, command: commandText })

    if (args.dryRun) {
      const result = { ok: true, status: 0, stdout: "", stderr: "", error: null, timedOut: false }
      const artifactBase = writeCycleArtifacts(lanePath, cycle, command, prompt, commandArgs, result)
      console.log(commandText)
      console.log("\n--- prompt ---\n")
      console.log(prompt)
      appendRunnerEvent(lanePath, { ...workerEventFields(cycleArgs), type: "cycle_dry_run", step: `wrote ${artifactBase}.*`, command: commandText })
      return 0
    }

    const before = workspaceFingerprint()
    const result = runWorkerCycle(command, commandArgs, args.cycleTimeoutMinutes, args.workerIo)
    const artifactBase = writeCycleArtifacts(lanePath, cycle, command, prompt, commandArgs, result)
    const after = workspaceFingerprint()
    const changed = before !== after

    if (!result.ok) {
      const reason = result.timedOut
        ? `cycle ${cycle} timed out after ${args.cycleTimeoutMinutes}m`
        : `cycle ${cycle} exited ${result.status ?? "unknown"}${result.error ? `: ${result.error}` : ""}`
      appendRunnerEvent(lanePath, { ...workerEventFields(cycleArgs), type: "cycle_failed", status: "infra-failure", message: `${reason}; artifacts=${artifactBase}.*`, command: commandText })
      return 22
    }

    let postSummary = laneSummaryForPrompt(lanePath, args.staleMinutes)
    postSummary = refreshStaleHeartbeatIfNeeded(lanePath, postSummary, `lane-runner cycle ${cycle} completed`, args.staleMinutes)

    appendRunnerEvent(lanePath, {
      ...workerEventFields(cycleArgs),
      type: "cycle_complete",
      status: postSummary.state,
      step: `cycle ${cycle}/${args.maxCycles}`,
      message: `changed=${changed}; lane_state=${postSummary.state}; artifacts=${artifactBase}.*`,
      command: commandText,
      changed,
    })

    if (postSummary.state !== "continue") {
      if (postSummary.state === "stop") {
        const advance = tryAdvanceLane(lanePath, args.queuePath)
        appendRunnerEvent(lanePath, { ...workerEventFields(args), type: advance.lanePath ? "runner_advance" : "runner_stop", status: advance.lanePath ? "continue" : (advance.exitCode === 21 ? "human-needed" : "stop"), message: advance.message })
        if (advance.lanePath) {
          lanePath = advance.lanePath
          noChangeCycles = 0
          appendRunnerEvent(lanePath, { ...workerEventFields(args), type: "runner_advance_start", step: `continued from queue ${args.queuePath}`, message: advance.message })
          continue
        }
        return advance.exitCode ?? postSummary.exitCode
      }
      return postSummary.exitCode
    }

    noChangeCycles = changed ? 0 : noChangeCycles + 1
    if (noChangeCycles >= args.maxNoChangeCycles) {
      appendRunnerEvent(lanePath, {
        ...workerEventFields(args),
        type: "runner_no_change_limit",
        status: "human-needed",
        message: `${noChangeCycles} consecutive cycle(s) made no tracked workspace change; inspect artifacts before continuing`,
      })
      return 21
    }
  }

  appendRunnerEvent(lanePath, { ...workerEventFields(args), type: "runner_limit", status: "human-needed", message: `max cycles reached (${args.maxCycles})` })
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
