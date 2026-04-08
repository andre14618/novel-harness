import { useState, useEffect } from "react"

interface Comparison {
  category: string
  input: string
  base: string
  v3: string
}

const CATEGORIES = ["All", "Action", "Atmosphere", "Character", "Dialogue-adjacent", "Complex"]

export function LoraComparePage() {
  const [data, setData] = useState<Comparison[]>([])
  const [filter, setFilter] = useState("All")
  const [highlight, setHighlight] = useState(true)

  useEffect(() => {
    fetch("/app/lora-comparison.json")
      .then(r => r.json())
      .then(setData)
      .catch(() => setData([]))
  }, [])

  const filtered = filter === "All" ? data : data.filter(d => d.category === filter)

  const wordCount = (text: string) => text.split(/\s+/).filter(w => w.length > 0).length
  const sentCount = (text: string) => text.split(/[.!?]+/).filter(s => s.trim().length > 0).length
  const avgSent = (text: string) => {
    const s = sentCount(text)
    return s > 0 ? Math.round(wordCount(text) / s * 10) / 10 : 0
  }

  return (
    <div style={{ padding: "1rem", maxWidth: "100%" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.3rem 0" }}>LoRA Style Comparison</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 1rem 0" }}>
          Base Qwen 3.5 9B vs V3 LoRA (4,497 curated Howard pairs, 2 epochs) — Side-by-side rewrite comparison
        </p>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              style={{
                padding: "0.3rem 0.7rem",
                fontSize: "0.75rem",
                borderRadius: "4px",
                border: "1px solid",
                borderColor: filter === cat ? "var(--accent)" : "var(--border)",
                background: filter === cat ? "var(--accent)" : "transparent",
                color: filter === cat ? "#000" : "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              {cat}
            </button>
          ))}
          <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginLeft: "1rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <input type="checkbox" checked={highlight} onChange={e => setHighlight(e.target.checked)} />
            Show metrics
          </label>
        </div>
      </div>

      {filtered.length === 0 && (
        <p style={{ color: "var(--text-secondary)" }}>Loading comparison data...</p>
      )}

      {filtered.map((item, i) => (
        <div key={i} style={{ marginBottom: "2rem" }}>
          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "1px" }}>
            {item.category} — Paragraph {data.indexOf(item) + 1}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
            {/* Input */}
            <div style={{
              background: "var(--bg-secondary)",
              borderRadius: "6px",
              padding: "1rem",
              borderLeft: "3px solid #555",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.7rem", color: "#888", textTransform: "uppercase", letterSpacing: "1px" }}>Input (bland)</span>
                {highlight && (
                  <span style={{ fontSize: "0.65rem", color: "#666" }}>
                    {wordCount(item.input)}w / {avgSent(item.input)} w/s
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.85rem", lineHeight: 1.8, color: "#999" }}>
                {item.input}
              </div>
            </div>

            {/* Base */}
            <div style={{
              background: "var(--bg-secondary)",
              borderRadius: "6px",
              padding: "1rem",
              borderLeft: "3px solid #c4a882",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.7rem", color: "#c4a882", textTransform: "uppercase", letterSpacing: "1px" }}>Base</span>
                {highlight && (
                  <span style={{ fontSize: "0.65rem", color: "#666" }}>
                    {wordCount(item.base)}w / {avgSent(item.base)} w/s
                    {wordCount(item.base) < wordCount(item.input) && <span style={{ color: "#4ecca3" }}> ↓{Math.round((1 - wordCount(item.base)/wordCount(item.input)) * 100)}%</span>}
                    {wordCount(item.base) > wordCount(item.input) && <span style={{ color: "#f85149" }}> ↑{Math.round((wordCount(item.base)/wordCount(item.input) - 1) * 100)}%</span>}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.85rem", lineHeight: 1.8, color: "#c4a882" }}>
                {item.base}
              </div>
            </div>

            {/* V3 */}
            <div style={{
              background: "var(--bg-secondary)",
              borderRadius: "6px",
              padding: "1rem",
              borderLeft: "3px solid #82c4a8",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.7rem", color: "#82c4a8", textTransform: "uppercase", letterSpacing: "1px" }}>V3 LoRA</span>
                {highlight && (
                  <span style={{ fontSize: "0.65rem", color: "#666" }}>
                    {wordCount(item.v3)}w / {avgSent(item.v3)} w/s
                    {wordCount(item.v3) < wordCount(item.input) && <span style={{ color: "#4ecca3" }}> ↓{Math.round((1 - wordCount(item.v3)/wordCount(item.input)) * 100)}%</span>}
                    {wordCount(item.v3) > wordCount(item.input) && <span style={{ color: "#f85149" }}> ↑{Math.round((wordCount(item.v3)/wordCount(item.input) - 1) * 100)}%</span>}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.85rem", lineHeight: 1.8, color: "#82c4a8" }}>
                {item.v3}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
