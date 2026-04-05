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

function navBarHtml(activePage: "dashboard" | "panel" | "novels" | "config" | "experiments" | "guide"): string {
  const items = [
    { id: "novels", label: "Novels", href: "/app" },
    { id: "config", label: "Config", href: "/app/config" },
    { id: "experiments", label: "Experiments", href: "/app/experiments" },
    { id: "guide", label: "Guide", href: "/app/guide" },
    { id: "dashboard", label: "Dashboard", href: "/" },
    { id: "panel", label: "Operations", href: "/panel" },
  ]
  const links = items.map(i => {
    const cls = i.id === activePage ? "nav-active" : ""
    const href = i.href + (i.href.includes("?") ? "&" : "?") + "key=" + "' + encodeURIComponent(key) + '"
    return `<a href="${i.href}?key=' + encodeURIComponent(key) + '" class="nh-nav-link ${cls}">${i.label}</a>`
  }).join("")
  return `<nav class="nh-nav">${links}</nav>`
}

const NAV_CSS = `
  .nh-nav { display: flex; align-items: center; gap: 2px; background: #16213e; border: 1px solid #0f3460; border-radius: 6px; padding: 3px; margin-bottom: 1.5rem; overflow-x: auto; }
  .nh-nav-link { padding: 6px 14px; border-radius: 4px; font-size: 0.82rem; color: #8b949e; text-decoration: none; white-space: nowrap; transition: all 0.15s; font-family: monospace; }
  .nh-nav-link:hover { color: #e0e0e0; background: #0d1117; }
  .nh-nav-link.nav-active { color: #4ecca3; background: #0d1117; font-weight: bold; }
`

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Novel Harness Orchestrator</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { color: #4ecca3; font-size: 1.4rem; }
  ${NAV_CSS}
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
<script>const key = new URLSearchParams(location.search).get('key') || ''</script>
${navBarHtml("dashboard")}
<h1>Novel Harness Orchestrator</h1>
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
  { name: "BENCHMARK_SEEDS", applies: ["prose", "planning"], type: "multi-select", optionsFrom: "seeds",
    description: "Which seed stories to test against. Leave empty for all." },
  { name: "BENCHMARK_RUNS", applies: ["all"], type: "number", default: "3",
    description: "Number of runs per seed/sample. Higher = more statistical confidence, more cost." },
  { name: "BENCHMARK_SAMPLES", applies: ["extraction"], type: "number",
    description: "Max chapters to test extraction on. Leave empty for all available." },
  { name: "BENCHMARK_AGENT", applies: ["extraction"], type: "select", options: ["summary-extractor", "fact-extractor", "character-state"],
    description: "Test a single extraction agent in isolation instead of all three." },
  { name: "BENCHMARK_FIXTURES", applies: ["continuity"], type: "multi-select", optionsFrom: "fixtures",
    description: "Which continuity test fixtures to use. Leave empty for all." },
  { name: "EXPERIMENT_ID", applies: ["all"], type: "select", optionsFrom: "experiments",
    description: "Link this run to an existing experiment for tracking. Required for all runs." },
  { name: "BATCH_PROVIDER", applies: ["prose"], type: "select", optionsFrom: "batchProviders", default: "openai",
    description: "Which provider's batch API to use. Batch = 50% off but async (results in hours)." },
  { name: "BATCH_MODEL", applies: ["prose"], type: "select", optionsFrom: "batchModels", default: "gpt-5.4-mini",
    description: "Model for batch judge calls. Must be from the selected batch provider." },
  { name: "LLM_TRANSPORT", applies: ["all"], type: "select", options: ["direct", "batch"],
    description: "Direct = real-time. Batch = async batch API (50% off)." },
] as const

async function buildOperationsConfig() {
  const seeds = readdirSync(resolve(HARNESS_ROOT, "src/seeds"))
    .filter(f => f.endsWith(".json"))
    .map(f => basename(f, ".json"))

  const fixtures = readdirSync(resolve(HARNESS_ROOT, "benchmark/continuity/fixtures"))
    .filter(f => f.endsWith(".json"))
    .map(f => basename(f, ".json"))

  // Load model registry for judge/batch options
  const { MODELS, PROVIDERS } = await import("../../models/registry")
  const { isModelHidden } = await import("../../models/hidden")

  const visibleModels = MODELS.filter(m => !isModelHidden(m.provider, m.id))

  const judges = visibleModels
    .filter(m => !m.label.includes("8B")) // exclude tiny models unsuitable for judging
    .map(m => m.label)
    .filter((v, i, a) => a.indexOf(v) === i) // dedupe

  const batchProviders = Object.entries(PROVIDERS)
    .filter(([_, p]) => p.batchApi?.available)
    .map(([name]) => name)

  const batchModels = visibleModels
    .filter(m => batchProviders.includes(m.provider))
    .map(m => m.label)
    .filter((v, i, a) => a.indexOf(v) === i)

  // Load recent experiments from DB
  let experiments: string[] = []
  try {
    const { default: sql } = await import("./db")
    const rows = await sql`SELECT id, description FROM tuning_experiments ORDER BY id DESC LIMIT 50`
    experiments = rows.map((r: any) => `${r.id}`)
  } catch {}

  const optionSources: Record<string, string[]> = {
    seeds, fixtures, judges, batchProviders, batchModels, experiments,
  }

  // Load agent configs for "agent under test" display
  const { getAgentConfig } = await import("../../models/roles")

  const benchmarks: Record<string, any> = {}
  for (const [name, cfg] of Object.entries(BENCHMARKS)) {
    // Resolve the agents being tested and their current model config
    const agentsUnderTest = (cfg.promptTargets ?? []).map((t: any) => {
      // For prose benchmark, the actual agent used is benchmark-writer
      const effectiveName = name === "prose" && t.agentName === "writer" ? "benchmark-writer" : t.agentName
      const agentCfg = getAgentConfig(effectiveName)
      return {
        agentName: t.agentName,
        effectiveName,
        provider: agentCfg?.provider,
        model: agentCfg?.model,
        temperature: agentCfg?.temperature,
        label: MODELS.find(m => m.id === agentCfg?.model && m.provider === agentCfg?.provider)?.label ?? agentCfg?.model,
      }
    })

    // Judge config
    const judgeCfg = getAgentConfig("benchmark-judge")
    const judgeLabel = MODELS.find(m => m.id === judgeCfg?.model && m.provider === judgeCfg?.provider)?.label ?? judgeCfg?.model

    benchmarks[name] = {
      displayName: cfg.displayName,
      scoring: cfg.scoring,
      dimensions: cfg.dimensions,
      dimensionLabels: cfg.dimensionLabels,
      runCmd: cfg.runCmd,
      supportsBatch: name === "prose",
      agentsUnderTest,
      judge: judgeCfg ? { provider: judgeCfg.provider, model: judgeCfg.model, label: judgeLabel } : null,
    }
  }

  const envVars = ENV_VAR_DEFS.map(v => {
    const out: Record<string, any> = { name: v.name, applies: v.applies, type: v.type }
    if ("default" in v) out.default = v.default
    if ("description" in v) out.description = v.description
    if ("options" in v && v.options) out.options = v.options
    if ("optionsFrom" in v) {
      out.options = optionSources[v.optionsFrom] ?? []
    }
    return out
  })

  const allModels = visibleModels.map(m => ({ label: m.label, id: m.id, provider: m.provider, pricing: m.pricing }))
  const allProviders = Object.keys(PROVIDERS)

  return { seeds, fixtures, benchmarks, envVars, targets: Object.keys(TARGETS), models: allModels, providers: allProviders }
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
<h2 title="Create a novel using --auto mode with a seed file. For interactive step-through, use the Novel UI.">Novel Creation <span style="color:#555;font-size:0.75rem">(?)</span></h2>
<div class="card">
  <label for="novel-seed" title="Pre-built story inputs in src/seeds/. Each has a premise, genre, and character sketches.">Seed <span style="color:#555;font-size:0.75rem">(?)</span></label>
  <select id="novel-seed"></select>
  <button id="btn-novel" onclick="runNovel()">Create Novel</button>
  <p style="font-size:0.75rem;color:#555;margin-top:0.5rem">Runs --auto (no gates). For interactive review: <a id="novel-ui-link" href="/app" style="color:#58a6ff">Novel UI</a></p>
</div>

<!-- Benchmark Runner -->
<h2 title="Run benchmark suites to evaluate agent performance. Each suite tests a different capability.">Benchmark Runner <span style="color:#555;font-size:0.75rem">(?)</span></h2>
<div class="card">
  <label for="bench-suite" title="Which benchmark suite to run. Each tests a different pipeline capability.">Suite <span style="color:#555;font-size:0.75rem">(?)</span></label>
  <select id="bench-suite" onchange="onSuiteChange()"></select>

  <div id="bench-params"></div>

  <div id="batch-row" class="param-row">
    <label><input type="checkbox" id="bench-batch"> Batch mode (async judges, 50% off)</label>
  </div>

  <button id="btn-bench" onclick="runBenchmark()">Run Benchmark</button>
</div>

<!-- Active Runs -->
<h2 title="Currently running and recently completed benchmark/novel processes.">Active Runs <span style="color:#555;font-size:0.75rem">(?)</span></h2>
<div id="runs-container"><span style="color:#555">Loading...</span></div>

<!-- Improvement Daemon -->
<h2 title="Autonomous prompt tuning. Diagnoses weakest dimensions, proposes prompt changes, benchmarks, keeps/reverts.">Improvement Daemon <span style="color:#555;font-size:0.75rem">(?)</span></h2>
<div class="card">
  <div id="daemon-status" style="margin-bottom:0.8rem"><span class="status idle">loading...</span></div>
  <div id="imp-agents"></div>
  <div class="two-col">
    <div>
      <label for="imp-target" title="Which benchmark suite to improve.">Target <span style="color:#555;font-size:0.75rem">(?)</span></label>
      <select id="imp-target" onchange="onTargetChange()"></select>
      <label for="imp-dimension" title="Which scoring dimension to focus on. Auto picks weakest.">Dimension <span style="color:#555;font-size:0.75rem">(?)</span></label>
      <select id="imp-dimension"></select>
    </div>
    <div>
      <label for="imp-iters">Max iterations</label>
      <input type="number" id="imp-iters" value="15">
      <label for="imp-cost">Max cost ($, optional)</label>
      <input type="number" id="imp-cost" step="0.1">
    </div>
  </div>
  <div style="margin-top:0.5rem">
    <label title="When locked, stays on the selected target/dimension for all iterations. When unlocked, may switch to a different dimension after each improvement."><input type="checkbox" id="imp-locked" checked> Lock dimension (focused) <span style="color:#555;font-size:0.75rem">(?)</span></label>
  </div>
  <button id="btn-imp" onclick="startImprovement()">Start Improvement</button>
</div>

<script>
const key = new URLSearchParams(location.search).get('key') || ''
const h = {'x-api-key': key, 'Content-Type': 'application/json'}
let config = null

document.getElementById('dash-link').href = '/?key=' + encodeURIComponent(key)
if (document.getElementById('novel-ui-link')) document.getElementById('novel-ui-link').href = '/app?key=' + encodeURIComponent(key)

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

function wireAgentDropdowns(providerId, modelId, statusId, agentName, priceId) {
  const pSel = document.getElementById(providerId)
  const mSel = document.getElementById(modelId)
  const status = document.getElementById(statusId)
  const priceEl = document.getElementById(priceId)
  if (!pSel || !mSel) return

  function updatePrice() {
    if (!priceEl) return
    var m = config.models.find(function(x) { return x.id === mSel.value && x.provider === pSel.value })
    if (m && m.pricing) {
      priceEl.textContent = '$' + m.pricing.input + '/$' + m.pricing.output + ' per 1M'
    } else {
      priceEl.textContent = ''
    }
  }

  pSel.addEventListener('change', function() {
    const provider = pSel.value
    mSel.innerHTML = ''
    config.models.filter(function(m) { return m.provider === provider }).forEach(function(m) {
      var price = m.pricing ? ' ($' + m.pricing.input + '/' + m.pricing.output + ')' : ''
      mSel.innerHTML += '<option value="' + m.id + '">' + m.label + price + '</option>'
    })
    updatePrice()
    saveAgentConfig(agentName, { provider: provider, model: mSel.value }, status)
  })
  mSel.addEventListener('change', function() {
    updatePrice()
    saveAgentConfig(agentName, { provider: pSel.value, model: mSel.value }, status)
  })
}

function saveAgentConfig(agentName, cfg, statusEl) {
  if (statusEl) statusEl.textContent = 'saving...'
  fetch('/api/novel/config/agent/' + encodeURIComponent(agentName), {
    method: 'PUT', headers: h,
    body: JSON.stringify(cfg)
  }).then(function(r) { return r.json() }).then(function(res) {
    if (statusEl) {
      statusEl.textContent = res.ok ? 'saved' : (res.error || 'error')
      statusEl.style.color = res.ok ? '#4ecca3' : '#e74c3c'
      setTimeout(function() { statusEl.textContent = '' }, 2000)
    }
  }).catch(function() {
    if (statusEl) { statusEl.textContent = 'error'; statusEl.style.color = '#e74c3c' }
  })
}

function onSuiteChange() {
  const suite = document.getElementById('bench-suite').value
  const container = document.getElementById('bench-params')
  container.innerHTML = ''

  // Show agents under test + judge with inline editing
  const bench = config.benchmarks[suite]
  if (bench) {
    let infoHtml = '<div style="margin-bottom:0.8rem;padding:0.6rem;background:#0d1117;border:1px solid #30363d;border-radius:4px;font-size:0.8rem">'

    // Agent under test — editable
    if (bench.agentsUnderTest && bench.agentsUnderTest.length > 0) {
      bench.agentsUnderTest.forEach(function(a, idx) {
        const pid = 'agent-provider-' + idx
        const mid = 'agent-model-' + idx
        infoHtml += '<div style="margin-bottom:0.5rem"><span style="color:#4ecca3">Testing:</span> <strong>' + a.agentName + '</strong>'
        infoHtml += '<div style="display:flex;gap:0.4rem;margin-top:0.3rem;align-items:center;flex-wrap:wrap">'
        // Provider select
        infoHtml += '<select id="' + pid + '" data-agent="' + a.effectiveName + '" style="width:auto;font-size:0.8rem;padding:3px 6px">'
        config.providers.forEach(function(p) {
          infoHtml += '<option value="' + p + '"' + (p === a.provider ? ' selected' : '') + '>' + p + '</option>'
        })
        infoHtml += '</select>'
        // Model select
        infoHtml += '<select id="' + mid + '" data-agent="' + a.effectiveName + '" style="width:auto;font-size:0.8rem;padding:3px 6px">'
        config.models.filter(function(m) { return m.provider === a.provider }).forEach(function(m) {
          var price = m.pricing ? ' ($' + m.pricing.input + '/' + m.pricing.output + ')' : ''
          infoHtml += '<option value="' + m.id + '"' + (m.id === a.model ? ' selected' : '') + '>' + m.label + price + '</option>'
        })
        infoHtml += '</select>'
        // Show current pricing
        var curModel = config.models.find(function(m) { return m.id === a.model && m.provider === a.provider })
        if (curModel && curModel.pricing) {
          infoHtml += '<span id="agent-price-' + idx + '" style="color:#4ecca3;font-size:0.75rem">$' + curModel.pricing.input + '/$' + curModel.pricing.output + ' per 1M</span>'
        }
        infoHtml += '<span id="agent-save-' + idx + '" style="color:#555;font-size:0.75rem"></span>'
        infoHtml += '</div></div>'
      })
    }

    // Judge — editable
    if (bench.judge) {
      var judgeModel = config.models.find(function(m) { return m.id === bench.judge.model && m.provider === bench.judge.provider })
      infoHtml += '<div style="margin-bottom:0.3rem"><span style="color:#e2b714">Judge:</span>'
      infoHtml += '<div style="display:flex;gap:0.4rem;margin-top:0.3rem;align-items:center;flex-wrap:wrap">'
      infoHtml += '<select id="judge-provider" style="width:auto;font-size:0.8rem;padding:3px 6px">'
      config.providers.forEach(function(p) {
        infoHtml += '<option value="' + p + '"' + (p === bench.judge.provider ? ' selected' : '') + '>' + p + '</option>'
      })
      infoHtml += '</select>'
      infoHtml += '<select id="judge-model" style="width:auto;font-size:0.8rem;padding:3px 6px">'
      config.models.filter(function(m) { return m.provider === bench.judge.provider }).forEach(function(m) {
        var price = m.pricing ? ' ($' + m.pricing.input + '/' + m.pricing.output + ')' : ''
        infoHtml += '<option value="' + m.id + '"' + (m.id === bench.judge.model ? ' selected' : '') + '>' + m.label + price + '</option>'
      })
      infoHtml += '</select>'
      if (judgeModel && judgeModel.pricing) {
        infoHtml += '<span id="judge-price" style="color:#4ecca3;font-size:0.75rem">$' + judgeModel.pricing.input + '/$' + judgeModel.pricing.output + ' per 1M</span>'
      }
      infoHtml += '<span id="judge-save-status" style="color:#555;font-size:0.75rem"></span>'
      infoHtml += '</div></div>'
    }

    infoHtml += '</div>'
    container.innerHTML += infoHtml

    if (bench.agentsUnderTest) {
      bench.agentsUnderTest.forEach(function(a, idx) {
        wireAgentDropdowns('agent-provider-' + idx, 'agent-model-' + idx, 'agent-save-' + idx, a.effectiveName, 'agent-price-' + idx)
      })
    }
    if (bench.judge) {
      wireAgentDropdowns('judge-provider', 'judge-model', 'judge-save-status', 'benchmark-judge', 'judge-price')
    }
  }

  for (const v of config.envVars) {
    if (!v.applies.includes('all') && !v.applies.includes(suite)) continue

    const desc = v.description ? ' title="' + v.description.replace(/"/g, '&quot;') + '"' : ''
    let html = '<div class="param-row visible"><label' + desc + ' style="cursor:help">' + v.name + (v.description ? ' <span style="color:#555;font-size:0.75rem">(?)</span>' : '') + '</label>'
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
  const agentsDiv = document.getElementById('imp-agents')
  dimSel.innerHTML = '<option value="">auto (weakest)</option>'
  agentsDiv.innerHTML = ''
  const bench = config.benchmarks[target]
  if (bench) {
    for (const d of bench.dimensions) {
      const lbl = bench.dimensionLabels[d] || d
      dimSel.innerHTML += '<option value="' + d + '">' + lbl + '</option>'
    }

    // Show agents under test + judge with inline editing
    var html = '<div style="margin-bottom:0.8rem;padding:0.6rem;background:#0d1117;border:1px solid #30363d;border-radius:4px;font-size:0.8rem">'
    if (bench.agentsUnderTest && bench.agentsUnderTest.length > 0) {
      bench.agentsUnderTest.forEach(function(a, idx) {
        var pid = 'imp-agent-provider-' + idx
        var mid = 'imp-agent-model-' + idx
        html += '<div style="margin-bottom:0.5rem"><span style="color:#4ecca3">Testing:</span> <strong>' + a.agentName + '</strong>'
        html += '<div style="display:flex;gap:0.4rem;margin-top:0.3rem;align-items:center;flex-wrap:wrap">'
        html += '<select id="' + pid + '" style="width:auto;font-size:0.8rem;padding:3px 6px">'
        config.providers.forEach(function(p) {
          html += '<option value="' + p + '"' + (p === a.provider ? ' selected' : '') + '>' + p + '</option>'
        })
        html += '</select>'
        html += '<select id="' + mid + '" style="width:auto;font-size:0.8rem;padding:3px 6px">'
        config.models.filter(function(m) { return m.provider === a.provider }).forEach(function(m) {
          var price = m.pricing ? ' ($' + m.pricing.input + '/$' + m.pricing.output + ')' : ''
          html += '<option value="' + m.id + '"' + (m.id === a.model ? ' selected' : '') + '>' + m.label + price + '</option>'
        })
        html += '</select>'
        var curModel = config.models.find(function(m) { return m.id === a.model && m.provider === a.provider })
        if (curModel && curModel.pricing) {
          html += '<span id="imp-agent-price-' + idx + '" style="color:#4ecca3;font-size:0.75rem">$' + curModel.pricing.input + '/$' + curModel.pricing.output + ' per 1M</span>'
        }
        html += '<span id="imp-agent-save-' + idx + '" style="color:#555;font-size:0.75rem"></span>'
        html += '</div></div>'
      })
    }
    if (bench.judge) {
      var judgeModel = config.models.find(function(m) { return m.id === bench.judge.model && m.provider === bench.judge.provider })
      html += '<div style="margin-bottom:0.3rem"><span style="color:#e2b714">Judge:</span>'
      html += '<div style="display:flex;gap:0.4rem;margin-top:0.3rem;align-items:center;flex-wrap:wrap">'
      html += '<select id="imp-judge-provider" style="width:auto;font-size:0.8rem;padding:3px 6px">'
      config.providers.forEach(function(p) {
        html += '<option value="' + p + '"' + (p === bench.judge.provider ? ' selected' : '') + '>' + p + '</option>'
      })
      html += '</select>'
      html += '<select id="imp-judge-model" style="width:auto;font-size:0.8rem;padding:3px 6px">'
      config.models.filter(function(m) { return m.provider === bench.judge.provider }).forEach(function(m) {
        var price = m.pricing ? ' ($' + m.pricing.input + '/$' + m.pricing.output + ')' : ''
        html += '<option value="' + m.id + '"' + (m.id === bench.judge.model ? ' selected' : '') + '>' + m.label + price + '</option>'
      })
      html += '</select>'
      if (judgeModel && judgeModel.pricing) {
        html += '<span id="imp-judge-price" style="color:#4ecca3;font-size:0.75rem">$' + judgeModel.pricing.input + '/$' + judgeModel.pricing.output + ' per 1M</span>'
      }
      html += '<span id="imp-judge-save" style="color:#555;font-size:0.75rem"></span>'
      html += '</div></div>'
    }
    html += '</div>'
    agentsDiv.innerHTML = html

    // Wire dropdowns
    if (bench.agentsUnderTest) {
      bench.agentsUnderTest.forEach(function(a, idx) {
        wireAgentDropdowns('imp-agent-provider-' + idx, 'imp-agent-model-' + idx, 'imp-agent-save-' + idx, a.effectiveName, 'imp-agent-price-' + idx)
      })
    }
    if (bench.judge) {
      wireAgentDropdowns('imp-judge-provider', 'imp-judge-model', 'imp-judge-save', 'benchmark-judge', 'imp-judge-price')
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

  const locked = document.getElementById('imp-locked').checked

  const body = { dimensionLocked: locked }
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

    // Redirect legacy pages to React app
    if (path === "/" && req.method === "GET") {
      const key = url.searchParams.get("key") ?? ""
      return Response.redirect(`/app/dashboard?key=${encodeURIComponent(key)}`, 302)
    }
    if (path === "/panel" && req.method === "GET") {
      const key = url.searchParams.get("key") ?? ""
      return Response.redirect(`/app/operations?key=${encodeURIComponent(key)}`, 302)
    }

    // Health — unauthenticated, CORS allowed (for homelab dashboard status checks)
    if (path === "/health") return Response.json(
      { status: "ok", service: "novel-harness-orchestrator" },
      { headers: { "Access-Control-Allow-Origin": "*" } },
    )

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
      return Response.json(await buildOperationsConfig())
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

    // ── Experiments (unified) ─────────────────────────────────────

    // Create experiment from workbench config
    if (path === "/api/experiments/create" && req.method === "POST") {
      try {
        const body = await req.json() as any
        if (!body.name || !body.suite || !body.models?.length) {
          return Response.json({ error: "name, suite, and models[] are required" }, { status: 400 })
        }

        const config = {
          name: body.name,
          suite: body.suite,
          models: body.models,
          evaluations: body.evaluations ?? { penaltyJudges: true, lint: true, pairwise: false },
          transport: body.transport ?? { generation: "realtime", judging: "realtime" },
          seeds: body.seeds ?? [],
          runsPerSeed: body.runsPerSeed ?? 2,
          judgeModel: body.judgeModel ?? null,
          sourceRunId: body.sourceRunId ?? null,
        }

        const { createTuningExperiment } = await import("../../data/db")
        const experimentId = await createTuningExperiment(
          "workbench", config.name, config,
          { target: config.suite, dimension: "all" },
        )

        // Spawn runner as subprocess
        const env: Record<string, string> = { ...process.env as Record<string, string>, EXPERIMENT_ID: String(experimentId) }
        const proc = Bun.spawn(["bun", "benchmark/workbench/runner.ts"], {
          env,
          stdout: "pipe",
          stderr: "pipe",
          cwd: process.cwd(),
        })

        // Track the process
        const pid = proc.pid
        processes.set(pid, {
          pid, label: `Workbench: ${config.name}`, running: true,
          stdout: "", startedAt: new Date().toISOString(),
        })

        // Collect output async
        ;(async () => {
          const reader = proc.stdout.getReader()
          const decoder = new TextDecoder()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const p = processes.get(pid)
              if (p) p.stdout += decoder.decode(value)
            }
          } catch {}
          const p = processes.get(pid)
          if (p) { p.running = false; p.exitCode = await proc.exited }
        })()

        return Response.json({ ok: true, experimentId, pid })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    if (path === "/api/experiments" && req.method === "GET") {
      try {
        const { getAllExperiments } = await import("../../data/db")
        const limit = parseInt(url.searchParams.get("limit") ?? "50")
        return Response.json(await getAllExperiments(limit))
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    const experimentDetailMatch = path.match(/^\/api\/experiments\/(\d+)$/)
    if (experimentDetailMatch && req.method === "GET") {
      try {
        const id = parseInt(experimentDetailMatch[1])
        const { getExperimentRuns, getExperimentScores, getExperimentCost, getExperimentLintSummary } = await import("../../data/db")
        const [runs, scores, cost, lint] = await Promise.all([
          getExperimentRuns(id), getExperimentScores(id), getExperimentCost(id), getExperimentLintSummary(id),
        ])
        // Get lineage
        const lineage = await (await import("./db")).default`
          SELECT el.*, te.description, te.target, te.dimension
          FROM experiment_lineage el
          JOIN tuning_experiments te ON te.id = el.parent_experiment_id
          WHERE el.experiment_id = ${id}
          ORDER BY el.created_at
        `
        return Response.json({ runs, scores, cost, lint, lineage })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Experiment generations (prose + scores + lint)
    const experimentGensMatch = path.match(/^\/api\/experiments\/(\d+)\/generations$/)
    if (experimentGensMatch && req.method === "GET") {
      try {
        const id = parseInt(experimentGensMatch[1])
        const limit = parseInt(url.searchParams.get("limit") ?? "20")
        const offset = parseInt(url.searchParams.get("offset") ?? "0")
        const { getExperimentGenerations } = await import("../../data/db")
        return Response.json(await getExperimentGenerations(id, limit, offset))
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Experiment diff (git show for commit)
    const experimentDiffMatch = path.match(/^\/api\/experiments\/(\d+)\/diff$/)
    if (experimentDiffMatch && req.method === "GET") {
      try {
        const id = parseInt(experimentDiffMatch[1])
        const compareId = url.searchParams.get("compare")
        const [exp] = await (await import("./db")).default`
          SELECT commit_hash FROM tuning_experiments WHERE id = ${id}
        ` as any[]
        if (!exp?.commit_hash) return Response.json({ diff: null, reason: "no commit hash" })

        if (compareId) {
          const [other] = await (await import("./db")).default`
            SELECT commit_hash FROM tuning_experiments WHERE id = ${parseInt(compareId)}
          ` as any[]
          if (!other?.commit_hash) return Response.json({ diff: null, reason: "compare experiment has no commit hash" })
          const proc = Bun.spawn(["git", "diff", `${other.commit_hash}..${exp.commit_hash}`, "--", "src/agents/", "benchmark/"], { stdout: "pipe", stderr: "pipe" })
          const diff = await new Response(proc.stdout).text()
          return Response.json({ diff, hashA: other.commit_hash, hashB: exp.commit_hash })
        } else {
          const proc = Bun.spawn(["git", "show", exp.commit_hash, "--stat", "--format=%H%n%s%n%ai"], { stdout: "pipe", stderr: "pipe" })
          const output = await new Response(proc.stdout).text()
          return Response.json({ diff: output, hash: exp.commit_hash })
        }
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Experiment markdown summary (for copy-to-clipboard)
    const experimentSummaryMatch = path.match(/^\/api\/experiments\/(\d+)\/summary$/)
    if (experimentSummaryMatch && req.method === "GET") {
      try {
        const id = parseInt(experimentSummaryMatch[1])
        const { getExperimentScores, getExperimentCost, getExperimentLintSummary } = await import("../../data/db")
        const [exp] = await (await import("./db")).default`
          SELECT id, experiment_type, description, conclusion, timestamp, commit_hash, target, dimension
          FROM tuning_experiments WHERE id = ${id}
        ` as any[]
        if (!exp) return Response.json({ error: "Not found" }, { status: 404 })

        const [scores, cost, lint] = await Promise.all([
          getExperimentScores(id), getExperimentCost(id), getExperimentLintSummary(id),
        ])

        // Build markdown table
        const variants = [...new Set(scores.map((s: any) => s.variantLabel))]
        const dimensions = [...new Set(scores.map((s: any) => s.dimension))]
        const totalCost = cost.reduce((s: number, c: any) => s + (c.totalCost ?? 0), 0)

        let md = `## Experiment #${exp.id}: ${exp.description}\n`
        md += `Commit: ${exp.commit_hash ?? "n/a"} | Cost: $${totalCost.toFixed(4)} | ${new Date(exp.timestamp).toLocaleDateString()}\n\n`

        if (variants.length > 0 && dimensions.length > 0) {
          md += `| Variant | ${dimensions.join(" | ")} |\n`
          md += `|${"-|".repeat(dimensions.length + 1)}\n`
          for (const v of variants) {
            const cells = dimensions.map(d => {
              const s = scores.find((x: any) => x.variantLabel === v && x.dimension === d)
              return s ? String(s.avg) : "n/a"
            })
            md += `| ${v} | ${cells.join(" | ")} |\n`
          }
        }

        // Lint summary
        const lintByVariant = new Map<string, number>()
        for (const l of lint as any[]) {
          lintByVariant.set(l.variantLabel, (lintByVariant.get(l.variantLabel) ?? 0) + l.count)
        }
        if (lintByVariant.size > 0) {
          md += `\nLint: ${[...lintByVariant.entries()].map(([v, c]) => `${v}: ${c}`).join(", ")}\n`
        }

        if (exp.conclusion) md += `\nConclusion: ${exp.conclusion}\n`

        return Response.json({ markdown: md })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Model registry for experiment builder
    if (path === "/api/models" && req.method === "GET") {
      try {
        const { MODELS } = await import("../../models/registry")
        const { isModelHidden } = await import("../../models/hidden")
        const models = MODELS
          .filter(m => !isModelHidden(m.provider, m.id))
          .map(m => ({
            id: m.id, label: m.label, provider: m.provider,
            pricing: m.pricing, maxOutput: (m as any).maxOutput,
          }))
        return Response.json(models)
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Seed list for experiment builder
    if (path === "/api/seeds" && req.method === "GET") {
      try {
        const { loadSeeds } = await import("../../benchmark/prose/shared")
        const seeds = loadSeeds()
        return Response.json(seeds.map(s => s.name))
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Rubric index
    if (path === "/api/rubrics" && req.method === "GET") {
      try {
        const { BENCHMARKS } = await import("../../benchmark/registry")
        const rubrics: Record<string, string[]> = {}
        for (const [name, config] of Object.entries(BENCHMARKS)) {
          rubrics[name] = [...config.dimensions]
        }
        // Add pairwise
        rubrics["pairwise"] = ["overall"]
        return Response.json(rubrics)
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // Individual rubric content
    const rubricMatch = path.match(/^\/api\/rubrics\/([^/]+)\/([^/]+)$/)
    if (rubricMatch && req.method === "GET") {
      try {
        const suite = rubricMatch[1]
        const dimension = rubricMatch[2]
        let filePath: string
        if (suite === "pairwise") {
          filePath = `${process.cwd()}/benchmark/pairwise/rubric.md`
        } else {
          const { BENCHMARKS } = await import("../../benchmark/registry")
          const config = BENCHMARKS[suite]
          if (!config) return Response.json({ error: `Unknown suite: ${suite}` }, { status: 404 })
          filePath = `${config.judgesDir}/${dimension}.md`
        }
        const file = Bun.file(filePath)
        if (!await file.exists()) return Response.json({ error: `Rubric not found: ${filePath}` }, { status: 404 })
        const content = await file.text()
        return Response.json({ suite, dimension, content })
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
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

      const dimensionLocked = body.dimensionLocked !== false  // default true
      startCycle("manual", override, Object.keys(limits).length > 0 ? limits : undefined, { dimensionLocked }).catch(err => console.error("[daemon] Manual start error:", err))
      return Response.json({ ok: true, status: "starting", target: override?.target, dimension: override?.dimension, limits, dimensionLocked })
    }

    // ── Experiment history ────────────────────────────────────────────
    if (path === "/api/improvement/history" && req.method === "GET") {
      try {
        const cycles = await (await import("./db")).default`
          SELECT ic.id, ic.target, ic.dimension, ic.dimension_locked,
                 ic.status, ic.total_iterations, ic.kept_count, ic.total_cost_usd,
                 ic.started_at, ic.finished_at, ic.summary, ic.experiment_id,
                 te.conclusion as experiment_conclusion
          FROM improvement_cycles ic
          LEFT JOIN tuning_experiments te ON te.id = ic.experiment_id
          ORDER BY ic.id DESC LIMIT 50
        `
        return Response.json(cycles)
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    if (path === "/api/improvement/continue" && req.method === "POST") {
      const status = await getDaemonStatus()
      if (status.active) return Response.json({ error: "Cycle already active", cycleId: status.cycle?.id })

      const body = await req.json().catch(() => ({})) as Record<string, any>
      if (!body.cycleId) return Response.json({ error: "cycleId required" }, { status: 400 })

      // Look up the parent cycle's target/dimension
      const parentCycles = await (await import("./db")).default`
        SELECT target, dimension, experiment_id FROM improvement_cycles WHERE id = ${parseInt(body.cycleId)}
      ` as any[]
      if (parentCycles.length === 0) return Response.json({ error: "Cycle not found" }, { status: 404 })

      const parent = parentCycles[0]
      if (!parent.target || !parent.dimension) return Response.json({ error: "Parent cycle has no target/dimension" }, { status: 400 })

      const limits: Record<string, any> = {}
      if (body.maxIterations != null) limits.maxIterations = parseInt(body.maxIterations)
      if (body.maxCostUsd != null) limits.maxCostUsd = parseFloat(body.maxCostUsd)

      startCycle("manual", { target: parent.target, dimension: parent.dimension }, Object.keys(limits).length > 0 ? limits : undefined, { dimensionLocked: true })
        .catch(err => console.error("[daemon] Continue error:", err))

      return Response.json({ ok: true, target: parent.target, dimension: parent.dimension, parentCycleId: body.cycleId })
    }

    const reportMatch = path.match(/^\/api\/improvement\/report\/(\d+)$/)
    if (reportMatch && req.method === "GET") {
      const id = parseInt(reportMatch[1])
      const cycle = await (await import("./db")).default`SELECT * FROM improvement_cycles WHERE id = ${id}`
      const iterations = await (await import("./db")).default`SELECT * FROM improvement_iterations WHERE cycle_id = ${id} ORDER BY iteration_num`
      if (cycle.length === 0) return Response.json({ error: "Not found" }, { status: 404 })
      return Response.json({ cycle: cycle[0], iterations })
    }

    // ── Retrieval Config API ─────────────────────────────────────────
    if (path === "/api/retrieval-config/defaults" && req.method === "GET") {
      const { DEFAULT_CONFIG } = await import("../db/retrieval")
      return Response.json({ novelId: "defaults", ...DEFAULT_CONFIG })
    }

    const retrievalMatch = path.match(/^\/api\/retrieval-config\/([^/]+)$/)
    if (retrievalMatch && req.method === "GET") {
      const novelId = decodeURIComponent(retrievalMatch[1])
      const { getRetrievalConfig } = await import("../db/retrieval")
      const config = await getRetrievalConfig(novelId)
      return Response.json({ novelId, ...config })
    }

    if (retrievalMatch && req.method === "PUT") {
      const novelId = decodeURIComponent(retrievalMatch[1])
      const body = await req.json() as Record<string, any>
      const { saveRetrievalConfig } = await import("../db/retrieval")
      await saveRetrievalConfig(novelId, body)
      return Response.json({ ok: true })
    }

    // ── Deterministic Config API ──────────────────────────────────────
    if (path === "/api/deterministic-config/defaults" && req.method === "GET") {
      const { DEFAULT_DETERMINISTIC_CONFIG } = await import("../harness/deterministic")
      return Response.json({ novelId: "defaults", ...DEFAULT_DETERMINISTIC_CONFIG })
    }

    const detMatch = path.match(/^\/api\/deterministic-config\/([^/]+)$/)
    if (detMatch && req.method === "GET") {
      const novelId = decodeURIComponent(detMatch[1])
      const { getDeterministicConfig } = await import("../harness/deterministic")
      const config = await getDeterministicConfig(novelId)
      return Response.json({ novelId, ...config })
    }

    if (detMatch && req.method === "PUT") {
      const novelId = decodeURIComponent(detMatch[1])
      const body = await req.json() as Record<string, any>
      const { saveDeterministicConfig } = await import("../harness/deterministic")
      await saveDeterministicConfig(novelId, body)
      return Response.json({ ok: true })
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
