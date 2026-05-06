import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  getSemanticGateCohortMatrix,
  listSemanticGateCohortMatrices,
  type SemanticGateCohortMatrixReport,
  type SemanticGateCohortMatrixRun,
  type SemanticGateCohortMatrixRunSummary,
  type SemanticGateCohortRankingItem,
  type SemanticGateCohortVariantAggregate,
} from "../api"

export function SemanticGateCohortMatrixPage() {
  const { runId } = useParams<{ runId: string }>()
  const [report, setReport] = useState<SemanticGateCohortMatrixReport | null>(null)
  const [runs, setRuns] = useState<SemanticGateCohortMatrixRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      if (runId) {
        setRuns([])
        setReport(await getSemanticGateCohortMatrix(runId))
      } else {
        setReport(null)
        const response = await listSemanticGateCohortMatrices()
        setRuns(response.runs)
      }
    } catch (err) {
      setError((err as Error).message ?? String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const rankingByVariant = useMemo(() => {
    const map = new Map<string, number>()
    report?.ranking.forEach((item, index) => map.set(item.variantId, index + 1))
    return map
  }, [report])

  if (!runId) {
    return (
      <div className="semantic-gate-matrix-page">
        <div className="planning-studio-header">
          <div>
            <h2>Semantic Gate Cohort Matrix</h2>
            <div className="planning-studio-subtitle">Recent multi-source replay comparisons</div>
          </div>
          <div className="semantic-gate-matrix-header-actions">
            <Link className="chapter-health-refresh semantic-gate-matrix-link-button" to="/semantic-gate-matrix">
              Matrix Runs
            </Link>
            <button className="chapter-health-refresh" type="button" onClick={load} disabled={loading}>
              {loading ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </div>

        {error && <div className="planning-error">Failed to load semantic gate cohorts: {error}</div>}
        {loading && runs.length === 0 && <div className="planning-muted">Loading semantic gate cohorts...</div>}
        {!loading && !error && runs.length === 0 && <div className="planning-muted">No semantic gate cohort runs found.</div>}

        {runs.length > 0 && (
          <div className="semantic-gate-matrix-run-list" aria-label="recent semantic gate cohort runs">
            {runs.map(run => (
              <CohortRunSummaryCard key={run.runId} run={run} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="semantic-gate-matrix-page">
      <div className="planning-studio-header">
        <div>
          <h2>Semantic Gate Cohort Matrix</h2>
          <div className="planning-studio-subtitle">
            Run <code>{runId}</code>
            {report?.generatedAt && <> - generated {formatDate(report.generatedAt)}</>}
          </div>
        </div>
        <div className="semantic-gate-matrix-header-actions">
          <Link className="chapter-health-refresh semantic-gate-matrix-link-button" to="/semantic-gate-matrix">
            Matrix Runs
          </Link>
          <Link className="chapter-health-refresh semantic-gate-matrix-link-button" to="/semantic-gate-cohort-matrix">
            Cohort Runs
          </Link>
          <button className="chapter-health-refresh" type="button" onClick={load} disabled={loading}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="planning-error">Failed to load semantic gate cohort: {error}</div>}
      {loading && !report && <div className="planning-muted">Loading semantic gate cohort...</div>}

      {report && (
        <>
          <section className="semantic-gate-matrix-source">
            <div>
              <span>Chapters</span>
              <strong>{report.chapters}</strong>
            </div>
            <div>
              <span>Variants</span>
              <strong>{report.variantSpecs.length}</strong>
            </div>
            <div>
              <span>Matrix Runs</span>
              <strong>{report.totals.reportedMatrices}/{report.totals.matrixRuns}</strong>
            </div>
            <div className="semantic-gate-matrix-path">
              <span>Output</span>
              <code>{report.outputBase}</code>
            </div>
          </section>

          <div className="semantic-gate-matrix-totals" aria-label="semantic gate cohort totals">
            <SummaryCell label="Variant Runs" value={report.totals.variantRuns} />
            <SummaryCell label="Completed" value={report.totals.completedVariantRuns} tone="good" />
            <SummaryCell label="Clean Pass" value={report.totals.cleanPass} tone="good" />
            <SummaryCell label="Failed" value={report.totals.failedVariantRuns} tone={report.totals.failedVariantRuns > 0 ? "bad" : "good"} />
            <SummaryCell label="LLM Calls" value={report.totals.llmCalls} />
            <SummaryCell label="Cost" value={formatCost(report.totals.costUsd)} />
          </div>

          <section className="semantic-gate-matrix-ranking">
            <div className="semantic-gate-matrix-section-title">Ranking</div>
            <div className="semantic-gate-matrix-ranking-list">
              {report.ranking.map((item, index) => (
                <CohortRankingRow key={item.variantId} item={item} rank={index + 1} />
              ))}
            </div>
          </section>

          <div className="semantic-gate-matrix-variants">
            {report.variants.map(variant => (
              <CohortVariantCard
                key={variant.variantId}
                variant={variant}
                rank={rankingByVariant.get(variant.variantId)}
              />
            ))}
          </div>

          <section className="semantic-gate-matrix-card">
            <div className="semantic-gate-matrix-section-title">Matrix Runs</div>
            <div className="semantic-gate-matrix-detail-list">
              {report.runs.map(run => (
                <MatrixRunRow key={`${run.sourceNovelId}:${run.replicate ?? "summary"}:${run.summaryPath}`} run={run} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function CohortRunSummaryCard({ run }: { run: SemanticGateCohortMatrixRunSummary }) {
  const failed = run.failedMatrices ?? 0
  const reported = run.reportedMatrices ?? 0
  const matrixRuns = run.matrixRuns ?? 0
  const statusTone = failed > 0 ? "bad" : reported === matrixRuns && matrixRuns > 0 ? "good" : "warn"

  return (
    <Link className={`semantic-gate-matrix-run-card ${statusTone}`} to={`/semantic-gate-cohort-matrix/${encodeURIComponent(run.runId)}`}>
      <div className="semantic-gate-matrix-card-head">
        <div>
          <div className="semantic-gate-matrix-variant-title">Cohort Matrix</div>
          <div className="semantic-gate-matrix-variant-subtitle">
            <code>{run.runId}</code>
            {run.generatedAt && <span>{formatDate(run.generatedAt)}</span>}
          </div>
        </div>
        <span className={`semantic-gate-matrix-status ${statusTone}`}>
          {failed > 0 ? "failed" : "recorded"}
        </span>
      </div>
      <div className="semantic-gate-matrix-run-metrics">
        <Metric label="Matrices" value={`${reported}/${matrixRuns || "n/a"}`} tone={failed > 0 ? "bad" : "good"} />
        <Metric label="Variant Runs" value={formatNullableNumber(run.variantRuns)} />
        <Metric label="Completed" value={formatNullableNumber(run.completedVariantRuns)} tone={(run.completedVariantRuns ?? 0) > 0 ? "good" : undefined} />
        <Metric label="Clean Pass" value={formatNullableNumber(run.cleanPass)} tone={(run.cleanPass ?? 0) > 0 ? "good" : undefined} />
        <Metric label="Cost" value={run.costUsd === null ? "n/a" : formatCost(run.costUsd)} />
      </div>
      <div className="semantic-gate-matrix-run-top">
        <div className="semantic-gate-matrix-section-title">Top Ranked Variant</div>
        <div className="semantic-gate-matrix-ranking-main">
          <strong>{run.topVariantLabel ?? "n/a"}</strong>
          {run.topCompleted != null && run.topRuns != null && (
            <span className={`semantic-gate-matrix-status ${run.topCompleted === run.topRuns ? "good" : "warn"}`}>
              {run.topCompleted}/{run.topRuns} completed
            </span>
          )}
        </div>
        <div className="semantic-gate-matrix-ranking-meta">
          mean risk {formatNullableDecimal(run.topMeanRiskScore, 2)}
        </div>
        <StringChipList values={run.topRiskDrivers ?? []} emptyText="No risk drivers." compact />
        <ReasonList reasons={run.topReasons ?? []} limit={2} />
      </div>
      <div className="semantic-gate-matrix-run-path">
        <span>Summary</span>
        <code>{run.summaryPath}</code>
      </div>
    </Link>
  )
}

function CohortRankingRow({ item, rank }: { item: SemanticGateCohortRankingItem; rank: number }) {
  return (
    <div className="semantic-gate-matrix-ranking-row">
      <div className="semantic-gate-matrix-rank-number">{rank}</div>
      <div>
        <div className="semantic-gate-matrix-ranking-main">
          <strong>{item.label}</strong>
          <span className={`semantic-gate-matrix-status ${item.completed === item.runs ? "good" : "warn"}`}>
            {item.completed}/{item.runs} completed
          </span>
        </div>
        <div className="semantic-gate-matrix-ranking-meta">
          mean risk {formatNullableDecimal(item.meanRiskScore, 2)} - mean word ratio {formatRatio(item.meanWordRatio)} - {formatCost(item.totalCostUsd)}
        </div>
        <StringChipList values={item.topRiskDrivers ?? []} emptyText="No risk drivers." compact />
        <ReasonList reasons={item.topReasons} limit={3} />
      </div>
    </div>
  )
}

function CohortVariantCard({ variant, rank }: { variant: SemanticGateCohortVariantAggregate; rank?: number }) {
  const statusTone = variant.failed > 0 ? "bad" : variant.completed === variant.runs ? "good" : "warn"

  return (
    <section className={`semantic-gate-matrix-card ${statusTone}`}>
      <div className="semantic-gate-matrix-card-head">
        <div>
          <div className="semantic-gate-matrix-variant-title">
            {rank ? `#${rank} ` : ""}
            {variant.label}
          </div>
          <div className="semantic-gate-matrix-variant-subtitle">
            <code>{variant.variantId}</code>
            <span>{variant.reported}/{variant.runs} reported</span>
          </div>
        </div>
        <span className={`semantic-gate-matrix-status ${statusTone}`}>{variant.failed > 0 ? "failed" : "reported"}</span>
      </div>

      <div className="semantic-gate-matrix-metrics">
        <Metric label="Completed" value={`${variant.completed}/${variant.runs}`} tone={variant.completed === variant.runs ? "good" : "warn"} />
        <Metric label="Clean Pass" value={variant.cleanPass} tone={variant.cleanPass > 0 ? "good" : undefined} />
        <Metric label="Mean Risk" value={formatNullableDecimal(variant.meanRiskScore, 2)} tone={riskTone(variant.meanRiskScore ?? 0)} />
        <Metric label="Mean Word Ratio" value={formatRatio(variant.meanWordRatio)} />
        <Metric label="LLM" value={`${variant.totalLlmCalls} calls`} />
        <Metric label="Cost" value={formatCost(variant.totalCostUsd)} />
      </div>

      <div className="semantic-gate-matrix-section-title">Signals</div>
      <RecordChipList record={variant.semanticSignals} emptyText="No semantic-gate signals." />

      <div className="semantic-gate-matrix-section-title">Risk Drivers</div>
      <RecordChipList record={variant.riskDrivers} emptyText="No risk drivers." />

      <div className="semantic-gate-matrix-section-title">Terminal Statuses</div>
      <RecordChipList record={variant.terminalStatuses} emptyText="No terminal statuses." />

      <div className="semantic-gate-matrix-section-title">Reasons</div>
      <RecordReasonList record={variant.reasons} />
    </section>
  )
}

function MatrixRunRow({ run }: { run: SemanticGateCohortMatrixRun }) {
  const label = run.replicate === null ? run.sourceNovelId : `${run.sourceNovelId} r${run.replicate}`
  return (
    <div className="semantic-gate-matrix-detail-row">
      <span>{run.status}</span>
      <code>{label}</code>
      {run.error && <span>{run.error}</span>}
      <code>{run.summaryPath}</code>
    </div>
  )
}

function SummaryCell({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={`semantic-gate-matrix-summary-cell ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone?: string
}) {
  return (
    <div className={`semantic-gate-matrix-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function StringChipList({
  values,
  emptyText,
  compact = false,
}: {
  values: string[]
  emptyText: string
  compact?: boolean
}) {
  if (values.length === 0) return <div className="planning-muted">{emptyText}</div>
  return (
    <div className={`semantic-gate-matrix-risk-drivers ${compact ? "compact" : ""}`}>
      {values.map(value => (
        <span key={value}>{value}</span>
      ))}
    </div>
  )
}

function RecordChipList({ record, emptyText }: { record: Record<string, number>; emptyText: string }) {
  const rows = Object.entries(record)
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (rows.length === 0) return <div className="planning-muted">{emptyText}</div>
  return (
    <div className="semantic-gate-matrix-risk-drivers">
      {rows.map(([key, value]) => (
        <span key={key}>
          {key} <strong>{formatCount(value)}</strong>
        </span>
      ))}
    </div>
  )
}

function ReasonList({ reasons, limit }: { reasons: string[]; limit?: number }) {
  const rows = limit ? reasons.slice(0, limit) : reasons
  if (rows.length === 0) return <div className="planning-muted">No reasons recorded.</div>
  return (
    <ul className="semantic-gate-matrix-reasons">
      {rows.map((reason, index) => (
        <li key={`${reason}:${index}`}>{reason}</li>
      ))}
      {limit && reasons.length > limit && <li>{reasons.length - limit} more reason(s)</li>}
    </ul>
  )
}

function RecordReasonList({ record }: { record: Record<string, number> }) {
  const rows = Object.entries(record)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${reason} (${count})`)
  return <ReasonList reasons={rows} />
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`
}

function formatRatio(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2)
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : String(value)
}

function formatNullableDecimal(value: number | null | undefined, digits: number): string {
  return value == null ? "n/a" : value.toFixed(digits)
}

function formatCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function riskTone(value: number): string {
  if (value >= 500) return "bad"
  if (value > 0) return "warn"
  return "good"
}
