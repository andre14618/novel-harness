import { useEffect, useState } from "react"

import { getNovelConfig, setAgentConfig, resetAgentConfig, persistConfig } from "../api"
import type { NovelConfig } from "../api"
import { SearchableSelect } from "./SearchableSelect"

const AGENT_LABELS: Record<string, string> = {
  "writer": "Writer",
  "beat-writer": "Beat Writer",
  "world-builder": "World Builder",
  "character-agent": "Character Agent",
  "plotter": "Plotter",
  "planning-plotter": "Planning Plotter",
  "planning-scenes": "Planning Scenes",
  "reference-resolver": "Reference Resolver",
  "adherence-events": "Adherence Events",
  "halluc-ungrounded": "Hallucination — Ungrounded Entities",
  "functional-state-checker": "Functional State Checker",
  "chapter-plan-checker": "Chapter Plan Checker",
  "lint-fixer": "Lint Fixer",
  "continuity-facts": "Continuity — Facts",
  "continuity-state": "Continuity — State",
  "improver": "Improver",
}

export function ConfigPage() {
  const [config, setConfig] = useState<NovelConfig | null>(null)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [flash, setFlash] = useState<{ agent: string; msg: string; ok: boolean } | null>(null)
  const [persisting, setPersisting] = useState(false)
  const [persistMsg, setPersistMsg] = useState<{ msg: string; ok: boolean } | null>(null)

  function loadConfig() {
    getNovelConfig().then(setConfig).catch(() => {})
  }

  useEffect(() => { loadConfig() }, [])

  async function handleChange(agent: string, field: string, value: string) {
    if (!config) return
    const current = config.assignments[agent]

    // If provider changed, pick the first model for that provider
    let update: Record<string, any> = { [field]: field === "temperature" ? parseFloat(value) : value }
    if (field === "provider") {
      const firstModel = config.models.find(m => m.provider === value)
      if (firstModel) update.model = firstModel.id
    }

    setSaving(prev => ({ ...prev, [agent]: true }))
    try {
      await setAgentConfig(agent, update)
      setFlash({ agent, msg: "Saved", ok: true })
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
      loadConfig()
    } catch (err: any) {
      setFlash({ agent, msg: err.message, ok: false })
    } finally {
      setSaving(prev => ({ ...prev, [agent]: false }))
      setTimeout(() => setFlash(null), 3000)
    }
  }

  if (!config) {
    return <p style={{ color: "var(--text-secondary)" }}>Loading config...</p>
  }

  // Build unified model options: all models across all providers, searchable by name/provider/price
  const allModelOptions = config.models.map(m => ({
    value: `${m.provider}:${m.id}`,
    label: m.label,
    sublabel: `${m.provider}${m.pricing ? ` · $${m.pricing.input}/$${m.pricing.output}` : ""}`,
  }))

  async function handleModelSelect(agent: string, provider: string, model: string) {
    setSaving(prev => ({ ...prev, [agent]: true }))
    try {
      await setAgentConfig(agent, { provider, model })
      setFlash({ agent, msg: "Saved", ok: true })
      loadConfig()
    } catch (err: any) {
      setFlash({ agent, msg: err.message, ok: false })
    } finally {
      setSaving(prev => ({ ...prev, [agent]: false }))
      setTimeout(() => setFlash(null), 3000)
    }
  }

  const hasOverrides = Object.keys(config.overrides).length > 0

  return (
    <>
      <h1>Configuration</h1>

      <p style={{ fontSize: "0.8rem", color: "#8b949e", marginBottom: "0.5rem", lineHeight: 1.6 }}>
        Configure which model each agent uses. Changes take effect immediately on the next agent call.
        Use "Save to File" to write changes permanently to <code>models/roles.ts</code>.
      </p>

      {hasOverrides && (
        <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.8rem" }}>
          <button
            onClick={async () => {
              setPersisting(true)
              try {
                const res = await persistConfig()
                setPersistMsg({ msg: `Saved ${res.changed.length} override(s) to roles.ts`, ok: true })
                loadConfig()
              } catch (err: any) {
                setPersistMsg({ msg: err.message, ok: false })
              } finally {
                setPersisting(false)
                setTimeout(() => setPersistMsg(null), 5000)
              }
            }}
            disabled={persisting}
          >
            {persisting ? "Saving..." : "Save to File"}
          </button>
          {persistMsg && (
            <span style={{ fontSize: "0.8rem", color: persistMsg.ok ? "#4ecca3" : "#e74c3c" }}>
              {persistMsg.msg}
            </span>
          )}
        </div>
      )}

      {Object.entries(config.agentGroups).map(([groupKey, group]) => (
        <div key={groupKey} style={{ marginBottom: "1.5rem" }}>
          <h2>{group.label}</h2>
          <p style={{ fontSize: "0.75rem", color: "#555", marginBottom: "0.5rem" }}>{group.description}</p>

          {group.agents.map(agent => {
            const assignment = config.assignments[agent]
            if (!assignment) return null
            const isOverridden = !!config.overrides[agent]
            const isSaving = saving[agent]
            const agentFlash = flash?.agent === agent ? flash : null
            const modelInfo = config.models.find(m => m.id === assignment.model && m.provider === assignment.provider)

            // Composite key for current selection
            const compositeValue = `${assignment.provider}:${assignment.model}`

            return (
              <div key={agent} className="card agent-config-row">
                <div className="agent-config-header">
                  <div>
                    <strong>{AGENT_LABELS[agent] ?? agent}</strong>
                    {isOverridden && (
                      <>
                        <span className="badge active" style={{ marginLeft: "0.5rem", fontSize: "0.65rem" }}>overridden</span>
                        <button
                          className="secondary"
                          onClick={() => handleReset(agent)}
                          disabled={isSaving}
                          style={{ marginLeft: "0.5rem", padding: "1px 8px", fontSize: "0.65rem" }}
                        >
                          reset
                        </button>
                      </>
                    )}
                    {isSaving && <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", color: "var(--yellow)" }}>saving...</span>}
                  </div>
                  {modelInfo?.pricing && (
                    <span style={{ fontSize: "0.7rem", color: "var(--accent)" }}>
                      ${modelInfo.pricing.input} / ${modelInfo.pricing.output} per 1M tokens
                    </span>
                  )}
                </div>

                {agentFlash && (
                  <div style={{ fontSize: "0.75rem", color: agentFlash.ok ? "var(--accent)" : "var(--red)", marginBottom: "0.3rem" }}>
                    {agentFlash.msg}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem", alignItems: "end" }}>
                  <div>
                    <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Model</label>
                    <SearchableSelect
                      value={compositeValue}
                      onChange={v => {
                        const [provider, ...rest] = v.split(":")
                        const model = rest.join(":")
                        handleModelSelect(agent, provider, model)
                      }}
                      disabled={isSaving}
                      options={allModelOptions}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Temp</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={assignment.temperature}
                      onChange={e => handleChange(agent, "temperature", e.target.value)}
                      disabled={isSaving}
                      style={{ width: "70px" }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}
