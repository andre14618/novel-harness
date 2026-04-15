import { useEffect, useState, useRef, useMemo } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { listNovels, getNovelState, getAllChapters, getStorySpine, exportNovelURL, runTonalPass, type ChapterData, type NovelState, type NovelListItem } from "../api"
import { useNovelSSE } from "../hooks/useNovelSSE"

type ViewMode = "original" | "tonal" | "diff"

function splitParagraphs(prose: string): string[] {
  return prose.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
}

export function NovelReadView() {
  const { novelId } = useParams<{ novelId: string }>()
  const navigate = useNavigate()
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [state, setState] = useState<NovelState | null>(null)
  const [spine, setSpine] = useState<any>(null)
  const [chapters, setChapters] = useState<ChapterData[]>([])
  const [tonalChapters, setTonalChapters] = useState<ChapterData[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>("original")
  const [activeChapter, setActiveChapter] = useState(1)
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tonalRunning, setTonalRunning] = useState(false)
  const [tonalError, setTonalError] = useState<string | null>(null)
  const [tonalProgress, setTonalProgress] = useState<{ chapter: number; chapterIndex: number; totalChapters: number; paragraph: number; totalParagraphs: number; rewritten: number } | null>(null)
  const chapterRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const qs = window.location.search

  const currentNovel = novels.find(n => n.id === novelId)

  useEffect(() => {
    listNovels().then(r => setNovels(r.novels))
  }, [])

  useEffect(() => {
    if (!novelId && novels.length > 0) {
      navigate(`/${novels[0].id}/read${qs}`, { replace: true })
    }
  }, [novelId, novels])

  const loadChapters = (id: string) => Promise.all([
    getAllChapters(id, "approved").then(setChapters),
    getAllChapters(id, "tonal").then(setTonalChapters).catch(() => setTonalChapters([])),
  ])

  useEffect(() => {
    if (!novelId) return
    setLoading(true)
    setChapters([])
    setTonalChapters([])
    setState(null)
    setSpine(null)
    setViewMode("original")
    setActiveChapter(1)
    Promise.all([
      getNovelState(novelId).then(setState),
      loadChapters(novelId),
      getStorySpine(novelId).then(setSpine).catch(() => null),
    ]).finally(() => setLoading(false))
  }, [novelId])

  // SSE — drives per-paragraph progress and end-of-run state
  const { lastEvent } = useNovelSSE(novelId ?? null)

  useEffect(() => {
    if (!lastEvent) return
    const { type, data } = lastEvent as { type: string; data: any }
    if (type === "tonal-start") {
      setTonalRunning(true)
      setTonalError(null)
      setTonalProgress({ chapter: 0, chapterIndex: 0, totalChapters: data.totalChapters, paragraph: 0, totalParagraphs: 0, rewritten: 0 })
    } else if (type === "tonal-chapter-start") {
      setTonalProgress(p => ({ ...(p ?? { paragraph: 0, totalParagraphs: 0, rewritten: 0 }), chapter: data.chapter, chapterIndex: data.chapterIndex, totalChapters: data.totalChapters }))
    } else if (type === "tonal-progress") {
      setTonalProgress(p => ({
        chapter: data.chapter,
        chapterIndex: p?.chapterIndex ?? 0,
        totalChapters: p?.totalChapters ?? 0,
        paragraph: data.paragraph,
        totalParagraphs: data.totalParagraphs,
        rewritten: data.rewritten,
      }))
    } else if (type === "tonal-chapter-done") {
      if (novelId) loadChapters(novelId)
    } else if (type === "tonal-done") {
      setTonalRunning(false)
      setTonalProgress(null)
      if (novelId) loadChapters(novelId)
    } else if (type === "tonal-error") {
      setTonalRunning(false)
      setTonalProgress(null)
      setTonalError(data.error)
    }
  }, [lastEvent, novelId])

  // Safety poll — in case SSE drops, reconcile against /state
  useEffect(() => {
    if (!novelId || !tonalRunning) return
    const t = setInterval(async () => {
      const s = await getNovelState(novelId).catch(() => null)
      if (!s) return
      setState(s)
      if (!s.active) {
        setTonalRunning(false)
        setTonalProgress(null)
        if (s.lastRunError) setTonalError(s.lastRunError.error)
        await loadChapters(novelId)
      }
    }, 5000)
    return () => clearInterval(t)
  }, [novelId, tonalRunning])

  const tonalByChapter = useMemo(() => {
    const m = new Map<number, ChapterData>()
    for (const c of tonalChapters) if (c.status === "tonal-pass") m.set(c.chapter, c)
    return m
  }, [tonalChapters])

  const hasAnyTonal = tonalByChapter.size > 0

  const onRunTonal = async () => {
    if (!novelId) return
    setTonalError(null)
    try {
      await runTonalPass(novelId)
      setTonalRunning(true)
    } catch (err) {
      setTonalError(err instanceof Error ? err.message : String(err))
    }
  }

  const scrollToChapter = (ch: number) => {
    setActiveChapter(ch)
    chapterRefs.current.get(ch)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0)
  const approvedCount = chapters.filter(c => c.status === "approved").length

  if (!novelId && novels.length === 0) {
    return <div className="card" style={{ textAlign: "center", padding: "3rem" }}>Loading...</div>
  }

  const pickerLabel = novels.length === 1 ? "Read Novel" : "Read Novels"
  const current = novels.find(n => n.id === novelId) ?? novels[0] ?? null
  const rest = novels.filter(n => n.id !== current?.id)
  const tileInfo = (n: NovelListItem) => {
    const d = new Date(n.createdAt)
    return {
      status: n.phase === "done" ? "done" : n.active ? "running" : n.phase,
      dateStr: `${d.getMonth() + 1}/${d.getDate()}`,
      premise: n.seed?.premise ?? "",
    }
  }

  return (
    <div className="reader-layout">
      <aside className="reader-sidebar">
        <button className="studio-novels-btn" onClick={() => setPickerOpen(true)} style={{ width: "100%", marginBottom: "0.5rem" }}>
          {pickerLabel} <span className="studio-novels-count">{novels.length}</span>
        </button>

        {novelId && (
          <Link to={`/${novelId}${qs}`} className="reader-back">Pipeline View</Link>
        )}

        {novelId && chapters.length > 0 && (
          <div className="reader-export">
            <div className="reader-export-label">Tonal Pass</div>
            {hasAnyTonal ? (
              <div className="reader-view-modes">
                <button className={`reader-mode-btn ${viewMode === "original" ? "active" : ""}`} onClick={() => setViewMode("original")}>Original</button>
                <button className={`reader-mode-btn ${viewMode === "tonal" ? "active" : ""}`} onClick={() => setViewMode("tonal")}>Tonal</button>
                <button className={`reader-mode-btn ${viewMode === "diff" ? "active" : ""}`} onClick={() => setViewMode("diff")}>Diff</button>
              </div>
            ) : (
              <div className="reader-tonal-empty">No tonal pass yet</div>
            )}
            <button className="reader-export-btn" onClick={onRunTonal} disabled={tonalRunning || state?.active} style={{ width: "100%", marginTop: "0.35rem" }}>
              {tonalRunning ? "Running…" : hasAnyTonal ? "Re-run Tonal Pass" : "Run Tonal Pass"}
            </button>
            {tonalRunning && tonalProgress && (
              <div className="reader-tonal-progress">
                {tonalProgress.totalChapters > 0 && (
                  <div className="reader-tonal-chapter">
                    Ch {tonalProgress.chapterIndex}/{tonalProgress.totalChapters}
                    {tonalProgress.chapter > 0 && ` · #${tonalProgress.chapter}`}
                  </div>
                )}
                {tonalProgress.totalParagraphs > 0 && (
                  <>
                    <div className="reader-tonal-bar">
                      <div className="reader-tonal-bar-fill" style={{ width: `${(tonalProgress.paragraph / tonalProgress.totalParagraphs) * 100}%` }} />
                    </div>
                    <div className="reader-tonal-meta">
                      {tonalProgress.paragraph}/{tonalProgress.totalParagraphs} paragraphs · {tonalProgress.rewritten} rewritten
                    </div>
                  </>
                )}
              </div>
            )}
            {tonalError && <div className="reader-tonal-error">{tonalError}</div>}
            <div className="reader-export-label" style={{ marginTop: "0.85rem" }}>Export</div>
            <div className="reader-export-row">
              <a href={exportNovelURL(novelId, "markdown")} className="reader-export-btn">.md</a>
              <a href={exportNovelURL(novelId, "txt")} className="reader-export-btn">.txt</a>
              <a href={exportNovelURL(novelId, "json")} className="reader-export-btn">.json</a>
            </div>
            <div className="reader-export-row">
              <a href={exportNovelURL(novelId, "markdown", true)} className="reader-export-btn alt" title="Only chapters that passed approval">.md (approved only)</a>
            </div>
          </div>
        )}

        {currentNovel?.seed && (
          <div className="reader-seed">
            <span className="reader-seed-genre">{currentNovel.seed.genre}</span>
            <p className="reader-seed-premise">{currentNovel.seed.premise}</p>
            {currentNovel.seed.characters && currentNovel.seed.characters.length > 0 && (
              <div className="reader-seed-chars">
                {currentNovel.seed.characters.map((c, i) => (
                  <span key={i} className={`reader-seed-char ${c.role}`}>{c.name}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {state && (
          <div className="reader-meta">
            {spine && <p className="reader-theme">{spine.theme}</p>}
            <div className="reader-stats">
              <span>{chapters.length} chapters</span>
              <span>{totalWords.toLocaleString()} words</span>
              <span>{approvedCount} approved</span>
              <span className={`badge ${state.phase === "done" ? "done" : "active"}`}>{state.phase}</span>
            </div>
          </div>
        )}

        <nav className="reader-toc">
          {chapters.map(ch => (
            <button
              key={ch.chapter}
              className={`reader-toc-item ${activeChapter === ch.chapter ? "active" : ""} ${ch.status === "approved" ? "approved" : ""}`}
              onClick={() => scrollToChapter(ch.chapter)}
            >
              <span className="reader-toc-num">Ch {ch.chapter}</span>
              <span className="reader-toc-words">{ch.wordCount}w</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="reader-content">
        {loading ? (
          <div className="card" style={{ textAlign: "center", padding: "3rem" }}>Loading...</div>
        ) : !novelId ? (
          <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
            Select a novel from the sidebar
          </div>
        ) : chapters.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}>
            No chapters drafted yet
          </div>
        ) : (
          chapters.map(ch => {
            const tonal = tonalByChapter.get(ch.chapter)
            const activeProse = viewMode === "tonal" && tonal ? tonal.prose : ch.prose
            const activeWords = viewMode === "tonal" && tonal ? tonal.wordCount : ch.wordCount
            const activeVersion = viewMode === "tonal" && tonal ? tonal.version : ch.version
            const activeStatus = viewMode === "tonal" && tonal ? "tonal-pass" : ch.status
            const showDiff = viewMode === "diff" && tonal
            const origParas = showDiff ? splitParagraphs(ch.prose) : []
            const tonalParas = showDiff ? splitParagraphs(tonal!.prose) : []
            const diffLen = Math.max(origParas.length, tonalParas.length)

            return (
              <div
                key={ch.chapter}
                ref={el => { if (el) chapterRefs.current.set(ch.chapter, el) }}
                className={`reader-chapter ${viewMode === "tonal" && tonal ? "tonal" : ""}`}
              >
                <div className="reader-chapter-header">
                  <h3>Chapter {ch.chapter}</h3>
                  <div className="reader-chapter-meta">
                    <span className={`badge ${activeStatus === "approved" ? "done" : activeStatus === "tonal-pass" ? "tonal" : "active"}`}>{activeStatus}</span>
                    <span>{activeWords} words</span>
                    <span>v{activeVersion}</span>
                  </div>
                </div>
                {showDiff ? (
                  <div className="prose-content">
                    {Array.from({ length: diffLen }).map((_, i) => {
                      const o = origParas[i] ?? ""
                      const t = tonalParas[i] ?? ""
                      if (o === t) {
                        return <p key={i} className="diff-para unchanged">{o}</p>
                      }
                      if (!o) return <p key={i} className="diff-para added">{t}</p>
                      if (!t) return <p key={i} className="diff-para removed">{o}</p>
                      return (
                        <div key={i} className="diff-pair">
                          <p className="diff-para removed">{o}</p>
                          <p className="diff-para added">{t}</p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="prose-content">{activeProse}</div>
                )}
              </div>
            )
          })
        )}
      </main>

      {/* Novel picker overlay */}
      {pickerOpen && (
        <div className="novel-picker-overlay" onClick={() => setPickerOpen(false)}>
          <div className="novel-picker-panel" onClick={e => e.stopPropagation()}>
            <div className="novel-picker-header">
              <span>{pickerLabel}</span>
              <button className="novel-picker-close" onClick={() => setPickerOpen(false)}>×</button>
            </div>
            <div className="novel-picker-body">
              {current && (() => {
                const { status, dateStr, premise } = tileInfo(current)
                return (
                  <Link
                    key={current.id}
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
              {rest.length > 0 && (
                <div className="novel-picker-rest">
                  {rest.map(n => {
                    const { status, dateStr, premise } = tileInfo(n)
                    return (
                      <Link
                        key={n.id}
                        to={`/${n.id}/read${qs}`}
                        className="novel-picker-tile"
                        onClick={() => setPickerOpen(false)}
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
      )}
    </div>
  )
}
