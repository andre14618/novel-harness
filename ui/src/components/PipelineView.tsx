import { useEffect, useState, useCallback } from "react"
import { useParams, Link } from "react-router-dom"
import { getNovelState, resumeNovel } from "../api"
import type { NovelState } from "../api"
import { useNovelSSE } from "../hooks/useNovelSSE"
import { PhaseIndicator } from "./PhaseIndicator"
import { GatePanel } from "./GatePanel"
import { ActivityPanel } from "./ActivityPanel"
import { ContentViewer } from "./ContentViewer"
import { EventLog } from "./EventLog"

export function PipelineView() {
  const { novelId } = useParams<{ novelId: string }>()
  const [state, setState] = useState<NovelState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)
  const { events, connected, lastEvent } = useNovelSSE(novelId ?? null)

  const loadState = useCallback(async () => {
    if (!novelId) return
    try {
      const s = await getNovelState(novelId)
      setState(s)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    }
  }, [novelId])

  // Initial load
  useEffect(() => { loadState() }, [loadState])

  // Reload state on relevant SSE events
  useEffect(() => {
    if (!lastEvent) return
    if (["phase:changed", "gate:waiting", "gate:resolved", "done"].includes(lastEvent.type)) {
      loadState()
    }
  }, [lastEvent, loadState])

  async function handleResume() {
    if (!novelId) return
    setResuming(true)
    try {
      await resumeNovel(novelId)
      loadState()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setResuming(false)
    }
  }

  const key = new URLSearchParams(window.location.search).get("key") ?? ""

  if (error) {
    return (
      <div className="app">
        <p style={{ color: "#e74c3c" }}>Error: {error}</p>
        <Link to={`/${window.location.search}`}>Back to novels</Link>
      </div>
    )
  }

  if (!state) {
    return <div className="app"><p style={{ color: "#8b949e" }}>Loading...</p></div>
  }

  const stalled = !state.active && state.phase !== "done"

  return (
    <div className="app">
      <div className="top-bar">
        <div>
          <Link to={`/${window.location.search}`} style={{ fontSize: "0.85rem" }}>
            &larr; Back
          </Link>
          <h1 style={{ display: "inline", marginLeft: "1rem" }}>
            {novelId?.replace("novel-", "").slice(0, 13)}
          </h1>
          {state.active && <span className="badge active" style={{ marginLeft: "0.5rem" }}>running</span>}
          {state.phase === "done" && <span className="badge done" style={{ marginLeft: "0.5rem" }}>complete</span>}
          {stalled && <span className="badge idle" style={{ marginLeft: "0.5rem" }}>stopped</span>}
        </div>
        <nav>
          <a href={`/?key=${key}`}>Dashboard</a>
        </nav>
      </div>

      <PhaseIndicator
        currentPhase={state.phase}
        pendingGate={!!state.pendingGate}
      />

      {state.activeError && (
        <div className="card" style={{ borderColor: "#e74c3c" }}>
          <strong style={{ color: "#e74c3c" }}>Pipeline Error</strong>
          <pre style={{ fontSize: "0.8rem", color: "#e74c3c", marginTop: "0.5rem", whiteSpace: "pre-wrap" }}>
            {state.activeError}
          </pre>
        </div>
      )}

      {/* Stalled — pipeline died or was restarted */}
      {stalled && (
        <div className="card" style={{ borderColor: "#e2b714", textAlign: "center" }}>
          <p style={{ color: "#e2b714", marginBottom: "0.8rem" }}>
            Pipeline stopped at <strong>{state.phase}</strong> phase
            {state.totalChapters > 0 && ` (chapter ${state.currentChapter}/${state.totalChapters})`}.
          </p>
          <button onClick={handleResume} disabled={resuming}>
            {resuming ? "Resuming..." : "Resume Pipeline"}
          </button>
        </div>
      )}

      {/* Activity panel — shows real-time progress when pipeline is running */}
      <ActivityPanel events={events} active={state.active} pendingGate={!!state.pendingGate} />

      {state.pendingGate && (
        <GatePanel
          novelId={novelId!}
          gateId={state.pendingGate.gateId}
          title={state.pendingGate.title}
          content={state.pendingGate.content}
          onDecided={loadState}
        />
      )}

      <ContentViewer
        novelId={novelId!}
        phase={state.phase}
        totalChapters={state.totalChapters}
      />

      <div style={{ marginTop: "1.5rem" }}>
        <EventLog events={events} connected={connected} />
      </div>
    </div>
  )
}
