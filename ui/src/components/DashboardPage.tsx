import { useEffect, useState } from "react"

const API_KEY = new URLSearchParams(window.location.search).get("key") ?? ""
const h = { "x-api-key": API_KEY }

export function DashboardPage() {
  const [batches, setBatches] = useState<any[]>([])
  const [improvement, setImprovement] = useState<any>(null)
  const [stats, setStats] = useState<any>(null)
  const [runs, setRuns] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const [b, imp, s, r] = await Promise.all([
        fetch("/api/batches?key=" + API_KEY).then(r => r.json()),
        fetch("/api/improvement/status?key=" + API_KEY).then(r => r.json()),
        fetch("/api/stats?key=" + API_KEY).then(r => r.json()),
        fetch("/api/run/active?key=" + API_KEY).then(r => r.json()),
      ])
      setBatches(b)
      setImprovement(imp)
      setStats(s)
      setRuns(r)
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  async function pollNow() {
    await fetch("/api/poll", { method: "POST", headers: h })
    setTimeout(load, 2000)
  }

  if (loading) return <p style={{ color: "#8b949e" }}>Loading...</p>

  return (
    <>
      <h1>Dashboard</h1>
      <p style={{ fontSize: "0.8rem", color: "#555", marginBottom: "1rem" }}>
        Auto-refreshes every 30s.{" "}
        <button onClick={load} style={{ fontSize: "0.75rem", padding: "4px 10px" }}>Refresh</button>{" "}
        <button onClick={pollNow} style={{ fontSize: "0.75rem", padding: "4px 10px" }}>Poll Batches</button>
      </p>

      {/* Improvement Daemon */}
      <h2>Improvement Daemon</h2>
      <div className="card">
        {improvement?.active ? (
          <>
            <span className="badge active">ACTIVE</span>{" "}
            Cycle #{improvement.cycle.id} — {improvement.cycle.target}/{improvement.cycle.dimension}
            <div style={{ fontSize: "0.85rem", color: "#8b949e", marginTop: "0.3rem" }}>
              Iteration {improvement.cycle.iteration}/{improvement.cycle.limits.maxIterations}
              {" "} · score: {improvement.cycle.currentScore}
              {" "} · cost: ${(improvement.cycle.actualCost ?? 0).toFixed(4)}
              {improvement.cycle.limits.maxCostUsd && `/$${improvement.cycle.limits.maxCostUsd.toFixed(2)}`}
              {" "} · failures: {improvement.cycle.consecutiveFailures}
            </div>
            {improvement.cycle.pendingBatchId && (
              <div style={{ fontSize: "0.8rem", color: "#3498db", marginTop: "0.3rem" }}>
                Waiting for batch #{improvement.cycle.pendingBatchId}
              </div>
            )}
          </>
        ) : (
          <span className="badge idle">IDLE</span>
        )}
      </div>

      {/* Orchestrator Stats */}
      <h2>Orchestrator</h2>
      <div className="card" style={{ fontSize: "0.85rem" }}>
        Polls: {stats?.total_polls ?? 0}
        {" "} · Collected: {stats?.total_collected ?? 0}
        {" "} · Last poll: {stats?.last_poll_at ? new Date(stats.last_poll_at).toLocaleString() : "never"}
        {" "} · Active batches: {stats?.active_batches ?? 0}
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
                <span style={{ color: "#555" }}>PID {r.pid} · {new Date(r.startedAt).toLocaleTimeString()} · {r.stdoutLines} lines</span>
              </summary>
              <pre style={{ fontSize: "0.72rem", color: "#8b949e", whiteSpace: "pre-wrap", marginTop: "0.4rem", maxHeight: "200px", overflow: "auto" }}>
                {r.stdout}
              </pre>
            </details>
          ))}
        </>
      )}

      {/* Recent Batches */}
      <h2>Recent Batches</h2>
      {batches.length === 0 ? (
        <p style={{ color: "#555", fontSize: "0.85rem" }}>No batches</p>
      ) : (
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
      )}
    </>
  )
}
