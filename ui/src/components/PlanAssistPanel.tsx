import { useState } from "react"
import { decidePlanAssist, type PlanAssistPayload } from "../api"

interface Props {
  novelId: string
  chapter: number
  payload: PlanAssistPayload
  onDecided: () => void
}

/**
 * Minimal stub — step 2 of docs/exhaustion-handler-design.md. Edit-plan
 * uses a raw JSON textarea for now; step 4 of the design memo will ship
 * the proper outline editor.
 */
export function PlanAssistPanel({ novelId, chapter, payload, onDecided }: Props) {
  const [deciding, setDeciding] = useState(false)
  const [mode, setMode] = useState<"choose" | "edit">("choose")
  const [outlineJson, setOutlineJson] = useState(() => JSON.stringify(payload.outline, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<string | null>(null)

  async function submit(action: "edit-plan" | "override" | "abort") {
    setDeciding(true)
    setError(null)
    try {
      if (action === "edit-plan") {
        let parsed: any
        try {
          parsed = JSON.parse(outlineJson)
        } catch (parseErr: any) {
          setError(`Outline JSON parse failed: ${parseErr.message}`)
          setDeciding(false)
          return
        }
        await decidePlanAssist(novelId, chapter, { action: "edit-plan", outline: parsed })
        setSubmitted("Outline edit submitted — pipeline restarting with new plan…")
      } else if (action === "override") {
        await decidePlanAssist(novelId, chapter, { action: "override" })
        setSubmitted("Override recorded — pipeline will bypass blocking checks for this chapter.")
      } else {
        await decidePlanAssist(novelId, chapter, { action: "abort" })
        setSubmitted("Chapter aborted — drafting phase will stop. Resume after manual fix.")
      }
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

      {error && <p style={{ color: "#e74c3c", fontSize: "0.85rem", marginTop: "0.6rem" }}>{error}</p>}

      {mode === "edit" ? (
        <div style={{ marginTop: "0.8rem" }}>
          <p style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.3rem" }}>
            Paste or edit the full ChapterOutline JSON below. Server-side
            validation will reject partial or malformed outlines.
          </p>
          <textarea
            value={outlineJson}
            onChange={e => setOutlineJson(e.target.value)}
            style={{ width: "100%", minHeight: "300px", fontFamily: "monospace", fontSize: "0.8rem" }}
            autoFocus
          />
          <div className="gate-actions" style={{ marginTop: "0.6rem" }}>
            <button onClick={() => submit("edit-plan")} disabled={deciding}>
              {deciding ? "Submitting…" : "Submit edited plan"}
            </button>
            <button className="secondary" onClick={() => setMode("choose")} disabled={deciding}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="gate-actions" style={{ marginTop: "0.8rem" }}>
          <button onClick={() => setMode("edit")} disabled={deciding}>
            Edit plan (JSON)
          </button>
          <button className="secondary" onClick={() => submit("override")} disabled={deciding}>
            {deciding ? "…" : "Override (ship anyway)"}
          </button>
          <button className="danger" onClick={() => submit("abort")} disabled={deciding}>
            Abort chapter
          </button>
        </div>
      )}
    </div>
  )
}
