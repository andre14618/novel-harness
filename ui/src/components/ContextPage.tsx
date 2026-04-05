import { useState, useEffect, useCallback } from "react"
import { listNovels, getRetrievalConfig, updateRetrievalConfig, type RetrievalConfig, type NovelListItem } from "../api"

interface ParamDef {
  key: keyof RetrievalConfig
  label: string
  description: string
  min: number
  max: number
  step: number
  unit?: string
  group: "limits" | "search" | "boost"
}

const PARAMS: ParamDef[] = [
  // Result limits
  { key: "maxFacts", label: "Max Facts", description: "Facts retrieved per scene", min: 5, max: 100, step: 5, group: "limits" },
  { key: "maxEvents", label: "Max Events", description: "Timeline events retrieved", min: 5, max: 50, step: 5, group: "limits" },
  { key: "maxSummaries", label: "Max Summaries", description: "Chapter summaries retrieved", min: 2, max: 20, step: 1, group: "limits" },
  { key: "maxStates", label: "Max States", description: "Character states retrieved", min: 2, max: 20, step: 1, group: "limits" },
  { key: "maxRelationships", label: "Max Relationships", description: "Relationship snapshots retrieved", min: 2, max: 20, step: 1, group: "limits" },
  { key: "maxKnowledge", label: "Max Knowledge", description: "Knowledge entries retrieved", min: 5, max: 50, step: 5, group: "limits" },
  // Search parameters
  { key: "minSimilarity", label: "Min Similarity", description: "Cosine similarity floor (below = filtered)", min: 0.05, max: 0.6, step: 0.05, group: "search" },
  { key: "rrfK", label: "RRF K", description: "Reciprocal Rank Fusion constant (higher = less peaky)", min: 10, max: 120, step: 10, group: "search" },
  { key: "fetchPerLeg", label: "Fetch Per Leg", description: "Results per search leg before fusion", min: 10, max: 60, step: 5, group: "search" },
  // Boost parameters
  { key: "characterBoost", label: "Character Boost", description: "RRF score multiplier for present character matches", min: 1.0, max: 4.0, step: 0.25, unit: "x", group: "boost" },
  { key: "locationBoost", label: "Location Boost", description: "RRF score multiplier for location matches", min: 1.0, max: 4.0, step: 0.25, unit: "x", group: "boost" },
  { key: "recencyHalfLife", label: "Recency Half-Life", description: "Chapters until recency bonus halves", min: 3, max: 30, step: 1, unit: "ch", group: "boost" },
]

const GROUP_LABELS: Record<string, string> = {
  limits: "Result Limits",
  search: "Search Parameters",
  boost: "Boost & Decay",
}

export function ContextPage() {
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [selectedNovel, setSelectedNovel] = useState<string>("")
  const [config, setConfig] = useState<RetrievalConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    listNovels().then(r => {
      setNovels(r.novels)
      if (r.novels.length > 0 && !selectedNovel) {
        setSelectedNovel(r.novels[0].id)
      }
    }).catch(err => setError(err.message))
  }, [])

  useEffect(() => {
    if (!selectedNovel) return
    setError("")
    getRetrievalConfig(selectedNovel)
      .then(c => { setConfig(c); setDirty(false) })
      .catch(err => setError(err.message))
  }, [selectedNovel])

  const handleChange = useCallback((key: keyof RetrievalConfig, value: number) => {
    if (!config) return
    setConfig({ ...config, [key]: value })
    setDirty(true)
  }, [config])

  const handleSave = useCallback(async () => {
    if (!config || !selectedNovel) return
    setSaving(true)
    setError("")
    try {
      const { novelId, ...params } = config
      await updateRetrievalConfig(selectedNovel, params)
      setDirty(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [config, selectedNovel])

  return (
    <>
      <h1>Context Retrieval</h1>

      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <label style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>Novel:</label>
        <select
          value={selectedNovel}
          onChange={e => setSelectedNovel(e.target.value)}
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: "0.78rem",
            fontFamily: "inherit",
          }}
        >
          {novels.map(n => (
            <option key={n.id} value={n.id}>
              {n.id} ({n.phase}, ch{n.currentChapter}/{n.totalChapters})
            </option>
          ))}
        </select>

        {dirty && (
          <button className="btn" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        )}
      </div>

      {error && <div className="badge badge-error" style={{ marginBottom: 12 }}>{error}</div>}

      {config && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {(["limits", "search", "boost"] as const).map(group => (
            <section key={group}>
              <h2>{GROUP_LABELS[group]}</h2>
              <div className="param-grid">
                {PARAMS.filter(p => p.group === group).map(p => (
                  <div key={p.key} className="param-row">
                    <div className="param-label">
                      <span className="param-name">{p.label}</span>
                      <span className="param-desc">{p.description}</span>
                    </div>
                    <div className="param-control">
                      <input
                        type="range"
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        value={config[p.key] as number}
                        onChange={e => handleChange(p.key, parseFloat(e.target.value))}
                        className="param-slider"
                      />
                      <span className="param-value">
                        {typeof config[p.key] === "number"
                          ? (config[p.key] as number) % 1 === 0
                            ? config[p.key]
                            : (config[p.key] as number).toFixed(2)
                          : config[p.key]}
                        {p.unit ? ` ${p.unit}` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <section style={{ marginTop: 24 }}>
        <h2>How Retrieval Works</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.78rem", lineHeight: 1.6 }}>
          For each chapter, the scene outline is embedded and used as a query against 6 data tables
          (facts, events, summaries, character states, relationships, knowledge). Each table is searched
          with two legs — vector similarity (HNSW cosine) and keyword matching (tsvector). Results are
          fused using Reciprocal Rank Fusion, then boosted by character presence and location match,
          and decayed by recency. The top N results per type are assembled into the writer's context.
        </p>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.78rem", lineHeight: 1.6 }}>
          These parameters are tunable by the improvement daemon. The context quality benchmark measures
          relevance, completeness, noise, causal depth, and knowledge accuracy — each with a focused
          judge that produces diagnostic reasoning fed back to the improver.
        </p>
      </section>
    </>
  )
}
