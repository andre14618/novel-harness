import { useCallback, useEffect, useRef, useState } from "react"
import {
  adjustNovel, getBeats, getCharacters, getChapterDraft, getOutlines, getStorySpine, getWorldBible, listProposalEnvelopes,
  redraftChapter, resolveProposalEnvelope, updateCharacter, updateStorySpine, updateWorldBible,
  type AdjustTurn, type AdjusterPatch, type ArtifactPatchEnvelope, type BeatData,
} from "../api"

type ArtifactKey = "world" | "characters" | "spine" | "outlines" | "adjust"

interface Props {
  novelId: string | null
  refreshKey: number
}

interface Artifacts {
  world: any | null
  characters: any[] | null
  spine: any | null
  outlines: any[] | null
}

const EMPTY: Artifacts = { world: null, characters: null, spine: null, outlines: null }

export function ArtifactPreviews({ novelId, refreshKey }: Props) {
  const [artifacts, setArtifacts] = useState<Artifacts>(EMPTY)
  const [expanded, setExpanded] = useState<ArtifactKey | null>(null)
  const [loading, setLoading] = useState(false)
  const [localBump, setLocalBump] = useState(0)

  const fetchAll = useCallback(async (id: string) => {
    setLoading(true)
    const [world, characters, spine, outlines] = await Promise.allSettled([
      getWorldBible(id),
      getCharacters(id),
      getStorySpine(id),
      getOutlines(id),
    ])
    setArtifacts({
      world:      world.status      === "fulfilled" ? world.value      : null,
      characters: characters.status === "fulfilled" ? characters.value : null,
      spine:      spine.status      === "fulfilled" ? spine.value      : null,
      outlines:   outlines.status   === "fulfilled" ? outlines.value   : null,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!novelId) { setArtifacts(EMPTY); return }
    fetchAll(novelId)
  }, [novelId, refreshKey, localBump, fetchAll])

  if (!novelId) return null

  const has = {
    world:      !!artifacts.world,
    characters: !!(artifacts.characters && artifacts.characters.length),
    spine:      !!artifacts.spine,
    outlines:   !!(artifacts.outlines && artifacts.outlines.length),
  }
  const anyArtifact = has.world || has.characters || has.spine || has.outlines
  if (!anyArtifact && !loading) return null

  const toggle = (k: ArtifactKey) => setExpanded(prev => prev === k ? null : k)
  const refresh = () => setLocalBump(x => x + 1)

  return (
    <div className="artifact-previews">
      <div className="artifact-tabs">
        <TabButton label="World"      count={has.world ? 1 : 0}                          active={expanded === "world"}      disabled={!has.world}      onClick={() => toggle("world")} />
        <TabButton label="Characters" count={artifacts.characters?.length ?? 0}          active={expanded === "characters"} disabled={!has.characters} onClick={() => toggle("characters")} />
        <TabButton label="Plot"       count={has.spine ? 1 : 0}                          active={expanded === "spine"}      disabled={!has.spine}      onClick={() => toggle("spine")} />
        <TabButton label="Chapters"   count={artifacts.outlines?.length ?? 0}            active={expanded === "outlines"}   disabled={!has.outlines}   onClick={() => toggle("outlines")} />
        <TabButton label="Adjust ✦"   count={0}                                          active={expanded === "adjust"}     disabled={!anyArtifact}    onClick={() => toggle("adjust")} />
      </div>
      {expanded === "world"      && artifacts.world      && <WorldPreview     novelId={novelId} world={artifacts.world} onSaved={refresh} />}
      {expanded === "characters" && artifacts.characters && <CharactersPreview novelId={novelId} characters={artifacts.characters} onSaved={refresh} />}
      {expanded === "spine"      && artifacts.spine      && <SpinePreview     novelId={novelId} spine={artifacts.spine} onSaved={refresh} />}
      {expanded === "outlines"   && artifacts.outlines   && <OutlinesPreview  novelId={novelId} outlines={artifacts.outlines} />}
      {expanded === "adjust"     &&                          <AdjustPanel     novelId={novelId} characters={artifacts.characters ?? []} onApplied={refresh} />}
    </div>
  )
}

function TabButton(props: { label: string; count: number; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      className={`artifact-tab${props.active ? " active" : ""}${props.disabled ? " disabled" : ""}`}
      onClick={props.disabled ? undefined : props.onClick}
      disabled={props.disabled}
      title={props.disabled ? "Not generated yet" : ""}
    >
      {props.label}{props.count > 0 && <span className="artifact-tab-count">{props.count}</span>}
    </button>
  )
}

// ── Editable field helpers ─────────────────────────────────────────────

function EditableText(props: {
  label: string
  value: string
  multiline?: boolean
  onSave: (next: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.value)
  const [saving, setSaving] = useState(false)

  if (!editing) {
    return (
      <div className="artifact-section">
        <div className="artifact-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{props.label}</span>
          <button
            onClick={() => { setDraft(props.value); setEditing(true) }}
            style={{ fontSize: "0.72em", padding: "1px 6px", cursor: "pointer" }}
          >Edit</button>
        </div>
        <p style={{ whiteSpace: "pre-wrap" }}>{props.value || <em style={{ opacity: 0.5 }}>(empty)</em>}</p>
      </div>
    )
  }

  return (
    <div className="artifact-section">
      <div className="artifact-section-title">{props.label}</div>
      {props.multiline
        ? <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} style={{ width: "100%", boxSizing: "border-box" }} />
        : <input value={draft} onChange={e => setDraft(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />}
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try { await props.onSave(draft); setEditing(false) }
            catch (err) { alert(`Save failed: ${(err as Error).message}`) }
            finally { setSaving(false) }
          }}
        >{saving ? "Saving…" : "Save"}</button>
        <button disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  )
}

function EditableList(props: {
  label: string
  values: string[]
  onSave: (next: string[]) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.values.join("\n"))
  const [saving, setSaving] = useState(false)

  if (!editing) {
    return (
      <div className="artifact-section">
        <div className="artifact-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{props.label}</span>
          <button
            onClick={() => { setDraft(props.values.join("\n")); setEditing(true) }}
            style={{ fontSize: "0.72em", padding: "1px 6px", cursor: "pointer" }}
          >Edit</button>
        </div>
        <ul>{props.values.map((v, i) => <li key={i}>{v}</li>)}</ul>
      </div>
    )
  }

  return (
    <div className="artifact-section">
      <div className="artifact-section-title">{props.label} (one per line)</div>
      <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={5} style={{ width: "100%", boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try {
              const next = draft.split("\n").map(s => s.trim()).filter(Boolean)
              await props.onSave(next)
              setEditing(false)
            } catch (err) { alert(`Save failed: ${(err as Error).message}`) }
            finally { setSaving(false) }
          }}
        >{saving ? "Saving…" : "Save"}</button>
        <button disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  )
}

// ── Previews ──────────────────────────────────────────────────────────

function WorldPreview({ novelId, world, onSaved }: { novelId: string; world: any; onSaved: () => void }) {
  const systems: any[] = world.systems ?? []
  const cultures: any[] = world.cultures ?? []
  const locations: any[] = world.locations ?? []
  const save = async (patch: Record<string, unknown>) => { await updateWorldBible(novelId, patch); onSaved() }
  return (
    <div className="artifact-body">
      <EditableText label="Setting"                 value={world.setting ?? ""}               multiline onSave={v => save({ setting: v })} />
      <EditableText label="Time period"             value={world.timePeriod ?? ""}                      onSave={v => save({ timePeriod: v })} />
      <EditableText label="Geography"               value={world.geography ?? ""}             multiline onSave={v => save({ geography: v })} />
      <EditableText label="Political structure"     value={world.politicalStructure ?? ""}    multiline onSave={v => save({ politicalStructure: v })} />
      <EditableText label="Technology / magic"      value={world.technologyConstraints ?? ""} multiline onSave={v => save({ technologyConstraints: v })} />
      <EditableText label="Sensory palette"         value={world.sensoryPalette ?? ""}        multiline onSave={v => save({ sensoryPalette: v })} />
      <EditableText label="Culture"                 value={world.culture ?? ""}               multiline onSave={v => save({ culture: v })} />
      <EditableText label="History"                 value={world.history ?? ""}               multiline onSave={v => save({ history: v })} />
      <EditableList label="Social customs"          values={world.socialCustoms ?? []}                 onSave={v => save({ socialCustoms: v })} />
      <EditableList label="World rules"             values={world.rules ?? []}                         onSave={v => save({ rules: v })} />
      {systems.length > 0 && <Section title={`Systems (${systems.length})`}>
        <ul>{systems.map((s, i) => <li key={i}><strong>{s.name}</strong>{s.description ? ` — ${s.description}` : ""}</li>)}</ul>
      </Section>}
      {cultures.length > 0 && <Section title={`Cultures (${cultures.length})`}>
        <ul>{cultures.map((c, i) => <li key={i}><strong>{c.name}</strong>{c.description ? ` — ${c.description}` : ""}</li>)}</ul>
      </Section>}
      {locations.length > 0 && <Section title={`Locations (${locations.length})`}>
        <ul>{locations.map((l, i) => <li key={i}><strong>{l.name}</strong>{l.description ? ` — ${l.description}` : ""}</li>)}</ul>
      </Section>}
    </div>
  )
}

function CharactersPreview({ novelId, characters, onSaved }: { novelId: string; characters: any[]; onSaved: () => void }) {
  return (
    <div className="artifact-body">
      {characters.map((c, i) => (
        <CharacterCard key={c.id ?? i} novelId={novelId} character={c} onSaved={onSaved} />
      ))}
    </div>
  )
}

function CharacterCard({ novelId, character, onSaved }: { novelId: string; character: any; onSaved: () => void }) {
  const save = async (patch: Record<string, unknown>) => {
    await updateCharacter(novelId, character.id, patch as any)
    onSaved()
  }
  return (
    <div className="artifact-character" style={{ borderBottom: "1px solid #333", paddingBottom: 10, marginBottom: 10 }}>
      <div className="artifact-character-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>{character.name}</strong>
        {character.role && <span className="artifact-badge">{character.role}</span>}
      </div>
      <EditableText label="Name (proper name)"   value={character.name ?? ""}             onSave={v => save({ name: v })} />
      <EditableText label="Role"                 value={character.role ?? ""}             onSave={v => save({ role: v })} />
      <EditableText label="Wants (goals)"        value={character.goals ?? ""}            multiline onSave={v => save({ goals: v })} />
      <EditableText label="Fears"                value={character.fears ?? ""}            multiline onSave={v => save({ fears: v })} />
      <EditableText label="Internal conflict"    value={character.internalConflict ?? ""} multiline onSave={v => save({ internalConflict: v })} />
      <EditableText label="Avoids"               value={character.avoids ?? ""}           multiline onSave={v => save({ avoids: v })} />
      <EditableText label="Backstory"            value={character.backstory ?? ""}        multiline onSave={v => save({ backstory: v })} />
      <EditableText label="Speech pattern"       value={character.speechPattern ?? ""}    multiline onSave={v => save({ speechPattern: v })} />
      <EditableList label="Traits"               values={character.traits ?? []}                    onSave={v => save({ traits: v })} />
    </div>
  )
}

function SpinePreview({ novelId, spine, onSaved }: { novelId: string; spine: any; onSaved: () => void }) {
  const acts: any[] = spine.acts ?? []
  const save = async (patch: Record<string, unknown>) => { await updateStorySpine(novelId, patch); onSaved() }
  return (
    <div className="artifact-body">
      <EditableText label="Central conflict" value={spine.centralConflict ?? ""} multiline onSave={v => save({ centralConflict: v })} />
      <EditableText label="Theme"            value={spine.theme ?? ""}           multiline onSave={v => save({ theme: v })} />
      <EditableText label="Ending direction" value={spine.endingDirection ?? ""} multiline onSave={v => save({ endingDirection: v })} />
      {acts.length > 0 && (
        <Section title="Acts">
          <ol>{acts.map((a, i) => (
            <li key={i}>
              <strong>{a.title ?? `Act ${i + 1}`}</strong>
              {a.summary && <> — {a.summary}</>}
            </li>
          ))}</ol>
        </Section>
      )}
    </div>
  )
}

// ── Adjust chat ───────────────────────────────────────────────────────

type EnvelopeRowState =
  | { kind: "pending" }
  | { kind: "busy" }
  | { kind: "done"; status: "approved" | "rejected" | "modified"; newVersion?: string }
  | { kind: "stale"; expectedVersion: string; actualVersion: string }
  | { kind: "error"; message: string }

function AdjustPanel({ novelId, characters, onApplied }: { novelId: string; characters: any[]; onApplied: () => void }) {
  const [turns, setTurns] = useState<AdjustTurn[]>([])
  const [pendingPatches, setPendingPatches] = useState<AdjusterPatch[]>([])
  // Phase 3 commit 2.5: per-envelope state. The envelopes are the authoritative
  // proposal projection (Phase 3 commit 1) — we keep `pendingPatches` only as
  // the apply-all back-compat fallback when the server doesn't return
  // envelopes.
  const [envelopes, setEnvelopes] = useState<ArtifactPatchEnvelope[]>([])
  const [envelopeStates, setEnvelopeStates] = useState<Record<string, EnvelopeRowState>>({})
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [applying, setApplying] = useState(false)
  // Phase 3 commit 4 follow-up D — audit-history view. Collapsed by default;
  // fetches on first expand and refreshes when novelId changes (if visible).
  // Skip pagination — the MVP renders all rows reverse-chronological.
  const [showHistory, setShowHistory] = useState(false)
  const [historyEnvelopes, setHistoryEnvelopes] = useState<ArtifactPatchEnvelope[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [turns])

  // Phase 3 commit 4 follow-up D — fetch audit history when revealed.
  // Re-fetches on every novelId change so the history reflects the active
  // novel even when the panel is already expanded. The fetch returns ALL
  // statuses; the renderer filters to non-pending (pending rows are
  // already shown in the active batch above so duplicating them here
  // would be noisy).
  const fetchHistory = async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await listProposalEnvelopes(novelId, { status: "all", limit: 200 })
      setHistoryEnvelopes(res.envelopes ?? [])
    } catch (err) {
      setHistoryError((err as Error).message ?? String(err))
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (showHistory) void fetchHistory()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory, novelId])

  // Phase 3 commit 4 follow-up C — seed pending envelopes on session open.
  // Without this, prior-session pending proposals are invisible until the
  // operator types a new /adjust message (which would also discard them).
  // The fetch is best-effort: a 404 / 500 / network error logs and leaves
  // the panel empty; the operator can still drive a fresh /adjust turn.
  //
  // OpenCode review MEDIUM G: when novelId changes, we must reset ALL
  // panel state first so novel A's envelopes / chat / pending-patches
  // don't leak into novel B. The previous `prev.length > 0 ? prev : envs`
  // guard preserved A's envelopes if B's fetch returned empty — a real
  // bug if the operator switches novels mid-conversation. Reset is now
  // unconditional on novelId change; the seed runs against the cleared
  // state.
  const seededNovelIdRef = useRef<string | null>(null)
  useEffect(() => {
    let cancelled = false
    // Reset all conversation + envelope state on novel change. The
    // `seededNovelIdRef` tracks which novel is currently displayed so
    // the seed below can detect cross-novel resumes (vs the very first
    // mount, which has the same novelId throughout).
    if (seededNovelIdRef.current !== null && seededNovelIdRef.current !== novelId) {
      setTurns([])
      setPendingPatches([])
      setEnvelopes([])
      setEnvelopeStates({})
      setInput("")
      setHistoryEnvelopes([])
      setHistoryError(null)
    }
    seededNovelIdRef.current = novelId

    void (async () => {
      try {
        const res = await listProposalEnvelopes(novelId, { status: "pending" })
        if (cancelled) return
        // Re-check that the active novel is still the one we fetched
        // for — a fast novel-switch could leave us with a stale fetch.
        if (seededNovelIdRef.current !== novelId) return
        const envs = res.envelopes ?? []
        if (envs.length === 0) return
        // Don't clobber an in-flight conversation on the SAME novel —
        // only seed when the panel is in its initial empty state. After
        // the first /adjust turn the conversation owns envelope state.
        setEnvelopes(prev => (prev.length > 0 ? prev : envs))
        setEnvelopeStates(prev => {
          if (Object.keys(prev).length > 0) return prev
          const initial: Record<string, EnvelopeRowState> = {}
          for (const e of envs) initial[e.id] = { kind: "pending" }
          return initial
        })
      } catch (err) {
        console.warn("[AdjustPanel] failed to load persisted envelopes:", err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [novelId])

  const sendMessage = async (
    msg: string,
    opts: { parentEnvelopeId?: string } = {},
  ) => {
    if (!msg || sending) return
    setSending(true)
    const next = [...turns, { role: "user" as const, content: msg }]
    setTurns(next)
    setPendingPatches([])
    setEnvelopes([])
    setEnvelopeStates({})
    try {
      const res = await adjustNovel(novelId, msg, turns, opts)
      setTurns([...next, { role: "assistant", content: res.assistantMessage }])
      setPendingPatches(res.proposedPatches ?? [])
      const fresh = res.proposalEnvelopes ?? []
      setEnvelopes(fresh)
      const initial: Record<string, EnvelopeRowState> = {}
      for (const e of fresh) initial[e.id] = { kind: "pending" }
      setEnvelopeStates(initial)
    } catch (err) {
      setTurns([...next, { role: "assistant", content: `(Error: ${(err as Error).message})` }])
    } finally {
      setSending(false)
    }
  }

  const send = async () => {
    const msg = input.trim()
    if (!msg) return
    setInput("")
    await sendMessage(msg)
  }

  /**
   * Phase 3 commit 3 — regenerate-on-stale. Re-fires the conversational
   * /adjust route with the original userMessage from the stale envelope,
   * so the LLM can re-derive the patch given the latest artifact state.
   * The current envelope batch is replaced with the fresh response.
   *
   * Per design doc constraint "without changing its model task" — same
   * route, same system prompt, just refreshed artifact context. No new
   * server-side surface.
   *
   * Phase 3 commit 4 follow-up B — passes the stale envelope's id as
   * `parentEnvelopeId`. Each new envelope's `source.parentEnvelopeId`
   * carries the supersession link, persisted to
   * `proposal_envelopes.parent_envelope_id`. The deterministic id seed
   * is unchanged (lineage is provenance, not identity), so a regen that
   * happens to derive the same patch on the same target version produces
   * the same envelope id — `INSERT … ON CONFLICT (id) DO NOTHING` then
   * preserves the original envelope's lineage rather than overwriting it.
   */
  const regenerateFromEnvelope = async (envelope: ArtifactPatchEnvelope) => {
    const original = envelope.source.userMessage
    if (!original) {
      setEnvelopeStates(prev => ({
        ...prev,
        [envelope.id]: {
          kind: "error",
          message:
            "cannot regenerate — original userMessage missing from envelope source",
        },
      }))
      return
    }
    await sendMessage(original, { parentEnvelopeId: envelope.id })
  }

  const applyAll = async () => {
    if (!pendingPatches.length) return
    setApplying(true)
    try {
      for (const p of pendingPatches) {
        if (p.type === "characterUpdate") await updateCharacter(novelId, p.characterId, p.patch as any)
        else if (p.type === "characterRename") await updateCharacter(novelId, p.characterId, { name: p.newName })
        else if (p.type === "worldUpdate") await updateWorldBible(novelId, p.patch)
        else if (p.type === "spineUpdate") await updateStorySpine(novelId, p.patch)
      }
      setTurns(prev => [...prev, { role: "assistant", content: `Applied ${pendingPatches.length} change${pendingPatches.length === 1 ? "" : "s"}.` }])
      setPendingPatches([])
      setEnvelopes([])
      setEnvelopeStates({})
      onApplied()
    } catch (err) {
      alert(`Apply failed: ${(err as Error).message}`)
    } finally {
      setApplying(false)
    }
  }

  const resolveEnvelope = async (
    envelope: ArtifactPatchEnvelope,
    status: "approved" | "rejected",
  ) => {
    setEnvelopeStates(prev => ({ ...prev, [envelope.id]: { kind: "busy" } }))
    try {
      const res = await resolveProposalEnvelope(novelId, { envelope, status })
      if (!res.ok) {
        // Treat 409 as a non-fatal "stale" outcome; everything else as
        // an error surface the operator can read.
        if (res.error === "stale-precondition" && res.expectedVersion && res.actualVersion) {
          setEnvelopeStates(prev => ({
            ...prev,
            [envelope.id]: {
              kind: "stale",
              expectedVersion: res.expectedVersion!,
              actualVersion: res.actualVersion!,
            },
          }))
          return
        }
        setEnvelopeStates(prev => ({
          ...prev,
          [envelope.id]: { kind: "error", message: res.error ?? "unknown error" },
        }))
        return
      }
      setEnvelopeStates(prev => ({
        ...prev,
        [envelope.id]: {
          kind: "done",
          status: res.status ?? status,
          newVersion: res.newVersion,
        },
      }))
      if (res.applied) onApplied()
    } catch (err) {
      setEnvelopeStates(prev => ({
        ...prev,
        [envelope.id]: { kind: "error", message: (err as Error).message },
      }))
    }
  }

  /**
   * Phase 3 commit 5a — bulk quick actions. Loops `resolveEnvelope` over
   * every envelope whose current state is `pending` (skipping busy / done /
   * stale / error rows so we don't double-resolve or stomp on operator
   * decisions already made on this batch).
   *
   * Per the design's §"Add quick actions: accept all low-risk, reject
   * all" — these are the two bounded actions that don't fire LLM calls.
   * "Ask for alternatives" and "Explain patch" defer to a separate commit
   * because they need transport-stub infrastructure for tests.
   *
   * We rely on the per-row resolve route (Phase 3 commit 2) for both
   * concurrency safety (atomic compare-and-apply) and stale-precondition
   * handling. A row that turns stale mid-bulk surfaces as a stale card
   * just like a single-row resolve would; the bulk continues with the
   * remaining pending rows.
   */
  const bulkResolve = async (filter: "all" | "low-risk") => {
    const targets = envelopes.filter(env => {
      const state = envelopeStates[env.id]
      if (state && state.kind !== "pending") return false
      if (filter === "low-risk") return env.risk === "low"
      return true
    })
    if (targets.length === 0) return
    const action = filter === "low-risk" ? "approved" : "rejected"
    const verb = filter === "low-risk" ? "approve all low-risk" : "reject all"
    if (!window.confirm(`${verb} ${targets.length} proposal${targets.length === 1 ? "" : "s"}?`)) return
    // Sequential to keep server load + apply ordering predictable. Each
    // resolveEnvelope call is its own atomic transaction server-side, so
    // sequential vs parallel is purely a client-side choice.
    for (const env of targets) {
      // eslint-disable-next-line no-await-in-loop
      await resolveEnvelope(env, action as "approved" | "rejected")
    }
  }

  const charName = (id: string) => characters.find(c => c.id === id)?.name ?? id

  return (
    <div className="artifact-body">
      <div style={{ fontSize: "0.85em", opacity: 0.75, marginBottom: 8 }}>
        Describe a change to the world, a character, or the plot. The model proposes edits; click Apply to commit.
      </div>
      <div
        ref={logRef}
        style={{
          maxHeight: 300, overflowY: "auto", border: "1px solid #333", borderRadius: 4,
          padding: 8, marginBottom: 8, background: "#111",
        }}
      >
        {turns.length === 0 && <div style={{ opacity: 0.5 }}>No turns yet. Ask something like "Give Marcus a deeper fear of abandonment."</div>}
        {turns.map((t, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: "0.72em", opacity: 0.6, textTransform: "uppercase" }}>{t.role === "user" ? "you" : "assistant"}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{t.content}</div>
          </div>
        ))}
        {sending && <div style={{ opacity: 0.6 }}>Thinking…</div>}
      </div>

      {envelopes.length > 0 && (
        <div style={{ border: "1px dashed #4a7", borderRadius: 4, padding: 8, marginBottom: 8, background: "#0e1a12" }}>
          <div style={{ fontSize: "0.8em", marginBottom: 6, fontWeight: "bold" }}>
            Proposed changes ({envelopes.length})
          </div>
          {/* Phase 3 commit 5a — bulk quick actions. Counts only PENDING
              envelopes so the button labels reflect what would actually
              fire (a card already in done/stale/error state is skipped).
              Buttons disabled when no targets remain. */}
          {(() => {
            const pendingEnvelopes = envelopes.filter(env => {
              const s = envelopeStates[env.id]
              return !s || s.kind === "pending"
            })
            const lowRiskPending = pendingEnvelopes.filter(env => env.risk === "low")
            const anyAction = pendingEnvelopes.length > 0
            return (
              <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => bulkResolve("low-risk")}
                  disabled={!anyAction || lowRiskPending.length === 0 || sending}
                  style={{
                    background: "#1f3a26",
                    border: "1px solid #2c5a36",
                    color: "#cfe",
                    padding: "3px 8px",
                    borderRadius: 3,
                    fontSize: "0.78rem",
                    cursor: lowRiskPending.length === 0 ? "not-allowed" : "pointer",
                  }}
                  title="Approve every PENDING envelope whose risk classification is `low` (additive field updates). Renames and structurally-risky patches stay pending."
                >
                  Approve all low-risk ({lowRiskPending.length})
                </button>
                <button
                  onClick={() => bulkResolve("all")}
                  disabled={!anyAction || sending}
                  style={{
                    background: "#3a1f1f",
                    border: "1px solid #5a2c2c",
                    color: "#fce",
                    padding: "3px 8px",
                    borderRadius: 3,
                    fontSize: "0.78rem",
                    cursor: !anyAction ? "not-allowed" : "pointer",
                  }}
                  title="Reject every PENDING envelope. Already-resolved cards on this batch are skipped."
                >
                  Reject all ({pendingEnvelopes.length})
                </button>
              </div>
            )
          })()}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {envelopes.map(env => (
              <EnvelopeCard
                key={env.id}
                envelope={env}
                state={envelopeStates[env.id] ?? { kind: "pending" }}
                charName={charName}
                regenerating={sending}
                onResolve={s => resolveEnvelope(env, s)}
                onRegenerate={() => regenerateFromEnvelope(env)}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={() => {
                setEnvelopes([])
                setEnvelopeStates({})
                setPendingPatches([])
              }}
            >
              Discard remaining
            </button>
          </div>
        </div>
      )}

      {/* Phase 3 commit 4 follow-up D — audit-history view. Collapsed by
          default; opening fetches `?status=all` and renders non-pending
          rows with status badge + resolved-at + operatorNote (if any) +
          parentEnvelopeId reference (if any). Read-only — no Approve/
          Reject buttons. Pending rows are filtered out because they're
          already rendered in the active batch above. */}
      <div style={{ marginBottom: 8, fontSize: "0.78rem" }}>
        <button
          onClick={() => setShowHistory(s => !s)}
          style={{
            background: "transparent",
            color: "#9ab",
            border: "1px solid #345",
            padding: "2px 8px",
            borderRadius: 3,
            fontSize: "0.78rem",
            cursor: "pointer",
          }}
          title={showHistory ? "Hide resolved-envelope audit history" : "Show resolved envelopes from this novel's history"}
        >
          {showHistory ? "▾ Hide audit history" : "▸ Show audit history"}
        </button>
      </div>

      {showHistory && (
        <div style={{ border: "1px solid #234", borderRadius: 4, padding: 8, marginBottom: 8, background: "#0c1218" }}>
          <div style={{ fontSize: "0.8em", marginBottom: 6, fontWeight: "bold", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Audit history (resolved envelopes)</span>
            <button
              onClick={() => fetchHistory()}
              disabled={historyLoading}
              style={{
                background: "#1a2530",
                border: "1px solid #2c3e4f",
                color: "#bcd",
                padding: "1px 6px",
                borderRadius: 2,
                fontSize: "0.72rem",
                cursor: historyLoading ? "not-allowed" : "pointer",
              }}
            >
              {historyLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {historyError && (
            <div style={{ color: "#f88", fontSize: "0.78rem", marginBottom: 6 }}>
              Failed to load history: {historyError}
            </div>
          )}
          {(() => {
            const resolved = historyEnvelopes.filter(e => e.status !== "pending")
            if (resolved.length === 0 && !historyLoading && !historyError) {
              return <div style={{ color: "#789", fontSize: "0.78rem" }}>No resolved envelopes yet for this novel.</div>
            }
            return (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                {resolved.map(env => (
                  <HistoryRow key={env.id} envelope={env} charName={charName} />
                ))}
              </ul>
            )
          })()}
        </div>
      )}

      {/* Legacy apply-all fallback for older servers that don't return
          envelopes. Phase 3 commit 1 made envelopes additive so this path
          stays in for back-compat. The per-envelope path is preferred when
          envelopes are returned (see above). */}
      {envelopes.length === 0 && pendingPatches.length > 0 && (
        <div style={{ border: "1px dashed #4a7", borderRadius: 4, padding: 8, marginBottom: 8, background: "#0e1a12" }}>
          <div style={{ fontSize: "0.8em", marginBottom: 6, fontWeight: "bold" }}>Proposed changes ({pendingPatches.length})</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.85em" }}>
            {pendingPatches.map((p, i) => (
              <li key={i}>{summarizePatch(p, charName)}</li>
            ))}
          </ul>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button onClick={applyAll} disabled={applying}>{applying ? "Applying…" : "Apply all"}</button>
            <button onClick={() => setPendingPatches([])} disabled={applying}>Discard</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
          placeholder="Describe the change you want…  (Cmd/Ctrl+Enter to send)"
          rows={3}
          style={{ flex: 1, boxSizing: "border-box" }}
          disabled={sending}
        />
        <button onClick={send} disabled={sending || !input.trim()} style={{ alignSelf: "flex-end" }}>
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  )
}

/**
 * Phase 3 commit 4 follow-up D — audit-history row. Read-only.
 *
 * Status badge color matches semantics: approved=green, rejected=red,
 * modified=blue, shadowed/expired=gray. parentEnvelopeId is rendered as
 * a short-prefix text reference; clicking is not wired (no modal, no
 * scroll-to) — just enough provenance to recognize a regen chain.
 */
function HistoryRow({
  envelope,
  charName,
}: {
  envelope: ArtifactPatchEnvelope
  charName: (id: string) => string
}) {
  const statusStyle = historyStatusBadgeStyle(envelope.status)
  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "4px 6px",
        background: "#101820",
        border: "1px solid #1f2c38",
        borderRadius: 3,
        fontSize: "0.78rem",
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span
          style={{
            ...statusStyle,
            padding: "1px 6px",
            borderRadius: 2,
            fontSize: "0.7rem",
            fontWeight: "bold",
            textTransform: "uppercase",
          }}
        >
          {envelope.status}
        </span>
        <span style={{ color: "#bcd" }}>{summarizePatch(envelope.payload, charName)}</span>
        {envelope.resolvedAt && (
          <span style={{ color: "#678", fontSize: "0.72rem", marginLeft: "auto" }}>
            {new Date(envelope.resolvedAt).toLocaleString()}
          </span>
        )}
      </div>
      {envelope.source.parentEnvelopeId && (
        <div style={{ color: "#789", fontSize: "0.7rem" }}>
          regen of{" "}
          <code style={{ background: "#1a2530", padding: "0 4px", borderRadius: 2 }}>
            {envelope.source.parentEnvelopeId.slice(-16)}
          </code>
        </div>
      )}
    </li>
  )
}

function historyStatusBadgeStyle(status: string): React.CSSProperties {
  switch (status) {
    case "approved":
      return { background: "#1f3a26", color: "#cfe", border: "1px solid #2c5a36" }
    case "rejected":
      return { background: "#3a1f1f", color: "#fce", border: "1px solid #5a2c2c" }
    case "modified":
      return { background: "#1f2e3a", color: "#cef", border: "1px solid #2c4a5a" }
    case "shadowed":
    case "expired":
      return { background: "#2a2a2a", color: "#aaa", border: "1px solid #444" }
    default:
      return { background: "#222", color: "#999", border: "1px solid #333" }
  }
}

function summarizePatch(p: AdjusterPatch, charName: (id: string) => string): string {
  if (p.type === "characterUpdate") {
    const fields = Object.keys(p.patch).join(", ")
    return `Update ${charName(p.characterId)} — ${fields}`
  }
  if (p.type === "characterRename") return `Rename ${charName(p.characterId)} → ${p.newName}`
  if (p.type === "worldUpdate") return `World: ${Object.keys(p.patch).join(", ")}`
  if (p.type === "spineUpdate") return `Plot: ${Object.keys(p.patch).join(", ")}`
  return JSON.stringify(p)
}

function riskBadgeStyle(risk: ArtifactPatchEnvelope["risk"]): React.CSSProperties {
  // Codex round-3 MEDIUM 2 made envelope ids restart-stable; the risk
  // classification is the operator's at-a-glance signal for which patches
  // are safe to fast-approve vs. need attention. characterRename = medium
  // (cascades across references); the rest = low (additive field updates).
  switch (risk) {
    case "low":
      return { background: "#1f3a26", color: "#cfe", border: "1px solid #2c5a36" }
    case "medium":
      return { background: "#3a3a1f", color: "#fec", border: "1px solid #5a5a2c" }
    case "high":
      return { background: "#3a1f1f", color: "#fce", border: "1px solid #5a2c2c" }
    case "mechanical":
      return { background: "#1f2e3a", color: "#cfe", border: "1px solid #2c485a" }
  }
}

function EnvelopeCard({
  envelope,
  state,
  charName,
  regenerating,
  onResolve,
  onRegenerate,
}: {
  envelope: ArtifactPatchEnvelope
  state: EnvelopeRowState
  charName: (id: string) => string
  regenerating: boolean
  onResolve: (status: "approved" | "rejected") => void
  onRegenerate: () => void
}) {
  const busy = state.kind === "busy"
  const resolved = state.kind === "done"
  const stale = state.kind === "stale"
  const errored = state.kind === "error"
  const summary = summarizePatch(envelope.payload, charName)

  return (
    <div
      style={{
        border: "1px solid #2a3d2e",
        borderRadius: 3,
        padding: "6px 8px",
        background: resolved ? "#0a1810" : stale || errored ? "#1a1010" : "#0e1a12",
        opacity: resolved ? 0.75 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ ...riskBadgeStyle(envelope.risk), padding: "1px 6px", borderRadius: 3, fontSize: "0.72rem" }}>
          {envelope.risk}
        </span>
        <span style={{ fontSize: "0.85em", fontWeight: 500 }}>{summary}</span>
      </div>
      <div style={{ fontSize: "0.74em", color: "#789", marginBottom: 6 }}>{envelope.summary}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {state.kind === "pending" && (
          <>
            <button
              onClick={() => onResolve("approved")}
              disabled={busy}
              style={{
                background: "#1f3a26",
                border: "1px solid #2c5a36",
                color: "#cfe",
                padding: "3px 8px",
                borderRadius: 3,
                fontSize: "0.78rem",
                cursor: "pointer",
              }}
            >
              Approve
            </button>
            <button
              onClick={() => onResolve("rejected")}
              disabled={busy}
              style={{
                background: "#3a1f1f",
                border: "1px solid #5a2c2c",
                color: "#fce",
                padding: "3px 8px",
                borderRadius: 3,
                fontSize: "0.78rem",
                cursor: "pointer",
              }}
            >
              Reject
            </button>
          </>
        )}
        {busy && <span style={{ fontSize: "0.78em", color: "#9ac" }}>working…</span>}
        {state.kind === "done" && (
          <span style={{ fontSize: "0.78em", color: "#cfe" }}>
            ✓ {state.status}
            {state.newVersion ? ` · v ${state.newVersion.slice(0, 8)}` : ""}
          </span>
        )}
        {state.kind === "stale" && (
          <>
            <span style={{ fontSize: "0.78em", color: "#fec" }}>
              stale — artifact moved (expected v {state.expectedVersion.slice(0, 8)}, now v {state.actualVersion.slice(0, 8)}).
            </span>
            {envelope.source.userMessage ? (
              <button
                onClick={onRegenerate}
                disabled={regenerating}
                style={{
                  background: "#3a2c4a",
                  border: "1px solid #b6f",
                  color: "#dcf",
                  padding: "3px 8px",
                  borderRadius: 3,
                  fontSize: "0.78rem",
                  cursor: regenerating ? "wait" : "pointer",
                }}
                title="Re-runs the conversational /adjust with the original message so the model can re-derive the patch against the latest artifact state. The current envelope batch is replaced with the fresh response."
              >
                {regenerating ? "Regenerating…" : "Regenerate"}
              </button>
            ) : (
              <span style={{ fontSize: "0.74em", color: "#789", fontStyle: "italic" }}>
                (no original message; cannot regenerate)
              </span>
            )}
          </>
        )}
        {state.kind === "error" && (
          <span style={{ fontSize: "0.78em", color: "#fce" }}>error: {state.message}</span>
        )}
      </div>
    </div>
  )
}

// ── Outlines / chapter view (unchanged from prior commit) ──────────────

function OutlinesPreview({ novelId, outlines }: { novelId: string; outlines: any[] }) {
  const [expandedChapter, setExpandedChapter] = useState<number | null>(null)
  const [beatsByChapter, setBeatsByChapter] = useState<Record<number, BeatData[]>>({})
  const [proseByChapter, setProseByChapter] = useState<Record<number, { prose: string; wordCount: number; version: number; status: string } | null>>({})
  const [loadingChapter, setLoadingChapter] = useState<number | null>(null)
  const [redrafting, setRedrafting] = useState<number | null>(null)

  const loadChapter = useCallback(async (ch: number) => {
    setLoadingChapter(ch)
    try {
      const [beats, draft] = await Promise.allSettled([getBeats(novelId), getChapterDraft(novelId, ch)])
      if (beats.status === "fulfilled") {
        const filtered = beats.value.filter(b => b.chapter === ch).sort((a, b) => a.beatIndex - b.beatIndex)
        setBeatsByChapter(prev => ({ ...prev, [ch]: filtered }))
      }
      if (draft.status === "fulfilled") {
        setProseByChapter(prev => ({ ...prev, [ch]: draft.value }))
      }
    } finally {
      setLoadingChapter(null)
    }
  }, [novelId])

  const toggleChapter = (ch: number) => {
    if (expandedChapter === ch) { setExpandedChapter(null); return }
    setExpandedChapter(ch)
    if (!(ch in beatsByChapter) && !(ch in proseByChapter)) loadChapter(ch)
  }

  const handleRedraft = async (ch: number) => {
    if (!confirm(`Redraft chapter ${ch}? This deletes the current draft and re-runs drafting for this chapter only.`)) return
    setRedrafting(ch)
    try {
      await redraftChapter(novelId, ch)
    } catch (err) {
      alert(`Redraft failed: ${(err as Error).message}`)
    } finally {
      setRedrafting(null)
    }
  }

  return (
    <div className="artifact-body">
      {outlines.map((o, i) => {
        const ch = o.chapterNumber ?? i + 1
        const scenes: any[] = o.scenes ?? []
        const isExpanded = expandedChapter === ch
        const beats = beatsByChapter[ch]
        const draft = proseByChapter[ch]
        return (
          <div key={i} className="artifact-chapter">
            <div className="artifact-chapter-head" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => toggleChapter(ch)}
                style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }}
                aria-expanded={isExpanded}
              >
                <strong>{isExpanded ? "▾" : "▸"} Chapter {ch}{o.title ? `: ${o.title}` : ""}</strong>
              </button>
              {o.povCharacter && <span className="artifact-badge">POV: {o.povCharacter}</span>}
              {draft?.status === "approved" && <span className="artifact-badge" style={{ background: "#2e7d32" }}>approved v{draft.version}</span>}
              {draft && draft.status !== "approved" && <span className="artifact-badge">draft v{draft.version}</span>}
              <button
                onClick={() => handleRedraft(ch)}
                disabled={redrafting === ch}
                style={{ marginLeft: "auto", fontSize: "0.75em", padding: "2px 8px", cursor: redrafting === ch ? "wait" : "pointer" }}
                title="Delete this chapter's drafts and re-run drafting"
              >
                {redrafting === ch ? "Redrafting…" : "Redraft"}
              </button>
            </div>
            {o.purpose && <div className="artifact-chapter-purpose">{o.purpose}</div>}
            {scenes.length > 0 && (
              <ol className="artifact-scenes">
                {scenes.map((s, j) => <li key={j}>{s.description ?? s.summary ?? String(s)}</li>)}
              </ol>
            )}
            {isExpanded && (
              <div className="artifact-chapter-detail" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #444" }}>
                {loadingChapter === ch && <div style={{ opacity: 0.6 }}>Loading beats and prose…</div>}
                {loadingChapter !== ch && beats && beats.length > 0 && (
                  <div>
                    <div className="artifact-section-title">Written beats ({beats.length})</div>
                    {beats.map(b => (
                      <details key={b.beatIndex} style={{ marginBottom: 6 }}>
                        <summary style={{ cursor: "pointer" }}>
                          Beat {b.beatIndex + 1} — {b.wordCount} words · {b.latencyMs}ms
                        </summary>
                        <div style={{ whiteSpace: "pre-wrap", padding: "6px 0 0 12px", fontSize: "0.9em", opacity: 0.85 }}>{b.prose}</div>
                      </details>
                    ))}
                  </div>
                )}
                {loadingChapter !== ch && beats && beats.length === 0 && !draft && (
                  <div style={{ opacity: 0.6 }}>No beats or prose written yet.</div>
                )}
                {loadingChapter !== ch && draft && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer" }}>
                      Full chapter prose (v{draft.version} · {draft.wordCount} words · {draft.status})
                    </summary>
                    <div style={{ whiteSpace: "pre-wrap", padding: "6px 0 0 0", fontSize: "0.9em", opacity: 0.9 }}>{draft.prose}</div>
                  </details>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="artifact-section">
      <div className="artifact-section-title">{props.title}</div>
      {props.children}
    </div>
  )
}
