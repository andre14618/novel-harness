import { useEffect, useState } from "react"
import { toggleModelHidden } from "../api"
import { SearchableSelect } from "./SearchableSelect"

interface ProviderInfo {
  tier: "fast" | "standard"
  cache: { type: string; minTokens?: number; discount?: number } | null
  batchApi: { available: boolean; discount: number; maxWindow?: string } | null
}

interface ModelInfo {
  id: string
  label: string
  provider: string
  params: string
  pricing: { input: number; output: number }
  thinking: "enabled" | "disabled" | "optional" | null
  observedTps: number | null
  maxContext: number | null
  maxOutput: number | null
  rateLimit: { requestsPerMin: number; tokensPerMin: number } | null
  providerStatus: "production" | "preview" | null
  notes: string | null
  hidden: boolean
}

interface RegistryData {
  providers: Record<string, ProviderInfo>
  models: ModelInfo[]
  hiddenModels: string[]
}

// Auth via nh_session cookie — same-origin fetch sends it automatically.

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function priceBg(cost: number): string {
  if (cost === 0) return "var(--accent-surface)"
  if (cost < 0.3) return "var(--accent-surface)"
  if (cost < 1.0) return "var(--yellow-surface)"
  if (cost < 3.0) return "rgba(232, 150, 71, 0.06)"
  return "var(--red-surface)"
}

type SortKey = "label" | "provider" | "input" | "output" | "params" | "context"
type SortDir = "asc" | "desc"

export function ModelsPage() {
  const [data, setData] = useState<RegistryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("provider")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [providerFilter, setProviderFilter] = useState<string>("all")
  const [thinkingFilter, setThinkingFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [showHidden, setShowHidden] = useState(false)

  function loadRegistry() {
    fetch("/api/models/registry", { credentials: "same-origin" })
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(String(e)))
  }

  useEffect(() => { loadRegistry() }, [])

  async function handleToggleHidden(model: ModelInfo) {
    const newHidden = !model.hidden
    try {
      await toggleModelHidden(model.provider, model.id, newHidden)
      // Optimistic update
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          models: prev.models.map(m =>
            m.id === model.id && m.provider === model.provider
              ? { ...m, hidden: newHidden }
              : m
          ),
        }
      })
    } catch {}
  }

  if (error) return <p style={{ color: "var(--red)" }}>Error: {error}</p>
  if (!data) return <p style={{ color: "var(--text-secondary)" }}>Loading registry...</p>

  const providerNames = Object.keys(data.providers).sort()
  const hiddenCount = data.models.filter(m => m.hidden).length

  let models = [...data.models]

  // Filter hidden unless showing
  if (!showHidden) models = models.filter(m => !m.hidden)

  if (providerFilter !== "all") models = models.filter(m => m.provider === providerFilter)
  if (thinkingFilter !== "all") models = models.filter(m => (m.thinking ?? "disabled") === thinkingFilter)
  if (search) {
    const q = search.toLowerCase()
    models = models.filter(m =>
      m.label.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      (m.notes ?? "").toLowerCase().includes(q)
    )
  }

  models.sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case "label": cmp = a.label.localeCompare(b.label); break
      case "provider": cmp = a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label); break
      case "input": cmp = a.pricing.input - b.pricing.input; break
      case "output": cmp = a.pricing.output - b.pricing.output; break
      case "params": cmp = a.params.localeCompare(b.params); break
      case "context": cmp = (a.maxContext ?? 0) - (b.maxContext ?? 0); break
    }
    return sortDir === "desc" ? -cmp : cmp
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("asc") }
  }

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""

  const thStyle = {
    cursor: "pointer" as const,
    userSelect: "none" as const,
    whiteSpace: "nowrap" as const,
  }

  const providerOptions = [
    { value: "all", label: "All providers" },
    ...providerNames.map(p => ({ value: p, label: p })),
  ]

  const thinkingOptions = [
    { value: "all", label: "All thinking" },
    { value: "enabled", label: "Thinking: enabled" },
    { value: "optional", label: "Thinking: optional" },
    { value: "disabled", label: "Thinking: disabled" },
  ]

  return (
    <>
      <h1>Model Registry</h1>
      <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "1rem", lineHeight: 1.6 }}>
        All models from <code>models/registry.ts</code>. Pricing is $/1M tokens. Click headers to sort.
        Toggle visibility to hide models from all dropdowns across the app.
      </p>

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search models..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: "220px" }}
        />
        <SearchableSelect
          value={providerFilter}
          onChange={setProviderFilter}
          options={providerOptions}
          style={{ width: "160px" }}
        />
        <SearchableSelect
          value={thinkingFilter}
          onChange={setThinkingFilter}
          options={thinkingOptions}
          style={{ width: "170px" }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", color: "var(--text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
          Show hidden ({hiddenCount})
        </label>
        <span style={{ fontSize: "0.72rem", color: "var(--text-ghost)" }}>
          {models.length} model{models.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Provider summary cards */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {providerNames.map(name => {
          const p = data.providers[name]
          const allCount = data.models.filter(m => m.provider === name)
          const visibleCount = allCount.filter(m => !m.hidden).length
          const isActive = providerFilter === name
          return (
            <div
              key={name}
              onClick={() => setProviderFilter(isActive ? "all" : name)}
              className="card"
              style={{
                padding: "0.6rem 0.9rem",
                cursor: "pointer",
                minWidth: "120px",
                borderColor: isActive ? "var(--accent-dim)" : undefined,
                background: isActive ? "var(--accent-surface)" : undefined,
              }}
            >
              <div style={{
                fontWeight: 700,
                fontSize: "0.82rem",
                textTransform: "capitalize",
                color: isActive ? "var(--accent)" : "var(--text-primary)",
              }}>
                {name}
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                {p.tier === "fast"
                  ? <span style={{ color: "var(--yellow)" }}>Fast</span>
                  : <span>Standard</span>
                }
                {" \u00b7 "}{visibleCount}/{allCount.length} models
              </div>
              <div style={{ fontSize: "0.62rem", color: "var(--text-ghost)", marginTop: "3px" }}>
                {p.cache?.type === "automatic"
                  ? `Cache: ${p.cache.discount ? (p.cache.discount * 100).toFixed(0) + "% off" : "no savings"}`
                  : "No cache"}
                {p.batchApi?.available ? ` \u00b7 Batch ${(p.batchApi.discount * 100).toFixed(0)}% off` : ""}
              </div>
            </div>
          )
        })}
      </div>

      {/* Models table */}
      <div style={{ overflowX: "auto" }}>
        <table className="guide-table" style={{ minWidth: "1000px" }}>
          <thead>
            <tr>
              <th style={{ width: "36px" }}></th>
              <th style={thStyle} onClick={() => toggleSort("label")}>Model{arrow("label")}</th>
              <th style={thStyle} onClick={() => toggleSort("provider")}>Provider{arrow("provider")}</th>
              <th style={thStyle} onClick={() => toggleSort("params")}>Params{arrow("params")}</th>
              <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("input")}>In $/M{arrow("input")}</th>
              <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("output")}>Out $/M{arrow("output")}</th>
              <th>Think</th>
              <th style={{ ...thStyle, textAlign: "right" }} onClick={() => toggleSort("context")}>Context{arrow("context")}</th>
              <th style={{ textAlign: "right" }}>Max Out</th>
              <th style={{ textAlign: "right" }}>TPS</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m, i) => (
              <tr key={`${m.provider}-${m.id}-${i}`} className={m.hidden ? "model-hidden-row" : ""}>
                <td style={{ padding: "4px" }}>
                  <button
                    className="vis-toggle"
                    onClick={() => handleToggleHidden(m)}
                    title={m.hidden ? "Show in dropdowns" : "Hide from dropdowns"}
                  >
                    {m.hidden ? "\u25CB" : "\u25CF"}
                  </button>
                </td>
                <td>
                  <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "0.82rem" }}>{m.label}</div>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-ghost)" }}>{m.id}</div>
                </td>
                <td>
                  <span style={{
                    textTransform: "capitalize",
                    color: data.providers[m.provider]?.tier === "fast" ? "var(--yellow)" : "var(--text-secondary)",
                    fontWeight: 600,
                    fontSize: "0.78rem",
                  }}>
                    {m.provider}
                  </span>
                  {m.providerStatus === "preview" && (
                    <span className="badge idle" style={{ marginLeft: "4px", fontSize: "0.58rem", padding: "1px 5px" }}>preview</span>
                  )}
                </td>
                <td style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>{m.params}</td>
                <td style={{ background: priceBg(m.pricing.input), textAlign: "right", fontWeight: 600, fontSize: "0.78rem" }}>
                  {m.pricing.input === 0
                    ? <span style={{ color: "var(--accent)" }}>free</span>
                    : <span style={{ color: "var(--text-primary)" }}>${m.pricing.input}</span>}
                </td>
                <td style={{ background: priceBg(m.pricing.output), textAlign: "right", fontWeight: 600, fontSize: "0.78rem" }}>
                  {m.pricing.output === 0
                    ? <span style={{ color: "var(--accent)" }}>free</span>
                    : <span style={{ color: "var(--text-primary)" }}>${m.pricing.output}</span>}
                </td>
                <td style={{ fontSize: "0.75rem" }}>
                  {m.thinking === "enabled" && <span style={{ color: "var(--accent)", fontWeight: 600 }}>on</span>}
                  {m.thinking === "optional" && <span style={{ color: "var(--yellow)" }}>opt</span>}
                  {(m.thinking === "disabled" || !m.thinking) && <span style={{ color: "var(--text-ghost)" }}>--</span>}
                </td>
                <td style={{ color: "var(--text-secondary)", textAlign: "right", fontSize: "0.78rem" }}>
                  {m.maxContext ? fmt(m.maxContext) : <span style={{ color: "var(--text-ghost)" }}>--</span>}
                </td>
                <td style={{ color: "var(--text-secondary)", textAlign: "right", fontSize: "0.78rem" }}>
                  {m.maxOutput ? fmt(m.maxOutput) : <span style={{ color: "var(--text-ghost)" }}>--</span>}
                </td>
                <td style={{ textAlign: "right", fontSize: "0.78rem" }}>
                  {m.observedTps
                    ? <span style={{ color: "var(--accent)", fontWeight: 600 }}>{m.observedTps}</span>
                    : <span style={{ color: "var(--text-ghost)" }}>--</span>}
                </td>
                <td style={{ fontSize: "0.7rem", color: "var(--text-secondary)", maxWidth: "240px", lineHeight: 1.4 }}>
                  {m.notes ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {models.length === 0 && (
        <p style={{ color: "var(--text-ghost)", textAlign: "center", padding: "2rem" }}>No models match your filters.</p>
      )}
    </>
  )
}
