#!/usr/bin/env bun
/**
 * Diagnostic-only preview for the fact-role context policy before runtime
 * writer/checker retrieval opts into role-aware filtering.
 *
 * Pure function `buildFactRoleContextPreview` is separable from the DB query so
 * tests can exercise the policy without Postgres.
 */

import {
  isContinuityBlockingFact,
  isHiddenFact,
  isReferenceFact,
  isWriterVisibleFact,
} from "../../src/harness/fact-roles"

export interface LegacyFactContextRow {
  novel_id: string
  category: string | null
  role?: string | null
}

export interface CanonFactContextRow {
  novel_id: string
  kind: string | null
  role?: string | null
  superseded_by_version?: number | null
}

export interface ContextPolicyCounts {
  totalRows: number
  unknownRoleCount: number
  writerVisibleCount: number
  hiddenExcludedFromWriterCount: number
  continuityBlockingCount: number
  referenceAdvisoryOnlyCount: number
  hiddenExcludedFromContinuityCount: number
}

export interface ContextPolicyBreakdownRow {
  key: string
  counts: ContextPolicyCounts
}

export interface ContextPolicySourceSummary extends ContextPolicyCounts {
  novels: number
  byKey: ContextPolicyBreakdownRow[]
}

export interface FactRoleContextPreviewReport {
  novelId: string | null
  generatedAt: string
  legacyFacts: ContextPolicySourceSummary
  activeCanonFacts: ContextPolicySourceSummary
}

type FactLike = { novel_id: string; role?: string | null }

export function buildFactRoleContextPreview(
  legacyRows: readonly LegacyFactContextRow[],
  canonRows: readonly CanonFactContextRow[],
  novelId: string | null = null,
  generatedAt: string = new Date().toISOString(),
): FactRoleContextPreviewReport {
  return {
    novelId,
    generatedAt,
    legacyFacts: summarizeRows(
      legacyRows,
      (row) => row.category ?? "(uncategorized)",
    ),
    activeCanonFacts: summarizeRows(
      canonRows.filter((row) => row.superseded_by_version == null),
      (row) => row.kind ?? "(unkind)",
    ),
  }
}

function summarizeRows<T extends FactLike>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): ContextPolicySourceSummary {
  const totals = makeCounts()
  const novels = new Set<string>()
  const byKey = new Map<string, ContextPolicyCounts>()

  for (const row of rows) {
    novels.add(row.novel_id)
    bumpCounts(totals, row)

    const key = keyOf(row)
    const keyCounts = byKey.get(key) ?? makeCounts()
    bumpCounts(keyCounts, row)
    byKey.set(key, keyCounts)
  }

  return {
    ...totals,
    novels: novels.size,
    byKey: [...byKey.entries()]
      .map(([key, counts]) => ({ key, counts }))
      .sort((a, b) => b.counts.totalRows - a.counts.totalRows || a.key.localeCompare(b.key)),
  }
}

function makeCounts(): ContextPolicyCounts {
  return {
    totalRows: 0,
    unknownRoleCount: 0,
    writerVisibleCount: 0,
    hiddenExcludedFromWriterCount: 0,
    continuityBlockingCount: 0,
    referenceAdvisoryOnlyCount: 0,
    hiddenExcludedFromContinuityCount: 0,
  }
}

function bumpCounts(counts: ContextPolicyCounts, row: { role?: string | null }): void {
  counts.totalRows++
  if (!isKnownRole(row.role)) counts.unknownRoleCount++
  if (isWriterVisibleFact(row)) counts.writerVisibleCount++
  if (isHiddenFact(row)) counts.hiddenExcludedFromWriterCount++
  if (isContinuityBlockingFact(row)) counts.continuityBlockingCount++
  if (isReferenceFact(row)) counts.referenceAdvisoryOnlyCount++
  if (isHiddenFact(row)) counts.hiddenExcludedFromContinuityCount++
}

function isKnownRole(value: unknown): boolean {
  return value === "operational" || value === "reference" || value === "hidden"
}

export function renderFactRoleContextPreview(report: FactRoleContextPreviewReport): string {
  const lines: string[] = []
  lines.push("# Fact Role Context Preview")
  lines.push("")
  lines.push(`Generated ${report.generatedAt}.`)
  lines.push(report.novelId ? `Scope: novel \`${report.novelId}\`.` : "Scope: all novels.")
  lines.push("Unknown or missing roles are counted explicitly and previewed as operational.")
  lines.push("")
  lines.push(renderSummaryTable(report))
  lines.push(renderBreakdown("legacy facts by category", report.legacyFacts))
  lines.push(renderBreakdown("active canon_facts by kind", report.activeCanonFacts))
  return lines.join("\n")
}

function renderSummaryTable(report: FactRoleContextPreviewReport): string {
  const lines: string[] = []
  lines.push("| source | rows | unknown roles | writer-visible | hidden skipped for writer | continuity-blocking | reference advisory-only | hidden skipped for continuity |")
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|")
  lines.push(renderCountsRow("legacy facts", report.legacyFacts))
  lines.push(renderCountsRow("active canon_facts", report.activeCanonFacts))
  lines.push("")
  return lines.join("\n")
}

function renderBreakdown(title: string, summary: ContextPolicySourceSummary): string {
  const lines: string[] = []
  lines.push(`## ${title}`)
  lines.push("")
  lines.push(`Rows: ${summary.totalRows} across ${summary.novels} novel(s).`)
  if (summary.byKey.length === 0) {
    lines.push("")
    lines.push("No rows.")
    lines.push("")
    return lines.join("\n")
  }

  lines.push("")
  lines.push("| key | rows | unknown | writer-visible | hidden writer skip | continuity-blocking | reference advisory | hidden continuity skip |")
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|")
  for (const row of summary.byKey) {
    lines.push(renderCountsRow(`\`${row.key}\``, row.counts))
  }
  lines.push("")
  return lines.join("\n")
}

function renderCountsRow(label: string, counts: ContextPolicyCounts): string {
  return `| ${label} | ${counts.totalRows} | ${counts.unknownRoleCount} | ${counts.writerVisibleCount} | ${counts.hiddenExcludedFromWriterCount} | ${counts.continuityBlockingCount} | ${counts.referenceAdvisoryOnlyCount} | ${counts.hiddenExcludedFromContinuityCount} |`
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
): Promise<{ legacy: LegacyFactContextRow[]; canon: CanonFactContextRow[] }> {
  const { default: db } = await import("../../src/db/connection")
  const legacy = (novelId
    ? await db`SELECT novel_id, category, role FROM facts WHERE novel_id = ${novelId}`
    : await db`SELECT novel_id, category, role FROM facts`) as LegacyFactContextRow[]
  const canon = (novelId
    ? await db`
        SELECT novel_id, kind, role, superseded_by_version
        FROM canon_facts
        WHERE novel_id = ${novelId}
          AND superseded_by_version IS NULL
      `
    : await db`
        SELECT novel_id, kind, role, superseded_by_version
        FROM canon_facts
        WHERE superseded_by_version IS NULL
      `) as CanonFactContextRow[]
  return { legacy, canon }
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/fact-role-context-preview.ts [--novel <novelId>] [--json]")
    return 2
  }

  const { legacy, canon } = await loadRows(args.novelId)
  const report = buildFactRoleContextPreview(legacy, canon, args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderFactRoleContextPreview(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
