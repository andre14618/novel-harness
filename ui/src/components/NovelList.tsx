import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { getSeeds, listNovels, startNovel } from "../api"
import type { NovelListItem } from "../api"

export function NovelList() {
  const navigate = useNavigate()
  const [seeds, setSeeds] = useState<string[]>([])
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [selectedSeed, setSelectedSeed] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSeeds().then(r => setSeeds(r.seeds)).catch(() => {})
    listNovels().then(r => setNovels(r.novels)).catch(() => {})
  }, [])

  async function handleStart() {
    if (!selectedSeed) return
    setStarting(true)
    setError(null)
    try {
      const res = await startNovel(selectedSeed)
      navigate(`/${res.novelId}${window.location.search}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setStarting(false)
    }
  }

  const key = new URLSearchParams(window.location.search).get("key") ?? ""

  return (
    <div className="app">
      <div className="top-bar">
        <h1>Novel Harness</h1>
        <nav>
          <a href={`/?key=${key}`}>Dashboard</a>
          <a href={`/panel?key=${key}`}>Operations</a>
        </nav>
      </div>

      <h2>Start New Novel</h2>
      <div className="seed-grid">
        {seeds.map(s => (
          <div
            key={s}
            className={`card seed-card ${selectedSeed === s ? "selected" : ""}`}
            onClick={() => setSelectedSeed(s)}
          >
            {s}
          </div>
        ))}
      </div>

      {selectedSeed && (
        <button onClick={handleStart} disabled={starting}>
          {starting ? "Starting..." : `Start with "${selectedSeed}"`}
        </button>
      )}

      {error && <p style={{ color: "#e74c3c", marginTop: "0.5rem" }}>{error}</p>}

      {novels.length > 0 && (
        <>
          <h2>Existing Novels</h2>
          <div className="novel-grid">
            {novels.map(n => (
              <div
                key={n.id}
                className="card novel-card"
                onClick={() => navigate(`/${n.id}${window.location.search}`)}
              >
                <div className="card-header">
                  <strong>{n.id.replace("novel-", "").slice(0, 10)}</strong>
                  <span className={`badge ${n.active ? "active" : n.phase === "done" ? "done" : "idle"}`}>
                    {n.active ? "running" : n.phase}
                  </span>
                </div>
                <div style={{ fontSize: "0.8rem", color: "#8b949e" }}>
                  {n.totalChapters > 0 && `Ch ${n.currentChapter}/${n.totalChapters} · `}
                  {new Date(n.createdAt).toLocaleDateString()}
                </div>
                {n.pendingGate && (
                  <div style={{ marginTop: "0.4rem" }}>
                    <span className="badge waiting">awaiting: {n.pendingGate.title}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
