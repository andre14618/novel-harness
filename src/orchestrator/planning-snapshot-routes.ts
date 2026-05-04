/**
 * Planning Snapshot Routes (Phase 4 commit 3).
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 4 — Planning Snapshot Review Before Drafting"
 *
 * Two routes:
 *
 *   GET  /api/novel/:novelId/planning-snapshot/current
 *     → { ok, novelId, computedHash, version, lockedSnapshot | null, drift }
 *     The UI fetches this on the planning panel mount: `computedHash` is
 *     the live hash for the current planning state; `lockedSnapshot` (if
 *     any) is the active drafting target; `drift = computedHash !==
 *     lockedSnapshot.id` (false when nothing is locked).
 *
 *   POST /api/novel/:novelId/planning-snapshot/lock
 *     Body: {
 *       hash: string,                                  // 64-hex
 *       lockedBy: {
 *         kind: "human" | "policy" | "script" | "test",
 *         ref?: string,
 *         note?: string,
 *       },
 *     }
 *     Behavior:
 *       1. Records the snapshot if absent (idempotent insert).
 *       2. Locks via WHERE locked_at IS NULL — re-lock attempts on a
 *          locked row return 409 + actualLock metadata.
 *       3. Returns the locked row on success.
 *     The route recomputes `computePlanningSnapshotHash(novelId)` and
 *     rejects with 409 + `{ expectedHash, providedHash }` when the
 *     body's hash doesn't match. Without this, the route would happily
 *     record + lock any 64-hex string the caller fabricated — a poison
 *     vector against drift detection (an attacker or buggy script
 *     could lock an arbitrary hash so future drift checks miss).
 *     Explicit consent now means: "lock the live planning state, after
 *     I've inspected its hash via GET /current and verified it matches
 *     what I want to commit to." If state drifted between the
 *     operator's GET and POST, they re-fetch and re-confirm — the
 *     mismatch is surfaced explicitly, not silently locked away.
 *     A TOCTOU race between GET and POST is acceptable because the
 *     POST recomputes server-side: only the live state at POST time
 *     can be locked, never a stale or fabricated hash.
 */

import { z } from "zod"
import { computePlanningSnapshotHash } from "../canon/planning-snapshot"
import { runPlannerCanonDeltaAudit } from "../canon/planner-canon-delta"
import { getChapterOutlines } from "../db/outlines"
import {
  recordPlanningSnapshot,
  findPlanningSnapshot,
  getLockedPlanningSnapshot,
  lockPlanningSnapshot,
} from "../db/planning-snapshots"

// v2 (2026-05-04): hash now includes worldSystems / cultures /
// characterCultures / characterSystemAwareness — the writer-consumed
// planning graph rows. v1 callers can still recompute v1 hashes by
// calling computePlanningSnapshotHash(novelId, "v1") directly; the
// route uses v2 for all GET / POST traffic.
const SNAPSHOT_VERSION = "v2"

const HASH_RE = /^[0-9a-f]{64}$/

const lockBodySchema = z.object({
  hash: z.string().regex(HASH_RE, "hash must be a 64-char lowercase hex sha256"),
  lockedBy: z.object({
    kind: z.enum(["human", "policy", "script", "test"]),
    ref: z.string().optional(),
    note: z.string().optional(),
  }),
})

type LockBody = z.infer<typeof lockBodySchema>

export async function handlePlanningSnapshotRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname

  // GET /api/novel/:novelId/planning-snapshot/current
  const currentMatch = path.match(/^\/api\/novel\/([^/]+)\/planning-snapshot\/current$/)
  if (currentMatch && req.method === "GET") {
    const novelId = decodeURIComponent(currentMatch[1])
    try {
      const computedHash = await computePlanningSnapshotHash(novelId, SNAPSHOT_VERSION)
      const locked = await getLockedPlanningSnapshot(novelId)
      const drift = locked !== null ? computedHash !== locked.id : false
      return Response.json({
        ok: true,
        novelId,
        computedHash,
        version: SNAPSHOT_VERSION,
        lockedSnapshot: locked,
        drift,
      })
    } catch (err) {
      return Response.json(
        { ok: false, error: `planning-snapshot/current failed: ${String(err)}` },
        { status: 500 },
      )
    }
  }

  // GET /api/novel/:novelId/planning-snapshot/mechanical-health
  //
  // Phase 4 commit 4 deferred — exposes `runPlannerCanonDeltaAudit` (a pure
  // helper over chapter outlines) so the Planning Snapshot UI panel can
  // surface the design's "mechanical health" summary without each consumer
  // re-implementing the audit. Empty outline list → empty report (gates
  // FAIL by design — `idGraphGateClear` requires `chapters.length > 0 &&
  // sourceItems.length > 0`); the operator sees the same report shape and
  // can act on it.
  const auditMatch = path.match(
    /^\/api\/novel\/([^/]+)\/planning-snapshot\/mechanical-health$/,
  )
  if (auditMatch && req.method === "GET") {
    const novelId = decodeURIComponent(auditMatch[1])
    try {
      const outlines = await getChapterOutlines(novelId)
      const report = runPlannerCanonDeltaAudit(`novel:${novelId}`, outlines)
      return Response.json({ ok: true, novelId, report })
    } catch (err) {
      return Response.json(
        { ok: false, error: `planning-snapshot/mechanical-health failed: ${String(err)}` },
        { status: 500 },
      )
    }
  }

  // POST /api/novel/:novelId/planning-snapshot/lock
  const lockMatch = path.match(/^\/api\/novel\/([^/]+)\/planning-snapshot\/lock$/)
  if (lockMatch && req.method === "POST") {
    const novelId = decodeURIComponent(lockMatch[1])

    let body: LockBody
    try {
      const raw = await req.json()
      const parsed = lockBodySchema.safeParse(raw)
      if (!parsed.success) {
        return Response.json(
          {
            ok: false,
            error: "invalid request body",
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
          { status: 400 },
        )
      }
      body = parsed.data
    } catch (err) {
      return Response.json({ ok: false, error: `malformed json: ${String(err)}` }, { status: 400 })
    }

    try {
      // 1. Recompute the live hash and reject mismatches. Without this
      //    guard, the route would record + lock any 64-hex string the
      //    caller fabricated, poisoning drift detection (a future GET
      //    /current would see drift = false against an arbitrary
      //    hash). The recompute is cheap (canonical-JSON over the
      //    planning slice already loaded by other paths). Returns 409
      //    so the caller can re-fetch and retry rather than giving up.
      const computedHash = await computePlanningSnapshotHash(novelId, SNAPSHOT_VERSION)
      if (body.hash !== computedHash) {
        return Response.json(
          {
            ok: false,
            error: "lock hash does not match live planning snapshot",
            expectedHash: computedHash,
            providedHash: body.hash,
          },
          { status: 409 },
        )
      }

      // 2. Idempotent record (no-op if already there).
      await recordPlanningSnapshot({
        hash: body.hash,
        novelId,
        version: SNAPSHOT_VERSION,
      })

      // 3. Attempt to lock.
      const locked = await lockPlanningSnapshot({
        hash: body.hash,
        lockedByKind: body.lockedBy.kind,
        lockedByRef: body.lockedBy.ref ?? null,
        lockedNote: body.lockedBy.note ?? null,
      })

      if (!locked) {
        // The record + lock are sequential; record almost-certainly
        // succeeded above. So `locked === false` here means: row exists
        // but locked_at was already set. Look up to surface the existing
        // lock metadata so the operator sees who locked and when.
        const row = await findPlanningSnapshot(body.hash)
        if (row === null) {
          // Genuinely missing — would indicate a DB-level issue (record
          // and lock raced against a delete?). Surface as 404 so callers
          // can retry with a fresh GET /current.
          return Response.json(
            { ok: false, error: "snapshot not found", hash: body.hash },
            { status: 404 },
          )
        }
        return Response.json(
          {
            ok: false,
            error: "snapshot already locked",
            hash: body.hash,
            actualLock: {
              lockedAt: row.locked_at,
              lockedByKind: row.locked_by_kind,
              lockedByRef: row.locked_by_ref,
              lockedNote: row.locked_note,
            },
          },
          { status: 409 },
        )
      }

      // 4. Return the freshly-locked row.
      const row = await findPlanningSnapshot(body.hash)
      return Response.json({ ok: true, snapshot: row })
    } catch (err) {
      return Response.json(
        { ok: false, error: `planning-snapshot/lock failed: ${String(err)}` },
        { status: 500 },
      )
    }
  }

  return null
}
