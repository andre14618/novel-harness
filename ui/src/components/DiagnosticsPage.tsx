import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  listSemanticGateBaselines,
  listSemanticGateCohortMatrices,
  listSemanticGateMatrices,
  type SemanticGateBaselineRunSummary,
  type SemanticGateCohortMatrixRunSummary,
  type SemanticGateMatrixRunSummary,
} from "../api"

export function DiagnosticsPage() {
  const [baselines, setBaselines] = useState<SemanticGateBaselineRunSummary[]>([])
  const [cohorts, setCohorts] = useState<SemanticGateCohortMatrixRunSummary[]>([])
  const [matrices, setMatrices] = useState<SemanticGateMatrixRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [surfaceErrors, setSurfaceErrors] = useState<{ baselines?: string; matrices?: string; cohorts?: string }>({})

  const load = async () => {
    setLoading(true)
    setSurfaceErrors({})

    const [baselineResult, matrixResult, cohortResult] = await Promise.allSettled([
      listSemanticGateBaselines(5),
      listSemanticGateMatrices(5),
      listSemanticGateCohortMatrices(5),
    ])

    const nextErrors: { baselines?: string; matrices?: string; cohorts?: string } = {}
    if (baselineResult.status === "fulfilled") {
      setBaselines(baselineResult.value.runs)
    } else {
      nextErrors.baselines = errorMessage(baselineResult.reason)
    }
    if (matrixResult.status === "fulfilled") {
      setMatrices(matrixResult.value.runs)
    } else {
      nextErrors.matrices = errorMessage(matrixResult.reason)
    }
    if (cohortResult.status === "fulfilled") {
      setCohorts(cohortResult.value.runs)
    } else {
      nextErrors.cohorts = errorMessage(cohortResult.reason)
    }

    setSurfaceErrors(nextErrors)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="semantic-gate-matrix-page diagnostics-page">
      <div className="planning-studio-header">
        <div>
          <h2>Diagnostics</h2>
          <div className="planning-studio-subtitle">Replay evidence, semantic gates, and browser-cleared artifact viewers</div>
        </div>
        <button className="chapter-health-refresh" type="button" onClick={load} disabled={loading}>
          {loading ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {loading && baselines.length === 0 && matrices.length === 0 && cohorts.length === 0 && <div className="planning-muted">Loading diagnostics...</div>}

      <div className="diagnostics-surface-grid">
        <section className="semantic-gate-matrix-card">
          <div className="diagnostics-surface-head">
            <div>
              <div className="semantic-gate-matrix-variant-title">Semantic Gate Baselines</div>
              <div className="semantic-gate-matrix-ranking-meta">One-arm disposable replay diagnostics</div>
            </div>
            <Link className="chapter-health-refresh semantic-gate-matrix-link-button" to="/semantic-gate-baseline">
              Open
            </Link>
          </div>
          <div className="semantic-gate-matrix-detail-list">
            {surfaceErrors.baselines && <div className="planning-error">Baselines unavailable: {surfaceErrors.baselines}</div>}
            {baselines.length === 0 && !loading && !surfaceErrors.baselines && <div className="planning-muted">No baseline runs found.</div>}
            {baselines.map(run => (
              <Link key={run.runId} className="diagnostics-run-row" to={`/semantic-gate-baseline/${encodeURIComponent(run.runId)}`}>
                <span className={`semantic-gate-matrix-status ${terminalTone(run.terminalStatus)}`}>{run.terminalStatus ?? "unknown"}</span>
                <strong>{run.sourceNovelId ?? "unknown source"}</strong>
                <code>{run.runId}</code>
                <span>{formatApproved(run.approvedChapters, run.chapters)} approved - {formatCost(run.costUsd)}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="semantic-gate-matrix-card">
          <div className="diagnostics-surface-head">
            <div>
              <div className="semantic-gate-matrix-variant-title">Semantic Gate Matrices</div>
              <div className="semantic-gate-matrix-ranking-meta">Side-by-side replay comparisons</div>
            </div>
            <Link className="chapter-health-refresh semantic-gate-matrix-link-button" to="/semantic-gate-matrix">
              Open
            </Link>
          </div>
          <div className="semantic-gate-matrix-detail-list">
            {surfaceErrors.matrices && <div className="planning-error">Matrices unavailable: {surfaceErrors.matrices}</div>}
            {matrices.length === 0 && !loading && !surfaceErrors.matrices && <div className="planning-muted">No matrix runs found.</div>}
            {matrices.map(run => (
              <Link key={run.runId} className="diagnostics-run-row" to={`/semantic-gate-matrix/${encodeURIComponent(run.runId)}`}>
                <span className={`semantic-gate-matrix-status ${(run.failed ?? 0) > 0 ? "bad" : "good"}`}>
                  {(run.failed ?? 0) > 0 ? "failed" : "recorded"}
                </span>
                <strong>{run.sourceNovelId ?? "unknown source"}</strong>
                <code>{run.runId}</code>
                <span>{run.topVariantLabel ?? "no ranking"} - risk {formatNumber(run.topRiskScore)}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="semantic-gate-matrix-card">
          <div className="diagnostics-surface-head">
            <div>
              <div className="semantic-gate-matrix-variant-title">Semantic Gate Cohorts</div>
              <div className="semantic-gate-matrix-ranking-meta">Multi-source replay comparisons</div>
            </div>
            <Link className="chapter-health-refresh semantic-gate-matrix-link-button" to="/semantic-gate-cohort-matrix">
              Open
            </Link>
          </div>
          <div className="semantic-gate-matrix-detail-list">
            {surfaceErrors.cohorts && <div className="planning-error">Cohorts unavailable: {surfaceErrors.cohorts}</div>}
            {cohorts.length === 0 && !loading && !surfaceErrors.cohorts && <div className="planning-muted">No cohort runs found.</div>}
            {cohorts.map(run => (
              <Link key={run.runId} className="diagnostics-run-row" to={`/semantic-gate-cohort-matrix/${encodeURIComponent(run.runId)}`}>
                <span className={`semantic-gate-matrix-status ${(run.failedMatrices ?? 0) > 0 ? "bad" : "good"}`}>
                  {(run.failedMatrices ?? 0) > 0 ? "failed" : "recorded"}
                </span>
                <strong>{run.topVariantLabel ?? "no ranking"}</strong>
                <code>{run.runId}</code>
                <span>{formatApproved(run.completedVariantRuns, run.variantRuns)} variants - mean risk {formatNumber(run.topMeanRiskScore)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function terminalTone(status: string | null): string {
  if (status === "completed") return "good"
  if (status === "process-exit") return "bad"
  return "warn"
}

function formatApproved(approved: number | null, chapters: number | null): string {
  return `${approved ?? "n/a"}/${chapters ?? "n/a"}`
}

function formatCost(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(4)}`
}

function formatNumber(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
