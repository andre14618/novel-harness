#!/usr/bin/env bun
import {
  appendLaneEvent,
  laneEventLogPath,
  type LaneEvent,
  type LaneRunState,
} from "./lane-core"

interface Args {
  lanePath: string | null
  actor: string
  type: string
  step: string
  status: LaneRunState
  message: string
  command: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    lanePath: null,
    actor: "agent",
    type: "heartbeat",
    step: "",
    status: "continue",
    message: "",
    command: "",
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--actor") out.actor = argv[++i] ?? out.actor
    else if (a === "--type") out.type = argv[++i] ?? out.type
    else if (a === "--step") out.step = argv[++i] ?? out.step
    else if (a === "--status") {
      const value = argv[++i] as LaneRunState | undefined
      if (!value || !["continue", "stop", "blocked", "human-needed", "infra-failure"].includes(value)) {
        throw new Error("--status must be one of continue|stop|blocked|human-needed|infra-failure")
      }
      out.status = value
    }
    else if (a === "--message") out.message = argv[++i] ?? out.message
    else if (a === "--command") out.command = argv[++i] ?? out.command
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/agent/lane-heartbeat.ts <docs/sessions/lane.md> [options]\n\n" +
          "Options:\n" +
          "  --actor <name>        Actor writing the event (opencode, claude, supervisor)\n" +
          "  --type <type>         Event type (default: heartbeat)\n" +
          "  --step <text>         Current step\n" +
          "  --status <state>      continue|stop|blocked|human-needed|infra-failure\n" +
          "  --message <text>      Event detail\n" +
          "  --command <text>      Command being run or next safe command\n",
      )
      process.exit(0)
    } else if (!a.startsWith("--")) {
      out.lanePath = a
    }
  }
  if (!out.lanePath) throw new Error("lane-heartbeat requires a lane session doc path")
  return out
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  const event: LaneEvent = {
    ts: new Date().toISOString(),
    type: args.type,
    actor: args.actor,
    status: args.status,
  }
  if (args.step) event.step = args.step
  if (args.message) event.message = args.message
  if (args.command) event.command = args.command
  const path = laneEventLogPath(args.lanePath!)
  appendLaneEvent(path, event)
  console.log(`[lane-heartbeat] wrote ${args.type} to ${path}`)
  return 0
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error(`[lane-heartbeat] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
