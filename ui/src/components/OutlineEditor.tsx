import { useMemo, useState } from "react"

type Beat = {
  description: string
  characters: string[]
  kind?: string
  pov?: string
  setting?: string
  [k: string]: unknown
}

type OutlineLike = {
  chapterNumber: number
  title: string
  povCharacter: string
  setting: string
  purpose: string
  targetWords: number
  scenes: Beat[]
  charactersPresent: string[]
  establishedFacts?: unknown
  characterStateChanges?: unknown
  knowledgeChanges?: unknown
  [k: string]: unknown
}

interface Props {
  initialOutline: OutlineLike
  onSubmit: (outline: OutlineLike) => void
  onCancel: () => void
  submitting?: boolean
  error?: string | null
}

const KIND_OPTIONS = ["action", "dialogue", "interiority", "description"]

export function OutlineEditor({ initialOutline, onSubmit, onCancel, submitting, error }: Props) {
  const [outline, setOutline] = useState<OutlineLike>(() => structuredClone(initialOutline))
  const [viewMode, setViewMode] = useState<"structured" | "raw-json">("structured")
  const [rawJson, setRawJson] = useState(() => JSON.stringify(initialOutline, null, 2))
  const [rawJsonError, setRawJsonError] = useState<string | null>(null)
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const [frozenExpanded, setFrozenExpanded] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)

  const previewJson = useMemo(() => JSON.stringify(outline, null, 2), [outline])

  function updateHeader<K extends keyof OutlineLike>(key: K, value: OutlineLike[K]) {
    setOutline(prev => ({ ...prev, [key]: value }))
  }

  function updateBeat(index: number, patch: Partial<Beat>) {
    setOutline(prev => ({
      ...prev,
      scenes: prev.scenes.map((s, i) => i === index ? { ...s, ...patch } : s),
    }))
  }

  function addBeat() {
    setOutline(prev => ({
      ...prev,
      scenes: [...prev.scenes, {
        description: "New beat description.",
        characters: prev.scenes[prev.scenes.length - 1]?.characters ?? [prev.povCharacter],
        kind: "action",
      }],
    }))
  }

  function removeBeat(index: number) {
    setOutline(prev => ({
      ...prev,
      scenes: prev.scenes.filter((_, i) => i !== index),
    }))
  }

  function moveBeat(index: number, direction: -1 | 1) {
    setOutline(prev => {
      const target = index + direction
      if (target < 0 || target >= prev.scenes.length) return prev
      const next = [...prev.scenes]
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...prev, scenes: next }
    })
  }

  function updateCharacterAt(beatIndex: number, charIndex: number, newName: string) {
    setOutline(prev => ({
      ...prev,
      scenes: prev.scenes.map((s, i) =>
        i === beatIndex
          ? { ...s, characters: s.characters.map((c, j) => j === charIndex ? newName : c).filter(c => c.trim().length > 0) }
          : s,
      ),
    }))
  }

  function removeCharacter(beatIndex: number, charIndex: number) {
    setOutline(prev => ({
      ...prev,
      scenes: prev.scenes.map((s, i) =>
        i === beatIndex ? { ...s, characters: s.characters.filter((_, j) => j !== charIndex) } : s,
      ),
    }))
  }

  function addCharacter(beatIndex: number) {
    setOutline(prev => ({
      ...prev,
      scenes: prev.scenes.map((s, i) =>
        i === beatIndex ? { ...s, characters: [...s.characters, ""] } : s,
      ),
    }))
  }

  function handleSubmit() {
    if (viewMode === "raw-json") {
      try {
        const parsed = JSON.parse(rawJson) as OutlineLike
        setOutline(parsed)
        onSubmit(parsed)
      } catch (e: any) {
        setRawJsonError(`JSON parse failed: ${e.message}`)
      }
    } else {
      onSubmit(outline)
    }
  }

  function switchToRaw() {
    setRawJson(JSON.stringify(outline, null, 2))
    setRawJsonError(null)
    setViewMode("raw-json")
  }

  function switchToStructured() {
    try {
      const parsed = JSON.parse(rawJson) as OutlineLike
      setOutline(parsed)
      setRawJsonError(null)
      setViewMode("structured")
    } catch (e: any) {
      setRawJsonError(`Can't switch back — JSON parse failed: ${e.message}`)
    }
  }

  return (
    <div style={{ marginTop: "0.8rem" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: "0.8rem", color: "#888" }}>View:</span>
        <button
          className={viewMode === "structured" ? "" : "secondary"}
          onClick={switchToStructured}
          disabled={submitting}
          style={{ padding: "2px 10px", fontSize: "0.78rem" }}
        >Structured</button>
        <button
          className={viewMode === "raw-json" ? "" : "secondary"}
          onClick={switchToRaw}
          disabled={submitting}
          style={{ padding: "2px 10px", fontSize: "0.78rem" }}
        >Raw JSON</button>
      </div>

      {viewMode === "raw-json" ? (
        <div>
          <p style={{ fontSize: "0.78rem", color: "#888", marginBottom: 4 }}>
            Full-outline JSON (escape hatch). Server validates via
            chapterOutlineSchema; extras drop silently, required fields
            must be present.
          </p>
          <textarea
            value={rawJson}
            onChange={e => { setRawJson(e.target.value); setRawJsonError(null) }}
            style={{ width: "100%", minHeight: 300, fontFamily: "monospace", fontSize: "0.78rem" }}
          />
          {rawJsonError && <p style={{ color: "#e74c3c", fontSize: "0.78rem" }}>{rawJsonError}</p>}
        </div>
      ) : (
        <>
          <div style={{ border: "1px solid #2a2e3c", borderRadius: 6, marginBottom: 10, background: "#12141c" }}>
            <div
              onClick={() => setHeaderExpanded(v => !v)}
              style={{ padding: 8, cursor: "pointer", fontSize: "0.85rem", color: "#dce" }}
            >
              {headerExpanded ? "▾" : "▸"} Chapter header ·{" "}
              <span style={{ color: "#888" }}>
                "{outline.title}" · {outline.targetWords}w · POV {outline.povCharacter}
              </span>
            </div>
            {headerExpanded && (
              <div style={{ padding: "4px 10px 10px", display: "grid", gridTemplateColumns: "120px 1fr", gap: "4px 10px", alignItems: "center", fontSize: "0.82rem" }}>
                <label>Title:</label>
                <input value={outline.title} onChange={e => updateHeader("title", e.target.value)} />
                <label>POV character:</label>
                <input value={outline.povCharacter} onChange={e => updateHeader("povCharacter", e.target.value)} />
                <label>Setting:</label>
                <input value={outline.setting} onChange={e => updateHeader("setting", e.target.value)} />
                <label>Purpose:</label>
                <textarea value={outline.purpose} onChange={e => updateHeader("purpose", e.target.value)} style={{ minHeight: 40 }} />
                <label>Target words:</label>
                <input type="number" value={outline.targetWords} onChange={e => updateHeader("targetWords", Math.max(0, parseInt(e.target.value) || 0))} />
                <label>Chars present:</label>
                <input
                  value={outline.charactersPresent.join(", ")}
                  onChange={e => updateHeader("charactersPresent", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                  placeholder="comma-separated"
                />
              </div>
            )}
          </div>

          <div style={{ fontSize: "0.82rem", color: "#aaa", margin: "8px 0 4px" }}>
            Beats ({outline.scenes.length})
          </div>

          {outline.scenes.map((beat, i) => (
            <div key={i} style={{
              border: "1px solid #2a2e3c", borderRadius: 6, padding: 8,
              marginBottom: 6, background: "#12141c",
            }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: "0.78rem", color: "#888", minWidth: 24 }}>#{i + 1}</span>
                <select
                  value={beat.kind ?? "action"}
                  onChange={e => updateBeat(i, { kind: e.target.value })}
                  style={{ fontSize: "0.76rem", padding: "1px 4px" }}
                >
                  {KIND_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => moveBeat(i, -1)}
                  disabled={i === 0 || submitting}
                  className="secondary"
                  style={{ padding: "0 6px", fontSize: "0.72rem" }}
                  title="Move up"
                >↑</button>
                <button
                  onClick={() => moveBeat(i, 1)}
                  disabled={i === outline.scenes.length - 1 || submitting}
                  className="secondary"
                  style={{ padding: "0 6px", fontSize: "0.72rem" }}
                  title="Move down"
                >↓</button>
                <button
                  onClick={() => removeBeat(i)}
                  disabled={submitting}
                  className="danger"
                  style={{ padding: "0 6px", fontSize: "0.72rem" }}
                  title="Remove beat"
                >×</button>
              </div>
              <textarea
                value={beat.description}
                onChange={e => updateBeat(i, { description: e.target.value })}
                style={{ width: "100%", minHeight: 50, fontSize: "0.82rem", fontFamily: "inherit" }}
                placeholder="What happens in this beat"
              />
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
                <span style={{ fontSize: "0.75rem", color: "#888" }}>Chars:</span>
                {beat.characters.map((c, ci) => (
                  <span key={ci} style={{
                    display: "inline-flex", alignItems: "center", gap: 2,
                    background: "#24283a", padding: "1px 4px", borderRadius: 3,
                    fontSize: "0.76rem",
                  }}>
                    <input
                      value={c}
                      onChange={e => updateCharacterAt(i, ci, e.target.value)}
                      style={{ width: `${Math.max(5, c.length)}ch`, border: "none", background: "transparent", color: "inherit", padding: 0 }}
                    />
                    <button
                      onClick={() => removeCharacter(i, ci)}
                      disabled={submitting}
                      style={{ padding: "0 3px", fontSize: "0.7rem", background: "none", border: "none", color: "#d65", cursor: "pointer" }}
                      title="Remove character"
                    >×</button>
                  </span>
                ))}
                <button
                  onClick={() => addCharacter(i)}
                  disabled={submitting}
                  className="secondary"
                  style={{ padding: "1px 6px", fontSize: "0.72rem" }}
                >+ char</button>
              </div>
            </div>
          ))}

          <button
            onClick={addBeat}
            disabled={submitting}
            className="secondary"
            style={{ marginTop: 4, fontSize: "0.78rem" }}
          >+ Add beat</button>

          <div style={{ border: "1px solid #2a2e3c", borderRadius: 6, marginTop: 12, background: "#12141c" }}>
            <div
              onClick={() => setFrozenExpanded(v => !v)}
              style={{ padding: 8, cursor: "pointer", fontSize: "0.82rem", color: "#aaa" }}
            >
              {frozenExpanded ? "▾" : "▸"} Frozen fields (read-only)
              <span style={{ color: "#666", marginLeft: 8, fontSize: "0.76rem" }}>
                switch to Raw JSON to edit
              </span>
            </div>
            {frozenExpanded && (
              <div style={{ padding: "4px 10px 10px", fontSize: "0.78rem", color: "#aaa" }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>establishedFacts</strong> ({Array.isArray(outline.establishedFacts) ? outline.establishedFacts.length : 0})
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong>characterStateChanges</strong> ({Array.isArray(outline.characterStateChanges) ? outline.characterStateChanges.length : 0})
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong>knowledgeChanges</strong> ({Array.isArray(outline.knowledgeChanges) ? outline.knowledgeChanges.length : 0})
                </div>
                <p style={{ color: "#666", marginTop: 8, fontSize: "0.75rem" }}>
                  Accepted reviser outputs can modify these fields too. If the
                  exhaustion you're resolving needs changes here, switch to
                  the Raw JSON view.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ border: "1px solid #2a2e3c", borderRadius: 6, marginTop: 10, background: "#12141c" }}>
        <div
          onClick={() => setPreviewExpanded(v => !v)}
          style={{ padding: 8, cursor: "pointer", fontSize: "0.82rem", color: "#aaa" }}
        >
          {previewExpanded ? "▾" : "▸"} Submission preview
          <span style={{ color: "#666", marginLeft: 8, fontSize: "0.76rem" }}>
            {viewMode === "raw-json" ? "from JSON" : "built from form"}
          </span>
        </div>
        {previewExpanded && (
          <pre style={{
            padding: "4px 10px 10px", fontSize: "0.72rem",
            fontFamily: "monospace", maxHeight: 300, overflow: "auto",
            color: "#aaa", margin: 0, whiteSpace: "pre-wrap",
          }}>
            {viewMode === "raw-json" ? rawJson : previewJson}
          </pre>
        )}
      </div>

      {error && <p style={{ color: "#e74c3c", fontSize: "0.82rem", marginTop: 6 }}>{error}</p>}

      <div className="gate-actions" style={{ marginTop: 10 }}>
        <button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit edited plan"}
        </button>
        <button className="secondary" onClick={onCancel} disabled={submitting}>
          Back
        </button>
      </div>
    </div>
  )
}
