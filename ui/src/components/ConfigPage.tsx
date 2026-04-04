import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { getNovelConfig, setAgentConfig, resetAgentConfig } from "../api"
import type { NovelConfig } from "../api"

const AGENT_LABELS: Record<string, string> = {
  "writer": "Writer",
  "rewriter": "Rewriter",
  "prose-polish": "Prose Polish",
  "world-builder": "World Builder",
  "character-agent": "Character Agent",
  "plotter": "Plotter",
  "planning-plotter": "Planning Plotter",
  "summary-extractor": "Summary Extractor",
  "fact-extractor": "Fact Extractor",
  "character-state": "Character State",
  "continuity": "Continuity Checker",
  "cross-chapter-continuity": "Cross-Chapter Continuity",
  "prose-quality": "Prose Quality",
  "judge": "Judge",
  "pairwise-judge": "Pairwise Judge",
  "benchmark-writer": "Benchmark Writer",
  "benchmark-judge": "Benchmark Judge",
  "improver": "Improver",
}

interface EditState {
  provider: string
  model: string
  temperature: string
}

export function ConfigPage() {
  const [config, setConfig] = useState<NovelConfig | null>(null)
  const [editing, setEditing] = useState<Record<string, EditState>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [flash, setFlash] = useState<{ agent: string; msg: string; ok: boolean } | null>(null)

  function loadConfig() {
    getNovelConfig().then(setConfig).catch(() => {})
  }

  useEffect(() => { loadConfig() }, [])

  function startEdit(agent: string) {
    if (!config) return
    const a = config.assignments[agent]
    setEditing(prev => ({
      ...prev,
      [agent]: {
        provider: a.provider,
        model: a.model,
        temperature: String(a.temperature),
      },
    }))
  }

  function cancelEdit(agent: string) {
    setEditing(prev => {
      const next = { ...prev }
      delete next[agent]
      return next
    })
  }

  function updateEdit(agent: string, field: keyof EditState, value: string) {
    setEditing(prev => ({
      ...prev,
      [agent]: { ...prev[agent], [field]: value },
    }))
    // When provider changes, reset model to first available for that provider
    if (field === "provider" && config) {
      const firstModel = config.models.find(m => m.provider === value)
      if (firstModel) {
        setEditing(prev => ({
          ...prev,
          [agent]: { ...prev[agent], provider: value, model: firstModel.id },
        }))
      }
    }
  }

  async function saveEdit(agent: string) {
    const edit = editing[agent]
    if (!edit) return
    setSaving(prev => ({ ...prev, [agent]: true }))
    try {
      await setAgentConfig(agent, {
        provider: edit.provider,
        model: edit.model,
        temperature: parseFloat(edit.temperature),
      })
      setFlash({ agent, msg: "Saved", ok: true })
      cancelEdit(agent)
      loadConfig()
    } catch (err: any) {
      setFlash({ agent, msg: err.message, ok: false })
    } finally {
      setSaving(prev => ({ ...prev, [agent]: false }))
      setTimeout(() => setFlash(null), 3000)
    }
  }

  async function handleReset(agent: string) {
    setSaving(prev => ({ ...prev, [agent]: true }))
    try {
      await resetAgentConfig(agent)
      setFlash({ agent, msg: "Reset to default", ok: true })
      cancelEdit(agent)
      loadConfig()
    } catch (err: any) {
      setFlash({ agent, msg: err.message, ok: false })
    } finally {
      setSaving(prev => ({ ...prev, [agent]: false }))
      setTimeout(() => setFlash(null), 3000)
    }
  }

  const key = new URLSearchParams(window.location.search).get("key") ?? ""

  if (!config) {
    return <div className="app"><p style={{ color: "#8b949e" }}>Loading config...</p></div>
  }

  return (
    <div className="app">
      <div className="top-bar">
        <h1>Agent Configuration</h1>
        <nav>
          <Link to={`/${window.location.search}`}>Novel UI</Link>
          <a href={`/?key=${key}`}>Dashboard</a>
        </nav>
      </div>

      <p style={{ fontSize: "0.8rem", color: "#8b949e", marginBottom: "1rem", lineHeight: 1.6 }}>
        Configure which model each agent uses. Changes take effect on the next agent call — even mid-run.
        Overrides are shown with a yellow badge and reset on server restart.
      </p>

      {Object.entries(config.agentGroups).map(([groupKey, group]) => (
        <div key={groupKey} style={{ marginBottom: "1.5rem" }}>
          <h2>{group.label}</h2>
          <p style={{ fontSize: "0.75rem", color: "#555", marginBottom: "0.5rem" }}>{group.description}</p>

          {group.agents.map(agent => {
            const assignment = config.assignments[agent]
            if (!assignment) return null
            const isOverridden = !!config.overrides[agent]
            const edit = editing[agent]
            const isSaving = saving[agent]
            const agentFlash = flash?.agent === agent ? flash : null

            // Find model label
            const modelInfo = config.models.find(m => m.id === assignment.model && m.provider === assignment.provider)
            const modelLabel = modelInfo?.label ?? assignment.model

            return (
              <div key={agent} className="card agent-config-row">
                <div className="agent-config-header">
                  <div>
                    <strong>{AGENT_LABELS[agent] ?? agent}</strong>
                    {isOverridden && <span className="badge active" style={{ marginLeft: "0.5rem", fontSize: "0.65rem" }}>overridden</span>}
                  </div>
                  {!edit && (
                    <button className="secondary" onClick={() => startEdit(agent)} style={{ padding: "3px 10px", fontSize: "0.75rem" }}>
                      Edit
                    </button>
                  )}
                </div>

                {agentFlash && (
                  <div style={{ fontSize: "0.75rem", color: agentFlash.ok ? "#4ecca3" : "#e74c3c", marginBottom: "0.3rem" }}>
                    {agentFlash.msg}
                  </div>
                )}

                {edit ? (
                  <div className="agent-config-edit">
                    <div className="agent-config-fields">
                      <div>
                        <label style={{ fontSize: "0.7rem", color: "#8b949e" }}>Provider</label>
                        <select value={edit.provider} onChange={e => updateEdit(agent, "provider", e.target.value)}>
                          {config.providers.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: "0.7rem", color: "#8b949e" }}>Model</label>
                        <select value={edit.model} onChange={e => updateEdit(agent, "model", e.target.value)}>
                          {config.models
                            .filter(m => m.provider === edit.provider)
                            .map(m => (
                              <option key={m.id} value={m.id}>
                                {m.label} {m.pricing ? `($${m.pricing.input}/$${m.pricing.output} per 1M)` : ""}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: "0.7rem", color: "#8b949e" }}>Temperature</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          value={edit.temperature}
                          onChange={e => updateEdit(agent, "temperature", e.target.value)}
                          style={{ width: "80px" }}
                        />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                      <button onClick={() => saveEdit(agent)} disabled={isSaving} style={{ padding: "4px 12px", fontSize: "0.75rem" }}>
                        {isSaving ? "..." : "Save"}
                      </button>
                      <button className="secondary" onClick={() => cancelEdit(agent)} disabled={isSaving} style={{ padding: "4px 12px", fontSize: "0.75rem" }}>
                        Cancel
                      </button>
                      {isOverridden && (
                        <button className="danger" onClick={() => handleReset(agent)} disabled={isSaving} style={{ padding: "4px 12px", fontSize: "0.75rem" }}>
                          Reset to Default
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="agent-config-display">
                    <span className="config-tag">{assignment.provider}</span>
                    <span className="config-tag">{modelLabel}</span>
                    <span className="config-tag">temp {assignment.temperature}</span>
                    <span className="config-tag">{assignment.maxTokens} max tokens</span>
                    {modelInfo?.pricing && (
                      <span className="config-tag" style={{ color: "#4ecca3" }}>
                        ${modelInfo.pricing.input}/${modelInfo.pricing.output} per 1M
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
