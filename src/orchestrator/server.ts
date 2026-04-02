/**
 * Novel Harness Orchestrator — single service.
 *
 * Runs on LXC 307 (port 3006). Combines:
 * - Batch API polling (every 30 min)
 * - Improvement daemon (event-driven + nightly schedule)
 * - Dashboard (HTML status page)
 * - REST API for status queries
 *
 * Entry point: bun src/orchestrator/server.ts
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { migrate, getAllBatches, getBatchById, getRequestsForBatch, getState } from "./db"
import { pollOnce } from "./poller"
import { getDaemonStatus, startCycle, handleBatchComplete } from "./daemon-loop"
import { getTodayBudget } from "./budget"

await migrate()

const API_KEY = process.env.ORCHESTRATOR_API_KEY
if (!API_KEY) throw new Error("ORCHESTRATOR_API_KEY not set")

function checkAuth(req: Request): Response | null {
  const key = req.headers.get("x-api-key") || new URL(req.url).searchParams.get("key")
  if (!key || key !== API_KEY) return Response.json({ error: "Unauthorized" }, { status: 401 })
  return null
}

// ── Dashboard HTML ──────────────────────────────────────────────────────

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Novel Harness Orchestrator</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { color: #4ecca3; font-size: 1.4rem; }
  h2 { color: #4ecca3; font-size: 1.1rem; margin-top: 2rem; }
  .card { background: #16213e; border: 1px solid #0f3460; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; }
  .status.active { background: #e2b714; color: #000; }
  .status.completed { background: #4ecca3; color: #000; }
  .status.failed { background: #e74c3c; color: #fff; }
  .status.idle { background: #555; }
  .status.submitted, .status.processing, .status.validating { background: #3498db; color: #fff; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #0f3460; }
  th { color: #4ecca3; }
  button { background: #4ecca3; color: #000; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-family: monospace; }
  button:hover { background: #3ba88a; }
  .refresh { font-size: 0.8rem; color: #888; }
</style>
</head><body>
<h1>Novel Harness Orchestrator</h1>
<p class="refresh">Auto-refreshes every 30s. <button onclick="location.reload()">Refresh now</button>
  <button onclick="fetch('/api/poll',{method:'POST',headers:{'x-api-key':key}}).then(()=>setTimeout(()=>location.reload(),2000))">Poll now</button>
  <button onclick="fetch('/api/improvement/start',{method:'POST',headers:{'x-api-key':key}}).then(()=>setTimeout(()=>location.reload(),2000))">Start improvement</button>
</p>

<div id="content">Loading...</div>

<script>
const key = new URLSearchParams(location.search).get('key') || ''
const h = {'x-api-key': key}

async function load() {
  try {
    const [batches, improvement, budget, state] = await Promise.all([
      fetch('/api/batches?key='+key).then(r=>r.json()),
      fetch('/api/improvement/status?key='+key).then(r=>r.json()),
      fetch('/api/budget?key='+key).then(r=>r.json()),
      fetch('/api/stats?key='+key).then(r=>r.json()),
    ])

    let html = ''

    // Improvement status
    html += '<h2>Improvement Daemon</h2><div class="card">'
    if (improvement.active) {
      const c = improvement.cycle
      html += '<span class="status active">ACTIVE</span> '
      html += 'Cycle #' + c.id + ' — ' + c.target + '/' + c.dimension
      html += '<br>Iteration ' + c.iteration + ', score: ' + c.currentScore
      html += ', failures: ' + c.consecutiveFailures
      if (c.pendingBatchId) html += '<br>Waiting for batch #' + c.pendingBatchId
    } else {
      html += '<span class="status idle">IDLE</span> No active cycle'
    }
    html += '</div>'

    // Budget
    html += '<h2>Budget (today)</h2><div class="card">'
    html += '$' + budget.spent.toFixed(4) + ' / $' + budget.budget.toFixed(2)
    html += ' (' + budget.iterations + ' iterations)'
    const pct = budget.budget > 0 ? Math.round(budget.spent / budget.budget * 100) : 0
    html += '<br><div style="background:#0f3460;border-radius:4px;height:8px;margin-top:6px">'
    html += '<div style="background:' + (pct > 75 ? '#e74c3c' : '#4ecca3') + ';height:8px;border-radius:4px;width:' + Math.min(pct,100) + '%"></div></div>'
    html += '</div>'

    // Orchestrator stats
    html += '<h2>Orchestrator</h2><div class="card">'
    html += 'Polls: ' + (state.total_polls ?? 0)
    html += ', Collected: ' + (state.total_collected ?? 0)
    html += ', Last poll: ' + (state.last_poll_at ? new Date(state.last_poll_at).toLocaleString() : 'never')
    html += ', Active batches: ' + (state.active_batches ?? 0)
    html += '</div>'

    // Batches
    html += '<h2>Recent Batches</h2><table><tr><th>ID</th><th>Status</th><th>Progress</th><th>Provider</th><th>Model</th><th>Run</th><th>Submitted</th></tr>'
    for (const b of batches) {
      const cls = b.status
      html += '<tr><td>' + b.id + '</td>'
      html += '<td><span class="status ' + cls + '">' + b.status + '</span></td>'
      html += '<td>' + b.completed_count + '/' + b.request_count + '</td>'
      html += '<td>' + b.provider + '</td>'
      html += '<td>' + (b.judge_model||'') + '</td>'
      html += '<td>' + (b.local_run_id||'') + '</td>'
      html += '<td>' + new Date(b.submitted_at).toLocaleString() + '</td></tr>'
    }
    html += '</table>'

    document.getElementById('content').innerHTML = html
  } catch(e) {
    document.getElementById('content').innerHTML = '<p style="color:#e74c3c">Error loading: ' + e.message + '</p>'
  }
}

load()
setInterval(load, 30000)
</script>
</body></html>`
}

// ── HTTP Server ─────────────────────────────────────────────────────────

const server = Bun.serve({
  port: 3006,
  hostname: "0.0.0.0",

  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // Dashboard — unauthenticated (key passed as query param for API calls)
    if (path === "/" && req.method === "GET") {
      return new Response(dashboardHtml(), { headers: { "Content-Type": "text/html" } })
    }

    // Health — unauthenticated
    if (path === "/health") return Response.json({ status: "ok", service: "novel-harness-orchestrator" })

    // Everything else requires auth
    const authErr = checkAuth(req)
    if (authErr) return authErr

    // ── Batch API ───────────────────────────────────────────────────
    if (path === "/api/batches" && req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") ?? "20")
      return Response.json(await getAllBatches(limit))
    }

    const batchResultsMatch = path.match(/^\/api\/batches\/(\d+)\/results$/)
    if (batchResultsMatch && req.method === "GET") {
      const id = parseInt(batchResultsMatch[1])
      const batch = await getBatchById(id)
      if (!batch) return Response.json({ error: "Not found" }, { status: 404 })
      return Response.json({ batch, requests: await getRequestsForBatch(id) })
    }

    const batchMatch = path.match(/^\/api\/batches\/(\d+)$/)
    if (batchMatch && req.method === "GET") {
      const id = parseInt(batchMatch[1])
      const batch = await getBatchById(id)
      if (!batch) return Response.json({ error: "Not found" }, { status: 404 })
      return Response.json(batch)
    }

    // ── Poll ────────────────────────────────────────────────────────
    if (path === "/api/poll" && req.method === "POST") {
      return Response.json(await pollOnce())
    }

    // ── Stats ───────────────────────────────────────────────────────
    if (path === "/api/stats" && req.method === "GET") {
      const state = await getState()
      const active = await getAllBatches(100)
      const activeBatches = active.filter((b: any) => !["completed", "failed", "expired", "cancelled"].includes(b.status))
      return Response.json({ ...state, active_batches: activeBatches.length, total_batches: active.length })
    }

    // ── Budget ──────────────────────────────────────────────────────
    if (path === "/api/budget" && req.method === "GET") {
      return Response.json(await getTodayBudget())
    }

    // ── Improvement ─────────────────────────────────────────────────
    if (path === "/api/improvement/status" && req.method === "GET") {
      return Response.json(await getDaemonStatus())
    }

    if (path === "/api/improvement/start" && req.method === "POST") {
      const status = await getDaemonStatus()
      if (status.active) return Response.json({ error: "Cycle already active", cycleId: status.cycle?.id })
      startCycle("manual").catch(err => console.error("[daemon] Manual start error:", err))
      return Response.json({ ok: true, status: "starting" })
    }

    const reportMatch = path.match(/^\/api\/improvement\/report\/(\d+)$/)
    if (reportMatch && req.method === "GET") {
      const id = parseInt(reportMatch[1])
      const cycle = await (await import("./db")).default`SELECT * FROM improvement_cycles WHERE id = ${id}`
      const iterations = await (await import("./db")).default`SELECT * FROM improvement_iterations WHERE cycle_id = ${id} ORDER BY iteration_num`
      if (cycle.length === 0) return Response.json({ error: "Not found" }, { status: 404 })
      return Response.json({ cycle: cycle[0], iterations })
    }

    return Response.json({ error: "Not found" }, { status: 404 })
  },
})

// ── Timers ──────────────────────────────────────────────────────────────

// Batch polling every 30 min
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS ?? String(30 * 60 * 1000))
console.log(`Orchestrator: polling every ${POLL_INTERVAL / 60000}min`)
pollOnce().catch(err => console.error("Poll error:", err))
setInterval(() => {
  pollOnce().catch(err => console.error("Poll error:", err))
}, POLL_INTERVAL)

// Nightly improvement trigger
const NIGHTLY_HOUR = parseInt(process.env.IMPROVEMENT_START_HOUR ?? "22")
setInterval(async () => {
  const now = new Date()
  if (now.getHours() === NIGHTLY_HOUR && now.getMinutes() === 0) {
    const status = await getDaemonStatus()
    if (!status.active) {
      console.log(`[daemon] Nightly trigger at ${NIGHTLY_HOUR}:00`)
      startCycle("scheduled").catch(err => console.error("[daemon] Nightly error:", err))
    }
  }
}, 60_000)

console.log(`Orchestrator running at http://localhost:${server.port}`)
console.log(`Dashboard: http://localhost:${server.port}/?key=${API_KEY}`)
console.log(`Nightly improvement: ${NIGHTLY_HOUR}:00`)
