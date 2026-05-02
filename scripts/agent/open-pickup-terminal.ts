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

export interface PickupArgs {
  lanePath: string | null
  model: string | null
  agent: string | null
  actor: string
  title: string | null
  staleMinutes: number
  newWindow: boolean
  workspace: string | null
  onlyIfBlocked: boolean
  dryRun: boolean
  printPrompt: boolean
}

export interface PickupPromptContext {
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

export function parseArgs(argv: string[]): PickupArgs {
  const out: PickupArgs = {
    lanePath: null,
    model: "openai/gpt-5.5",
    agent: null,
    actor: "pickup-opencode",
    title: null,
    staleMinutes: 10,
    newWindow: true,
    workspace: null,
    onlyIfBlocked: false,
    dryRun: false,
    printPrompt: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--model") out.model = valueAfter(argv, i++, arg)
    else if (arg === "--no-model") out.model = null
    else if (arg === "--agent") out.agent = valueAfter(argv, i++, arg)
    else if (arg === "--actor") out.actor = valueAfter(argv, i++, arg)
    else if (arg === "--title") out.title = valueAfter(argv, i++, arg)
    else if (arg === "--stale-minutes") out.staleMinutes = positiveNumber(valueAfter(argv, i++, arg), arg)
    else if (arg === "--tab") out.newWindow = false
    else if (arg === "--new-window") out.newWindow = true
    else if (arg === "--workspace") out.workspace = valueAfter(argv, i++, arg)
    else if (arg === "--only-if-blocked") out.onlyIfBlocked = true
    else if (arg === "--dry-run") out.dryRun = true
    else if (arg === "--print-prompt") out.printPrompt = true
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun scripts/agent/open-pickup-terminal.ts [docs/sessions/lane.md] [options]\n\n" +
          "Opens a new WezTerm terminal running interactive OpenCode with a lane pickup prompt.\n\n" +
          "Options:\n" +
          "  --model <provider/model>  OpenCode model (default: openai/gpt-5.5)\n" +
          "  --no-model                Do not pass a model; use OpenCode default\n" +
          "  --agent <name>            Pass --agent to OpenCode\n" +
          "  --actor <id>              Durable heartbeat actor id (default: pickup-opencode)\n" +
          "  --title <text>            Pickup title used in prompt and event metadata\n" +
          "  --stale-minutes <n>       Lane-status stale threshold (default: 10)\n" +
          "  --tab                     Spawn a new tab in the current WezTerm window\n" +
          "  --new-window              Spawn a new WezTerm window (default)\n" +
          "  --workspace <name>        WezTerm workspace for --new-window\n" +
          "  --only-if-blocked         Refuse to spawn unless lane state is blocked/human-needed\n" +
          "  --dry-run                 Print command and prompt path without spawning\n" +
          "  --print-prompt            Print the generated prompt\n",
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

export function buildPickupPrompt(ctx: PickupPromptContext): string {
  return [
    "You are an interactive OpenCode pickup agent for the Novel Harness repo.",
    "The user opened this terminal because the autonomous lane appears stopped or stale and wants to be brought up to speed.",
    "Do not begin implementation or make edits until the user explicitly asks you to continue work.",
    "Your first response must be actionable, not a broad status dump or open-ended menu.",
    "",
    "Source of truth:",
    `- Lane doc: ${ctx.lanePath}`,
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
    `- Recommended next action: ${ctx.recommendedAction}`,
    `- Command to offer/run if approved: ${ctx.recommendedCommand}`,
    "",
    "Operational rules:",
    `- Use actor id ${ctx.actor} in lane-heartbeat and lane-message commands if you record durable state.`,
    `- Heartbeat command: bun scripts/agent/lane-heartbeat.ts ${ctx.lanePath} --actor ${ctx.actor} --step "<current step>"`,
    "- Use lane-message for handoffs or questions; do not rely on terminal chat as durable state.",
    "- Never push. Do not commit unless the user explicitly asks in this terminal.",
    "- If the only issue is a stale heartbeat, explain that this is a supervisor/liveness stop, not evidence that runtime code failed.",
    "",
    "First response format:",
    "- Start with `Recommended next action:` and the recommendation above.",
    "- Then give 2-4 short context bullets: stop reason, active lane, worktree/process health, and queued follow-ups if relevant.",
    "- Then provide exactly one command as `Ready command:`.",
    "- End with a confirmation prompt for that single action, not a menu of unrelated options.",
    "- Do not ask `what do you want next?`; ask whether to run the recommended command or wait.",
    "",
    "Current monitor snapshot:",
    "```text",
    ctx.monitorSnapshot,
    "```",
  ].join("\n")
}

export function buildRecommendation(report: ReturnType<typeof buildLaneStatusReport>, lanePath: string): { action: string; command: string } {
  const dirtyCount = report.git?.dirtyFiles.length ?? 0
  if (dirtyCount > 0) {
    return {
      action: "Do not launch a new captain yet; first inspect the dirty worktree and preserve any active lane-worker changes.",
      command: "git status --short && monitor --once",
    }
  }
  if (report.assessment.state === "blocked" && report.assessment.reason.includes("stale")) {
    return {
      action: "Start an interactive Claude Code captain; the stale heartbeat is a supervisor stop, not a runtime failure.",
      command: `bun scripts/agent/open-claude-captain.ts ${lanePath}`,
    }
  }
  if (report.assessment.state === "continue") {
    return {
      action: "Use the interactive Claude Code captain as the control plane; inspect monitor before changing or launching work.",
      command: `bun scripts/agent/open-claude-captain.ts ${lanePath}`,
    }
  }
  return {
    action: "Inspect the current lane state before running or editing anything.",
    command: `bun scripts/agent/lane-status.ts ${lanePath} --json`,
  }
}

export function buildWezTermArgs(args: PickupArgs, cwd: string, prompt: string): string[] {
  const out = ["cli", "spawn"]
  if (args.newWindow) out.push("--new-window")
  if (args.workspace) out.push("--workspace", args.workspace)
  out.push("--cwd", cwd)
  out.push("--", "opencode", ".")
  if (args.model) out.push("--model", args.model)
  if (args.agent) out.push("--agent", args.agent)
  out.push("--prompt", prompt)
  return out
}

export function buildDisplayCommand(args: PickupArgs, cwd: string, promptPath: string): string {
  const command = ["wezterm", "cli", "spawn"]
  if (args.newWindow) command.push("--new-window")
  if (args.workspace) command.push("--workspace", args.workspace)
  command.push("--cwd", cwd, "--", "opencode", ".")
  if (args.model) command.push("--model", args.model)
  if (args.agent) command.push("--agent", args.agent)
  command.push("--prompt", `<${promptPath} contents>`)
  return command.map(part => JSON.stringify(part)).join(" ")
}

function safeStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-")
}

function pickupPromptPath(lanePath: string): string {
  const dir = join("output", "agent-runs", laneIdFromPath(lanePath), "pickup")
  mkdirSync(dir, { recursive: true })
  return join(dir, `pickup-${safeStamp()}.prompt.md`)
}

function resolveLanePath(args: PickupArgs): string {
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
  const state = report.assessment.state
  if (args.onlyIfBlocked && state !== "blocked" && state !== "human-needed") {
    console.error(`[open-pickup-terminal] lane is ${state}, not blocked/human-needed; refusing due to --only-if-blocked`)
    return 10
  }

  const doc = readLaneDoc(lanePath)
  const monitorSnapshot = renderLaneStatus(report)
  const recommendation = buildRecommendation(report, lanePath)
  const prompt = buildPickupPrompt({
    lanePath,
    laneId: doc.laneId,
    actor: args.actor,
    objective: field(doc, "loop contract", "objective"),
    experimentId: field(doc, "loop contract", "experiment id"),
    primaryLane: field(doc, "loop contract", "primary lane"),
    feedbackSignal: field(doc, "loop contract", "feedback signal"),
    state,
    reason: report.assessment.reason,
    monitorSnapshot,
    recommendedAction: recommendation.action,
    recommendedCommand: recommendation.command,
  })
  const promptPath = pickupPromptPath(lanePath)
  writeFileSync(promptPath, prompt)

  const cwd = process.cwd()
  const weztermArgs = buildWezTermArgs(args, cwd, prompt)
  const displayCommand = buildDisplayCommand(args, cwd, promptPath)

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
      type: "pickup_terminal_failed",
      actor: args.actor,
      status: "infra-failure",
      message,
      command: displayCommand,
      promptPath,
    })
    console.error(`[open-pickup-terminal] failed: ${message}`)
    return 22
  }

  appendLaneEvent(laneEventLogPath(lanePath), {
    ts: new Date().toISOString(),
    type: "pickup_terminal_spawn",
    actor: args.actor,
    status: "continue",
    step: args.title ?? "spawned interactive OpenCode pickup terminal",
    command: displayCommand,
    promptPath,
    paneId,
  })
  appendLaneEvent(laneEventLogPath(lanePath), {
    ts: new Date().toISOString(),
    type: "heartbeat",
    actor: args.actor,
    status: "continue",
    step: args.title ?? "spawned interactive OpenCode pickup terminal",
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
    console.error(`[open-pickup-terminal] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
