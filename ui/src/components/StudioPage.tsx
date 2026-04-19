import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { Link } from "react-router-dom"
import {
  getSeeds, listNovels, startNovel, startNovelCustom,
  getNovelState, getNovelConfig, getTrace, resumeNovel,
  exportNovelURL,
  emptyDirectives,
  type NovelListItem, type NovelState, type NovelConfig, type SSEEvent, type TraceEvent,
  type PlanningDirectives, type DirectorChatTurn,
} from "../api"
import { useNovelSSE } from "../hooks/useNovelSSE"
import { GatePanel } from "./GatePanel"
import { PlanAssistPanel } from "./PlanAssistPanel"
import { PipelineFlow } from "./PipelineFlow"
import { LiveMeters } from "./LiveMeters"
import { DirectorChat } from "./DirectorChat"
import { ArtifactPreviews } from "./ArtifactPreviews"
import { agentActionLabel } from "../agent-labels"

// Novel IDs matching these shapes are treated as experiment/pilot runs and
// hidden from the Studio picker by default (toggle via Show experiments).
// Keep this heuristic conservative: if someone names a real novel "pp2-…"
// we'll hide it, but that's easy to recover by flipping the toggle.
const EXPERIMENT_ID_PATTERNS = [
  /__/,                       // double-underscore convention (pp2-floor__prompt__seed__ts)
  /^pp2-/,                    // planner-phase2 pilot/floor variants
  /^pilot-/,                  // generic pilot runs
  /^eval-/,                   // eval harness runs
  /^leak-/,                   // leak-detector data gen
  /^halluc-/,                 // hallucination-checker data gen
  /^voice-probe-/,            // voice probes
  /^fantasy-debt-/,           // charter-named mini-pilot seeds
]

function isExperimentNovel(id: string): boolean {
  return EXPERIMENT_ID_PATTERNS.some(re => re.test(id))
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
  status: "running" | "done" | "fail" | "stale"
  error?: string
  pass?: boolean
}

type NarrativeKind = "phase" | "chapter" | "fail" | "retry" | "validation" | "lint"
interface NarrativeEntry {
  kind: NarrativeKind
  ts: number
  text: string
  detail?: string
  recovered?: boolean
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
  const [directorOpen, setDirectorOpen] = useState(false)
  const [directives, setDirectives] = useState<PlanningDirectives>(emptyDirectives)
  const [directorHistory, setDirectorHistory] = useState<DirectorChatTurn[]>([])

  // ── Pipeline view state ───────────────────────────────────────────────
  const [state, setState] = useState<NovelState | null>(null)
  const [_config, setConfig] = useState<NovelConfig | null>(null)
  const [resuming, setResuming] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [showExperiments, setShowExperiments] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("studio-show-experiments") === "true",
  )
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
  const [runEndedAt, setRunEndedAt] = useState<number | null>(null)
  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0)
  const activityEndRef = useRef<HTMLDivElement>(null)

  // ── Load seeds and novels on mount ────────────────────────────────────
  useEffect(() => {
    getSeeds().then(r => {
      const sorted = [...r.seeds].sort((a, b) => a === "fantasy-system-heretic" ? -1 : b === "fantasy-system-heretic" ? 1 : 0)
      setSeeds(sorted)
      if (sorted.length > 0) setSelectedSeed(sorted[0])
    })
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

  // Safety poll: if the pipeline is active but no gate is showing, re-fetch
  // state every 8s. Handles the case where the `gate:waiting` SSE event was
  // dropped (reconnect, backgrounded tab) and the UI would otherwise sit
  // without a gate card while the backend is blocked waiting for approval.
  useEffect(() => {
    if (!activeNovelId) return
    if (!state?.active) return
    if (state.pendingGate) return
    if (state.pendingPlanAssist) return
    const t = setInterval(loadState, 8000)
    return () => clearInterval(t)
  }, [activeNovelId, state?.active, state?.pendingGate, state?.pendingPlanAssist, loadState])

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
    setRunEndedAt(null)

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
    if ([
      "phase:changed", "gate:waiting", "gate:resolved",
      "gate:plan-assist", "gate:plan-assist-resolved",
      "done",
    ].includes(lastEvent.type)) {
      loadState()
      listNovels().then(r => setNovels(r.novels)).catch(() => {})
    }
    // Also trigger state reload on trace `gate-wait` / `plan-assist-wait`
    // events. The live SSE packet can be lost (reconnect, backgrounded
    // tab) — the trace row is the durable signal that a gate is pending.
    if (lastEvent.type === "trace") {
      const et = (lastEvent as any).data?.eventType
      if (et === "gate-wait" || et === "plan-assist-wait") loadState()
    }
    // Refresh artifact previews when a phase completes or a concept/planning
    // agent finishes (so world/characters/spine/outlines populate as they land).
    if (lastEvent.type === "phase:changed") {
      setArtifactRefreshKey(k => k + 1)
    } else if (lastEvent.type === "trace") {
      const d: any = (lastEvent as any).data
      const et = d?.eventType
      const agent = d?.agent
      if (et === "agent-complete" && ["world-builder", "character-agent", "plotter", "planning-plotter"].includes(agent)) {
        setArtifactRefreshKey(k => k + 1)
      } else if (et === "phase-change" || et === "phase-complete") {
        setArtifactRefreshKey(k => k + 1)
      }
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
    let latestTs: number | null = null
    const beatAttempts = new Map<string, number>()

    const keyFor = (agent: string, ch?: number, bi?: number, startTs?: number) =>
      `${agent}:${ch ?? "_"}:${bi ?? "_"}:${startTs ?? ""}`

    for (const e of events) {
      const tsMs = e.timestamp ? new Date(e.timestamp).getTime() : Date.now()
      if (earliestTs === null || tsMs < earliestTs) earliestTs = tsMs
      if (latestTs === null || tsMs > latestTs) latestTs = tsMs

      if (e.type === "trace") {
        const d = e.data as any
        const et = d.eventType as string

        if (et === "llm-call-start") {
          const agent = d.agent as string
          // Reconciliation: if a prior call for the same (agent, chapter, beatIndex)
          // tuple is still "running", it's a stranded event — mark it superseded so
          // the row doesn't sit as "streaming…" forever.
          for (const [k, v] of calls) {
            if (v.agent === agent && v.chapter === d.chapter && v.beatIndex === d.beatIndex && v.status === "running") {
              calls.set(k, { ...v, status: "stale", endTs: tsMs })
            }
          }
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
          const label = agentActionLabel(agent)
          const loc = d.chapter != null ? (d.beatIndex != null ? `Ch ${d.chapter}, beat ${d.beatIndex + 1}` : `Ch ${d.chapter}`) : undefined
          const errSnippet = d.error ? String(d.error).split("\n")[0].slice(0, 120) : undefined
          narratives.push({ kind: "fail", ts: tsMs, text: `${label} failed${loc ? ` — ${loc}` : ""}`, detail: errSnippet })
        } else if (et === "agent-start") {
          active.add(d.agent as string)
        } else if (et === "phase-change" || et === "phase-complete") {
          completed.clear()
          // Reconciliation: any call still "running" when the phase advances is
          // an orphan (its completion event was lost). Mark stale so the row
          // stops displaying "streaming…" after the phase has moved on.
          for (const [k, v] of calls) {
            if (v.status === "running") {
              calls.set(k, { ...v, status: "stale", endTs: tsMs })
            }
          }
          active.clear()
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
    setRunEndedAt(latestTs)
  }, [events])

  // Auto-scroll only during live writes, not historical hydration
  useEffect(() => {
    if (state?.active) {
      activityEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [liveCalls.length, state?.active])

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
        const hasDirectives =
          directives.lockedCharacters.length > 0 ||
          directives.requiredBeats.length > 0 ||
          directives.forbidden.length > 0 ||
          directives.tonalAnchors.length > 0 ||
          !!directives.structuralConstraints.chapterCount ||
          !!directives.structuralConstraints.povRotation ||
          !!directives.structuralConstraints.pacing ||
          !!directives.rawNotes.trim()
        result = await startNovelCustom(
          {
            premise: customPremise,
            genre: customGenre,
            characters: [],
            ...(hasDirectives ? { directives } : {}),
          },
          "auto",
        )
        setDirectorOpen(false)
        setDirectives(emptyDirectives)
        setDirectorHistory([])
      }
      setActiveNovelId(result.novelId)
      listNovels().then(r => setNovels(r.novels))
    } catch {}
    setStarting(false)
  }

  const [resumeError, setResumeError] = useState<string | null>(null)
  const [rewindMenuOpen, setRewindMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  async function handleResume(rewindTo?: "concept" | "planning" | "drafting" | "validation") {
    if (!activeNovelId) return
    if (rewindTo) {
      const labels: Record<string, string> = {
        concept:    "Concept (rebuild world, characters, plot — destructive)",
        planning:   "Planning (rewrite chapter outlines — drops existing outlines)",
        drafting:   "Drafting (re-run chapter writing — keeps outlines)",
        validation: "Validation (re-run checks + tonal pass on existing prose)",
      }
      if (!confirm(`Rewind and re-run: ${labels[rewindTo]}\n\nContinue?`)) return
    }
    setResuming(true)
    setResumeError(null)
    setRewindMenuOpen(false)
    try {
      await resumeNovel(activeNovelId, rewindTo ? { rewindTo } : undefined)
      loadState()
    } catch (err: any) {
      setResumeError(String(err?.message ?? err))
    } finally {
      setResuming(false)
    }
  }

  const isDone = state?.phase === "done"
  const stalled = state && !state.active && !isDone
  const pipelineError = state?.activeError ?? state?.lastRunError?.error ?? null

  return (
    <div className="studio-v2">
      {/* ── Creation bar ────────────────────────────────────────────── */}
      <div className="studio-create-bar">
        <div className="studio-create-row">
          <div className="studio-create-left">
            <div className="studio-mode-toggle">
              <button className={inputMode === "seed" ? "active" : ""} onClick={() => setInputMode("seed")}>Seed</button>
              <button className={inputMode === "custom" ? "active" : ""} onClick={() => setInputMode("custom")}>Custom</button>
            </div>
            {inputMode === "seed" ? (
              <select className="studio-select-compact" value={selectedSeed} onChange={e => setSelectedSeed(e.target.value)}>
                {seeds.map(s => <option key={s} value={s}>{s}{s === "fantasy-system-heretic" ? " (short test)" : ""}</option>)}
              </select>
            ) : (
              <select className="studio-select-compact" value={customGenre} onChange={e => setCustomGenre(e.target.value)}>
                {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <button className="studio-create-btn" onClick={handleStart} disabled={starting || (inputMode === "custom" && !customPremise.trim())}>
              {starting ? "Starting…" : "Create"}
            </button>
          </div>
          <div className="studio-create-right">
            {activeNovelId && (
              <button className="studio-clear-btn" onClick={() => {
                setActiveNovelId(null)
                setState(null)
                setLiveCalls([])
                setFeedItems([])
                setCurrentChapter(null)
                setCurrentBeat(null)
                setCurrentTotalBeats(null)
                setCurrentChapterTitle(null)
                setActiveAgents(new Set())
                setCompletedAgents(new Set())
                setRunStartedAt(null)
                setRunEndedAt(null)
                lastHydratedRef.current = null
              }}>Clear</button>
            )}
            {(() => {
              const pickerCount = showExperiments ? novels.length : novels.filter(n => !isExperimentNovel(n.id)).length
              return (
                <button className="studio-novels-btn" onClick={() => setPickerOpen(true)}>
                  {pickerCount === 1 ? "Read Novel" : "Read Novels"} <span className="studio-novels-count">{pickerCount}</span>
                </button>
              )
            })()}
            <span className={`connected-dot ${connected ? "on" : "off"}`} />
          </div>
        </div>
        {inputMode === "custom" && (
          <>
            <div className="studio-custom-premise-row">
              <textarea
                className="studio-premise-textarea"
                placeholder="Describe your novel premise…"
                value={customPremise}
                onChange={e => setCustomPremise(e.target.value)}
                rows={2}
              />
              <button
                className={`studio-director-toggle${directorOpen ? " active" : ""}`}
                onClick={() => setDirectorOpen(v => !v)}
                disabled={!customPremise.trim()}
                title={customPremise.trim() ? "Chat with the Planning Director to refine directives" : "Enter a premise first"}
              >
                {directorOpen ? "Close Director" : "Refine with Director"}
                {(directives.lockedCharacters.length + directives.requiredBeats.length + directives.forbidden.length + directives.tonalAnchors.length) > 0 && (
                  <span className="studio-director-count">
                    {directives.lockedCharacters.length + directives.requiredBeats.length + directives.forbidden.length + directives.tonalAnchors.length}
                  </span>
                )}
              </button>
            </div>
            {directorOpen && (
              <DirectorChat
                seed={{ premise: customPremise, genre: customGenre }}
                directives={directives}
                onDirectivesChange={setDirectives}
                history={directorHistory}
                onHistoryChange={setDirectorHistory}
              />
            )}
          </>
        )}
      </div>

      {/* ── Novel picker popout ───────────────────────────────────── */}
      {pickerOpen && (() => {
        const visibleNovels = showExperiments ? novels : novels.filter(n => !isExperimentNovel(n.id))
        const hiddenCount = novels.length - visibleNovels.length
        const current = visibleNovels.find(n => n.id === activeNovelId) ?? visibleNovels[0] ?? null
        const rest = visibleNovels.filter(n => n.id !== current?.id)
        const tileInfo = (n: NovelListItem) => ({
          status: n.phase === "done" ? "done" : n.active ? "running" : n.phase,
          dateStr: (() => { const d = new Date(n.createdAt); return `${d.getMonth()+1}/${d.getDate()}` })(),
          premise: n.seed?.premise ?? "",
        })
        return (
          <div className="novel-picker-overlay" onClick={() => setPickerOpen(false)}>
            <div className="novel-picker-panel" onClick={e => e.stopPropagation()}>
              <div className="novel-picker-header">
                <span>{visibleNovels.length === 1 ? "Read Novel" : "Read Novels"}</span>
                <label style={{ marginLeft: "auto", marginRight: 12, display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: "#aaa", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={showExperiments}
                    onChange={e => {
                      const next = e.target.checked
                      setShowExperiments(next)
                      if (typeof localStorage !== "undefined") localStorage.setItem("studio-show-experiments", String(next))
                    }}
                  />
                  Show experiments
                  {!showExperiments && hiddenCount > 0 && <span style={{ color: "#666" }}>({hiddenCount} hidden)</span>}
                </label>
                <button className="novel-picker-close" onClick={() => setPickerOpen(false)}>×</button>
              </div>
              <div className="novel-picker-body">
                {visibleNovels.length === 0 && (
                  <div style={{ padding: 32, textAlign: "center", color: "#888" }}>
                    {novels.length === 0
                      ? "No novels yet — start one with the bar above."
                      : `All ${hiddenCount} novel${hiddenCount === 1 ? "" : "s"} are experiment/pilot runs. Toggle "Show experiments" to view them.`}
                  </div>
                )}
                {/* Featured current novel */}
                {current && (() => {
                  const { status, dateStr, premise } = tileInfo(current)
                  return (
                    <Link
                      to={`/${current.id}/read${qs}`}
                      className="novel-featured-tile"
                      onClick={() => setPickerOpen(false)}
                    >
                      <div className="novel-tile-top">
                        <span className="novel-tile-genre">{current.seed?.genre || "?"}</span>
                        <span className="novel-tile-date">{dateStr}</span>
                      </div>
                      <div className="novel-featured-premise">{premise || "—"}</div>
                      <div className="novel-tile-footer">
                        <span className={`novel-tile-status ${status === "done" ? "done" : status === "running" ? "running" : ""}`}>
                          {status === "running" ? `ch ${current.currentChapter}/${current.totalChapters}` : status}
                        </span>
                        <span className="novel-featured-cta">Read →</span>
                      </div>
                    </Link>
                  )
                })()}
                {/* Rest of novels */}
                {rest.length > 0 && (
                  <div className="novel-picker-rest">
                    {rest.map(n => {
                      const { status, dateStr, premise } = tileInfo(n)
                      return (
                        <Link
                          key={n.id}
                          to={`/${n.id}/read${qs}`}
                          className="novel-picker-tile"
                          onClick={() => { setActiveNovelId(n.id); setPickerOpen(false) }}
                        >
                          <div className="novel-tile-top">
                            <span className="novel-tile-genre">{n.seed?.genre || "?"}</span>
                            <span className="novel-tile-date">{dateStr}</span>
                          </div>
                          <div className="novel-tile-premise">{premise || "—"}</div>
                          <div className="novel-tile-footer">
                            <span className={`novel-tile-status ${status === "done" ? "done" : status === "running" ? "running" : ""}`}>
                              {status === "running" ? `ch ${n.currentChapter}/${n.totalChapters}` : status}
                            </span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
            endedAt={runEndedAt}
            done={isDone}
          />

          <ArtifactPreviews novelId={activeNovelId} refreshKey={artifactRefreshKey} />

          {stalled && (
            <div
              className="card"
              style={{
                borderColor: pipelineError ? "#e74c3c" : "#e2b714",
                marginTop: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: pipelineError ? "0.8rem" : 0 }}>
                <div style={{ color: pipelineError ? "#e74c3c" : "#e2b714" }}>
                  <strong>
                    {pipelineError ? "Pipeline errored" : "Pipeline stopped"}
                  </strong>
                  {" "}at <strong>{state.phase}</strong>
                  {state.totalChapters > 0 && ` (chapter ${state.currentChapter}/${state.totalChapters})`}.
                  <div style={{ fontSize: "0.75rem", opacity: 0.75, marginTop: 4 }}>
                    Resume re-enters at <code>{state.phase}</code>. Concept skips saved world/characters/spine, drafting skips approved chapters, planning re-plans, validation re-checks.
                  </div>
                </div>
                <button onClick={() => handleResume()} disabled={resuming} style={{ flexShrink: 0 }}>
                  {resuming ? "Resuming…" : "Resume Pipeline"}
                </button>
              </div>
              {pipelineError && (
                <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem", color: "#e74c3c", margin: 0, padding: "0.5rem 0.6rem", background: "rgba(231, 76, 60, 0.08)", borderRadius: 4 }}>
                  {pipelineError}
                </pre>
              )}
            </div>
          )}

          <div className="live-activity" style={{ marginTop: 14 }}>
            <div className="live-activity-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}>
              <span>Activity</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => handleResume()}
                  disabled={resuming}
                  title={`Re-enter the pipeline at ${state.phase}. Saved artifacts and approved chapters are skipped.`}
                  style={{
                    fontSize: "0.72rem",
                    padding: "3px 10px",
                    background: pipelineError ? "#e74c3c" : "transparent",
                    color: pipelineError ? "#fff" : "var(--accent)",
                    border: `1px solid ${pipelineError ? "#e74c3c" : "var(--accent-dim)"}`,
                    borderRadius: 4,
                    cursor: resuming ? "wait" : "pointer",
                  }}
                >
                  {resuming ? "Resuming…"
                    : pipelineError ? "Retry pipeline"
                    : isDone ? "Resume (no-op when done)"
                    : `Resume at ${state.phase}`}
                </button>
                <button
                  onClick={() => setRewindMenuOpen(v => !v)}
                  disabled={resuming}
                  title="Rewind to an earlier phase and re-run from there"
                  style={{
                    fontSize: "0.72rem",
                    padding: "3px 10px",
                    background: "transparent",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 4,
                    cursor: resuming ? "wait" : "pointer",
                  }}
                >
                  Rewind ▾
                </button>
                {rewindMenuOpen && (
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: 4,
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 4,
                    padding: 4,
                    zIndex: 10,
                    minWidth: 280,
                    boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
                  }}>
                    {(["concept", "planning", "drafting", "validation"] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => handleResume(p)}
                        disabled={resuming}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "6px 10px",
                          fontSize: "0.72rem",
                          background: "transparent",
                          color: "var(--text-primary)",
                          border: "none",
                          borderRadius: 3,
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        Rewind to <strong>{p}</strong>
                        <div style={{ fontSize: "0.66rem", color: "var(--text-tertiary)", marginTop: 2 }}>
                          {p === "concept"    && "Rebuild world, characters, plot"}
                          {p === "planning"   && "Re-plan chapter outlines"}
                          {p === "drafting"   && "Re-draft chapters (keeps outlines)"}
                          {p === "validation" && "Re-check + re-lint existing prose"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setExportMenuOpen(v => !v)}
                  title="Download the novel in various formats"
                  style={{
                    fontSize: "0.72rem",
                    padding: "3px 10px",
                    background: "transparent",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  Export ▾
                </button>
                {exportMenuOpen && activeNovelId && (
                  <div style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: 4,
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-default)",
                    borderRadius: 4,
                    padding: 4,
                    zIndex: 10,
                    minWidth: 220,
                    boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
                  }}>
                    {([
                      { fmt: "markdown", label: "Markdown (.md)", desc: "All chapters, with titles + stats" },
                      { fmt: "txt", label: "Plain text (.txt)", desc: "Readable, no formatting" },
                      { fmt: "json", label: "JSON (.json)", desc: "Structured — seed + all chapters" },
                    ] as const).map(({ fmt, label, desc }) => (
                      <a
                        key={fmt}
                        href={exportNovelURL(activeNovelId, fmt)}
                        onClick={() => setExportMenuOpen(false)}
                        style={{
                          display: "block",
                          padding: "6px 10px",
                          fontSize: "0.72rem",
                          color: "var(--text-primary)",
                          borderRadius: 3,
                          textDecoration: "none",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <strong>{label}</strong>
                        <div style={{ fontSize: "0.66rem", color: "var(--text-tertiary)", marginTop: 2 }}>{desc}</div>
                      </a>
                    ))}
                    <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "4px 0" }} />
                    <a
                      href={exportNovelURL(activeNovelId, "markdown", true)}
                      onClick={() => setExportMenuOpen(false)}
                      style={{
                        display: "block",
                        padding: "6px 10px",
                        fontSize: "0.72rem",
                        color: "var(--text-secondary)",
                        borderRadius: 3,
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <strong>Markdown — approved only</strong>
                      <div style={{ fontSize: "0.66rem", color: "var(--text-tertiary)", marginTop: 2 }}>Skip chapters still awaiting approval</div>
                    </a>
                  </div>
                )}
              </div>
            </div>
            {resumeError && (
              <div style={{ margin: "6px 14px 0", padding: "6px 10px", fontSize: "0.72rem", color: "#e74c3c", background: "rgba(231,76,60,0.08)", border: "1px solid rgba(231,76,60,0.3)", borderRadius: 4 }}>
                {resumeError}
              </div>
            )}
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

            {state.pendingPlanAssist && (
              <div className="tl-entry tl-gate" style={{ marginTop: "1rem" }}>
                <div className="tl-dot gate" />
                <div className="tl-body" style={{ width: "100%" }}>
                  <PlanAssistPanel
                    novelId={activeNovelId!}
                    chapter={state.pendingPlanAssist.chapter}
                    payload={state.pendingPlanAssist.payload}
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
  const stale = call.status === "stale"

  let title = agentActionLabel(call.agent)
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
          ) : stale ? (
            <span className="activity-chip activity-chip-stale" title="No completion event received — pipeline advanced past this call">orphaned</span>
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
  const isFail = entry.kind === "fail" && !entry.recovered
  const isRecovered = entry.kind === "fail" && entry.recovered
  const isChapter = entry.kind === "chapter" || entry.kind === "phase"
  return (
    <div className={`narrative-row${isFail ? " narrative-fail" : ""}${isRecovered ? " narrative-recovered" : ""}${isChapter ? " narrative-milestone" : ""}`}>
      <div className="narrative-icon">{isRecovered ? "↻" : NARRATIVE_ICONS[entry.kind]}</div>
      <div className="narrative-body">
        <div className="narrative-text">
          {entry.text}
          {isRecovered && <span style={{ marginLeft: 8, fontSize: "0.7rem", opacity: 0.7 }}>(recovered on retry)</span>}
        </div>
        {entry.detail && <div className="narrative-detail">{entry.detail}</div>}
      </div>
    </div>
  )
}
