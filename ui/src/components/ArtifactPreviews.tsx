import { useCallback, useEffect, useRef, useState } from "react"
import {
  adjustNovel, getBeats, getCharacters, getChapterDraft, getOutlines, getStorySpine, getWorldBible,
  redraftChapter, updateCharacter, updateStorySpine, updateWorldBible,
  type AdjustTurn, type AdjusterPatch, type BeatData,
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

function AdjustPanel({ novelId, characters, onApplied }: { novelId: string; characters: any[]; onApplied: () => void }) {
  const [turns, setTurns] = useState<AdjustTurn[]>([])
  const [pendingPatches, setPendingPatches] = useState<AdjusterPatch[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [applying, setApplying] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [turns])

  const send = async () => {
    const msg = input.trim()
    if (!msg || sending) return
    setSending(true)
    const next = [...turns, { role: "user" as const, content: msg }]
    setTurns(next)
    setInput("")
    setPendingPatches([])
    try {
      const res = await adjustNovel(novelId, msg, turns)
      setTurns([...next, { role: "assistant", content: res.assistantMessage }])
      setPendingPatches(res.proposedPatches ?? [])
    } catch (err) {
      setTurns([...next, { role: "assistant", content: `(Error: ${(err as Error).message})` }])
    } finally {
      setSending(false)
    }
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
      onApplied()
    } catch (err) {
      alert(`Apply failed: ${(err as Error).message}`)
    } finally {
      setApplying(false)
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

      {pendingPatches.length > 0 && (
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
