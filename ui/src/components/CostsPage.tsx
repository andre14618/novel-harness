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

type Tab = "agent" | "provider" | "phase" | "novel" | "daily" | "gpu"

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
    { key: "gpu", label: "GPU Comparison" },
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
      {tab === "gpu" && <GpuComparison totals={data.totals} providers={data.byProvider} />}
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

function GpuComparison({ totals, providers }: { totals: CostData["totals"]; providers: CostRow[] }) {
  const totalNovels = 20 // benchmark dataset size
  const perNovel = totals.totalCost / totalNovels

  const scenarios = [
    { name: "API (current)", desc: "Cerebras + W&B + Groq + MiMo", cost20: totals.totalCost, perNovelCost: perNovel, wallClock10ch: "~5 min", quality: "235B writing" },
    { name: "H100 + L40S", desc: "70B FP16 writing + 14B checkers", cost20: 12.56, perNovelCost: 0.63, wallClock10ch: "~14 min", quality: "70B (lower)" },
    { name: "Single A100 70B Q4", desc: "Everything on one GPU", cost20: 16.58, perNovelCost: 0.83, wallClock10ch: "~21 min", quality: "70B Q4 (lower)" },
    { name: "2x H100 235B parity", desc: "Full model parity", cost20: 63.60, perNovelCost: 3.18, wallClock10ch: "~12 min", quality: "235B (parity)" },
    { name: "L40S only (14B)", desc: "Cheapest GPU option", cost20: 5.00, perNovelCost: 0.25, wallClock10ch: "~18 min", quality: "14B (much lower)" },
    { name: "Spot instances", desc: "H100 + L40S at 50% off", cost20: 6.28, perNovelCost: 0.31, wallClock10ch: "~14 min", quality: "70B (lower)" },
  ]

  const gpuPricing = [
    { gpu: "H100 80GB SXM", vram: "80 GB", runpod: "$2.69/hr", lambda: "$2.89/hr", perSec: "$0.00075" },
    { gpu: "A100 80GB SXM", vram: "80 GB", runpod: "$1.39/hr", lambda: "$1.29/hr", perSec: "$0.00036" },
    { gpu: "A100 80GB PCIe", vram: "80 GB", runpod: "$1.19/hr", lambda: "--", perSec: "$0.00033" },
    { gpu: "L40S 48GB", vram: "48 GB", runpod: "$0.79/hr", lambda: "--", perSec: "$0.00022" },
  ]

  const tpsData = [
    { gpu: "H100 80GB", model: "70B FP16", prefill: "~5,000", gen: "60-80", fit: "Yes" },
    { gpu: "A100 80GB", model: "70B Q4", prefill: "~2,500", gen: "30-50", fit: "Yes (tight)" },
    { gpu: "A100 80GB", model: "14B FP16", prefill: "~8,000", gen: "80-120", fit: "Yes" },
    { gpu: "L40S 48GB", model: "14B FP16", prefill: "~5,000", gen: "60-90", fit: "Yes" },
    { gpu: "2x H100", model: "235B MoE", prefill: "~3,000", gen: "30-50", fit: "Yes" },
  ]

  const sectionStyle: React.CSSProperties = { marginBottom: 32 }
  const headingStyle: React.CSSProperties = { fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }
  const subStyle: React.CSSProperties = { fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }
  const noteStyle: React.CSSProperties = { fontSize: "0.72rem", color: "var(--text-tertiary)", marginTop: 8, fontStyle: "italic" }

  return (
    <div>
      {/* Summary callout */}
      <div style={{ background: "var(--bg-inset)", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: 16, marginBottom: 24 }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--accent)", marginBottom: 8 }}>
          GPU Rental vs API: Per-Second Analysis
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Based on {totalNovels} real novels ({fmt(totals.calls)} calls, {fmt(totals.totalIn + totals.totalOut)} tokens, ${totals.totalCost.toFixed(2)} total API cost).
          GPU rental is <strong style={{ color: "var(--red-dim)" }}>3-5x more expensive</strong> than the current multi-provider API setup.
          Break-even requires ~530 novels/day. The pipeline exploits specialized hardware (Cerebras wafer-scale, W&B shared LoRA fleet, Groq LPU)
          that generic rented GPUs cannot match on price.
        </div>
      </div>

      {/* Scenario comparison */}
      <div style={sectionStyle}>
        <div style={headingStyle}>Cost Scenarios ({totalNovels} Novels)</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={thStyle}>Scenario</th>
            <th style={thStyle}>Setup</th>
            <th style={thRight}>Cost ({totalNovels} novels)</th>
            <th style={thRight}>Per Novel</th>
            <th style={thRight}>vs API</th>
            <th style={thRight}>Wall Clock (10ch)</th>
            <th style={thStyle}>Writing Quality</th>
          </tr></thead>
          <tbody>
            {scenarios.map((s, i) => {
              const ratio = s.cost20 / totals.totalCost
              const isBaseline = i === 0
              return (
                <tr key={s.name} style={isBaseline ? { background: "var(--accent-glow)" } : undefined}>
                  <td style={{ ...tdStyle, fontWeight: isBaseline ? 600 : 400 }}>{s.name}</td>
                  <td style={{ ...tdStyle, fontSize: "0.72rem", color: "var(--text-secondary)" }}>{s.desc}</td>
                  <td style={tdMoney}>${s.cost20.toFixed(2)}</td>
                  <td style={tdRight}>${s.perNovelCost.toFixed(3)}</td>
                  <td style={{ ...tdRight, color: ratio > 1.1 ? "var(--red-dim)" : ratio < 0.9 ? "var(--green-dim)" : "var(--accent)" }}>
                    {isBaseline ? "baseline" : `${ratio.toFixed(1)}x`}
                  </td>
                  <td style={tdRight}>{s.wallClock10ch}</td>
                  <td style={{ ...tdStyle, fontSize: "0.72rem" }}>{s.quality}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* GPU Pricing */}
      <div style={sectionStyle}>
        <div style={headingStyle}>GPU Rental Rates (April 2026)</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={thStyle}>GPU</th>
            <th style={thRight}>VRAM</th>
            <th style={thRight}>RunPod</th>
            <th style={thRight}>Lambda</th>
            <th style={thRight}>$/second</th>
          </tr></thead>
          <tbody>
            {gpuPricing.map(g => (
              <tr key={g.gpu}>
                <td style={tdStyle}>{g.gpu}</td>
                <td style={tdRight}>{g.vram}</td>
                <td style={tdRight}>{g.runpod}</td>
                <td style={tdRight}>{g.lambda}</td>
                <td style={{ ...tdRight, fontFamily: "monospace" }}>{g.perSec}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* TPS estimates */}
      <div style={sectionStyle}>
        <div style={headingStyle}>Single-Request Generation Speed</div>
        <div style={subStyle}>Sequential call pattern (pipeline's actual access pattern). Batched throughput is 5-20x higher but doesn't apply to latency-sensitive pipeline calls.</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={thStyle}>GPU</th>
            <th style={thStyle}>Model</th>
            <th style={thRight}>Prefill (tok/s)</th>
            <th style={thRight}>Generation (tok/s)</th>
            <th style={thStyle}>Fits?</th>
          </tr></thead>
          <tbody>
            {tpsData.map((t, i) => (
              <tr key={i}>
                <td style={tdStyle}>{t.gpu}</td>
                <td style={tdStyle}>{t.model}</td>
                <td style={tdRight}>{t.prefill}</td>
                <td style={tdRight}>{t.gen}</td>
                <td style={tdStyle}>{t.fit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Why APIs win */}
      <div style={sectionStyle}>
        <div style={headingStyle}>Why API Providers Win at This Scale</div>
        <div style={subStyle}>
          The pipeline uses four specialized providers, each with purpose-built hardware:
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={thStyle}>Provider</th>
            <th style={thStyle}>Hardware</th>
            <th style={thStyle}>Advantage</th>
            <th style={thRight}>Share of Cost</th>
          </tr></thead>
          <tbody>
            {[
              { provider: "Cerebras", hw: "Wafer-scale engine", adv: "190 tok/s generation, $0.60/$1.20/1M. Custom silicon 3-10x faster than GPU.", share: "86.6%" },
              { provider: "W&B", hw: "CoreWeave shared fleet", adv: "Multi-tenant LoRA: $0.05/$0.22/1M. GPU cost shared across customers.", share: "1.9%" },
              { provider: "Groq", hw: "LPU (custom ASIC)", adv: "342ms reference resolver. Purpose-built for low-latency.", share: "5.0%" },
              { provider: "MiMo", hw: "Serverless", adv: "$0.07/$0.30/1M. Slow but fine for background extraction.", share: "6.6%" },
            ].map(p => (
              <tr key={p.provider}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{p.provider}</td>
                <td style={{ ...tdStyle, fontSize: "0.72rem" }}>{p.hw}</td>
                <td style={{ ...tdStyle, fontSize: "0.72rem", color: "var(--text-secondary)" }}>{p.adv}</td>
                <td style={tdRight}>{p.share}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={noteStyle}>
          A single rented GPU is a generalist competing against four specialists. GPU rental makes sense for batch jobs (SFT data gen, eval sweeps)
          where hourly rate beats per-token pricing, but not for per-novel pipeline execution at current volume.
        </div>
      </div>
    </div>
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
