import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  getSemanticGateMatrix,
  listSemanticGateMatrices,
  type SemanticGateMatrixRankingItem,
  type SemanticGateMatrixReport,
  type SemanticGateMatrixRunSummary,
  type SemanticGateMatrixVariantResult,
} from "../api"

export function SemanticGateMatrixPage() {
  const { runId } = useParams<{ runId: string }>()
  const [report, setReport] = useState<SemanticGateMatrixReport | null>(null)
  const [runs, setRuns] = useState<SemanticGateMatrixRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      if (runId) {
        setRuns([])
        setReport(await getSemanticGateMatrix(runId))
      } else {
        setReport(null)
        const response = await listSemanticGateMatrices()
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
            <h2>Semantic Gate Matrix</h2>
            <div className="planning-studio-subtitle">Recent deterministic replay comparisons</div>
          </div>
          <button className="chapter-health-refresh" type="button" onClick={load} disabled={loading}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>

        {error && <div className="planning-error">Failed to load semantic gate matrices: {error}</div>}
        {loading && runs.length === 0 && <div className="planning-muted">Loading semantic gate matrices...</div>}
        {!loading && !error && runs.length === 0 && <div className="planning-muted">No semantic gate matrix runs found.</div>}

        {runs.length > 0 && (
          <div className="semantic-gate-matrix-run-list" aria-label="recent semantic gate matrix runs">
            {runs.map(run => (
              <RunSummaryCard key={run.runId} run={run} />
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
          <h2>Semantic Gate Matrix</h2>
          <div className="planning-studio-subtitle">
            Run <code>{runId}</code>
            {report?.generatedAt && <> - generated {formatDate(report.generatedAt)}</>}
          </div>
        </div>
        <div className="semantic-gate-matrix-header-actions">
          <Link className="chapter-health-refresh semantic-gate-matrix-link-button" to="/semantic-gate-matrix">
            Recent Runs
          </Link>
          <button className="chapter-health-refresh" type="button" onClick={load} disabled={loading}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="planning-error">Failed to load semantic gate matrix: {error}</div>}
      {loading && !report && <div className="planning-muted">Loading semantic gate matrix...</div>}

      {report && (
        <>
          <section className="semantic-gate-matrix-source">
            <div>
              <span>Source</span>
              <strong>{report.sourceNovelId}</strong>
            </div>
            <div>
              <span>Chapters</span>
              <strong>{report.chapters}</strong>
            </div>
            <div>
              <span>Parallel</span>
              <strong>{report.parallel}</strong>
            </div>
            <div className="semantic-gate-matrix-path">
              <span>Output</span>
              <code>{report.outputBase}</code>
            </div>
          </section>

          <div className="semantic-gate-matrix-totals" aria-label="semantic gate matrix totals">
            <SummaryCell label="Variants" value={report.totals.variants} />
            <SummaryCell label="Completed" value={report.totals.completed} tone="good" />
            <SummaryCell label="Clean Pass" value={report.totals.cleanPass} tone="good" />
            <SummaryCell label="Failed" value={report.totals.failed} tone={report.totals.failed > 0 ? "bad" : "good"} />
            <SummaryCell label="LLM Calls" value={report.totals.llmCalls} />
            <SummaryCell label="Cost" value={formatCost(report.totals.costUsd)} />
          </div>

          <section className="semantic-gate-matrix-ranking">
            <div className="semantic-gate-matrix-section-title">Ranking</div>
            <div className="semantic-gate-matrix-ranking-list">
              {report.ranking.map((item, index) => (
                <RankingRow key={item.variantId} item={item} rank={index + 1} />
              ))}
            </div>
          </section>

          <div className="semantic-gate-matrix-variants">
            {report.variants.map(result => (
              <VariantCard
                key={result.variant.id}
                result={result}
                rank={rankingByVariant.get(result.variant.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RunSummaryCard({ run }: { run: SemanticGateMatrixRunSummary }) {
  const failed = run.failed ?? 0
  const completed = run.completed ?? 0
  const variants = run.variants ?? 0
  const statusTone = failed > 0 ? "bad" : completed === variants && variants > 0 ? "good" : "warn"

  return (
    <Link className={`semantic-gate-matrix-run-card ${statusTone}`} to={`/semantic-gate-matrix/${encodeURIComponent(run.runId)}`}>
      <div className="semantic-gate-matrix-card-head">
        <div>
          <div className="semantic-gate-matrix-variant-title">{run.sourceNovelId ?? "unknown source"}</div>
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
        <Metric label="Variants" value={formatNullableNumber(run.variants)} />
        <Metric label="Completed" value={formatNullableNumber(run.completed)} tone={completed > 0 ? "good" : undefined} />
        <Metric label="Clean Pass" value={formatNullableNumber(run.cleanPass)} tone={(run.cleanPass ?? 0) > 0 ? "good" : undefined} />
        <Metric label="Failed" value={formatNullableNumber(run.failed)} tone={failed > 0 ? "bad" : "good"} />
        <Metric label="Cost" value={run.costUsd === null ? "n/a" : formatCost(run.costUsd)} />
      </div>
      <div className="semantic-gate-matrix-run-path">
        <span>Summary</span>
        <code>{run.summaryPath}</code>
      </div>
    </Link>
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

function RankingRow({ item, rank }: { item: SemanticGateMatrixRankingItem; rank: number }) {
  return (
    <div className="semantic-gate-matrix-ranking-row">
      <div className="semantic-gate-matrix-rank-number">{rank}</div>
      <div>
        <div className="semantic-gate-matrix-ranking-main">
          <strong>{item.label}</strong>
          <span className={`semantic-gate-matrix-status ${item.completed ? "good" : "bad"}`}>
            {item.completed ? "completed" : "incomplete"}
          </span>
        </div>
        <div className="semantic-gate-matrix-ranking-meta">
          risk {formatNumber(item.riskScore, 2)} - word ratio {formatRatio(item.wordRatio)} - {formatCost(item.costUsd)}
        </div>
        <ReasonList reasons={item.reasons} limit={3} />
      </div>
    </div>
  )
}

function VariantCard({ result, rank }: { result: SemanticGateMatrixVariantResult; rank?: number }) {
  const assessment = result.assessment
  const statusTone = assessment.completed && result.status === "reported" ? "good" : result.status === "failed" ? "bad" : "warn"

  return (
    <section className={`semantic-gate-matrix-card ${statusTone}`}>
      <div className="semantic-gate-matrix-card-head">
        <div>
          <div className="semantic-gate-matrix-variant-title">
            {rank ? `#${rank} ` : ""}
            {result.variant.label}
          </div>
          <div className="semantic-gate-matrix-variant-subtitle">
            <code>{result.variant.id}</code>
            {result.variant.maxBeatsPerChapter === null ? (
              <span>source outline</span>
            ) : (
              <span>{result.variant.maxBeatsPerChapter} beats/chapter</span>
            )}
          </div>
        </div>
        <span className={`semantic-gate-matrix-status ${statusTone}`}>{result.status}</span>
      </div>

      <div className="semantic-gate-matrix-metrics">
        <Metric label="Terminal" value={assessment.terminalStatus} />
        <Metric label="Approved" value={`${assessment.approvedChapters}/${assessment.requestedChapters}`} tone={assessment.completed ? "good" : "warn"} />
        <Metric label="Words" value={`${assessment.totalWords}/${assessment.draftedTargetWords}`} />
        <Metric label="Word Ratio" value={formatRatio(assessment.wordRatio)} />
        <Metric label="Mean Ch Ratio" value={formatRatio(assessment.meanChapterWordRatio)} />
        <Metric label="Pending Gate" value={assessment.pendingPlanAssistGate ? "yes" : "no"} tone={assessment.pendingPlanAssistGate ? "bad" : "good"} />
        <Metric label="Proposals" value={assessment.proposalCount} />
        <Metric label="Actions" value={assessment.actionCount} />
        <Metric label="LLM" value={`${assessment.llmCalls} calls`} tone={assessment.failedLlmCalls > 0 ? "bad" : undefined} />
        <Metric label="Cost" value={formatCost(assessment.costUsd)} />
        <Metric label="Risk" value={formatNumber(assessment.riskScore, 2)} tone={riskTone(assessment.riskScore)} />
      </div>

      <div className="semantic-gate-matrix-section-title">Signals</div>
      <SignalList signals={assessment.semanticSignals} />

      <div className="semantic-gate-matrix-section-title">Reasons</div>
      <ReasonList reasons={assessment.reasons} />

      {result.error && <div className="semantic-gate-matrix-error">{result.error}</div>}

      <details className="semantic-gate-matrix-details">
        <summary>Command, target, and artifact paths</summary>
        <div className="semantic-gate-matrix-detail-list">
          <DetailRow label="Target novel" value={result.targetNovelId} />
          <DetailRow label="Exit" value={`code=${String(result.exitCode)} signal=${result.signal ?? "none"}`} />
          <DetailRow label="Output base" value={result.outputBase} />
          <DetailRow label="Summary artifact" value={result.summaryPath} />
          <DetailRow label="Report artifact" value={result.reportPath} />
          <DetailRow label="Stdout" value={result.stdoutPath} />
          <DetailRow label="Stderr" value={result.stderrPath} />
          <DetailRow label="Command" value={result.command.join(" ")} />
        </div>
      </details>
    </section>
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

function SignalList({ signals }: { signals: Record<string, number> }) {
  const rows = Object.entries(signals)
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (rows.length === 0) return <div className="planning-muted">No semantic-gate signals.</div>
  return (
    <div className="semantic-gate-matrix-signals">
      {rows.map(([key, value]) => (
        <span key={key} className={value > 0 ? "active" : ""}>
          {key} <strong>{value}</strong>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="semantic-gate-matrix-detail-row">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  )
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

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits)
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : String(value)
}

function riskTone(value: number): string {
  if (value >= 500) return "bad"
  if (value > 0) return "warn"
  return "good"
}
