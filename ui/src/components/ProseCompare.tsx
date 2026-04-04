import { useState } from "react"

const API_KEY = new URLSearchParams(window.location.search).get("key") ?? ""

interface Generation {
  id: number
  seed: string
  attempt: number
  prose: string
  wordCount: number
  variantLabel: string | null
  runLabel: string | null
  latencyMs: number | null
  scores: Array<{ dimension: string; score: number; reasoning: string | null; judge: string }>
  lintIssues: Array<{ category: string; match: string; sentence: string; charOffset: number }>
}

interface Props {
  generations: Generation[]
  onClose: () => void
}

export function ProseCompare({ generations, onClose }: Props) {
  const seeds = [...new Set(generations.map(g => g.seed))]
  const variants = [...new Set(generations.map(g => g.variantLabel ?? g.runLabel ?? "default"))]
  const [selectedSeed, setSelectedSeed] = useState(seeds[0] ?? "")
  const [leftVariant, setLeftVariant] = useState(variants[0] ?? "")
  const [rightVariant, setRightVariant] = useState(variants[1] ?? variants[0] ?? "")

  function findGen(variant: string, seed: string): Generation | undefined {
    return generations.find(g =>
      (g.variantLabel ?? g.runLabel ?? "default") === variant && g.seed === seed
    )
  }

  const left = findGen(leftVariant, selectedSeed)
  const right = findGen(rightVariant, selectedSeed)

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 100, overflow: "auto", padding: "1rem" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>Compare Prose</h2>
          <button onClick={onClose} style={{ fontSize: "0.8rem", padding: "0.3rem 0.8rem", cursor: "pointer" }}>Close</button>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <label style={{ fontSize: "0.8rem", color: "#8b949e" }}>
            Seed:
            <select value={selectedSeed} onChange={e => setSelectedSeed(e.target.value)} style={{ marginLeft: "0.3rem" }}>
              {seeds.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ fontSize: "0.8rem", color: "#8b949e" }}>
            Left:
            <select value={leftVariant} onChange={e => setLeftVariant(e.target.value)} style={{ marginLeft: "0.3rem" }}>
              {variants.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label style={{ fontSize: "0.8rem", color: "#8b949e" }}>
            Right:
            <select value={rightVariant} onChange={e => setRightVariant(e.target.value)} style={{ marginLeft: "0.3rem" }}>
              {variants.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>

        {/* Two columns */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <ProseColumn gen={left} label={leftVariant} />
          <ProseColumn gen={right} label={rightVariant} />
        </div>
      </div>
    </div>
  )
}

function ProseColumn({ gen, label }: { gen: Generation | undefined; label: string }) {
  if (!gen) return (
    <div className="card" style={{ padding: "1rem" }}>
      <h3 style={{ color: "#8b949e" }}>{label}</h3>
      <p style={{ color: "#555" }}>No generation found for this variant/seed.</p>
    </div>
  )

  return (
    <div className="card" style={{ padding: "0.8rem", maxHeight: "80vh", overflow: "auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "0.5rem", borderBottom: "1px solid #30363d", paddingBottom: "0.5rem" }}>
        <h3 style={{ margin: 0, color: "#e0e0e0" }}>{label}</h3>
        <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
          <span className="config-tag">{gen.wordCount}w</span>
          {gen.latencyMs && <span className="config-tag">{(gen.latencyMs / 1000).toFixed(1)}s</span>}
          {gen.scores.map((s, i) => (
            <span key={i} className="config-tag" style={{ color: Math.abs(s.score) > 10 ? "#f85149" : Math.abs(s.score) > 5 ? "#e2b714" : "#4ecca3" }}>
              {s.dimension}: {Math.abs(s.score)}
            </span>
          ))}
          {gen.lintIssues.length > 0 && (
            <span className="config-tag" style={{ color: "#e2b714" }}>lint: {gen.lintIssues.length}</span>
          )}
        </div>
      </div>

      {/* Prose with lint highlighting */}
      <div style={{ fontSize: "0.8rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
        {renderWithLint(gen.prose, gen.lintIssues)}
      </div>
    </div>
  )
}

function renderWithLint(prose: string, lintIssues: Generation["lintIssues"]) {
  if (lintIssues.length === 0) return prose

  const sorted = [...lintIssues].sort((a, b) => a.charOffset - b.charOffset)
  const parts: Array<{ text: string; isLint: boolean; category?: string }> = []
  let lastEnd = 0

  for (const issue of sorted) {
    const start = issue.charOffset
    const end = start + issue.match.length
    if (start < lastEnd) continue
    if (start > lastEnd) parts.push({ text: prose.slice(lastEnd, start), isLint: false })
    parts.push({ text: prose.slice(start, end), isLint: true, category: issue.category })
    lastEnd = end
  }
  if (lastEnd < prose.length) parts.push({ text: prose.slice(lastEnd), isLint: false })

  return parts.map((p, i) =>
    p.isLint ? (
      <mark key={i} title={p.category} style={{ background: "#4e3a1a", color: "#e2b714", borderRadius: "2px", padding: "0 2px" }}>
        {p.text}
      </mark>
    ) : (
      <span key={i}>{p.text}</span>
    )
  )
}
