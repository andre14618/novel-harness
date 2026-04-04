import { useEffect, useState } from "react"

const API_KEY = new URLSearchParams(window.location.search).get("key") ?? ""
const api = (path: string) => fetch(`${path}${path.includes("?") ? "&" : "?"}key=${API_KEY}`)

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

interface Generation {
  id: number
  seed: string
  attempt: number
  prose: string
  wordCount: number
  variantLabel: string | null
  runLabel: string | null
  latencyMs: number | null
  scores: Array<{ dimension: string; score: number; reasoning: string | null; judge: string }>
  lintIssues: Array<{ category: string; match: string; sentence: string; charOffset: number }>
}

type Tab = "scores" | "prose" | "rubrics" | "commit"

export function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [generations, setGenerations] = useState<Generation[]>([])
  const [activeTab, setActiveTab] = useState<Tab>("scores")
  const [filter, setFilter] = useState<string>("")
  const [rubricIndex, setRubricIndex] = useState<Record<string, string[]>>({})
  const [rubricContent, setRubricContent] = useState<Record<string, string>>({})
  const [commitDiff, setCommitDiff] = useState<string | null>(null)
  const [expandedGen, setExpandedGen] = useState<number | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  useEffect(() => {
    api("/api/experiments").then(r => r.json()).then(setExperiments).catch(() => {})
    api("/api/rubrics").then(r => r.json()).then(setRubricIndex).catch(() => {})
  }, [])

  async function loadDetail(id: number) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    setDetail(null)
    setGenerations([])
    setCommitDiff(null)
    setActiveTab("scores")
    try {
      const [detailRes, gensRes] = await Promise.all([
        api(`/api/experiments/${id}`).then(r => r.json()),
        api(`/api/experiments/${id}/generations?limit=30`).then(r => r.json()),
      ])
      setDetail(detailRes)
      setGenerations(gensRes)
    } catch {}
  }

  async function loadRubric(suite: string, dimension: string) {
    const key = `${suite}/${dimension}`
    if (rubricContent[key]) return
    try {
      const res = await api(`/api/rubrics/${suite}/${dimension}`)
      const data = await res.json()
      setRubricContent(prev => ({ ...prev, [key]: data.content }))
    } catch {}
  }

  async function loadCommitDiff(id: number) {
    try {
      const res = await api(`/api/experiments/${id}/diff`)
      const data = await res.json()
      setCommitDiff(data.diff ?? "No commit hash recorded.")
    } catch { setCommitDiff("Failed to load.") }
  }

  async function copyForDiscussion(id: number) {
    try {
      const res = await api(`/api/experiments/${id}/summary`)
      const data = await res.json()
      await navigator.clipboard.writeText(data.markdown)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {}
  }

  function handleTabChange(tab: Tab, expId: number) {
    setActiveTab(tab)
    if (tab === "commit" && !commitDiff) loadCommitDiff(expId)
    if (tab === "rubrics") {
      // Detect suite from experiment type or scores
      const exp = experiments.find(e => e.id === expId)
      const suite = exp?.type === "pairwise" ? "pairwise"
        : detail?.scores?.[0]?.dimension ? guessSuite(detail.scores[0].dimension) : "prose"
      for (const dim of rubricIndex[suite] ?? []) loadRubric(suite, dim)
    }
  }

  function guessSuite(dimension: string): string {
    for (const [suite, dims] of Object.entries(rubricIndex)) {
      if (dims.includes(dimension)) return suite
    }
    return "prose"
  }

  // Highlight lint issues in prose
  function renderProseWithLint(prose: string, lintIssues: Generation["lintIssues"]) {
    if (lintIssues.length === 0) return <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{prose}</div>

    // Sort by offset descending to insert marks without shifting positions
    const sorted = [...lintIssues].sort((a, b) => a.charOffset - b.charOffset)
    const parts: Array<{ text: string; isLint: boolean; category?: string }> = []
    let lastEnd = 0

    for (const issue of sorted) {
      const start = issue.charOffset
      const end = start + issue.match.length
      if (start < lastEnd) continue // overlapping
      if (start > lastEnd) parts.push({ text: prose.slice(lastEnd, start), isLint: false })
      parts.push({ text: prose.slice(start, end), isLint: true, category: issue.category })
      lastEnd = end
    }
    if (lastEnd < prose.length) parts.push({ text: prose.slice(lastEnd), isLint: false })

    return (
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
        {parts.map((p, i) =>
          p.isLint ? (
            <mark key={i} title={p.category} style={{ background: "#4e3a1a", color: "#e2b714", borderRadius: "2px", padding: "0 2px" }}>
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
      </div>
    )
  }

  const filtered = experiments.filter(e => {
    if (!filter) return true
    const f = filter.toLowerCase()
    return (e.target?.toLowerCase().includes(f)) ||
           (e.dimension?.toLowerCase().includes(f)) ||
           (e.type?.toLowerCase().includes(f)) ||
           (e.description?.toLowerCase().includes(f)) ||
           String(e.id).includes(f)
  })

  const grouped = new Map<string, Experiment[]>()
  for (const e of filtered) {
    const key = e.target && e.dimension ? `${e.target} / ${e.dimension}` : e.target ?? "ungrouped"
    const list = grouped.get(key) ?? []
    list.push(e)
    grouped.set(key, list)
  }

  const tabStyle = (tab: Tab) => ({
    padding: "0.4rem 0.8rem",
    fontSize: "0.75rem",
    cursor: "pointer" as const,
    borderBottom: activeTab === tab ? "2px solid #4ecca3" : "2px solid transparent",
    color: activeTab === tab ? "#e0e0e0" : "#8b949e",
    background: "none",
    border: "none",
    borderBottomWidth: "2px",
    borderBottomStyle: "solid" as const,
    borderBottomColor: activeTab === tab ? "#4ecca3" : "transparent",
  })

  return (
    <>
      <h1>Experiments</h1>

      <p style={{ fontSize: "0.8rem", color: "#8b949e", marginBottom: "0.8rem" }}>
        All benchmark runs and improvement cycles. Click to expand. Use tabs to view scores, prose, rubrics, and commit info.
      </p>

      <input
        type="text"
        placeholder="Filter by target, dimension, type, or ID..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{ marginBottom: "1rem", maxWidth: "400px" }}
      />

      {[...grouped.entries()].map(([group, exps]) => (
        <div key={group} style={{ marginBottom: "1.5rem" }}>
          <h2>{group}</h2>
          {exps.map(e => (
            <div key={e.id} className="card" style={{ marginBottom: "0.5rem" }}>
              {/* Header row — always visible */}
              <div style={{ cursor: "pointer" }} onClick={() => loadDetail(e.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>#{e.id}</strong>
                    <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "#8b949e" }}>{e.type}</span>
                    {e.cycle_status && (
                      <span className={`badge ${e.cycle_status === "active" ? "active" : e.cycle_status === "completed" ? "done" : "error"}`}
                            style={{ marginLeft: "0.5rem", fontSize: "0.65rem" }}>
                        {e.cycle_status}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <button
                      onClick={(ev) => { ev.stopPropagation(); copyForDiscussion(e.id) }}
                      style={{ fontSize: "0.65rem", padding: "0.2rem 0.5rem", cursor: "pointer" }}
                    >
                      {copiedId === e.id ? "Copied!" : "Copy"}
                    </button>
                    <span style={{ fontSize: "0.75rem", color: "#555" }}>
                      {new Date(e.timestamp).toLocaleDateString()}
                    </span>
                  </div>
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
              </div>

              {/* Expanded detail */}
              {expanded === e.id && (
                <div style={{ marginTop: "0.8rem", borderTop: "1px solid #30363d", paddingTop: "0.8rem" }}>
                  {e.conclusion && (
                    <div style={{ marginBottom: "0.6rem" }}>
                      <strong style={{ fontSize: "0.8rem", color: "#4ecca3" }}>Conclusion</strong>
                      <pre style={{ fontSize: "0.75rem", color: "#8b949e", whiteSpace: "pre-wrap", marginTop: "0.3rem" }}>
                        {e.conclusion}
                      </pre>
                    </div>
                  )}

                  {/* Tab bar */}
                  <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #30363d", marginBottom: "0.8rem" }}>
                    <button style={tabStyle("scores")} onClick={() => handleTabChange("scores", e.id)}>Scores</button>
                    <button style={tabStyle("prose")} onClick={() => handleTabChange("prose", e.id)}>
                      Prose ({generations.length})
                    </button>
                    <button style={tabStyle("rubrics")} onClick={() => handleTabChange("rubrics", e.id)}>Rubrics</button>
                    <button style={tabStyle("commit")} onClick={() => handleTabChange("commit", e.id)}>Commit</button>
                  </div>

                  {/* Tab content */}
                  {activeTab === "scores" && detail && (
                    <div style={{ fontSize: "0.8rem" }}>
                      {detail.scores?.length > 0 ? (
                        <ScoresTable scores={detail.scores} />
                      ) : (
                        <p style={{ color: "#555" }}>No scores recorded.</p>
                      )}

                      {detail.cost?.length > 0 && (
                        <div style={{ marginTop: "0.5rem" }}>
                          <strong style={{ color: "#8b949e" }}>Cost:</strong>
                          {detail.cost.map((c: any, i: number) => (
                            <span key={i} className="config-tag" style={{ marginLeft: "0.3rem" }}>
                              {c.variantLabel ?? "default"}: ${c.totalCost.toFixed(4)} ({c.totalCalls} calls)
                            </span>
                          ))}
                        </div>
                      )}

                      {detail.lint?.length > 0 && (
                        <div style={{ marginTop: "0.5rem" }}>
                          <strong style={{ color: "#8b949e" }}>Lint:</strong>
                          {detail.lint.map((l: any, i: number) => (
                            <span key={i} className="config-tag" style={{ marginLeft: "0.3rem" }}>
                              {l.variantLabel}: {l.category} ({l.count})
                            </span>
                          ))}
                        </div>
                      )}

                      {detail.lineage?.length > 0 && (
                        <div style={{ marginTop: "0.5rem" }}>
                          <strong style={{ color: "#8b949e" }}>Linked:</strong>
                          {detail.lineage.map((l: any, i: number) => (
                            <span key={i} style={{ fontSize: "0.75rem", color: "#555", marginLeft: "0.5rem" }}>
                              #{l.parent_experiment_id} ({l.relationship})
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === "prose" && (
                    <div style={{ fontSize: "0.8rem" }}>
                      {generations.length === 0 ? (
                        <p style={{ color: "#555" }}>No prose generations found.</p>
                      ) : (
                        generations.map(gen => (
                          <div key={gen.id} className="card" style={{ marginBottom: "0.5rem", padding: "0.5rem" }}>
                            <div
                              style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                              onClick={() => setExpandedGen(expandedGen === gen.id ? null : gen.id)}
                            >
                              <div>
                                <strong style={{ color: "#e0e0e0" }}>{gen.variantLabel ?? gen.runLabel ?? "default"}</strong>
                                <span style={{ marginLeft: "0.5rem", color: "#555" }}>seed: {gen.seed}</span>
                                <span style={{ marginLeft: "0.5rem", color: "#555" }}>{gen.wordCount}w</span>
                              </div>
                              <div style={{ display: "flex", gap: "0.3rem" }}>
                                {gen.scores.map((s, i) => (
                                  <span key={i} className="config-tag" style={{ fontSize: "0.65rem" }}>
                                    {s.dimension}: {Math.abs(s.score)}
                                  </span>
                                ))}
                                {gen.lintIssues.length > 0 && (
                                  <span className="config-tag" style={{ fontSize: "0.65rem", color: "#e2b714" }}>
                                    lint: {gen.lintIssues.length}
                                  </span>
                                )}
                              </div>
                            </div>

                            {expandedGen === gen.id && (
                              <div style={{ marginTop: "0.5rem", borderTop: "1px solid #21262d", paddingTop: "0.5rem" }}>
                                {renderProseWithLint(gen.prose, gen.lintIssues)}

                                {gen.scores.length > 0 && (
                                  <div style={{ marginTop: "0.5rem", borderTop: "1px solid #21262d", paddingTop: "0.5rem" }}>
                                    {gen.scores.map((s, i) => (
                                      <details key={i} style={{ fontSize: "0.75rem", marginBottom: "0.3rem" }}>
                                        <summary style={{ cursor: "pointer", color: "#8b949e" }}>
                                          {s.dimension}: {Math.abs(s.score)} issues — {s.judge}
                                        </summary>
                                        {s.reasoning && (
                                          <pre style={{ fontSize: "0.7rem", color: "#555", whiteSpace: "pre-wrap", marginTop: "0.3rem", maxHeight: "200px", overflow: "auto" }}>
                                            {s.reasoning}
                                          </pre>
                                        )}
                                      </details>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {activeTab === "rubrics" && (
                    <div style={{ fontSize: "0.8rem" }}>
                      {Object.entries(rubricIndex).map(([suite, dims]) => (
                        <div key={suite}>
                          {dims.map(dim => {
                            const key = `${suite}/${dim}`
                            const content = rubricContent[key]
                            if (!content) return null
                            return (
                              <details key={key} style={{ marginBottom: "0.5rem" }}>
                                <summary style={{ cursor: "pointer", color: "#e0e0e0" }}>
                                  <strong>{suite}</strong> / {dim}
                                </summary>
                                <pre style={{ fontSize: "0.7rem", color: "#8b949e", whiteSpace: "pre-wrap", marginTop: "0.3rem", padding: "0.5rem", background: "#161b22", borderRadius: "4px" }}>
                                  {content}
                                </pre>
                              </details>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === "commit" && (
                    <div style={{ fontSize: "0.8rem" }}>
                      {commitDiff ? (
                        <pre style={{ fontSize: "0.7rem", color: "#8b949e", whiteSpace: "pre-wrap", maxHeight: "400px", overflow: "auto", padding: "0.5rem", background: "#161b22", borderRadius: "4px" }}>
                          {commitDiff}
                        </pre>
                      ) : (
                        <p style={{ color: "#555" }}>Loading commit info...</p>
                      )}
                    </div>
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

/** Scores table: variants as rows, dimensions as columns */
function ScoresTable({ scores }: { scores: Array<{ variantLabel: string; dimension: string; avg: number; count: number }> }) {
  const variants = [...new Set(scores.map(s => s.variantLabel))]
  const dimensions = [...new Set(scores.map(s => s.dimension))]

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ fontSize: "0.75rem", borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0.3rem 0.5rem", borderBottom: "1px solid #30363d", color: "#8b949e" }}>Variant</th>
            {dimensions.map(d => (
              <th key={d} style={{ textAlign: "right", padding: "0.3rem 0.5rem", borderBottom: "1px solid #30363d", color: "#8b949e" }}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variants.map(v => (
            <tr key={v}>
              <td style={{ padding: "0.3rem 0.5rem", borderBottom: "1px solid #21262d", color: "#e0e0e0" }}>{v}</td>
              {dimensions.map(d => {
                const s = scores.find(x => x.variantLabel === v && x.dimension === d)
                return (
                  <td key={d} style={{ textAlign: "right", padding: "0.3rem 0.5rem", borderBottom: "1px solid #21262d", color: "#c9d1d9" }}>
                    {s ? `${s.avg} (${s.count})` : "—"}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
