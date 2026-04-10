import { useEffect, useState, useRef } from "react"
import { useParams, Link } from "react-router-dom"
import { getNovelState, getAllChapters, getStorySpine, type ChapterData, type NovelState } from "../api"

export function NovelReadView() {
  const { novelId } = useParams<{ novelId: string }>()
  const [state, setState] = useState<NovelState | null>(null)
  const [spine, setSpine] = useState<any>(null)
  const [chapters, setChapters] = useState<ChapterData[]>([])
  const [activeChapter, setActiveChapter] = useState(1)
  const [loading, setLoading] = useState(true)
  const chapterRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const qs = window.location.search

  useEffect(() => {
    if (!novelId) return
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

  if (loading) return <div className="card" style={{ textAlign: "center", padding: "3rem" }}>Loading...</div>
  if (!state) return <div className="card">Novel not found</div>

  return (
    <div className="reader-layout">
      {/* Sidebar */}
      <aside className="reader-sidebar">
        <Link to={`/${novelId}${qs}`} className="reader-back">Pipeline</Link>
        <div className="reader-meta">
          <h2 className="reader-title">{novelId}</h2>
          {spine && <p className="reader-theme">{spine.theme}</p>}
          <div className="reader-stats">
            <span>{chapters.length} chapters</span>
            <span>{totalWords.toLocaleString()} words</span>
            <span>{approvedCount} approved</span>
          </div>
        </div>
        <nav className="reader-toc">
          {chapters.map(ch => (
            <button
              key={ch.chapter}
              className={`reader-toc-item ${activeChapter === ch.chapter ? "active" : ""} ${ch.status === "approved" ? "approved" : ""}`}
              onClick={() => scrollToChapter(ch.chapter)}
            >
              <span className="reader-toc-num">{ch.chapter}</span>
              <span className="reader-toc-words">{ch.wordCount}w</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="reader-content">
        {chapters.length === 0 ? (
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
