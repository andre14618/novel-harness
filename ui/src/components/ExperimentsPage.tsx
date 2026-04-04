import { useEffect, useState } from "react"


const API_KEY = new URLSearchParams(window.location.search).get("key") ?? ""

interface Experiment {
  id: number
  type: string
  description: string
  target: string | null
  dimension: string | null
  conclusion: string | null
  timestamp: string
  cycle_id: number | null
  cycle_status: string | null
  total_iterations: number | null
  kept_count: number | null
  cycle_cost: number | null
  dimension_locked: boolean | null
  run_count: number
  total_cost: number | null
  scores: Array<{ dimension: string; avg_score: number }> | null
}

export function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [filter, setFilter] = useState<string>("")

  useEffect(() => {
    fetch("/api/experiments?key=" + API_KEY)
      .then(r => r.json())
      .then(setExperiments)
      .catch(() => {})
  }, [])

  async function loadDetail(id: number) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    setDetail(null)
    try {
      const res = await fetch(`/api/experiments/${id}?key=${API_KEY}`)
      setDetail(await res.json())
    } catch {}
  }

  const filtered = experiments.filter(e => {
    if (!filter) return true
    const f = filter.toLowerCase()
    return (e.target?.toLowerCase().includes(f)) ||
           (e.dimension?.toLowerCase().includes(f)) ||
           (e.type?.toLowerCase().includes(f)) ||
           (e.description?.toLowerCase().includes(f))
  })

  // Group by target/dimension
  const grouped = new Map<string, Experiment[]>()
  for (const e of filtered) {
    const key = e.target && e.dimension ? `${e.target} / ${e.dimension}` : e.target ?? "ungrouped"
    const list = grouped.get(key) ?? []
    list.push(e)
    grouped.set(key, list)
  }

  return (
    <>
      <h1>Experiments</h1>

      <p style={{ fontSize: "0.8rem", color: "#8b949e", marginBottom: "0.8rem" }}>
        All benchmark runs and improvement cycles in one view. Grouped by target/dimension.
      </p>

      <input
        type="text"
        placeholder="Filter by target, dimension, type..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{ marginBottom: "1rem", maxWidth: "400px" }}
      />

      {[...grouped.entries()].map(([group, exps]) => (
        <div key={group} style={{ marginBottom: "1.5rem" }}>
          <h2>{group}</h2>
          {exps.map(e => (
            <div
              key={e.id}
              className="card"
              style={{ cursor: "pointer", marginBottom: "0.5rem" }}
              onClick={() => loadDetail(e.id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>#{e.id}</strong>
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "#8b949e" }}>
                    {e.type}
                  </span>
                  {e.cycle_status && (
                    <span className={`badge ${e.cycle_status === "active" ? "active" : e.cycle_status === "completed" ? "done" : "error"}`}
                          style={{ marginLeft: "0.5rem", fontSize: "0.65rem" }}>
                      {e.cycle_status}
                    </span>
                  )}
                  {e.dimension_locked && (
                    <span style={{ marginLeft: "0.4rem", fontSize: "0.65rem", color: "#e2b714" }}>locked</span>
                  )}
                </div>
                <span style={{ fontSize: "0.75rem", color: "#555" }}>
                  {new Date(e.timestamp).toLocaleDateString()}
                </span>
              </div>

              <div style={{ fontSize: "0.8rem", color: "#8b949e", marginTop: "0.3rem" }}>
                {e.description}
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
                {e.run_count > 0 && <span className="config-tag">{e.run_count} runs</span>}
                {e.total_iterations !== null && <span className="config-tag">{e.total_iterations} iters ({e.kept_count} kept)</span>}
                {e.total_cost !== null && e.total_cost > 0 && (
                  <span className="config-tag" style={{ color: "#4ecca3" }}>${e.total_cost.toFixed(4)}</span>
                )}
                {e.scores?.map((s, i) => (
                  <span key={i} className="config-tag">{s.dimension}: {s.avg_score}</span>
                ))}
              </div>

              {/* Expanded detail */}
              {expanded === e.id && (
                <div style={{ marginTop: "0.8rem", borderTop: "1px solid #30363d", paddingTop: "0.8rem" }}
                     onClick={ev => ev.stopPropagation()}>
                  {e.conclusion && (
                    <div style={{ marginBottom: "0.6rem" }}>
                      <strong style={{ fontSize: "0.8rem", color: "#4ecca3" }}>Conclusion</strong>
                      <pre style={{ fontSize: "0.75rem", color: "#8b949e", whiteSpace: "pre-wrap", marginTop: "0.3rem" }}>
                        {e.conclusion}
                      </pre>
                    </div>
                  )}

                  {detail ? (
                    <div style={{ fontSize: "0.8rem" }}>
                      {detail.scores?.length > 0 && (
                        <div style={{ marginBottom: "0.5rem" }}>
                          <strong style={{ color: "#8b949e" }}>Scores by variant:</strong>
                          {detail.scores.map((s: any, i: number) => (
                            <div key={i} style={{ display: "flex", gap: "0.5rem", marginTop: "0.2rem" }}>
                              <span style={{ color: "#e0e0e0", minWidth: "120px" }}>{s.variantLabel ?? "default"}</span>
                              <span className="config-tag">{s.dimension}: {s.avg} ({s.count} samples)</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {detail.cost?.length > 0 && (
                        <div style={{ marginBottom: "0.5rem" }}>
                          <strong style={{ color: "#8b949e" }}>Cost:</strong>
                          {detail.cost.map((c: any, i: number) => (
                            <span key={i} className="config-tag" style={{ marginLeft: "0.3rem" }}>
                              {c.variantLabel ?? "default"}: ${c.totalCost.toFixed(4)} ({c.totalCalls} calls)
                            </span>
                          ))}
                        </div>
                      )}

                      {detail.lineage?.length > 0 && (
                        <div style={{ marginBottom: "0.5rem" }}>
                          <strong style={{ color: "#8b949e" }}>Linked experiments:</strong>
                          {detail.lineage.map((l: any, i: number) => (
                            <div key={i} style={{ fontSize: "0.75rem", color: "#555", marginTop: "0.2rem" }}>
                              #{l.parent_experiment_id} ({l.relationship}) — {l.description}
                            </div>
                          ))}
                        </div>
                      )}

                      {detail.runs?.length > 0 && (
                        <div>
                          <strong style={{ color: "#8b949e" }}>Runs:</strong>
                          {detail.runs.map((r: any, i: number) => (
                            <span key={i} className="config-tag" style={{ marginLeft: "0.3rem" }}>
                              #{r.runId} {r.label ?? r.variantLabel ?? ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ color: "#555", fontSize: "0.8rem" }}>Loading details...</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {experiments.length === 0 && (
        <p style={{ color: "#555" }}>No experiments found.</p>
      )}
    </>
  )
}
