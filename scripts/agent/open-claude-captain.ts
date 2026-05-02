#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import {
  appendLaneEvent,
  buildLaneStatusReport,
  field,
  laneEventLogPath,
  laneIdFromPath,
  readLaneDoc,
  renderLaneStatus,
  type LaneRunState,
} from "./lane-core"
import { findDefaultLaneDoc } from "./monitor"

export interface ClaudeCaptainArgs {
  lanePath: string | null
  model: string | null
  permissionMode: string | null
  agent: string | null
  actor: string
  title: string | null
  staleMinutes: number
  newWindow: boolean
  workspace: string | null
  dryRun: boolean
  printPrompt: boolean
}

export interface ClaudeCaptainPromptContext {
  lanePath: string
  laneId: string
  actor: string
  objective: string
  experimentId: string
  primaryLane: string
  feedbackSignal: string
  state: LaneRunState
  reason: string
  monitorSnapshot: string
  recommendedAction: string
  recommendedCommand: string
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
  return value
}

function positiveNumber(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number`)
  return parsed
}

export function parseArgs(argv: string[]): ClaudeCaptainArgs {
  const out: ClaudeCaptainArgs = {
    lanePath: null,
    model: "opus",
    permissionMode: "auto",
    agent: null,
    actor: "captain-claude",
    title: null,
    staleMinutes: 10,
    newWindow: true,
    workspace: null,
    dryRun: false,
    printPrompt: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--model") out.model = valueAfter(argv, i++, arg)
    else if (arg === "--no-model") out.model = null
    else if (arg === "--permission-mode") out.permissionMode = valueAfter(argv, i++, arg)
    else if (arg === "--no-permission-mode") out.permissionMode = null
    else if (arg === "--agent") out.agent = valueAfter(argv, i++, arg)
    else if (arg === "--actor") out.actor = valueAfter(argv, i++, arg)
    else if (arg === "--title") out.title = valueAfter(argv, i++, arg)
    else if (arg === "--stale-minutes") out.staleMinutes = positiveNumber(valueAfter(argv, i++, arg), arg)
    else if (arg === "--tab") out.newWindow = false
    else if (arg === "--new-window") out.newWindow = true
    else if (arg === "--workspace") out.workspace = valueAfter(argv, i++, arg)
    else if (arg === "--dry-run") out.dryRun = true
    else if (arg === "--print-prompt") out.printPrompt = true
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun scripts/agent/open-claude-captain.ts [docs/sessions/lane.md] [options]\n\n" +
          "Opens a new WezTerm terminal running interactive Claude Code as lane captain.\n\n" +
          "Options:\n" +
          "  --model <model>            Claude model alias/name (default: opus)\n" +
          "  --no-model                 Do not pass --model; use Claude default\n" +
          "  --permission-mode <mode>   Claude permission mode (default: auto)\n" +
          "  --no-permission-mode       Do not pass --permission-mode\n" +
          "  --agent <name>             Pass --agent to Claude Code\n" +
          "  --actor <id>               Durable heartbeat actor id (default: captain-claude)\n" +
          "  --title <text>             Claude session name and event title\n" +
          "  --stale-minutes <n>        Lane-status stale threshold (default: 10)\n" +
          "  --tab                      Spawn a new tab in the current WezTerm window\n" +
          "  --new-window               Spawn a new WezTerm window (default)\n" +
          "  --workspace <name>         WezTerm workspace for --new-window\n" +
          "  --dry-run                  Print command and prompt path without spawning\n" +
          "  --print-prompt             Print the generated prompt\n",
      )
      process.exit(0)
    } else if (!arg.startsWith("--")) {
      out.lanePath = arg
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }

  if (!out.actor.trim()) throw new Error("--actor requires a non-empty value")
  if (out.workspace && !out.newWindow) throw new Error("--workspace requires --new-window")
  return out
}

export function buildRecommendation(report: ReturnType<typeof buildLaneStatusReport>, lanePath: string): { action: string; command: string } {
  const dirtyCount = report.git?.dirtyFiles.length ?? 0
  if (dirtyCount > 0) {
    return {
      action: "Inspect and classify the dirty worktree before editing; preserve other agents' changes and continue only on the active lane.",
      command: "git status --short && monitor --once",
    }
  }
  if (report.assessment.state === "stop") {
    return {
      action: "Finalize the stopped lane: fill Results, conclude the experiment, record review evidence, commit docs, then advance the queue manually.",
      command: `bun scripts/agent/lane-status.ts ${lanePath} --json`,
    }
  }
  if (report.assessment.state === "blocked" || report.assessment.state === "human-needed" || report.assessment.state === "infra-failure") {
    return {
      action: "Diagnose the blocking state from monitor and lane events, then either unblock with a heartbeat/progress update or record a durable stop decision.",
      command: `bun scripts/agent/lane-status.ts ${lanePath} --json`,
    }
  }
  return {
    action: "Act as the interactive lane captain: read the lane doc, inspect monitor, then continue the smallest safe next step using subagents only for bounded support work.",
    command: "monitor --once",
  }
}

export function buildCaptainPrompt(ctx: ClaudeCaptainPromptContext): string {
  return [
    "You are the interactive Claude Code lane captain for Novel Harness.",
    "The repo-local contract artifacts are the control plane; lane-runner is retired as the default orchestrator.",
    "Do not wait for a shell supervisor to advance the loop. You own orchestration, delegation, evidence capture, finalization, and queue handoff inside this interactive session.",
    "",
    "Source of truth:",
    `- Active lane doc: ${ctx.lanePath}`,
    "- Queue: docs/sessions/lane-queue.md",
    "- Current architecture: docs/current-state.md",
    "- Pending work: docs/todo.md",
    "- Next-work process: docs/harness-next-work-process.md",
    "- Monitor command: monitor",
    "",
    "Current lane:",
    `- Lane id: ${ctx.laneId}`,
    `- Primary lane: ${ctx.primaryLane || "(missing)"}`,
    `- Objective: ${ctx.objective || "(missing)"}`,
    `- Experiment ID: ${ctx.experimentId || "(missing)"}`,
    `- Feedback signal: ${ctx.feedbackSignal || "(missing)"}`,
    `- Current outside-loop state: ${ctx.state.toUpperCase()} — ${ctx.reason}`,
    `- Recommended first action: ${ctx.recommendedAction}`,
    `- First command to run: ${ctx.recommendedCommand}`,
    "",
    "Captain contract:",
    `- Use actor id ${ctx.actor} for durable heartbeats/messages.` ,
    `- Record a heartbeat before substantial work: bun scripts/agent/lane-heartbeat.ts ${ctx.lanePath} --actor ${ctx.actor} --step "<current step>"`,
    "- Keep one primary lane. Do not mix unrelated runtime levers.",
    "- Use Claude Code subagents for bounded support work: evidence gathering, focused tests, review, docs finalization. Keep ownership visible in lane messages when delegating.",
    "- Do not rely on private chat state. Persist important progress in the lane doc, events/messages, experiments, result docs, or commits.",
    "- Follow repo-local commit policy and never push without explicit user instruction.",
    "- Before queue handoff: fill Results, conclude the Experiment ID, record independent review evidence or waiver, run docs-impact and whitespace checks, and commit the final docs/cleanup unit.",
    "- If the active lane is complete and the queue has a next lane, update the queue manually and start the next lane in this same captain session only after the current lane is finalized.",
    "",
    "First response format:",
    "- Start with `Recommended first action:` and the recommendation above.",
    "- Then give 2-4 concise status bullets from the monitor snapshot.",
    "- Then either run the first command if safe, or ask for one explicit approval if the action would edit/commit/deploy/spend money.",
    "- Do not present a broad menu unless the lane is genuinely blocked on a product decision.",
    "",
    "Current monitor snapshot:",
    "```text",
    ctx.monitorSnapshot,
    "```",
  ].join("\n")
}

export function buildClaudeArgs(args: ClaudeCaptainArgs, prompt: string, title: string): string[] {
  const out: string[] = []
  if (args.model) out.push("--model", args.model)
  if (args.permissionMode) out.push("--permission-mode", args.permissionMode)
  if (args.agent) out.push("--agent", args.agent)
  out.push("--name", title)
  out.push(prompt)
  return out
}

export function buildWezTermArgs(args: ClaudeCaptainArgs, cwd: string, prompt: string, title: string): string[] {
  const out = ["cli", "spawn"]
  if (args.newWindow) out.push("--new-window")
  if (args.workspace) out.push("--workspace", args.workspace)
  out.push("--cwd", cwd)
  out.push("--", "claude", ...buildClaudeArgs(args, prompt, title))
  return out
}

export function buildDisplayCommand(args: ClaudeCaptainArgs, cwd: string, promptPath: string, title: string): string {
  const command = ["wezterm", "cli", "spawn"]
  if (args.newWindow) command.push("--new-window")
  if (args.workspace) command.push("--workspace", args.workspace)
  command.push("--cwd", cwd, "--", "claude")
  const displayArgs = buildClaudeArgs(args, `<${promptPath} contents>`, title)
  command.push(...displayArgs)
  return command.map(part => JSON.stringify(part)).join(" ")
}

function safeStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-")
}

function captainPromptPath(lanePath: string): string {
  const dir = join("output", "agent-runs", laneIdFromPath(lanePath), "captain")
  mkdirSync(dir, { recursive: true })
  return join(dir, `claude-captain-${safeStamp()}.prompt.md`)
}

function resolveLanePath(args: ClaudeCaptainArgs): string {
  const lanePath = args.lanePath ?? findDefaultLaneDoc()
  if (!lanePath) throw new Error("no lane path supplied and no active complete lane doc found")
  if (!existsSync(lanePath)) throw new Error(`lane doc not found: ${lanePath}`)
  return lanePath
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  const lanePath = resolveLanePath(args)
  const report = buildLaneStatusReport({
    lanePath,
    staleMinutes: args.staleMinutes,
    panels: ["outside", "coordination", "process"],
  })
  const doc = readLaneDoc(lanePath)
  const monitorSnapshot = renderLaneStatus(report)
  const recommendation = buildRecommendation(report, lanePath)
  const title = args.title ?? `${doc.laneId} captain`
  const prompt = buildCaptainPrompt({
    lanePath,
    laneId: doc.laneId,
    actor: args.actor,
    objective: field(doc, "loop contract", "objective"),
    experimentId: field(doc, "loop contract", "experiment id"),
    primaryLane: field(doc, "loop contract", "primary lane"),
    feedbackSignal: field(doc, "loop contract", "feedback signal"),
    state: report.assessment.state,
    reason: report.assessment.reason,
    monitorSnapshot,
    recommendedAction: recommendation.action,
    recommendedCommand: recommendation.command,
  })
  const promptPath = captainPromptPath(lanePath)
  writeFileSync(promptPath, prompt)

  const cwd = process.cwd()
  const weztermArgs = buildWezTermArgs(args, cwd, prompt, title)
  const displayCommand = buildDisplayCommand(args, cwd, promptPath, title)

  if (args.dryRun) {
    console.log(displayCommand)
    console.log(`prompt: ${promptPath}`)
    if (args.printPrompt) console.log(`\n--- prompt ---\n${prompt}`)
    return 0
  }

  const result = spawnSync("wezterm", weztermArgs, { encoding: "utf8", maxBuffer: 1024 * 1024 })
  const paneId = result.stdout.trim()
  if (result.status !== 0 || result.error) {
    const message = result.error ? String(result.error.message || result.error) : result.stderr.trim() || `wezterm exited ${result.status}`
    appendLaneEvent(laneEventLogPath(lanePath), {
      ts: new Date().toISOString(),
      type: "claude_captain_terminal_failed",
      actor: args.actor,
      status: "infra-failure",
      message,
      command: displayCommand,
      promptPath,
    })
    console.error(`[open-claude-captain] failed: ${message}`)
    return 22
  }

  appendLaneEvent(laneEventLogPath(lanePath), {
    ts: new Date().toISOString(),
    type: "claude_captain_terminal_spawn",
    actor: args.actor,
    status: "continue",
    step: title,
    command: displayCommand,
    promptPath,
    paneId,
  })
  appendLaneEvent(laneEventLogPath(lanePath), {
    ts: new Date().toISOString(),
    type: "heartbeat",
    actor: args.actor,
    status: "continue",
    step: title,
    command: displayCommand,
    promptPath,
    paneId,
  })
  console.log(`Spawned WezTerm pane ${paneId || "(unknown)"} for ${lanePath}`)
  console.log(`Prompt written to ${promptPath}`)
  return 0
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error(`[open-claude-captain] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
