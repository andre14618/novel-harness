/**
 * LiveMeters — header strip showing real-time stats for a novel write:
 *   cost  ·  tokens  ·  tokens/sec  ·  elapsed  ·  Ch X/Y · Beat X/Y
 *
 * Designed to feel alive: the cost and tokens tick up smoothly as new LLM
 * calls complete, and the elapsed clock advances every second.
 */

import { useEffect, useState } from "react"

interface Props {
  totalCost: number
  totalTokens: number
  tokensPerSec: number
  llmCalls: number
  chapter: number | null
  totalChapters: number
  beat: number | null
  totalBeats: number | null
  startedAt: number | null
  done?: boolean
}

export function LiveMeters({
  totalCost,
  totalTokens,
  tokensPerSec,
  llmCalls,
  chapter,
  totalChapters,
  beat,
  totalBeats,
  startedAt,
  done,
}: Props) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt) return
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    if (done) return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, done])

  return (
    <div className="live-meters">
      <Meter label="cost" value={`$${totalCost.toFixed(4)}`} tone="accent" />
      <Meter label="tokens" value={formatCount(totalTokens)} />
      <Meter label="tok/sec" value={tokensPerSec > 0 ? `${tokensPerSec}` : "—"} />
      <Meter label="calls" value={`${llmCalls}`} />
      <Meter label="elapsed" value={startedAt ? formatElapsed(elapsed) : "—"} />
      <div className="meter-sep" />
      <Meter
        label="chapter"
        value={chapter && totalChapters ? `${chapter} / ${totalChapters}` : "—"}
      />
      {beat != null && totalBeats != null && (
        <Meter label="beat" value={`${beat + 1} / ${totalBeats}`} />
      )}
    </div>
  )
}

function Meter({ label, value, tone }: { label: string; value: string; tone?: "accent" }) {
  return (
    <div className="meter">
      <div className="meter-label">{label}</div>
      <div className={`meter-value${tone ? ` meter-${tone}` : ""}`}>{value}</div>
    </div>
  )
}

function formatCount(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}
