import { useEffect, useState, useRef } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { listNovels, getNovelState, getAllChapters, getStorySpine, exportNovelURL, type ChapterData, type NovelState, type NovelListItem } from "../api"

export function NovelReadView() {
  const { novelId } = useParams<{ novelId: string }>()
  const navigate = useNavigate()
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [state, setState] = useState<NovelState | null>(null)
  const [spine, setSpine] = useState<any>(null)
  const [chapters, setChapters] = useState<ChapterData[]>([])
  const [activeChapter, setActiveChapter] = useState(1)
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
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

  useEffect(() => {
    if (!novelId) return
    setLoading(true)
    setChapters([])
    setState(null)
    setSpine(null)
    setActiveChapter(1)
    Promise.all([
      getNovelState(novelId).then(setState),
      getAllChapters(novelId).then(setChapters),
      getStorySpine(novelId).then(setSpine).catch(() => null),
    ]).finally(() => setLoading(false))
  }, [novelId])

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
            <div className="reader-export-label">Export</div>
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
          chapters.map(ch => (
            <div
              key={ch.chapter}
              ref={el => { if (el) chapterRefs.current.set(ch.chapter, el) }}
              className="reader-chapter"
            >
              <div className="reader-chapter-header">
                <h3>Chapter {ch.chapter}</h3>
                <div className="reader-chapter-meta">
                  <span className={`badge ${ch.status === "approved" ? "done" : "active"}`}>{ch.status}</span>
                  <span>{ch.wordCount} words</span>
                  <span>v{ch.version}</span>
                </div>
              </div>
              <div className="prose-content">{ch.prose}</div>
            </div>
          ))
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
