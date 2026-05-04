/**
 * Phase 4 commit 4 — Planning Snapshot panel.
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 4 — Planning Snapshot Review Before Drafting"
 *
 * The page operators land on before drafting. Shows the current planning
 * state's snapshot hash, the active lock (if any), drift status, and a
 * Lock button that explicitly commits to drafting against the observed
 * state. Read-only mostly — locking is the only mutation.
 *
 * Mechanical health (ID graph valid, obligation coverage, duplicate IDs,
 * unknown references per design doc) is deferred — `runPlannerCanonDeltaAudit`
 * isn't exposed via HTTP yet, and adding that route is its own follow-up.
 * MVP focuses on the explicit-consent locking surface that commit 3 enabled.
 */

import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import {
  getCurrentPlanningSnapshot,
  lockPlanningSnapshot,
  getWorldBible,
  getCharacters,
  getStorySpine,
} from "../api"
import type { PlanningSnapshotCurrent, LockPlanningSnapshotResponse } from "../api"

interface ArtifactSummary {
  worldKeys: string[]
  characterCount: number
  characterNames: string[]
  hasSpine: boolean
  spineCentralConflict: string | null
}

export default function PlanningSnapshotPage() {
  const { novelId } = useParams<{ novelId: string }>()
  const [search] = useSearchParams()
  const [snapshot, setSnapshot] = useState<PlanningSnapshotCurrent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [locking, setLocking] = useState(false)
  const [lockResult, setLockResult] = useState<LockPlanningSnapshotResponse | null>(null)
  const [note, setNote] = useState("")
  const [artifacts, setArtifacts] = useState<ArtifactSummary | null>(null)

  const refresh = async () => {
    if (!novelId) return
    setLoading(true)
    setError(null)
    try {
      const res = await getCurrentPlanningSnapshot(novelId)
      setSnapshot(res)
    } catch (err) {
      setError((err as Error).message ?? String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!novelId) return
    void refresh()
    void (async () => {
      try {
        const [world, chars, spine] = await Promise.all([
          getWorldBible(novelId).catch(() => null),
          getCharacters(novelId).catch(() => [] as any[]),
          getStorySpine(novelId).catch(() => null),
        ])
        setArtifacts({
          worldKeys: world ? Object.keys(world).filter(k => world[k]) : [],
          characterCount: chars?.length ?? 0,
          characterNames: (chars ?? []).map((c: any) => c?.name ?? c?.id ?? "?"),
          hasSpine: !!spine,
          spineCentralConflict: (spine as any)?.centralConflict ?? null,
        })
      } catch {
        // Silent — artifact summary is best-effort cosmetic context.
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId])

  const handleLock = async () => {
    if (!snapshot || !novelId || locking) return
    if (!confirm(
      snapshot.drift
        ? "Live planning state has drifted from any prior lock. Lock the CURRENT state for drafting?"
        : "Lock the current planning state for drafting? Lock is one-way; new edits would create drift.",
    )) return
    setLocking(true)
    setLockResult(null)
    try {
      const res = await lockPlanningSnapshot(novelId, {
        hash: snapshot.computedHash,
        lockedBy: { kind: "human", note: note || undefined },
      })
      setLockResult(res)
      if (res.ok) {
        setNote("")
        await refresh()
      }
    } catch (err) {
      setLockResult({ ok: false, error: (err as Error).message ?? String(err) })
    } finally {
      setLocking(false)
    }
  }

  if (!novelId) {
    return <div style={{ padding: 16 }}>Missing novelId in URL.</div>
  }

  return (
    <div style={{ padding: 16, maxWidth: 980, margin: "0 auto", color: "#cde" }}>
      <h2 style={{ marginTop: 0 }}>Planning Snapshot</h2>
      <div style={{ fontSize: "0.85em", color: "#789", marginBottom: 12 }}>
        Novel <code style={{ background: "#1a2530", padding: "1px 6px", borderRadius: 2 }}>{novelId}</code>
        {search.get("from") && <> · returned from {search.get("from")}</>}
      </div>

      {loading && <div style={{ color: "#789" }}>Loading…</div>}
      {error && (
        <div style={{ background: "#3a1f1f", border: "1px solid #5a2c2c", padding: 8, borderRadius: 4, color: "#fce", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {snapshot && (
        <>
          {snapshot.drift && snapshot.lockedSnapshot && (
            <div
              style={{
                background: "#3a3a1f",
                border: "1px solid #6a6a2c",
                color: "#fec",
                padding: 10,
                borderRadius: 4,
                marginBottom: 12,
                fontSize: "0.9em",
              }}
            >
              <strong>Drift detected.</strong> Planning state has changed since the active lock.
              Drafting against this state requires a fresh lock.
              <div style={{ marginTop: 4, fontSize: "0.85em", color: "#cba" }}>
                locked: <code>{snapshot.lockedSnapshot.id.slice(0, 16)}…</code>{" "}
                · live: <code>{snapshot.computedHash.slice(0, 16)}…</code>
              </div>
            </div>
          )}

          {!snapshot.drift && snapshot.lockedSnapshot && (
            <div
              style={{
                background: "#1f3a26",
                border: "1px solid #2c5a36",
                color: "#cfe",
                padding: 10,
                borderRadius: 4,
                marginBottom: 12,
                fontSize: "0.9em",
              }}
            >
              <strong>Locked.</strong> Drafting target is the current planning state.
              <div style={{ marginTop: 4, fontSize: "0.85em" }}>
                <code>{snapshot.lockedSnapshot.id.slice(0, 16)}…</code>{" "}
                locked by {snapshot.lockedSnapshot.locked_by_kind ?? "?"}{" "}
                {snapshot.lockedSnapshot.locked_at && (
                  <>at {new Date(snapshot.lockedSnapshot.locked_at).toLocaleString()}</>
                )}
                {snapshot.lockedSnapshot.locked_note && (
                  <span style={{ color: "#9ab" }}> — “{snapshot.lockedSnapshot.locked_note}”</span>
                )}
              </div>
            </div>
          )}

          {!snapshot.lockedSnapshot && (
            <div
              style={{
                background: "#1f2e3a",
                border: "1px solid #2c485a",
                color: "#cef",
                padding: 10,
                borderRadius: 4,
                marginBottom: 12,
                fontSize: "0.9em",
              }}
            >
              <strong>Not locked.</strong> No drafting target has been committed for this novel yet.
            </div>
          )}

          <Section title="Snapshot identity">
            <Field label="Computed hash">
              <code style={{ fontSize: "0.85em" }}>{snapshot.computedHash}</code>
            </Field>
            <Field label="Schema version">{snapshot.version}</Field>
            <Field label="Drift">{snapshot.drift ? "yes" : "no"}</Field>
          </Section>

          <Section title="Artifact slices">
            {artifacts ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.88em" }}>
                <li>
                  World bible: {artifacts.worldKeys.length > 0
                    ? `${artifacts.worldKeys.length} populated keys`
                    : "empty"}
                </li>
                <li>
                  Characters: {artifacts.characterCount}{" "}
                  {artifacts.characterNames.length > 0 && (
                    <span style={{ color: "#789" }}>
                      ({artifacts.characterNames.slice(0, 6).join(", ")}
                      {artifacts.characterNames.length > 6 ? "…" : ""})
                    </span>
                  )}
                </li>
                <li>
                  Story spine: {artifacts.hasSpine
                    ? (artifacts.spineCentralConflict
                        ? `“${artifacts.spineCentralConflict}”`
                        : "present")
                    : "missing"}
                </li>
              </ul>
            ) : (
              <div style={{ color: "#789", fontSize: "0.85em" }}>Loading artifact summary…</div>
            )}
          </Section>

          <Section title="Lock for drafting">
            <div style={{ fontSize: "0.85em", color: "#9ab", marginBottom: 6 }}>
              Locking is one-way. The hash you lock becomes the drafting target; new edits
              after lock will surface as drift.
            </div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Optional note (e.g., 'ready for chapter 1 draft after Aria/Mord arc review')"
              rows={2}
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 6 }}
              disabled={locking}
            />
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={handleLock} disabled={locking}>
                {locking
                  ? "Locking…"
                  : snapshot.lockedSnapshot && !snapshot.drift
                    ? "Re-lock current state"
                    : snapshot.drift
                      ? "Lock drifted state"
                      : "Lock for drafting"}
              </button>
              <button onClick={refresh} disabled={loading}>Refresh</button>
            </div>
            {lockResult && lockResult.ok && (
              <div style={{ marginTop: 8, color: "#9c9", fontSize: "0.85em" }}>
                Locked successfully.
              </div>
            )}
            {lockResult && !lockResult.ok && (
              <div style={{ marginTop: 8, color: "#f88", fontSize: "0.85em" }}>
                {lockResult.error ?? "Lock failed."}
                {lockResult.actualLock && (
                  <div style={{ color: "#cba", marginTop: 4 }}>
                    Existing lock by {lockResult.actualLock.lockedByKind}
                    {lockResult.actualLock.lockedAt && (
                      <> at {new Date(lockResult.actualLock.lockedAt).toLocaleString()}</>
                    )}
                    {lockResult.actualLock.lockedNote && (
                      <> — “{lockResult.actualLock.lockedNote}”</>
                    )}
                  </div>
                )}
                {lockResult.expectedHash && lockResult.providedHash && (
                  <div style={{ color: "#cba", marginTop: 4, fontFamily: "monospace", fontSize: "0.8em" }}>
                    Live now: {lockResult.expectedHash.slice(0, 16)}…
                    <br />
                    You sent: {lockResult.providedHash.slice(0, 16)}…
                    <br />
                    Click Refresh to see the live hash, then re-lock.
                  </div>
                )}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #234", borderRadius: 4, padding: 10, marginBottom: 10, background: "#0c1218" }}>
      <div style={{ fontWeight: "bold", marginBottom: 6, fontSize: "0.9em" }}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 4, fontSize: "0.85em" }}>
      <span style={{ color: "#789", display: "inline-block", width: 130 }}>{label}:</span>
      {children}
    </div>
  )
}
