#!/usr/bin/env bun
/**
 * Resolve stale plan-assist gates without deleting evidence.
 *
 * Default mode is dry-run. `--apply` marks selected pending rows as
 * decision='orphaned' with decision_details.reason. Resolved rows no longer
 * appear in live monitoring (`decision IS NULL`) but remain queryable as
 * historical evidence.
 */

import { parseArgs as nodeParseArgs } from "node:util"
import db from "../../src/db/connection"
import { dbReachable } from "../../src/db/test-helpers"
import { markExhaustionOrphaned } from "../../src/db/chapter-exhaustions"

export interface ResolveArgs {
  apply: boolean
  json: boolean
  olderThanHours: number
  ids: number[]
  novelId: string | null
  includeRecent: boolean
  reason: string
}

export interface PendingGateCandidate {
  id: number
  novel_id: string
  chapter: number
  attempt: number
  kind: string
  fired_at: Date
  novel_phase: string | null
  novel_updated_at: Date | null
  current_chapter: number | null
  total_chapters: number | null
  seed: string | null
  seed_name: string | null
  llm_calls: number
  last_llm_call: Date | null
}

export interface CandidateDecision {
  candidate: PendingGateCandidate
  action: "resolve" | "skip"
  reason: string
  ageHours: number
  idleHours: number | null
}

function parseIdList(value: string): number[] {
  return value
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const n = Number(s)
      if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid gate id: ${s}`)
      return n
    })
}

export function parseArgs(argv: string[]): ResolveArgs {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      apply: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "older-than-hours": { type: "string", default: "24" },
      ids: { type: "string" },
      novel: { type: "string" },
      "include-recent": { type: "boolean", default: false },
      reason: { type: "string", default: "stale pending plan-assist gate resolved for monitoring hygiene; row preserved as orphaned evidence" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  })

  if (values.help) {
    console.log(
      "Usage: bun scripts/agent/resolve-stale-gates.ts [options]\n\n" +
        "Dry-run by default. Use --apply to mark selected gates orphaned.\n\n" +
        "Options:\n" +
        "  --older-than-hours <n>  Select pending gates older than n hours (default: 24)\n" +
        "  --ids <1,2,3>          Select exact gate ids, regardless of age\n" +
        "  --novel <id>           Restrict to one novel id\n" +
        "  --include-recent       With --novel, include recent gates below threshold\n" +
        "  --reason <text>        Reason stored in decision_details.reason\n" +
        "  --apply                Apply updates (otherwise dry-run)\n" +
        "  --json                 Print JSON\n",
    )
    process.exit(0)
  }

  const olderThanHours = Number(values["older-than-hours"])
  if (!Number.isFinite(olderThanHours) || olderThanHours < 0) {
    throw new Error("--older-than-hours must be a non-negative number")
  }

  return {
    apply: Boolean(values.apply),
    json: Boolean(values.json),
    olderThanHours,
    ids: values.ids ? parseIdList(values.ids) : [],
    novelId: values.novel ?? null,
    includeRecent: Boolean(values["include-recent"]),
    reason: values.reason ?? "stale pending plan-assist gate resolved for monitoring hygiene; row preserved as orphaned evidence",
  }
}

function hoursBetween(now: Date, then: Date | null): number | null {
  if (then === null) return null
  return (now.getTime() - then.getTime()) / 3_600_000
}

export function decideCandidate(candidate: PendingGateCandidate, args: ResolveArgs, now = new Date()): CandidateDecision {
  const firedAt = new Date(candidate.fired_at)
  const ageHours = hoursBetween(now, firedAt) ?? 0
  const lastActivity = candidate.last_llm_call ? new Date(candidate.last_llm_call) : (candidate.novel_updated_at ? new Date(candidate.novel_updated_at) : null)
  const idleHours = hoursBetween(now, lastActivity)

  if (args.ids.includes(candidate.id)) {
    return { candidate, action: "resolve", reason: "explicit --ids selection", ageHours, idleHours }
  }

  if (candidate.novel_phase === "complete" || candidate.novel_phase === "failed" || candidate.novel_phase === "aborted") {
    return { candidate, action: "resolve", reason: `novel phase is ${candidate.novel_phase}`, ageHours, idleHours }
  }

  if (args.novelId && args.includeRecent) {
    return { candidate, action: "resolve", reason: "explicit --novel with --include-recent", ageHours, idleHours }
  }

  if (ageHours >= args.olderThanHours) {
    return { candidate, action: "resolve", reason: `pending for ${Math.floor(ageHours)}h (threshold ${args.olderThanHours}h)`, ageHours, idleHours }
  }

  return { candidate, action: "skip", reason: `recent pending gate (${Math.floor(ageHours * 60)}m old < ${args.olderThanHours}h threshold)`, ageHours, idleHours }
}

async function fetchCandidates(args: ResolveArgs): Promise<PendingGateCandidate[]> {
  const rows = await db<PendingGateCandidate[]>`
    SELECT e.id, e.novel_id, e.chapter, e.attempt, e.kind, e.fired_at,
           n.phase AS novel_phase, n.updated_at AS novel_updated_at,
           n.current_chapter, n.total_chapters,
           n.seed_json->>'seed' AS seed,
           n.seed_json->>'name' AS seed_name,
           COUNT(lc.id)::int AS llm_calls,
           MAX(lc.timestamp) AS last_llm_call
    FROM chapter_exhaustions e
    LEFT JOIN novels n ON n.id = e.novel_id
    LEFT JOIN llm_calls lc ON lc.novel_id = e.novel_id
    WHERE e.decided_at IS NULL
    GROUP BY e.id, n.id
    ORDER BY e.fired_at
  `
  return rows.filter(row => {
    if (args.ids.length > 0 && !args.ids.includes(row.id)) return false
    if (args.novelId && row.novel_id !== args.novelId) return false
    return true
  })
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.floor(hours * 60)}m`
  if (hours < 24) return `${Math.floor(hours)}h`
  const days = Math.floor(hours / 24)
  return `${days}d${Math.floor(hours % 24)}h`
}

function printPlan(decisions: CandidateDecision[], appliedIds: number[], args: ResolveArgs): void {
  const resolve = decisions.filter(d => d.action === "resolve")
  const skipped = decisions.filter(d => d.action === "skip")
  console.log(`${args.apply ? "Applied" : "Dry-run"}: ${resolve.length} gate(s) selected for orphan resolution, ${skipped.length} skipped.`)
  if (!args.apply) console.log("Pass --apply to mark selected rows decision='orphaned'. No rows were changed.")
  console.log("  id    novel_id              ch:att  kind                    age    idle   action   reason")
  for (const d of decisions) {
    const c = d.candidate
    const id = String(c.id).padEnd(5)
    const novel = c.novel_id.slice(0, 20).padEnd(20)
    const ch = `c${c.chapter}:a${c.attempt}`.padEnd(7)
    const kind = c.kind.padEnd(22)
    const age = formatAge(d.ageHours).padEnd(6)
    const idle = d.idleHours === null ? "?".padEnd(6) : formatAge(d.idleHours).padEnd(6)
    const action = (args.apply && appliedIds.includes(c.id) ? "ORPHANED" : d.action.toUpperCase()).padEnd(8)
    console.log(`  ${id} ${novel}  ${ch}  ${kind}  ${age} ${idle} ${action} ${d.reason}`)
  }
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  if (!(await dbReachable())) {
    console.error("[resolve-stale-gates] error: Postgres not reachable. Set DATABASE_URL or ORCHESTRATOR_DB_URL to a live DB.")
    return 2
  }
  const candidates = await fetchCandidates(args)
  const decisions = candidates.map(c => decideCandidate(c, args))
  const selected = decisions.filter(d => d.action === "resolve")
  const appliedIds: number[] = []

  if (args.apply) {
    for (const d of selected) {
      const reason = `${args.reason}; gate_id=${d.candidate.id}; fired_at=${new Date(d.candidate.fired_at).toISOString()}; selection=${d.reason}`
      if (await markExhaustionOrphaned(d.candidate.id, reason)) appliedIds.push(d.candidate.id)
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ apply: args.apply, selected: selected.length, appliedIds, decisions }, null, 2))
  } else {
    printPlan(decisions, appliedIds, args)
  }
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      console.error(`[resolve-stale-gates] fatal: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    })
}
