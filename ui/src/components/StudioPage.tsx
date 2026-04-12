import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { Link } from "react-router-dom"
import {
  getSeeds, listNovels, startNovel, startNovelCustom,
  getNovelState, getNovelConfig, getTrace, resumeNovel,
  type NovelListItem, type NovelState, type NovelConfig, type SSEEvent, type TraceEvent,
} from "../api"
import { useNovelSSE } from "../hooks/useNovelSSE"
import { GatePanel } from "./GatePanel"
import { PipelineFlow } from "./PipelineFlow"
import { LiveMeters } from "./LiveMeters"

// ── Agent display labels ────────────────────────────────────────────────
const AGENT_ACTION: Record<string, string> = {
  "world-builder":        "Building the world",
  "character-agent":      "Casting characters",
  "plotter":              "Sketching the plot",
  "planning-plotter":     "Planning the chapter",
  "writer":               "Writing the chapter",
  "beat-writer":          "Writing beat",
  "reference-resolver":   "Resolving references",
  "adherence-checker":    "Checking beat adherence",
  "chapter-plan-checker": "Verifying chapter plan",
  "continuity":           "Checking continuity",
  "rewriter":             "Rewriting",
  "tonal-pass":           "Applying tonal pass",
  "lint-fixer":           "Fixing lint",
  "summary-extractor":    "Extracting summary",
  "fact-extractor":       "Extracting facts",
  "character-state":      "Tracking character state",
  "relationship-timeline":"Updating relationships",
  "graph-linker":         "Linking causal graph",
}

function agentAction(agent: string): string {
  return AGENT_ACTION[agent] ?? agent
}

interface LLMCallRow {
  id: string
  agent: string
  chapter?: number
  beatIndex?: number
  model: string
  provider: string
  startTs: number
  endTs?: number
  promptTokens?: number
  completionTokens?: number
  cost?: number
  durationMs?: number
  meta?: Record<string, any>
  status: "running" | "done" | "fail"
  error?: string
  pass?: boolean
}

type NarrativeKind = "phase" | "chapter" | "fail" | "retry" | "validation" | "lint"
interface NarrativeEntry {
  kind: NarrativeKind
  ts: number
  text: string
  detail?: string
}

type FeedItem =
  | { type: "call"; ts: number; call: LLMCallRow }
  | { type: "narrative"; ts: number; entry: NarrativeEntry }

export function StudioPage() {
  const qs = window.location.search

  // ── Novel creation state ──────────────────────────────────────────────
  const [seeds, setSeeds] = useState<string[]>([])
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [activeNovelId, setActiveNovelId] = useState<string | null>(null)
  const [inputMode, setInputMode] = useState<"seed" | "custom">("seed")
  const [selectedSeed, setSelectedSeed] = useState("")
  const [customPremise, setCustomPremise] = useState("")
  const GENRES = [
    "litrpg", "epic-fantasy", "dark fantasy", "portal-fantasy", "cultivation-fantasy",
    "young adult fantasy", "science-fiction", "sci-fi thriller", "literary fiction",
    "literary thriller", "contemporary romance", "post-apocalyptic",
  ]
  const [customGenre, setCustomGenre] = useState("litrpg")
  const [starting, setStarting] = useState(false)

  // ── Pipeline view state ───────────────────────────────────────────────
  const [state, setState] = useState<NovelState | null>(null)
  const [_config, setConfig] = useState<NovelConfig | null>(null)
  const [resuming, setResuming] = useState(false)

  const { events, connected, lastEvent, seedEvents } = useNovelSSE(activeNovelId)

  const [liveCalls, setLiveCalls] = useState<LLMCallRow[]>([])
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [currentChapter, setCurrentChapter] = useState<number | null>(null)
  const [currentBeat, setCurrentBeat] = useState<number | null>(null)
  const [currentTotalBeats, setCurrentTotalBeats] = useState<number | null>(null)
  const [currentChapterTitle, setCurrentChapterTitle] = useState<string | null>(null)
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set())
  const [completedAgents, setCompletedAgents] = useState<Set<string>>(new Set())
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const activityEndRef = useRef<HTMLDivElement>(null)

  // ── Load seeds and novels on mount ────────────────────────────────────
  useEffect(() => {
    getSeeds().then(r => { setSeeds(r.seeds); if (r.seeds.length > 0) setSelectedSeed(r.seeds[0]) })
    listNovels().then(r => {
      setNovels(r.novels)
      // Auto-select first running novel, or most recent
      const running = r.novels.find(n => n.active)
      if (running) setActiveNovelId(running.id)
      else if (r.novels.length > 0) setActiveNovelId(r.novels[0].id)
    })
  }, [])

  // ── Load novel state when active novel changes ────────────────────────
  const loadState = useCallback(async () => {
    if (!activeNovelId) { setState(null); return }
    try {
      const s = await getNovelState(activeNovelId)
      setState(s)
    } catch { setState(null) }
  }, [activeNovelId])

  useEffect(() => {
    loadState()
    getNovelConfig().then(setConfig).catch(() => {})
  }, [loadState])

  // ── Hydrate historical trace events on novel change ───────────────────
  const lastHydratedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeNovelId || lastHydratedRef.current === activeNovelId) return
    lastHydratedRef.current = activeNovelId

    // Reset pipeline state
    setLiveCalls([])
    setFeedItems([])
    setCurrentChapter(null)
    setCurrentBeat(null)
    setCurrentTotalBeats(null)
    setCurrentChapterTitle(null)
    setActiveAgents(new Set())
    setCompletedAgents(new Set())
    setRunStartedAt(null)

    function traceToSSE(t: TraceEvent): SSEEvent {
      return {
        type: "trace",
        data: {
          eventType: t.event_type,
          agent: t.agent,
          chapter: t.chapter,
          beatIndex: t.beat_index,
          durationMs: t.duration_ms,
          ...(t.payload ?? {}),
        },
        timestamp: t.timestamp,
      }
    }

    getTrace(activeNovelId, { limit: 2000 })
      .then(rows => {
        if (rows.length > 0) seedEvents(rows.map(traceToSSE))
      })
      .catch(() => {})
  }, [activeNovelId, seedEvents])

  // ── Reload state on SSE events ────────────────────────────────────────
  useEffect(() => {
    if (!lastEvent || !activeNovelId) return
    if (["phase:changed", "gate:waiting", "gate:resolved", "done"].includes(lastEvent.type)) {
      loadState()
      listNovels().then(r => setNovels(r.novels)).catch(() => {})
    }
  }, [lastEvent, loadState, activeNovelId])

  // ── Process events into feed items ────────────────────────────────────
  useEffect(() => {
    const calls = new Map<string, LLMCallRow>()
    const narratives: NarrativeEntry[] = []
    const active = new Set<string>()
    const completed = new Set<string>()
    let chapter: number | null = null
    let beatIdx: number | null = null
    let totalBeats: number | null = null
    let chapterTitle: string | null = null
    let earliestTs: number | null = null
    const beatAttempts = new Map<string, number>()

    const keyFor = (agent: string, ch?: number, bi?: number, startTs?: number) =>
      `${agent}:${ch ?? "_"}:${bi ?? "_"}:${startTs ?? ""}`

    for (const e of events) {
      const tsMs = e.timestamp ? new Date(e.timestamp).getTime() : Date.now()
      if (earliestTs === null || tsMs < earliestTs) earliestTs = tsMs

      if (e.type === "trace") {
        const d = e.data as any
        const et = d.eventType as string

        if (et === "llm-call-start") {
          const agent = d.agent as string
          const key = keyFor(agent, d.chapter, d.beatIndex, tsMs)
          calls.set(key, {
            id: key, agent, chapter: d.chapter, beatIndex: d.beatIndex,
            model: d.model, provider: d.provider, startTs: tsMs, meta: d, status: "running",
          })
          active.add(agent)

          if (agent === "beat-writer" && d.chapter != null && d.beatIndex != null) {
            const bkey = `${d.chapter}-${d.beatIndex}`
            const attempt = (beatAttempts.get(bkey) ?? 0) + 1
            beatAttempts.set(bkey, attempt)
            if (attempt > 1) {
              narratives.push({ kind: "retry", ts: tsMs, text: `Retrying beat ${d.beatIndex + 1} (attempt ${attempt})`, detail: `Chapter ${d.chapter}` })
            }
            chapter = d.chapter
            beatIdx = d.beatIndex
            if (d.totalBeats != null) totalBeats = d.totalBeats
            if (d.chapterTitle) chapterTitle = d.chapterTitle
          }
        } else if (et === "agent-complete") {
          const agent = d.agent as string
          let matched = false
          for (const [k, v] of calls) {
            if (v.agent === agent && v.status === "running" && v.chapter === d.chapter && v.beatIndex === d.beatIndex) {
              calls.set(k, { ...v, status: "done", endTs: tsMs, promptTokens: d.promptTokens, completionTokens: d.completionTokens, cost: d.cost, durationMs: d.durationMs, pass: d.pass })
              matched = true
              break
            }
          }
          if (!matched) {
            const key = keyFor(agent, d.chapter, d.beatIndex, tsMs)
            calls.set(key, { id: key, agent, chapter: d.chapter, beatIndex: d.beatIndex, model: "", provider: "", startTs: tsMs, endTs: tsMs, promptTokens: d.promptTokens, completionTokens: d.completionTokens, cost: d.cost, durationMs: d.durationMs, status: "done", pass: d.pass })
          }
          active.delete(agent)
          completed.add(agent)
        } else if (et === "agent-fail") {
          const agent = d.agent as string
          for (const [k, v] of calls) {
            if (v.agent === agent && v.status === "running" && v.chapter === d.chapter && v.beatIndex === d.beatIndex) {
              calls.set(k, { ...v, status: "fail", endTs: tsMs, error: d.error })
              break
            }
          }
          active.delete(agent)
          const label = AGENT_ACTION[agent] ?? agent
          const loc = d.chapter != null ? (d.beatIndex != null ? `Ch ${d.chapter}, beat ${d.beatIndex + 1}` : `Ch ${d.chapter}`) : undefined
          const errSnippet = d.error ? String(d.error).split("\n")[0].slice(0, 120) : undefined
          narratives.push({ kind: "fail", ts: tsMs, text: `${label} failed${loc ? ` — ${loc}` : ""}`, detail: errSnippet })
        } else if (et === "agent-start") {
          active.add(d.agent as string)
        } else if (et === "phase-change" || et === "phase-complete") {
          completed.clear()
          const phase = d.to ?? d.phase
          if (phase) {
            const labels: Record<string, string> = {
              concept: "Concept complete — world, characters, and plot ready",
              planning: "Planning complete — chapter outlines ready",
              drafting: "Drafting complete — all chapters written",
              validation: "Validation complete — prose approved",
              done: "Novel complete",
            }
            narratives.push({ kind: "phase", ts: tsMs, text: labels[phase] ?? `Entered ${phase} phase` })
          }
        } else if (et === "chapter-complete") {
          const att = d.attempts ?? d.attempt
          narratives.push({ kind: "chapter", ts: tsMs, text: `Chapter ${d.chapter} approved${att > 1 ? ` after ${att} attempts` : ""}` })
        } else if (et === "validation-check") {
          const blockers: string[] = d.blockers ?? []
          const warnings: string[] = d.warnings ?? []
          if (!d.passed && blockers.length > 0) {
            narratives.push({ kind: "validation", ts: tsMs, text: `Validation failed — Ch ${d.chapter ?? "?"}`, detail: blockers.join("; ") })
          } else if (warnings.length > 0) {
            narratives.push({ kind: "validation", ts: tsMs, text: `Validation passed with warnings — Ch ${d.chapter ?? "?"}`, detail: warnings.join("; ") })
          }
        } else if (et === "lint-detect") {
          const total = d.totalIssues ?? 0
          if (total > 0) {
            const cats = d.counts
              ? Object.entries(d.counts as Record<string, number>).map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")} (${v})`).join(", ")
              : `${total} issues`
            narratives.push({ kind: "lint", ts: tsMs, text: `Lint: ${cats}`, detail: d.chapter != null ? `Chapter ${d.chapter}` : undefined })
          }
        } else if (et === "adherence-deterministic") {
          const issues = d.deterministicIssues ?? 0
          if (issues > 0) {
            const parts: string[] = []
            if (!d.charPresence) parts.push("missing characters")
            if (!d.dialogueOk) parts.push("no dialogue")
            if (!d.wordCountOk) parts.push("word count")
            narratives.push({ kind: "fail", ts: tsMs, text: `Adherence check failed — beat ${(d.beatIndex ?? 0) + 1}`, detail: parts.join(", ") || `${issues} issue${issues > 1 ? "s" : ""}` })
          }
        }
      } else if (e.type === "progress") {
        const d = e.data as any
        if (d.chapter != null) chapter = d.chapter
      }
    }

    const callList = [...calls.values()].sort((a, b) => a.startTs - b.startTs)
    const feed: FeedItem[] = [
      ...callList.map(c => ({ type: "call" as const, ts: c.startTs, call: c })),
      ...narratives.map(n => ({ type: "narrative" as const, ts: n.ts, entry: n })),
    ].sort((a, b) => a.ts - b.ts)

    setLiveCalls(callList)
    setFeedItems(feed)
    setCurrentChapter(chapter)
    setCurrentBeat(beatIdx)
    setCurrentTotalBeats(totalBeats)
    setCurrentChapterTitle(chapterTitle)
    setActiveAgents(active)
    setCompletedAgents(completed)
    setRunStartedAt(earliestTs)
  }, [events])

  // Auto-scroll
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [liveCalls.length])

  // Meters
  const totals = useMemo(() => {
    const done = liveCalls.filter(c => c.status === "done")
    const totalCost = done.reduce((s, c) => s + (c.cost ?? 0), 0)
    const totalTokens = done.reduce((s, c) => s + (c.promptTokens ?? 0) + (c.completionTokens ?? 0), 0)
    const recent = done.slice(-5)
    const tps = recent.length > 0
      ? Math.round(recent.reduce((s, c) => {
          const ms = c.durationMs ?? 1
          return s + (c.completionTokens ?? 0) / (ms / 1000)
        }, 0) / recent.length)
      : 0
    return { totalCost, totalTokens, tps, count: done.length }
  }, [liveCalls])

  // ── Actions ───────────────────────────────────────────────────────────
  const handleStart = async () => {
    setStarting(true)
    try {
      let result: { ok: boolean; novelId: string }
      if (inputMode === "seed") {
        result = await startNovel(selectedSeed, "auto")
      } else {
        result = await startNovelCustom({ premise: customPremise, genre: customGenre, characters: [] }, "auto")
      }
      setActiveNovelId(result.novelId)
      listNovels().then(r => setNovels(r.novels))
    } catch {}
    setStarting(false)
  }

  async function handleResume() {
    if (!activeNovelId) return
    setResuming(true)
    try { await resumeNovel(activeNovelId); loadState() }
    catch {}
    finally { setResuming(false) }
  }

  const isDone = state?.phase === "done"
  const stalled = state && !state.active && !isDone

  return (
    <div className="studio-v2">
      {/* ── Compact creation bar ─────────────────────────────────────── */}
      <div className="studio-create-bar">
        <div className="studio-create-left">
          <div className="studio-mode-toggle">
            <button className={inputMode === "seed" ? "active" : ""} onClick={() => setInputMode("seed")}>Seed</button>
            <button className={inputMode === "custom" ? "active" : ""} onClick={() => setInputMode("custom")}>Custom</button>
          </div>
          {inputMode === "seed" ? (
            <select className="studio-select-compact" value={selectedSeed} onChange={e => setSelectedSeed(e.target.value)}>
              {seeds.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <>
              <select className="studio-select-compact" value={customGenre} onChange={e => setCustomGenre(e.target.value)}>
                {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <input className="studio-input-compact studio-input-wide" placeholder="Premise…" value={customPremise} onChange={e => setCustomPremise(e.target.value)} />
            </>
          )}
          <button className="studio-create-btn" onClick={handleStart} disabled={starting || (inputMode === "custom" && !customPremise.trim())}>
            {starting ? "Starting…" : "Create"}
          </button>
        </div>
        <div className="studio-create-right">
          {activeNovelId && (
            <Link to={`/${activeNovelId}/read${qs}`} className="studio-read-link">Read</Link>
          )}
          <span className={`connected-dot ${connected ? "on" : "off"}`} />
        </div>
      </div>

      {/* ── Novel selector ───────────────────────────────────────────── */}
      <div className="studio-novel-strip">
        {novels.map(n => (
          <button
            key={n.id}
            className={`studio-novel-tab ${activeNovelId === n.id ? "active" : ""}`}
            onClick={() => setActiveNovelId(n.id)}
          >
            <span className="studio-tab-genre">{n.seed?.genre || "?"}</span>
            <span className={`studio-tab-badge ${n.phase === "done" ? "done" : n.active ? "running" : "idle"}`}>
              {n.phase === "done" ? "done" : n.active ? `ch ${n.currentChapter}/${n.totalChapters}` : n.phase}
            </span>
          </button>
        ))}
      </div>

      {/* ── Pipeline view ────────────────────────────────────────────── */}
      {state && (
        <>
          <PipelineFlow
            currentPhase={state.phase}
            activeAgents={activeAgents}
            completedAgents={completedAgents}
          />

          <LiveMeters
            totalCost={totals.totalCost}
            totalTokens={totals.totalTokens}
            tokensPerSec={totals.tps}
            llmCalls={totals.count}
            chapter={currentChapter ?? (state.currentChapter || null)}
            totalChapters={state.totalChapters}
            beat={currentBeat}
            totalBeats={currentTotalBeats}
            startedAt={runStartedAt}
            done={isDone}
          />

          {stalled && (
            <div className="card" style={{ borderColor: "#e2b714", textAlign: "center", marginTop: 10 }}>
              <p style={{ color: "#e2b714", marginBottom: "0.8rem" }}>
                Pipeline stopped at <strong>{state.phase}</strong> phase
                {state.totalChapters > 0 && ` (chapter ${state.currentChapter}/${state.totalChapters})`}.
              </p>
              <button onClick={handleResume} disabled={resuming}>
                {resuming ? "Resuming…" : "Resume Pipeline"}
              </button>
            </div>
          )}

          {state.activeError && (
            <div className="tl-entry tl-error" style={{ marginTop: 10 }}>
              <div className="tl-dot error" />
              <div className="tl-body">
                <strong>Pipeline Error</strong>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", color: "#e74c3c" }}>{state.activeError}</pre>
              </div>
            </div>
          )}

          <div className="live-activity" style={{ marginTop: 14 }}>
            <div className="live-activity-header">Activity</div>
            <div className="live-activity-body">
              {feedItems.length === 0 && (
                <div className="live-activity-placeholder">
                  {state.active ? "Waiting for the first LLM call…" : "No events yet."}
                </div>
              )}
              {feedItems.map((item, i) =>
                item.type === "call"
                  ? <ActivityRow key={item.call.id} call={item.call} />
                  : <NarrativeRow key={`n-${i}`} entry={item.entry} />
              )}
              <div ref={activityEndRef} />
            </div>

            {state.pendingGate && (
              <div className="tl-entry tl-gate" style={{ marginTop: "1rem" }}>
                <div className="tl-dot gate" />
                <div className="tl-body" style={{ width: "100%" }}>
                  <GatePanel
                    novelId={activeNovelId!}
                    gateId={state.pendingGate.gateId}
                    title={state.pendingGate.title}
                    content={state.pendingGate.content}
                    onDecided={loadState}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {!state && activeNovelId && <p style={{ color: "var(--text-tertiary)", marginTop: 20 }}>Loading…</p>}
      {!activeNovelId && <p style={{ color: "var(--text-tertiary)", marginTop: 40, textAlign: "center" }}>Select a novel or create one above.</p>}
    </div>
  )
}

// ── Activity row ──────────────────────────────────────────────────────
function ActivityRow({ call }: { call: LLMCallRow }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (call.status !== "running") return
    const id = setInterval(() => setTick(t => t + 1), 250)
    return () => clearInterval(id)
  }, [call.status])

  const elapsedMs = (call.endTs ?? Date.now()) - call.startTs
  const running = call.status === "running"
  const failed = call.status === "fail"

  let title = agentAction(call.agent)
  if (call.agent === "beat-writer" && call.beatIndex != null) {
    title = `${title} ${call.beatIndex + 1}${call.meta?.totalBeats ? `/${call.meta.totalBeats}` : ""}`
  }

  const subtitle: string[] = []
  if (call.chapter != null && call.agent !== "beat-writer") subtitle.push(`Chapter ${call.chapter}`)
  if (call.meta?.beatDescription && call.agent === "beat-writer") subtitle.push(call.meta.beatDescription)

  return (
    <div className={`activity-row${running ? " running" : ""}${failed ? " failed" : ""}`}>
      <div className="activity-dot">{running && <div className="spinner-sm" />}</div>
      <div className="activity-body">
        <div className="activity-title">
          <span className="activity-title-text">{title}</span>
          <span className="activity-chip activity-chip-model">{call.provider && `${call.provider}`}</span>
        </div>
        {subtitle.length > 0 && <div className="activity-subtitle">{subtitle.join(" · ")}</div>}
        <div className="activity-metrics">
          {running ? (
            <>
              <span className="activity-chip">{(elapsedMs / 1000).toFixed(1)}s</span>
              <span className="activity-chip activity-chip-live">streaming…</span>
            </>
          ) : failed ? (
            <span className="activity-chip activity-chip-fail">failed</span>
          ) : (
            <>
              {call.promptTokens != null && <span className="activity-chip">{call.promptTokens}+{call.completionTokens} tok</span>}
              {call.durationMs != null && <span className="activity-chip">{(call.durationMs / 1000).toFixed(1)}s</span>}
              {call.cost != null && call.cost > 0 && <span className="activity-chip activity-chip-cost">${call.cost.toFixed(4)}</span>}
              {call.pass != null && <span className={`activity-chip ${call.pass ? "activity-chip-pass" : "activity-chip-fail"}`}>{call.pass ? "pass" : "fail"}</span>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Narrative row ─────────────────────────────────────────────────────
const NARRATIVE_ICONS: Record<NarrativeKind, string> = {
  phase: "→", chapter: "✓", fail: "✗", retry: "↻", validation: "⚠", lint: "◆",
}

function NarrativeRow({ entry }: { entry: NarrativeEntry }) {
  const isFail = entry.kind === "fail"
  const isChapter = entry.kind === "chapter" || entry.kind === "phase"
  return (
    <div className={`narrative-row${isFail ? " narrative-fail" : ""}${isChapter ? " narrative-milestone" : ""}`}>
      <div className="narrative-icon">{NARRATIVE_ICONS[entry.kind]}</div>
      <div className="narrative-body">
        <div className="narrative-text">{entry.text}</div>
        {entry.detail && <div className="narrative-detail">{entry.detail}</div>}
      </div>
    </div>
  )
}
