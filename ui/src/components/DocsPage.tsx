import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { marked } from "marked"
import { listDocs, getDoc, setDocHidden, type DocEntry } from "../api"

marked.setOptions({ breaks: true, gfm: true })

export function DocsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showHidden, setShowHidden] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("docs-show-hidden") === "true",
  )
  const [toggling, setToggling] = useState<string | null>(null)
  const initialLoaded = useRef(false)

  const active = searchParams.get("doc")

  function loadList() {
    listDocs(showHidden)
      .then(r => setDocs(r.docs))
      .catch(e => setError(e.message))
      .finally(() => {
        initialLoaded.current = true
        setLoading(false)
      })
  }

  useEffect(() => {
    loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden])

  useEffect(() => {
    if (!active) { setContent(""); return }
    setContent("")
    getDoc(active)
      .then(r => setContent(r.content))
      .catch(e => setContent(`Error loading doc: ${e.message}`))
  }, [active])

  function openDoc(filename: string) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set("doc", filename)
      return next
    }, { replace: true })
  }

  function backToGrid() {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete("doc")
      return next
    }, { replace: true })
  }

  function toggleShowHidden() {
    const next = !showHidden
    setShowHidden(next)
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("docs-show-hidden", String(next))
    }
  }

  async function toggleDocHidden(d: DocEntry, ev: React.MouseEvent) {
    ev.stopPropagation()
    setToggling(d.filename)
    try {
      await setDocHidden(d.filename, !d.hidden)
      loadList()
    } catch (e: any) {
      alert(`Failed to toggle hidden: ${e.message}`)
    } finally {
      setToggling(null)
    }
  }

  if (loading && !initialLoaded.current) return <p style={{ color: "var(--text-tertiary)", padding: "32px" }}>Loading docs...</p>
  if (error) return <p style={{ color: "var(--red)", padding: "32px" }}>{error}</p>

  // ── Reader view ───────────────────────────────────────────────────────────
  if (active) {
    const activeDoc = docs.find(d => d.filename === active)
    const html = content ? marked.parse(content) as string : ""
    return (
      <div className="docs-reader">
        <div className="docs-reader-header">
          <button className="docs-back-btn" onClick={backToGrid}>
            ← All docs
          </button>
          {activeDoc && (
            <>
              <span className="docs-reader-title">{activeDoc.title}</span>
              {activeDoc.hidden && <span className="docs-hidden-badge">hidden</span>}
              <button
                className="docs-toggle-hidden-btn"
                onClick={(e) => toggleDocHidden(activeDoc, e)}
                disabled={toggling === activeDoc.filename}
                title={activeDoc.hidden ? "Unhide this doc" : "Hide this doc from the default list"}
              >
                {toggling === activeDoc.filename ? "…" : (activeDoc.hidden ? "Unhide" : "Hide")}
              </button>
            </>
          )}
        </div>
        <div className="docs-reader-body">
          {content
            ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
            : <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
          }
        </div>
      </div>
    )
  }

  // ── Grid view ─────────────────────────────────────────────────────────────
  const visibleCount = docs.filter(d => !d.hidden).length
  const hiddenCount = docs.filter(d => d.hidden).length
  return (
    <div className="docs-grid-view">
      <div className="docs-grid-header">
        <h2>Documentation</h2>
        <span className="docs-grid-count">
          {showHidden ? `${visibleCount} visible · ${hiddenCount} hidden` : `${docs.length} documents`}
        </span>
        <label className="docs-show-hidden-toggle">
          <input type="checkbox" checked={showHidden} onChange={toggleShowHidden} />
          Show hidden
        </label>
      </div>
      <div className="docs-tile-grid">
        {docs.map(d => (
          <div
            key={d.filename}
            className={`docs-tile ${d.hidden ? "docs-tile-hidden" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => openDoc(d.filename)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                openDoc(d.filename)
              }
            }}
          >
            <span className="docs-tile-title">
              {d.title}
              {d.hidden && <span className="docs-hidden-badge">hidden</span>}
            </span>
            <span className="docs-tile-meta">
              {d.filename} · {(d.size / 1024).toFixed(1)} KB
            </span>
            <button
              className="docs-tile-toggle"
              onClick={(e) => toggleDocHidden(d, e)}
              disabled={toggling === d.filename}
              title={d.hidden ? "Unhide" : "Hide"}
            >
              {toggling === d.filename ? "…" : (d.hidden ? "👁" : "⊘")}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
