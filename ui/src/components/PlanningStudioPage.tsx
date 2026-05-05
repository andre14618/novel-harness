import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  createPlanningProposal,
  getPlanningProposalDiff,
  getPlanningTargets,
  listPlanningProposals,
  previewPlanningImpact,
  resolvePlanningProposal,
  type PlanningEditAction,
  type PlanningEditEnvelope,
  type PlanningEditPayload,
  type PlanningImpact,
  type PlanningImpactPreview,
  type PlanningProposalDiffResponse,
  type PlanningTarget,
  type PlanningTargetRef,
  type ProposalEnvelopeStatus,
} from "../api"

const EDITABLE_KINDS = new Set([
  "planning_directive",
  "world_bible",
  "character",
  "story_spine",
  "chapter_outline",
  "beat_plan",
  "beat_obligation",
])

const SUPPORTED_FIELDS: Record<string, string[]> = {
  planning_directive: ["rawNotes", "tonalAnchors"],
  world_bible: [
    "setting",
    "timePeriod",
    "geography",
    "politicalStructure",
    "technologyConstraints",
    "sensoryPalette",
    "culture",
    "history",
  ],
  character: [
    "backstory",
    "goals",
    "fears",
    "speechPattern",
    "internalConflict",
    "avoids",
  ],
  story_spine: ["centralConflict", "theme", "endingDirection"],
  chapter_outline: ["title", "purpose", "setting", "targetWords", "scenes"],
  beat_plan: ["description", "kind", "self", "obligations"],
  beat_obligation: ["text", "sourceId", "sourceKind", "characterId", "sourceLink", "self"],
}

const STATUS_TABS: Array<ProposalEnvelopeStatus | "all"> = ["pending", "approved", "rejected", "modified", "all"]
const BEAT_KINDS = ["action", "dialogue", "interiority", "description"]
const SOURCE_KINDS = ["fact", "knowledge", "state", "payoff"]

type Notice = { kind: "ok" | "error"; text: string } | null

export function PlanningStudioPage() {
  const { novelId } = useParams<{ novelId: string }>()
  const [targets, setTargets] = useState<PlanningTarget[]>([])
  const [targetError, setTargetError] = useState<string | null>(null)
  const [loadingTargets, setLoadingTargets] = useState(true)
  const [selectedKey, setSelectedKey] = useState("")
  const [fieldPath, setFieldPath] = useState("")
  const [proposedText, setProposedText] = useState("")
  const [rationale, setRationale] = useState("")
  const [impact, setImpact] = useState<PlanningImpactPreview | null>(null)
  const [impactError, setImpactError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [status, setStatus] = useState<ProposalEnvelopeStatus | "all">("pending")
  const [proposals, setProposals] = useState<PlanningEditEnvelope[]>([])
  const [loadingProposals, setLoadingProposals] = useState(false)
  const [selectedProposalId, setSelectedProposalId] = useState("")
  const [proposalDiff, setProposalDiff] = useState<PlanningProposalDiffResponse | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null)

  const selectedTarget = useMemo(
    () => targets.find(targetKeyMatches(selectedKey)) ?? null,
    [selectedKey, targets],
  )

  const editableTargets = useMemo(
    () => targets.filter(target => EDITABLE_KINDS.has(target.kind) && target.fieldPaths.length > 0),
    [targets],
  )

  const proposalGroups = useMemo(() => groupPlanningProposals(proposals), [proposals])

  const refreshTargets = useCallback(async () => {
    if (!novelId) return
    setLoadingTargets(true)
    setTargetError(null)
    try {
      const map = await getPlanningTargets(novelId)
      const editable = map.targets
        .map(target => ({
          ...target,
          fieldPaths: supportedFieldPaths(target),
        }))
        .filter(target => EDITABLE_KINDS.has(target.kind) && target.fieldPaths.length > 0)
        .sort(compareTargets)
      setTargets(editable)
      setSelectedKey(current =>
        current && editable.some(targetKeyMatches(current))
          ? current
          : targetKey(editable[0]),
      )
      setFieldPath(current => current || editable[0]?.fieldPaths[0] || "")
    } catch (err) {
      setTargetError((err as Error).message ?? String(err))
    } finally {
      setLoadingTargets(false)
    }
  }, [novelId])

  const refreshProposals = useCallback(async () => {
    if (!novelId) return
    setLoadingProposals(true)
    try {
      const res = await listPlanningProposals(novelId, { status, limit: 100 })
      setProposals(res.envelopes)
      setSelectedProposalId(current =>
        current && res.envelopes.some(env => env.id === current)
          ? current
          : res.envelopes[0]?.id ?? "",
      )
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message ?? String(err) })
    } finally {
      setLoadingProposals(false)
    }
  }, [novelId, status])

  useEffect(() => {
    void refreshTargets()
  }, [refreshTargets])

  useEffect(() => {
    void refreshProposals()
  }, [refreshProposals])

  useEffect(() => {
    if (!selectedTarget) {
      const fallbackTarget = targets[0]
      if (!fallbackTarget) {
        if (selectedKey) setSelectedKey("")
        if (fieldPath) setFieldPath("")
        if (proposedText) setProposedText("")
        return
      }
      const nextFieldPath = fallbackTarget.fieldPaths[0] ?? ""
      setSelectedKey(targetKey(fallbackTarget))
      setFieldPath(nextFieldPath)
      setProposedText(defaultInputValue(nextFieldPath, fallbackTarget.kind))
      return
    }
    if (!fieldPath || !selectedTarget.fieldPaths.includes(fieldPath)) {
      const nextFieldPath = selectedTarget.fieldPaths[0] ?? ""
      setFieldPath(nextFieldPath)
      setProposedText(defaultInputValue(nextFieldPath, selectedTarget.kind))
    }
  }, [fieldPath, proposedText, selectedKey, selectedTarget, targets])

  useEffect(() => {
    if (!novelId || !selectedTarget || !fieldPath) {
      setImpact(null)
      return
    }
    let cancelled = false
    setImpactError(null)
    void previewPlanningImpact(novelId, planningImpactTarget(selectedTarget, fieldPath))
      .then(res => {
        if (!cancelled) setImpact(res)
      })
      .catch(err => {
        if (!cancelled) {
          setImpact(null)
          setImpactError((err as Error).message ?? String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [fieldPath, novelId, selectedTarget])

  useEffect(() => {
    if (!novelId || !selectedProposalId) {
      setProposalDiff(null)
      return
    }
    let cancelled = false
    setDiffError(null)
    void getPlanningProposalDiff(novelId, selectedProposalId)
      .then(res => {
        if (!cancelled) setProposalDiff(res)
      })
      .catch(err => {
        if (!cancelled) {
          setProposalDiff(null)
          setDiffError((err as Error).message ?? String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [novelId, selectedProposalId])

  const createProposal = async () => {
    if (!novelId || !selectedTarget || !fieldPath || creating) return
    setCreating(true)
    setNotice(null)
    try {
      const action = planningEditActionFor(selectedTarget.kind, fieldPath)
      const proposedValue = parseProposedValue(fieldPath, proposedText, selectedTarget.kind)
      const res = await createPlanningProposal(novelId, {
        action,
        target: {
          kind: selectedTarget.kind as any,
          ref: selectedTarget.ref,
          fieldPath,
        },
        proposedValue,
        rationale: rationale.trim() || undefined,
        source: { agent: "planning-studio-ui" },
      })
      setNotice({
        kind: "ok",
        text: `Created ${res.envelope.id}`,
      })
      setRationale("")
      setSelectedProposalId(res.envelope.id)
      await refreshProposals()
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message ?? String(err) })
    } finally {
      setCreating(false)
    }
  }

  const resolveSelected = async (nextStatus: "approved" | "rejected") => {
    if (!novelId || !selectedProposalId || busyProposalId) return
    setBusyProposalId(selectedProposalId)
    setNotice(null)
    try {
      const res = await resolvePlanningProposal(novelId, selectedProposalId, {
        status: nextStatus,
        resolvedBy: "human",
      })
      if (!res.ok) {
        setNotice({ kind: "error", text: resolveErrorText(res) })
        return
      }
      setNotice({ kind: "ok", text: `${nextStatus} ${selectedProposalId}` })
      await Promise.all([refreshTargets(), refreshProposals()])
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message ?? String(err) })
    } finally {
      setBusyProposalId(null)
    }
  }

  const resolveModified = async (modifiedText: string) => {
    if (!novelId || !selectedProposalId || !proposalDiff || busyProposalId) return
    let modifiedPayload: PlanningEditPayload
    try {
      modifiedPayload = {
        action: proposalDiff.diff.action,
        target: proposalDiff.diff.target,
        previousValue: proposalDiff.diff.before.value,
        proposedValue: parseProposedValue(
          proposalDiff.diff.target.fieldPath,
          modifiedText,
          proposalDiff.diff.target.kind,
        ),
        ...(proposalDiff.impactPreview ? { impactPreview: proposalDiff.impactPreview } : {}),
      }
    } catch (err) {
      setNotice({ kind: "error", text: `Invalid modified value: ${(err as Error).message ?? String(err)}` })
      return
    }

    setBusyProposalId(selectedProposalId)
    setNotice(null)
    try {
      const res = await resolvePlanningProposal(novelId, selectedProposalId, {
        status: "modified",
        modifiedPayload,
        resolvedBy: "human",
      })
      if (!res.ok) {
        setNotice({ kind: "error", text: resolveErrorText(res) })
        return
      }
      setNotice({ kind: "ok", text: `modified ${selectedProposalId}` })
      await Promise.all([refreshTargets(), refreshProposals()])
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message ?? String(err) })
    } finally {
      setBusyProposalId(null)
    }
  }

  if (!novelId) return <div className="planning-studio-page">Missing novel id.</div>

  return (
    <div className="planning-studio-page">
      <div className="planning-studio-header">
        <div>
          <h2>Planning Studio</h2>
          <div className="planning-studio-subtitle">
            <code>{novelId}</code>
          </div>
        </div>
        <div className="planning-studio-links">
          <Link to={`/${encodeURIComponent(novelId)}`}>Pipeline</Link>
          <Link to={`/chapter-health/${encodeURIComponent(novelId)}`}>Health</Link>
          <Link to={`/planning-snapshot/${encodeURIComponent(novelId)}`}>Snapshot</Link>
          <Link to={`/canon-proposals/${encodeURIComponent(novelId)}`}>Canon Queue</Link>
        </div>
      </div>

      {notice && (
        <div className={`planning-studio-notice ${notice.kind}`}>
          {notice.text}
        </div>
      )}

      <div className="planning-studio-grid">
        <section className="planning-studio-panel">
          <div className="planning-studio-panel-title">Targets</div>
          {loadingTargets && <div className="planning-muted">Loading targets...</div>}
          {targetError && <div className="planning-error">{targetError}</div>}
          <div className="planning-target-list">
            {editableTargets.map(target => (
              <button
                key={targetKey(target)}
                type="button"
                className={selectedKey === targetKey(target) ? "active" : ""}
                onClick={() => {
                  const nextFieldPath = target.fieldPaths[0] ?? ""
                  setSelectedKey(targetKey(target))
                  setFieldPath(nextFieldPath)
                  setProposedText(defaultInputValue(nextFieldPath, target.kind))
                }}
              >
                <span>{target.label}</span>
                <small>{target.kind} · {target.fieldPaths.length} fields</small>
              </button>
            ))}
          </div>
        </section>

        <section className="planning-studio-panel planning-studio-edit-panel">
          <div className="planning-studio-panel-title">Proposal</div>
          {selectedTarget ? (
            <>
              <div className="planning-target-summary">
                <strong>{selectedTarget.label}</strong>
                <span>{selectedTarget.kind}:{selectedTarget.ref}</span>
                <code>{selectedTarget.currentVersion.slice(0, 16)}...</code>
              </div>

              <label className="planning-field-label">
                Field
                <select
                  value={fieldPath}
                  onChange={event => {
                    setFieldPath(event.target.value)
                    setProposedText(defaultInputValue(event.target.value, selectedTarget.kind))
                  }}
                >
                  {selectedTarget.fieldPaths.map(path => (
                    <option key={path} value={path}>{path}</option>
                  ))}
                </select>
              </label>

              <PlanningValueInput
                fieldPath={fieldPath}
                targetKind={selectedTarget.kind}
                value={proposedText}
                onChange={setProposedText}
              />

              <label className="planning-field-label">
                Rationale
                <textarea
                  value={rationale}
                  onChange={event => setRationale(event.target.value)}
                  rows={3}
                  placeholder="Why should this planning field change?"
                />
              </label>

              <button
                type="button"
                className="planning-primary"
                disabled={creating || proposedText.trim().length === 0}
                onClick={createProposal}
              >
                {creating ? "Creating..." : "Create Proposal"}
              </button>

              <ImpactPreviewView impact={impact} error={impactError} />
            </>
          ) : (
            <div className="planning-muted">No editable planning targets loaded.</div>
          )}
        </section>

        <section className="planning-studio-panel">
          <div className="planning-studio-panel-title">Queue</div>
          <div className="planning-status-tabs">
            {STATUS_TABS.map(tab => (
              <button
                key={tab}
                type="button"
                className={status === tab ? "active" : ""}
                onClick={() => setStatus(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {loadingProposals && <div className="planning-muted">Loading proposals...</div>}
          <div className="planning-proposal-list">
            {proposalGroups.map(group => (
              <div className="planning-proposal-group" key={group.key}>
                <div className="planning-proposal-group-title">
                  <span>{group.label}</span>
                  <small>{group.envelopes.length} proposal{group.envelopes.length === 1 ? "" : "s"}</small>
                </div>
                {group.envelopes.map(envelope => (
                  <button
                    key={envelope.id}
                    type="button"
                    className={selectedProposalId === envelope.id ? "active" : ""}
                    onClick={() => setSelectedProposalId(envelope.id)}
                  >
                    <span>{envelope.summary}</span>
                    <small>
                      {envelope.payload.action}:{envelope.payload.target.fieldPath} · {envelope.status} ·{" "}
                      {envelope.risk} · {envelope.id.slice(0, 38)}
                    </small>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {!loadingProposals && proposals.length === 0 && (
            <div className="planning-muted">No planning proposals match this status.</div>
          )}

          <DiffView
            diff={proposalDiff}
            error={diffError}
            busy={busyProposalId === selectedProposalId}
            onApprove={() => resolveSelected("approved")}
            onReject={() => resolveSelected("rejected")}
            onModify={resolveModified}
          />
        </section>
      </div>
    </div>
  )
}

function PlanningValueInput({
  fieldPath,
  targetKind,
  label = "Proposed value",
  value,
  onChange,
}: {
  fieldPath: string
  targetKind?: string
  label?: string
  value: string
  onChange: (value: string) => void
}) {
  if (fieldPath === "targetWords") {
    return (
      <label className="planning-field-label">
        {label}
        <input
          type="number"
          min={1}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      </label>
    )
  }
  if (fieldPath === "kind" || fieldPath === "sourceKind") {
    const options = fieldPath === "kind" ? BEAT_KINDS : SOURCE_KINDS
    return (
      <label className="planning-field-label">
        {label}
        <select value={value} onChange={event => onChange(event.target.value)}>
          <option value="">Select...</option>
          {options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    )
  }
  return (
    <label className="planning-field-label">
      {label}
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        rows={textareaRowsForField(fieldPath)}
        placeholder={placeholderForField(fieldPath, targetKind)}
      />
    </label>
  )
}

function ImpactPreviewView({
  impact,
  error,
}: {
  impact: PlanningImpactPreview | null
  error: string | null
}) {
  return (
    <div className="planning-preview-block">
      <div className="planning-preview-title">Impact preview</div>
      {error && <div className="planning-error">{error}</div>}
      {!impact && !error && <div className="planning-muted">Select a target field to preview impact.</div>}
      {impact && <ImpactList impacts={impact.impacts} />}
    </div>
  )
}

function ImpactList({
  impacts,
}: {
  impacts: CompactImpact[]
}) {
  return (
    <>
      <div className="planning-impact-summary">
        {impacts.length} deterministic impact{impacts.length === 1 ? "" : "s"}
      </div>
      <ul>
        {impacts.slice(0, 8).map((item, index) => (
          <li key={`${item.kind}-${index}`}>
            <strong>{item.kind}</strong>
            <span>{item.reason}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function DiffView({
  diff,
  error,
  busy,
  onApprove,
  onReject,
  onModify,
}: {
  diff: PlanningProposalDiffResponse | null
  error: string | null
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onModify: (modifiedText: string) => void | Promise<void>
}) {
  const [editingModified, setEditingModified] = useState(false)
  const [modifiedText, setModifiedText] = useState("")
  const [editError, setEditError] = useState<string | null>(null)

  useEffect(() => {
    setEditingModified(false)
    setEditError(null)
    setModifiedText(
      diff
        ? editableInputValue(
          diff.diff.target.fieldPath,
          diff.diff.after.value,
          diff.diff.after.display,
          diff.diff.target.kind,
        )
        : "",
    )
  }, [diff?.envelopeId])

  if (error) return <div className="planning-error">{error}</div>
  if (!diff) return <div className="planning-muted">Select a proposal to inspect its diff.</div>
  const canResolve = diff.status === "pending"
  const targetStatusClass = !diff.currentTarget?.stale ? "fresh" : canResolve ? "stale" : "moved"
  const targetStatusLabel = !diff.currentTarget?.stale ? "current" : canResolve ? "stale" : "target moved"
  const diffImpacts = impactsFromPreview(diff.impactPreview)
  const submitModified = () => {
    try {
      parseProposedValue(diff.diff.target.fieldPath, modifiedText, diff.diff.target.kind)
    } catch (err) {
      setEditError((err as Error).message ?? String(err))
      return
    }
    setEditError(null)
    void onModify(modifiedText)
  }
  return (
    <div className="planning-diff">
      <div className="planning-diff-meta">
        <span>{diff.target.kind}:{diff.target.ref}</span>
        <span>{diff.target.fieldPath}</span>
        <span className={targetStatusClass}>{targetStatusLabel}</span>
      </div>
      <div className="planning-diff-columns">
        <div>
          <div className="planning-preview-title">Before</div>
          <pre>{diff.diff.before.display || "(empty)"}</pre>
        </div>
        <div>
          <div className="planning-preview-title">After</div>
          <pre>{diff.diff.after.display || "(empty)"}</pre>
        </div>
      </div>
      {diffImpacts.length > 0 && (
        <div className="planning-preview-block planning-diff-impact">
          <div className="planning-preview-title">Queue impact</div>
          <ImpactList impacts={diffImpacts} />
        </div>
      )}
      {canResolve && (
        <>
          {editingModified && (
            <div className="planning-modify-box">
              <PlanningValueInput
                fieldPath={diff.diff.target.fieldPath}
                targetKind={diff.diff.target.kind}
                label="Modified value"
                value={modifiedText}
                onChange={setModifiedText}
              />
              {editError && <div className="planning-error">{editError}</div>}
            </div>
          )}
          <div className="planning-resolve-actions">
            <button className="planning-approve" type="button" disabled={busy} onClick={onApprove}>Approve</button>
            {editingModified ? (
              <button
                className="planning-modify"
                type="button"
                disabled={busy || modifiedText.trim().length === 0}
                onClick={submitModified}
              >
                Resolve Modified
              </button>
            ) : (
              <button className="planning-modify" type="button" disabled={busy} onClick={() => setEditingModified(true)}>Edit</button>
            )}
            <button className="planning-reject" type="button" disabled={busy} onClick={onReject}>Reject</button>
            {editingModified && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditError(null)
                  setEditingModified(false)
                  setModifiedText(
                    editableInputValue(
                      diff.diff.target.fieldPath,
                      diff.diff.after.value,
                      diff.diff.after.display,
                      diff.diff.target.kind,
                    ),
                  )
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

type CompactImpact = Pick<PlanningImpact, "kind" | "reason">

interface ProposalGroup {
  key: string
  label: string
  envelopes: PlanningEditEnvelope[]
}

function groupPlanningProposals(envelopes: PlanningEditEnvelope[]): ProposalGroup[] {
  const groups = new Map<string, ProposalGroup>()
  for (const envelope of envelopes) {
    const target = envelope.payload.target
    const key = `${target.kind}:${target.ref}`
    const existing = groups.get(key)
    if (existing) {
      existing.envelopes.push(envelope)
      continue
    }
    groups.set(key, {
      key,
      label: key,
      envelopes: [envelope],
    })
  }
  return Array.from(groups.values())
}

function impactsFromPreview(preview: unknown): CompactImpact[] {
  if (!preview || typeof preview !== "object") return []
  const impacts = (preview as { impacts?: unknown }).impacts
  if (!Array.isArray(impacts)) return []
  return impacts.flatMap(item => {
    if (!item || typeof item !== "object") return []
    const impact = item as { kind?: unknown; reason?: unknown }
    if (typeof impact.kind !== "string" || typeof impact.reason !== "string") return []
    return [{ kind: impact.kind, reason: impact.reason }]
  })
}

function editableInputValue(fieldPath: string, value: unknown, display: string, targetKind?: string): string {
  if (fieldPath === "tonalAnchors" && Array.isArray(value)) {
    return value.map(item => String(item)).join("\n")
  }
  if (fieldPath === "scenes" && Array.isArray(value)) {
    return value.map(item => String(item)).join("\n")
  }
  if (fieldPath === "sourceLink" || fieldPath === "self" || fieldPath === "obligations") {
    return JSON.stringify(value ?? defaultStructuredValue(fieldPath, targetKind), null, 2)
  }
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return display || JSON.stringify(value, null, 2)
}

function resolveErrorText(res: { error?: string; expectedVersion?: string; actualVersion?: string }): string {
  if (res.error === "stale-precondition") {
    return `Stale target: expected ${res.expectedVersion?.slice(0, 12)} but found ${res.actualVersion?.slice(0, 12)}`
  }
  return res.error ?? "proposal resolve failed"
}

function targetKey(target: PlanningTarget | undefined): string {
  return target ? `${target.kind}:${target.ref}` : ""
}

function targetKeyMatches(key: string): (target: PlanningTarget) => boolean {
  return target => targetKey(target) === key
}

function compareTargets(a: PlanningTarget, b: PlanningTarget): number {
  return (
    a.kind.localeCompare(b.kind) ||
    (a.location?.chapterNumber ?? 0) - (b.location?.chapterNumber ?? 0) ||
    (a.location?.beatIndex ?? -1) - (b.location?.beatIndex ?? -1) ||
    a.label.localeCompare(b.label)
  )
}

function supportedFieldPaths(target: PlanningTarget): string[] {
  const supported = SUPPORTED_FIELDS[target.kind] ?? []
  const fields = supported.filter(field => target.fieldPaths.includes(field))
  if (target.kind === "beat_plan" && supported.includes("self")) fields.push("self")
  if (
    target.kind === "beat_plan" &&
    target.fieldPaths.includes("obligations") &&
    supported.includes("obligations") &&
    !fields.includes("obligations")
  ) {
    fields.push("obligations")
  }
  if (target.kind === "beat_obligation" && supported.includes("self")) fields.push("self")
  if (
    target.kind === "chapter_outline" &&
    target.fieldPaths.includes("scenes") &&
    supported.includes("scenes") &&
    !fields.includes("scenes")
  ) {
    fields.push("scenes")
  }
  return Array.from(new Set(fields))
}

function planningEditActionFor(targetKind: string, fieldPath: string): PlanningEditAction {
  if (targetKind === "chapter_outline" && fieldPath === "scenes") return "beat_reorder"
  if (targetKind === "beat_plan" && fieldPath === "self") return "beat_replace"
  if (targetKind === "beat_plan" && fieldPath === "obligations") return "beat_obligation_reorder"
  if (targetKind === "beat_obligation" && fieldPath === "self") return "beat_obligation_replace"
  return "field_replace"
}

function planningImpactTarget(target: PlanningTarget, fieldPath: string): PlanningTargetRef {
  if (fieldPath === "self" || fieldPath === "obligations") {
    return { kind: target.kind, ref: target.ref }
  }
  return { kind: target.kind, ref: target.ref, fieldPath }
}

function parseProposedValue(fieldPath: string, raw: string, targetKind?: string): unknown {
  if (fieldPath === "targetWords") {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 1) throw new Error("targetWords must be a positive number")
    return parsed
  }
  if (fieldPath === "tonalAnchors") {
    return raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  }
  if (fieldPath === "sourceLink") return JSON.parse(raw)
  if (fieldPath === "scenes") return parseIdList(raw, "scenes")
  if (fieldPath === "self") return parseJsonObject(raw, targetKind === "beat_obligation" ? "obligation" : "beat")
  if (fieldPath === "obligations") {
    const parsed = parseJsonObject(raw, "obligation reorder")
    const listKey = parsed.listKey
    const order = parsed.order
    if (typeof listKey !== "string" || listKey.trim().length === 0) {
      throw new Error("obligation reorder must include a listKey")
    }
    return { ...parsed, listKey: listKey.trim(), order: parseStringArray(order, "order") }
  }
  return raw
}

function defaultInputValue(fieldPath: string, _targetKind?: string): string {
  if (fieldPath === "sourceLink") {
    return JSON.stringify({ sourceId: "", sourceKind: "fact" }, null, 2)
  }
  return ""
}

function placeholderForField(fieldPath: string, targetKind?: string): string {
  if (fieldPath === "tonalAnchors") return "One tonal anchor per line"
  if (fieldPath === "sourceLink") return "{\n  \"sourceId\": \"fact-example\",\n  \"sourceKind\": \"fact\"\n}"
  if (fieldPath === "scenes") return "One beatId per line, in the desired chapter order"
  if (fieldPath === "self" && targetKind === "beat_plan") {
    return "{\n  \"beatId\": \"new-beat-id\",\n  \"description\": \"Replacement beat text\",\n  \"kind\": \"dialogue\",\n  \"characters\": [],\n  \"requiredPayoffs\": [],\n  \"obligations\": {}\n}"
  }
  if (fieldPath === "self" && targetKind === "beat_obligation") {
    return "{\n  \"obligationId\": \"new-obligation-id\",\n  \"text\": \"Replacement obligation\",\n  \"sourceId\": \"fact-example\",\n  \"sourceKind\": \"fact\"\n}"
  }
  if (fieldPath === "obligations") {
    return "{\n  \"listKey\": \"mustEstablish\",\n  \"order\": [\"obligation-id-a\", \"obligation-id-b\"]\n}"
  }
  return "Enter proposed value"
}

function textareaRowsForField(fieldPath: string): number {
  if (fieldPath === "sourceLink") return 6
  if (fieldPath === "self" || fieldPath === "obligations") return 10
  if (fieldPath === "scenes") return 7
  return 5
}

function defaultStructuredValue(fieldPath: string, targetKind?: string): unknown {
  if (fieldPath === "sourceLink") return { sourceId: "", sourceKind: "fact" }
  if (fieldPath === "self" && targetKind === "beat_obligation") {
    return { obligationId: "", text: "", sourceId: "", sourceKind: "fact" }
  }
  if (fieldPath === "self") {
    return {
      beatId: "",
      description: "",
      kind: "dialogue",
      characters: [],
      requiredPayoffs: [],
      obligations: {},
    }
  }
  if (fieldPath === "obligations") return { listKey: "", order: [] }
  return null
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function parseIdList(raw: string, label: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith("[")) {
    return parseStringArray(JSON.parse(trimmed), label)
  }
  return parseStringArray(trimmed.split(/[\r\n,]+/), label)
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of stable IDs`)
  const items = value.map(item => String(item).trim()).filter(Boolean)
  if (items.length === 0) throw new Error(`${label} must include at least one stable ID`)
  if (new Set(items).size !== items.length) throw new Error(`${label} cannot contain duplicate IDs`)
  return items
}
