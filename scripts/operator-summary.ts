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
 * STALE-GATE AUDIT MODE (cross-novel)
 *
  *   --stale-gates surveys all novels for chapter_exhaustions WHERE decision
  *   IS NULL with age + recommended action. Useful at the start of an
  *   overnight loop to surface stale gates from prior runs. Use
  *   scripts/agent/resolve-stale-gates.ts to mark stale rows orphaned after
  *   dry-run review.
 *
 * USAGE
 *
 *   bun scripts/operator-summary.ts <novel-id>
 *   bun scripts/operator-summary.ts --latest          # newest novel
 *   bun scripts/operator-summary.ts --json <novel-id> # machine-readable
 *   bun scripts/operator-summary.ts --stale-gates     # cross-novel audit
 *   bun scripts/operator-summary.ts --stale-gates --min-age-hours 6
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
import { parseJsonbArray } from "../src/db/jsonb"

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

// L63 follow-up: per-chapter integrity issue rollup for measuring whether
// matched-pair carry-over reduces duplicate-* counts on retry.
interface IntegrityAttemptRow {
  chapter: number
  attempt_index: number
  total_issues: number
  duplicate_sentence: number
  duplicate_fragment: number
  fused_boundary: number
  camel_fusion: number
  quote_integrity: number
  pair_bearing_dup_issues: number
}

interface FailedCallRow {
  agent: string
  error_text: string | null
  count: number
}

interface StaleGateRow {
  exhaustion_id: number
  novel_id: string
  chapter: number
  attempt: number
  kind: string
  fired_at: Date
  novel_phase: string | null
  novel_seed: string | null
  novel_updated_at: Date | null
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
  // Both stages use agent='adherence-events' (single agent name; see
  // src/agents/writer/adherence-checker.ts callAgent calls). The
  // distinguisher is the system prompt: stage 1 (EVENTS_SYSTEM) starts with
  // "You verify"; stage 2 (MISSING_EVENTS_SYSTEM) starts with "You enumerate".
  // L36 fix — L33 originally assumed two distinct agent names.
  const rows = await db<{ stage: string; n: number }[]>`
    SELECT
      CASE WHEN system_prompt LIKE 'You enumerate%' THEN 'stage2' ELSE 'stage1' END AS stage,
      COUNT(*)::int AS n
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'adherence-events'
    GROUP BY stage
  `
  const stage1 = rows.find(r => r.stage === "stage1")?.n ?? 0
  const stage2 = rows.find(r => r.stage === "stage2")?.n ?? 0
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

// L63 follow-up: query prose-integrity-check events for a novel and bucket
// each attempt's issue list by kind. `pair_bearing_dup_issues` counts the
// duplicate-* issues that carry the L63 `firstExcerpt` field — useful for
// confirming new-shape payloads are reaching the writer once L63 deploys.
async function fetchIntegrityHistory(novelId: string): Promise<IntegrityAttemptRow[]> {
  // pipeline_events stores one event per chapter-attempt's integrity check;
  // payload.issues is an array of {kind, excerpt, firstExcerpt?} entries.
  // Each event corresponds to one attempt — use timestamp order to reconstruct
  // attempt_index within a chapter (events table doesn't carry attempt directly).
  const rows = await db<Array<{
    chapter: number | null
    payload: { issues?: Array<{ kind: string; firstExcerpt?: string | null }>; passed?: boolean }
    timestamp: Date
  }>>`
    SELECT chapter, payload, timestamp
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND event_type = 'prose-integrity-check'
      AND chapter IS NOT NULL
    ORDER BY chapter, timestamp
  `

  const grouped = new Map<number, IntegrityAttemptRow[]>()
  for (const r of rows) {
    if (r.chapter == null) continue
    const issues = r.payload?.issues ?? []
    const counts = {
      duplicate_sentence: 0,
      duplicate_fragment: 0,
      fused_boundary: 0,
      camel_fusion: 0,
      quote_integrity: 0,
      pair_bearing_dup_issues: 0,
    }
    for (const i of issues) {
      switch (i.kind) {
        case "duplicate-sentence": counts.duplicate_sentence++; break
        case "duplicate-fragment": counts.duplicate_fragment++; break
        case "fused-boundary": counts.fused_boundary++; break
        case "camel-fusion": counts.camel_fusion++; break
        case "quote-integrity": counts.quote_integrity++; break
      }
      if ((i.kind === "duplicate-sentence" || i.kind === "duplicate-fragment") && i.firstExcerpt) {
        counts.pair_bearing_dup_issues++
      }
    }
    const existing = grouped.get(r.chapter) ?? []
    existing.push({
      chapter: r.chapter,
      attempt_index: existing.length + 1, // 1-based, ordered by timestamp
      total_issues: issues.length,
      ...counts,
    })
    grouped.set(r.chapter, existing)
  }
  return Array.from(grouped.values()).flat().sort((a, b) =>
    a.chapter - b.chapter || a.attempt_index - b.attempt_index,
  )
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

async function fetchStaleGates(minAgeMs: number): Promise<StaleGateRow[]> {
  const cutoff = new Date(Date.now() - minAgeMs).toISOString()
  const rows = await db<StaleGateRow[]>`
    SELECT
      e.id AS exhaustion_id,
      e.novel_id,
      e.chapter,
      e.attempt,
      e.kind,
      e.fired_at,
      n.phase AS novel_phase,
      n.seed_json->>'seed' AS novel_seed,
      n.updated_at AS novel_updated_at
    FROM chapter_exhaustions e
    LEFT JOIN novels n ON n.id = e.novel_id
    WHERE e.decided_at IS NULL
      AND e.fired_at < ${cutoff}::timestamptz
    ORDER BY e.fired_at ASC
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

export type StaleGateAction = "orphan" | "resume" | "investigate"

export function recommendForStaleGate(
  firedAt: Date,
  novelPhase: string | null,
  novelUpdatedAt: Date | null,
  now: Date = new Date(),
): { action: StaleGateAction; reason: string } {
  const ageHours = (now.getTime() - firedAt.getTime()) / 3_600_000
  if (novelPhase === "complete" || novelPhase === "failed" || novelPhase === "aborted") {
    return { action: "orphan", reason: `novel ${novelPhase}` }
  }
  if (ageHours > 24) {
    return { action: "orphan", reason: `>24h pending` }
  }
  if (novelUpdatedAt === null) {
    return { action: "investigate", reason: `novel row missing` }
  }
  const idleHours = (now.getTime() - novelUpdatedAt.getTime()) / 3_600_000
  if (idleHours > 12) {
    return { action: "orphan", reason: `novel idle ${Math.floor(idleHours)}h` }
  }
  if (idleHours < 6) {
    return { action: "resume", reason: `novel active ${Math.floor(idleHours * 60)}m ago` }
  }
  return { action: "investigate", reason: `${Math.floor(ageHours)}h pending, novel idle ${Math.floor(idleHours)}h` }
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
    const devCount = parseJsonbArray(r.unresolved_deviations).length
    console.log(`  #${r.id}  ch${r.chapter} attempt ${r.attempt}  ${r.kind.padEnd(22, " ")}  ${status.padEnd(10, " ")}  ${devCount} deviation${devCount === 1 ? "" : "s"}`)
  }
}

// L63 follow-up: render integrity history per chapter so an operator can see
// whether duplicate-* counts trend down on retry (Lever A's intended effect)
// or escalate (the L61 secondary finding). pair-bearing column hits 0 on
// chapters drafted before L63 deployed; non-zero confirms new-shape payloads.
function printIntegrityHistory(rows: IntegrityAttemptRow[]): void {
  if (rows.length === 0) {
    console.log("\nIntegrity issues: no prose-integrity-check events yet.")
    return
  }
  const totalIssues = rows.reduce((acc, r) => acc + r.total_issues, 0)
  if (totalIssues === 0) {
    console.log("\nIntegrity issues: 0 across all attempts (clean).")
    return
  }
  console.log(`\nIntegrity issues by chapter / attempt (rows: ${rows.length})`)
  console.log("  ch:att  total  dup-sent  dup-frag  fused-b  camel-f  quote-i  pair-bearing")
  for (const r of rows) {
    const ch = String(r.chapter).padStart(2)
    const at = String(r.attempt_index).padStart(2)
    const tot = String(r.total_issues).padStart(5)
    const ds = String(r.duplicate_sentence).padStart(8)
    const df = String(r.duplicate_fragment).padStart(8)
    const fb = String(r.fused_boundary).padStart(7)
    const cf = String(r.camel_fusion).padStart(7)
    const qi = String(r.quote_integrity).padStart(7)
    const pb = String(r.pair_bearing_dup_issues).padStart(12)
    console.log(`  ${ch}:${at}    ${tot}    ${ds}  ${df}  ${fb}  ${cf}  ${qi}  ${pb}`)
  }
  // Brief escalation hint per chapter.
  const byCh = new Map<number, IntegrityAttemptRow[]>()
  for (const r of rows) {
    const list = byCh.get(r.chapter) ?? []
    list.push(r)
    byCh.set(r.chapter, list)
  }
  for (const [ch, attempts] of byCh) {
    if (attempts.length < 2) continue
    const counts = attempts.map(a => a.total_issues)
    const escalating = counts.every((v, i) => i === 0 || v >= counts[i - 1])
    const decaying = counts.every((v, i) => i === 0 || v <= counts[i - 1])
    if (escalating && counts[counts.length - 1] > counts[0]) {
      console.log(`  ⚠️  ch${ch} escalating: ${counts.join("→")}`)
    } else if (decaying && counts[counts.length - 1] < counts[0]) {
      console.log(`  ✓ ch${ch} decaying: ${counts.join("→")}`)
    }
  }
}

function printStaleGatesAudit(rows: StaleGateRow[], minAgeHours: number): void {
  if (rows.length === 0) {
    console.log(`\nStale plan-assist gates: 0 (older than ${minAgeHours}h)`)
    return
  }
  console.log(`\nStale plan-assist gates: ${rows.length} pending (older than ${minAgeHours}h)`)
  console.log(`  id     novel_id              seed                          ch:att  kind                    age      phase         action        reason`)
  for (const r of rows) {
    const id = String(r.exhaustion_id).padEnd(6)
    const novelShort = r.novel_id.slice(0, 20).padEnd(20)
    const seed = (r.novel_seed ?? "(none)").slice(0, 28).padEnd(28)
    const cha = `c${r.chapter}:a${r.attempt}`.padEnd(7)
    const kind = (r.kind ?? "").padEnd(22)
    const age = formatAge(new Date(r.fired_at)).padEnd(8)
    const phase = (r.novel_phase ?? "(?)").padEnd(13)
    const rec = recommendForStaleGate(
      new Date(r.fired_at),
      r.novel_phase,
      r.novel_updated_at ? new Date(r.novel_updated_at) : null,
    )
    const action = rec.action.toUpperCase().padEnd(13)
    console.log(`  ${id} ${novelShort}  ${seed}  ${cha}  ${kind}  ${age}  ${phase}  ${action} ${rec.reason}`)
  }
  console.log()
  console.log(`  ORPHAN: resolve with scripts/agent/resolve-stale-gates.ts --ids <id> --apply after dry-run review.`)
  console.log(`  RESUME: drive the resolver via /api/novel/resume on the active novel.`)
  console.log(`  INVESTIGATE: check novel logs / planner state before deciding.`)
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
  staleGates: boolean
  minAgeHours: number
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { novelId: null, latest: false, json: false, staleGates: false, minAgeHours: 1 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--latest") out.latest = true
    else if (a === "--json") out.json = true
    else if (a === "--stale-gates") out.staleGates = true
    else if (a === "--min-age-hours") {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        throw new Error("--min-age-hours requires a numeric value")
      }
      const n = Number(next)
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`--min-age-hours must be a non-negative number, got: ${next}`)
      }
      out.minAgeHours = n
      i++
    }
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/operator-summary.ts <novel-id> [--json]\n" +
          "       bun scripts/operator-summary.ts --latest [--json]\n" +
          "       bun scripts/operator-summary.ts --stale-gates [--min-age-hours <n>] [--json]\n",
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
  if (!args.staleGates && !args.latest && !args.novelId) {
    console.error("[operator-summary] error: pass <novel-id>, --latest, or --stale-gates")
    return 2
  }
  if (!(await dbReachable())) {
    console.error("[operator-summary] error: Postgres not reachable. Set DATABASE_URL or ORCHESTRATOR_DB_URL to a live DB.")
    return 2
  }

  if (args.staleGates) {
    const staleRows = await fetchStaleGates(args.minAgeHours * 3_600_000)
    if (args.json) {
      console.log(JSON.stringify({ staleGates: staleRows, minAgeHours: args.minAgeHours }, null, 2))
      return 0
    }
    printStaleGatesAudit(staleRows, args.minAgeHours)
    return 0
  }

  const novel = args.latest ? await fetchLatestNovel() : await fetchNovel(args.novelId!)
  if (!novel) {
    console.error(`[operator-summary] error: novel '${args.novelId}' not found`)
    return 2
  }

  const [agentCosts, andGate, twoStage, exhaustions, integrityHistory, failedCalls] = await Promise.all([
    fetchAgentCosts(novel.id),
    fetchAndGate(novel.id),
    fetchTwoStageAdherence(novel.id),
    fetchExhaustions(novel.id),
    fetchIntegrityHistory(novel.id),
    fetchFailedCalls(novel.id),
  ])

  if (args.json) {
    console.log(JSON.stringify({
      novel,
      agentCosts,
      andGate,
      twoStage,
      exhaustions,
      integrityHistory,
      failedCalls,
    }, null, 2))
    return 0
  }

  printHeader(novel)
  printCost(agentCosts)
  printAndGate(andGate)
  printAdherence(twoStage.stage1, twoStage.stage2)
  printExhaustions(exhaustions)
  printIntegrityHistory(integrityHistory)
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
