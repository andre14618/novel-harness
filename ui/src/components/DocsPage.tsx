import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { marked } from "marked"
import { listDocs, getDoc, type DocEntry } from "../api"

marked.setOptions({ breaks: true, gfm: true })

const STORAGE_KEY = "docs-order-v1"

function loadOrder(docs: DocEntry[]): DocEntry[] {
  try {
    const saved: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
    if (!saved.length) return docs
    const byFilename = new Map(docs.map(d => [d.filename, d]))
    const ordered = saved.filter(f => byFilename.has(f)).map(f => byFilename.get(f)!)
    const remaining = docs.filter(d => !saved.includes(d.filename))
    return [...ordered, ...remaining]
  } catch {
    return docs
  }
}

function saveOrder(docs: DocEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs.map(d => d.filename)))
}

export function DocsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Drag state
  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  // Load doc list
  useEffect(() => {
    listDocs()
      .then(r => {
        const ordered = loadOrder(r.docs)
        setDocs(ordered)
        const fromUrl = searchParams.get("doc")
        const initial = fromUrl && ordered.some(d => d.filename === fromUrl)
          ? fromUrl
          : ordered[0]?.filename ?? null
        setActive(initial)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Load content when active doc changes
  useEffect(() => {
    if (!active) return
    setContent("")
    const key = searchParams.get("key")
    const params: Record<string, string> = { doc: active }
    if (key) params.key = key
    setSearchParams(params, { replace: true })

    getDoc(active)
      .then(r => setContent(r.content))
      .catch(e => setContent(`Error loading doc: ${e.message}`))
  }, [active])

  // ── Drag handlers ────────────────────────────────────────────────────────────
  function onDragStart(idx: number) {
    dragIndex.current = idx
  }

  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    setDragOver(idx)
  }

  function onDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault()
    const from = dragIndex.current
    if (from === null || from === dropIdx) {
      dragIndex.current = null
      setDragOver(null)
      return
    }
    const next = [...docs]
    const [item] = next.splice(from, 1)
    next.splice(dropIdx, 0, item)
    setDocs(next)
    saveOrder(next)
    dragIndex.current = null
    setDragOver(null)
  }

  function onDragEnd() {
    dragIndex.current = null
    setDragOver(null)
  }

  if (loading) return <p style={{ color: "var(--text-tertiary)" }}>Loading docs...</p>
  if (error) return <p style={{ color: "var(--red)" }}>{error}</p>

  const html = content ? marked.parse(content) as string : ""

  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <h3>Docs</h3>
        {docs.map((d, idx) => (
          <button
            key={d.filename}
            className={`docs-item ${active === d.filename ? "active" : ""} ${dragOver === idx ? "drag-over" : ""}`}
            onClick={() => setActive(d.filename)}
            title={`${(d.size / 1024).toFixed(1)} KB`}
            draggable
            onDragStart={() => onDragStart(idx)}
            onDragOver={e => onDragOver(e, idx)}
            onDrop={e => onDrop(e, idx)}
            onDragEnd={onDragEnd}
          >
            <span className="docs-drag-handle" title="Drag to reorder">⠿</span>
            <span className="docs-item-title">{d.title}</span>
          </button>
        ))}
      </aside>
      <main className="docs-content">
        {content
          ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
          : <p style={{ color: "var(--text-tertiary)" }}>Select a document</p>
        }
      </main>
    </div>
  )
}
