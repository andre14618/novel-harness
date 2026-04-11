import { useEffect, useState } from "react"
import { marked } from "marked"
import { getDoc } from "../api"

marked.setOptions({ breaks: true, gfm: true })

export function AdaptersPage() {
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    getDoc("adapter-changelog.md")
      .then(r => setContent(r.content))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p style={{ color: "var(--text-tertiary)", padding: "24px" }}>Loading...</p>
  if (error) return <p style={{ color: "var(--red)", padding: "24px" }}>{error}</p>

  const html = marked.parse(content) as string

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 32px" }}>
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
