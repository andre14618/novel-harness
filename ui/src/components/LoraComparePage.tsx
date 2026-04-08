import { useState, useEffect } from "react"

interface Comparison {
  category: string
  input: string
  base: string
  v3: string
}

const CATEGORIES = ["All", "Action", "Atmosphere", "Character", "Dialogue-adjacent", "Complex"]

// ── V4 benchmark data (tuning_experiment id=95, 2026-04-08) ──────────────────

const HOWARD_REF = { classifier: 0.715, perplexity: 1964, featureKL: 1.534 }
const INPUT_REF  = { classifier: 0.197, perplexity: 3593, featureKL: 1.569 }

const V4_METRICS = {
  v3: { label: "V3 · Together 9B",  classifier: 0.389, perplexity: 5122, featureKL: 1.539, contentPres: 0.278, latencyMs: 1691, color: "#82c4a8" },
  v4: { label: "V4 · W&B 14B",      classifier: 0.319, perplexity: 4165, featureKL: 1.635, contentPres: 0.274, latencyMs: 931,  color: "#c4a8e2" },
}

const V4_PER_PARA = [
  { input: 0.20, v3: 0.000, v4: 0.000 },
  { input: 0.00, v3: 0.333, v4: 0.333 },
  { input: 0.00, v3: 1.000, v4: 0.200 },
  { input: 0.50, v3: 0.500, v4: 0.167 },
  { input: 0.00, v3: 0.000, v4: 0.000 },
  { input: 1.00, v3: 0.500, v4: 0.500 },
  { input: 0.00, v3: 0.500, v4: 0.333 },
  { input: 0.00, v3: 0.000, v4: 0.500 },
  { input: 0.00, v3: 0.500, v4: 0.500 },
  { input: 0.00, v3: 0.000, v4: 0.000 },
  { input: 0.00, v3: 1.000, v4: 1.000 },
  { input: 0.50, v3: 0.000, v4: 0.250 },
  { input: 0.25, v3: 0.000, v4: 0.000 },
  { input: 0.50, v3: 1.000, v4: 0.500 },
  { input: 0.00, v3: 0.500, v4: 0.500 },
]

const V4_P1_INPUT = "The soldier moved carefully through the dark corridor, his sword held ready in front of him. He could hear strange sounds coming from somewhere deeper in the ruins, and the air felt cold and damp against his skin. He was starting to feel uncomfortable about the whole situation, but he knew he had to keep going."
const V4_P1_V3 = "The soldier crept through the suffocating dark, sword drawn low. Strange, wet gurgles drifted from the ruins' depths, chilling the air that clung to his sweat-slicked skin. Dread tightened his chest; he wanted to turn back, but the cold stone behind him offered no escape. He forced his legs to move forward."
const V4_P1_V4 = "The soldier crept through the shadowed corridor, his blade raised and glinting in the faintest sliver of light. Each step echoed softly against the stone walls, lost in the eerie silence. Somewhere ahead, odd noises slithered through the darkness—whispers, maybe, or something else entirely. The air was thick with dampness, clinging to his skin and making his muscles tense. A chill ran through him, not just from the cold, but from the growing sense that he was being watched. Still, he pressed on, jaw set, knowing there was no turning back."

function V4BenchmarkTab() {
  const r = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d

  const metricRow = (
    label: string, arrow: "↑" | "↓", ref: number, input: number,
    v3: number, v4: number, fmt: (n: number) => string = String,
  ) => {
    const v3wins = arrow === "↑" ? v3 >= v4 : v3 <= v4
    return (
      <tr>
        <td style={{ padding: "0.4rem 0.8rem", color: "var(--text-secondary)", fontSize: "0.8rem" }}>{label} {arrow}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "right", color: "#888", fontSize: "0.8rem" }}>{fmt(ref)}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "right", color: "#888", fontSize: "0.8rem" }}>{fmt(input)}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "right", color: v3wins ? V4_METRICS.v3.color : "var(--text-secondary)", fontWeight: v3wins ? 600 : 400, fontSize: "0.85rem" }}>{fmt(v3)}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "right", color: !v3wins ? V4_METRICS.v4.color : "var(--text-secondary)", fontWeight: !v3wins ? 600 : 400, fontSize: "0.85rem" }}>{fmt(v4)}</td>
        <td style={{ padding: "0.4rem 0.8rem", textAlign: "center", fontSize: "0.75rem", color: v3wins ? V4_METRICS.v3.color : V4_METRICS.v4.color }}>
          {v3wins ? "V3" : "V4"}
        </td>
      </tr>
    )
  }

  const scoreColor = (s: number, ref = false) => {
    if (ref) return "#888"
    if (s >= 0.7) return "#4ecca3"
    if (s >= 0.4) return "#c4a882"
    if (s >= 0.2) return "#e2a882"
    return "#888"
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1rem" }}>V4 Benchmark — tuning_experiment #95</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: 0 }}>
          howard-tonal-v4 (Qwen3-14B · W&B Inference) vs v3 (Qwen3.5-9B · Together AI) · 4,497 curated pairs · 3 epochs · cosine schedule
        </p>
      </div>

      {/* Verdict banner */}
      <div style={{
        background: "rgba(248,81,73,0.08)", border: "1px solid rgba(248,81,73,0.25)",
        borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1.5rem", fontSize: "0.82rem",
        color: "var(--text-secondary)", lineHeight: 1.6,
      }}>
        <strong style={{ color: "#f85149" }}>V3 retained.</strong>{" "}
        V4 scores lower on classifier and feature KL. The 14B base verbosity bleeds through the adapter —
        P1 sample below shows V4 introducing hedging constructions the lint pass would flag.
        Model size does not predict style transfer quality.{" "}
        <span style={{ color: "#82c4a8" }}>V4 is 1.8× faster (W&B vs Together latency).</span>
      </div>

      {/* Metrics table */}
      <div style={{ marginBottom: "2rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Metric", "Howard ref", "Input (bland)", "V3 · Together 9B", "V4 · W&B 14B", "Winner"].map(h => (
                <th key={h} style={{ padding: "0.4rem 0.8rem", textAlign: h === "Metric" ? "left" : "right", color: "var(--text-secondary)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}
                  {...(h === "Winner" ? { style: { padding: "0.4rem 0.8rem", textAlign: "center", color: "var(--text-secondary)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em" } } : {})}
                >{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRow("Classifier", "↑", HOWARD_REF.classifier, INPUT_REF.classifier, V4_METRICS.v3.classifier, V4_METRICS.v4.classifier, n => r(n, 3).toString())}
            {metricRow("Perplexity", "↓", HOWARD_REF.perplexity, INPUT_REF.perplexity, V4_METRICS.v3.perplexity, V4_METRICS.v4.perplexity, n => Math.round(n).toString())}
            {metricRow("Feature KL", "↓", HOWARD_REF.featureKL, INPUT_REF.featureKL, V4_METRICS.v3.featureKL, V4_METRICS.v4.featureKL, n => r(n, 3).toString())}
            {metricRow("Content pres", "↑", 0, 0, V4_METRICS.v3.contentPres, V4_METRICS.v4.contentPres, n => n ? r(n, 3).toString() : "—")}
            {metricRow("Latency (ms)", "↓", 0, 0, V4_METRICS.v3.latencyMs, V4_METRICS.v4.latencyMs, n => n ? Math.round(n).toString() + "ms" : "—")}
          </tbody>
        </table>
      </div>

      {/* Per-paragraph heatmap */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
          Per-paragraph classifier score (higher = more Howard-like)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2rem 1fr 1fr 1fr 4rem", gap: "2px", alignItems: "center" }}>
          <div />
          {["Input", "V3", "V4", "Winner"].map(h => (
            <div key={h} style={{ fontSize: "0.7rem", color: "var(--text-secondary)", textAlign: "center", padding: "0 0.2rem 0.3rem" }}>{h}</div>
          ))}
          {V4_PER_PARA.map((row, i) => {
            const v3wins = row.v3 >= row.v4
            return (
              <>
                <div key={`n${i}`} style={{ fontSize: "0.7rem", color: "#666", textAlign: "right", paddingRight: "0.4rem" }}>P{i + 1}</div>
                {(["input", "v3", "v4"] as const).map(k => (
                  <div key={k} style={{
                    background: `rgba(${k === "v3" ? "130,196,168" : k === "v4" ? "196,168,226" : "180,180,180"},${0.1 + row[k] * 0.7})`,
                    borderRadius: "3px", padding: "0.25rem 0", textAlign: "center",
                    fontSize: "0.72rem", color: scoreColor(row[k], k === "input"),
                    fontWeight: (k === "v3" && v3wins && row.v3 > 0) || (k === "v4" && !v3wins && row.v4 > 0) ? 600 : 400,
                  }}>
                    {r(row[k], 2) || "—"}
                  </div>
                ))}
                <div key={`w${i}`} style={{ fontSize: "0.7rem", textAlign: "center", color: v3wins ? V4_METRICS.v3.color : V4_METRICS.v4.color }}>
                  {row.v3 === row.v4 ? "tie" : v3wins ? "V3" : "V4"}
                </div>
              </>
            )
          })}
        </div>
      </div>

      {/* P1 sample */}
      <div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.6rem" }}>
          Sample output — P1 (action / corridor scene)
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
          {[
            { label: "Input (bland)", text: V4_P1_INPUT, color: "#555" },
            { label: "V3 · Together 9B", text: V4_P1_V3, color: V4_METRICS.v3.color },
            { label: "V4 · W&B 14B", text: V4_P1_V4, color: V4_METRICS.v4.color },
          ].map(({ label, text, color }) => (
            <div key={label} style={{ background: "var(--bg-secondary)", borderRadius: "6px", padding: "1rem", borderLeft: `3px solid ${color}` }}>
              <div style={{ fontSize: "0.7rem", color, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "0.5rem" }}>{label}</div>
              <div style={{ fontSize: "0.82rem", lineHeight: 1.8, color: label === "Input (bland)" ? "#777" : "var(--text-primary)" }}>{text}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: "0.72rem", color: "#666", marginTop: "0.5rem" }}>
          Note: V4 P1 contains "not just from the cold, but from the growing sense that he was being watched" — hedging construction the lint pass would flag.
        </div>
      </div>
    </div>
  )
}

export function LoraComparePage() {
  const [data, setData] = useState<Comparison[]>([])
  const [filter, setFilter] = useState("All")
  const [highlight, setHighlight] = useState(true)
  const [tab, setTab] = useState<"compare" | "v4">("compare")

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
      {/* Header + tabs */}
      <div style={{ marginBottom: "1rem" }}>
        <h2 style={{ margin: "0 0 0.75rem 0" }}>LoRA Style</h2>
        <div style={{ display: "flex", gap: "0.25rem", borderBottom: "1px solid var(--border)" }}>
          {([["compare", "V3 Side-by-side"], ["v4", "V4 Benchmark"]] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "0.4rem 1rem", fontSize: "0.8rem", border: "none", background: "none", cursor: "pointer",
              color: tab === t ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: "-1px",
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* V4 benchmark tab */}
      {tab === "v4" && <V4BenchmarkTab />}

      {/* V3 side-by-side tab */}
      {tab === "compare" && <>
        <div style={{ marginBottom: "1rem" }}>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0 0 0.75rem 0" }}>
            Base Qwen 3.5 9B vs V3 LoRA (4,497 curated Howard pairs, 2 epochs) — Side-by-side rewrite comparison
          </p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setFilter(cat)} style={{
                padding: "0.3rem 0.7rem", fontSize: "0.75rem", borderRadius: "4px", border: "1px solid",
                borderColor: filter === cat ? "var(--accent)" : "var(--border)",
                background: filter === cat ? "var(--accent)" : "transparent",
                color: filter === cat ? "#000" : "var(--text-secondary)", cursor: "pointer",
              }}>{cat}</button>
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
              <div style={{ background: "var(--bg-secondary)", borderRadius: "6px", padding: "1rem", borderLeft: "3px solid #555" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: "0.7rem", color: "#888", textTransform: "uppercase", letterSpacing: "1px" }}>Input (bland)</span>
                  {highlight && <span style={{ fontSize: "0.65rem", color: "#666" }}>{wordCount(item.input)}w / {avgSent(item.input)} w/s</span>}
                </div>
                <div style={{ fontSize: "0.85rem", lineHeight: 1.8, color: "#999" }}>{item.input}</div>
              </div>
              {/* Base */}
              <div style={{ background: "var(--bg-secondary)", borderRadius: "6px", padding: "1rem", borderLeft: "3px solid #c4a882" }}>
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
                <div style={{ fontSize: "0.85rem", lineHeight: 1.8, color: "#c4a882" }}>{item.base}</div>
              </div>
              {/* V3 */}
              <div style={{ background: "var(--bg-secondary)", borderRadius: "6px", padding: "1rem", borderLeft: "3px solid #82c4a8" }}>
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
                <div style={{ fontSize: "0.85rem", lineHeight: 1.8, color: "#82c4a8" }}>{item.v3}</div>
              </div>
            </div>
          </div>
        ))}
      </>}
    </div>
  )
}
