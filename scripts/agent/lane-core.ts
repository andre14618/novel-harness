#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs"
import { basename, extname, dirname, join } from "node:path"
import { spawnSync } from "node:child_process"

export type LaneRunState = "continue" | "stop" | "blocked" | "human-needed" | "infra-failure"
export type MonitorPanel = "all" | "outside" | "inside" | "evidence" | "hygiene" | "process"

export interface LaneEvent {
  ts: string
  type: string
  actor?: string
  step?: string
  status?: LaneRunState
  message?: string
  command?: string
  [key: string]: unknown
}

export interface ParsedLaneDoc {
  path: string
  laneId: string
  fields: Record<string, Record<string, string>>
}

export interface GitSnapshot {
  branch: string
  lastCommit: string
  dirtyFiles: string[]
}

export interface LaneAssessment {
  state: LaneRunState
  reason: string
  laneId: string
  eventLogPath: string
  missingRequired: string[]
  warnings: string[]
  lastEvent: LaneEvent | null
  heartbeatAgeSeconds: number | null
}

export interface LaneStatusReport {
  assessedAt: string
  lane: ParsedLaneDoc
  assessment: LaneAssessment
  git: GitSnapshot | null
  harness: HarnessSnapshot | null
  evidence: EvidenceSnapshot | null
  hygiene: HygieneSnapshot | null
  process: ProcessSnapshot | null
  panels: MonitorPanel[]
}

export interface HarnessSnapshot {
  ok: boolean
  mode: "none" | "latest" | "novel"
  summaryLines: string[]
  error?: string
}

export interface EvidenceSnapshot {
  ok: boolean
  summaryLines: string[]
  error?: string
}

export interface HygieneSnapshot {
  ok: boolean
  summaryLines: string[]
  error?: string
}

export interface ProcessSnapshot {
  ok: boolean
  summaryLines: string[]
  error?: string
}

export const REQUIRED_LOOP_FIELDS = [
  "objective",
  "starting commit",
  "experiment id",
  "budget cap",
  "primary lane",
  "causal hypothesis",
  "baseline",
  "changed runtime lever",
  "feedback signal",
  "stop gate",
  "escalation rule",
  "allowed parallel support work",
  "deepseek v4 flash concurrency plan",
  "deferred out-of-lane runtime changes",
  "evidence artifact",
]

export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ")
}

function cleanValue(value: string): string {
  return value.trim()
}

export function laneIdFromPath(lanePath: string): string {
  const base = basename(lanePath)
  const ext = extname(base)
  return (ext ? base.slice(0, -ext.length) : base).replace(/[^a-zA-Z0-9_.-]+/g, "-")
}

export function laneEventLogPath(lanePath: string): string {
  return join("output", "agent-runs", laneIdFromPath(lanePath), "events.jsonl")
}

export function parseLaneDoc(text: string, lanePath = "lane.md"): ParsedLaneDoc {
  const fields: Record<string, Record<string, string>> = {}
  let section = ""
  for (const rawLine of text.split(/\r?\n/)) {
    const sectionMatch = rawLine.match(/^##\s+(.+?)\s*$/)
    if (sectionMatch) {
      section = normalizeLabel(sectionMatch[1]!)
      fields[section] ??= {}
      continue
    }
    const fieldMatch = rawLine.match(/^\s*-\s+([^:]+):\s*(.*)$/)
    if (!fieldMatch || !section) continue
    const key = normalizeLabel(fieldMatch[1]!)
    fields[section] ??= {}
    fields[section]![key] = cleanValue(fieldMatch[2] ?? "")
  }
  return { path: lanePath, laneId: laneIdFromPath(lanePath), fields }
}

export function readLaneDoc(lanePath: string): ParsedLaneDoc {
  return parseLaneDoc(readFileSync(lanePath, "utf8"), lanePath)
}

export function field(doc: ParsedLaneDoc, section: string, key: string): string {
  return doc.fields[normalizeLabel(section)]?.[normalizeLabel(key)] ?? ""
}

export function missingRequiredLaneFields(doc: ParsedLaneDoc): string[] {
  return REQUIRED_LOOP_FIELDS
    .filter(k => field(doc, "loop contract", k).length === 0)
    .map(k => `Loop Contract: ${k}`)
}

export function isLaneContractComplete(doc: ParsedLaneDoc): boolean {
  return missingRequiredLaneFields(doc).length === 0
}

export function normalizePanels(values: string[]): MonitorPanel[] {
  if (values.length === 0) return ["all"]
  const out: MonitorPanel[] = []
  const valid = new Set<MonitorPanel>(["all", "outside", "inside", "evidence", "hygiene", "process"])
  for (const raw of values) {
    for (const item of raw.split(",")) {
      const panel = item.trim() as MonitorPanel
      if (!panel) continue
      if (!valid.has(panel)) throw new Error(`unknown monitor panel: ${panel}`)
      if (!out.includes(panel)) out.push(panel)
    }
  }
  return out.length === 0 ? ["all"] : out
}

function panelEnabled(panels: MonitorPanel[], panel: Exclude<MonitorPanel, "all">): boolean {
  return panels.includes("all") || panels.includes(panel)
}

export function readLaneEvents(eventLogPath: string): LaneEvent[] {
  if (!existsSync(eventLogPath)) return []
  const events: LaneEvent[] = []
  const raw = readFileSync(eventLogPath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as LaneEvent
      if (typeof parsed.ts === "string" && typeof parsed.type === "string") {
        events.push(parsed)
      }
    } catch {
      events.push({ ts: new Date(0).toISOString(), type: "malformed", message: line.slice(0, 200) })
    }
  }
  return events
}

export function appendLaneEvent(eventLogPath: string, event: LaneEvent): void {
  mkdirSync(dirname(eventLogPath), { recursive: true })
  appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`)
}

export function assessLane(doc: ParsedLaneDoc, events: LaneEvent[], opts: {
  now?: Date
  staleMinutes?: number
  eventLogPath?: string
} = {}): LaneAssessment {
  const now = opts.now ?? new Date()
  const staleMinutes = opts.staleMinutes ?? 10
  const eventLogPath = opts.eventLogPath ?? laneEventLogPath(doc.path)
  const missingRequired = missingRequiredLaneFields(doc)
  const warnings: string[] = []

  const stopGate = field(doc, "results", "stop gate fired")
  const outcome = field(doc, "results", "outcome")
  const lastEvent = events.length > 0 ? events[events.length - 1]! : null
  const lastHeartbeat = [...events].reverse().find(e => e.type === "heartbeat") ?? null
  const heartbeatAgeSeconds = lastHeartbeat ? Math.max(0, Math.floor((now.getTime() - Date.parse(lastHeartbeat.ts)) / 1000)) : null

  if (events.length === 0) warnings.push("no heartbeat events recorded yet")
  if (events.some(e => e.type === "malformed")) warnings.push("event log contains malformed JSONL rows")
  if (heartbeatAgeSeconds !== null && heartbeatAgeSeconds > staleMinutes * 60) {
    warnings.push(`last heartbeat is stale (${Math.floor(heartbeatAgeSeconds / 60)}m old)`)
  }

  if (stopGate.length > 0) {
    return {
      state: "stop",
      reason: `result stop gate fired: ${stopGate}${outcome ? ` (${outcome})` : ""}`,
      laneId: doc.laneId,
      eventLogPath,
      missingRequired,
      warnings,
      lastEvent,
      heartbeatAgeSeconds,
    }
  }

  if (lastEvent?.status && lastEvent.status !== "continue") {
    return {
      state: lastEvent.status,
      reason: lastEvent.message ? `${lastEvent.type}: ${lastEvent.message}` : `latest event status=${lastEvent.status}`,
      laneId: doc.laneId,
      eventLogPath,
      missingRequired,
      warnings,
      lastEvent,
      heartbeatAgeSeconds,
    }
  }

  if (missingRequired.length > 0) {
    return {
      state: "blocked",
      reason: `lane contract missing ${missingRequired.length} required field${missingRequired.length === 1 ? "" : "s"}`,
      laneId: doc.laneId,
      eventLogPath,
      missingRequired,
      warnings,
      lastEvent,
      heartbeatAgeSeconds,
    }
  }

  if (heartbeatAgeSeconds !== null && heartbeatAgeSeconds > staleMinutes * 60) {
    return {
      state: "blocked",
      reason: `latest heartbeat is stale (${Math.floor(heartbeatAgeSeconds / 60)}m old)`,
      laneId: doc.laneId,
      eventLogPath,
      missingRequired,
      warnings,
      lastEvent,
      heartbeatAgeSeconds,
    }
  }

  return {
    state: "continue",
    reason: "lane contract complete; no stop gate fired",
    laneId: doc.laneId,
    eventLogPath,
    missingRequired,
    warnings,
    lastEvent,
    heartbeatAgeSeconds,
  }
}

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.status !== 0) return ""
  return result.stdout.trim()
}

function runCommand(command: string, args: string[], timeout = 10_000): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: "utf8", timeout })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  }
}

function runBunJson(code: string, timeout = 10_000): { ok: boolean; data?: any; error?: string } {
  const result = runCommand("bun", ["-e", code], timeout)
  if (!result.ok) return { ok: false, error: result.stderr || result.stdout || "bun JSON command failed" }
  try {
    return { ok: true, data: JSON.parse(result.stdout) }
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${err}` }
  }
}

function compact(value: string, max = 90): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`
}

export function collectGitSnapshot(): GitSnapshot | null {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"])
  const lastCommit = runGit(["log", "-1", "--oneline"])
  const status = runGit(["status", "--short"])
  if (!branch && !lastCommit) return null
  return {
    branch: branch || "(unknown)",
    lastCommit: lastCommit || "(none)",
    dirtyFiles: status ? status.split("\n").filter(Boolean) : [],
  }
}

function gitAheadCount(): string {
  const result = runCommand("git", ["rev-list", "--count", "@{u}..HEAD"], 5_000)
  if (!result.ok) return "untracked-upstream"
  return result.stdout || "0"
}

export function summarizeOperatorJson(raw: unknown): string[] {
  const data = raw as any
  const novel = data?.novel
  if (!novel) return ["operator-summary returned no novel object"]
  const seed = novel.seed_json?.seed ?? novel.seed_json?.name ?? "(no seed)"
  const agentCosts = Array.isArray(data.agentCosts) ? data.agentCosts : []
  const cost = agentCosts.reduce((sum: number, row: any) => sum + Number(row.cost ?? 0), 0)
  const calls = agentCosts.reduce((sum: number, row: any) => sum + Number(row.calls ?? 0), 0)
  const failed = agentCosts.reduce((sum: number, row: any) => sum + Number(row.failed_calls ?? 0), 0)
  const exhaustions = Array.isArray(data.exhaustions) ? data.exhaustions : []
  const pendingGates = exhaustions.filter((row: any) => row.decision == null).length
  const lines = [
    `novel: ${novel.id}  seed=${seed}  phase=${novel.phase}  chapters=${novel.current_chapter}/${novel.total_chapters}`,
    `cost: $${cost.toFixed(4)}  calls=${calls}  failed=${failed}  pending_gates=${pendingGates}`,
  ]
  const latestPendingGate = [...exhaustions].reverse().find((row: any) => row.decision == null)
  if (latestPendingGate) {
    lines.push(`latest pending gate: #${latestPendingGate.id} ch${latestPendingGate.chapter} attempt ${latestPendingGate.attempt} ${latestPendingGate.kind}`)
  } else if (exhaustions.length > 0) {
    const latestResolved = exhaustions[exhaustions.length - 1]
    const status = String(latestResolved.decision ?? "resolved").toUpperCase()
    lines.push(`pending gates clear; latest resolved gate: #${latestResolved.id} ${status}`)
  }
  return lines
}

export function collectHarnessSnapshot(mode: "none" | "latest" | "novel", novelId?: string): HarnessSnapshot | null {
  if (mode === "none") return null
  const args = ["scripts/operator-summary.ts", "--json"]
  if (mode === "latest") args.push("--latest")
  else if (novelId) args.push(novelId)
  const result = spawnSync("bun", args, { encoding: "utf8", timeout: 10_000 })
  if (result.status !== 0) {
    return {
      ok: false,
      mode,
      summaryLines: [],
      error: (result.stderr || result.stdout || `operator-summary exited ${result.status}`).trim(),
    }
  }
  try {
    return { ok: true, mode, summaryLines: summarizeOperatorJson(JSON.parse(result.stdout)) }
  } catch (err) {
    return { ok: false, mode, summaryLines: [], error: `operator-summary JSON parse failed: ${err}` }
  }
}

function isoOrNone(value: unknown): string {
  if (!value) return "(none)"
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function firstOutputLine(value: string): string {
  return value.split(/\r?\n/).find(line => line.trim().length > 0)?.trim() ?? "no output"
}

export function collectEvidenceSnapshot(doc: ParsedLaneDoc): EvidenceSnapshot {
  const rawExperimentId = field(doc, "loop contract", "experiment id")
  const experimentId = /^\d+$/.test(rawExperimentId.trim()) ? Number(rawExperimentId.trim()) : null
  const result = runBunJson(`
const { dbReachable } = await import("./src/db/test-helpers")
const { default: db } = await import("./src/db/connection")
try {
  if (!(await dbReachable(1500))) {
    console.log(JSON.stringify({ reachable: false }))
    process.exit(0)
  }
  const experimentId = ${experimentId === null ? "null" : String(experimentId)}
  const experiments = experimentId === null
    ? await db\`SELECT id, experiment_type, description, conclusion, status, target, dimension, commit_hash, timestamp FROM tuning_experiments ORDER BY id DESC LIMIT 1\`
    : await db\`SELECT id, experiment_type, description, conclusion, status, target, dimension, commit_hash, timestamp FROM tuning_experiments WHERE id = \${experimentId} LIMIT 1\`
  const evals = experimentId === null
    ? await db\`SELECT id, probe_name, verdict, experiment_id, seeds_used, variant_labels, ran_at, git_commit FROM phase_eval_runs ORDER BY ran_at DESC LIMIT 3\`
    : await db\`SELECT id, probe_name, verdict, experiment_id, seeds_used, variant_labels, ran_at, git_commit FROM phase_eval_runs WHERE experiment_id = \${experimentId} ORDER BY ran_at DESC LIMIT 3\`
  const evalCountRows = experimentId === null
    ? [{ count: null }]
    : await db\`SELECT COUNT(*)::int AS count FROM phase_eval_runs WHERE experiment_id = \${experimentId}\`
  console.log(JSON.stringify({ reachable: true, experimentId, experiment: experiments[0] ?? null, evals, evalCount: evalCountRows[0]?.count ?? null }))
} catch (err) {
  console.log(JSON.stringify({ reachable: false, error: err instanceof Error ? err.message : String(err) }))
}
`, 10_000)
  if (!result.ok) return { ok: false, summaryLines: [], error: result.error }
  const data = result.data as any
  if (!data?.reachable) {
    return { ok: false, summaryLines: [], error: data?.error ?? "Postgres not reachable" }
  }

  const lines: string[] = []
  if (data.experiment) {
    const exp = data.experiment
    const status = exp.conclusion ? "concluded" : (exp.status ?? "open")
    const focus = [exp.target, exp.dimension].filter(Boolean).join("/") || "no focus"
    lines.push(`experiment: #${exp.id} ${exp.experiment_type} ${status} ${focus}`)
    lines.push(`  ${compact(String(exp.description ?? "(no description)"))}`)
    if (exp.commit_hash) lines.push(`  commit: ${String(exp.commit_hash).slice(0, 12)}`)
  } else if (experimentId !== null) {
    lines.push(`experiment: #${experimentId} not found`)
  } else {
    lines.push("experiment: lane doc has no numeric Experiment ID; showing latest eval rows")
  }

  if (data.evalCount !== null) lines.push(`phase eval rows for experiment: ${Number(data.evalCount)}`)
  const evals = Array.isArray(data.evals) ? data.evals : []
  if (evals.length === 0) {
    lines.push("latest phase eval: none")
  } else {
    for (const row of evals) {
      const seeds = Array.isArray(row.seeds_used) ? row.seeds_used.join(",") : "?"
      const variants = Array.isArray(row.variant_labels) ? row.variant_labels.join(",") : "?"
      lines.push(`phase eval #${row.id}: ${row.probe_name} ${row.verdict} ${isoOrNone(row.ran_at)}`)
      lines.push(`  seeds=${compact(seeds, 50)} variants=${compact(variants, 50)} commit=${String(row.git_commit ?? "").slice(0, 12) || "?"}`)
    }
  }
  return { ok: true, summaryLines: lines }
}

export function collectHygieneSnapshot(git: GitSnapshot | null): HygieneSnapshot {
  const lines: string[] = []
  let ok = true
  if (git) {
    lines.push(`git dirty files: ${git.dirtyFiles.length}`)
    lines.push(`git unpushed commits: ${gitAheadCount()}`)
  } else {
    ok = false
    lines.push("git: unavailable")
  }

  const dbResult = runBunJson(`
const { dbReachable } = await import("./src/db/test-helpers")
const { default: db } = await import("./src/db/connection")
try {
  if (!(await dbReachable(1500))) {
    console.log(JSON.stringify({ reachable: false }))
    process.exit(0)
  }
  const gates = await db\`
    SELECT
      COUNT(*) FILTER (WHERE decided_at IS NULL)::int AS pending_gates,
      COUNT(*) FILTER (WHERE decided_at IS NULL AND fired_at < now() - interval '24 hours')::int AS stale_gates
    FROM chapter_exhaustions
  \`
  const experiments = await db\`SELECT COUNT(*)::int AS open_experiments FROM tuning_experiments WHERE conclusion IS NULL\`
  console.log(JSON.stringify({ reachable: true, gates: gates[0] ?? null, experiments: experiments[0] ?? null }))
} catch (err) {
  console.log(JSON.stringify({ reachable: false, error: err instanceof Error ? err.message : String(err) }))
}
`, 10_000)
  if (!dbResult.ok) {
    ok = false
    lines.push(`db hygiene: unavailable (${dbResult.error})`)
  } else if (!(dbResult.data as any)?.reachable) {
    ok = false
    lines.push(`db hygiene: unavailable (${(dbResult.data as any)?.error ?? "Postgres not reachable"})`)
  } else {
    const data = dbResult.data as any
    lines.push(`pending plan-assist gates: ${Number(data.gates?.pending_gates ?? 0)} stale_24h=${Number(data.gates?.stale_gates ?? 0)}`)
    lines.push(`open experiments without conclusion: ${Number(data.experiments?.open_experiments ?? 0)}`)
  }

  const docsImpact = runCommand("bun", ["scripts/preflight-docs-impact.ts", "--strict"], 10_000)
  if (docsImpact.ok) lines.push("docs-impact preflight: pass")
  else {
    ok = false
    lines.push(`docs-impact preflight: fail (${compact(firstOutputLine(docsImpact.stderr || docsImpact.stdout), 120)})`)
  }
  return { ok, summaryLines: lines }
}

export function collectProcessSnapshot(): ProcessSnapshot {
  const lines: string[] = []
  let ok = true
  const dbResult = runBunJson(`
const { dbReachable } = await import("./src/db/test-helpers")
const { default: db } = await import("./src/db/connection")
try {
  if (!(await dbReachable(1500))) {
    console.log(JSON.stringify({ reachable: false }))
    process.exit(0)
  }
  const rows = await db\`
    SELECT
      MAX(timestamp) AS last_llm_call,
      COUNT(*) FILTER (WHERE timestamp > now() - interval '15 minutes')::int AS calls_15m,
      COUNT(*) FILTER (WHERE failed = true AND timestamp > now() - interval '15 minutes')::int AS failed_15m
    FROM llm_calls
  \`
  console.log(JSON.stringify({ reachable: true, llm: rows[0] ?? null }))
} catch (err) {
  console.log(JSON.stringify({ reachable: false, error: err instanceof Error ? err.message : String(err) }))
}
`, 10_000)
  if (!dbResult.ok) {
    ok = false
    lines.push(`db: unavailable (${dbResult.error})`)
  } else if (!(dbResult.data as any)?.reachable) {
    ok = false
    lines.push(`db: unavailable (${(dbResult.data as any)?.error ?? "Postgres not reachable"})`)
  } else {
    const llm = (dbResult.data as any).llm
    lines.push(`db: reachable; last_llm_call=${isoOrNone(llm?.last_llm_call)} calls_15m=${Number(llm?.calls_15m ?? 0)} failed_15m=${Number(llm?.failed_15m ?? 0)}`)
  }

  const local = runCommand("pgrep", ["-fl", "[b]un.*src/index"], 3_000)
  if (local.ok && local.stdout) lines.push(`local generation process: running (${compact(firstOutputLine(local.stdout), 100)})`)
  else lines.push("local generation process: not running")

  const lxc = runCommand("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=2", "novel-harness-lxc", "pgrep -fl '[b]un.*src/index' || true; systemctl is-active novel-harness-orchestrator 2>/dev/null || true"], 6_000)
  if (!lxc.ok) {
    ok = false
    lines.push(`lxc process probe: unavailable (${compact(firstOutputLine(lxc.stderr || lxc.stdout), 120)})`)
  } else {
    const out = lxc.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const orchestrator = out.at(-1) ?? "unknown"
    const generation = out.slice(0, -1)
    lines.push(`lxc generation process: ${generation.length > 0 ? compact(generation[0]!, 100) : "not running"}`)
    lines.push(`lxc orchestrator: ${orchestrator}`)
  }
  return { ok, summaryLines: lines }
}

export function buildLaneStatusReport(args: {
  lanePath: string
  staleMinutes?: number
  now?: Date
  harnessMode?: "none" | "latest" | "novel"
  novelId?: string
  panels?: MonitorPanel[]
}): LaneStatusReport {
  const lane = readLaneDoc(args.lanePath)
  const eventLogPath = laneEventLogPath(args.lanePath)
  const events = readLaneEvents(eventLogPath)
  const panels = args.panels ?? ["outside"]
  const git = panelEnabled(panels, "outside") || panelEnabled(panels, "hygiene") ? collectGitSnapshot() : null
  const harness = panelEnabled(panels, "inside") ? collectHarnessSnapshot(args.harnessMode ?? "none", args.novelId) : null
  return {
    assessedAt: (args.now ?? new Date()).toISOString(),
    lane,
    assessment: assessLane(lane, events, {
      now: args.now,
      staleMinutes: args.staleMinutes,
      eventLogPath,
    }),
    git,
    harness,
    evidence: panelEnabled(panels, "evidence") ? collectEvidenceSnapshot(lane) : null,
    hygiene: panelEnabled(panels, "hygiene") ? collectHygieneSnapshot(git) : null,
    process: panelEnabled(panels, "process") ? collectProcessSnapshot() : null,
    panels,
  }
}

export function renderLaneStatus(report: LaneStatusReport): string {
  const { lane, assessment, git, harness, evidence, hygiene, process } = report
  const lines: string[] = []
  lines.push(`Lane Dashboard  ${report.assessedAt}`)
  lines.push(`panels: ${report.panels.join(",")}`)
  lines.push(`state: ${assessment.state.toUpperCase()}  reason: ${assessment.reason}`)
  lines.push(`lane: ${lane.laneId}`)
  lines.push(`primary: ${field(lane, "loop contract", "primary lane") || "(missing)"}`)
  lines.push(`hypothesis: ${field(lane, "loop contract", "causal hypothesis") || "(missing)"}`)
  lines.push(`event log: ${assessment.eventLogPath}`)
  if (assessment.lastEvent) {
    const e = assessment.lastEvent
    lines.push(`last event: ${e.ts}  ${e.type}${e.actor ? `/${e.actor}` : ""}${e.step ? `  ${e.step}` : ""}${e.message ? `  ${e.message}` : ""}`)
  } else {
    lines.push("last event: (none)")
  }
  if (assessment.heartbeatAgeSeconds !== null) {
    lines.push(`heartbeat age: ${Math.floor(assessment.heartbeatAgeSeconds / 60)}m${assessment.heartbeatAgeSeconds % 60}s`)
  }
  if (assessment.missingRequired.length > 0) {
    lines.push("")
    lines.push("Missing required fields:")
    for (const item of assessment.missingRequired) lines.push(`  - ${item}`)
  }
  if (assessment.warnings.length > 0) {
    lines.push("")
    lines.push("Warnings:")
    for (const item of assessment.warnings) lines.push(`  - ${item}`)
  }
  if (panelEnabled(report.panels, "outside") || panelEnabled(report.panels, "hygiene")) {
    lines.push("")
    lines.push("Git:")
    if (!git) lines.push("  unavailable")
    else {
      lines.push(`  branch: ${git.branch}`)
      lines.push(`  last commit: ${git.lastCommit}`)
      lines.push(`  dirty files: ${git.dirtyFiles.length}`)
      for (const f of git.dirtyFiles.slice(0, 12)) lines.push(`    ${f}`)
      if (git.dirtyFiles.length > 12) lines.push(`    ... +${git.dirtyFiles.length - 12} more`)
    }
  }
  if (harness) {
    lines.push("")
    lines.push("Inside harness loop:")
    if (harness.ok) for (const line of harness.summaryLines) lines.push(`  ${line}`)
    else lines.push(`  unavailable: ${harness.error}`)
  }
  if (evidence) {
    lines.push("")
    lines.push("Evidence loop:")
    if (!evidence.ok && evidence.error) lines.push(`  unavailable: ${evidence.error}`)
    for (const line of evidence.summaryLines) lines.push(`  ${line}`)
  }
  if (hygiene) {
    lines.push("")
    lines.push("Repo hygiene:")
    if (!hygiene.ok && hygiene.error) lines.push(`  unavailable: ${hygiene.error}`)
    for (const line of hygiene.summaryLines) lines.push(`  ${line}`)
  }
  if (process) {
    lines.push("")
    lines.push("Process health:")
    if (!process.ok && process.error) lines.push(`  unavailable: ${process.error}`)
    for (const line of process.summaryLines) lines.push(`  ${line}`)
  }
  lines.push("")
  lines.push("Exit codes: continue=0, stop=10, blocked=20, human-needed=21, infra-failure=22")
  return lines.join("\n")
}

export function exitCodeForState(state: LaneRunState): number {
  switch (state) {
    case "continue": return 0
    case "stop": return 10
    case "blocked": return 20
    case "human-needed": return 21
    case "infra-failure": return 22
  }
}
