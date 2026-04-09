import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { marked } from "marked"
import { listDocs, getDoc, type DocEntry } from "../api"

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true })

export function DocsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Load doc list
  useEffect(() => {
    listDocs()
      .then(r => {
        setDocs(r.docs)
        // Select from URL param or first doc
        const fromUrl = searchParams.get("doc")
        const initial = fromUrl && r.docs.some(d => d.filename === fromUrl)
          ? fromUrl
          : r.docs[0]?.filename ?? null
        setActive(initial)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Load content when active doc changes
  useEffect(() => {
    if (!active) return
    setContent("")
    // Preserve key param while updating doc param
    const key = searchParams.get("key")
    const params: Record<string, string> = { doc: active }
    if (key) params.key = key
    setSearchParams(params, { replace: true })

    getDoc(active)
      .then(r => setContent(r.content))
      .catch(e => setContent(`Error loading doc: ${e.message}`))
  }, [active])

  if (loading) return <p style={{ color: "var(--text-tertiary)" }}>Loading docs...</p>
  if (error) return <p style={{ color: "var(--red)" }}>{error}</p>

  const html = content ? marked.parse(content) as string : ""

  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <h3>Docs</h3>
        {docs.map(d => (
          <button
            key={d.filename}
            className={`docs-item ${active === d.filename ? "active" : ""}`}
            onClick={() => setActive(d.filename)}
            title={`${(d.size / 1024).toFixed(1)} KB`}
          >
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
