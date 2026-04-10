import { useEffect, useState } from "react"

interface CostRow {
  agent?: string
  provider?: string
  model?: string
  phase?: string
  novel_id?: string
  total_chapters?: number
  day?: string
  calls: number
  total_cost: number
  total_in: number
  total_out: number
  avg_in?: number
  avg_out?: number
  avg_latency_ms?: number
}

interface CostData {
  totals: { calls: number; totalCost: number; totalIn: number; totalOut: number }
  byAgent: CostRow[]
  byProvider: CostRow[]
  byPhase: CostRow[]
  byNovel: CostRow[]
  daily: CostRow[]
}

type Tab = "agent" | "provider" | "phase" | "novel" | "daily"

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function costColor(cost: number, max: number): string {
  const ratio = max > 0 ? cost / max : 0
  if (ratio > 0.5) return "var(--red-dim)"
  if (ratio > 0.2) return "var(--yellow-dim)"
  return "var(--accent)"
}

function CostBar({ cost, max }: { cost: number; max: number }) {
  const pct = max > 0 ? Math.min((cost / max) * 100, 100) : 0
  return (
    <div style={{ width: 80, height: 6, background: "var(--bg-inset)", borderRadius: 3, display: "inline-block", verticalAlign: "middle", marginLeft: 8 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: costColor(cost, max), borderRadius: 3, transition: "width 0.3s" }} />
    </div>
  )
}

export function CostsPage() {
  const [data, setData] = useState<CostData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("agent")

  useEffect(() => {
    fetch("/api/novel/costs", { credentials: "same-origin" })
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(String(e)))
  }, [])

  if (error) return <div className="page-body" style={{ color: "var(--red-dim)" }}>Error: {error}</div>
  if (!data) return <div className="page-body" style={{ color: "var(--text-secondary)" }}>Loading...</div>

  const tabs: { key: Tab; label: string }[] = [
    { key: "agent", label: "By Agent" },
    { key: "provider", label: "By Provider" },
    { key: "phase", label: "By Phase" },
    { key: "novel", label: "By Novel" },
    { key: "daily", label: "Daily" },
  ]

  return (
    <div className="page-body">
      {/* Totals banner */}
      <div style={{ display: "flex", gap: 32, padding: "16px 0", borderBottom: "1px solid var(--border-subtle)", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Spend</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--accent)" }}>${data.totals.totalCost.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Calls</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(data.totals.calls)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Input Tokens</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(data.totals.totalIn)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Output Tokens</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text-primary)" }}>{fmt(data.totals.totalOut)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Avg $/Call</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--text-primary)" }}>
            ${data.totals.calls > 0 ? (data.totals.totalCost / data.totals.calls).toFixed(5) : "0"}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "6px 14px",
              fontSize: "0.75rem",
              fontWeight: tab === t.key ? 600 : 400,
              background: tab === t.key ? "var(--accent-glow)" : "transparent",
              color: tab === t.key ? "var(--accent)" : "var(--text-secondary)",
              border: `1px solid ${tab === t.key ? "var(--accent-dim)" : "var(--border-subtle)"}`,
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {tab === "agent" && <AgentTable rows={data.byAgent} />}
      {tab === "provider" && <ProviderTable rows={data.byProvider} />}
      {tab === "phase" && <PhaseTable rows={data.byPhase} />}
      {tab === "novel" && <NovelTable rows={data.byNovel} />}
      {tab === "daily" && <DailyTable rows={data.daily} />}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "8px 12px", fontSize: "0.68rem", color: "var(--text-tertiary)",
  textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid var(--border-default)",
}
const thRight: React.CSSProperties = { ...thStyle, textAlign: "right" }
const tdStyle: React.CSSProperties = { padding: "6px 12px", fontSize: "0.78rem", color: "var(--text-primary)", borderBottom: "1px solid var(--border-subtle)" }
const tdRight: React.CSSProperties = { ...tdStyle, textAlign: "right", fontFamily: "monospace" }
const tdMoney: React.CSSProperties = { ...tdRight, color: "var(--accent)" }

function AgentTable({ rows }: { rows: CostRow[] }) {
  const max = Math.max(...rows.map(r => r.total_cost), 0.001)
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>
        <th style={thStyle}>Agent</th>
        <th style={thRight}>Calls</th>
        <th style={thRight}>Cost</th>
        <th style={thStyle}>Share</th>
        <th style={thRight}>Avg In</th>
        <th style={thRight}>Avg Out</th>
        <th style={thRight}>Avg Latency</th>
        <th style={thRight}>$/Call</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.agent}>
            <td style={tdStyle}>{r.agent}</td>
            <td style={tdRight}>{fmt(r.calls)}</td>
            <td style={tdMoney}>${r.total_cost.toFixed(4)}<CostBar cost={r.total_cost} max={max} /></td>
            <td style={tdRight}>{rows.length > 0 ? Math.round((r.total_cost / rows.reduce((s, x) => s + x.total_cost, 0)) * 100) : 0}%</td>
            <td style={tdRight}>{fmt(r.avg_in ?? 0)}</td>
            <td style={tdRight}>{fmt(r.avg_out ?? 0)}</td>
            <td style={tdRight}>{r.avg_latency_ms ? `${r.avg_latency_ms}ms` : "—"}</td>
            <td style={tdRight}>${r.calls > 0 ? (r.total_cost / r.calls).toFixed(5) : "0"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ProviderTable({ rows }: { rows: CostRow[] }) {
  const max = Math.max(...rows.map(r => r.total_cost), 0.001)
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>
        <th style={thStyle}>Provider</th>
        <th style={thStyle}>Model</th>
        <th style={thRight}>Calls</th>
        <th style={thRight}>Cost</th>
        <th style={thStyle}>Share</th>
        <th style={thRight}>Input Tokens</th>
        <th style={thRight}>Output Tokens</th>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={tdStyle}>{r.provider}</td>
            <td style={{ ...tdStyle, fontSize: "0.72rem", color: "var(--text-secondary)" }}>{r.model}</td>
            <td style={tdRight}>{fmt(r.calls)}</td>
            <td style={tdMoney}>${r.total_cost.toFixed(4)}<CostBar cost={r.total_cost} max={max} /></td>
            <td style={tdRight}>{rows.length > 0 ? Math.round((r.total_cost / rows.reduce((s, x) => s + x.total_cost, 0)) * 100) : 0}%</td>
            <td style={tdRight}>{fmt(r.total_in)}</td>
            <td style={tdRight}>{fmt(r.total_out)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PhaseTable({ rows }: { rows: CostRow[] }) {
  const max = Math.max(...rows.map(r => r.total_cost), 0.001)
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>
        <th style={thStyle}>Phase</th>
        <th style={thRight}>Calls</th>
        <th style={thRight}>Cost</th>
        <th style={thStyle}>Share</th>
        <th style={thRight}>Input Tokens</th>
        <th style={thRight}>Output Tokens</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.phase}>
            <td style={tdStyle}>{r.phase}</td>
            <td style={tdRight}>{fmt(r.calls)}</td>
            <td style={tdMoney}>${r.total_cost.toFixed(4)}<CostBar cost={r.total_cost} max={max} /></td>
            <td style={tdRight}>{rows.length > 0 ? Math.round((r.total_cost / rows.reduce((s, x) => s + x.total_cost, 0)) * 100) : 0}%</td>
            <td style={tdRight}>{fmt(r.total_in)}</td>
            <td style={tdRight}>{fmt(r.total_out)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NovelTable({ rows }: { rows: CostRow[] }) {
  const max = Math.max(...rows.map(r => r.total_cost), 0.001)
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>
        <th style={thStyle}>Novel ID</th>
        <th style={thRight}>Chapters</th>
        <th style={thRight}>Calls</th>
        <th style={thRight}>Cost</th>
        <th style={thStyle}>Share</th>
        <th style={thRight}>$/Chapter</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.novel_id}>
            <td style={{ ...tdStyle, fontSize: "0.72rem", fontFamily: "monospace" }}>{r.novel_id}</td>
            <td style={tdRight}>{r.total_chapters ?? "?"}</td>
            <td style={tdRight}>{fmt(r.calls)}</td>
            <td style={tdMoney}>${r.total_cost.toFixed(4)}<CostBar cost={r.total_cost} max={max} /></td>
            <td style={tdRight}>{rows.length > 0 ? Math.round((r.total_cost / rows.reduce((s, x) => s + x.total_cost, 0)) * 100) : 0}%</td>
            <td style={tdRight}>${r.total_chapters ? (r.total_cost / r.total_chapters).toFixed(4) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DailyTable({ rows }: { rows: CostRow[] }) {
  const max = Math.max(...rows.map(r => r.total_cost), 0.001)
  let cumulative = 0
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>
        <th style={thStyle}>Date</th>
        <th style={thRight}>Calls</th>
        <th style={thRight}>Cost</th>
        <th style={thStyle}>Share</th>
        <th style={thRight}>Cumulative</th>
        <th style={thRight}>Input Tokens</th>
        <th style={thRight}>Output Tokens</th>
      </tr></thead>
      <tbody>
        {rows.map(r => {
          cumulative += r.total_cost
          return (
            <tr key={r.day}>
              <td style={tdStyle}>{r.day}</td>
              <td style={tdRight}>{fmt(r.calls)}</td>
              <td style={tdMoney}>${r.total_cost.toFixed(4)}<CostBar cost={r.total_cost} max={max} /></td>
              <td style={tdRight}>{rows.length > 0 ? Math.round((r.total_cost / rows.reduce((s, x) => s + x.total_cost, 0)) * 100) : 0}%</td>
              <td style={{ ...tdRight, color: "var(--accent-dim)" }}>${cumulative.toFixed(4)}</td>
              <td style={tdRight}>{fmt(r.total_in)}</td>
              <td style={tdRight}>{fmt(r.total_out)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
