import { useState, useEffect, useCallback } from "react"
import { listNovels, getDeterministicConfig, updateDeterministicConfig, type DeterministicConfig, type NovelListItem } from "../api"

interface ParamDef {
  key: keyof DeterministicConfig
  label: string
  description: string
  min: number
  max: number
  step: number
  group: "weights" | "thresholds"
}

const PARAMS: ParamDef[] = [
  { key: "causalParticipantWeight", label: "Participant Weight", description: "Shared characters between cause/effect events", min: 0, max: 1, step: 0.05, group: "weights" },
  { key: "causalLocationWeight", label: "Location Weight", description: "Same location between cause/effect events", min: 0, max: 1, step: 0.05, group: "weights" },
  { key: "causalTemporalWeight", label: "Temporal Weight", description: "Chapter proximity between events", min: 0, max: 1, step: 0.05, group: "weights" },
  { key: "causalConsequenceWeight", label: "Consequence Weight", description: "Keyword overlap between consequence text and effect", min: 0, max: 1, step: 0.05, group: "weights" },
  { key: "causalAutoThreshold", label: "Auto-Accept Threshold", description: "Score above this → auto-accepted without LLM", min: 0.5, max: 1.0, step: 0.05, group: "thresholds" },
  { key: "causalCandidateThreshold", label: "Candidate Threshold", description: "Score above this → sent to LLM for judgment", min: 0.2, max: 0.8, step: 0.05, group: "thresholds" },
]

const WEIGHT_KEYS: (keyof DeterministicConfig)[] = [
  "causalParticipantWeight", "causalLocationWeight", "causalTemporalWeight", "causalConsequenceWeight",
]

const GROUP_LABELS: Record<string, string> = {
  weights: "Causal Link Weights",
  thresholds: "Causal Thresholds",
}

export function DeterministicConfigPage() {
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [selectedNovel, setSelectedNovel] = useState<string>("")
  const [config, setConfig] = useState<DeterministicConfig | null>(null)
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
    getDeterministicConfig(selectedNovel)
      .then(c => { setConfig(c); setDirty(false) })
      .catch(err => setError(err.message))
  }, [selectedNovel])

  const weightSum = config
    ? WEIGHT_KEYS.reduce((sum, k) => sum + (config[k] as number), 0)
    : 0

  const handleChange = useCallback((key: keyof DeterministicConfig, value: number) => {
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
      await updateDeterministicConfig(selectedNovel, params)
      setDirty(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [config, selectedNovel])

  return (
    <>
      <h1>Deterministic Config</h1>

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
          {(["weights", "thresholds"] as const).map(group => (
            <section key={group}>
              <h2>
                {GROUP_LABELS[group]}
                {group === "weights" && (
                  <span style={{
                    marginLeft: 12,
                    fontSize: "0.72rem",
                    fontWeight: 400,
                    color: Math.abs(weightSum - 1.0) < 0.05 ? "var(--text-secondary)" : "var(--error)",
                  }}>
                    sum = {weightSum.toFixed(2)}
                    {Math.abs(weightSum - 1.0) >= 0.05 ? " (should be ~1.0)" : ""}
                  </span>
                )}
              </h2>
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
                        {(config[p.key] as number).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {group === "thresholds" && config && (
                <div style={{
                  marginTop: 12, padding: "8px 12px",
                  background: "var(--bg-elevated)", borderRadius: 4,
                  fontSize: "0.72rem", color: "var(--text-secondary)", lineHeight: 1.5,
                }}>
                  <strong>Score zones:</strong>{" "}
                  Below {(config.causalCandidateThreshold as number).toFixed(2)} = discarded |{" "}
                  {(config.causalCandidateThreshold as number).toFixed(2)}–{(config.causalAutoThreshold as number).toFixed(2)} = sent to LLM |{" "}
                  Above {(config.causalAutoThreshold as number).toFixed(2)} = auto-accepted
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <section style={{ marginTop: 24 }}>
        <h2>How Causal Scoring Works</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.78rem", lineHeight: 1.6 }}>
          After each chapter, the deterministic system scores every pair of (prior event, new event)
          for potential causal links. Four signals are combined using these weights: shared participants,
          same location, chapter proximity, and consequence text overlap. The weighted score determines
          whether the link is auto-accepted, sent to the graph-linker LLM for validation, or discarded.
        </p>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.78rem", lineHeight: 1.6 }}>
          Higher auto-accept threshold = more conservative (more LLM calls, more accurate).
          Lower candidate threshold = wider net (catches subtle connections, but more LLM cost).
        </p>
      </section>
    </>
  )
}
