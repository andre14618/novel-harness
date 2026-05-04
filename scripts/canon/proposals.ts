/**
 * Operator CLI for the canon-proposal review surface.
 *
 * Charter: docs/charters/world-bible-architecture.md §1
 * Design:  docs/designs/collaborative-proposal-workflow.md
 *
 * Calls the substrate + DB helpers directly (not the HTTP routes) so it
 * works without an orchestrator process running. Same shape as the
 * `/api/novel/:id/canon-proposals*` routes but as a terminal-friendly
 * surface for operators who don't want to curl the API or click through
 * the Studio review panel.
 *
 * Usage:
 *   bun scripts/canon/proposals.ts list <novelId> [--status=pending|approved|rejected|modified|all|<csv>] [--source=<src>] [--chapter=N] [--planner-only]
 *   bun scripts/canon/proposals.ts approve <novelId> <proposalId> [--note=<text>] [--dry-run]
 *   bun scripts/canon/proposals.ts reject  <novelId> <proposalId> [--note=<text>] [--dry-run]
 *   bun scripts/canon/proposals.ts approve-all <novelId> [--source=<src>] [--chapter=N] [--planner-only] [--dry-run]
 *   bun scripts/canon/proposals.ts reject-all  <novelId> [--source=<src>] [--chapter=N] [--planner-only] [--dry-run]
 *   bun scripts/canon/proposals.ts generate <novelId>
 */

import db from "../../src/db/connection"
import {
  ALL_PROPOSAL_STATUSES,
  findProposal,
  listPendingProposals,
  listProposalsByStatus,
  proposalFromRow,
} from "../../src/db/canon-substrate"
import { PostgresCanonSubstrate } from "../../src/harness/canon-substrate"
import {
  generatePlannerCanonProposals,
  plannerProposalPrefix,
} from "../../src/harness/planner-canon-proposals"
import { getChapterOutlines } from "../../src/db/outlines"
import type { CanonUpdateProposal } from "../../src/canon/api"

interface CommonFilters {
  source?: string
  chapter?: number
  plannerOnly: boolean
}

function parseCommonFilters(argv: string[]): CommonFilters {
  let source: string | undefined
  let chapter: number | undefined
  let plannerOnly = false
  for (const arg of argv) {
    if (arg.startsWith("--source=")) source = arg.slice("--source=".length)
    else if (arg.startsWith("--chapter=")) {
      const n = Number(arg.slice("--chapter=".length))
      if (Number.isFinite(n) && Number.isInteger(n)) chapter = n
    } else if (arg === "--planner-only") plannerOnly = true
  }
  return { source, chapter, plannerOnly }
}

function parseStatusArg(argv: string[]): readonly string[] | undefined {
  const flag = argv.find((a) => a.startsWith("--status="))
  if (!flag) return undefined
  const raw = flag.slice("--status=".length)
  if (raw === "all") return ALL_PROPOSAL_STATUSES
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean)
  const valid = new Set(ALL_PROPOSAL_STATUSES)
  for (const p of parts) {
    if (!valid.has(p)) {
      console.error(`unknown status ${p}; valid: ${ALL_PROPOSAL_STATUSES.join(",")}|all`)
      process.exit(2)
    }
  }
  return parts
}

function getNoteArg(argv: string[]): string | undefined {
  const flag = argv.find((a) => a.startsWith("--note="))
  return flag ? flag.slice("--note=".length) : undefined
}

function applyClientFilters(
  proposals: CanonUpdateProposal[],
  novelId: string,
  filters: CommonFilters,
): CanonUpdateProposal[] {
  let out = proposals
  if (filters.source) out = out.filter((p) => p.source === filters.source)
  if (filters.chapter !== undefined) {
    const ch = filters.chapter
    out = out.filter((p) => p.proposedFact.provenance.chapter === ch)
  }
  if (filters.plannerOnly) {
    const prefix = plannerProposalPrefix(novelId)
    out = out.filter((p) => p.id.startsWith(prefix))
  }
  return out
}

async function fetchAndFilter(
  novelId: string,
  argv: string[],
): Promise<CanonUpdateProposal[]> {
  const statuses = parseStatusArg(argv)
  const filters = parseCommonFilters(argv)
  const rows = statuses
    ? await listProposalsByStatus(novelId, statuses)
    : await listPendingProposals(novelId)
  return applyClientFilters(rows.map(proposalFromRow), novelId, filters)
}

function printList(proposals: CanonUpdateProposal[]): void {
  if (proposals.length === 0) {
    console.log("(no proposals match)")
    return
  }
  console.log(`${proposals.length} proposal(s):`)
  for (const p of proposals) {
    const f = p.proposedFact
    const prov = f.provenance
    const provBits = [`ch${prov.chapter}`]
    if (prov.beat !== undefined) provBits.push(`beat${prov.beat}`)
    provBits.push(prov.source)
    console.log(
      `  [${p.status}] ${p.id}\n    ${f.kind}  ${f.id}\n    ${f.text}\n    (${provBits.join(" · ")})`,
    )
  }
}

async function cmdList(novelId: string, rest: string[]): Promise<void> {
  const proposals = await fetchAndFilter(novelId, rest)
  printList(proposals)
}

async function resolveOne(
  novelId: string,
  proposalId: string,
  status: "approved" | "rejected",
  note: string | undefined,
  dryRun: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const row = await findProposal(proposalId)
  if (!row || row.novel_id !== novelId) {
    return { ok: false, error: `unknown proposalId ${proposalId} for novel ${novelId}` }
  }
  if (row.status !== "pending") {
    return { ok: false, error: `proposal ${proposalId} already ${row.status}` }
  }
  if (dryRun) {
    return { ok: true }
  }
  try {
    const sub = new PostgresCanonSubstrate()
    await sub.resolveProposal(proposalId, status, { operatorNote: note })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function cmdApprove(novelId: string, proposalId: string, argv: string[]): Promise<number> {
  const note = getNoteArg(argv)
  const dryRun = argv.includes("--dry-run")
  const result = await resolveOne(novelId, proposalId, "approved", note, dryRun)
  if (!result.ok) {
    console.error(result.error ?? "unknown error")
    return 1
  }
  console.log(dryRun ? `would approve ${proposalId}` : `approved ${proposalId}`)
  return 0
}

async function cmdReject(novelId: string, proposalId: string, argv: string[]): Promise<number> {
  const note = getNoteArg(argv)
  const dryRun = argv.includes("--dry-run")
  const result = await resolveOne(novelId, proposalId, "rejected", note, dryRun)
  if (!result.ok) {
    console.error(result.error ?? "unknown error")
    return 1
  }
  console.log(dryRun ? `would reject ${proposalId}` : `rejected ${proposalId}`)
  return 0
}

// Mirror the HTTP bulk-resolve soft cap (`src/orchestrator/canon-proposal-routes.ts`).
// CLI bulk operations bypass the HTTP route's auth + cap, so we re-impose
// the same guard here per Codex round-1 review of Package C (MEDIUM 2).
// Operators can override with `--force` for cases where they truly want
// to clear a large queue and have already triaged it.
const CLI_BULK_SOFT_CAP = 200

async function cmdBulkResolve(
  novelId: string,
  status: "approved" | "rejected",
  argv: string[],
): Promise<number> {
  const filters = parseCommonFilters(argv)
  const dryRun = argv.includes("--dry-run")
  const force = argv.includes("--force")
  const note = getNoteArg(argv)
  const rows = await listPendingProposals(novelId)
  const targets = applyClientFilters(rows.map(proposalFromRow), novelId, filters)
  if (targets.length === 0) {
    console.log("(no pending proposals match the filter)")
    return 0
  }
  if (!force && targets.length > CLI_BULK_SOFT_CAP) {
    console.error(
      `bulk ${status}-all would touch ${targets.length} proposals (> ${CLI_BULK_SOFT_CAP} cap). ` +
        `Re-run with --force to override, or narrow the filter (--source / --chapter / --planner-only).`,
    )
    return 2
  }
  console.log(`${dryRun ? "would " : ""}${status} ${targets.length} proposal(s):`)
  let okCount = 0
  let errCount = 0
  for (const p of targets) {
    const r = await resolveOne(novelId, p.id, status, note, dryRun)
    if (r.ok) {
      okCount += 1
      console.log(`  ${dryRun ? "DRY " : "OK   "} ${p.id}`)
    } else {
      errCount += 1
      console.log(`  ERR  ${p.id} — ${r.error}`)
    }
  }
  console.log(`done: ok=${okCount} error=${errCount}${dryRun ? " (dry-run)" : ""}`)
  return errCount > 0 ? 1 : 0
}

async function cmdGenerate(novelId: string): Promise<number> {
  const outlines = await getChapterOutlines(novelId)
  if (outlines.length === 0) {
    console.error(`no chapter outlines found for novel ${novelId}`)
    return 1
  }
  const result = await generatePlannerCanonProposals(novelId, outlines)
  const tag = result.gateClear ? "gate=CLEAR" : "gate=REFUSED"
  console.log(
    `${tag}  outlines=${outlines.length}  created=${result.created}  skipped=${result.skipped}`,
  )
  if (!result.gateClear) {
    console.log("gate report summary:")
    console.log(JSON.stringify(result.gateReport.summary, null, 2))
  }
  return result.gateClear ? 0 : 1
}

function usage(): never {
  console.error(
    [
      "usage:",
      "  bun scripts/canon/proposals.ts list     <novelId> [--status=...] [--source=...] [--chapter=N] [--planner-only]",
      "  bun scripts/canon/proposals.ts approve  <novelId> <proposalId> [--note=...] [--dry-run]",
      "  bun scripts/canon/proposals.ts reject   <novelId> <proposalId> [--note=...] [--dry-run]",
      "  bun scripts/canon/proposals.ts approve-all <novelId> [--source=...] [--chapter=N] [--planner-only] [--dry-run] [--force]",
      "  bun scripts/canon/proposals.ts reject-all  <novelId> [--source=...] [--chapter=N] [--planner-only] [--dry-run] [--force]",
      "      (--force overrides the 200-row soft cap)",
      "  bun scripts/canon/proposals.ts generate <novelId>",
    ].join("\n"),
  )
  process.exit(2)
}

async function main(): Promise<void> {
  const [, , cmd, novelId, ...rest] = process.argv
  if (!cmd || !novelId) usage()
  let exitCode = 0
  switch (cmd) {
    case "list":
      await cmdList(novelId, rest)
      break
    case "approve": {
      const proposalId = rest[0]
      if (!proposalId) usage()
      exitCode = await cmdApprove(novelId, proposalId, rest.slice(1))
      break
    }
    case "reject": {
      const proposalId = rest[0]
      if (!proposalId) usage()
      exitCode = await cmdReject(novelId, proposalId, rest.slice(1))
      break
    }
    case "approve-all":
      exitCode = await cmdBulkResolve(novelId, "approved", rest)
      break
    case "reject-all":
      exitCode = await cmdBulkResolve(novelId, "rejected", rest)
      break
    case "generate":
      exitCode = await cmdGenerate(novelId)
      break
    default:
      usage()
  }
  await db.end()
  process.exit(exitCode)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
