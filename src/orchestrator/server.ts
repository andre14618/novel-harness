/**
 * Novel Harness Orchestrator — single service.
 *
 * Runs on LXC 307 (port 3006). Combines:
 * - Batch API polling (every 30 min)
 * - Improvement daemon (manual trigger only)
 * - Dashboard (HTML status page)
 * - REST API for status queries
 *
 * Entry point: bun src/orchestrator/server.ts
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve, basename } from "node:path"
import { migrate, getAllBatches, getBatchById, getRequestsForBatch, getState } from "./db"
import { pollOnce } from "./poller"
import { getDaemonStatus, startCycle, handleBatchComplete } from "./daemon-loop"
import { diagnose } from "./diagnose"
import { TARGETS } from "./improve"
import { BENCHMARKS } from "../../benchmark/registry"
import { handleNovelRoute } from "./novel-routes"

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
<p style="margin-bottom:1rem"><a id="panel-link" href="/panel" style="color:#58a6ff">Operations Panel &rarr;</a></p>
<p class="refresh">Auto-refreshes every 30s. <button onclick="location.reload()">Refresh now</button>
  <button onclick="fetch('/api/poll',{method:'POST',headers:{'x-api-key':key}}).then(()=>setTimeout(()=>location.reload(),2000))">Poll now</button>
  <button onclick="fetch('/api/improvement/start',{method:'POST',headers:{'x-api-key':key}}).then(()=>setTimeout(()=>location.reload(),2000))">Start improvement</button>
</p>

<div id="content">Loading...</div>

<script>
const key = new URLSearchParams(location.search).get('key') || ''
const h = {'x-api-key': key}
document.getElementById('panel-link').href = '/panel?key=' + encodeURIComponent(key)

async function load() {
  try {
    const [batches, improvement, state] = await Promise.all([
      fetch('/api/batches?key='+key).then(r=>r.json()),
      fetch('/api/improvement/status?key='+key).then(r=>r.json()),
      fetch('/api/stats?key='+key).then(r=>r.json()),
    ])

    let html = ''

    // Improvement status
    html += '<h2>Improvement Daemon</h2><div class="card">'
    if (improvement.active) {
      const c = improvement.cycle
      html += '<span class="status active">ACTIVE</span> '
      html += 'Cycle #' + c.id + ' — ' + c.target + '/' + c.dimension
      html += '<br>Iteration ' + c.iteration + '/' + c.limits.maxIterations
      html += ', score: ' + c.currentScore
      html += ', cost: $' + (c.actualCost ?? 0).toFixed(4)
      if (c.limits.maxCostUsd) html += '/$' + c.limits.maxCostUsd.toFixed(2)
      html += ', failures: ' + c.consecutiveFailures
      if (c.pendingBatchId) html += '<br>Waiting for batch #' + c.pendingBatchId
    } else {
      html += '<span class="status idle">IDLE</span> No active cycle'
    }
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

// ── Operations config (drives panel forms dynamically) ──────────────────

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"

const ENV_VAR_DEFS = [
  { name: "BENCHMARK_SEEDS", applies: ["prose", "planning"], type: "multi-select", optionsFrom: "seeds" },
  { name: "BENCHMARK_RUNS", applies: ["all"], type: "number", default: "3" },
  { name: "BENCHMARK_SAMPLES", applies: ["extraction"], type: "number" },
  { name: "BENCHMARK_AGENT", applies: ["extraction"], type: "select", options: ["summary-extractor", "fact-extractor", "character-state"] },
  { name: "BENCHMARK_FIXTURES", applies: ["continuity"], type: "multi-select", optionsFrom: "fixtures" },
  { name: "BENCHMARK_JUDGES", applies: ["all"], type: "text" },
  { name: "EXPERIMENT_ID", applies: ["all"], type: "number" },
  { name: "BATCH_PROVIDER", applies: ["prose"], type: "text", default: "openai" },
  { name: "BATCH_MODEL", applies: ["prose"], type: "text", default: "gpt-5.4-mini" },
  { name: "LLM_TRANSPORT", applies: ["all"], type: "select", options: ["direct", "cache", "batch"] },
] as const

function buildOperationsConfig() {
  const seeds = readdirSync(resolve(HARNESS_ROOT, "src/seeds"))
    .filter(f => f.endsWith(".json"))
    .map(f => basename(f, ".json"))

  const fixtures = readdirSync(resolve(HARNESS_ROOT, "benchmark/continuity/fixtures"))
    .filter(f => f.endsWith(".json"))
    .map(f => basename(f, ".json"))

  const benchmarks: Record<string, any> = {}
  for (const [name, cfg] of Object.entries(BENCHMARKS)) {
    benchmarks[name] = {
      displayName: cfg.displayName,
      scoring: cfg.scoring,
      dimensions: cfg.dimensions,
      dimensionLabels: cfg.dimensionLabels,
      runCmd: cfg.runCmd,
      supportsBatch: name === "prose",
    }
  }

  const envVars = ENV_VAR_DEFS.map(v => {
    const out: Record<string, any> = { name: v.name, applies: v.applies, type: v.type }
    if ("default" in v) out.default = v.default
    if ("options" in v && v.options) out.options = v.options
    if ("optionsFrom" in v) {
      out.options = v.optionsFrom === "seeds" ? seeds : v.optionsFrom === "fixtures" ? fixtures : []
    }
    return out
  })

  return { seeds, fixtures, benchmarks, envVars, targets: Object.keys(TARGETS) }
}

// ── Process management ──────────────────────────────────────────────────

interface TrackedProcess {
  proc: ReturnType<typeof Bun.spawn>
  type: "benchmark" | "novel"
  label: string
  startedAt: string
  stdout: string[]
  exitCode: number | null
}

const processes = new Map<number, TrackedProcess>()
const MAX_TRACKED = 20

function trackProcess(proc: ReturnType<typeof Bun.spawn>, type: "benchmark" | "novel", label: string): number {
  const pid = proc.pid
  const tracked: TrackedProcess = {
    proc, type, label,
    startedAt: new Date().toISOString(),
    stdout: [],
    exitCode: null,
  }
  processes.set(pid, tracked)

  // Stream stdout
  if (proc.stdout) {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    ;(async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const lines = decoder.decode(value).split("\n")
          for (const line of lines) {
            if (line.trim()) tracked.stdout.push(line)
          }
          // Keep last 300 lines
          if (tracked.stdout.length > 300) tracked.stdout.splice(0, tracked.stdout.length - 300)
        }
      } catch {}
    })()
  }

  // Track exit
  proc.exited.then(code => { tracked.exitCode = code })

  // Evict oldest completed
  if (processes.size > MAX_TRACKED) {
    for (const [oldPid, p] of processes) {
      if (p.exitCode !== null) { processes.delete(oldPid); break }
    }
  }

  return pid
}

function spawnBenchmark(suite: string, env: Record<string, string>, batch: boolean): number {
  const cfg = BENCHMARKS[suite]
  if (!cfg?.runCmd) throw new Error(`Unknown suite: ${suite}`)

  let cmd = cfg.runCmd
  if (batch && suite === "prose" && !cmd.includes("--batch")) cmd += " --batch"

  const proc = Bun.spawn(["bash", "-c", cmd], {
    cwd: HARNESS_ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })

  const label = `${suite}${batch ? " (batch)" : ""}`
  return trackProcess(proc, "benchmark", label)
}

function spawnNovel(seed?: string): number {
  let cmd = "bun src/index.ts --auto"
  if (seed) cmd += ` --seed ${seed}`

  const proc = Bun.spawn(["bash", "-c", cmd], {
    cwd: HARNESS_ROOT,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  })

  return trackProcess(proc, "novel", seed ? `novel (${seed})` : "novel")
}

function getProcessStatus(pid: number) {
  const p = processes.get(pid)
  if (!p) return null
  return {
    pid,
    type: p.type,
    label: p.label,
    startedAt: p.startedAt,
    running: p.exitCode === null,
    exitCode: p.exitCode,
    stdoutLines: p.stdout.length,
    stdout: p.stdout.slice(-100).join("\n"),
  }
}

function getActiveRuns() {
  return [...processes.entries()]
    .map(([pid]) => getProcessStatus(pid)!)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20)
}

// ── Panel HTML ──────────────────────────────────────────────────────────

function panelHtml(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Novel Harness — Operations Panel</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 2rem; max-width: 960px; margin: 0 auto; }
  h1 { color: #4ecca3; font-size: 1.4rem; }
  h2 { color: #4ecca3; font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #0f3460; padding-bottom: 0.4rem; }
  a { color: #58a6ff; }
  nav { margin-bottom: 1.5rem; font-size: 0.85rem; }
  .card { background: #16213e; border: 1px solid #0f3460; border-radius: 8px; padding: 1rem; margin: 0.8rem 0; }
  label { display: block; margin: 0.5rem 0 0.2rem; color: #8b949e; font-size: 0.85rem; }
  select, input[type=text], input[type=number] {
    background: #0d1117; color: #e0e0e0; border: 1px solid #30363d; border-radius: 4px;
    padding: 6px 10px; font-family: monospace; font-size: 0.85rem; width: 100%; max-width: 400px;
  }
  .checkbox-group { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.3rem 0; }
  .checkbox-group label { display: inline-flex; align-items: center; gap: 4px; color: #e0e0e0; margin: 0; }
  button {
    background: #4ecca3; color: #000; border: none; padding: 8px 16px; border-radius: 4px;
    cursor: pointer; font-family: monospace; font-weight: bold; margin-top: 0.8rem;
  }
  button:hover { background: #3ba88a; }
  button:disabled { background: #555; cursor: not-allowed; }
  button.danger { background: #e74c3c; color: #fff; }
  button.danger:hover { background: #c0392b; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; }
  .status.running { background: #e2b714; color: #000; }
  .status.done { background: #4ecca3; color: #000; }
  .status.failed { background: #e74c3c; color: #fff; }
  .status.idle { background: #555; }
  .run-card { margin: 0.5rem 0; padding: 0.6rem; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; }
  .run-card summary { cursor: pointer; font-size: 0.85rem; }
  .run-card pre { margin: 0.4rem 0 0; font-size: 0.75rem; max-height: 200px; overflow-y: auto; color: #8b949e; white-space: pre-wrap; }
  .param-row { display: none; }
  .param-row.visible { display: block; }
  .flash { padding: 0.5rem 1rem; border-radius: 4px; margin: 0.5rem 0; font-size: 0.85rem; }
  .flash.ok { background: #1a3a2a; border: 1px solid #4ecca3; color: #4ecca3; }
  .flash.err { background: #3a1a1a; border: 1px solid #e74c3c; color: #e74c3c; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 700px) { .two-col { grid-template-columns: 1fr; } }
</style>
</head><body>
<h1>Novel Harness — Operations Panel</h1>
<nav><a id="dash-link" href="/">&larr; Dashboard</a></nav>

<div id="flash"></div>

<!-- Novel Creation -->
<h2>Novel Creation</h2>
<div class="card">
  <label for="novel-seed">Seed</label>
  <select id="novel-seed"></select>
  <button id="btn-novel" onclick="runNovel()">Create Novel</button>
</div>

<!-- Benchmark Runner -->
<h2>Benchmark Runner</h2>
<div class="card">
  <label for="bench-suite">Suite</label>
  <select id="bench-suite" onchange="onSuiteChange()"></select>

  <div id="bench-params"></div>

  <div id="batch-row" class="param-row">
    <label><input type="checkbox" id="bench-batch"> Batch mode (async judges, 50% off)</label>
  </div>

  <button id="btn-bench" onclick="runBenchmark()">Run Benchmark</button>
</div>

<!-- Active Runs -->
<h2>Active Runs</h2>
<div id="runs-container"><span style="color:#555">Loading...</span></div>

<!-- Improvement Daemon -->
<h2>Improvement Daemon</h2>
<div class="card">
  <div id="daemon-status" style="margin-bottom:0.8rem"><span class="status idle">loading...</span></div>
  <div class="two-col">
    <div>
      <label for="imp-target">Target</label>
      <select id="imp-target" onchange="onTargetChange()"></select>
      <label for="imp-dimension">Dimension</label>
      <select id="imp-dimension"></select>
    </div>
    <div>
      <label for="imp-iters">Max iterations</label>
      <input type="number" id="imp-iters" value="15">
      <label for="imp-cost">Max cost ($, optional)</label>
      <input type="number" id="imp-cost" step="0.1">
    </div>
  </div>
  <button id="btn-imp" onclick="startImprovement()">Start Improvement</button>
</div>

<script>
const key = new URLSearchParams(location.search).get('key') || ''
const h = {'x-api-key': key, 'Content-Type': 'application/json'}
let config = null

document.getElementById('dash-link').href = '/?key=' + encodeURIComponent(key)

function flash(msg, ok) {
  const el = document.getElementById('flash')
  el.innerHTML = '<div class="flash ' + (ok ? 'ok' : 'err') + '">' + msg + '</div>'
  setTimeout(() => el.innerHTML = '', 5000)
}

async function loadConfig() {
  config = await fetch('/api/config/operations?key=' + key).then(r => r.json())

  // Seeds dropdown
  const seedSel = document.getElementById('novel-seed')
  for (const s of config.seeds) {
    seedSel.innerHTML += '<option value="' + s + '">' + s + '</option>'
  }

  // Suite dropdown
  const suiteSel = document.getElementById('bench-suite')
  for (const [name, cfg] of Object.entries(config.benchmarks)) {
    suiteSel.innerHTML += '<option value="' + name + '">' + cfg.displayName + '</option>'
  }

  // Improvement targets
  const targetSel = document.getElementById('imp-target')
  for (const t of config.targets) {
    targetSel.innerHTML += '<option value="' + t + '">' + t + '</option>'
  }

  onSuiteChange()
  onTargetChange()
}

function onSuiteChange() {
  const suite = document.getElementById('bench-suite').value
  const container = document.getElementById('bench-params')
  container.innerHTML = ''

  for (const v of config.envVars) {
    if (!v.applies.includes('all') && !v.applies.includes(suite)) continue

    let html = '<div class="param-row visible"><label>' + v.name + '</label>'
    if (v.type === 'multi-select' && v.options) {
      html += '<div class="checkbox-group">'
      for (const opt of v.options) {
        html += '<label><input type="checkbox" data-env="' + v.name + '" value="' + opt + '"> ' + opt + '</label>'
      }
      html += '</div>'
    } else if (v.type === 'select' && v.options) {
      html += '<select data-env="' + v.name + '"><option value="">—</option>'
      for (const opt of v.options) {
        html += '<option value="' + opt + '"' + (v.default === opt ? ' selected' : '') + '>' + opt + '</option>'
      }
      html += '</select>'
    } else if (v.type === 'number') {
      html += '<input type="number" data-env="' + v.name + '" value="' + (v.default || '') + '" placeholder="' + (v.default || '') + '">'
    } else {
      html += '<input type="text" data-env="' + v.name + '" value="' + (v.default || '') + '" placeholder="' + (v.default || '') + '">'
    }
    html += '</div>'
    container.innerHTML += html
  }

  // Show batch checkbox only for prose
  const batchRow = document.getElementById('batch-row')
  batchRow.className = 'param-row' + (config.benchmarks[suite]?.supportsBatch ? ' visible' : '')
}

function onTargetChange() {
  const target = document.getElementById('imp-target').value
  const dimSel = document.getElementById('imp-dimension')
  dimSel.innerHTML = '<option value="">auto (weakest)</option>'
  const bench = config.benchmarks[target]
  if (bench) {
    for (const d of bench.dimensions) {
      const lbl = bench.dimensionLabels[d] || d
      dimSel.innerHTML += '<option value="' + d + '">' + lbl + '</option>'
    }
  }
}

function collectEnv() {
  const env = {}
  // Multi-select checkboxes
  document.querySelectorAll('#bench-params input[type=checkbox]:checked').forEach(cb => {
    const name = cb.dataset.env
    env[name] = env[name] ? env[name] + ',' + cb.value : cb.value
  })
  // Selects and inputs
  document.querySelectorAll('#bench-params select[data-env], #bench-params input[data-env]:not([type=checkbox])').forEach(el => {
    if (el.value) env[el.dataset.env] = el.value
  })
  return env
}

async function runBenchmark() {
  const suite = document.getElementById('bench-suite').value
  const batch = document.getElementById('bench-batch').checked
  const env = collectEnv()

  document.getElementById('btn-bench').disabled = true
  try {
    const res = await fetch('/api/run/benchmark', {
      method: 'POST', headers: h,
      body: JSON.stringify({ suite, env, batch })
    }).then(r => r.json())
    if (res.error) { flash(res.error, false); return }
    flash('Started ' + suite + ' benchmark (PID ' + res.pid + ')', true)
    refreshRuns()
  } catch (e) { flash('Error: ' + e.message, false) }
  finally { document.getElementById('btn-bench').disabled = false }
}

async function runNovel() {
  const seed = document.getElementById('novel-seed').value
  document.getElementById('btn-novel').disabled = true
  try {
    const res = await fetch('/api/run/novel', {
      method: 'POST', headers: h,
      body: JSON.stringify({ seed })
    }).then(r => r.json())
    if (res.error) { flash(res.error, false); return }
    flash('Started novel creation (PID ' + res.pid + ')', true)
    refreshRuns()
  } catch (e) { flash('Error: ' + e.message, false) }
  finally { document.getElementById('btn-novel').disabled = false }
}

async function startImprovement() {
  const target = document.getElementById('imp-target').value
  const dimension = document.getElementById('imp-dimension').value
  const maxIterations = parseInt(document.getElementById('imp-iters').value) || undefined
  const maxCostUsd = parseFloat(document.getElementById('imp-cost').value) || undefined

  const body = {}
  if (target) body.target = target
  if (dimension) body.dimension = dimension
  if (maxIterations) body.maxIterations = maxIterations
  if (maxCostUsd) body.maxCostUsd = maxCostUsd

  try {
    const res = await fetch('/api/improvement/start', {
      method: 'POST', headers: h,
      body: JSON.stringify(body)
    }).then(r => r.json())
    if (res.error) { flash(res.error, false); return }
    flash('Improvement started: ' + (target || 'auto') + '/' + (dimension || 'auto'), true)
    refreshDaemon()
  } catch (e) { flash('Error: ' + e.message, false) }
}

async function refreshRuns() {
  try {
    const runs = await fetch('/api/run/active?key=' + key).then(r => r.json())
    const container = document.getElementById('runs-container')
    if (runs.length === 0) { container.innerHTML = '<span style="color:#555">No recent runs</span>'; return }

    container.innerHTML = runs.map(r => {
      const cls = r.running ? 'running' : (r.exitCode === 0 ? 'done' : 'failed')
      const lbl = r.running ? 'running' : (r.exitCode === 0 ? 'done' : 'exit ' + r.exitCode)
      const time = new Date(r.startedAt).toLocaleTimeString()
      return '<details class="run-card"><summary>'
        + '<span class="status ' + cls + '">' + lbl + '</span> '
        + '<strong>' + r.label + '</strong> '
        + '<span style="color:#555">PID ' + r.pid + ' &middot; ' + time + ' &middot; ' + r.stdoutLines + ' lines</span>'
        + '</summary><pre>' + escHtml(r.stdout) + '</pre></details>'
    }).join('')
  } catch {}
}

async function refreshDaemon() {
  try {
    const s = await fetch('/api/improvement/status?key=' + key).then(r => r.json())
    const el = document.getElementById('daemon-status')
    if (s.active) {
      const c = s.cycle
      el.innerHTML = '<span class="status running">ACTIVE</span> '
        + c.target + '/' + c.dimension
        + ' &mdash; iter ' + c.iteration + '/' + c.limits.maxIterations
        + ', score: ' + c.currentScore
        + ', cost: $' + (c.actualCost ?? 0).toFixed(4)
    } else {
      el.innerHTML = '<span class="status idle">IDLE</span> No active cycle'
    }
  } catch {}
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

loadConfig()
refreshRuns()
refreshDaemon()
setInterval(refreshRuns, 5000)
setInterval(refreshDaemon, 15000)
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

    // Panel — unauthenticated (key passed as query param for API calls)
    if (path === "/panel" && req.method === "GET") {
      return new Response(panelHtml(), { headers: { "Content-Type": "text/html" } })
    }

    // Health — unauthenticated
    if (path === "/health") return Response.json({ status: "ok", service: "novel-harness-orchestrator" })

    // React app static files — unauthenticated (key passed as query param for API calls)
    const UI_DIST = resolve(import.meta.dir, "../../ui/dist")
    if (path.startsWith("/app")) {
      if (path.startsWith("/app/assets/")) {
        const filePath = resolve(UI_DIST, path.replace("/app/", ""))
        const file = Bun.file(filePath)
        if (await file.exists()) {
          const ext = filePath.split(".").pop()
          const contentType = ext === "js" ? "application/javascript"
            : ext === "css" ? "text/css"
            : ext === "svg" ? "image/svg+xml"
            : "application/octet-stream"
          return new Response(file, { headers: { "Content-Type": contentType } })
        }
      }
      const indexFile = Bun.file(resolve(UI_DIST, "index.html"))
      if (await indexFile.exists()) {
        return new Response(indexFile, { headers: { "Content-Type": "text/html" } })
      }
      return new Response("React app not built. Run: cd ui && bun install && bunx vite build", { status: 503 })
    }

    // Everything else requires auth
    const authErr = checkAuth(req)
    if (authErr) return authErr

    // ── Operations config ───────────────────────────────────────────
    if (path === "/api/config/operations" && req.method === "GET") {
      return Response.json(buildOperationsConfig())
    }

    // ── Process spawning ────────────────────────────────────────────
    if (path === "/api/run/benchmark" && req.method === "POST") {
      try {
        const body = await req.json() as { suite: string; env?: Record<string, string>; batch?: boolean }
        if (!BENCHMARKS[body.suite]) return Response.json({ error: `Unknown suite: ${body.suite}` }, { status: 400 })
        const pid = spawnBenchmark(body.suite, body.env ?? {}, body.batch ?? false)
        return Response.json({ ok: true, pid, suite: body.suite, startedAt: new Date().toISOString() })
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 })
      }
    }

    if (path === "/api/run/novel" && req.method === "POST") {
      try {
        const body = await req.json() as { seed?: string }
        const pid = spawnNovel(body.seed)
        return Response.json({ ok: true, pid, seed: body.seed, startedAt: new Date().toISOString() })
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 400 })
      }
    }

    if (path === "/api/run/active" && req.method === "GET") {
      return Response.json(getActiveRuns())
    }

    const runStatusMatch = path.match(/^\/api\/run\/status\/(\d+)$/)
    if (runStatusMatch && req.method === "GET") {
      const pid = parseInt(runStatusMatch[1])
      const status = getProcessStatus(pid)
      if (!status) return Response.json({ error: "Not found" }, { status: 404 })
      return Response.json(status)
    }

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

    // ── Improvement ─────────────────────────────────────────────────
    if (path === "/api/improvement/status" && req.method === "GET") {
      return Response.json(await getDaemonStatus())
    }

    if (path === "/api/improvement/diagnose" && req.method === "POST") {
      const diagnosis = await diagnose()
      return Response.json({ diagnosis, availableTargets: Object.keys(TARGETS) })
    }

    if (path === "/api/improvement/start" && req.method === "POST") {
      const status = await getDaemonStatus()
      if (status.active) return Response.json({ error: "Cycle already active", cycleId: status.cycle?.id })

      const body = await req.json().catch(() => ({})) as Record<string, any>
      const override = body.target && body.dimension
        ? { target: body.target as string, dimension: body.dimension as string }
        : undefined

      if (override && !TARGETS[override.target]) {
        return Response.json({ error: `Unknown target: ${override.target}`, availableTargets: Object.keys(TARGETS) }, { status: 400 })
      }

      const limits: Record<string, any> = {}
      if (body.maxIterations != null) limits.maxIterations = parseInt(body.maxIterations)
      if (body.maxCostUsd != null) limits.maxCostUsd = parseFloat(body.maxCostUsd)
      if (body.maxConsecutiveFailures != null) limits.maxConsecutiveFailures = parseInt(body.maxConsecutiveFailures)

      startCycle("manual", override, Object.keys(limits).length > 0 ? limits : undefined).catch(err => console.error("[daemon] Manual start error:", err))
      return Response.json({ ok: true, status: "starting", target: override?.target, dimension: override?.dimension, limits })
    }

    const reportMatch = path.match(/^\/api\/improvement\/report\/(\d+)$/)
    if (reportMatch && req.method === "GET") {
      const id = parseInt(reportMatch[1])
      const cycle = await (await import("./db")).default`SELECT * FROM improvement_cycles WHERE id = ${id}`
      const iterations = await (await import("./db")).default`SELECT * FROM improvement_iterations WHERE cycle_id = ${id} ORDER BY iteration_num`
      if (cycle.length === 0) return Response.json({ error: "Not found" }, { status: 404 })
      return Response.json({ cycle: cycle[0], iterations })
    }

    // ── Novel step-through API ──────────────────────────────────────
    const novelResponse = await handleNovelRoute(req, url)
    if (novelResponse) return novelResponse

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


console.log(`Orchestrator running at http://localhost:${server.port}`)
console.log(`Dashboard: http://localhost:${server.port}/?key=${API_KEY}`)
console.log(`Panel: http://localhost:${server.port}/panel?key=${API_KEY}`)
console.log(`Novel UI: http://localhost:${server.port}/app?key=${API_KEY}`)
console.log(`Improvement daemon: manual trigger only`)
