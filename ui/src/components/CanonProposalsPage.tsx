import { useEffect, useState, useCallback } from "react"
import { useParams, Link } from "react-router-dom"
import {
  listCanonProposals,
  resolveCanonProposal,
  generateProposalsFromOutline,
  type CanonProposal,
} from "../api"

type Filter = {
  source: string
  chapter: string
  plannerOnly: boolean
}

const EMPTY_FILTER: Filter = { source: "", chapter: "", plannerOnly: false }

function formatProvenance(p: CanonProposal["proposedFact"]["provenance"]): string {
  const parts: string[] = [`ch${p.chapter}`]
  if (p.beat !== undefined) parts.push(`beat${p.beat}`)
  parts.push(p.source)
  if (p.confidence !== undefined) parts.push(`conf=${p.confidence.toFixed(2)}`)
  return parts.join(" · ")
}

function ProposalRow({
  proposal,
  busy,
  onResolve,
}: {
  proposal: CanonProposal
  busy: boolean
  onResolve: (status: "approved" | "rejected") => void
}) {
  const fact = proposal.proposedFact
  return (
    <tr>
      <td style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "#9ac" }}>
        {proposal.id}
      </td>
      <td style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "#aaa" }}>
        {fact.id}
      </td>
      <td>
        <span style={{ padding: "1px 6px", borderRadius: 3, background: "#2a2e3c", color: "#dce", fontSize: "0.74rem" }}>
          {fact.kind}
        </span>
      </td>
      <td style={{ maxWidth: 460 }}>
        <div style={{ color: "#dce" }}>{fact.text}</div>
        <div style={{ color: "#888", fontSize: "0.78rem", marginTop: 2 }}>
          {formatProvenance(fact.provenance)}
        </div>
      </td>
      <td style={{ whiteSpace: "nowrap" }}>
        <button
          disabled={busy}
          onClick={() => onResolve("approved")}
          style={{
            background: "#2c4a32",
            border: "1px solid #4c7",
            color: "#cfe",
            padding: "4px 10px",
            borderRadius: 4,
            fontSize: "0.78rem",
            cursor: busy ? "wait" : "pointer",
            marginRight: 6,
          }}
        >
          Approve
        </button>
        <button
          disabled={busy}
          onClick={() => onResolve("rejected")}
          style={{
            background: "#4a2c2c",
            border: "1px solid #d65",
            color: "#fce",
            padding: "4px 10px",
            borderRadius: 4,
            fontSize: "0.78rem",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          Reject
        </button>
      </td>
    </tr>
  )
}

export function CanonProposalsPage() {
  const { novelId: rawNovelId } = useParams<{ novelId: string }>()
  const novelId = rawNovelId ?? ""
  const [proposals, setProposals] = useState<CanonProposal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER)
  const [appliedFilter, setAppliedFilter] = useState<Filter>(EMPTY_FILTER)
  const [genResult, setGenResult] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(() => {
    setError(null)
    const chapterNum = appliedFilter.chapter ? Number(appliedFilter.chapter) : undefined
    const opts: { source?: string; chapter?: number; plannerOnly?: boolean } = {}
    if (appliedFilter.source) opts.source = appliedFilter.source
    if (chapterNum !== undefined && Number.isFinite(chapterNum)) opts.chapter = chapterNum
    if (appliedFilter.plannerOnly) opts.plannerOnly = true
    listCanonProposals(novelId, opts)
      .then(r => setProposals(r.proposals))
      .catch(e => setError(String(e)))
  }, [novelId, appliedFilter])

  useEffect(() => {
    if (!novelId) return
    setProposals(null)
    load()
  }, [novelId, load])

  const onResolve = async (proposalId: string, status: "approved" | "rejected") => {
    setBusyId(proposalId)
    setError(null)
    try {
      await resolveCanonProposal(novelId, proposalId, { status, expectedStatus: "pending" })
      // Optimistic remove from the pending list.
      setProposals(prev => (prev ?? []).filter(p => p.id !== proposalId))
    } catch (e) {
      setError(String(e))
      // Reload so the operator sees authoritative state if the resolve raced.
      load()
    } finally {
      setBusyId(null)
    }
  }

  const onGenerate = async () => {
    setGenerating(true)
    setGenResult(null)
    setError(null)
    try {
      const r = await generateProposalsFromOutline(novelId)
      const tag = r.gateClear ? "gate=CLEAR" : "gate=REFUSED"
      setGenResult(
        `${tag} · created=${r.created} · skipped=${r.skipped} · outlines=${r.outlinesCount}`,
      )
      load()
    } catch (e) {
      setError(String(e))
    } finally {
      setGenerating(false)
    }
  }

  if (!novelId) {
    return (
      <p style={{ color: "var(--text-tertiary)", padding: 32 }}>
        Missing novelId in route. Try{" "}
        <code>/canon-proposals/&lt;novel-id&gt;</code>.
      </p>
    )
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, marginBottom: 4 }}>Canon proposal review</h2>
        <p style={{ color: "#888", margin: 0, fontSize: "0.88rem" }}>
          Pending proposals for novel{" "}
          <code style={{ color: "#9ac" }}>{novelId}</code>. Approving commits the
          fact to canon (no-ghost-canon: pending rows are invisible to canon
          reads). Rejecting marks it not-canon. Modify-with-edits is not
          surfaced in this v1 panel — use the API directly for that path.
        </p>
        <p style={{ color: "#666", margin: "4px 0 0", fontSize: "0.78rem" }}>
          <Link to={`/${encodeURIComponent(novelId)}`} style={{ color: "#9ac" }}>
            ← back to pipeline
          </Link>
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 14,
          padding: 12,
          border: "1px solid #2a2e3c",
          borderRadius: 6,
          background: "#1a1d28",
        }}
      >
        <label style={{ fontSize: "0.82rem", color: "#aaa" }}>
          source{" "}
          <select
            value={filter.source}
            onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}
            style={{ background: "#10131c", color: "#dce", border: "1px solid #2a2e3c", padding: "2px 6px", borderRadius: 3, marginLeft: 4 }}
          >
            <option value="">(any)</option>
            <option value="planner-output">planner-output</option>
            <option value="planning-state-mapper">planning-state-mapper</option>
            <option value="planning-state-repair">planning-state-repair</option>
            <option value="post-draft-extraction">post-draft-extraction</option>
            <option value="human-edit">human-edit</option>
            <option value="corpus-import">corpus-import</option>
          </select>
        </label>
        <label style={{ fontSize: "0.82rem", color: "#aaa" }}>
          chapter{" "}
          <input
            type="number"
            value={filter.chapter}
            onChange={e => setFilter(f => ({ ...f, chapter: e.target.value }))}
            style={{ width: 70, background: "#10131c", color: "#dce", border: "1px solid #2a2e3c", padding: "2px 6px", borderRadius: 3, marginLeft: 4 }}
            placeholder="(any)"
          />
        </label>
        <label style={{ fontSize: "0.82rem", color: "#aaa" }}>
          <input
            type="checkbox"
            checked={filter.plannerOnly}
            onChange={e => setFilter(f => ({ ...f, plannerOnly: e.target.checked }))}
            style={{ marginRight: 4 }}
          />
          planner-only
        </label>
        <button
          onClick={() => setAppliedFilter(filter)}
          style={{
            background: "#2a2e3c",
            border: "1px solid #4a5468",
            color: "#dce",
            padding: "4px 12px",
            borderRadius: 4,
            fontSize: "0.82rem",
            cursor: "pointer",
          }}
        >
          Apply
        </button>
        <button
          onClick={() => {
            setFilter(EMPTY_FILTER)
            setAppliedFilter(EMPTY_FILTER)
          }}
          style={{
            background: "transparent",
            border: "1px solid #2a2e3c",
            color: "#888",
            padding: "4px 10px",
            borderRadius: 4,
            fontSize: "0.78rem",
            cursor: "pointer",
          }}
        >
          Clear
        </button>
        <span style={{ flex: 1 }} />
        <button
          disabled={generating}
          onClick={onGenerate}
          style={{
            background: "#2c3a4a",
            border: "1px solid #6ae",
            color: "#cef",
            padding: "4px 12px",
            borderRadius: 4,
            fontSize: "0.82rem",
            cursor: generating ? "wait" : "pointer",
          }}
          title="Run generatePlannerCanonProposals against the novel's authored outlines (idempotent)."
        >
          {generating ? "Generating…" : "Generate from outline"}
        </button>
      </div>

      {genResult && (
        <p style={{ color: "#aaa", fontSize: "0.84rem", margin: "4px 2px 14px" }}>
          {genResult}
        </p>
      )}
      {error && (
        <p style={{ color: "var(--red, #d65)", padding: "8px 12px", border: "1px solid #d65", borderRadius: 4, marginBottom: 14 }}>
          {error}
        </p>
      )}

      {proposals === null ? (
        <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
      ) : proposals.length === 0 ? (
        <p style={{ color: "#888" }}>
          No pending proposals match the current filter. Try{" "}
          <strong>Generate from outline</strong> if planning has run but
          proposals haven't been created yet (rare — Phase 1.5 auto-wires this
          at the planning-phase boundary).
        </p>
      ) : (
        <table className="guide-table">
          <thead>
            <tr>
              <th style={{ width: 240 }}>Proposal ID</th>
              <th style={{ width: 200 }}>Fact ID</th>
              <th>Kind</th>
              <th>Proposed fact</th>
              <th style={{ width: 170 }}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map(p => (
              <ProposalRow
                key={p.id}
                proposal={p}
                busy={busyId === p.id}
                onResolve={status => onResolve(p.id, status)}
              />
            ))}
          </tbody>
        </table>
      )}

      <p style={{ color: "#666", fontSize: "0.74rem", marginTop: 18 }}>
        Phase 2B (UI) — browser-untested. The underlying API (Phase 2A,
        commit <code>9cf6238</code>) and telemetry (Phase 2A.5,{" "}
        <code>1bec94e</code>) ship with handler tests; this page is the first
        UI surface and is awaiting hand-test verification.
      </p>
    </div>
  )
}
