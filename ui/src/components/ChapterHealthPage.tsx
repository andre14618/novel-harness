import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  getChapterHealth,
  type ChapterHealthChapter,
  type ChapterHealthFinding,
  type ChapterHealthReport,
  type ChapterHealthStatus,
} from "../api"

type HealthFilter = "attention" | "all" | ChapterHealthStatus

const FILTERS: Array<{ id: HealthFilter; label: string }> = [
  { id: "attention", label: "Attention" },
  { id: "all", label: "All" },
  { id: "fail", label: "Fail" },
  { id: "warn", label: "Warn" },
  { id: "missing_draft", label: "Missing Draft" },
  { id: "missing_outline", label: "Missing Outline" },
  { id: "pass", label: "Pass" },
]

export function ChapterHealthPage() {
  const { novelId } = useParams<{ novelId: string }>()
  const [report, setReport] = useState<ChapterHealthReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<HealthFilter>("attention")

  const load = async () => {
    if (!novelId) return
    setLoading(true)
    setError(null)
    try {
      setReport(await getChapterHealth(novelId))
    } catch (err) {
      setError((err as Error).message ?? String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId])

  const chapters = useMemo(() => {
    const all = report?.chapters ?? []
    if (filter === "all") return all
    if (filter === "attention") {
      return all.filter(chapter =>
        chapter.status !== "pass" ||
        chapter.health.pendingProposalCount > 0 ||
        chapter.health.blockerCount > 0 ||
        chapter.health.warningCount > 0
      )
    }
    return all.filter(chapter => chapter.status === filter)
  }, [filter, report])

  if (!novelId) return <div className="chapter-health-page">Missing novel id.</div>

  return (
    <div className="chapter-health-page">
      <div className="planning-studio-header">
        <div>
          <h2>Chapter Health</h2>
          <div className="planning-studio-subtitle">
            Novel <code>{novelId}</code>
            {report?.generatedAt && <> · generated {formatDate(report.generatedAt)}</>}
          </div>
        </div>
        <div className="planning-studio-links">
          <Link to={`/${encodeURIComponent(novelId)}`}>Pipeline</Link>
          <Link to={`/planning-studio/${encodeURIComponent(novelId)}`}>Planning Studio</Link>
          <Link to={`/planning-snapshot/${encodeURIComponent(novelId)}`}>Snapshot</Link>
          <Link to={`/canon-proposals/${encodeURIComponent(novelId)}`}>Canon Queue</Link>
        </div>
      </div>

      {error && <div className="planning-error">Failed to load chapter health: {error}</div>}

      <div className="chapter-health-toolbar">
        <div className="planning-status-tabs">
          {FILTERS.map(item => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? "active" : ""}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button className="chapter-health-refresh" type="button" onClick={load} disabled={loading}>
          {loading ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {report && (
        <div className="chapter-health-summary" aria-label="chapter health summary">
          <SummaryCell label="Chapters" value={report.summary.chapterCount} />
          <SummaryCell label="Pass" value={report.summary.pass} tone="pass" />
          <SummaryCell label="Warn" value={report.summary.warn} tone="warn" />
          <SummaryCell label="Fail" value={report.summary.fail} tone="fail" />
          <SummaryCell label="Missing Draft" value={report.summary.missingDraft} tone="missing" />
          <SummaryCell label="Missing Outline" value={report.summary.missingOutline} tone="missing" />
          <SummaryCell label="Pending Proposals" value={report.summary.pendingProposals} />
        </div>
      )}

      {loading && !report && <div className="planning-muted">Loading chapter health...</div>}
      {report && chapters.length === 0 && (
        <div className="planning-muted">No chapters match this filter.</div>
      )}

      <div className="chapter-health-list">
        {chapters.map(chapter => (
          <ChapterHealthCard key={chapter.chapterNumber} chapter={chapter} />
        ))}
      </div>
    </div>
  )
}

function SummaryCell({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`chapter-health-summary-cell ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ChapterHealthCard({ chapter }: { chapter: ChapterHealthChapter }) {
  const statusClass = statusTone(chapter.status)
  const visibleFindings = chapter.findings.slice(0, 8)
  return (
    <section className="chapter-health-card">
      <div className="chapter-health-card-head">
        <div>
          <div className="chapter-health-title">
            Ch {chapter.chapterNumber}
            {chapter.title ? ` · ${chapter.title}` : ""}
          </div>
          <div className="chapter-health-refs">
            <span>{chapter.chapterId ?? chapter.chapterRef}</span>
            {chapter.outline && <span>{chapter.outline.beatCount} beats</span>}
            {chapter.draft && (
              <span>
                draft v{chapter.draft.version} · {chapter.draft.wordCount} words · {chapter.draft.status}
              </span>
            )}
          </div>
        </div>
        <span className={`chapter-health-status ${statusClass}`}>{statusLabel(chapter.status)}</span>
      </div>

      <div className="chapter-health-metrics">
        <Metric label="Blockers" value={chapter.health.blockerCount} tone="fail" />
        <Metric label="Warnings" value={chapter.health.warningCount} tone="warn" />
        <Metric label="Info" value={chapter.health.infoCount} />
        <Metric label="Pending proposals" value={chapter.health.pendingProposalCount} />
        <Metric label="Trace events" value={chapter.trace.latestEvents.length} />
        <Metric label="Checker calls" value={chapter.trace.checkerCalls.length} />
      </div>

      {chapter.outline && (
        <div className="chapter-health-ref-row">
          <span>Outline {shortHash(chapter.outline.currentVersion)}</span>
          <span>{chapter.outline.obligationRefs.length} obligations</span>
          {chapter.draft && <span>Draft {shortHash(chapter.draft.hash)}</span>}
        </div>
      )}

      {visibleFindings.length > 0 ? (
        <div className="chapter-health-findings">
          {visibleFindings.map((finding, index) => (
            <FindingRow key={`${finding.source}-${finding.code}-${index}`} finding={finding} />
          ))}
          {chapter.findings.length > visibleFindings.length && (
            <div className="chapter-health-more">
              {chapter.findings.length - visibleFindings.length} more finding(s)
            </div>
          )}
        </div>
      ) : (
        <div className="planning-muted">No current findings.</div>
      )}

      <details className="chapter-health-details">
        <summary>Trace and proposal evidence</summary>
        <div className="chapter-health-detail-grid">
          <EvidenceList
            title="Trace events"
            rows={chapter.trace.latestEvents.map(event =>
              `${event.eventType}${event.beatIndex !== undefined ? ` b${event.beatIndex + 1}` : ""}${event.agent ? ` · ${event.agent}` : ""}`
            )}
          />
          <EvidenceList
            title="Checker calls"
            rows={chapter.trace.checkerCalls.map(call =>
              `${call.agent}${call.beatId ? ` · ${call.beatId}` : ""}${call.failed ? " · failed" : ""}`
            )}
          />
          <EvidenceList
            title="Proposals"
            rows={chapter.proposals.envelopes.map(proposal =>
              `${proposal.kind} · ${proposal.status} · ${proposal.summary}`
            )}
          />
          <EvidenceList
            title="Checker observations"
            rows={chapter.proposals.checkerObservations.map(observation =>
              `${observation.checkerName} · ${observation.fired ? "fired" : "clear"} · ${observation.proposalId}`
            )}
          />
        </div>
      </details>
    </section>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`chapter-health-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function FindingRow({ finding }: { finding: ChapterHealthFinding }) {
  return (
    <div className={`chapter-health-finding ${finding.severity}`}>
      <div className="chapter-health-finding-main">
        <span>{finding.severity}</span>
        <strong>{finding.code}</strong>
        <small>{finding.source}</small>
      </div>
      <div className="chapter-health-finding-text">{finding.description}</div>
      <div className="chapter-health-finding-refs">
        {finding.refs.slice(0, 4).map(ref => (
          <code key={`${ref.kind}:${ref.ref}`}>{ref.kind}:{ref.ref}</code>
        ))}
        {finding.stableSource.kind === "table" && finding.stableSource.table && (
          <code>{finding.stableSource.table}:{String(finding.stableSource.rowId ?? "")}</code>
        )}
      </div>
    </div>
  )
}

function EvidenceList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="chapter-health-evidence">
      <div className="chapter-health-evidence-title">{title}</div>
      {rows.length === 0 ? (
        <div className="planning-muted">None</div>
      ) : (
        <ul>
          {rows.slice(0, 8).map((row, index) => <li key={index}>{row}</li>)}
        </ul>
      )}
    </div>
  )
}

function statusTone(status: ChapterHealthStatus): string {
  if (status === "pass") return "pass"
  if (status === "warn") return "warn"
  if (status === "fail") return "fail"
  return "missing"
}

function statusLabel(status: ChapterHealthStatus): string {
  return status.replace("_", " ")
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}
