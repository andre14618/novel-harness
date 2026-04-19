import { useEffect, useState } from "react"
import { getNovelExhaustions, type ExhaustionRow } from "../api"

const DECISION_COLORS: Record<string, string> = {
  "edit-plan": "#4c7",
  override: "#e9a74a",
  abort: "#d65",
  pending: "#888",
}

function DecisionPill({ decision }: { decision: string | null }) {
  const key = decision ?? "pending"
  return (
    <span style={{
      padding: "1px 6px",
      borderRadius: 3,
      background: DECISION_COLORS[key] ?? "#888",
      color: "#111",
      fontSize: "0.72rem",
    }}>
      {decision ?? "pending"}
    </span>
  )
}

function KindPill({ kind }: { kind: ExhaustionRow["kind"] }) {
  const background = kind === "plan-check-exhausted" ? "#5c7" : "#e9a74a"
  return (
    <span style={{
      padding: "1px 6px",
      borderRadius: 3,
      background,
      color: "#111",
      fontSize: "0.7rem",
    }}>
      {kind}
    </span>
  )
}

interface Props {
  novelId: string
  /** Bump to force a refetch — parent increments this on gate-resolution
   *  SSE events so the panel doesn't go stale mid-run. */
  refreshKey?: number | string
}

export function ExhaustionsPanel({ novelId, refreshKey }: Props) {
  const [rows, setRows] = useState<ExhaustionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    getNovelExhaustions(novelId)
      .then(r => setRows(r.exhaustions))
      .catch(e => setError(String(e)))
  }, [novelId, refreshKey, reloadTick])

  if (error) {
    return (
      <div style={{
        marginTop: 14, padding: 10, border: "1px solid #2a2e3c",
        borderRadius: 6, background: "#1a1d28", color: "#c95",
        fontSize: "0.82rem",
      }}>
        Failed to load exhaustions: {error}
      </div>
    )
  }
  if (rows == null) return null

  if (rows.length === 0) {
    return (
      <div style={{
        marginTop: 14, padding: 10, border: "1px solid #2a2e3c",
        borderRadius: 6, background: "#1a1d28", color: "#888",
        fontSize: "0.82rem",
      }}>
        Plan-assist gates: <strong style={{ color: "#aaa" }}>none</strong> — the drafting pipeline has not exhausted automated repair on any chapter of this novel.
      </div>
    )
  }

  const pending = rows.filter(r => r.decision == null).length
  const byDecision: Record<string, number> = {}
  for (const r of rows) {
    const k = r.decision ?? "pending"
    byDecision[k] = (byDecision[k] ?? 0) + 1
  }
  const chapters = [...new Set(rows.map(r => r.chapter))].sort((a, b) => a - b)

  return (
    <div style={{
      marginTop: 14, padding: 12, border: "1px solid #2a2e3c",
      borderRadius: 6, background: "#1a1d28",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div
          onClick={() => setExpanded(v => !v)}
          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1 }}
        >
          <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#dce" }}>
            {expanded ? "▾" : "▸"} Plan-assist gates
          </span>
          <span style={{ color: "#888", fontSize: "0.82rem" }}>
            {rows.length} fire{rows.length !== 1 ? "s" : ""}
            {pending > 0 && ` · ${pending} pending`}
            {Object.entries(byDecision)
              .filter(([k]) => k !== "pending")
              .map(([k, v]) => ` · ${v} ${k}`)
              .join("")}
            {" · ch "}{chapters.join(", ")}
          </span>
        </div>
        <button
          onClick={() => setReloadTick(t => t + 1)}
          className="secondary"
          style={{ padding: "2px 8px", fontSize: "0.72rem" }}
          title="Refresh"
        >↻</button>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, fontSize: "0.82rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#888", borderBottom: "1px solid #2a2e3c" }}>
                <th style={{ padding: "4px 6px" }}>ch/att</th>
                <th style={{ padding: "4px 6px" }}>kind</th>
                <th style={{ padding: "4px 6px" }}>mode</th>
                <th style={{ padding: "4px 6px" }}>issues</th>
                <th style={{ padding: "4px 6px" }}>decision</th>
                <th style={{ padding: "4px 6px" }}>fired → decided</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const waitMs = r.decidedAt ? new Date(r.decidedAt).getTime() - new Date(r.firedAt).getTime() : null
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid #222531" }}>
                    <td style={{ padding: "4px 6px", color: "#ccc" }}>
                      {r.chapter}/{r.attempt}
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <KindPill kind={r.kind} />
                    </td>
                    <td style={{ padding: "4px 6px", color: "#888" }}>{r.resolverMode}</td>
                    <td style={{ padding: "4px 6px", color: "#aaa", maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.unresolvedDeviations.map(d => d.description).slice(0, 3).join("; ")}
                      {r.unresolvedDeviations.length > 3 && ` (+${r.unresolvedDeviations.length - 3} more)`}
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <DecisionPill decision={r.decision} />
                    </td>
                    <td style={{ padding: "4px 6px", color: "#888", fontSize: "0.76rem" }}>
                      {new Date(r.firedAt).toLocaleTimeString()}
                      {waitMs != null && ` (+${Math.round(waitMs / 1000)}s)`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
