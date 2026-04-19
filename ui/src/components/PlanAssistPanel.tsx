import { useState } from "react"
import { decidePlanAssist, type PlanAssistPayload } from "../api"
import { OutlineEditor } from "./OutlineEditor"

interface Props {
  novelId: string
  chapter: number
  payload: PlanAssistPayload
  onDecided: () => void
}

/**
 * Renders when the drafting pipeline hits a plan-assist gate
 * (docs/exhaustion-handler-design.md). Three decisions surface here:
 *   - edit-plan — structured OutlineEditor (with raw-JSON escape hatch)
 *   - override — persists plan_check_overridden=true for the chapter
 *   - abort    — stops the drafting phase; user resumes later manually
 */
export function PlanAssistPanel({ novelId, chapter, payload, onDecided }: Props) {
  const [deciding, setDeciding] = useState(false)
  const [mode, setMode] = useState<"choose" | "edit">("choose")
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<string | null>(null)

  async function submitEditPlan(outline: any) {
    setDeciding(true)
    setError(null)
    try {
      await decidePlanAssist(novelId, chapter, { action: "edit-plan", outline })
      setSubmitted("Outline edit submitted — pipeline restarting with new plan…")
      setTimeout(onDecided, 1000)
    } catch (err: any) {
      setError(err.message ?? String(err))
      setDeciding(false)
    }
  }

  async function submitOverride() {
    setDeciding(true)
    setError(null)
    try {
      await decidePlanAssist(novelId, chapter, { action: "override" })
      setSubmitted("Override recorded — pipeline will bypass blocking checks for this chapter.")
      setTimeout(onDecided, 1000)
    } catch (err: any) {
      setError(err.message ?? String(err))
      setDeciding(false)
    }
  }

  async function submitAbort() {
    setDeciding(true)
    setError(null)
    try {
      await decidePlanAssist(novelId, chapter, { action: "abort" })
      setSubmitted("Chapter aborted — drafting phase will stop. Resume after manual fix.")
      setTimeout(onDecided, 1000)
    } catch (err: any) {
      setError(err.message ?? String(err))
      setDeciding(false)
    }
  }

  if (submitted) {
    return (
      <div className="gate-panel" style={{ borderColor: "#4ecca3" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
          <div className="spinner" />
          <span style={{ color: "#4ecca3" }}>{submitted}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="gate-panel" style={{ borderColor: "#e67e22" }}>
      <h3 style={{ color: "#e67e22" }}>
        Plan-assist Gate — Chapter {chapter} ({payload.kind})
      </h3>
      <p style={{ fontSize: "0.85rem", color: "#aaa", marginTop: 0 }}>
        Automated repair has run out of moves. Pick an action to continue.
      </p>

      <div style={{ marginTop: "0.8rem", fontSize: "0.85rem" }}>
        <strong>Unresolved issues ({payload.unresolvedDeviations.length}):</strong>
        <ul style={{ margin: "0.4rem 0 0 0", paddingLeft: "1.2rem" }}>
          {payload.unresolvedDeviations.map((d, i) => (
            <li key={i} style={{ marginBottom: "0.2rem" }}>
              <code style={{ fontSize: "0.8rem", color: "#888" }}>
                [beat {d.beat_index == null ? "chapter-level" : d.beat_index}]
              </code>{" "}
              {d.description}
            </li>
          ))}
        </ul>
      </div>

      {payload.reviserHistory && (
        <div style={{ marginTop: "0.8rem", fontSize: "0.85rem", color: "#ccc" }}>
          <strong>Reviser was invoked and rejected:</strong>{" "}
          <em>{payload.reviserHistory.rejectionReason}</em>
          {payload.reviserHistory.attemptedScenes.length > 0 && (
            <span> ({payload.reviserHistory.attemptedScenes.length} attempted beats)</span>
          )}
        </div>
      )}

      {mode === "edit" ? (
        <OutlineEditor
          initialOutline={payload.outline}
          onSubmit={submitEditPlan}
          onCancel={() => { setMode("choose"); setError(null) }}
          submitting={deciding}
          error={error}
        />
      ) : (
        <>
          {error && <p style={{ color: "#e74c3c", fontSize: "0.85rem", marginTop: "0.6rem" }}>{error}</p>}
          <div className="gate-actions" style={{ marginTop: "0.8rem" }}>
            <button onClick={() => setMode("edit")} disabled={deciding}>
              Edit plan
            </button>
            <button className="secondary" onClick={submitOverride} disabled={deciding}>
              {deciding ? "…" : "Override (ship anyway)"}
            </button>
            <button className="danger" onClick={submitAbort} disabled={deciding}>
              Abort chapter
            </button>
          </div>
        </>
      )}
    </div>
  )
}
