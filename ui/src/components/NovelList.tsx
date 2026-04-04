import { useEffect, useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { getSeeds, listNovels, startNovel, startNovelCustom, deleteNovel, resumeNovel } from "../api"
import type { NovelListItem, CustomSeed } from "../api"

type StartMode = "custom" | "seed"

interface CharacterInput {
  name: string
  role: "protagonist" | "antagonist" | "supporting"
  description: string
}

const EMPTY_CHAR: CharacterInput = { name: "", role: "protagonist", description: "" }

export function NovelList() {
  const navigate = useNavigate()
  const [seeds, setSeeds] = useState<string[]>([])
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [mode, setMode] = useState<StartMode>("custom")
  const [selectedSeed, setSelectedSeed] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Custom form state
  const [premise, setPremise] = useState("")
  const [genre, setGenre] = useState("")
  const [characters, setCharacters] = useState<CharacterInput[]>([
    { ...EMPTY_CHAR, role: "protagonist" },
    { ...EMPTY_CHAR, role: "antagonist" },
  ])

  function loadNovels() {
    listNovels().then(r => setNovels(r.novels)).catch(() => {})
  }

  useEffect(() => {
    getSeeds().then(r => setSeeds(r.seeds)).catch(() => {})
    loadNovels()
  }, [])

  function updateChar(i: number, field: keyof CharacterInput, value: string) {
    setCharacters(prev => prev.map((c, j) =>
      j === i ? { ...c, [field]: value } : c
    ))
  }

  function addCharacter() {
    if (characters.length < 4) {
      setCharacters(prev => [...prev, { ...EMPTY_CHAR, role: "supporting" }])
    }
  }

  function removeCharacter(i: number) {
    if (characters.length > 2) {
      setCharacters(prev => prev.filter((_, j) => j !== i))
    }
  }

  const customValid = premise.trim().length > 0 && genre.trim().length > 0 &&
    characters.every(c => c.name.trim() && c.description.trim())

  async function handleStart() {
    setStarting(true)
    setError(null)
    try {
      let res: { ok: boolean; novelId: string }
      if (mode === "custom") {
        const seed: CustomSeed = {
          premise: premise.trim(),
          genre: genre.trim(),
          characters: characters.map(c => ({
            name: c.name.trim(),
            role: c.role,
            description: c.description.trim(),
          })),
        }
        res = await startNovelCustom(seed)
      } else {
        if (!selectedSeed) return
        res = await startNovel(selectedSeed)
      }
      navigate(`/${res.novelId}${window.location.search}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setStarting(false)
    }
  }

  async function handleDelete(e: React.MouseEvent, novelId: string) {
    e.stopPropagation()
    if (!confirm(`Archive novel ${novelId.replace("novel-", "").slice(0, 10)}? (Can be recovered from output/.archive)`)) return
    try {
      await deleteNovel(novelId)
      loadNovels()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function handleResume(e: React.MouseEvent, novelId: string) {
    e.stopPropagation()
    try {
      await resumeNovel(novelId)
      navigate(`/${novelId}${window.location.search}`)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const key = new URLSearchParams(window.location.search).get("key") ?? ""

  return (
    <div className="app">
      <div className="top-bar">
        <h1>Novel Harness</h1>
        <nav>
          <a href={`/?key=${key}`}>Dashboard</a>
          <Link to={`/config${window.location.search}`}>Config</Link>
          <a href={`/panel?key=${key}`}>Operations</a>
        </nav>
      </div>

      <h2>Start New Novel</h2>
      <p style={{ fontSize: "0.8rem", color: "#8b949e", marginBottom: "0.8rem", lineHeight: 1.6 }}>
        Creates a 3-chapter short story through 4 phases: <strong>Concept</strong> (world, characters, plot) →{" "}
        <strong>Planning</strong> (chapter outlines) → <strong>Drafting</strong> (prose with continuity checks) →{" "}
        <strong>Validation</strong> (cross-chapter consistency + rewrites). You'll review and approve each step.
      </p>

      {/* Mode toggle */}
      <div className="tab-bar" style={{ marginBottom: "1.2rem" }}>
        <div
          className={`tab ${mode === "custom" ? "active" : ""}`}
          onClick={() => setMode("custom")}
        >
          Custom
        </div>
        <div
          className={`tab ${mode === "seed" ? "active" : ""}`}
          onClick={() => setMode("seed")}
        >
          From Seed
        </div>
      </div>

      {mode === "custom" ? (
        <div className="card">
          <div style={{ marginBottom: "1rem" }}>
            <label
              title="The core story idea. Agents use this to generate the world, characters, and plot structure."
              style={{ display: "block", color: "#8b949e", fontSize: "0.8rem", marginBottom: "0.3rem", cursor: "help" }}
            >
              Premise <span style={{ color: "#555", fontSize: "0.7rem" }}>(?)</span>
            </label>
            <textarea
              placeholder="Describe your story in 1-3 sentences..."
              value={premise}
              onChange={e => setPremise(e.target.value)}
              rows={3}
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label
              title="Guides tone, tropes, and conventions. The writer agent adapts its prose style to match."
              style={{ display: "block", color: "#8b949e", fontSize: "0.8rem", marginBottom: "0.3rem", cursor: "help" }}
            >
              Genre <span style={{ color: "#555", fontSize: "0.7rem" }}>(?)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. sci-fi thriller, epic fantasy, romance drama"
              value={genre}
              onChange={e => setGenre(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <label
                title="2-4 characters with roles. The character agent expands these into full profiles with backstory, traits, speech patterns, and relationships."
                style={{ color: "#8b949e", fontSize: "0.8rem", cursor: "help" }}
              >
                Characters ({characters.length}/4) <span style={{ color: "#555", fontSize: "0.7rem" }}>(?)</span>
              </label>
              {characters.length < 4 && (
                <button className="secondary" onClick={addCharacter} style={{ padding: "4px 10px", fontSize: "0.75rem" }}>
                  + Add
                </button>
              )}
            </div>

            {characters.map((c, i) => (
              <div key={i} className="char-input-row">
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem", marginBottom: "0.3rem" }}>
                  <input
                    type="text"
                    placeholder="Character name"
                    value={c.name}
                    onChange={e => updateChar(i, "name", e.target.value)}
                  />
                  <select
                    value={c.role}
                    onChange={e => updateChar(i, "role", e.target.value)}
                    style={{ width: "auto" }}
                  >
                    <option value="protagonist">protagonist</option>
                    <option value="antagonist">antagonist</option>
                    <option value="supporting">supporting</option>
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem", marginBottom: "0.8rem" }}>
                  <input
                    type="text"
                    placeholder="Brief description (2-3 sentences)"
                    value={c.description}
                    onChange={e => updateChar(i, "description", e.target.value)}
                  />
                  {characters.length > 2 && (
                    <button
                      className="danger"
                      onClick={() => removeCharacter(i)}
                      style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button onClick={handleStart} disabled={starting || !customValid}>
            {starting ? "Starting..." : "Start Novel"}
          </button>
        </div>
      ) : (
        <>
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
        </>
      )}

      {error && <p style={{ color: "#e74c3c", marginTop: "0.5rem" }}>{error}</p>}

      {novels.length > 0 && (
        <>
          <h2>Existing Novels</h2>
          <div className="novel-grid">
            {novels.map(n => {
              const canResume = !n.active && n.phase !== "done"
              return (
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
                  <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem" }}>
                    {canResume && (
                      <button
                        onClick={(e) => handleResume(e, n.id)}
                        style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                      >
                        Resume
                      </button>
                    )}
                    {!n.active && (
                      <button
                        className="danger"
                        onClick={(e) => handleDelete(e, n.id)}
                        style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
