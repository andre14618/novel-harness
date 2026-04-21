import { useEffect, useState, useMemo, useCallback } from "react"
import { useParams } from "react-router-dom"

interface Packet {
  packet_id: string
  version_1_prose: string
  version_2_prose: string
}

interface LabelEntry {
  label: string
  notes: string
}

interface BundleState {
  bundle: string
  packets: Packet[]
  labels: Record<string, LabelEntry>
}

type LabelValue = "VERSION-1-WINS" | "VERSION-2-WINS" | "TIE" | ""

/**
 * Direct-pairwise adjudication UI per `docs/charters/arm-b-direct-pairwise.md`.
 * One packet at a time. Hypothesis-masked (arm identity stays server-side).
 * Keyboard shortcuts: 1 / 2 / 3 → Version 1 / Tie / Version 2.
 */
export function PairwiseAdjudicatePage() {
  const { bundle } = useParams<{ bundle: string }>()
  const [state, setState] = useState<BundleState | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [localLabel, setLocalLabel] = useState<LabelValue>("")
  const [localNotes, setLocalNotes] = useState("")
  const [savingRemote, setSavingRemote] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ingestOutput, setIngestOutput] = useState<string | null>(null)
  const [ingestRunning, setIngestRunning] = useState(false)

  // Fetch bundle state on mount
  useEffect(() => {
    if (!bundle) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/pairwise/${bundle}/state`, { credentials: "same-origin" })
        if (res.status === 401) { window.location.href = "/login"; return }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as BundleState
        if (cancelled) return
        setState(data)
        // Jump to first unlabeled packet
        const firstUnlabeled = data.packets.findIndex(p => !data.labels[p.packet_id]?.label)
        setCurrentIdx(firstUnlabeled >= 0 ? firstUnlabeled : 0)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [bundle])

  const currentPacket = state?.packets[currentIdx]

  // Load local label/notes when packet changes
  useEffect(() => {
    if (!currentPacket) return
    const existing = state?.labels[currentPacket.packet_id]
    setLocalLabel((existing?.label as LabelValue) ?? "")
    setLocalNotes(existing?.notes ?? "")
  }, [currentIdx, currentPacket, state])

  const saveAndAdvance = useCallback(async (label: LabelValue) => {
    if (!currentPacket || !bundle || !state) return
    setSavingRemote(true)
    setError(null)
    try {
      const res = await fetch(`/api/pairwise/${bundle}/label`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packet_id: currentPacket.packet_id, label, notes: localNotes }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Update local state
      setState(prev => prev ? {
        ...prev,
        labels: {
          ...prev.labels,
          [currentPacket.packet_id]: { label, notes: localNotes },
        },
      } : prev)
      // Advance to next unlabeled packet, or next index if all labeled
      const nextUnlabeled = state.packets.findIndex((p, i) =>
        i > currentIdx && !(state.labels[p.packet_id]?.label || (p.packet_id === currentPacket.packet_id ? label : ""))
      )
      if (nextUnlabeled >= 0) setCurrentIdx(nextUnlabeled)
      else if (currentIdx < state.packets.length - 1) setCurrentIdx(currentIdx + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingRemote(false)
    }
  }, [currentPacket, bundle, state, currentIdx, localNotes])

  // Keyboard shortcuts — only when not focused in a text input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "TEXTAREA" || tag === "INPUT") return
      if (e.key === "1") { e.preventDefault(); saveAndAdvance("VERSION-1-WINS") }
      else if (e.key === "2") { e.preventDefault(); saveAndAdvance("TIE") }
      else if (e.key === "3") { e.preventDefault(); saveAndAdvance("VERSION-2-WINS") }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setCurrentIdx(i => Math.max(0, i - 1)) }
      else if (e.key === "ArrowRight") { e.preventDefault(); setCurrentIdx(i => Math.min((state?.packets.length ?? 1) - 1, i + 1)) }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [saveAndAdvance, state])

  const progress = useMemo(() => {
    if (!state) return { labeled: 0, total: 0 }
    const labeled = state.packets.filter(p => state.labels[p.packet_id]?.label).length
    return { labeled, total: state.packets.length }
  }, [state])

  const allDone = state && progress.labeled === progress.total && progress.total > 0

  const runIngest = useCallback(async () => {
    if (!bundle) return
    setIngestRunning(true)
    setIngestOutput(null)
    setError(null)
    try {
      const res = await fetch(`/api/pairwise/${bundle}/ingest`, { method: "POST", credentials: "same-origin" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { exit_code: number; stdout: string; stderr: string }
      setIngestOutput(data.stdout + (data.stderr ? `\n---\nstderr:\n${data.stderr}` : ""))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIngestRunning(false)
    }
  }, [bundle])

  if (error && !state) return <div style={{ padding: 24 }}>Error: {error}</div>
  if (!state || !currentPacket) return <div style={{ padding: 24 }}>Loading bundle {bundle}…</div>

  const currentLabel = state.labels[currentPacket.packet_id]?.label ?? ""

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
          Pairwise adjudication — {bundle}
        </h2>
        <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Packet {currentIdx + 1} of {state.packets.length}
          {" · "}
          Labeled {progress.labeled}/{progress.total}
          {currentLabel && <span style={{ marginLeft: 8, color: "var(--accent)" }}>· saved: {currentLabel}</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16, height: 4 }}>
        {state.packets.map((p, i) => {
          const labeled = !!state.labels[p.packet_id]?.label
          return (
            <div
              key={p.packet_id}
              style={{
                flex: 1,
                background: i === currentIdx ? "var(--accent)" : labeled ? "var(--accent-muted, #6a8)" : "var(--border-subtle, #333)",
                borderRadius: 2,
                cursor: "pointer",
              }}
              onClick={() => setCurrentIdx(i)}
              title={`Packet ${i + 1} — ${p.packet_id}${labeled ? " ✓" : ""}`}
            />
          )
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ background: "var(--bg-secondary, #1a1a1a)", padding: 16, borderRadius: 6, border: "1px solid var(--border-subtle, #333)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: "0.85rem", color: "var(--text-muted)" }}>Version 1</div>
          <div style={{ whiteSpace: "pre-wrap", fontFamily: "Georgia, serif", lineHeight: 1.6, fontSize: "0.95rem" }}>
            {currentPacket.version_1_prose}
          </div>
        </div>
        <div style={{ background: "var(--bg-secondary, #1a1a1a)", padding: 16, borderRadius: 6, border: "1px solid var(--border-subtle, #333)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: "0.85rem", color: "var(--text-muted)" }}>Version 2</div>
          <div style={{ whiteSpace: "pre-wrap", fontFamily: "Georgia, serif", lineHeight: 1.6, fontSize: "0.95rem" }}>
            {currentPacket.version_2_prose}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => saveAndAdvance("VERSION-1-WINS")}
          disabled={savingRemote}
          style={{
            flex: 1, padding: "14px 20px", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer",
            background: currentLabel === "VERSION-1-WINS" ? "var(--accent)" : "var(--bg-secondary, #1a1a1a)",
            color: currentLabel === "VERSION-1-WINS" ? "white" : "var(--text)",
            border: "1px solid var(--border-subtle, #333)",
            borderRadius: 6,
          }}
        >
          [1] Version 1 wins
        </button>
        <button
          onClick={() => saveAndAdvance("TIE")}
          disabled={savingRemote}
          style={{
            flex: 1, padding: "14px 20px", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer",
            background: currentLabel === "TIE" ? "var(--accent)" : "var(--bg-secondary, #1a1a1a)",
            color: currentLabel === "TIE" ? "white" : "var(--text)",
            border: "1px solid var(--border-subtle, #333)",
            borderRadius: 6,
          }}
        >
          [2] Tie
        </button>
        <button
          onClick={() => saveAndAdvance("VERSION-2-WINS")}
          disabled={savingRemote}
          style={{
            flex: 1, padding: "14px 20px", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer",
            background: currentLabel === "VERSION-2-WINS" ? "var(--accent)" : "var(--bg-secondary, #1a1a1a)",
            color: currentLabel === "VERSION-2-WINS" ? "white" : "var(--text)",
            border: "1px solid var(--border-subtle, #333)",
            borderRadius: 6,
          }}
        >
          [3] Version 2 wins
        </button>
      </div>

      <textarea
        value={localNotes}
        onChange={e => setLocalNotes(e.target.value)}
        onBlur={() => {
          // Save notes without advancing if label already set
          if (currentLabel && currentPacket && bundle) {
            fetch(`/api/pairwise/${bundle}/label`, {
              method: "PUT",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ packet_id: currentPacket.packet_id, label: currentLabel, notes: localNotes }),
            }).catch(() => { /* silent */ })
          }
        }}
        placeholder="Notes (1–2 sentences required on primary pairs — what drove the call)"
        rows={2}
        style={{ width: "100%", padding: 10, fontSize: "0.9rem", fontFamily: "inherit", borderRadius: 6, border: "1px solid var(--border-subtle, #333)", background: "var(--bg-secondary, #1a1a1a)", color: "var(--text)" }}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: "0.8rem", color: "var(--text-muted)" }}>
        <div>
          <kbd>←</kbd> prev · <kbd>→</kbd> next · <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> label &amp; advance
        </div>
        <div>
          {currentIdx > 0 && <button onClick={() => setCurrentIdx(currentIdx - 1)} style={{ marginRight: 8 }}>← Prev</button>}
          {currentIdx < state.packets.length - 1 && <button onClick={() => setCurrentIdx(currentIdx + 1)}>Next →</button>}
        </div>
      </div>

      {error && <div style={{ marginTop: 16, padding: 12, background: "#3a1a1a", borderRadius: 6, color: "#f88" }}>Error: {error}</div>}

      {allDone && (
        <div style={{ marginTop: 24, padding: 16, background: "var(--bg-secondary, #1a1a1a)", borderRadius: 6, border: "1px solid var(--accent)" }}>
          <h3 style={{ margin: "0 0 8px 0" }}>All {progress.total} packets labeled.</h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "0.9rem" }}>
            Ready to compute verdict. The ingest step resolves versions back to arms, counts wins/ties, checks retest flips and calibration pairs, and emits GO / CAUTION / NO-GO / INCONCLUSIVE per charter §7.
          </p>
          <button
            onClick={runIngest}
            disabled={ingestRunning}
            style={{ padding: "10px 20px", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer", background: "var(--accent)", color: "white", border: "none", borderRadius: 6 }}
          >
            {ingestRunning ? "Running ingest…" : "Compute verdict"}
          </button>
          {ingestOutput && (
            <pre style={{ marginTop: 16, padding: 12, background: "#0d0d0d", borderRadius: 6, overflow: "auto", fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
              {ingestOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
