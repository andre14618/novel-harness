import { useState, useRef, useEffect, useMemo } from "react"
import {
  chatWithDirector,
  compileDirectives,
  emptyDirectives,
  type PlanningDirectives,
  type DirectorChatTurn,
} from "../api"

interface Props {
  seed: { premise: string; genre: string; chapterCount?: number }
  directives: PlanningDirectives
  onDirectivesChange: (d: PlanningDirectives) => void
  history: DirectorChatTurn[]
  onHistoryChange: (h: DirectorChatTurn[]) => void
}

export function DirectorChat({
  seed,
  directives,
  onDirectivesChange,
  history,
  onHistoryChange,
}: Props) {
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compileError, setCompileError] = useState<string | null>(null)
  const [lastCompiledAt, setLastCompiledAt] = useState<number>(0)
  const [previousDirectives, setPreviousDirectives] = useState<PlanningDirectives>(emptyDirectives)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" })
  }, [history.length, sending])

  // Turns added since last compile — informs the "compile" button label
  const turnsSinceCompile = useMemo(() => {
    if (lastCompiledAt === 0) return history.length
    return history.length - lastCompiledAt
  }, [history.length, lastCompiledAt])

  const canSend = !sending && message.trim().length > 0 && seed.premise.trim().length > 0
  const canCompile = !compiling && history.length >= 2 && turnsSinceCompile > 0

  async function send() {
    if (!canSend) return
    const userTurn: DirectorChatTurn = { role: "user", content: message.trim() }
    const nextHistory = [...history, userTurn]
    onHistoryChange(nextHistory)
    setMessage("")
    setSending(true)
    setError(null)

    try {
      const res = await chatWithDirector({
        seed,
        history,
        message: userTurn.content,
      })
      onHistoryChange([...nextHistory, { role: "assistant", content: res.assistantMessage }])
    } catch (e: any) {
      setError(e?.message ?? "Failed to send")
      onHistoryChange(history)
    } finally {
      setSending(false)
    }
  }

  async function compile() {
    if (!canCompile) return
    setCompiling(true)
    setCompileError(null)
    try {
      const res = await compileDirectives({ seed, history })
      setPreviousDirectives(directives)
      onDirectivesChange(res.directives)
      setLastCompiledAt(history.length)
    } catch (e: any) {
      setCompileError(e?.message ?? "Failed to compile")
    } finally {
      setCompiling(false)
    }
  }

  function resetAll() {
    onDirectivesChange(emptyDirectives)
    onHistoryChange([])
    setPreviousDirectives(emptyDirectives)
    setLastCompiledAt(0)
    setError(null)
    setCompileError(null)
  }

  const hasCompiled = lastCompiledAt > 0
  const compileLabel = compiling
    ? "Compiling…"
    : hasCompiled
      ? (turnsSinceCompile > 0 ? `Re-compile (${Math.ceil(turnsSinceCompile / 2)} new)` : "Re-compile")
      : "Compile directives"

  return (
    <div className="director-chat">
      <div className="director-chat-header">
        <span className="director-chat-title">Planning Director</span>
        <div className="director-chat-header-actions">
          <button
            className="director-chat-compile"
            onClick={compile}
            disabled={!canCompile}
            title={!canCompile && history.length < 2 ? "Chat a bit first, then compile the conversation into directives" : "Extract directives from the transcript"}
          >
            {compileLabel}
          </button>
          {history.length > 0 && (
            <button className="director-chat-reset" onClick={resetAll} disabled={sending || compiling}>
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="director-chat-body">
        <div className="director-chat-transcript-wrap">
          <div className="director-chat-transcript" ref={transcriptRef}>
            {history.length === 0 ? (
              <div className="director-chat-placeholder">
                Brainstorm your novel with the conversationalist. It'll ask focused questions to surface character, tone, stakes, structure, and what to avoid. When you're satisfied, hit <strong>Compile directives</strong> to extract the plan into the panel on the right.
              </div>
            ) : (
              history.map((t, i) => (
                <div key={i} className={`director-chat-turn ${t.role}`}>
                  <div className="director-chat-turn-role">{t.role === "user" ? "You" : "Director"}</div>
                  <div className="director-chat-turn-content">{t.content}</div>
                </div>
              ))
            )}
            {sending && (
              <div className="director-chat-turn assistant pending">
                <div className="director-chat-turn-role">Director</div>
                <div className="director-chat-turn-content">
                  <span className="director-chat-dots"><span /><span /><span /></span>
                </div>
              </div>
            )}
            {error && <div className="director-chat-error">{error}</div>}
          </div>

          <div className="director-chat-inputbar">
            <textarea
              className="director-chat-input"
              placeholder="e.g. 'The protagonist is a reluctant scholar who faked her way into the academy.'"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={2}
              disabled={sending}
            />
            <button
              className="director-chat-send"
              onClick={send}
              disabled={!canSend}
              title="Send (⌘/Ctrl+Enter)"
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        </div>

        <DirectivesPanel
          directives={directives}
          previous={previousDirectives}
          hasCompiled={hasCompiled}
          compiling={compiling}
          compileError={compileError}
          onChange={onDirectivesChange}
        />
      </div>
    </div>
  )
}

// ── Directives panel ─────────────────────────────────────────────────

interface DirectivesPanelProps {
  directives: PlanningDirectives
  previous: PlanningDirectives
  hasCompiled: boolean
  compiling: boolean
  compileError: string | null
  onChange: (d: PlanningDirectives) => void
}

function DirectivesPanel({
  directives, previous, hasCompiled, compiling, compileError, onChange,
}: DirectivesPanelProps) {
  const counts = useMemo(() => ({
    characters: directives.lockedCharacters.length,
    beats: directives.requiredBeats.length,
    forbidden: directives.forbidden.length,
    tonal: directives.tonalAnchors.length,
  }), [directives])

  const newChars = useMemo(() =>
    new Set(directives.lockedCharacters.map(c => c.name).filter(n => !previous.lockedCharacters.some(p => p.name === n))),
    [directives, previous]
  )
  const newBeats = useMemo(() =>
    new Set(directives.requiredBeats.map(b => b.description).filter(d => !previous.requiredBeats.some(p => p.description === d))),
    [directives, previous]
  )
  const newForbidden = useMemo(() =>
    new Set(directives.forbidden.filter(f => !previous.forbidden.includes(f))),
    [directives, previous]
  )
  const newTonal = useMemo(() =>
    new Set(directives.tonalAnchors.filter(t => !previous.tonalAnchors.includes(t))),
    [directives, previous]
  )

  const isEmpty =
    counts.characters === 0 && counts.beats === 0 && counts.forbidden === 0 && counts.tonal === 0 &&
    !directives.structuralConstraints.chapterCount &&
    !directives.structuralConstraints.povRotation &&
    !directives.structuralConstraints.pacing &&
    !directives.rawNotes.trim()

  function removeCharacter(name: string) {
    onChange({ ...directives, lockedCharacters: directives.lockedCharacters.filter(c => c.name !== name) })
  }
  function removeBeat(i: number) {
    onChange({ ...directives, requiredBeats: directives.requiredBeats.filter((_, idx) => idx !== i) })
  }
  function removeForbidden(i: number) {
    onChange({ ...directives, forbidden: directives.forbidden.filter((_, idx) => idx !== i) })
  }
  function removeTonal(i: number) {
    onChange({ ...directives, tonalAnchors: directives.tonalAnchors.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="directives-panel">
      <div className="directives-panel-header">
        <span>Directives</span>
        {hasCompiled && !isEmpty && (
          <span className="directives-panel-counts">
            {counts.characters}c · {counts.beats}b · {counts.forbidden}✗ · {counts.tonal}♪
          </span>
        )}
      </div>
      <div className="directives-panel-body">
        {compiling && (
          <div className="directives-panel-compiling">
            <span className="director-chat-dots"><span /><span /><span /></span>
            Compiling directives from transcript…
          </div>
        )}

        {compileError && !compiling && (
          <div className="director-chat-error">{compileError}</div>
        )}

        {!hasCompiled && !compiling && (
          <div className="directives-panel-empty">
            <strong>Not compiled yet.</strong>
            <div style={{ marginTop: 8 }}>
              Chat with the conversationalist on the left. When you've covered what matters, press <strong>Compile directives</strong> in the header. The extractor will read the whole transcript and populate this panel with what it captured — you can then edit or re-compile.
            </div>
          </div>
        )}

        {hasCompiled && isEmpty && !compiling && (
          <div className="directives-panel-empty">
            <strong>No directives extracted.</strong>
            <div style={{ marginTop: 8 }}>
              The extractor didn't find any explicit author intent in the transcript. Keep chatting and re-compile — or proceed anyway and let the planner run on just the premise.
            </div>
          </div>
        )}

        {counts.characters > 0 && (
          <Section label="Locked Characters">
            {directives.lockedCharacters.map((c, i) => (
              <Chip
                key={c.name + i}
                isNew={newChars.has(c.name)}
                onRemove={() => removeCharacter(c.name)}
              >
                <strong>{c.name}</strong>
                {c.role ? ` · ${c.role}` : ""}
                {c.mustHaveTraits?.length ? <div className="chip-sub">traits: {c.mustHaveTraits.join(", ")}</div> : null}
                {c.mustHaveArc ? <div className="chip-sub">arc: {c.mustHaveArc}</div> : null}
              </Chip>
            ))}
          </Section>
        )}

        {counts.beats > 0 && (
          <Section label="Required Beats">
            {directives.requiredBeats.map((b, i) => (
              <Chip key={i} isNew={newBeats.has(b.description)} onRemove={() => removeBeat(i)}>
                {b.chapter != null && <span className="chip-badge">Ch {b.chapter}</span>}
                {b.description}
                {b.mustInclude?.length ? <div className="chip-sub">must include: {b.mustInclude.join(", ")}</div> : null}
              </Chip>
            ))}
          </Section>
        )}

        {counts.forbidden > 0 && (
          <Section label="Forbidden">
            {directives.forbidden.map((f, i) => (
              <Chip key={i} variant="forbidden" isNew={newForbidden.has(f)} onRemove={() => removeForbidden(i)}>
                {f}
              </Chip>
            ))}
          </Section>
        )}

        {counts.tonal > 0 && (
          <Section label="Tonal Anchors">
            {directives.tonalAnchors.map((t, i) => (
              <Chip key={i} variant="tonal" isNew={newTonal.has(t)} onRemove={() => removeTonal(i)}>
                {t}
              </Chip>
            ))}
          </Section>
        )}

        {(directives.structuralConstraints.chapterCount ||
          directives.structuralConstraints.povRotation ||
          directives.structuralConstraints.pacing ||
          directives.structuralConstraints.targetWordsPerChapter) && (
          <Section label="Structure">
            {directives.structuralConstraints.chapterCount && (
              <div className="structure-line">Chapters: {directives.structuralConstraints.chapterCount}</div>
            )}
            {directives.structuralConstraints.povRotation && (
              <div className="structure-line">POV: {directives.structuralConstraints.povRotation}</div>
            )}
            {directives.structuralConstraints.pacing && (
              <div className="structure-line">Pacing: {directives.structuralConstraints.pacing}</div>
            )}
            {directives.structuralConstraints.targetWordsPerChapter && (
              <div className="structure-line">
                Target words/ch: {directives.structuralConstraints.targetWordsPerChapter}
              </div>
            )}
          </Section>
        )}

        {directives.rawNotes.trim() && (
          <Section label="Notes">
            <div className="directives-notes">{directives.rawNotes}</div>
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="directives-section">
      <div className="directives-section-label">{label}</div>
      <div className="directives-section-items">{children}</div>
    </div>
  )
}

function Chip({
  children, onRemove, isNew, variant,
}: {
  children: React.ReactNode
  onRemove?: () => void
  isNew?: boolean
  variant?: "forbidden" | "tonal"
}) {
  return (
    <div className={`directives-chip${isNew ? " is-new" : ""}${variant ? ` ${variant}` : ""}`}>
      <div className="directives-chip-content">{children}</div>
      {onRemove && (
        <button className="directives-chip-remove" onClick={onRemove} title="Remove">×</button>
      )}
    </div>
  )
}
