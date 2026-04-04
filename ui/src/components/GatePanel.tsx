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

  async function decide(action: "approve" | "revise" | "reject") {
    setDeciding(true)
    setError(null)
    try {
      const noteList = action === "revise" && notes.trim()
        ? notes.trim().split("\n").filter(Boolean)
        : undefined
      await decideGate(novelId, gateId, action, noteList)
      onDecided()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setDeciding(false)
    }
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
              Submit Revision
            </button>
            <button className="secondary" onClick={() => setShowRevise(false)} disabled={deciding}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="gate-actions">
          <button onClick={() => decide("approve")} disabled={deciding}>
            Approve
          </button>
          <button className="secondary" onClick={() => setShowRevise(true)} disabled={deciding}>
            Revise
          </button>
          <button className="danger" onClick={() => decide("reject")} disabled={deciding}>
            Reject
          </button>
        </div>
      )}
    </div>
  )
}
