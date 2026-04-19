import { useEffect, useState } from "react"
import { getNovelRevisions, type RevisionRow, type RevisionStats, type RevisionOutcome } from "../api"

const OUTCOME_COLORS: Record<RevisionOutcome, string> = {
  accepted: "#4c7",
  rejected_beat_floor: "#d65",
  rejected_new_characters: "#d65",
  error: "#c95",
  skip_already_revised: "#888",
  skip_duplicate_sig: "#888",
  skip_no_beat_state: "#888",
}

const OUTCOME_LABELS: Record<RevisionOutcome, string> = {
  accepted: "accepted",
  rejected_beat_floor: "rejected (beat floor)",
  rejected_new_characters: "rejected (new chars)",
  error: "error",
  skip_already_revised: "skip (already revised)",
  skip_duplicate_sig: "skip (dup signature)",
  skip_no_beat_state: "skip (no beat state)",
}

function OutcomePill({ outcome }: { outcome: RevisionOutcome }) {
  return (
    <span style={{
      padding: "1px 6px", borderRadius: 3,
      background: OUTCOME_COLORS[outcome], color: "#111",
      fontSize: "0.72rem",
    }}>
      {OUTCOME_LABELS[outcome]}
    </span>
  )
}

export function RevisionsPanel({ novelId }: { novelId: string }) {
  const [data, setData] = useState<{ stats: RevisionStats; rows: RevisionRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    getNovelRevisions(novelId).then(setData).catch(e => setError(String(e)))
  }, [novelId])

  if (error) {
    return (
      <div style={{ marginTop: 14, padding: 10, border: "1px solid #2a2e3c", borderRadius: 6, background: "#1a1d28", color: "#c95", fontSize: "0.82rem" }}>
        Failed to load revisions: {error}
      </div>
    )
  }
  if (!data) return null // Still loading

  const { stats, rows } = data

  if (stats.total === 0) {
    return (
      <div style={{ marginTop: 14, padding: 10, border: "1px solid #2a2e3c", borderRadius: 6, background: "#1a1d28", color: "#888", fontSize: "0.82rem" }}>
        Plan revisions: <strong style={{ color: "#aaa" }}>none</strong> — chapter-plan-checker has not escalated to the reviser for any chapter in this novel.
      </div>
    )
  }
  const acceptPct = stats.acceptanceRate != null ? `${(stats.acceptanceRate * 100).toFixed(0)}%` : "—"

  return (
    <div style={{
      marginTop: 14,
      padding: 12,
      border: "1px solid #2a2e3c",
      borderRadius: 6,
      background: "#1a1d28",
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#dce" }}>
          {expanded ? "▾" : "▸"} Plan revisions
        </span>
        <span style={{ color: "#888", fontSize: "0.82rem" }}>
          {stats.invocations} invocation{stats.invocations !== 1 ? "s" : ""}
          {" · "}
          {stats.accepted} accepted ({acceptPct})
          {stats.total > stats.invocations && ` · ${stats.total - stats.invocations} skip${stats.total - stats.invocations !== 1 ? "s" : ""}`}
          {" · "}
          ch {stats.affectedChapters.join(", ")}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: 10 }}>
          <table className="guide-table" style={{ fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th>Ch</th>
                <th>Attempt</th>
                <th>Outcome</th>
                <th>Beats before → after</th>
                <th>Issues</th>
                <th>Reason / signature</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.chapter}</td>
                  <td style={{ color: "#aaa" }}>{r.attempt}</td>
                  <td><OutcomePill outcome={r.outcome} /></td>
                  <td style={{ color: "#aaa" }}>
                    {r.originalBeatCount}
                    {r.revisedBeatCount != null ? ` → ${r.revisedBeatCount}` : ""}
                  </td>
                  <td style={{ color: "#aaa" }}>{r.issueCount}</td>
                  <td style={{ color: "#888", fontSize: "0.76rem", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.rejectionReason ?? r.issueSig}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
