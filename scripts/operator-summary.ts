#!/usr/bin/env bun
/**
 * Operator summary for a novel run.
 *
 * Prints a single-screen overview of an in-progress or completed novel
 * with the data points an operator needs to decide "is this run healthy,
 * stuck, or failed?" without writing manual SQL.
 *
 * SECTIONS
 *
 *   1. Novel header           — id, seed name, phase, current/total chapters, age
 *   2. Cost                   — total + per-agent breakdown (sorted by spend)
 *   3. AND-gate matrix        — halluc-ungrounded NER+LLM decision counts
 *   4. Two-stage adherence    — stage 1 vs stage 2 call counts
 *   5. Plan-assist gates      — count + per-gate decision summary
 *   6. Failed LLM calls       — count + last error
 *   7. Retries / attempts     — distribution per agent
 *
 * USAGE
 *
 *   bun scripts/operator-summary.ts <novel-id>
 *   bun scripts/operator-summary.ts --latest          # newest novel
 *   bun scripts/operator-summary.ts --json <novel-id> # machine-readable
 *
 * Designed per `docs/todo.md` §12 "Build an operator summary script for a
 * novel run." Closes that bullet.
 *
 * NOTE on DB reachability: this script requires a live Postgres
 * connection (DATABASE_URL or ORCHESTRATOR_DB_URL). If neither is set or
 * the listener is absent, prints a clear error and exits 2.
 */

import { dbReachable } from "../src/db/test-helpers"
import db from "../src/db/connection"

// ── Types (DB rows) ───────────────────────────────────────────────────────

interface NovelRow {
  id: string
  phase: string
  seed_json: { name?: string; seed?: string; genre?: string } | null
  current_chapter: number
  total_chapters: number
  created_at: Date
  updated_at: Date
}

interface AgentCostRow {
  agent: string
  calls: number
  cost: number
  failed_calls: number
  retried_calls: number
}

interface AndGateRow {
  decision: string
  count: number
}

interface ExhaustionRow {
  id: number
  chapter: number
  attempt: number
  kind: string
  decision: string | null
  unresolved_deviations: unknown
}

interface FailedCallRow {
  agent: string
  error_text: string | null
  count: number
}

// ── Queries ───────────────────────────────────────────────────────────────

async function fetchNovel(novelId: string): Promise<NovelRow | null> {
  const rows = await db<NovelRow[]>`
    SELECT id, phase, seed_json, current_chapter, total_chapters, created_at, updated_at
    FROM novels WHERE id = ${novelId}
  `
  return rows[0] ?? null
}

async function fetchLatestNovel(): Promise<NovelRow | null> {
  const rows = await db<NovelRow[]>`
    SELECT id, phase, seed_json, current_chapter, total_chapters, created_at, updated_at
    FROM novels ORDER BY created_at DESC LIMIT 1
  `
  return rows[0] ?? null
}

async function fetchAgentCosts(novelId: string): Promise<AgentCostRow[]> {
  const rows = await db<AgentCostRow[]>`
    SELECT
      agent,
      COUNT(*)::int AS calls,
      COALESCE(SUM(cost), 0)::float AS cost,
      SUM(CASE WHEN failed THEN 1 ELSE 0 END)::int AS failed_calls,
      SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END)::int AS retried_calls
    FROM llm_calls
    WHERE novel_id = ${novelId}
    GROUP BY agent
    ORDER BY cost DESC NULLS LAST, calls DESC
  `
  return rows
}

async function fetchAndGate(novelId: string): Promise<AndGateRow[]> {
  const rows = await db<AndGateRow[]>`
    SELECT
      ner_prepass_json->>'andGateDecision' AS decision,
      COUNT(*)::int AS count
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND ner_prepass_json IS NOT NULL
      AND ner_prepass_json ? 'andGateDecision'
    GROUP BY decision
    ORDER BY count DESC
  `
  return rows
}

async function fetchTwoStageAdherence(novelId: string): Promise<{ stage1: number; stage2: number }> {
  const rows = await db<{ agent: string; n: number }[]>`
    SELECT agent, COUNT(*)::int AS n
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent IN ('adherence-events', 'adherence-events-detailed')
    GROUP BY agent
  `
  const stage1 = rows.find(r => r.agent === "adherence-events")?.n ?? 0
  const stage2 = rows.find(r => r.agent === "adherence-events-detailed")?.n ?? 0
  return { stage1, stage2 }
}

async function fetchExhaustions(novelId: string): Promise<ExhaustionRow[]> {
  const rows = await db<ExhaustionRow[]>`
    SELECT id, chapter, attempt, kind, decision, unresolved_deviations
    FROM chapter_exhaustions
    WHERE novel_id = ${novelId}
    ORDER BY chapter, attempt
  `
  return rows
}

async function fetchFailedCalls(novelId: string): Promise<FailedCallRow[]> {
  const rows = await db<FailedCallRow[]>`
    SELECT agent, error_text, COUNT(*)::int AS count
    FROM llm_calls
    WHERE novel_id = ${novelId} AND failed = TRUE
    GROUP BY agent, error_text
    ORDER BY count DESC
  `
  return rows
}

// ── Formatting helpers ────────────────────────────────────────────────────

function formatMoney(n: number): string {
  return `$${n.toFixed(4)}`
}

function formatAge(then: Date): string {
  const ms = Date.now() - then.getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h${min % 60}m ago`
  const days = Math.floor(hr / 24)
  return `${days}d${hr % 24}h ago`
}

function formatPct(n: number, total: number): string {
  if (total === 0) return "—"
  return `${Math.round((n / total) * 100)}%`
}

// ── Sections ──────────────────────────────────────────────────────────────

function printHeader(novel: NovelRow): void {
  const seed = novel.seed_json?.seed ?? novel.seed_json?.name ?? "(no seed)"
  console.log(`\n┌─ Novel ${novel.id}`)
  console.log(`│  seed:     ${seed}`)
  console.log(`│  phase:    ${novel.phase}`)
  console.log(`│  chapters: ${novel.current_chapter}/${novel.total_chapters}`)
  console.log(`│  created:  ${formatAge(novel.created_at)}  (${novel.created_at.toISOString()})`)
  console.log(`│  updated:  ${formatAge(novel.updated_at)}`)
  console.log(`└─`)
}

function printCost(agents: AgentCostRow[]): void {
  if (agents.length === 0) {
    console.log("\nCost: no LLM calls recorded yet.")
    return
  }
  const totalCost = agents.reduce((s, a) => s + Number(a.cost), 0)
  const totalCalls = agents.reduce((s, a) => s + a.calls, 0)
  const totalFailed = agents.reduce((s, a) => s + a.failed_calls, 0)
  const totalRetried = agents.reduce((s, a) => s + a.retried_calls, 0)
  console.log(`\nCost: ${formatMoney(totalCost)}  (${totalCalls} calls, ${totalFailed} failed, ${totalRetried} on retry)`)
  console.log(`  agent                              calls    cost     failed  retried`)
  for (const a of agents) {
    const name = a.agent.padEnd(34, " ").slice(0, 34)
    const calls = String(a.calls).padStart(5, " ")
    const cost = formatMoney(Number(a.cost)).padStart(8, " ")
    const failed = String(a.failed_calls).padStart(7, " ")
    const retried = String(a.retried_calls).padStart(7, " ")
    console.log(`  ${name}  ${calls}  ${cost}  ${failed}  ${retried}`)
  }
}

function printAndGate(rows: AndGateRow[]): void {
  if (rows.length === 0) {
    console.log("\nAND-gate: no halluc-ungrounded NER prepass calls yet.")
    return
  }
  const total = rows.reduce((s, r) => s + r.count, 0)
  console.log(`\nAND-gate matrix (halluc-ungrounded NER prepass):  total=${total}`)
  for (const r of rows) {
    const decision = (r.decision ?? "(null)").padEnd(20, " ")
    const count = String(r.count).padStart(4, " ")
    const pct = formatPct(r.count, total).padStart(4, " ")
    console.log(`  ${decision}  ${count}  ${pct}`)
  }
}

function printAdherence(stage1: number, stage2: number): void {
  if (stage1 === 0 && stage2 === 0) {
    console.log("\nTwo-stage adherence: no calls yet.")
    return
  }
  const fireRate = stage1 === 0 ? "—" : formatPct(stage2, stage1)
  console.log(`\nTwo-stage adherence:`)
  console.log(`  stage 1 (events_present)        ${stage1}`)
  console.log(`  stage 2 (per-event)             ${stage2}    (${fireRate} of stage 1 — fires only on stage-1 fail)`)
}

function printExhaustions(rows: ExhaustionRow[]): void {
  if (rows.length === 0) {
    console.log("\nPlan-assist gates: 0 fired.")
    return
  }
  const open = rows.filter(r => r.decision === null)
  console.log(`\nPlan-assist gates: ${rows.length} total, ${open.length} pending`)
  for (const r of rows) {
    const status = r.decision === null ? "PENDING" : r.decision.toUpperCase()
    let devCount: number | string = "?"
    try {
      const parsed = typeof r.unresolved_deviations === "string"
        ? JSON.parse(r.unresolved_deviations)
        : r.unresolved_deviations
      devCount = Array.isArray(parsed) ? parsed.length : "?"
    } catch { /* ignore parse errors; leave devCount as ? */ }
    console.log(`  #${r.id}  ch${r.chapter} attempt ${r.attempt}  ${r.kind.padEnd(22, " ")}  ${status.padEnd(10, " ")}  ${devCount} deviation${devCount === 1 ? "" : "s"}`)
  }
}

function printFailedCalls(rows: FailedCallRow[]): void {
  if (rows.length === 0) return
  const total = rows.reduce((s, r) => s + r.count, 0)
  console.log(`\nFailed LLM calls: ${total}`)
  for (const r of rows.slice(0, 5)) {
    const agent = r.agent.padEnd(24, " ")
    const count = String(r.count).padStart(3, " ")
    const err = (r.error_text ?? "(no error_text)").slice(0, 80)
    console.log(`  ${agent}  ${count}×  ${err}`)
  }
  if (rows.length > 5) {
    console.log(`  ... + ${rows.length - 5} more rows`)
  }
}

// ── Orchestration ─────────────────────────────────────────────────────────

interface Args {
  novelId: string | null
  latest: boolean
  json: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { novelId: null, latest: false, json: false }
  for (const a of argv) {
    if (a === "--latest") out.latest = true
    else if (a === "--json") out.json = true
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/operator-summary.ts <novel-id> [--json]\n" +
          "       bun scripts/operator-summary.ts --latest [--json]\n",
      )
      process.exit(0)
    } else if (!a.startsWith("--")) {
      out.novelId = a
    }
  }
  return out
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  if (!args.latest && !args.novelId) {
    console.error("[operator-summary] error: pass <novel-id> or --latest")
    return 2
  }
  if (!(await dbReachable())) {
    console.error("[operator-summary] error: Postgres not reachable. Set DATABASE_URL or ORCHESTRATOR_DB_URL to a live DB.")
    return 2
  }
  const novel = args.latest ? await fetchLatestNovel() : await fetchNovel(args.novelId!)
  if (!novel) {
    console.error(`[operator-summary] error: novel '${args.novelId}' not found`)
    return 2
  }

  const [agentCosts, andGate, twoStage, exhaustions, failedCalls] = await Promise.all([
    fetchAgentCosts(novel.id),
    fetchAndGate(novel.id),
    fetchTwoStageAdherence(novel.id),
    fetchExhaustions(novel.id),
    fetchFailedCalls(novel.id),
  ])

  if (args.json) {
    console.log(JSON.stringify({
      novel,
      agentCosts,
      andGate,
      twoStage,
      exhaustions,
      failedCalls,
    }, null, 2))
    return 0
  }

  printHeader(novel)
  printCost(agentCosts)
  printAndGate(andGate)
  printAdherence(twoStage.stage1, twoStage.stage2)
  printExhaustions(exhaustions)
  printFailedCalls(failedCalls)
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      console.error("[operator-summary] fatal:", err)
      process.exit(1)
    })
}
