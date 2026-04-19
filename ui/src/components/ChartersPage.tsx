import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { marked } from "marked"
import { listCharters, getCharter, type CharterMeta, type CharterFull } from "../api"

marked.setOptions({ breaks: true, gfm: true })

function verdictBadgeColor(v: string | null): string {
  if (!v) return "#666"
  const lower = v.toLowerCase()
  if (lower.startsWith("green")) return "#4c7"
  if (lower.startsWith("yellow")) return "#dc5"
  if (lower.startsWith("red")) return "#d65"
  return "#888"
}

function statusBadgeColor(s: string | null): string {
  if (!s) return "#666"
  const lower = s.toLowerCase()
  if (lower.startsWith("active")) return "#4c7"
  if (lower.startsWith("proposed")) return "#6ae"
  if (lower.startsWith("frozen")) return "#888"
  if (lower.startsWith("revise")) return "#d65"
  if (lower.startsWith("deferred")) return "#aaa"
  if (lower.startsWith("template")) return "#999"
  if (lower.startsWith("example")) return "#9a8"
  return "#888"
}

export function ChartersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [charters, setCharters] = useState<CharterMeta[] | null>(null)
  const [full, setFull] = useState<CharterFull | null>(null)
  const [error, setError] = useState("")

  const active = searchParams.get("charter")

  useEffect(() => {
    listCharters().then(setCharters).catch(e => setError(String(e)))
  }, [])

  useEffect(() => {
    if (!active) { setFull(null); return }
    setFull(null)
    getCharter(active).then(setFull).catch(e => setError(String(e)))
  }, [active])

  function open(slug: string) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set("charter", slug)
      return next
    }, { replace: true })
  }

  function back() {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete("charter")
      return next
    }, { replace: true })
  }

  if (error) return <p style={{ color: "var(--red)", padding: 32 }}>{error}</p>
  if (!charters) return <p style={{ color: "var(--text-tertiary)", padding: 32 }}>Loading charters…</p>

  // ── Reader view ───────────────────────────────────────────────
  if (active) {
    const html = full?.body ? marked.parse(full.body) as string : ""
    return (
      <div className="docs-reader">
        <div className="docs-reader-header">
          <button className="docs-back-btn" onClick={back}>← All charters</button>
          {full && <span className="docs-reader-title">{full.title}</span>}
        </div>
        <div className="docs-reader-body">
          {full ? (
            <>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                {full.status && <span style={{ padding: "2px 8px", borderRadius: 4, background: statusBadgeColor(full.status), color: "#111", fontSize: "0.78rem" }}>{full.status}</span>}
                {full.adversaryVerdict && <span style={{ padding: "2px 8px", borderRadius: 4, background: verdictBadgeColor(full.adversaryVerdict), color: "#111", fontSize: "0.78rem" }}>adversary: {full.adversaryVerdict}</span>}
                {full.experimentFamily && <span style={{ padding: "2px 8px", borderRadius: 4, background: "#2a2e3c", color: "#ccc", fontSize: "0.78rem" }}>family: {full.experimentFamily}</span>}
                {full.proposedBy && <span style={{ padding: "2px 8px", borderRadius: 4, background: "#2a2e3c", color: "#ccc", fontSize: "0.78rem" }}>by {full.proposedBy}</span>}
                {full.proposedDate && <span style={{ padding: "2px 8px", borderRadius: 4, background: "#2a2e3c", color: "#ccc", fontSize: "0.78rem" }}>{full.proposedDate}</span>}
              </div>
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
            </>
          ) : <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>}
        </div>
      </div>
    )
  }

  // ── Grid view ─────────────────────────────────────────────────
  return (
    <div className="docs-grid-view">
      <div className="docs-grid-header">
        <h2>Charters</h2>
        <span className="docs-grid-count">{charters.length} document{charters.length !== 1 ? "s" : ""}</span>
      </div>
      <table className="guide-table">
        <thead>
          <tr><th>Title</th><th>Status</th><th>Adversary</th><th>Family</th><th>Proposed</th></tr>
        </thead>
        <tbody>
          {charters.map(c => (
            <tr key={c.slug} onClick={() => open(c.slug)} style={{ cursor: "pointer" }}>
              <td><strong>{c.title}</strong><div style={{ color: "#888", fontSize: "0.78rem" }}>{c.slug}</div></td>
              <td>{c.status ? <span style={{ padding: "1px 6px", borderRadius: 3, background: statusBadgeColor(c.status), color: "#111", fontSize: "0.74rem" }}>{c.status}</span> : "—"}</td>
              <td>{c.adversaryVerdict ? <span style={{ padding: "1px 6px", borderRadius: 3, background: verdictBadgeColor(c.adversaryVerdict), color: "#111", fontSize: "0.74rem" }}>{c.adversaryVerdict}</span> : "—"}</td>
              <td style={{ color: "#aaa", fontSize: "0.82rem" }}>{c.experimentFamily ?? "—"}</td>
              <td style={{ color: "#888", fontSize: "0.82rem" }}>{c.proposedDate ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
