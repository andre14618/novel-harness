/**
 * LiveProse — the streaming prose panel. This is the visual centerpiece of
 * the live pipeline view: the novel builds up paragraph by paragraph as
 * beat-writer generates each beat. Completed beats are rendered in full;
 * the currently-streaming beat shows a blinking caret at the end.
 *
 * State flow:
 *   - llm-call-start (agent=beat-writer) → open a new "current beat" slot
 *     with the beat description as a subtitle
 *   - llm-token events → append delta to the current beat's text
 *   - agent-complete (agent=beat-writer) → mark current beat as done, scroll
 *     to bottom. New chapter resets the slot list.
 */

import { useEffect, useRef } from "react"

export interface LiveBeat {
  chapter: number
  beatIndex: number
  description?: string
  characters?: string[]
  text: string
  done: boolean
}

interface Props {
  chapterTitle: string | null
  chapter: number | null
  totalBeats: number | null
  beats: LiveBeat[]
  writing: boolean
}

export function LiveProse({ chapterTitle, chapter, totalBeats, beats, writing }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-scroll as new tokens arrive
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [beats.length, beats.map(b => b.text.length).join(",")])

  return (
    <div className="live-prose">
      <div className="live-prose-header">
        <div className="live-prose-chapter">
          {chapter != null ? `Chapter ${chapter}` : "—"}
          {chapterTitle && <span className="live-prose-title">: {chapterTitle}</span>}
        </div>
        {totalBeats != null && (
          <div className="live-prose-meta">
            {beats.filter(b => b.done).length} / {totalBeats} beats
          </div>
        )}
      </div>

      <div className="live-prose-body">
        {beats.length === 0 && (
          <div className="live-prose-placeholder">
            {writing
              ? "Waiting for the next beat…"
              : "The prose will appear here as each beat is written, live."}
          </div>
        )}

        {beats.map((beat, i) => (
          <div
            key={`${beat.chapter}-${beat.beatIndex}-${i}`}
            className={`live-beat${beat.done ? " done" : " active"}`}
          >
            <div className="live-beat-label">
              Beat {beat.beatIndex + 1}
              {beat.description && <span className="live-beat-desc"> — {beat.description}</span>}
            </div>
            <div className="live-beat-text">
              {beat.text || (!beat.done && <span className="live-beat-waiting">Starting…</span>)}
              {!beat.done && beat.text.length > 0 && <span className="live-caret" />}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
