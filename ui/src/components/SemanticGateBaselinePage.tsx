import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  getSemanticGateBaseline,
  listSemanticGateBaselines,
  type SemanticGateBaselineReport,
  type SemanticGateBaselineResponse,
  type SemanticGateBaselineRunSummary,
} from "../api"

export function SemanticGateBaselinePage() {
  const { runId } = useParams<{ runId: string }>()
  const [response, setResponse] = useState<SemanticGateBaselineResponse | null>(null)
  const [runs, setRuns] = useState<SemanticGateBaselineRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      if (runId) {
        setRuns([])
        setResponse(await getSemanticGateBaseline(runId))
      } else {
        setResponse(null)
        const listed = await listSemanticGateBaselines()
        setRuns(listed.runs)
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

  if (!runId) {
    return (
      <div className="semantic-gate-matrix-page">
        <div className="planning-studio-header">
          <div>
            <h2>Semantic Gate Baselines</h2>
            <div className="planning-studio-subtitle">Recent one-arm disposable replay diagnostics</div>
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

        {error && <div className="planning-error">Failed to load semantic gate baselines: {error}</div>}
        {loading && runs.length === 0 && <div className="planning-muted">Loading semantic gate baselines...</div>}
        {!loading && !error && runs.length === 0 && <div className="planning-muted">No semantic gate baseline runs found.</div>}

        {runs.length > 0 && (
          <div className="semantic-gate-matrix-run-list" aria-label="recent semantic gate baseline runs">
            {runs.map(run => (
              <BaselineRunCard key={run.runId} run={run} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const report = response?.report ?? null
  return (
    <div className="semantic-gate-matrix-page">
      <div className="planning-studio-header">
        <div>
          <h2>Semantic Gate Baseline</h2>
          <div className="planning-studio-subtitle">
            Run <code>{runId}</code>
            {report?.generatedAt && <> - generated {formatDate(report.generatedAt)}</>}
          </div>
        </div>
        <div className="semantic-gate-matrix-header-actions">
          <Link className="chapter-health-refresh semantic-gate-matrix-link-button" to="/semantic-gate-matrix">
            Matrix Runs
          </Link>
          <Link className="chapter-health-refresh semantic-gate-matrix-link-button" to="/semantic-gate-baseline">
            Recent Baselines
          </Link>
          <button className="chapter-health-refresh" type="button" onClick={load} disabled={loading}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="planning-error">Failed to load semantic gate baseline: {error}</div>}
      {loading && !report && <div className="planning-muted">Loading semantic gate baseline...</div>}
      {report && <BaselineDetail report={report} response={response!} />}
    </div>
  )
}

function BaselineRunCard({ run }: { run: SemanticGateBaselineRunSummary }) {
  const tone = terminalTone(run.terminalStatus)

  return (
    <Link className={`semantic-gate-matrix-run-card ${tone}`} to={`/semantic-gate-baseline/${encodeURIComponent(run.runId)}`}>
      <div className="semantic-gate-matrix-card-head">
        <div>
          <div className="semantic-gate-matrix-variant-title">{run.sourceNovelId ?? "unknown source"}</div>
          <div className="semantic-gate-matrix-variant-subtitle">
            <code>{run.runId}</code>
            {run.generatedAt && <span>{formatDate(run.generatedAt)}</span>}
          </div>
        </div>
        <span className={`semantic-gate-matrix-status ${tone}`}>{run.terminalStatus ?? "unknown"}</span>
      </div>
      <div className="semantic-gate-matrix-run-metrics">
        <Metric label="Approved" value={`${formatNullable(run.approvedChapters)}/${formatNullable(run.chapters)}`} tone={tone === "good" ? "good" : undefined} />
        <Metric label="Latest" value={formatNullable(run.latestChapters)} />
        <Metric label="Words" value={formatNullable(run.totalWords)} />
        <Metric label="LLM" value={run.llmCalls === null ? "n/a" : `${run.llmCalls} calls`} />
        <Metric label="Cost" value={run.costUsd === null ? "n/a" : formatCost(run.costUsd)} />
      </div>
      <div className="semantic-gate-matrix-run-top">
        <div className="semantic-gate-matrix-section-title">Terminal Reason</div>
        <div className="semantic-gate-baseline-reason">{run.terminalReason ?? "n/a"}</div>
        <div className="semantic-gate-matrix-ranking-meta">
          max beats {run.maxBeatsPerChapter ?? "source"} - proposals {formatNullable(run.proposalTotal)}
        </div>
      </div>
      <div className="semantic-gate-matrix-run-path">
        <span>Summary</span>
        <code>{run.summaryPath}</code>
      </div>
    </Link>
  )
}

function BaselineDetail({ report, response }: { report: SemanticGateBaselineReport; response: SemanticGateBaselineResponse }) {
  const signalRows = useMemo(
    () => sortedRecord(report.checker?.semanticGate?.totals?.bySignal ?? {}),
    [report],
  )
  const actionRows = report.checker?.actionEvidence?.items ?? []
  const planAssistSamples = report.terminal.latestPlanAssistGate?.unresolvedSamples.length
    ? report.terminal.latestPlanAssistGate.unresolvedSamples
    : report.terminal.planAssistLogEvidence?.unresolvedSamples ?? []

  return (
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
          <span>Beat Cap</span>
          <strong>{report.maxBeatsPerChapter ?? "source"}</strong>
        </div>
        <div className="semantic-gate-matrix-path">
          <span>Output</span>
          <code>{report.outputBase}</code>
        </div>
      </section>

      <div className="semantic-gate-matrix-totals" aria-label="semantic gate baseline totals">
        <SummaryCell label="Terminal" value={report.terminal.status} tone={terminalTone(report.terminal.status)} />
        <SummaryCell label="Approved" value={`${report.drafts.approvedChapters}/${report.chapters}`} tone={report.novel?.completed ? "good" : "warn"} />
        <SummaryCell label="Words" value={report.drafts.totalWords} />
        <SummaryCell label="LLM Calls" value={report.llm.calls} />
        <SummaryCell label="Cost" value={formatCost(report.llm.costUsd)} />
        <SummaryCell label="Proposals" value={report.proposals?.total ?? 0} />
      </div>

      <section className={`semantic-gate-matrix-card ${terminalTone(report.terminal.status)}`}>
        <div className="semantic-gate-matrix-card-head">
          <div>
            <div className="semantic-gate-matrix-variant-title">Terminal State</div>
            <div className="semantic-gate-matrix-ranking-meta">{report.terminal.reason}</div>
          </div>
          <span className={`semantic-gate-matrix-status ${terminalTone(report.terminal.status)}`}>{report.terminal.status}</span>
        </div>
        {report.terminal.latestPlanAssistGate && (
          <div className="semantic-gate-baseline-reason">
            Chapter {report.terminal.latestPlanAssistGate.chapter}, attempt {report.terminal.latestPlanAssistGate.attempt}, {report.terminal.latestPlanAssistGate.kind}
          </div>
        )}
        <ReasonList reasons={planAssistSamples} />
      </section>

      <div className="semantic-gate-matrix-variants">
        <section className="semantic-gate-matrix-card">
          <div className="semantic-gate-matrix-section-title">Semantic Signals</div>
          <SignalList rows={signalRows} />
        </section>
        <section className="semantic-gate-matrix-card">
          <div className="semantic-gate-matrix-section-title">Draft Rows</div>
          <div className="semantic-gate-matrix-detail-list">
            {report.drafts.rows.map(row => (
              <DetailRow key={`${row.chapter}:${row.version}`} label={`chapter ${row.chapter}`} value={`${row.status} v${row.version}, ${row.wordCount} words`} />
            ))}
          </div>
        </section>
      </div>

      <div className="semantic-gate-matrix-variants">
        <section className="semantic-gate-matrix-card">
          <div className="semantic-gate-matrix-section-title">Action Evidence</div>
          <ReasonList reasons={actionRows.slice(0, 10).map(formatActionEvidence)} />
          {actionRows.length > 10 && <div className="planning-muted">{actionRows.length - 10} more action(s)</div>}
        </section>
        <section className="semantic-gate-matrix-card">
          <div className="semantic-gate-matrix-section-title">LLM Agents</div>
          <div className="semantic-gate-matrix-detail-list">
            {report.llm.agents.slice(0, 12).map(agent => (
              <DetailRow key={agent.agent} label={agent.agent} value={`${agent.calls} calls, ${agent.failedCalls} failed, ${formatCost(agent.costUsd)}`} />
            ))}
          </div>
        </section>
      </div>

      <details className="semantic-gate-matrix-details">
        <summary>Command, artifact paths, and markdown report</summary>
        <div className="semantic-gate-matrix-detail-list">
          <DetailRow label="Disposable novel" value={`${report.novelId}${report.keptNovel ? " (kept)" : " (cleaned)"}`} />
          <DetailRow label="Summary artifact" value={response.summaryPath} />
          <DetailRow label="Report artifact" value={response.reportPath ?? "none"} />
          {report.process && <DetailRow label="Stdout" value={report.process.stdoutPath} />}
          {report.process && <DetailRow label="Stderr" value={report.process.stderrPath} />}
        </div>
        {response.reportMarkdown && <pre className="semantic-gate-baseline-markdown">{response.reportMarkdown}</pre>}
      </details>
    </>
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

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className={`semantic-gate-matrix-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SignalList({ rows }: { rows: Array<[string, number]> }) {
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

function ReasonList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return <div className="planning-muted">No samples recorded.</div>
  return (
    <ul className="semantic-gate-matrix-reasons">
      {reasons.map((reason, index) => (
        <li key={`${reason}:${index}`}>{reason}</li>
      ))}
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

function formatActionEvidence(item: {
  kind: string
  chapter?: number | null
  beat?: number | null
  chapterNumber?: number | null
  beatId?: string | null
  summary?: string
  createdAt?: string
  timestamp?: string
}) {
  const chapter = item.chapterNumber ?? item.chapter
  const beat = item.beatId ?? (item.beat != null ? `beat ${item.beat}` : null)
  const loc = [
    chapter != null ? `ch${chapter}` : null,
    beat,
  ].filter(Boolean).join(" ")
  const summary = cleanActionSummary(item.summary)
  return `${item.kind}${loc ? ` ${loc}` : ""}${summary ? ` - ${summary}` : ""}`
}

function cleanActionSummary(value?: string): string {
  if (!value) return ""
  const trimmed = value.trim()
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const keys = ["generated", "inserted", "skipped", "errors"]
        .filter(key => Object.prototype.hasOwnProperty.call(parsed, key))
      if (keys.length > 0) {
        return keys.map(key => `${key}=${formatJsonValue(parsed[key])}`).join("; ")
      }
    } catch {
      // Fall through to bounded raw text.
    }
  }
  return trimmed
    .replace(/cost=(\d+\.\d+)/g, (_, n: string) => `cost=${Number(n).toFixed(4)}`)
    .slice(0, 180)
}

function formatJsonValue(value: unknown): string {
  if (Array.isArray(value)) return String(value.length)
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string") return value
  if (typeof value === "boolean") return String(value)
  if (value === null) return "null"
  return "object"
}

function sortedRecord(record: Record<string, number>): Array<[string, number]> {
  return Object.entries(record)
    .filter(([, value]) => value !== 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function terminalTone(status: string | null): string {
  if (status === "completed") return "good"
  if (status === "pending-plan-assist" || status === "incomplete") return "warn"
  if (status === "process-exit") return "bad"
  return "warn"
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`
}

function formatNullable(value: number | null): string {
  return value === null ? "n/a" : String(value)
}
