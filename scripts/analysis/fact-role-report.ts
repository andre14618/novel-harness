#!/usr/bin/env bun
/**
 * Read-only diagnostic over `facts.role` (sql/049) and `canon_facts.role`
 * (sql/050). Reports role-distribution counts plus per-category /
 * per-kind cross-tabs so we can decide what role-aware context-assembly
 * should do before any consumer branches on role.
 *
 * Pure function `buildFactRoleReport` is separable from the DB query so
 * unit tests can run without Postgres.
 */

export type FactRole = "operational" | "reference" | "hidden"

const ALL_ROLES: FactRole[] = ["operational", "reference", "hidden"]

export interface FactsRow {
  novel_id: string
  category: string | null
  role: string | null
}

export interface CanonFactsRow {
  novel_id: string
  kind: string | null
  role: string | null
  superseded_by_version: number | null
}

export interface RoleCounts {
  operational: number
  reference: number
  hidden: number
  unknown: number
  total: number
}

export interface CrossTabRow {
  key: string
  counts: RoleCounts
}

export interface TableRoleSummary {
  rows: number
  novels: number
  totals: RoleCounts
  byKey: CrossTabRow[]
}

export interface FactRoleReport {
  novelId: string | null
  generatedAt: string
  facts: TableRoleSummary
  canonFacts: TableRoleSummary & { activeOnly: TableRoleSummary }
}

export function buildFactRoleReport(
  factsRows: FactsRow[],
  canonRows: CanonFactsRow[],
  novelId: string | null,
  generatedAt: string = new Date().toISOString(),
): FactRoleReport {
  const facts = summarize(
    factsRows,
    (r) => r.role,
    (r) => r.category ?? "(uncategorized)",
    (r) => r.novel_id,
  )
  const canonFacts = summarize(
    canonRows,
    (r) => r.role,
    (r) => r.kind ?? "(unkind)",
    (r) => r.novel_id,
  )
  const activeOnly = summarize(
    canonRows.filter((r) => r.superseded_by_version === null),
    (r) => r.role,
    (r) => r.kind ?? "(unkind)",
    (r) => r.novel_id,
  )
  return {
    novelId,
    generatedAt,
    facts,
    canonFacts: { ...canonFacts, activeOnly },
  }
}

function summarize<T>(
  rows: T[],
  roleOf: (r: T) => string | null,
  keyOf: (r: T) => string,
  novelOf: (r: T) => string,
): TableRoleSummary {
  const totals = makeCounts()
  const novels = new Set<string>()
  const byKey = new Map<string, RoleCounts>()
  for (const row of rows) {
    novels.add(novelOf(row))
    const role = normalizeRole(roleOf(row))
    bump(totals, role)
    const key = keyOf(row)
    const counts = byKey.get(key) ?? makeCounts()
    bump(counts, role)
    byKey.set(key, counts)
  }
  const sortedKeys = [...byKey.entries()]
    .map(([key, counts]) => ({ key, counts }))
    .sort((a, b) => b.counts.total - a.counts.total || a.key.localeCompare(b.key))
  return {
    rows: rows.length,
    novels: novels.size,
    totals,
    byKey: sortedKeys,
  }
}

function makeCounts(): RoleCounts {
  return { operational: 0, reference: 0, hidden: 0, unknown: 0, total: 0 }
}

function bump(counts: RoleCounts, role: FactRole | "unknown"): void {
  counts[role]++
  counts.total++
}

function normalizeRole(value: string | null): FactRole | "unknown" {
  if (value === "operational" || value === "reference" || value === "hidden") return value
  return "unknown"
}

export function renderFactRoleReport(report: FactRoleReport): string {
  const lines: string[] = []
  lines.push("# Fact Role Distribution")
  lines.push("")
  lines.push(`Generated ${report.generatedAt}.`)
  lines.push(report.novelId ? `Scope: novel \`${report.novelId}\`.` : "Scope: all novels.")
  lines.push("")
  lines.push(renderTable("facts", report.facts))
  lines.push(renderTable("canon_facts (all versions)", report.canonFacts))
  lines.push(renderTable("canon_facts (active only)", report.canonFacts.activeOnly))
  return lines.join("\n")
}

function renderTable(title: string, summary: TableRoleSummary): string {
  const lines: string[] = []
  lines.push(`## ${title}`)
  lines.push("")
  lines.push(`Rows: ${summary.rows} across ${summary.novels} novel(s).`)
  lines.push("")
  lines.push("| role | count | % |")
  lines.push("|---|---|---|")
  for (const role of ALL_ROLES) {
    lines.push(`| ${role} | ${summary.totals[role]} | ${pct(summary.totals[role], summary.totals.total)} |`)
  }
  if (summary.totals.unknown > 0) {
    lines.push(`| (unknown) | ${summary.totals.unknown} | ${pct(summary.totals.unknown, summary.totals.total)} |`)
  }
  lines.push("")
  if (summary.byKey.length > 0) {
    lines.push("| key | total | operational | reference | hidden |")
    lines.push("|---|---|---|---|---|")
    for (const row of summary.byKey) {
      lines.push(
        `| \`${row.key}\` | ${row.counts.total} | ${row.counts.operational} | ` +
          `${row.counts.reference} | ${row.counts.hidden} |`,
      )
    }
    lines.push("")
  }
  return lines.join("\n")
}

function pct(count: number, total: number): string {
  if (total === 0) return "n/a"
  return `${((count / total) * 100).toFixed(0)}%`
}

interface Args {
  novelId: string | null
  json: boolean
}

function parseArgs(argv: string[]): Args {
  let novelId: string | null = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      const value = argv[++i]
      if (!value) throw new Error("--novel requires a value")
      novelId = value
    } else if (arg === "--json") {
      json = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return { novelId, json }
}

async function loadRows(
  novelId: string | null,
): Promise<{ facts: FactsRow[]; canon: CanonFactsRow[] }> {
  const { default: db } = await import("../../src/db/connection")
  const factsRows = (novelId
    ? await db`SELECT novel_id, category, role FROM facts WHERE novel_id = ${novelId}`
    : await db`SELECT novel_id, category, role FROM facts`) as FactsRow[]
  const canonRows = (novelId
    ? await db`SELECT novel_id, kind, role, superseded_by_version
                FROM canon_facts WHERE novel_id = ${novelId}`
    : await db`SELECT novel_id, kind, role, superseded_by_version FROM canon_facts`) as CanonFactsRow[]
  return { facts: factsRows, canon: canonRows }
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/fact-role-report.ts [--novel <novelId>] [--json]")
    return 2
  }

  const { facts, canon } = await loadRows(args.novelId)
  const report = buildFactRoleReport(facts, canon, args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderFactRoleReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
