/**
 * scripts/status.ts — one-shot operator dashboard.
 *
 * Queries four sources and prints a single-screen summary:
 *   1. Local in-flight registry (scripts/lib/in-flight.ts)
 *   2. Postgres tuning_experiments (open rows + recent closed)
 *   3. LXC process state (orchestrator, organic runs, training jobs)
 *   4. Orchestrator HTTP liveness (/api/novel/<id>/state or fallback /)
 *   5. LXC host health (disk, memory, load)
 *   6. Recent commits (last 5)
 *   7. Session handoff age
 *
 * Use at session start, before sleep, after crash suspicion.
 * Not a daemon (Codex review ac9d7f955daf2511d Q4).
 *
 * Usage:
 *   bun scripts/status.ts
 *   bun scripts/status.ts --verbose    (expands recent-commits + open exps)
 */

import { readFileSync, existsSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { listInFlight, verifyEntry } from "./lib/in-flight"

const VERBOSE = process.argv.includes("--verbose")
const LXC_HOST = process.env.LXC_HOST ?? "novel-harness-lxc"
const ORCH_PORT = 3006
const HANDOFF = resolve(import.meta.dir, "../.claude/session-handoff.md")

async function main() {
  const now = new Date().toISOString()
  line("═")
  console.log(`  novel-harness — status @ ${now}`)
  line("═")

  await section("IN-FLIGHT", inFlightSection)
  await section("OPEN EXPERIMENTS", () => experimentsSection(VERBOSE))
  await section("LXC PROCESSES", lxcProcessSection)
  await section("ORCHESTRATOR", orchestratorSection)
  await section("LXC HEALTH", lxcHealthSection)
  await section("RECENT COMMITS (last 5)", recentCommitsSection)
  await section("SESSION HANDOFF", handoffSection)

  line("═")
  process.exit(0)
}

// ── Section helpers ────────────────────────────────────────────────────

async function section(title: string, runner: () => Promise<string | string[]>) {
  console.log()
  console.log(title)
  try {
    const out = await runner()
    const lines = Array.isArray(out) ? out : out.split("\n")
    for (const l of lines) console.log(`  ${l}`)
  } catch (err) {
    console.log(`  [error] ${err instanceof Error ? err.message : err}`)
  }
}

function line(char: string) {
  console.log(char.repeat(72))
}

// ── Sections ───────────────────────────────────────────────────────────

async function inFlightSection(): Promise<string[]> {
  const entries = await listInFlight()
  if (entries.length === 0) return ["(none)"]
  const out: string[] = []
  for (const e of entries) {
    const verdict = await verifyEntry(e)
    const verdictTag = verdict === "alive"    ? "✓ alive"
                    : verdict === "ghost"     ? "✗ GHOST"
                    : verdict === "reboot"    ? "✗ REBOOT"
                    : "? unchecked"
    out.push(`${e.run_id}  [${e.kind}]  exp=${e.exp_id ?? "—"}  ${verdictTag}`)
    out.push(`  ${e.description}`)
    if (e.log_path) out.push(`  log: ${e.host}:${e.log_path}`)
  }
  return out
}

async function experimentsSection(verbose: boolean): Promise<string[]> {
  const out = await ssh(`cd ~/apps/novel-harness && bun -e '
    import db from "./src/db/connection"
    const open = await db\`SELECT id, experiment_type, description, timestamp FROM tuning_experiments WHERE conclusion IS NULL ORDER BY id DESC LIMIT 10\`
    const recent = await db\`SELECT id, experiment_type, description, timestamp FROM tuning_experiments WHERE conclusion IS NOT NULL ORDER BY timestamp DESC LIMIT ${verbose ? 10 : 3}\`
    console.log(JSON.stringify({ open, recent }))
    process.exit(0)
  '`)
  const parsed = JSON.parse(out) as { open: any[]; recent: any[] }
  const lines: string[] = []
  if (parsed.open.length === 0) {
    lines.push("(no open experiments)")
  } else {
    lines.push(`OPEN (${parsed.open.length}):`)
    for (const r of parsed.open) lines.push(`  #${r.id} [${r.experiment_type}]  ${trunc(r.description, 70)}`)
  }
  lines.push(``)
  lines.push(`RECENT CLOSED (top ${parsed.recent.length}):`)
  for (const r of parsed.recent) lines.push(`  #${r.id} [${r.experiment_type}]  ${trunc(r.description, 70)}`)
  return lines
}

async function lxcProcessSection(): Promise<string[]> {
  const out = await ssh(`ps -eo pid,etime,rss,cmd | grep -E "bun (src/orchestrator|scripts/test/organic|scripts/finetune/train)" | grep -v grep | head -5`)
  if (!out.trim()) return ["(no tracked processes)"]
  return out.trim().split("\n").map(l => l.trim())
}

async function orchestratorSection(): Promise<string[]> {
  const r = await ssh(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${ORCH_PORT}/ 2>&1 || echo fail`)
  const status = r.trim()
  if (status !== "200" && status !== "301" && status !== "302") {
    return [`http://${LXC_HOST}:${ORCH_PORT}/  → status=${status} (degraded or down)`]
  }
  // Healthy — query debug flags + active novel count if we can
  try {
    const flags = await ssh(`cd ~/apps/novel-harness && curl -s -H "x-api-key: $(grep ORCHESTRATOR_API_KEY .env | cut -d= -f2 | tr -d \\")" http://localhost:${ORCH_PORT}/api/health/debug-flags`)
    const parsed = JSON.parse(flags) as Record<string, string | null>
    const activeFlags = Object.entries(parsed).filter(([, v]) => v !== null)
    return [
      `http://${LXC_HOST}:${ORCH_PORT}/  → HTTP 200`,
      activeFlags.length === 0
        ? `DEBUG flags: all null (clean env)`
        : `DEBUG flags: ${activeFlags.map(([k, v]) => `${k}=${v}`).join(", ")} ⚠️`,
    ]
  } catch {
    return [`http://${LXC_HOST}:${ORCH_PORT}/  → HTTP 200 (debug-flags probe failed)`]
  }
}

async function lxcHealthSection(): Promise<string[]> {
  const out = await ssh(`echo "disk: $(df -h / | awk 'NR==2 {print $3" / "$2" ("$5")"}')"; echo "mem:  $(free -h | awk 'NR==2 {print $2" total, "$7" available"}')"; echo "load: $(uptime | awk -F'load average: ' '{print $2}')"`)
  return out.trim().split("\n")
}

async function recentCommitsSection(): Promise<string[]> {
  const out = await local(`git log --oneline -${VERBOSE ? 10 : 5}`)
  return out.trim().split("\n")
}

async function handoffSection(): Promise<string[]> {
  if (!existsSync(HANDOFF)) return [`(missing at ${HANDOFF})`]
  const stat = statSync(HANDOFF)
  const ageMs = Date.now() - stat.mtimeMs
  const ageH = Math.floor(ageMs / 3_600_000)
  const ageM = Math.floor((ageMs % 3_600_000) / 60_000)
  const age = `${ageH}h ${ageM}m`
  const stale = ageMs > 48 * 3_600_000
  // Read status + updated fields from frontmatter
  const content = readFileSync(HANDOFF, "utf8")
  const statusM = content.match(/^status:\s*(.+)$/m)
  const updatedM = content.match(/^updated:\s*(.+)$/m)
  return [
    `age: ${age}${stale ? "  ⚠️ > 48h, treat as unreliable" : ""}`,
    `status: ${statusM?.[1] ?? "?"}`,
    `updated: ${updatedM?.[1] ?? "?"}`,
    `path: .claude/session-handoff.md`,
  ]
}

// ── Shell helpers ──────────────────────────────────────────────────────

async function ssh(cmd: string): Promise<string> {
  const result = await Bun.$`ssh ${LXC_HOST} ${cmd}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`ssh failed (exit ${result.exitCode}): ${result.stderr.toString().slice(0, 200)}`)
  }
  return result.stdout.toString()
}

async function local(cmd: string): Promise<string> {
  const result = await Bun.$`sh -c ${cmd}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`local failed: ${result.stderr.toString().slice(0, 200)}`)
  }
  return result.stdout.toString()
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

await main()
