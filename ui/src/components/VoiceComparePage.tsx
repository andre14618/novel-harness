import { useEffect, useState } from "react"

type Style = {
  avg_sentence_words: number
  dialogue_ratio: number
  clause_complexity: number
  sensory_density: number
}

type CharacterAdherence = { name: string; mentioned: boolean }

type CellResult = {
  cell: string
  prose: string
  recon_words: number
  target_words: number
  style: Style
  delta_sum: number
  adherence: {
    characters: CharacterAdherence[]
    wordDelta: number
    wordPctOff: number
  }
}

type Brief = {
  beat_id: string
  book?: string
  characters?: string[]
  pov?: string
  setting?: string
  tone?: string
  kind?: string
  transition_in?: string
  boundary_signal?: string
  summary?: string
  words?: number
}

type BriefView = {
  beat_id: string
  brief: Brief
  ground_truth: { prose: string; style?: Style; words: number }
  cells: CellResult[]
}

type CellMeta = {
  label: string
  base: string
  voice_mechanism: string
  description: string
}

type ViewData = {
  generated_at: string
  experiment_id: number
  baseline: Style
  target_words: number
  cell_meta: Record<string, CellMeta>
  aggregate: Array<{
    cell: string
    n: number
    avg_words: number
    style: Style
    delta_sum: number
  }>
  briefs: BriefView[]
}

const CELL_COLORS: Record<string, string> = {
  "A-deepseek-bare": "#a8b5c4",
  "B-deepseek-primer": "#82c4a8",
  "C-salvatore-lora": "#c4a8e2",
  ground_truth: "#e8cc82",
}

function StyleRow({ label, value, baseline, unit = "" }: { label: string; value: number; baseline: number; unit?: string }) {
  const diff = value - baseline
  const color = Math.abs(diff) < 0.15 * Math.abs(baseline) ? "#7fc49a" : Math.abs(diff) > 0.5 * Math.abs(baseline) ? "#e28482" : "#d4c682"
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "2px 0" }}>
      <span style={{ color: "#999" }}>{label}</span>
      <span>
        <span style={{ color, fontVariantNumeric: "tabular-nums" }}>{value.toFixed(2)}{unit}</span>
        <span style={{ color: "#666", marginLeft: 8, fontSize: "0.72rem" }}>
          ({diff >= 0 ? "+" : ""}{diff.toFixed(2)})
        </span>
      </span>
    </div>
  )
}

function AdherencePanel({ cell, targetChars }: { cell: CellResult; targetChars: string[] }) {
  const missing = cell.adherence.characters.filter(c => !c.mentioned)
  const wordOk = Math.abs(cell.adherence.wordPctOff) <= 25
  return (
    <div style={{ marginTop: 10, padding: "8px 10px", background: "#1c2030", borderRadius: 6, fontSize: "0.78rem" }}>
      <div style={{ color: "#aaa", fontWeight: 600, marginBottom: 4, fontSize: "0.72rem", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        Beat adherence (deterministic)
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", margin: "3px 0" }}>
        <span>Word count</span>
        <span style={{ color: wordOk ? "#7fc49a" : "#e28482" }}>
          {cell.recon_words}w vs ~{cell.target_words}w ({cell.adherence.wordPctOff >= 0 ? "+" : ""}{cell.adherence.wordPctOff}%)
        </span>
      </div>
      {targetChars.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", margin: "3px 0" }}>
          <span>Characters present</span>
          <span style={{ color: missing.length === 0 ? "#7fc49a" : "#e28482" }}>
            {cell.adherence.characters.length - missing.length}/{cell.adherence.characters.length}
            {missing.length > 0 && (
              <span style={{ color: "#e28482", marginLeft: 6, fontSize: "0.72rem" }}>
                missing: {missing.map(m => m.name).join(", ")}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

function ProseCard({
  title,
  subtitle,
  prose,
  words,
  color,
  style,
  baseline,
  deltaSum,
  adherence,
  cell,
  targetChars,
}: {
  title: string
  subtitle?: string
  prose: string
  words: number
  color: string
  style?: Style
  baseline?: Style
  deltaSum?: number
  adherence?: boolean
  cell?: CellResult
  targetChars?: string[]
}) {
  return (
    <div
      style={{
        background: "#14171f",
        border: `1px solid ${color}33`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 0,
      }}
    >
      <div>
        <div style={{ fontWeight: 600, color, fontSize: "0.88rem", letterSpacing: "0.02em" }}>{title}</div>
        {subtitle && <div style={{ fontSize: "0.72rem", color: "#888", marginTop: 2 }}>{subtitle}</div>}
        <div style={{ fontSize: "0.72rem", color: "#666", marginTop: 3 }}>
          {words} words{deltaSum !== undefined && ` · Δ-sum ${deltaSum.toFixed(2)}`}
        </div>
      </div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, color: "#d8d8d8", fontSize: "0.88rem" }}>{prose}</div>
      {style && baseline && (
        <div style={{ borderTop: "1px solid #2a2e3c", paddingTop: 8 }}>
          <StyleRow label="avg sentence (w)" value={style.avg_sentence_words} baseline={baseline.avg_sentence_words} />
          <StyleRow label="dialogue ratio" value={style.dialogue_ratio} baseline={baseline.dialogue_ratio} />
          <StyleRow label="clause complexity" value={style.clause_complexity} baseline={baseline.clause_complexity} />
          <StyleRow label="sensory density" value={style.sensory_density} baseline={baseline.sensory_density} />
        </div>
      )}
      {adherence && cell && targetChars && <AdherencePanel cell={cell} targetChars={targetChars} />}
    </div>
  )
}

function BriefBlock({ brief, targetWords }: { brief: Brief; targetWords: number }) {
  const rows: Array<[string, string | undefined]> = [
    ["Kind", brief.kind],
    ["Characters", (brief.characters ?? []).join(", ") || "(none)"],
    ["POV", brief.pov],
    ["Setting", brief.setting],
    ["Tone", brief.tone],
    ["Transition in", brief.transition_in],
    ["Boundary signal", brief.boundary_signal],
    ["Target words", `~${targetWords}`],
  ]
  return (
    <div style={{ background: "#10131b", border: "1px solid #2a2e3c", borderRadius: 8, padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ fontSize: "0.72rem", color: "#888", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        Brief · {brief.beat_id}
      </div>
      <div style={{ color: "#d8d8d8", fontSize: "0.92rem", lineHeight: 1.5, marginBottom: 10, fontStyle: "italic" }}>
        "{brief.summary}"
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "6px 18px",
          fontSize: "0.78rem",
        }}
      >
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 6 }}>
            <span style={{ color: "#888", minWidth: 100 }}>{k}</span>
            <span style={{ color: "#c8c8c8" }}>{v || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AggregateTable({ data }: { data: ViewData }) {
  return (
    <div style={{ background: "#10131b", border: "1px solid #2a2e3c", borderRadius: 8, padding: 16, marginBottom: 20 }}>
      <div style={{ fontSize: "0.72rem", color: "#888", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
        Aggregate — 4 briefs · 120w target · baseline = Salvatore 777-beat corpus
      </div>
      <table className="guide-table" style={{ width: "100%", fontSize: "0.85rem" }}>
        <thead>
          <tr>
            <th>Cell</th>
            <th>base</th>
            <th>voice mechanism</th>
            <th style={{ textAlign: "right" }}>avg sent</th>
            <th style={{ textAlign: "right" }}>dial</th>
            <th style={{ textAlign: "right" }}>clause</th>
            <th style={{ textAlign: "right" }}>sens</th>
            <th style={{ textAlign: "right" }}>Δ-sum</th>
          </tr>
        </thead>
        <tbody>
          {data.aggregate.map(a => {
            const meta = data.cell_meta[a.cell]
            return (
              <tr key={a.cell}>
                <td>
                  <span style={{ color: CELL_COLORS[a.cell], fontWeight: 600 }}>{meta?.label}</span>
                </td>
                <td style={{ color: "#aaa", fontSize: "0.78rem" }}>{meta?.base}</td>
                <td style={{ color: "#aaa", fontSize: "0.78rem" }}>{meta?.voice_mechanism}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.style.avg_sentence_words.toFixed(1)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.style.dialogue_ratio.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.style.clause_complexity.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.style.sensory_density.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: CELL_COLORS[a.cell] }}>
                  {a.delta_sum.toFixed(2)}
                </td>
              </tr>
            )
          })}
          <tr style={{ borderTop: "1px dashed #3a3e4c", color: "#888" }}>
            <td colSpan={3} style={{ fontStyle: "italic", color: "#888" }}>Salvatore baseline (target)</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{data.baseline.avg_sentence_words.toFixed(1)}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{data.baseline.dialogue_ratio.toFixed(2)}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{data.baseline.clause_complexity.toFixed(2)}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{data.baseline.sensory_density.toFixed(2)}</td>
            <td style={{ textAlign: "right", color: "#888" }}>0.00</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function VoiceComparePage() {
  const [data, setData] = useState<ViewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)

  useEffect(() => {
    fetch("/phase-c2-view.json")
      .then(r => {
        if (!r.ok) throw new Error(`fetch ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch(e => setError(String(e)))
  }, [])

  if (error) return <div style={{ padding: 40, color: "#e28482" }}>Failed to load: {error}</div>
  if (!data) return <div style={{ padding: 40, color: "#888" }}>Loading Phase C.2 comparison…</div>

  const current = data.briefs[selectedIdx]
  const targetChars = current.brief.characters ?? []

  return (
    <div style={{ padding: "0 4px" }}>
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 4 }}>Voice imprinting — capability vs tuning (exp #193)</h2>
        <p style={{ color: "#aaa", fontSize: "0.9rem", maxWidth: 780, lineHeight: 1.55 }}>
          Three generation cells on the same Salvatore beat briefs. The numbers tell you whether rhythm transferred;
          the prose tells you whether the writing is good and whether the beat was enacted. Δ-sum scores sentence length,
          dialogue ratio, clause complexity, and sensory density against the 777-beat Salvatore corpus baseline — it
          measures <em>rhythm</em>, not <em>prose quality</em>. Read the prose to judge quality.
        </p>
      </section>

      <AggregateTable data={data} />

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: "0.72rem", color: "#888", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Pick a beat
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {data.briefs.map((b, i) => (
              <button
                key={b.beat_id}
                onClick={() => setSelectedIdx(i)}
                className={selectedIdx === i ? "active" : ""}
                style={{
                  padding: "5px 10px",
                  fontSize: "0.78rem",
                  borderRadius: 5,
                  border: "1px solid #2a2e3c",
                  background: selectedIdx === i ? "#2a2e3c" : "#14171f",
                  color: selectedIdx === i ? "#e8e8e8" : "#999",
                  cursor: "pointer",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {b.brief.kind} · {b.beat_id.split("-").slice(-2).join("-")}
              </button>
            ))}
          </div>
        </div>

        <BriefBlock brief={current.brief} targetWords={data.target_words} />

        <div style={{ marginBottom: 14 }}>
          <ProseCard
            title="Ground truth · Salvatore 1988"
            subtitle="The real passage the brief was extracted from"
            prose={current.ground_truth.prose}
            words={current.ground_truth.words}
            color={CELL_COLORS.ground_truth}
            style={current.ground_truth.style}
            baseline={data.baseline}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {current.cells.map(c => {
            const meta = data.cell_meta[c.cell]
            return (
              <ProseCard
                key={c.cell}
                title={meta.label}
                subtitle={`${meta.base} · ${meta.voice_mechanism}`}
                prose={c.prose}
                words={c.recon_words}
                color={CELL_COLORS[c.cell]}
                style={c.style}
                baseline={data.baseline}
                deltaSum={c.delta_sum}
                adherence
                cell={c}
                targetChars={targetChars}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}
