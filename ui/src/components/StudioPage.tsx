import { useEffect, useState, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { getSeeds, listNovels, startNovel, startNovelCustom, type NovelListItem, type SSEEvent } from "../api"
import { useNovelSSE } from "../hooks/useNovelSSE"

interface LogEntry {
  id: string
  type: "system" | "agent" | "llm" | "gate" | "error" | "user"
  timestamp: string
  text: string
  detail?: string
  meta?: Record<string, any>
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function eventToEntries(event: SSEEvent): LogEntry[] {
  const ts = event.timestamp || new Date().toISOString()
  const id = `${ts}-${Math.random().toString(36).slice(2, 6)}`
  const d = event.data || {}

  switch (event.type) {
    case "phase:changed":
      return [{ id, type: "system", timestamp: ts, text: `Phase: ${d.phase}` }]

    case "progress": {
      const step = d.step as string || "unknown"
      const status = d.status as string || ""

      if (step === "llm-call" || d.provider) {
        const model = `${d.provider}/${d.model}`
        const tokens = `${d.promptTokens || 0}in/${d.completionTokens || 0}out`
        const latency = d.latencyMs ? `${Math.round(d.latencyMs as number)}ms` : ""
        const tps = d.tokensPerSec ? `${Math.round(d.tokensPerSec as number)}t/s` : ""
        const cost = d.cost ? `$${(d.cost as number).toFixed(4)}` : ""
        return [{ id, type: "llm", timestamp: ts, text: `${d.agent || step}`, detail: [model, tokens, latency, tps, cost].filter(Boolean).join(" | "), meta: d as any }]
      }

      if (status === "running" || status === "starting") {
        const chapter = d.chapter ? ` ch${d.chapter}` : ""
        const beat = d.beatIndex !== undefined ? ` beat${d.beatIndex}` : ""
        return [{ id, type: "agent", timestamp: ts, text: `${step}${chapter}${beat} started` }]
      }

      if (status === "complete") {
        const chapter = d.chapter ? ` ch${d.chapter}` : ""
        const words = d.wordCount ? ` ${d.wordCount}w` : ""
        const extra = d.chapters ? ` ${d.chapters} chapters planned` : ""
        return [{ id, type: "agent", timestamp: ts, text: `${step}${chapter} done${words}${extra}` }]
      }

      if (status === "retrying" || status === "revising") {
        const attempt = d.attempt ? ` (attempt ${d.attempt})` : ""
        return [{ id, type: "agent", timestamp: ts, text: `${step} ${status}${attempt}` }]
      }

      if (status === "warnings" || status === "issues") {
        const count = d.conflictCount || d.issueCount || 0
        return [{ id, type: "agent", timestamp: ts, text: `${step}: ${count} ${status}` }]
      }

      // Generic progress
      return [{ id, type: "agent", timestamp: ts, text: `${step}: ${status}`, detail: d.detail as string }]
    }

    case "gate:waiting":
      return [{ id, type: "gate", timestamp: ts, text: `Gate: ${d.title}`, detail: (d.content as string)?.slice(0, 200) }]

    case "gate:resolved":
      return [{ id, type: "system", timestamp: ts, text: `Gate resolved: ${d.action}` }]

    case "error":
      return [{ id, type: "error", timestamp: ts, text: `Error in ${d.step}${d.chapter ? ` ch${d.chapter}` : ""}`, detail: d.error as string }]

    case "done":
      return [{ id, type: "system", timestamp: ts, text: "Novel complete" }]

    default:
      return [{ id, type: "system", timestamp: ts, text: `${event.type}: ${JSON.stringify(d).slice(0, 120)}` }]
  }
}

export function StudioPage() {
  const navigate = useNavigate()
  const qs = window.location.search

  // State
  const [seeds, setSeeds] = useState<string[]>([])
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [activeNovelId, setActiveNovelId] = useState<string | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [inputMode, setInputMode] = useState<"seed" | "custom">("seed")
  const [selectedSeed, setSelectedSeed] = useState("")
  const [customPremise, setCustomPremise] = useState("")
  const [customGenre, setCustomGenre] = useState("literary fiction")
  const [starting, setStarting] = useState(false)

  const logEndRef = useRef<HTMLDivElement>(null)
  const { events, connected } = useNovelSSE(activeNovelId)

  // Load seeds and novels
  useEffect(() => {
    getSeeds().then(r => { setSeeds(r.seeds); if (r.seeds.length > 0) setSelectedSeed(r.seeds[0]) })
    listNovels().then(r => setNovels(r.novels))
  }, [])

  // Convert SSE events to log entries
  useEffect(() => {
    if (events.length === 0) return
    const latest = events[events.length - 1]
    const entries = eventToEntries(latest)
    setLog(prev => [...prev, ...entries])
  }, [events])

  // Auto-scroll
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [log])

  const addUserEntry = useCallback((text: string) => {
    setLog(prev => [...prev, { id: Date.now().toString(), type: "user", timestamp: new Date().toISOString(), text }])
  }, [])

  const handleStart = async () => {
    setStarting(true)
    setLog([])
    try {
      let result: { ok: boolean; novelId: string }
      if (inputMode === "seed") {
        addUserEntry(`Starting novel with seed: ${selectedSeed}`)
        result = await startNovel(selectedSeed, "auto")
      } else {
        addUserEntry(`Starting novel: "${customPremise.slice(0, 80)}..."`)
        result = await startNovelCustom({ premise: customPremise, genre: customGenre, characters: [] }, "auto")
      }
      setActiveNovelId(result.novelId)
      setLog(prev => [...prev, {
        id: "started",
        type: "system",
        timestamp: new Date().toISOString(),
        text: `Novel created: ${result.novelId}`,
      }])
      // Refresh novel list
      listNovels().then(r => setNovels(r.novels))
    } catch (err: any) {
      setLog(prev => [...prev, {
        id: "err",
        type: "error",
        timestamp: new Date().toISOString(),
        text: "Failed to start novel",
        detail: err.message,
      }])
    }
    setStarting(false)
  }

  const handleWatch = (novelId: string) => {
    setActiveNovelId(novelId)
    setLog([{
      id: "watch",
      type: "system",
      timestamp: new Date().toISOString(),
      text: `Watching: ${novelId}`,
    }])
  }

  return (
    <div className="studio-layout">
      {/* Left panel — controls */}
      <aside className="studio-controls">
        <h2 className="studio-heading">Studio</h2>

        {/* New novel */}
        <div className="studio-section">
          <h3>New Novel</h3>
          <div className="studio-mode-toggle">
            <button className={inputMode === "seed" ? "active" : ""} onClick={() => setInputMode("seed")}>Seed</button>
            <button className={inputMode === "custom" ? "active" : ""} onClick={() => setInputMode("custom")}>Custom</button>
          </div>

          {inputMode === "seed" ? (
            <select className="studio-select" value={selectedSeed} onChange={e => setSelectedSeed(e.target.value)}>
              {seeds.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <>
              <input
                className="studio-input"
                placeholder="Genre (e.g. dark fantasy)"
                value={customGenre}
                onChange={e => setCustomGenre(e.target.value)}
              />
              <textarea
                className="studio-textarea"
                placeholder="Premise — describe your story..."
                value={customPremise}
                onChange={e => setCustomPremise(e.target.value)}
                rows={4}
              />
            </>
          )}

          <button className="studio-start-btn" onClick={handleStart} disabled={starting || (inputMode === "custom" && !customPremise.trim())}>
            {starting ? "Starting..." : "Create Novel"}
          </button>
        </div>

        {/* Active novels */}
        <div className="studio-section">
          <h3>Novels</h3>
          <div className="studio-novel-list">
            {novels.map(n => (
              <button
                key={n.id}
                className={`studio-novel-item ${activeNovelId === n.id ? "active" : ""} ${n.active ? "running" : ""}`}
                onClick={() => handleWatch(n.id)}
              >
                <div className="studio-novel-info">
                  <span className="studio-novel-genre">{n.seed?.genre || "unknown"}</span>
                  <span className="studio-novel-premise">{n.seed?.premise?.slice(0, 50) || n.id}</span>
                </div>
                <div className="studio-novel-status">
                  <span className={`badge ${n.phase === "done" ? "done" : n.active ? "active" : "pending"}`}>{n.phase}</span>
                  <span className="studio-novel-progress">{n.currentChapter}/{n.totalChapters}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Right panel — terminal log */}
      <main className="studio-terminal">
        <div className="studio-terminal-header">
          <span className="studio-terminal-title">
            {activeNovelId ? activeNovelId : "No novel selected"}
          </span>
          <div className="studio-terminal-actions">
            {connected && <span className="studio-dot on" />}
            {activeNovelId && (
              <>
                <button className="studio-read-btn" onClick={() => navigate(`/${activeNovelId}${qs}`)}>
                  Pipeline
                </button>
                <button className="studio-read-btn" onClick={() => navigate(`/${activeNovelId}/read${qs}`)}>
                  Read
                </button>
              </>
            )}
          </div>
        </div>

        <div className="studio-terminal-body">
          {log.length === 0 ? (
            <div className="studio-terminal-empty">
              Select a novel to watch or create a new one
            </div>
          ) : (
            log.map(entry => (
              <div key={entry.id} className={`studio-log-entry ${entry.type}`}>
                <span className="studio-log-time">{formatTime(entry.timestamp)}</span>
                <span className={`studio-log-badge ${entry.type}`}>
                  {entry.type === "system" ? "SYS" : entry.type === "agent" ? "AGT" : entry.type === "llm" ? "LLM" : entry.type === "gate" ? "GATE" : entry.type === "error" ? "ERR" : ">"}
                </span>
                <span className="studio-log-text">{entry.text}</span>
                {entry.detail && <span className="studio-log-detail">{entry.detail}</span>}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </main>
    </div>
  )
}
