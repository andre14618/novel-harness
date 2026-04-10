import { useEffect, useState, useRef } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { listNovels, getNovelState, getAllChapters, getStorySpine, type ChapterData, type NovelState, type NovelListItem } from "../api"

export function NovelReadView() {
  const { novelId } = useParams<{ novelId: string }>()
  const navigate = useNavigate()
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [state, setState] = useState<NovelState | null>(null)
  const [spine, setSpine] = useState<any>(null)
  const [chapters, setChapters] = useState<ChapterData[]>([])
  const [activeChapter, setActiveChapter] = useState(1)
  const [loading, setLoading] = useState(true)
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

  return (
    <div className="reader-layout">
      <aside className="reader-sidebar">
        <select
          className="reader-novel-select"
          value={novelId || ""}
          onChange={e => navigate(`/${e.target.value}/read${qs}`)}
        >
          {!novelId && <option value="">Select a novel...</option>}
          {novels.map(n => (
            <option key={n.id} value={n.id}>
              {n.seed?.genre ? `[${n.seed.genre}] ` : ""}{n.seed?.premise?.slice(0, 60) || n.id}
            </option>
          ))}
        </select>

        <button
          className="reader-latest-btn"
          onClick={() => novels.length > 0 && navigate(`/${novels[0].id}/read${qs}`)}
          disabled={novels.length === 0}
        >
          Most Recent
        </button>

        {novelId && (
          <Link to={`/${novelId}${qs}`} className="reader-back">Pipeline View</Link>
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
    </div>
  )
}
