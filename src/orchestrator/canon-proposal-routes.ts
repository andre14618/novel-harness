/**
 * Canon Proposal Review API.
 *
 * Charter: docs/charters/world-bible-architecture.md (§1 cleared)
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 2 — Canon Proposal Review API And Minimal UI"
 * Lane:    docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-2a.md
 *
 * Routes:
 *   GET  /api/novel/:id/canon-proposals
 *     Query params:
 *       source?      filter by ProvenanceSource (e.g. "planner-output", "planning-state-mapper")
 *       chapter?     filter by proposedFact.provenance.chapter (numeric)
 *       plannerOnly? "true" → restrict to planner-deterministic-id rows
 *
 *   POST /api/novel/:id/canon-proposals/:proposalId/resolve
 *     Body: {
 *       status:           "approved" | "rejected" | "modified",
 *       modifiedFact?:    CanonFact (required when status === "modified"),
 *       operatorNote?:    string,
 *       expectedStatus?:  "pending" — stale-precondition guard. If the
 *                         proposal's current status doesn't match, the route
 *                         returns 409 Conflict with the actual status. Lets
 *                         a re-rendered review page detect it's acting on
 *                         stale state without leaking that into the resolve
 *                         path itself.
 *     }
 *
 *   POST /api/novel/:id/canon-proposals/generate-from-outline
 *     Body: {} (no payload). Operator-triggered Phase 1 generation: pulls the
 *     novel's authored outlines and runs `generatePlannerCanonProposals`.
 *     Idempotent by construction (Phase 1's deterministic id + ON CONFLICT
 *     DO NOTHING). Returns { created, skipped, gateClear, gateReport }.
 */

import {
  findProposal,
  proposalFromRow,
  listPendingProposals as dbListPendingProposals,
  listProposalsByStatus as dbListProposalsByStatus,
  ALL_PROPOSAL_STATUSES,
} from "../db/canon-substrate"
import { PostgresCanonSubstrate } from "../harness/canon-substrate"
import {
  generatePlannerCanonProposals,
  plannerProposalPrefix,
} from "../harness/planner-canon-proposals"
import { getChapterOutlines } from "../db/outlines"
import type { CanonFact, CanonUpdateProposal, ProposalStatus } from "../canon/api"

type ResolveStatus = Exclude<ProposalStatus, "pending">

const VALID_RESOLVE_STATUSES: ReadonlySet<string> = new Set([
  "approved",
  "rejected",
  "modified",
])

export async function handleCanonProposalRoute(
  req: Request,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname

  // ── List proposals (default pending; ?status= for audit / all view) ────
  const listMatch = path.match(/^\/api\/novel\/([^/]+)\/canon-proposals$/)
  if (listMatch && req.method === "GET") {
    try {
      const novelId = decodeURIComponent(listMatch[1])
      const sourceFilter = url.searchParams.get("source") ?? undefined
      const chapterFilter = parseChapterParam(url.searchParams.get("chapter"))
      const plannerOnly = url.searchParams.get("plannerOnly") === "true"
      const statusFilter = parseStatusParam(url.searchParams.get("status"))
      if (statusFilter.error) {
        return Response.json({ error: statusFilter.error }, { status: 400 })
      }

      // Choose the right query path. The pending-only path keeps its
      // creation-order semantics for consumers (UI v1) that haven't opted
      // in to status filtering. Audit-view callers (status= present) get
      // newest-first ordering, which matches operator expectations on a
      // history surface.
      const rows = statusFilter.statuses
        ? await dbListProposalsByStatus(novelId, statusFilter.statuses)
        : await dbListPendingProposals(novelId)
      let proposals = rows.map(proposalFromRow)
      if (sourceFilter) {
        proposals = proposals.filter((p) => p.source === sourceFilter)
      }
      if (chapterFilter !== undefined) {
        proposals = proposals.filter(
          (p) => p.proposedFact.provenance.chapter === chapterFilter,
        )
      }
      if (plannerOnly) {
        const prefix = plannerProposalPrefix(novelId)
        proposals = proposals.filter((p) => p.id.startsWith(prefix))
      }
      return Response.json({ proposals })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  // ── Resolve a proposal ─────────────────────────────────────────────────
  const resolveMatch = path.match(
    /^\/api\/novel\/([^/]+)\/canon-proposals\/([^/]+)\/resolve$/,
  )
  if (resolveMatch && req.method === "POST") {
    const novelId = decodeURIComponent(resolveMatch[1])
    const proposalId = decodeURIComponent(resolveMatch[2])
    let body: {
      status?: string
      modifiedFact?: CanonFact
      operatorNote?: string
      expectedStatus?: string
    }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 })
    }

    if (!body.status || !VALID_RESOLVE_STATUSES.has(body.status)) {
      return Response.json(
        {
          error: `status must be one of approved|rejected|modified; got ${JSON.stringify(body.status)}`,
        },
        { status: 400 },
      )
    }
    if (body.status === "modified" && !body.modifiedFact) {
      return Response.json(
        { error: "status=modified requires modifiedFact" },
        { status: 400 },
      )
    }

    // Authoritative read for stale-precondition + 404 detection. We do this
    // OUTSIDE the substrate.resolveProposal transaction because we want a
    // distinct 409/404 response separate from the "already resolved" error
    // the substrate raises. The substrate's own DB-level guard
    // (`updateProposalResolution WHERE status='pending'`) is the binding
    // check; this is just the API-shaped surfacing of it.
    const row = await findProposal(proposalId)
    if (!row || row.novel_id !== novelId) {
      return Response.json(
        { error: `unknown proposalId ${proposalId} for novel ${novelId}` },
        { status: 404 },
      )
    }
    if (body.expectedStatus && row.status !== body.expectedStatus) {
      return Response.json(
        {
          error: "stale precondition",
          expectedStatus: body.expectedStatus,
          actualStatus: row.status,
          proposalId,
        },
        { status: 409 },
      )
    }
    if (row.status !== "pending") {
      return Response.json(
        {
          error: `proposal ${proposalId} already ${row.status}`,
          actualStatus: row.status,
          proposalId,
        },
        { status: 409 },
      )
    }

    try {
      const sub = new PostgresCanonSubstrate()
      const result = await sub.resolveProposal(
        proposalId,
        body.status as ResolveStatus,
        {
          modifiedFact: body.modifiedFact,
          operatorNote: body.operatorNote,
        },
      )
      return Response.json({
        proposalId,
        status: body.status,
        committedFact: result.committedFact ?? null,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // The substrate may still return "already resolved" if a concurrent
      // caller resolved between our findProposal and the resolveProposal
      // transaction — surface that as 409, not 500.
      if (/already (approved|rejected|modified|pending)/i.test(msg)) {
        return Response.json(
          { error: msg, proposalId },
          { status: 409 },
        )
      }
      return Response.json({ error: msg }, { status: 500 })
    }
  }

  // ── Generate proposals from authored outlines ──────────────────────────
  const generateMatch = path.match(
    /^\/api\/novel\/([^/]+)\/canon-proposals\/generate-from-outline$/,
  )
  if (generateMatch && req.method === "POST") {
    try {
      const novelId = decodeURIComponent(generateMatch[1])
      const outlines = await getChapterOutlines(novelId)
      if (outlines.length === 0) {
        return Response.json(
          {
            error: `no chapter outlines found for novel ${novelId}`,
            novelId,
          },
          { status: 404 },
        )
      }
      const result = await generatePlannerCanonProposals(novelId, outlines)
      return Response.json({
        novelId,
        outlinesCount: outlines.length,
        gateClear: result.gateClear,
        created: result.created,
        skipped: result.skipped,
        gateReport: {
          summary: result.gateReport.summary,
          // Omit the per-chapter details on the wire to keep responses small;
          // operators can re-audit explicitly via the existing
          // `run-live-planner-canon-delta.ts` script if they need depth.
        },
      })
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 })
    }
  }

  return null
}

function parseChapterParam(raw: string | null): number | undefined {
  if (raw == null) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined
  return n
}

/**
 * Parse the `status` query param.
 *
 * - omitted          → undefined statuses (caller takes the pending-only path).
 * - `all`            → every status (the audit-history view).
 * - `pending,approved` → CSV list, validated against the canonical set.
 * - any unknown value → returns `error` so the caller can 400 the request.
 *
 * Returning `{ statuses }` rather than an array distinguishes "no filter
 * supplied" (use the existing pending-only query) from "filter says zero
 * statuses match" (which would short-circuit to `[]`).
 */
function parseStatusParam(
  raw: string | null,
): { statuses?: readonly string[]; error?: string } {
  if (raw == null || raw === "") return {}
  if (raw === "all") return { statuses: ALL_PROPOSAL_STATUSES }
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) {
    return { error: `status param empty after split; got ${JSON.stringify(raw)}` }
  }
  const validSet = new Set(ALL_PROPOSAL_STATUSES)
  const invalid = parts.filter((p) => !validSet.has(p))
  if (invalid.length > 0) {
    return {
      error: `unknown status values: ${invalid.join(", ")}; valid: ${ALL_PROPOSAL_STATUSES.join(",")}|all`,
    }
  }
  return { statuses: parts }
}

// Re-exported for tests so they don't have to import via the routes module's
// internal-only dependencies.
export type { CanonUpdateProposal }
