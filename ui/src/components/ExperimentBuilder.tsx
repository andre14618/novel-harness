import { useEffect, useState } from "react"

const API_KEY = new URLSearchParams(window.location.search).get("key") ?? ""
const api = (path: string, opts?: RequestInit) =>
  fetch(`${path}${path.includes("?") ? "&" : "?"}key=${API_KEY}`, opts)

interface ModelInfo {
  id: string
  label: string
  provider: string
  pricing: { input: number; output: number }
  maxOutput?: number
}

interface Props {
  onCreated: (experimentId: number) => void
  onCancel: () => void
}

export function ExperimentBuilder({ onCreated, onCancel }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [seeds, setSeeds] = useState<string[]>([])
  const [name, setName] = useState("")
  const [suite, setSuite] = useState<string>("prose")
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [selectedSeeds, setSelectedSeeds] = useState<Set<string>>(new Set())
  const [runsPerSeed, setRunsPerSeed] = useState(2)
  const [penaltyJudges, setPenaltyJudges] = useState(true)
  const [lint, setLint] = useState(true)
  const [pairwise, setPairwise] = useState(false)
  const [sourceRunId, setSourceRunId] = useState("")
  const [genTransport, setGenTransport] = useState<"realtime" | "batch">("realtime")
  const [judgeTransport, setJudgeTransport] = useState<"realtime" | "batch">("realtime")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    api("/api/models").then(r => r.json()).then(setModels).catch(() => {})
    api("/api/seeds").then(r => r.json()).then(setSeeds).catch(() => {})
  }, [])

  function toggleModel(id: string) {
    setSelectedModels(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSeed(name: string) {
    setSelectedSeeds(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // Group models by provider
  const byProvider = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const list = byProvider.get(m.provider) ?? []
    list.push(m)
    byProvider.set(m.provider, list)
  }

  // Cost estimate
  const selectedModelList = models.filter(m => selectedModels.has(m.id))
  const seedCount = selectedSeeds.size || seeds.length
  const totalGens = selectedModelList.length * seedCount * runsPerSeed
  const avgOutputTokens = 1700 // from token norms data
  const avgPromptTokens = 1000
  const genCost = selectedModelList.reduce((sum, m) => {
    const perCall = (avgPromptTokens * m.pricing.input + avgOutputTokens * m.pricing.output) / 1_000_000
    return sum + perCall * seedCount * runsPerSeed
  }, 0)
  const judgeCost = penaltyJudges ? totalGens * 3 * 0.001 : 0 // ~$0.001/judge call (DeepSeek)
  const estimatedCost = sourceRunId ? judgeCost : genCost + judgeCost

  async function submit() {
    if (!name.trim()) { setError("Name is required"); return }
    if (selectedModels.size === 0 && !sourceRunId) { setError("Select at least one model"); return }
    setSubmitting(true)
    setError("")

    try {
      const body = {
        name,
        suite,
        models: sourceRunId
          ? [{ id: "source", provider: "source", label: "source-reuse" }]
          : selectedModelList.map(m => ({ id: m.id, provider: m.provider, label: m.label, maxTokens: m.maxOutput })),
        evaluations: { penaltyJudges, lint, pairwise },
        transport: { generation: genTransport, judging: judgeTransport },
        seeds: [...selectedSeeds],
        runsPerSeed,
        sourceRunId: sourceRunId ? parseInt(sourceRunId) : undefined,
      }

      const res = await api("/api/experiments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) {
        onCreated(data.experimentId)
      } else {
        setError(data.error ?? "Failed to create experiment")
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const sectionStyle = { marginBottom: "1rem" }
  const labelStyle = { fontSize: "0.8rem", color: "#8b949e", display: "block" as const, marginBottom: "0.3rem" }

  return (
    <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>New Experiment</h2>
        <button onClick={onCancel} style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", cursor: "pointer" }}>Cancel</button>
      </div>

      {/* Name */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Experiment Name</label>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Writer model sweep — romance-drama"
          style={{ width: "100%", maxWidth: "400px" }}
        />
      </div>

      {/* Suite */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Benchmark Suite</label>
        <select value={suite} onChange={e => setSuite(e.target.value)}>
          <option value="prose">Prose (penalty judges)</option>
          <option value="planning">Planning (1-10 scores)</option>
          <option value="extraction">Extraction (1-10 scores)</option>
          <option value="continuity">Continuity (1-10 scores)</option>
        </select>
      </div>

      {/* Source run (optional) */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Source Run ID (optional — reuse existing prose instead of generating)</label>
        <input
          type="text" value={sourceRunId} onChange={e => setSourceRunId(e.target.value)}
          placeholder="Leave empty to generate new prose"
          style={{ maxWidth: "200px" }}
        />
      </div>

      {/* Models */}
      {!sourceRunId && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Writer Models</label>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {[...byProvider.entries()].map(([provider, provModels]) => (
              <div key={provider} style={{ minWidth: "200px" }}>
                <div style={{ fontSize: "0.7rem", color: "#555", marginBottom: "0.3rem", textTransform: "uppercase" }}>{provider}</div>
                {provModels.map(m => (
                  <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "#c9d1d9", cursor: "pointer", marginBottom: "0.2rem" }}>
                    <input type="checkbox" checked={selectedModels.has(m.id)} onChange={() => toggleModel(m.id)} />
                    {m.label}
                    <span style={{ color: "#555", fontSize: "0.65rem" }}>${m.pricing.output}/M out</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Seeds */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Seeds (none selected = all)</label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {seeds.map(s => (
            <label key={s} style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "#c9d1d9", cursor: "pointer" }}>
              <input type="checkbox" checked={selectedSeeds.has(s)} onChange={() => toggleSeed(s)} />
              {s}
            </label>
          ))}
        </div>
      </div>

      {/* Runs per seed */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Runs per seed</label>
        <input type="number" value={runsPerSeed} onChange={e => setRunsPerSeed(parseInt(e.target.value) || 1)} min={1} max={10} style={{ width: "60px" }} />
      </div>

      {/* Evaluations */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Evaluations</label>
        <div style={{ display: "flex", gap: "1rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "#c9d1d9", cursor: "pointer" }}>
            <input type="checkbox" checked={penaltyJudges} onChange={e => setPenaltyJudges(e.target.checked)} />
            Penalty Judges (telling, dead-weight, dialogue)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "#c9d1d9", cursor: "pointer" }}>
            <input type="checkbox" checked={lint} onChange={e => setLint(e.target.checked)} />
            Lint (deterministic patterns)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem", color: "#c9d1d9", cursor: "pointer" }}>
            <input type="checkbox" checked={pairwise} onChange={e => setPairwise(e.target.checked)} />
            Pairwise A/B (first two models)
          </label>
        </div>
      </div>

      {/* Transport mode */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Transport Mode</label>
        <div style={{ display: "flex", gap: "2rem" }}>
          <div>
            <span style={{ fontSize: "0.75rem", color: "#8b949e" }}>Generation: </span>
            <label style={{ fontSize: "0.75rem", color: "#c9d1d9", cursor: "pointer", marginRight: "0.5rem" }}>
              <input type="radio" name="gen-transport" checked={genTransport === "realtime"} onChange={() => setGenTransport("realtime")} /> Real-time
            </label>
            <label style={{ fontSize: "0.75rem", color: "#c9d1d9", cursor: "pointer" }}>
              <input type="radio" name="gen-transport" checked={genTransport === "batch"} onChange={() => setGenTransport("batch")} /> Batch (50% off)
            </label>
          </div>
          <div>
            <span style={{ fontSize: "0.75rem", color: "#8b949e" }}>Judging: </span>
            <label style={{ fontSize: "0.75rem", color: "#c9d1d9", cursor: "pointer", marginRight: "0.5rem" }}>
              <input type="radio" name="judge-transport" checked={judgeTransport === "realtime"} onChange={() => setJudgeTransport("realtime")} /> Real-time
            </label>
            <label style={{ fontSize: "0.75rem", color: "#c9d1d9", cursor: "pointer" }}>
              <input type="radio" name="judge-transport" checked={judgeTransport === "batch"} onChange={() => setJudgeTransport("batch")} /> Batch (50% off)
            </label>
          </div>
        </div>
        {(genTransport === "batch" || judgeTransport === "batch") && (
          <p style={{ fontSize: "0.7rem", color: "#555", marginTop: "0.3rem" }}>
            Batch phases run async — results arrive when the provider processes them (minutes to hours). Check the experiments page for status.
          </p>
        )}
      </div>

      {/* Cost estimate */}
      <div style={{ padding: "0.5rem", background: "#161b22", borderRadius: "4px", marginBottom: "1rem", fontSize: "0.75rem" }}>
        <span style={{ color: "#8b949e" }}>Estimated cost: </span>
        <span style={{ color: "#4ecca3" }}>${estimatedCost.toFixed(4)}</span>
        <span style={{ color: "#555", marginLeft: "0.5rem" }}>
          ({totalGens} generations{penaltyJudges ? ` + ${totalGens * 3} judge calls` : ""})
        </span>
      </div>

      {/* Submit */}
      {error && <p style={{ color: "#f85149", fontSize: "0.8rem", marginBottom: "0.5rem" }}>{error}</p>}
      <button
        onClick={submit}
        disabled={submitting}
        style={{ padding: "0.4rem 1.2rem", cursor: submitting ? "wait" : "pointer", fontSize: "0.8rem" }}
      >
        {submitting ? "Creating..." : "Start Experiment"}
      </button>
    </div>
  )
}
