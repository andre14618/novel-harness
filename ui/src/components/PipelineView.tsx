import { useEffect, useState, useCallback, useRef } from "react"
import { useParams, Link } from "react-router-dom"
import { getNovelState, getNovelConfig, resumeNovel } from "../api"
import type { NovelState, NovelConfig, SSEEvent } from "../api"
import { useNovelSSE } from "../hooks/useNovelSSE"
import { PhaseIndicator } from "./PhaseIndicator"
import { GatePanel } from "./GatePanel"
import { EventLog } from "./EventLog"

const STEP_DESCRIPTIONS: Record<string, { label: string; description: string; agents: string[] }> = {
  "concept": {
    label: "Concept Phase",
    description: "Building the foundation — world, characters, and story structure are generated in parallel, then presented for your review.",
    agents: ["world-builder", "character-agent", "plotter"],
  },
  "planning": {
    label: "Planning Phase",
    description: "Creating a chapter-by-chapter outline with scene breakdowns, character arcs, and pacing.",
    agents: ["planning-plotter"],
  },
  "drafting": {
    label: "Drafting Phase",
    description: "Writing each chapter sequentially. Each draft goes through continuity checking before you review.",
    agents: ["writer", "continuity"],
  },
  "validation": {
    label: "Validation Phase",
    description: "Cross-chapter consistency check and prose quality review. Issues trigger automatic rewrites.",
    agents: ["cross-chapter-continuity", "prose-quality", "rewriter"],
  },
}

const AGENT_LABELS: Record<string, string> = {
  "world-builder": "World Builder",
  "character-agent": "Character Agent",
  "plotter": "Plotter",
  "planning-plotter": "Planning Plotter",
  "writer": "Writer",
  "continuity": "Continuity Checker",
  "cross-chapter-continuity": "Cross-Chapter Continuity",
  "prose-quality": "Prose Quality",
  "rewriter": "Rewriter",
  "summary-extractor": "Summary Extractor",
  "fact-extractor": "Fact Extractor",
  "character-state": "Character State",
  "state-extraction": "State Extraction",
}

interface TimelineEntry {
  id: string
  type: "phase" | "agent-start" | "agent-complete" | "llm-call" | "gate" | "info" | "error"
  timestamp: string
  agent?: string
  phase?: string
  title: string
  detail?: string
  config?: { provider: string; model: string; temperature?: number }
  wordCount?: number
  issueCount?: number
  llm?: { provider: string; model: string; promptTokens: number; completionTokens: number; latencyMs: number; tokensPerSec: number; cost: number }
}

export function PipelineView() {
  const { novelId } = useParams<{ novelId: string }>()
  const [state, setState] = useState<NovelState | null>(null)
  const [config, setConfig] = useState<NovelConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const { events, connected, lastEvent } = useNovelSSE(novelId ?? null)
  const timelineEndRef = useRef<HTMLDivElement>(null)

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

  // Load config + initial state
  useEffect(() => {
    loadState()
    getNovelConfig().then(setConfig).catch(() => {})
  }, [loadState])

  // Build timeline from SSE events
  useEffect(() => {
    const entries: TimelineEntry[] = []

    for (const e of events) {
      const ts = e.timestamp
      if (e.type === "phase:changed") {
        const phase = e.data.phase as string
        const desc = STEP_DESCRIPTIONS[phase]
        entries.push({
          id: `phase-${phase}-${ts}`,
          type: "phase",
          timestamp: ts,
          phase,
          title: desc?.label ?? `Phase: ${phase}`,
          detail: desc?.description,
        })
      } else if (e.type === "progress" && e.data.step === "llm-call") {
        entries.push({
          id: `llm-${ts}-${e.data.agent}`,
          type: "llm-call",
          timestamp: ts,
          agent: e.data.agent as string,
          title: `${e.data.agent}`,
          llm: {
            provider: e.data.provider as string,
            model: e.data.model as string,
            promptTokens: e.data.promptTokens as number,
            completionTokens: e.data.completionTokens as number,
            latencyMs: e.data.latencyMs as number,
            tokensPerSec: e.data.tokensPerSec as number,
            cost: (e.data.cost as number) ?? 0,
          },
        })
      } else if (e.type === "progress") {
        const agent = e.data.step as string
        const status = e.data.status as string
        const agentConfig = config?.assignments[agent]

        if (status === "running" || status === "retrying" || status === "revising") {
          entries.push({
            id: `agent-start-${agent}-${e.data.chapter ?? ""}-${ts}`,
            type: "agent-start",
            timestamp: ts,
            agent,
            title: `${AGENT_LABELS[agent] ?? agent}${e.data.chapter ? ` — Chapter ${e.data.chapter}` : ""}`,
            detail: status === "retrying" ? "Regenerating from scratch..."
              : status === "revising" ? `Revising with ${e.data.notes ?? 0} notes...`
              : undefined,
            config: agentConfig ? {
              provider: agentConfig.provider,
              model: agentConfig.model,
              temperature: agentConfig.temperature,
            } : undefined,
          })
        } else if (status === "complete" || status === "approved") {
          entries.push({
            id: `agent-done-${agent}-${e.data.chapter ?? ""}-${ts}`,
            type: "agent-complete",
            timestamp: ts,
            agent,
            title: `${AGENT_LABELS[agent] ?? agent}${e.data.chapter ? ` — Chapter ${e.data.chapter}` : ""} complete`,
            wordCount: e.data.wordCount as number | undefined,
            issueCount: e.data.issueCount as number | undefined,
          })
        }
      } else if (e.type === "gate:waiting") {
        entries.push({
          id: `gate-${ts}`,
          type: "gate",
          timestamp: ts,
          title: `Waiting for review: ${e.data.title as string}`,
        })
      } else if (e.type === "gate:resolved") {
        entries.push({
          id: `gate-resolved-${ts}`,
          type: "info",
          timestamp: ts,
          title: `${e.data.action as string} — ${e.data.gateId as string}`,
        })
      } else if (e.type === "error") {
        entries.push({
          id: `error-${ts}`,
          type: "error",
          timestamp: ts,
          title: `Error: ${e.data.step}`,
          detail: e.data.error as string,
        })
      } else if (e.type === "done") {
        entries.push({
          id: `done-${ts}`,
          type: "info",
          timestamp: ts,
          title: "Novel complete",
        })
      }
    }

    setTimeline(entries)
  }, [events, config])

  // Reload state on relevant SSE events
  useEffect(() => {
    if (!lastEvent) return
    if (["phase:changed", "gate:waiting", "gate:resolved", "done"].includes(lastEvent.type)) {
      loadState()
    }
  }, [lastEvent, loadState])

  // Auto-scroll timeline
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [timeline.length])

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

  if (error) {
    return (
      <>
        <p style={{ color: "#e74c3c" }}>Error: {error}</p>
        <Link to={`/${window.location.search}`}>Back to novels</Link>
      </>
    )
  }

  if (!state) {
    return <p style={{ color: "#8b949e" }}>Loading...</p>
  }

  const stalled = !state.active && state.phase !== "done"

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <Link to={`/${window.location.search}`} style={{ fontSize: "0.85rem" }}>
          &larr; Back
        </Link>
        <h1 style={{ display: "inline", marginLeft: "1rem" }}>
          {novelId?.replace("novel-", "").slice(0, 13)}
        </h1>
        {state.active && <span className="badge active" style={{ marginLeft: "0.5rem" }}>running</span>}
        {state.phase === "done" && <span className="badge done" style={{ marginLeft: "0.5rem" }}>complete</span>}
        {stalled && <span className="badge idle" style={{ marginLeft: "0.5rem" }}>stopped</span>}
        <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#555" }}>
          <span className={`connected-dot ${connected ? "on" : "off"}`} />
        </span>
      </div>

      <PhaseIndicator currentPhase={state.phase} pendingGate={!!state.pendingGate} />

      {/* Stalled banner */}
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

      {state.activeError && (
        <div className="tl-entry tl-error">
          <div className="tl-dot error" />
          <div className="tl-body">
            <strong>Pipeline Error</strong>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", color: "#e74c3c" }}>{state.activeError}</pre>
          </div>
        </div>
      )}

      {/* Conversational timeline */}
      <div className="timeline">
        {timeline.length === 0 && state.active && (
          <div className="tl-entry tl-info">
            <div className="tl-dot active" />
            <div className="tl-body">
              <div className="tl-title">Starting pipeline...</div>
              <div className="spinner" style={{ marginTop: "0.5rem" }} />
            </div>
          </div>
        )}

        {timeline.map(entry => {
          const dotClass = entry.type === "phase" ? "phase"
            : entry.type === "agent-start" ? "active"
            : entry.type === "agent-complete" ? "done"
            : entry.type === "llm-call" ? "done"
            : entry.type === "error" ? "error"
            : entry.type === "gate" ? "gate"
            : "info"

          return (
            <div key={entry.id} className={`tl-entry tl-${entry.type}`}>
              <div className={`tl-dot ${dotClass}`}>
                {entry.type === "agent-start" && <div className="spinner-sm" />}
              </div>
              <div className="tl-body">
                <div className="tl-time">{formatTime(entry.timestamp)}</div>
                <div className="tl-title">{entry.title}</div>
                {entry.detail && <div className="tl-detail">{entry.detail}</div>}
                {entry.config && (
                  <div className="tl-config">
                    <span className="config-tag">{entry.config.provider}</span>
                    <span className="config-tag">{entry.config.model}</span>
                    {entry.config.temperature !== undefined && (
                      <span className="config-tag">temp {entry.config.temperature}</span>
                    )}
                  </div>
                )}
                {entry.llm && (
                  <div className="tl-config">
                    <span className="config-tag">{entry.llm.provider}</span>
                    <span className="config-tag">{entry.llm.model}</span>
                    <span className="config-tag">{entry.llm.promptTokens}+{entry.llm.completionTokens} tok</span>
                    <span className="config-tag">{(entry.llm.latencyMs / 1000).toFixed(1)}s</span>
                    <span className="config-tag">{entry.llm.tokensPerSec} t/s</span>
                    {entry.llm.cost > 0 && <span className="config-tag" style={{ color: "#4ecca3" }}>${entry.llm.cost.toFixed(4)}</span>}
                  </div>
                )}
                {entry.wordCount !== undefined && (
                  <div className="tl-detail">{entry.wordCount} words</div>
                )}
                {entry.issueCount !== undefined && entry.issueCount > 0 && (
                  <div className="tl-detail">{entry.issueCount} issues found</div>
                )}
              </div>
            </div>
          )
        })}

        {/* Pending gate inline */}
        {state.pendingGate && (
          <div className="tl-entry tl-gate">
            <div className="tl-dot gate" />
            <div className="tl-body" style={{ width: "100%" }}>
              <GatePanel
                novelId={novelId!}
                gateId={state.pendingGate.gateId}
                title={state.pendingGate.title}
                content={state.pendingGate.content}
                onDecided={loadState}
              />
            </div>
          </div>
        )}

        <div ref={timelineEndRef} />
      </div>

      {/* Running totals */}
      {(() => {
        const llmEntries = timeline.filter(e => e.llm)
        if (llmEntries.length === 0) return null
        const totalCost = llmEntries.reduce((sum, e) => sum + (e.llm?.cost ?? 0), 0)
        const totalTokens = llmEntries.reduce((sum, e) => sum + (e.llm?.promptTokens ?? 0) + (e.llm?.completionTokens ?? 0), 0)
        return (
          <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", color: "#8b949e", marginBottom: "1rem", padding: "0.5rem 0", borderTop: "1px solid #30363d" }}>
            <span><strong style={{ color: "#4ecca3" }}>${totalCost.toFixed(4)}</strong> total cost</span>
            <span>{totalTokens.toLocaleString()} total tokens</span>
            <span>{llmEntries.length} LLM calls</span>
          </div>
        )
      })()}

      <div style={{ marginTop: "1rem" }}>
        <EventLog events={events} connected={connected} />
      </div>
    </>
  )
}

function formatTime(ts: string): string {
  if (!ts) return ""
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString()
}
