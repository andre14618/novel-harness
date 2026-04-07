import { useEffect, useState, useCallback } from "react"
import {
  getFinetuneStats,
  getFinetunePairs,
  getFinetunePair,
  updateFinetunePair,
  exportFinetuneData,
  generateFinetuneData,
  type FinetuneStats,
  type FinetunePair,
} from "../api"

const TASKS = ["fact-extractor", "adherence-checker", "chapter-plan-checker", "tonal-pass"]
const STATUSES = ["pending", "reviewed", "approved", "rejected"]

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "approved" ? "done" :
    status === "rejected" ? "error" :
    status === "reviewed" ? "waiting" :
    "idle"
  return <span className={`badge ${cls}`}>{status}</span>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "..." : s
}

function tryFormatJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

export function FinetunePage() {
  const [view, setView] = useState<"list" | "review">("list")
  const [stats, setStats] = useState<FinetuneStats | null>(null)
  const [pairs, setPairs] = useState<FinetunePair[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [taskFilter, setTaskFilter] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<string>("")

  // Review state
  const [currentPair, setCurrentPair] = useState<FinetunePair | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [editOutput, setEditOutput] = useState("")
  const [reviewerNotes, setReviewerNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [saveFlash, setSaveFlash] = useState<string | null>(null)

  // Generate dialog
  const [showGenerate, setShowGenerate] = useState(false)
  const [genTask, setGenTask] = useState(TASKS[0])
  const [genLimit, setGenLimit] = useState(50)
  const [generating, setGenerating] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      const s = await getFinetuneStats()
      setStats(s)
    } catch {}
  }, [])

  const loadPairs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getFinetunePairs(
        taskFilter || undefined,
        statusFilter || undefined,
        100
      )
      setPairs(res.pairs)
    } catch {}
    setLoading(false)
  }, [taskFilter, statusFilter])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadPairs() }, [loadPairs])

  // ── Review View handlers ─────────────────────────────────────────

  async function openReview(pair: FinetunePair, index: number) {
    setCurrentPair(pair)
    setCurrentIndex(index)
    setEditOutput(tryFormatJson(pair.gold_output ?? pair.base_output))
    setReviewerNotes(pair.reviewer_notes ?? "")
    setShowSystemPrompt(false)
    setSaveFlash(null)
    setView("review")
  }

  async function navigateReview(dir: -1 | 1) {
    const newIndex = currentIndex + dir
    if (newIndex < 0 || newIndex >= pairs.length) return
    const p = pairs[newIndex]
    // Fetch fresh data
    try {
      const full = await getFinetunePair(p.id)
      openReview(full, newIndex)
    } catch {
      openReview(p, newIndex)
    }
  }

  async function saveReview(newStatus: string) {
    if (!currentPair) return
    setSaving(true)
    setSaveFlash(null)
    try {
      // Pretty-print JSON before saving
      let output = editOutput
      try { output = JSON.stringify(JSON.parse(output), null, 2) } catch {}

      const updated = await updateFinetunePair(currentPair.id, {
        gold_output: output,
        status: newStatus,
        reviewer_notes: reviewerNotes || undefined,
      })
      setCurrentPair(updated)
      // Update in the list
      setPairs(prev => prev.map(p => p.id === updated.id ? updated : p))
      setSaveFlash(`Saved as ${newStatus}`)
      setTimeout(() => setSaveFlash(null), 2000)
    } catch (err) {
      setSaveFlash(`Error: ${err instanceof Error ? err.message : err}`)
    }
    setSaving(false)
  }

  async function handleExport() {
    const task = taskFilter || TASKS[0]
    try {
      const blob = await exportFinetuneData(task)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${task}-approved.jsonl`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      await generateFinetuneData(genTask, genLimit)
      setShowGenerate(false)
      setSaveFlash("Generation started in background")
      setTimeout(() => { setSaveFlash(null); loadStats(); loadPairs() }, 3000)
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : err}`)
    }
    setGenerating(false)
  }

  const outputDiffers = currentPair
    ? (editOutput.trim() !== tryFormatJson(currentPair.base_output).trim())
    : false

  // ═══════════════════════════════════════════════════════════════════
  // Review View
  // ═══════════════════════════════════════════════════════════════════
  if (view === "review" && currentPair) {
    return (
      <div>
        <h1>Review Training Pair</h1>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <button className="secondary" onClick={() => { setView("list"); loadPairs() }}>
            Back to List
          </button>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-tertiary)" }}>
              {currentIndex + 1} / {pairs.length}
            </span>
            <button className="secondary" onClick={() => navigateReview(-1)} disabled={currentIndex <= 0}>
              Prev
            </button>
            <button className="secondary" onClick={() => navigateReview(1)} disabled={currentIndex >= pairs.length - 1}>
              Next
            </button>
          </div>
        </div>

        {/* Metadata bar */}
        <div className="card" style={{ padding: "0.7rem 1rem", marginBottom: "0.8rem" }}>
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", fontSize: "0.78rem", flexWrap: "wrap" }}>
            <span><span style={{ color: "var(--text-tertiary)" }}>Task:</span> {currentPair.task}</span>
            <span><span style={{ color: "var(--text-tertiary)" }}>Novel:</span> {currentPair.novel_id ? truncate(currentPair.novel_id, 16) : "n/a"}</span>
            <span><span style={{ color: "var(--text-tertiary)" }}>Ch:</span> {currentPair.chapter_number ?? "n/a"}</span>
            <StatusBadge status={currentPair.status} />
            <span style={{ color: "var(--text-tertiary)" }}>{truncate(currentPair.id, 12)}</span>
            {outputDiffers && (
              <span style={{ color: "var(--yellow)", fontWeight: 700, fontSize: "0.72rem" }}>MODIFIED</span>
            )}
          </div>
        </div>

        {/* Two-panel layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem", marginBottom: "0.8rem" }}>
          {/* Left: Source */}
          <div className="card" style={{ padding: "0" }}>
            <div style={{
              padding: "0.6rem 1rem",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Source Text
              </span>
              <button
                className="secondary"
                style={{ padding: "3px 10px", fontSize: "0.72rem" }}
                onClick={() => setShowSystemPrompt(!showSystemPrompt)}
              >
                {showSystemPrompt ? "Hide" : "Show"} System Prompt
              </button>
            </div>
            {showSystemPrompt && (
              <div style={{
                padding: "0.8rem 1rem",
                borderBottom: "1px solid var(--border-subtle)",
                background: "var(--bg-inset)",
                fontSize: "0.78rem",
                lineHeight: 1.5,
                color: "var(--text-tertiary)",
                whiteSpace: "pre-wrap",
                maxHeight: "200px",
                overflowY: "auto",
              }}>
                {currentPair.system_prompt}
              </div>
            )}
            <div style={{
              padding: "1rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.78rem",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              overflowY: "auto",
              maxHeight: "60vh",
              color: "var(--text-secondary)",
            }}>
              {currentPair.user_content}
            </div>
          </div>

          {/* Right: Output editor */}
          <div className="card" style={{ padding: "0", display: "flex", flexDirection: "column" }}>
            <div style={{
              padding: "0.6rem 1rem",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Extraction Output
              </span>
              <button
                className="secondary"
                style={{ padding: "3px 10px", fontSize: "0.72rem" }}
                onClick={() => {
                  setEditOutput(tryFormatJson(currentPair.base_output))
                }}
              >
                Reset to Base
              </button>
            </div>
            <textarea
              value={editOutput}
              onChange={e => setEditOutput(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                borderRadius: 0,
                background: "var(--bg-inset)",
                resize: "none",
                minHeight: "50vh",
                padding: "1rem",
                fontSize: "0.78rem",
                lineHeight: 1.5,
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>
        </div>

        {/* Notes + actions */}
        <div className="card" style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.4rem", display: "block" }}>
            Reviewer Notes (optional)
          </label>
          <textarea
            value={reviewerNotes}
            onChange={e => setReviewerNotes(e.target.value)}
            placeholder="Notes about corrections made..."
            style={{ minHeight: "60px", marginBottom: "0.8rem" }}
          />
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <button onClick={() => saveReview("approved")} disabled={saving}>
              Approve
            </button>
            <button className="danger" onClick={() => saveReview("rejected")} disabled={saving}>
              Reject
            </button>
            <button className="secondary" onClick={() => saveReview("reviewed")} disabled={saving}>
              Save Draft
            </button>
            {saveFlash && (
              <span style={{
                fontSize: "0.78rem",
                fontWeight: 600,
                color: saveFlash.startsWith("Error") ? "var(--red)" : "var(--accent)",
              }}>
                {saveFlash}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // List View
  // ═══════════════════════════════════════════════════════════════════
  const totalCount = stats ? Object.values(stats.totals).reduce((a, b) => a + b, 0) : 0

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <h1>Fine-tune Training Data</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="secondary" onClick={() => setShowGenerate(!showGenerate)}>
            Generate Data
          </button>
          <button onClick={handleExport} disabled={!taskFilter}>
            Export Approved
          </button>
        </div>
      </div>

      {/* Generate dialog */}
      {showGenerate && (
        <div className="card" style={{ marginBottom: "1rem", borderColor: "var(--accent-dim)" }}>
          <h3 style={{ marginTop: 0, marginBottom: "0.6rem" }}>Generate Training Data</h3>
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", display: "block", marginBottom: "0.3rem" }}>Task</label>
              <select value={genTask} onChange={e => setGenTask(e.target.value)} style={{ width: "220px" }}>
                {TASKS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", display: "block", marginBottom: "0.3rem" }}>Limit</label>
              <input type="number" value={genLimit} onChange={e => setGenLimit(parseInt(e.target.value) || 50)} style={{ width: "100px" }} />
            </div>
            <button onClick={handleGenerate} disabled={generating}>
              {generating ? "Starting..." : "Start"}
            </button>
            <button className="secondary" onClick={() => setShowGenerate(false)}>Cancel</button>
          </div>
          <p style={{ fontSize: "0.72rem", color: "var(--text-tertiary)", marginTop: "0.5rem" }}>
            Pulls chapters from Postgres, runs base model extraction, inserts pairs as pending.
          </p>
        </div>
      )}

      {saveFlash && (
        <div style={{
          padding: "0.5rem 1rem",
          borderRadius: "var(--radius-sm)",
          background: "var(--accent-surface)",
          border: "1px solid var(--accent-dim)",
          color: "var(--accent)",
          fontSize: "0.78rem",
          marginBottom: "0.8rem",
        }}>
          {saveFlash}
        </div>
      )}

      {/* Stats bar */}
      {stats && (
        <div style={{ fontSize: "0.78rem", color: "var(--text-tertiary)", marginBottom: "1rem", display: "flex", gap: "1.5rem" }}>
          <span>{totalCount} total</span>
          <span style={{ color: "var(--text-ghost)" }}>|</span>
          <span>{stats.totals.pending ?? 0} pending</span>
          <span>{stats.totals.reviewed ?? 0} reviewed</span>
          <span style={{ color: "var(--accent)" }}>{stats.totals.approved ?? 0} approved</span>
          <span style={{ color: "var(--red)" }}>{stats.totals.rejected ?? 0} rejected</span>
        </div>
      )}

      {/* Task filter tabs */}
      <div className="tab-bar">
        <div
          className={`tab ${taskFilter === "" ? "active" : ""}`}
          onClick={() => setTaskFilter("")}
        >
          All
        </div>
        {TASKS.map(t => (
          <div
            key={t}
            className={`tab ${taskFilter === t ? "active" : ""}`}
            onClick={() => setTaskFilter(t)}
          >
            {t}
            {stats?.byTask[t] && (
              <span style={{ fontSize: "0.68rem", marginLeft: "6px", color: "var(--text-ghost)" }}>
                ({Object.values(stats.byTask[t]).reduce((a, b) => a + b, 0)})
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Status filter */}
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
        <button
          className={statusFilter === "" ? undefined : "secondary"}
          style={{ padding: "4px 12px", fontSize: "0.72rem" }}
          onClick={() => setStatusFilter("")}
        >
          All
        </button>
        {STATUSES.map(s => (
          <button
            key={s}
            className={statusFilter === s ? undefined : "secondary"}
            style={{ padding: "4px 12px", fontSize: "0.72rem" }}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <p style={{ color: "var(--text-tertiary)", fontSize: "0.82rem" }}>Loading...</p>
      ) : pairs.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "var(--text-tertiary)", fontSize: "0.85rem" }}>No training pairs found.</p>
          <p style={{ color: "var(--text-ghost)", fontSize: "0.78rem", marginTop: "0.5rem" }}>
            Use "Generate Data" to create pairs from existing novel chapters.
          </p>
        </div>
      ) : (
        <table className="guide-table">
          <thead>
            <tr>
              <th style={{ width: "110px" }}>ID</th>
              <th>Task</th>
              <th>Novel</th>
              <th style={{ width: "50px" }}>Ch</th>
              <th style={{ width: "90px" }}>Status</th>
              <th style={{ width: "130px" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <tr
                key={p.id}
                onClick={() => openReview(p, i)}
                style={{ cursor: "pointer" }}
              >
                <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>
                  {p.id.slice(0, 8)}
                </td>
                <td>{p.task}</td>
                <td style={{ fontSize: "0.75rem" }}>
                  {p.novel_id ? truncate(p.novel_id, 18) : "-"}
                </td>
                <td>{p.chapter_number ?? "-"}</td>
                <td><StatusBadge status={p.status} /></td>
                <td style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                  {formatDate(p.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
