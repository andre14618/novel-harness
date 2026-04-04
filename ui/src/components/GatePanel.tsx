import { useState } from "react"
import { decideGate } from "../api"

interface Props {
  novelId: string
  gateId: string
  title: string
  content: string
  onDecided: () => void
}

export function GatePanel({ novelId, gateId, title, content, onDecided }: Props) {
  const [deciding, setDeciding] = useState(false)
  const [showRevise, setShowRevise] = useState(false)
  const [notes, setNotes] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<string | null>(null)

  async function decide(action: "approve" | "revise" | "reject") {
    setDeciding(true)
    setError(null)
    try {
      const noteList = action === "revise" && notes.trim()
        ? notes.trim().split("\n").filter(Boolean)
        : undefined
      await decideGate(novelId, gateId, action, noteList)
      setSubmitted(
        action === "approve" ? "Approved — continuing pipeline..."
        : action === "revise" ? `Revision submitted (${noteList?.length ?? 0} notes) — regenerating...`
        : "Rejected — regenerating from scratch..."
      )
      // Brief delay so user sees the confirmation before gate disappears
      setTimeout(onDecided, 800)
    } catch (err: any) {
      setError(err.message)
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
    <div className="gate-panel">
      <h3>Awaiting Review: {title}</h3>
      <div className="gate-content">{content}</div>

      {error && <p style={{ color: "#e74c3c", fontSize: "0.85rem" }}>{error}</p>}

      {showRevise ? (
        <div>
          <textarea
            placeholder="Revision notes (one per line)..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            autoFocus
          />
          <div className="gate-actions">
            <button onClick={() => decide("revise")} disabled={deciding || !notes.trim()}>
              {deciding ? "Submitting..." : "Submit Revision"}
            </button>
            <button className="secondary" onClick={() => setShowRevise(false)} disabled={deciding}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="gate-actions">
          <button onClick={() => decide("approve")} disabled={deciding}>
            {deciding ? "..." : "Approve"}
          </button>
          <button className="secondary" onClick={() => setShowRevise(true)} disabled={deciding}>
            Revise
          </button>
          <button className="danger" onClick={() => decide("reject")} disabled={deciding}>
            {deciding ? "..." : "Reject"}
          </button>
        </div>
      )}
    </div>
  )
}
