import { useEffect, useState } from "react"
import {
  getWorldBible, getCharacters, getStorySpine,
  getOutlines, getChapterDraft, getIssues,
} from "../api"

interface Props {
  novelId: string
  phase: string
  totalChapters: number
}

const TABS = ["world", "characters", "spine", "outlines", "drafts", "issues"] as const
type Tab = typeof TABS[number]

export function ContentViewer({ novelId, phase, totalChapters }: Props) {
  const [tab, setTab] = useState<Tab>("world")
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [selectedChapter, setSelectedChapter] = useState(1)

  useEffect(() => {
    setLoading(true)
    setData(null)

    const load = async () => {
      try {
        switch (tab) {
          case "world": setData(await getWorldBible(novelId)); break
          case "characters": setData(await getCharacters(novelId)); break
          case "spine": setData(await getStorySpine(novelId)); break
          case "outlines": setData(await getOutlines(novelId)); break
          case "drafts": setData(await getChapterDraft(novelId, selectedChapter)); break
          case "issues": setData(await getIssues(novelId)); break
        }
      } catch {
        setData(null)
      }
      setLoading(false)
    }
    load()
  }, [novelId, tab, selectedChapter])

  return (
    <div>
      <div className="tab-bar">
        {TABS.map(t => (
          <div
            key={t}
            className={`tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </div>
        ))}
      </div>

      {tab === "drafts" && totalChapters > 0 && (
        <div className="chapter-nav">
          {Array.from({ length: totalChapters }, (_, i) => i + 1).map(ch => (
            <button
              key={ch}
              className={`chapter-btn ${selectedChapter === ch ? "active" : ""}`}
              onClick={() => setSelectedChapter(ch)}
            >
              Ch {ch}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        {loading ? (
          <p style={{ color: "#8b949e" }}>Loading...</p>
        ) : !data ? (
          <p style={{ color: "#555" }}>Not available yet</p>
        ) : (
          <ContentDisplay tab={tab} data={data} />
        )}
      </div>
    </div>
  )
}

function ContentDisplay({ tab, data }: { tab: Tab; data: any }) {
  if (!data) return null

  switch (tab) {
    case "world":
      return (
        <div style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
          <p><strong>Setting:</strong> {data.setting}</p>
          <p><strong>Time Period:</strong> {data.timePeriod}</p>
          <p><strong>Culture:</strong> {data.culture}</p>
          <p><strong>History:</strong> {data.history}</p>
          {data.rules?.length > 0 && (
            <div>
              <strong>Rules:</strong>
              <ul>{data.rules.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
          {data.locations?.length > 0 && (
            <div>
              <strong>Locations:</strong>
              <ul>{data.locations.map((l: any, i: number) => <li key={i}><strong>{l.name}:</strong> {l.description}</li>)}</ul>
            </div>
          )}
        </div>
      )

    case "characters":
      if (!Array.isArray(data) || data.length === 0) return <p style={{ color: "#555" }}>No characters</p>
      return (
        <div style={{ fontSize: "0.85rem" }}>
          {data.map((c: any, i: number) => (
            <div key={i} style={{ marginBottom: "1.2rem", paddingBottom: "1rem", borderBottom: "1px solid #30363d" }}>
              <strong>[{c.role}] {c.name}</strong>
              <p><em>Backstory:</em> {c.backstory}</p>
              <p><em>Traits:</em> {c.traits?.join(", ")}</p>
              <p><em>Speech:</em> {c.speechPattern}</p>
              <p><em>Goals:</em> {c.goals}</p>
              <p><em>Fears:</em> {c.fears}</p>
              {c.relationships?.length > 0 && (
                <ul>{c.relationships.map((r: any, j: number) => <li key={j}>{r.characterName}: {r.nature}</li>)}</ul>
              )}
            </div>
          ))}
        </div>
      )

    case "spine":
      return (
        <div style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
          <p><strong>Central Conflict:</strong> {data.centralConflict}</p>
          <p><strong>Theme:</strong> {data.theme}</p>
          <p><strong>Ending:</strong> {data.endingDirection}</p>
          {data.acts?.map((a: any, i: number) => (
            <div key={i} style={{ marginTop: "1rem" }}>
              <strong>Act {a.number}: {a.name}</strong>
              <p>{a.summary}</p>
              <p style={{ color: "#8b949e" }}>Emotional arc: {a.emotionalArc}</p>
            </div>
          ))}
        </div>
      )

    case "outlines":
      if (!Array.isArray(data) || data.length === 0) return <p style={{ color: "#555" }}>No outlines</p>
      return (
        <div style={{ fontSize: "0.85rem" }}>
          {data.map((o: any, i: number) => (
            <div key={i} style={{ marginBottom: "1.2rem", paddingBottom: "1rem", borderBottom: "1px solid #30363d" }}>
              <strong>Chapter {o.chapterNumber}: {o.title}</strong>
              <p>POV: {o.povCharacter} | Setting: {o.setting}</p>
              <p>Purpose: {o.purpose}</p>
              <p>Target: ~{o.targetWords} words | Characters: {o.charactersPresent?.join(", ")}</p>
              {o.scenes?.length > 0 && (
                <ol style={{ paddingLeft: "1.5rem", marginTop: "0.3rem" }}>
                  {o.scenes.map((s: any, j: number) => (
                    <li key={j}>{s.description} <span style={{ color: "#8b949e" }}>[{s.emotionalShift}]</span></li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )

    case "drafts":
      if (!data?.prose) return <p style={{ color: "#555" }}>No draft</p>
      return (
        <div>
          <div style={{ fontSize: "0.8rem", color: "#8b949e", marginBottom: "0.8rem" }}>
            v{data.version} · {data.wordCount} words · {data.status}
          </div>
          <div className="prose-content">{data.prose}</div>
        </div>
      )

    case "issues":
      if (!Array.isArray(data) || data.length === 0) return <p style={{ color: "#4ecca3" }}>No open issues</p>
      return (
        <div style={{ fontSize: "0.85rem" }}>
          {data.map((issue: any, i: number) => (
            <div key={i} style={{ marginBottom: "0.6rem", padding: "0.5rem", background: "#0d1117", borderRadius: 4 }}>
              <span className={`badge ${issue.severity === "blocker" ? "error" : "active"}`}>
                {issue.severity}
              </span>
              <span style={{ marginLeft: "0.5rem" }}>Ch {issue.chapter}: {issue.description}</span>
              {issue.suggested_fix && <p style={{ color: "#8b949e", marginTop: "0.3rem" }}>Fix: {issue.suggested_fix}</p>}
            </div>
          ))}
        </div>
      )

    default:
      return <pre>{JSON.stringify(data, null, 2)}</pre>
  }
}
