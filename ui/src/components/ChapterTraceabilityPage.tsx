import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  getChapterTraceability,
  type ChapterTraceabilityBeat,
  type ChapterTraceabilityCall,
  type ChapterTraceabilityEvent,
  type ChapterTraceabilityEvidence,
  type ChapterTraceabilityObligation,
  type ChapterTraceabilityRef,
  type ChapterTraceabilityReport,
  type ChapterTraceabilitySourceRegistryItem,
  type ChapterTraceabilityTargetRef,
} from "../api"

export function ChapterTraceabilityPage() {
  const { novelId, chapterNumber } = useParams<{ novelId: string; chapterNumber: string }>()
  const parsedChapter = Number.parseInt(chapterNumber ?? "", 10)
  const validChapter = Number.isInteger(parsedChapter) && parsedChapter > 0 && String(parsedChapter) === chapterNumber
  const [report, setReport] = useState<ChapterTraceabilityReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!novelId || !validChapter) return
    setLoading(true)
    setError(null)
    try {
      setReport(await getChapterTraceability(novelId, parsedChapter))
    } catch (err) {
      setError((err as Error).message ?? String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, chapterNumber])

  const registryByRef = useMemo(() => {
    const map = new Map<string, ChapterTraceabilitySourceRegistryItem>()
    for (const item of report?.sourceRegistry ?? []) map.set(`${item.kind}:${item.ref}`, item)
    return map
  }, [report])

  if (!novelId) return <div className="traceability-page">Missing novel id.</div>
  if (!validChapter) return <div className="traceability-page">Invalid chapter number.</div>

  return (
    <div className="traceability-page">
      <div className="planning-studio-header">
        <div>
          <h2>Chapter Traceability</h2>
          <div className="planning-studio-subtitle">
            Novel <code>{novelId}</code> · chapter {parsedChapter}
            {report?.generatedAt && <> · generated {formatDate(report.generatedAt)}</>}
          </div>
        </div>
        <div className="planning-studio-links">
          <Link to={`/${encodeURIComponent(novelId)}`}>Pipeline</Link>
          <Link to={`/chapter-health/${encodeURIComponent(novelId)}`}>Health</Link>
          <Link to={`/planning-studio/${encodeURIComponent(novelId)}`}>Planning Studio</Link>
          <Link to={`/planning-snapshot/${encodeURIComponent(novelId)}`}>Snapshot</Link>
        </div>
      </div>

      {error && <div className="planning-error">Failed to load traceability: {error}</div>}
      <div className="traceability-toolbar">
        <div className="traceability-title-block">
          <strong>{report?.title ?? `Chapter ${parsedChapter}`}</strong>
          {report?.chapterId && <code>{report.chapterId}</code>}
          {report?.planningSnapshotHash && <code>snapshot {shortHash(report.planningSnapshotHash)}</code>}
        </div>
        <button className="chapter-health-refresh" type="button" onClick={load} disabled={loading}>
          {loading ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {loading && !report && <div className="planning-muted">Loading traceability...</div>}

      {report && (
        <>
          <div className="traceability-summary" aria-label="chapter traceability summary">
            <SummaryCell label="Beats" value={report.summary.beatCount} />
            <SummaryCell label="Obligations" value={report.summary.obligationCount} />
            <SummaryCell label="Linked" value={report.summary.linkedObligationCount} tone="good" />
            <SummaryCell label="Missing Source" value={report.summary.missingSourceCount} tone={report.summary.missingSourceCount > 0 ? "warn" : "good"} />
            <SummaryCell label="Writer Calls" value={report.summary.writerCallCount} />
            <SummaryCell label="Checker Calls" value={report.summary.checkerCallCount} />
            <SummaryCell label="Trace Events" value={report.summary.traceEventCount} />
            <SummaryCell label="Proposals" value={report.summary.proposalEnvelopeCount ?? 0} />
            <SummaryCell label="Outcomes" value={report.summary.resolutionImpactCount ?? 0} />
            <SummaryCell label="Observations" value={report.summary.checkerObservationCount ?? 0} />
            <SummaryCell label="Lineage" value={report.summary.mutationLineageCount ?? 0} />
          </div>

          <section className="traceability-registry">
            <div className="traceability-section-title">Source Registry</div>
            {report.sourceRegistry.length === 0 ? (
              <div className="planning-muted">No source registry items for this chapter.</div>
            ) : (
              <div className="traceability-registry-grid">
                {report.sourceRegistry.slice(0, 18).map(item => (
                  <SourceRegistryItem key={`${item.kind}:${item.ref}`} item={item} />
                ))}
              </div>
            )}
          </section>

          <div className="traceability-beat-list">
            {report.beats.map(beat => (
              <TraceabilityBeatCard key={`${beat.beatIndex}:${beat.beatId ?? ""}`} beat={beat} registryByRef={registryByRef} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCell({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`traceability-summary-cell ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SourceRegistryItem({ item }: { item: ChapterTraceabilitySourceRegistryItem }) {
  return (
    <div className="traceability-registry-item">
      <div>
        <span>{item.kind}</span>
        <strong>{item.label}</strong>
      </div>
      <code>{item.ref}</code>
      {item.text && <p>{item.text}</p>}
      {item.characterId && <code>character:{item.characterId}</code>}
      {evidenceCount(item.proposalEvidence) > 0 && (
        <p>{evidenceCount(item.proposalEvidence)} proposal/lineage evidence item(s)</p>
      )}
    </div>
  )
}

function TraceabilityBeatCard({
  beat,
  registryByRef,
}: {
  beat: ChapterTraceabilityBeat
  registryByRef: Map<string, ChapterTraceabilitySourceRegistryItem>
}) {
  const writerCalls = beat.llmCalls.filter(call => call.role === "writer")
  const checkerCalls = beat.llmCalls.filter(call => call.role === "checker")
  return (
    <section className="traceability-beat-card">
      <div className="traceability-beat-head">
        <div>
          <div className="traceability-beat-title">
            Beat {beat.beatIndex + 1} · {beat.kind}
          </div>
          <div className="traceability-beat-description">{beat.description}</div>
          <RefChips refs={beat.refs} />
        </div>
        <div className="traceability-beat-metrics">
          <span>{beat.obligations.length} obligations</span>
          <span>{writerCalls.length} writer</span>
          <span>{checkerCalls.length} checker</span>
          <span>{beat.traceEvents.length} events</span>
          <span>{evidenceCount(beat.proposalEvidence)} evidence</span>
        </div>
      </div>

      <div className="traceability-subgrid">
        <section>
          <div className="traceability-section-title">Obligations</div>
          {beat.obligations.length === 0 ? (
            <div className="planning-muted">No obligations.</div>
          ) : (
            <div className="traceability-obligation-list">
              {beat.obligations.map((obligation, index) => (
                <ObligationRow
                  key={`${obligation.obligationId ?? obligation.list}:${index}`}
                  obligation={obligation}
                  registryByRef={registryByRef}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="traceability-section-title">Upstream Targets</div>
          <TargetList targets={beat.upstreamTargets} />
        </section>
      </div>

      <details className="traceability-details">
        <summary>Writer, checker, and event evidence</summary>
        <div className="traceability-evidence-grid">
          <EvidenceList
            title="Writer Calls"
            rows={writerCalls.map(formatCall)}
            refs={writerCalls.flatMap(call => call.metaRefs)}
          />
          <EvidenceList
            title="Checker Calls"
            rows={checkerCalls.map(formatCall)}
            refs={checkerCalls.flatMap(call => call.metaRefs)}
          />
          <EventList events={beat.traceEvents} />
          <ProposalEvidenceList evidence={[
            ...(beat.proposalEvidence ?? []),
            ...beat.obligations.flatMap(item => item.proposalEvidence ?? []),
          ]} />
        </div>
      </details>
    </section>
  )
}

function ObligationRow({
  obligation,
  registryByRef,
}: {
  obligation: ChapterTraceabilityObligation
  registryByRef: Map<string, ChapterTraceabilitySourceRegistryItem>
}) {
  const registryItem = obligation.sourceKind && obligation.sourceId
    ? registryByRef.get(`${sourceRegistryKind(obligation.sourceKind)}:${obligation.sourceId}`)
    : undefined
  return (
    <div className={`traceability-obligation ${obligation.sourceFound ? "linked" : "missing"}`}>
      <div className="traceability-obligation-main">
        <span>{obligation.list}</span>
        <strong>{obligation.sourceFound ? "linked" : "missing source"}</strong>
      </div>
      <div className="traceability-obligation-text">{obligation.text}</div>
      {registryItem && <div className="traceability-source-hit">{registryItem.label}</div>}
      {evidenceCount(obligation.proposalEvidence) > 0 && (
        <div className="traceability-source-hit">{evidenceCount(obligation.proposalEvidence)} proposal/lineage evidence item(s)</div>
      )}
      <RefChips refs={obligation.refs} />
    </div>
  )
}

function TargetList({ targets }: { targets: ChapterTraceabilityTargetRef[] }) {
  if (targets.length === 0) return <div className="planning-muted">None</div>
  return (
    <div className="traceability-target-list">
      {targets.map((target, index) => (
        <code key={`${target.kind}:${target.ref}:${target.fieldPath ?? ""}:${index}`}>
          {target.kind}:{target.ref}{target.fieldPath ? `/${target.fieldPath}` : ""}
        </code>
      ))}
    </div>
  )
}

function EvidenceList({
  title,
  rows,
  refs,
}: {
  title: string
  rows: string[]
  refs: ChapterTraceabilityRef[]
}) {
  return (
    <div className="traceability-evidence">
      <div className="traceability-section-title">{title}</div>
      {rows.length === 0 ? (
        <div className="planning-muted">None</div>
      ) : (
        <ul>
          {rows.slice(0, 10).map((row, index) => <li key={index}>{row}</li>)}
        </ul>
      )}
      <RefChips refs={refs.slice(0, 10)} />
    </div>
  )
}

function EventList({ events }: { events: ChapterTraceabilityEvent[] }) {
  return (
    <div className="traceability-evidence">
      <div className="traceability-section-title">Trace Events</div>
      {events.length === 0 ? (
        <div className="planning-muted">None</div>
      ) : (
        <ul>
          {events.slice(0, 10).map(event => (
            <li key={event.id}>
              {event.eventType}{event.agent ? ` · ${event.agent}` : ""} · {event.linkEvidence}
            </li>
          ))}
        </ul>
      )}
      <RefChips refs={events.flatMap(event => event.refs).slice(0, 10)} />
    </div>
  )
}

function ProposalEvidenceList({ evidence }: { evidence: ChapterTraceabilityEvidence[] }) {
  const proposals = evidence.flatMap(item => item.proposalEnvelopes)
  const impacts = evidence.flatMap(item => item.resolutionImpacts)
  const observations = evidence.flatMap(item => item.checkerObservations)
  const lineage = evidence.flatMap(item => item.mutationLineage)
  const rows = [
    ...proposals.map(item => `${item.kind} · ${item.status} · ${item.summary}`),
    ...impacts.map(item => `${item.proposalKind} impact · ${item.targetKind}:${item.targetRef}`),
    ...observations.map(item => `${item.checkerName} · ${item.fired ? "fired" : "clear"} · ${item.proposalId}`),
    ...lineage.map(item => `lineage · ${item.fieldPath} · ${item.previousRef} -> ${item.nextRef}`),
  ]
  return (
    <div className="traceability-evidence">
      <div className="traceability-section-title">Proposal Evidence</div>
      {rows.length === 0 ? (
        <div className="planning-muted">None</div>
      ) : (
        <ul>
          {rows.slice(0, 12).map((row, index) => <li key={index}>{row}</li>)}
        </ul>
      )}
    </div>
  )
}

function RefChips({ refs }: { refs: ChapterTraceabilityRef[] }) {
  if (refs.length === 0) return null
  return (
    <div className="traceability-ref-chips">
      {refs.map((ref, index) => (
        <code key={`${ref.kind}:${ref.ref}:${index}`} title={ref.label}>
          {ref.kind}:{ref.ref}
        </code>
      ))}
    </div>
  )
}

function formatCall(call: ChapterTraceabilityCall): string {
  const attempt = call.attempt !== undefined ? ` attempt ${call.attempt}` : ""
  const tokenText = call.promptTokens !== undefined || call.completionTokens !== undefined
    ? ` · ${call.promptTokens ?? 0}/${call.completionTokens ?? 0} tokens`
    : ""
  return `${call.agent}${attempt} · ${call.linkEvidence}${call.failed ? " · failed" : ""}${tokenText}`
}

function sourceRegistryKind(sourceKind: string): string {
  if (sourceKind === "fact" || sourceKind === "payoff") return "world_fact"
  return sourceKind
}

function evidenceCount(evidence: ChapterTraceabilityEvidence[] | undefined): number {
  return (evidence ?? []).reduce(
    (sum, item) =>
      sum +
      item.proposalEnvelopes.length +
      item.resolutionImpacts.length +
      item.checkerObservations.length +
      item.mutationLineage.length,
    0,
  )
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}
