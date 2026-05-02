#!/usr/bin/env bun
import {
  appendLaneMessage,
  laneIdFromPath,
  laneMessageLogPath,
  readLaneMessages,
  reduceLaneMessages,
  summarizeLaneMessages,
  type LaneMessage,
  type LaneMessageKind,
  type LaneMessageStatus,
} from "./lane-core"

type Command = "send" | "claim" | "resolve" | "cancel" | "list"

interface Args {
  command: Command | null
  lanePath: string | null
  id: string | null
  actor: string
  to: string
  kind: LaneMessageKind
  status: LaneMessageStatus | null
  subject: string
  body: string
  result: string
  reason: string
  refs: string[]
  parentId: string | null
  leaseMinutes: number
  json: boolean
  openOnly: boolean
  all: boolean
}

const KINDS = new Set<LaneMessageKind>(["request", "claim", "status", "result", "handoff", "question", "answer"])
const STATUSES = new Set<LaneMessageStatus>(["open", "claimed", "resolved", "cancelled"])

function usage(): string {
  return [
    "Usage: bun scripts/agent/lane-message.ts <command> <docs/sessions/lane.md> [message-id] [options]",
    "",
    "Commands:",
    "  send       Send a message, request, question, status, result, or handoff",
    "  claim      Claim an open message with a lease",
    "  resolve    Resolve a message with a result",
    "  cancel     Cancel a message with a reason",
    "  list       List active messages by default",
    "",
    "Options:",
    "  --actor <name>          Sender/updater (default: agent)",
    "  --to <name>             Target actor/role (default: any)",
    "  --kind <kind>           request|claim|status|result|handoff|question|answer",
    "  --status <status>       open|claimed|resolved|cancelled (send only override)",
    "  --subject <text>        Short message subject",
    "  --body <text>           Message body",
    "  --result <text>         Resolve result",
    "  --reason <text>         Cancel reason",
    "  --ref <value>           Evidence/log ref; repeatable",
    "  --parent <msg-id>       Parent message id",
    "  --lease-minutes <n>     Claim lease length (default: 30)",
    "  --open                  List open/claimed messages (default for list)",
    "  --all                   List all messages",
    "  --json                  Print JSON",
  ].join("\n")
}

function parsePositiveNumber(raw: string | undefined, label: string): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`)
  return value
}

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    command: null,
    lanePath: null,
    id: null,
    actor: "agent",
    to: "any",
    kind: "request",
    status: null,
    subject: "",
    body: "",
    result: "",
    reason: "",
    refs: [],
    parentId: null,
    leaseMinutes: 30,
    json: false,
    openOnly: true,
    all: false,
  }
  const command = argv[0]
  if (!command || command === "--help" || command === "-h") {
    console.log(usage())
    process.exit(0)
  }
  if (!(["send", "claim", "resolve", "cancel", "list"] as string[]).includes(command)) {
    throw new Error(`unknown command: ${command}`)
  }
  out.command = command as Command

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--actor" || a === "--from") out.actor = argv[++i] ?? out.actor
    else if (a === "--to") out.to = argv[++i] ?? out.to
    else if (a === "--kind") {
      const value = argv[++i] as LaneMessageKind | undefined
      if (!value || !KINDS.has(value)) throw new Error("--kind must be one of request|claim|status|result|handoff|question|answer")
      out.kind = value
    }
    else if (a === "--status") {
      const value = argv[++i] as LaneMessageStatus | undefined
      if (!value || !STATUSES.has(value)) throw new Error("--status must be one of open|claimed|resolved|cancelled")
      out.status = value
    }
    else if (a === "--subject") out.subject = argv[++i] ?? out.subject
    else if (a === "--body") out.body = argv[++i] ?? out.body
    else if (a === "--result") out.result = argv[++i] ?? out.result
    else if (a === "--reason") out.reason = argv[++i] ?? out.reason
    else if (a === "--ref") out.refs.push(argv[++i] ?? "")
    else if (a === "--parent") out.parentId = argv[++i] ?? out.parentId
    else if (a === "--lease-minutes") out.leaseMinutes = parsePositiveNumber(argv[++i], "--lease-minutes")
    else if (a === "--json") out.json = true
    else if (a === "--open") out.openOnly = true
    else if (a === "--all") {
      out.all = true
      out.openOnly = false
    }
    else if (a === "--help" || a === "-h") {
      console.log(usage())
      process.exit(0)
    } else if (!a.startsWith("--")) {
      if (!out.lanePath) out.lanePath = a
      else if (!out.id) out.id = a
      else throw new Error(`unexpected positional argument: ${a}`)
    } else {
      throw new Error(`unknown option: ${a}`)
    }
  }

  if (!out.lanePath) throw new Error("lane-message requires a lane session doc path")
  if (["claim", "resolve", "cancel"].includes(out.command) && !out.id) throw new Error(`${out.command} requires a message id`)
  return out
}

function defaultStatusForKind(kind: LaneMessageKind): LaneMessageStatus {
  return kind === "request" || kind === "question" || kind === "handoff" ? "open" : "resolved"
}

function makeMessageId(date = new Date()): string {
  return `msg_${date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`
}

function refsFor(args: Args, existing?: LaneMessage): string[] | undefined {
  const refs = args.refs.map(ref => ref.trim()).filter(Boolean)
  if (refs.length === 0) return existing?.refs
  const merged = [...(existing?.refs ?? []), ...refs]
  return [...new Set(merged)]
}

function loadMessages(lanePath: string): { path: string; reduced: LaneMessage[] } {
  const path = laneMessageLogPath(lanePath)
  return { path, reduced: reduceLaneMessages(readLaneMessages(path)) }
}

function findMessage(lanePath: string, id: string): { path: string; message: LaneMessage } {
  const { path, reduced } = loadMessages(lanePath)
  const message = reduced.find(row => row.id === id)
  if (!message) throw new Error(`message not found: ${id}`)
  return { path, message }
}

function sendMessage(args: Args, now = new Date()): LaneMessage {
  const subject = args.subject.trim()
  if (!subject) throw new Error("send requires --subject")
  const message: LaneMessage = {
    id: makeMessageId(now),
    ts: now.toISOString(),
    lane: laneIdFromPath(args.lanePath!),
    from: args.actor,
    to: args.to,
    kind: args.kind,
    status: args.status ?? defaultStatusForKind(args.kind),
    subject,
    action: "send",
  }
  if (args.body) message.body = args.body
  if (args.parentId) message.parentId = args.parentId
  if (args.refs.length > 0) message.refs = refsFor(args)
  const path = laneMessageLogPath(args.lanePath!)
  appendLaneMessage(path, message)
  return message
}

function claimMessage(args: Args, now = new Date()): LaneMessage {
  const { path, message } = findMessage(args.lanePath!, args.id!)
  if (message.status === "resolved" || message.status === "cancelled") throw new Error(`cannot claim ${message.status} message: ${message.id}`)
  const update: LaneMessage = {
    ...message,
    ts: now.toISOString(),
    status: "claimed",
    action: "claim",
    updatedBy: args.actor,
    claimBy: args.actor,
    leaseUntil: new Date(now.getTime() + args.leaseMinutes * 60_000).toISOString(),
    refs: refsFor(args, message),
  }
  if (args.body) update.body = args.body
  appendLaneMessage(path, update)
  return update
}

function resolveMessage(args: Args, now = new Date()): LaneMessage {
  const { path, message } = findMessage(args.lanePath!, args.id!)
  if (message.status === "cancelled") throw new Error(`cannot resolve cancelled message: ${message.id}`)
  const result = args.result || args.body
  if (!result.trim()) throw new Error("resolve requires --result or --body")
  const update: LaneMessage = {
    ...message,
    ts: now.toISOString(),
    status: "resolved",
    action: "resolve",
    updatedBy: args.actor,
    resolvedBy: args.actor,
    result,
    refs: refsFor(args, message),
  }
  appendLaneMessage(path, update)
  return update
}

function cancelMessage(args: Args, now = new Date()): LaneMessage {
  const { path, message } = findMessage(args.lanePath!, args.id!)
  const reason = args.reason || args.body || "cancelled"
  const update: LaneMessage = {
    ...message,
    ts: now.toISOString(),
    status: "cancelled",
    action: "cancel",
    updatedBy: args.actor,
    result: reason,
    refs: refsFor(args, message),
  }
  appendLaneMessage(path, update)
  return update
}

function listMessages(args: Args): LaneMessage[] {
  const { reduced } = loadMessages(args.lanePath!)
  const filtered = args.all ? reduced : reduced.filter(message => message.status === "open" || message.status === "claimed")
  return args.to === "any" ? filtered : filtered.filter(message => message.to === args.to || message.claimBy === args.to)
}

function printMessage(prefix: string, lanePath: string, message: LaneMessage, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(message, null, 2))
    return
  }
  console.log(`[lane-message] ${prefix} ${message.id} ${message.kind}/${message.status} to=${message.to} path=${laneMessageLogPath(lanePath)}`)
}

function main(argv: string[]): number {
  const args = parseArgs(argv)
  if (args.command === "send") {
    printMessage("sent", args.lanePath!, sendMessage(args), args.json)
    return 0
  }
  if (args.command === "claim") {
    printMessage("claimed", args.lanePath!, claimMessage(args), args.json)
    return 0
  }
  if (args.command === "resolve") {
    printMessage("resolved", args.lanePath!, resolveMessage(args), args.json)
    return 0
  }
  if (args.command === "cancel") {
    printMessage("cancelled", args.lanePath!, cancelMessage(args), args.json)
    return 0
  }
  if (args.command === "list") {
    const path = laneMessageLogPath(args.lanePath!)
    const messages = listMessages(args)
    if (args.json) console.log(JSON.stringify(messages, null, 2))
    else console.log(summarizeLaneMessages(messages, path).join("\n"))
    return 0
  }
  throw new Error(`unhandled command: ${args.command}`)
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (err) {
    console.error(`[lane-message] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
