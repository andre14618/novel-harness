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
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSeed(s: string) {
    setSelectedSeeds(prev => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
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
  const avgOutputTokens = 1700
  const avgPromptTokens = 1000
  const batchDiscount = 0.5

  const genCost = selectedModelList.reduce((sum, m) => {
    const perCall = (avgPromptTokens * m.pricing.input + avgOutputTokens * m.pricing.output) / 1_000_000
    const discount = genTransport === "batch" ? batchDiscount : 1
    return sum + perCall * discount * seedCount * runsPerSeed
  }, 0)

  const judgeCallsPerGen = penaltyJudges ? 3 : 0
  const judgeCostPerCall = 0.001
  const judgeDiscount = judgeTransport === "batch" ? batchDiscount : 1
  const judgeCost = totalGens * judgeCallsPerGen * judgeCostPerCall * judgeDiscount

  const estimatedCost = sourceRunId ? judgeCost : genCost + judgeCost

  async function submit() {
    if (!name.trim()) { setError("Name is required"); return }
    if (selectedModels.size === 0 && !sourceRunId) { setError("Select at least one model"); return }
    setSubmitting(true)
    setError("")
    try {
      const body = {
        name, suite,
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
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) onCreated(data.experimentId)
      else setError(data.error ?? "Failed to create experiment")
    } catch (err) { setError(String(err)) }
    finally { setSubmitting(false) }
  }

  const S: Record<string, React.CSSProperties> = {
    section: { marginBottom: "1.2rem" },
    label: { fontSize: "0.8rem", color: "#c9d1d9", fontWeight: 600, display: "block", marginBottom: "0.4rem" },
    sublabel: { fontSize: "0.7rem", color: "#6e7681", fontWeight: 400 },
    providerGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.8rem" },
    providerCol: { background: "#161b22", borderRadius: "6px", padding: "0.6rem" },
    providerName: { fontSize: "0.65rem", color: "#8b949e", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: "0.4rem", fontWeight: 600 },
    modelRow: { display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.25rem 0", fontSize: "0.8rem", cursor: "pointer" },
    modelLabel: { color: "#e0e0e0", flex: 1 },
    modelPrice: { color: "#8b949e", fontSize: "0.7rem", whiteSpace: "nowrap" as const },
    seedRow: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.3rem 0.6rem", background: "#161b22", borderRadius: "4px", fontSize: "0.8rem", cursor: "pointer", color: "#e0e0e0" },
    evalRow: { display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.4rem 0.8rem", background: "#161b22", borderRadius: "4px", fontSize: "0.8rem", cursor: "pointer", color: "#e0e0e0" },
    transportGroup: { display: "flex", gap: "0.8rem", alignItems: "center" },
    transportLabel: { fontSize: "0.8rem", color: "#c9d1d9", minWidth: "90px" },
    radioLabel: { display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", color: "#e0e0e0", cursor: "pointer" },
    costBar: { padding: "0.6rem 0.8rem", background: "#0d1117", border: "1px solid #30363d", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" },
  }

  return (
    <div className="card" style={{ padding: "1.2rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>New Experiment</h2>
        <button onClick={onCancel} style={{ fontSize: "0.75rem", padding: "0.3rem 0.8rem", cursor: "pointer" }}>Cancel</button>
      </div>

      {/* Name */}
      <div style={S.section}>
        <label style={S.label}>Experiment Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Writer model sweep — romance-drama"
          style={{ width: "100%", maxWidth: "500px" }} />
      </div>

      {/* Suite */}
      <div style={S.section}>
        <label style={S.label}>Benchmark Suite</label>
        <select value={suite} onChange={e => setSuite(e.target.value)} style={{ minWidth: "250px" }}>
          <option value="prose">Prose (penalty judges)</option>
          <option value="planning">Planning (1-10 scores)</option>
          <option value="extraction">Extraction (1-10 scores)</option>
          <option value="continuity">Continuity (1-10 scores)</option>
        </select>
      </div>

      {/* Source run */}
      <div style={S.section}>
        <label style={S.label}>Source Run ID <span style={S.sublabel}>(optional — reuse existing prose instead of generating)</span></label>
        <input type="text" value={sourceRunId} onChange={e => setSourceRunId(e.target.value)}
          placeholder="Leave empty to generate new prose" style={{ maxWidth: "250px" }} />
      </div>

      {/* Models */}
      {!sourceRunId && (
        <div style={S.section}>
          <label style={S.label}>Writer Models</label>
          <div style={S.providerGrid}>
            {[...byProvider.entries()].map(([provider, provModels]) => (
              <div key={provider} style={S.providerCol}>
                <div style={S.providerName}>{provider}</div>
                {provModels.map(m => (
                  <label key={m.id} style={S.modelRow}>
                    <input type="checkbox" checked={selectedModels.has(m.id)} onChange={() => toggleModel(m.id)} />
                    <span style={S.modelLabel}>{m.label}</span>
                    <span style={S.modelPrice}>${m.pricing.output}/M</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Seeds */}
      <div style={S.section}>
        <label style={S.label}>Seeds <span style={S.sublabel}>(none = all)</span></label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {seeds.map(s => (
            <label key={s} style={S.seedRow}>
              <input type="checkbox" checked={selectedSeeds.has(s)} onChange={() => toggleSeed(s)} />
              {s}
            </label>
          ))}
        </div>
      </div>

      {/* Runs per seed */}
      <div style={S.section}>
        <label style={S.label}>Runs per seed</label>
        <input type="number" value={runsPerSeed} onChange={e => setRunsPerSeed(parseInt(e.target.value) || 1)}
          min={1} max={10} style={{ width: "70px" }} />
      </div>

      {/* Evaluations */}
      <div style={S.section}>
        <label style={S.label}>Evaluations</label>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <label style={S.evalRow}>
            <input type="checkbox" checked={penaltyJudges} onChange={e => setPenaltyJudges(e.target.checked)} />
            Penalty Judges <span style={S.sublabel}>(telling, dead-weight, dialogue)</span>
          </label>
          <label style={S.evalRow}>
            <input type="checkbox" checked={lint} onChange={e => setLint(e.target.checked)} />
            Lint <span style={S.sublabel}>(deterministic patterns)</span>
          </label>
          <label style={S.evalRow}>
            <input type="checkbox" checked={pairwise} onChange={e => setPairwise(e.target.checked)} />
            Pairwise A/B <span style={S.sublabel}>(first two models)</span>
          </label>
        </div>
      </div>

      {/* Transport */}
      <div style={S.section}>
        <label style={S.label}>Transport Mode</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={S.transportGroup}>
            <span style={S.transportLabel}>Generation:</span>
            <label style={S.radioLabel}>
              <input type="radio" name="gen-t" checked={genTransport === "realtime"} onChange={() => setGenTransport("realtime")} />
              Real-time
            </label>
            <label style={S.radioLabel}>
              <input type="radio" name="gen-t" checked={genTransport === "batch"} onChange={() => setGenTransport("batch")} />
              Batch <span style={{ color: "#4ecca3", fontSize: "0.7rem" }}>(50% off)</span>
            </label>
          </div>
          <div style={S.transportGroup}>
            <span style={S.transportLabel}>Judging:</span>
            <label style={S.radioLabel}>
              <input type="radio" name="judge-t" checked={judgeTransport === "realtime"} onChange={() => setJudgeTransport("realtime")} />
              Real-time
            </label>
            <label style={S.radioLabel}>
              <input type="radio" name="judge-t" checked={judgeTransport === "batch"} onChange={() => setJudgeTransport("batch")} />
              Batch <span style={{ color: "#4ecca3", fontSize: "0.7rem" }}>(50% off)</span>
            </label>
          </div>
        </div>
        {(genTransport === "batch" || judgeTransport === "batch") && (
          <p style={{ fontSize: "0.7rem", color: "#6e7681", marginTop: "0.4rem" }}>
            Batch phases run async — results arrive when the provider processes them. Check experiments page for status.
          </p>
        )}
      </div>

      {/* Cost estimate */}
      <div style={S.costBar}>
        <div>
          <span style={{ fontSize: "0.8rem", color: "#8b949e" }}>Estimated cost: </span>
          <span style={{ fontSize: "1rem", color: "#4ecca3", fontWeight: 700 }}>${estimatedCost.toFixed(4)}</span>
        </div>
        <span style={{ fontSize: "0.75rem", color: "#6e7681" }}>
          {sourceRunId ? "" : `${totalGens} gen`}
          {penaltyJudges ? `${sourceRunId ? "" : " + "}${totalGens * judgeCallsPerGen} judge` : ""}
          {(genTransport === "batch" || judgeTransport === "batch") ? " (batch discount applied)" : ""}
        </span>
      </div>

      {/* Submit */}
      {error && <p style={{ color: "#f85149", fontSize: "0.8rem", marginBottom: "0.5rem" }}>{error}</p>}
      <button onClick={submit} disabled={submitting}
        style={{ padding: "0.5rem 1.5rem", cursor: submitting ? "wait" : "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
        {submitting ? "Creating..." : "Start Experiment"}
      </button>
    </div>
  )
}
