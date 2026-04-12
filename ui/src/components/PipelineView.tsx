import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useParams, Link } from "react-router-dom"
import { getNovelState, getNovelConfig, resumeNovel, getTrace, getAllChapters } from "../api"
import type { NovelState, NovelConfig, SSEEvent, TraceEvent } from "../api"
import { useNovelSSE } from "../hooks/useNovelSSE"
import { GatePanel } from "./GatePanel"
import { TraceTimeline } from "./TraceTimeline"
import { PipelineFlow } from "./PipelineFlow"
import { LiveMeters } from "./LiveMeters"

// ── Agent display labels ────────────────────────────────────────────────
// Drives the human-readable text shown in the activity feed when an LLM call
// lands. Short verb-first phrasing reads like a status line, not a log entry.
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

export function PipelineView() {
  const { novelId } = useParams<{ novelId: string }>()
  const [state, setState] = useState<NovelState | null>(null)
  const [config, setConfig] = useState<NovelConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)
  const [viewMode, setViewMode] = useState<"live" | "trace">("live")

  // Per-beat streamed text — updated via ref to avoid re-rendering on every
  // token; a requestAnimationFrame flush mirrors it into React state.
  const beatTextRef = useRef<Map<string, string>>(new Map())
  const [beatTextTick, setBeatTextTick] = useState(0)
  const flushScheduledRef = useRef(false)

  const handleStream = useCallback((event: { data: any }) => {
    const d = event.data
    if (d?.agent !== "beat-writer" || d.chapter == null || d.beatIndex == null) return
    const key = `${d.chapter}-${d.beatIndex}`
    const prev = beatTextRef.current.get(key) ?? ""
    beatTextRef.current.set(key, prev + (d.delta ?? ""))
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true
      requestAnimationFrame(() => {
        flushScheduledRef.current = false
        setBeatTextTick(t => t + 1)
      })
    }
  }, [])

  const { events, connected, lastEvent, seedEvents } = useNovelSSE(novelId ?? null, handleStream)

  // Live stream state — built from SSE events on every render
  const [liveCalls, setLiveCalls] = useState<LLMCallRow[]>([])
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [liveBeats, setLiveBeats] = useState<LiveBeat[]>([])
  const [currentChapter, setCurrentChapter] = useState<number | null>(null)
  const [currentBeat, setCurrentBeat] = useState<number | null>(null)
  const [currentTotalBeats, setCurrentTotalBeats] = useState<number | null>(null)
  const [currentChapterTitle, setCurrentChapterTitle] = useState<string | null>(null)
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set())
  const [completedAgents, setCompletedAgents] = useState<Set<string>>(new Set())
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const activityEndRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    loadState()
    getNovelConfig().then(setConfig).catch(() => {})
  }, [loadState])

  // Hydrate historical trace events + chapter prose on mount so the view
  // shows the full pipeline state even when opened after beats are written.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!novelId || hydratedRef.current) return
    hydratedRef.current = true

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

    getTrace(novelId, { limit: 2000 })
      .then(rows => {
        if (rows.length > 0) seedEvents(rows.map(traceToSSE))
      })
      .catch(() => {})

    getAllChapters(novelId)
      .then(chapters => {
        if (chapters.length === 0) return
        for (const ch of chapters) {
          if (!ch.prose) continue
          // We don't have per-beat prose boundaries in the chapter data, so
          // store the full chapter text as beat 0 — the live view will show it
          // as a single block for completed chapters.
          beatTextRef.current.set(`${ch.chapter}-0`, ch.prose)
        }
        setBeatTextTick(t => t + 1)
      })
      .catch(() => {})
  }, [novelId, seedEvents])

  // Ingest SSE events and derive the live view state. We rebuild everything
  // from the events array on each update so the logic stays declarative.
  useEffect(() => {
    const calls = new Map<string, LLMCallRow>()
    const narratives: NarrativeEntry[] = []
    const beats: LiveBeat[] = []
    const beatByKey = new Map<string, number>()
    const active = new Set<string>()
    const completed = new Set<string>()
    let chapter: number | null = null
    let beatIdx: number | null = null
    let totalBeats: number | null = null
    let chapterTitle: string | null = null
    let earliestTs: number | null = null

    // Track beat-writer attempts per beat to detect retries
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
          const startTs = tsMs
          const key = keyFor(agent, d.chapter, d.beatIndex, startTs)
          calls.set(key, {
            id: key,
            agent,
            chapter: d.chapter,
            beatIndex: d.beatIndex,
            model: d.model,
            provider: d.provider,
            startTs,
            meta: d,
            status: "running",
          })
          active.add(agent)

          if (agent === "beat-writer" && d.chapter != null && d.beatIndex != null) {
            const bkey = `${d.chapter}-${d.beatIndex}`
            const attempt = (beatAttempts.get(bkey) ?? 0) + 1
            beatAttempts.set(bkey, attempt)
            if (attempt > 1) {
              narratives.push({
                kind: "retry",
                ts: tsMs,
                text: `Retrying beat ${d.beatIndex + 1} (attempt ${attempt})`,
                detail: `Chapter ${d.chapter}`,
              })
            }
            if (!beatByKey.has(bkey)) {
              beatByKey.set(bkey, beats.length)
              beats.push({
                chapter: d.chapter,
                beatIndex: d.beatIndex,
                description: d.beatDescription,
                characters: d.beatCharacters,
                text: "",
                done: false,
              })
            }
            chapter = d.chapter
            beatIdx = d.beatIndex
            if (d.totalBeats != null) totalBeats = d.totalBeats
            if (d.chapterTitle) chapterTitle = d.chapterTitle
          }
        } else if (et === "agent-complete") {
          const agent = d.agent as string
          let matched: LLMCallRow | undefined
          for (const [k, v] of calls) {
            if (v.agent === agent && v.status === "running"
                && v.chapter === d.chapter && v.beatIndex === d.beatIndex) {
              matched = v
              calls.set(k, {
                ...v,
                status: "done",
                endTs: tsMs,
                promptTokens: d.promptTokens,
                completionTokens: d.completionTokens,
                cost: d.cost,
                durationMs: d.durationMs,
                pass: d.pass,
              })
              break
            }
          }
          if (!matched) {
            const key = keyFor(agent, d.chapter, d.beatIndex, tsMs)
            calls.set(key, {
              id: key,
              agent,
              chapter: d.chapter,
              beatIndex: d.beatIndex,
              model: "",
              provider: "",
              startTs: tsMs,
              endTs: tsMs,
              promptTokens: d.promptTokens,
              completionTokens: d.completionTokens,
              cost: d.cost,
              durationMs: d.durationMs,
              status: "done",
              pass: d.pass,
            })
          }
          active.delete(agent)
          completed.add(agent)

          if (agent === "beat-writer" && d.chapter != null && d.beatIndex != null) {
            const bkey = `${d.chapter}-${d.beatIndex}`
            const idx = beatByKey.get(bkey)
            if (idx != null) {
              beats[idx] = { ...beats[idx], done: true }
            }
          }
        } else if (et === "agent-fail") {
          const agent = d.agent as string
          for (const [k, v] of calls) {
            if (v.agent === agent && v.status === "running"
                && v.chapter === d.chapter && v.beatIndex === d.beatIndex) {
              calls.set(k, { ...v, status: "fail", endTs: tsMs, error: d.error })
              break
            }
          }
          active.delete(agent)
          const label = AGENT_ACTION[agent] ?? agent
          const loc = d.chapter != null
            ? d.beatIndex != null ? `Ch ${d.chapter}, beat ${d.beatIndex + 1}` : `Ch ${d.chapter}`
            : undefined
          const errSnippet = d.error
            ? String(d.error).split("\n")[0].slice(0, 120)
            : undefined
          narratives.push({
            kind: "fail",
            ts: tsMs,
            text: `${label} failed${loc ? ` — ${loc}` : ""}`,
            detail: errSnippet,
          })
        } else if (et === "agent-start") {
          active.add(d.agent as string)
        } else if (et === "phase-change" || et === "phase-complete") {
          completed.clear()
          const phase = d.to ?? d.phase
          if (phase) {
            const PHASE_LABELS: Record<string, string> = {
              concept: "Concept phase complete — world, characters, and plot ready",
              planning: "Planning complete — chapter outlines ready",
              drafting: "Drafting complete — all chapters written",
              validation: "Validation complete — prose approved",
              done: "Novel complete",
            }
            narratives.push({
              kind: "phase",
              ts: tsMs,
              text: PHASE_LABELS[phase] ?? `Entered ${phase} phase`,
            })
          }
        } else if (et === "chapter-complete") {
          const att = d.attempts ?? d.attempt
          narratives.push({
            kind: "chapter",
            ts: tsMs,
            text: `Chapter ${d.chapter} approved${att > 1 ? ` after ${att} attempts` : ""}`,
          })
        } else if (et === "validation-check") {
          const passed = d.passed
          const blockers: string[] = d.blockers ?? []
          const warnings: string[] = d.warnings ?? []
          if (!passed && blockers.length > 0) {
            narratives.push({
              kind: "validation",
              ts: tsMs,
              text: `Validation failed — Ch ${d.chapter ?? "?"}`,
              detail: blockers.join("; "),
            })
          } else if (warnings.length > 0) {
            narratives.push({
              kind: "validation",
              ts: tsMs,
              text: `Validation passed with warnings — Ch ${d.chapter ?? "?"}`,
              detail: warnings.join("; "),
            })
          }
        } else if (et === "lint-detect") {
          const total = d.totalIssues ?? 0
          if (total > 0) {
            const cats = d.counts
              ? Object.entries(d.counts as Record<string, number>)
                  .map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")} (${v})`)
                  .join(", ")
              : `${total} issues`
            narratives.push({
              kind: "lint",
              ts: tsMs,
              text: `Lint: ${cats}`,
              detail: d.chapter != null ? `Chapter ${d.chapter}` : undefined,
            })
          }
        } else if (et === "adherence-deterministic") {
          const issues = d.deterministicIssues ?? 0
          if (issues > 0) {
            const parts: string[] = []
            if (!d.charPresence) parts.push("missing characters")
            if (!d.dialogueOk) parts.push("no dialogue")
            if (!d.wordCountOk) parts.push("word count")
            narratives.push({
              kind: "fail",
              ts: tsMs,
              text: `Adherence check failed — beat ${(d.beatIndex ?? 0) + 1}`,
              detail: parts.join(", ") || `${issues} issue${issues > 1 ? "s" : ""}`,
            })
          }
        }
      } else if (e.type === "progress") {
        const d = e.data as any
        if (d.chapter != null) chapter = d.chapter
      }
    }

    // Sort calls by start time
    const callList = [...calls.values()].sort((a, b) => a.startTs - b.startTs)

    // Merge calls and narratives into a unified feed sorted by timestamp
    const feed: FeedItem[] = [
      ...callList.map(c => ({ type: "call" as const, ts: c.startTs, call: c })),
      ...narratives.map(n => ({ type: "narrative" as const, ts: n.ts, entry: n })),
    ].sort((a, b) => a.ts - b.ts)

    setLiveCalls(callList)
    setFeedItems(feed)
    setLiveBeats(beats)
    setCurrentChapter(chapter)
    setCurrentBeat(beatIdx)
    setCurrentTotalBeats(totalBeats)
    setCurrentChapterTitle(chapterTitle)
    setActiveAgents(active)
    setCompletedAgents(completed)
    setRunStartedAt(earliestTs)
  }, [events])

  // Auto-scroll activity feed
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [liveCalls.length])

  // Reload state on relevant SSE events
  useEffect(() => {
    if (!lastEvent) return
    if (["phase:changed", "gate:waiting", "gate:resolved", "done"].includes(lastEvent.type)) {
      loadState()
    }
  }, [lastEvent, loadState])

  // Merge streamed text from the ref into the beat list for rendering.
  // Recomputed on beatTextTick so the UI updates smoothly as tokens arrive.
  const beatsForRender = useMemo(
    () =>
      liveBeats.map(b => ({
        ...b,
        text: beatTextRef.current.get(`${b.chapter}-${b.beatIndex}`) ?? b.text,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveBeats, beatTextTick],
  )

  // Aggregate meters
  const totals = useMemo(() => {
    const done = liveCalls.filter(c => c.status === "done")
    const totalCost = done.reduce((s, c) => s + (c.cost ?? 0), 0)
    const totalTokens = done.reduce((s, c) => s + (c.promptTokens ?? 0) + (c.completionTokens ?? 0), 0)
    // Rolling tokens/sec: average of the last 5 completed calls
    const recent = done.slice(-5)
    const tps = recent.length > 0
      ? Math.round(recent.reduce((s, c) => {
          const ms = c.durationMs ?? 1
          return s + (c.completionTokens ?? 0) / (ms / 1000)
        }, 0) / recent.length)
      : 0
    return { totalCost, totalTokens, tps, count: done.length }
  }, [liveCalls])

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

  if (!state) return <p style={{ color: "#8b949e" }}>Loading...</p>

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

      {/* View mode tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          onClick={() => setViewMode("live")}
          style={{
            fontSize: "0.8rem", padding: "4px 12px",
            background: viewMode === "live" ? "var(--accent)" : "transparent",
            color: viewMode === "live" ? "var(--bg-root)" : "var(--text-secondary)",
            border: viewMode === "live" ? "none" : "1px solid var(--border)",
            borderRadius: "4px", cursor: "pointer",
          }}
        >Live</button>
        <button
          onClick={() => setViewMode("trace")}
          style={{
            fontSize: "0.8rem", padding: "4px 12px",
            background: viewMode === "trace" ? "var(--accent)" : "transparent",
            color: viewMode === "trace" ? "var(--bg-root)" : "var(--text-secondary)",
            border: viewMode === "trace" ? "none" : "1px solid var(--border)",
            borderRadius: "4px", cursor: "pointer",
          }}
        >Trace</button>
      </div>

      {viewMode === "trace" && novelId && (
        <TraceTimeline novelId={novelId} live={state.active} />
      )}

      {viewMode === "live" && <>
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
        />

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

        <div className="live-activity" style={{ marginTop: 14 }}>
          <div className="live-activity-header">Activity</div>
          <div className="live-activity-body">
            {feedItems.length === 0 && (
              <div className="live-activity-placeholder">
                {state.active ? "Waiting for the first LLM call…" : "Idle."}
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
                  novelId={novelId!}
                  gateId={state.pendingGate.gateId}
                  title={state.pendingGate.title}
                  content={state.pendingGate.content}
                  onDecided={loadState}
                />
              </div>
            </div>
          )}
        </div>
      </>}
    </>
  )
}

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
  if (call.meta?.beatDescription && call.agent === "beat-writer") {
    subtitle.push(call.meta.beatDescription)
  }

  return (
    <div className={`activity-row${running ? " running" : ""}${failed ? " failed" : ""}`}>
      <div className="activity-dot">
        {running && <div className="spinner-sm" />}
      </div>
      <div className="activity-body">
        <div className="activity-title">
          <span className="activity-title-text">{title}</span>
          <span className="activity-chip activity-chip-model">{call.provider && `${call.provider}`}</span>
        </div>
        {subtitle.length > 0 && (
          <div className="activity-subtitle">{subtitle.join(" · ")}</div>
        )}
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
              {call.promptTokens != null && (
                <span className="activity-chip">
                  {call.promptTokens}+{call.completionTokens} tok
                </span>
              )}
              {call.durationMs != null && (
                <span className="activity-chip">{(call.durationMs / 1000).toFixed(1)}s</span>
              )}
              {call.cost != null && call.cost > 0 && (
                <span className="activity-chip activity-chip-cost">${call.cost.toFixed(4)}</span>
              )}
              {call.pass != null && (
                <span className={`activity-chip ${call.pass ? "activity-chip-pass" : "activity-chip-fail"}`}>
                  {call.pass ? "pass" : "fail"}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const NARRATIVE_ICONS: Record<NarrativeKind, string> = {
  phase: "→",
  chapter: "✓",
  fail: "✗",
  retry: "↻",
  validation: "⚠",
  lint: "◆",
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
