import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { SearchableSelect } from "./SearchableSelect"

const API_KEY = new URLSearchParams(window.location.search).get("key") ?? ""
const headers: Record<string, string> = { "x-api-key": API_KEY, "Content-Type": "application/json" }

interface BenchmarkConfig {
  displayName: string
  scoring: string
  dimensions: string[]
  dimensionLabels: Record<string, string>
  supportsBatch: boolean
  agentsUnderTest: Array<{ agentName: string; effectiveName: string; provider: string; model: string; temperature: number; label: string }>
  judge: { provider: string; model: string; label: string } | null
}

interface EnvVarDef {
  name: string
  applies: string[]
  type: string
  options?: string[]
  default?: string
  description?: string
}

interface OpsConfig {
  seeds: string[]
  benchmarks: Record<string, BenchmarkConfig>
  envVars: EnvVarDef[]
  targets: string[]
  models: Array<{ label: string; id: string; provider: string; pricing?: { input: number; output: number } }>
  providers: string[]
}

export function OperationsPage() {
  const [config, setConfig] = useState<OpsConfig | null>(null)
  const [suite, setSuite] = useState("")
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [batchMode, setBatchMode] = useState(false)
  const [impTarget, setImpTarget] = useState("")
  const [impDimension, setImpDimension] = useState("")
  const [impIters, setImpIters] = useState("15")
  const [impCost, setImpCost] = useState("")
  const [impLocked, setImpLocked] = useState(true)
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null)
  const [saving, setSaving] = useState<Record<string, string>>({})
  const [daemon, setDaemon] = useState<any>(null)
  const [runs, setRuns] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [batches, setBatches] = useState<any[]>([])

  useEffect(() => {
    fetch("/api/config/operations?key=" + API_KEY).then(r => r.json()).then(c => {
      setConfig(c)
      const suites = Object.keys(c.benchmarks)
      if (suites.length > 0) setSuite(suites[0])
      if (c.targets.length > 0) setImpTarget(c.targets[0])
    }).catch(() => {})
    refreshDaemon()
    refreshRuns()
    refreshStats()
    const ri = setInterval(refreshRuns, 5000)
    const di = setInterval(refreshDaemon, 15000)
    const si = setInterval(refreshStats, 30000)
    return () => { clearInterval(ri); clearInterval(di); clearInterval(si) }
  }, [])

  function refreshDaemon() {
    fetch("/api/improvement/status?key=" + API_KEY).then(r => r.json()).then(setDaemon).catch(() => {})
  }

  function refreshRuns() {
    fetch("/api/run/active?key=" + API_KEY).then(r => r.json()).then(setRuns).catch(() => {})
  }

  function refreshStats() {
    Promise.all([
      fetch("/api/stats?key=" + API_KEY).then(r => r.json()),
      fetch("/api/batches?key=" + API_KEY).then(r => r.json()),
    ]).then(([s, b]) => { setStats(s); setBatches(b) }).catch(() => {})
  }

  function showFlash(msg: string, ok: boolean) {
    setFlash({ msg, ok })
    setTimeout(() => setFlash(null), 5000)
  }

  async function saveAgentOverride(agentName: string, update: Record<string, any>) {
    setSaving(prev => ({ ...prev, [agentName]: "saving..." }))
    try {
      const res = await fetch(`/api/novel/config/agent/${encodeURIComponent(agentName)}`, {
        method: "PUT", headers, body: JSON.stringify(update),
      }).then(r => r.json())
      setSaving(prev => ({ ...prev, [agentName]: res.ok ? "saved" : (res.error ?? "error") }))
      // Reload config to get updated assignments
      fetch("/api/config/operations?key=" + API_KEY).then(r => r.json()).then(setConfig).catch(() => {})
    } catch {
      setSaving(prev => ({ ...prev, [agentName]: "error" }))
    }
    setTimeout(() => setSaving(prev => ({ ...prev, [agentName]: "" })), 2000)
  }

  async function runBenchmark() {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(envValues)) { if (v) env[k] = v }
    try {
      const res = await fetch("/api/run/benchmark", {
        method: "POST", headers, body: JSON.stringify({ suite, env, batch: batchMode }),
      }).then(r => r.json())
      if (res.error) { showFlash(res.error, false); return }
      showFlash(`Started ${suite} benchmark (PID ${res.pid})`, true)
      refreshRuns()
    } catch (e: any) { showFlash(e.message, false) }
  }

  async function startImprovement() {
    const body: Record<string, any> = { dimensionLocked: impLocked }
    if (impTarget) body.target = impTarget
    if (impDimension) body.dimension = impDimension
    if (impIters) body.maxIterations = parseInt(impIters)
    if (impCost) body.maxCostUsd = parseFloat(impCost)
    try {
      const res = await fetch("/api/improvement/start", {
        method: "POST", headers, body: JSON.stringify(body),
      }).then(r => r.json())
      if (res.error) { showFlash(res.error, false); return }
      showFlash(`Improvement started: ${impTarget || "auto"}/${impDimension || "auto"}`, true)
      refreshDaemon()
    } catch (e: any) { showFlash(e.message, false) }
  }

  const bench = config?.benchmarks[suite]
  const impBench = config?.benchmarks[impTarget]
  const applicableVars = config ? config.envVars.filter(v => v.applies.includes("all") || v.applies.includes(suite)) : []

  return (
    <>
      <h1>Operations</h1>

      {flash && (
        <div style={{
          padding: "0.5rem 1rem", borderRadius: 4, marginBottom: "0.8rem", fontSize: "0.85rem",
          background: flash.ok ? "#1a3a2a" : "#3a1a1a",
          border: `1px solid ${flash.ok ? "#4ecca3" : "#e74c3c"}`,
          color: flash.ok ? "#4ecca3" : "#e74c3c",
        }}>{flash.msg}</div>
      )}

      {/* Benchmark Runner */}
      <h2 title="Run benchmark suites to evaluate agent performance.">Benchmark Runner</h2>
      <div className="card">
        {!config ? (
          <p style={{ color: "#8b949e", fontSize: "0.85rem", margin: 0 }}>Loading config…</p>
        ) : (<>
        <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Suite</label>
        <SearchableSelect
          value={suite}
          onChange={v => { setSuite(v); setEnvValues({}) }}
          options={Object.entries(config.benchmarks).map(([name, cfg]) => ({
            value: name, label: cfg.displayName,
          }))}
        />

        {/* Agent under test + judge */}
        {bench && (
          <AgentInfoBox
            agents={bench.agentsUnderTest}
            judge={bench.judge}
            models={config.models}
            providers={config.providers}
            saving={saving}
            onSave={saveAgentOverride}
          />
        )}

        {/* Env vars */}
        {applicableVars.map(v => (
          <div key={v.name} style={{ marginTop: "0.5rem" }}>
            <label
              title={v.description}
              style={{ fontSize: "0.8rem", color: "#8b949e", cursor: v.description ? "help" : "default" }}
            >
              {v.name} {v.description && <span style={{ color: "#555", fontSize: "0.7rem" }}>(?)</span>}
            </label>
            {v.type === "multi-select" && v.options ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.2rem" }}>
                {v.options.map(opt => (
                  <label key={opt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.85rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={(envValues[v.name] ?? "").split(",").includes(opt)}
                      onChange={e => {
                        const current = (envValues[v.name] ?? "").split(",").filter(Boolean)
                        const next = e.target.checked ? [...current, opt] : current.filter(x => x !== opt)
                        setEnvValues(prev => ({ ...prev, [v.name]: next.join(",") }))
                      }}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ) : v.type === "select" && v.options ? (
              <SearchableSelect
                value={envValues[v.name] ?? v.default ?? ""}
                onChange={val => setEnvValues(prev => ({ ...prev, [v.name]: val }))}
                options={[
                  { value: "", label: "--" },
                  ...v.options.map(opt => ({ value: opt, label: opt })),
                ]}
              />
            ) : v.type === "number" ? (
              <input
                type="number"
                value={envValues[v.name] ?? v.default ?? ""}
                onChange={e => setEnvValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                placeholder={v.default}
              />
            ) : (
              <input
                type="text"
                value={envValues[v.name] ?? v.default ?? ""}
                onChange={e => setEnvValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                placeholder={v.default}
              />
            )}
          </div>
        ))}

        {bench?.supportsBatch && (
          <div style={{ marginTop: "0.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.85rem", cursor: "pointer" }}>
              <input type="checkbox" checked={batchMode} onChange={e => setBatchMode(e.target.checked)} />
              Batch mode (async judges, 50% off)
            </label>
          </div>
        )}

        <button onClick={runBenchmark} style={{ marginTop: "0.8rem" }}>Run Benchmark</button>
        </>)}
      </div>

      {/* Active Runs */}
      {runs.length > 0 && (
        <>
          <h2>Active Runs</h2>
          {runs.map((r: any) => (
            <details key={r.pid} className="card" style={{ padding: "0.6rem 1rem", cursor: "pointer" }}>
              <summary style={{ fontSize: "0.85rem" }}>
                <span className={`badge ${r.running ? "active" : r.exitCode === 0 ? "done" : "error"}`}>
                  {r.running ? "running" : r.exitCode === 0 ? "done" : `exit ${r.exitCode}`}
                </span>{" "}
                <strong>{r.label}</strong>{" "}
                <span style={{ color: "#555" }}>PID {r.pid} · {new Date(r.startedAt).toLocaleTimeString()}</span>
              </summary>
              <pre style={{ fontSize: "0.72rem", color: "#8b949e", whiteSpace: "pre-wrap", marginTop: "0.4rem", maxHeight: "200px", overflow: "auto" }}>
                {r.stdout}
              </pre>
            </details>
          ))}
        </>
      )}

      {/* Improvement Daemon */}
      <h2 title="Focused prompt tuning. Locks on a single dimension and iterates.">Improvement Daemon</h2>
      <div className="card">
        {/* Daemon status */}
        <div style={{ marginBottom: "0.8rem" }}>
          {daemon?.active ? (
            <>
              <span className="badge active">ACTIVE</span>{" "}
              {daemon.cycle.target}/{daemon.cycle.dimension}
              {" — iter "}
              {daemon.cycle.iteration}/{daemon.cycle.limits.maxIterations}
              , score: {daemon.cycle.currentScore}
              , cost: ${(daemon.cycle.actualCost ?? 0).toFixed(4)}
            </>
          ) : (
            <span className="badge idle">IDLE</span>
          )}
        </div>

        {/* Target info box */}
        {impBench && config && (
          <AgentInfoBox
            agents={impBench.agentsUnderTest}
            judge={impBench.judge}
            models={config.models}
            providers={config.providers}
            saving={saving}
            onSave={saveAgentOverride}
          />
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Target</label>
            <SearchableSelect
              value={impTarget}
              onChange={v => { setImpTarget(v); setImpDimension("") }}
              options={(config?.targets ?? []).map(t => ({ value: t, label: t }))}
            />
            <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.3rem", display: "block" }}>Dimension</label>
            <SearchableSelect
              value={impDimension}
              onChange={setImpDimension}
              options={[
                { value: "", label: "auto (weakest)" },
                ...(impBench?.dimensions.map(d => ({
                  value: d, label: impBench.dimensionLabels[d] ?? d,
                })) ?? []),
              ]}
            />
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", color: "#8b949e" }}>Max iterations</label>
            <input type="number" value={impIters} onChange={e => setImpIters(e.target.value)} />
            <label style={{ fontSize: "0.8rem", color: "#8b949e", marginTop: "0.3rem", display: "block" }}>Max cost ($)</label>
            <input type="number" step="0.1" value={impCost} onChange={e => setImpCost(e.target.value)} placeholder="no cap" />
          </div>
        </div>

        <div style={{ marginTop: "0.5rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.85rem", cursor: "pointer" }}
                 title="When locked, stays on the selected dimension for all iterations.">
            <input type="checkbox" checked={impLocked} onChange={e => setImpLocked(e.target.checked)} />
            Lock dimension (focused)
          </label>
        </div>

        <button onClick={startImprovement} style={{ marginTop: "0.8rem" }}>Start Improvement</button>
      </div>

      {/* Orchestrator Stats */}
      <h2>Orchestrator</h2>
      <div className="card" style={{ fontSize: "0.82rem", display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <span>Polls: <strong>{stats?.total_polls ?? 0}</strong></span>
        <span>Collected: <strong>{stats?.total_collected ?? 0}</strong></span>
        <span>Last poll: {stats?.last_poll_at ? new Date(stats.last_poll_at).toLocaleString() : "never"}</span>
        <span>Active batches: <strong>{stats?.active_batches ?? 0}</strong></span>
        <button
          onClick={() => fetch("/api/poll", { method: "POST", headers }).then(() => setTimeout(refreshStats, 2000))}
          style={{ fontSize: "0.72rem", padding: "3px 10px" }}
        >
          Poll Now
        </button>
      </div>

      {/* Recent Batches */}
      {batches.length > 0 && (
        <>
          <h2>Recent Batches</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="guide-table">
              <thead>
                <tr><th>ID</th><th>Status</th><th>Progress</th><th>Provider</th><th>Model</th><th>Run</th><th>Submitted</th></tr>
              </thead>
              <tbody>
                {batches.map((b: any) => (
                  <tr key={b.id}>
                    <td>{b.id}</td>
                    <td><span className={`badge ${b.status === "completed" ? "done" : b.status === "failed" ? "error" : "active"}`}>{b.status}</span></td>
                    <td>{b.completed_count}/{b.request_count}</td>
                    <td>{b.provider}</td>
                    <td>{b.judge_model ?? ""}</td>
                    <td>{b.local_run_id ?? ""}</td>
                    <td>{new Date(b.submitted_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

/* Shared agent/judge info box with inline editing */
function AgentInfoBox({ agents, judge, models, providers, saving, onSave }: {
  agents: Array<{ agentName: string; effectiveName: string; provider: string; model: string; temperature: number; label: string }>
  judge: { provider: string; model: string; label: string } | null
  models: Array<{ label: string; id: string; provider: string; pricing?: { input: number; output: number } }>
  providers: string[]
  saving: Record<string, string>
  onSave: (agent: string, update: Record<string, any>) => void
}) {
  return (
    <div style={{ margin: "0.5rem 0 0.8rem", padding: "0.6rem", background: "#0d1117", border: "1px solid #30363d", borderRadius: 4, fontSize: "0.8rem" }}>
      {agents.map((a, i) => (
        <div key={i} style={{ marginBottom: "0.4rem" }}>
          <span style={{ color: "#4ecca3" }}>Testing:</span> <strong>{a.agentName}</strong>
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.3rem", alignItems: "center", flexWrap: "wrap" }}>
            <ModelSelector
              provider={a.provider}
              model={a.model}
              agentName={a.effectiveName}
              models={models}
              providers={providers}
              saving={saving[a.effectiveName]}
              onSave={onSave}
            />
          </div>
        </div>
      ))}
      {judge && (
        <div>
          <span style={{ color: "#e2b714" }}>Judge:</span>
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.3rem", alignItems: "center", flexWrap: "wrap" }}>
            <ModelSelector
              provider={judge.provider}
              model={judge.model}
              agentName="benchmark-judge"
              models={models}
              providers={providers}
              saving={saving["benchmark-judge"]}
              onSave={onSave}
            />
          </div>
        </div>
      )}
      <div style={{ marginTop: "0.4rem", color: "#555" }}>
        Full config: <Link to={`/config${window.location.search}`} style={{ color: "#58a6ff" }}>Config page</Link>
      </div>
    </div>
  )
}

function ModelSelector({ provider, model, agentName, models, saving, onSave }: {
  provider: string; model: string; agentName: string
  models: Array<{ label: string; id: string; provider: string; pricing?: { input: number; output: number } }>
  providers: string[]
  saving?: string
  onSave: (agent: string, update: Record<string, any>) => void
}) {
  const currentModel = models.find(m => m.id === model && m.provider === provider)
  const compositeValue = `${provider}:${model}`

  const allOptions = models.map(m => ({
    value: `${m.provider}:${m.id}`,
    label: m.label,
    sublabel: `${m.provider}${m.pricing ? ` · $${m.pricing.input}/$${m.pricing.output}` : ""}`,
  }))

  return (
    <>
      <SearchableSelect
        value={compositeValue}
        onChange={v => {
          const [p, ...rest] = v.split(":")
          onSave(agentName, { provider: p, model: rest.join(":") })
        }}
        options={allOptions}
        style={{ width: "320px" }}
      />
      {currentModel?.pricing && (
        <span style={{ color: "var(--accent)", fontSize: "0.75rem" }}>
          ${currentModel.pricing.input}/${currentModel.pricing.output} per 1M
        </span>
      )}
      {saving && <span style={{ fontSize: "0.75rem", color: saving === "saved" ? "var(--accent)" : saving === "error" ? "var(--red)" : "var(--yellow)" }}>{saving}</span>}
    </>
  )
}
