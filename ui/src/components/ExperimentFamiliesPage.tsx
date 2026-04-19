import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { listExperimentFamilies, type FamilySummary, type FamilyExperiment } from "../api"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return iso.slice(0, 10)
}

function statusBadge(e: FamilyExperiment): { label: string; color: string } {
  if (e.conclusion) return { label: "concluded", color: "#4c7" }
  if (e.status === "running" || e.status === "in_progress") return { label: e.status, color: "#6ae" }
  if (e.status === "failed") return { label: "failed", color: "#d65" }
  return { label: e.status ?? "pending", color: "#888" }
}

function FamilyCard({ family }: { family: FamilySummary }) {
  const [expanded, setExpanded] = useState(false)
  const { charter, charterSlug, runs, totalExperiments, concludedCount, latestAt } = family

  return (
    <div style={{
      border: "1px solid #2a2e3c",
      borderRadius: 8,
      padding: 16,
      marginBottom: 14,
      background: "#1a1d28",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: "1.05rem" }}>
          {charter && charterSlug ? (
            <Link to={`/charters?charter=${charterSlug}`} style={{ color: "#dce" }}>
              {family.family}
            </Link>
          ) : (
            <span style={{ color: "#dce" }}>{family.family}</span>
          )}
        </h3>
        <span style={{ color: "#888", fontSize: "0.82rem" }}>
          {totalExperiments} experiment{totalExperiments !== 1 ? "s" : ""}
          {" · "}
          {concludedCount} concluded
          {" · "}
          latest {formatDate(latestAt)}
        </span>
      </div>
      {charter ? (
        <p style={{ color: "#aaa", fontSize: "0.88rem", margin: "4px 0 10px" }}>
          <strong style={{ color: "#9ac" }}>charter #{charter.id}</strong> — {charter.description}
        </p>
      ) : (
        <p style={{ color: "#c95", fontSize: "0.82rem", margin: "4px 0 10px" }}>
          ⚠ No charter row for this family — runs exist but the charter is unseeded.
        </p>
      )}
      {runs.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: "transparent",
              border: "1px solid #2a2e3c",
              color: "#aaa",
              padding: "4px 10px",
              borderRadius: 4,
              fontSize: "0.78rem",
              cursor: "pointer",
            }}
          >
            {expanded ? "▾" : "▸"} {runs.length} run{runs.length !== 1 ? "s" : ""}
          </button>
          {expanded && (
            <table className="guide-table" style={{ marginTop: 10 }}>
              <thead>
                <tr><th>ID</th><th>Description</th><th>Status</th><th>When</th></tr>
              </thead>
              <tbody>
                {runs.map(r => {
                  const b = statusBadge(r)
                  return (
                    <tr key={r.id}>
                      <td style={{ color: "#9ac", fontFamily: "monospace" }}>#{r.id}</td>
                      <td>{r.description}</td>
                      <td>
                        <span style={{ padding: "1px 6px", borderRadius: 3, background: b.color, color: "#111", fontSize: "0.74rem" }}>
                          {b.label}
                        </span>
                      </td>
                      <td style={{ color: "#888", fontSize: "0.82rem" }}>{formatDate(r.timestamp)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

export function ExperimentFamiliesPage() {
  const [families, setFamilies] = useState<FamilySummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listExperimentFamilies().then(setFamilies).catch(e => setError(String(e)))
  }, [])

  if (error) return <p style={{ color: "var(--red)", padding: 32 }}>{error}</p>
  if (!families) return <p style={{ color: "var(--text-tertiary)", padding: 32 }}>Loading…</p>

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>Experiment families</h2>
        <p style={{ color: "#888", margin: 0, fontSize: "0.88rem" }}>
          Groups of tuning_experiments tied to a charter (<code>config.experiment_family</code>).
          Each card shows the charter row, downstream runs, and verdict counts.
        </p>
      </div>
      {families.length === 0 ? (
        <p style={{ color: "#888" }}>
          No families yet. Run <code>bun scripts/experiments/backfill-planner-phase2-charter.ts</code> to
          seed the first charter row.
        </p>
      ) : families.map(f => <FamilyCard key={f.family} family={f} />)}
    </div>
  )
}
