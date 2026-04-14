import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { marked } from "marked"
import { listDocs, getDoc, type DocEntry } from "../api"

marked.setOptions({ breaks: true, gfm: true })

export function DocsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const active = searchParams.get("doc")

  // Load doc list once
  useEffect(() => {
    listDocs()
      .then(r => setDocs(r.docs))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Load content when active doc changes
  useEffect(() => {
    if (!active) {
      setContent("")
      return
    }
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

  if (loading) return <p style={{ color: "var(--text-tertiary)", padding: "32px" }}>Loading docs...</p>
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
            <span className="docs-reader-title">{activeDoc.title}</span>
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
  return (
    <div className="docs-grid-view">
      <div className="docs-grid-header">
        <h2>Documentation</h2>
        <span className="docs-grid-count">{docs.length} documents</span>
      </div>
      <div className="docs-tile-grid">
        {docs.map(d => (
          <button
            key={d.filename}
            className="docs-tile"
            onClick={() => openDoc(d.filename)}
          >
            <span className="docs-tile-title">{d.title}</span>
            <span className="docs-tile-meta">
              {d.filename} · {(d.size / 1024).toFixed(1)} KB
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
