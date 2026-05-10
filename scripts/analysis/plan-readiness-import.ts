#!/usr/bin/env bun
/**
 * Import an existing Plan Readiness-compatible aggregate JSON into the
 * production Plan Readiness queue without rerunning the diagnostic that made
 * the sidecar.
 */

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export interface PlanReadinessImportArgs {
  novelId: string
  aggregatePath: string
  importedByRef: string | null
  refreshStaleness: boolean
  json: boolean
}

export function parseArgs(argv = process.argv.slice(2)): PlanReadinessImportArgs {
  let novelId = ""
  let aggregatePath = ""
  let importedByRef: string | null = null
  let refreshStaleness = true
  let json = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      novelId = requireValue(argv[++i], "--novel")
    } else if (arg === "--aggregate") {
      aggregatePath = requireValue(argv[++i], "--aggregate")
    } else if (arg === "--imported-by-ref") {
      importedByRef = requireValue(argv[++i], "--imported-by-ref")
    } else if (arg === "--no-refresh-staleness") {
      refreshStaleness = false
    } else if (arg === "--json") {
      json = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }

  if (!novelId) throw new Error("--novel is required")
  if (!aggregatePath) throw new Error("--aggregate is required")
  return { novelId, aggregatePath, importedByRef, refreshStaleness, json }
}

export function loadAggregate(path: string): unknown {
  const abs = resolve(path)
  if (!existsSync(abs)) throw new Error(`aggregate file not found: ${abs}`)
  return JSON.parse(readFileSync(abs, "utf8"))
}

function renderImportResult(result: {
  novelId: string
  aggregatePath: string
  importedByRef: string | null
  inserted: number
  updated: number
  skipped: Array<{ reason: string; target?: unknown }>
  itemIds: string[]
}): string {
  const lines: string[] = []
  lines.push("# Plan Readiness Import")
  lines.push("")
  lines.push(`Novel: ${result.novelId}`)
  lines.push(`Aggregate: ${result.aggregatePath}`)
  lines.push(`Imported by ref: ${result.importedByRef ?? "(none)"}`)
  lines.push(`Inserted: ${result.inserted}`)
  lines.push(`Updated: ${result.updated}`)
  lines.push(`Skipped: ${result.skipped.length}`)
  if (result.itemIds.length > 0) {
    lines.push("")
    lines.push("Items:")
    for (const id of result.itemIds) lines.push(`- ${id}`)
  }
  if (result.skipped.length > 0) {
    lines.push("")
    lines.push("Skipped:")
    for (const skipped of result.skipped) lines.push(`- ${skipped.reason}`)
  }
  return lines.join("\n")
}

async function run(args: PlanReadinessImportArgs): Promise<{
  novelId: string
  aggregatePath: string
  importedByRef: string | null
  inserted: number
  updated: number
  skipped: Array<{ reason: string; target?: unknown }>
  itemIds: string[]
}> {
  const aggregate = loadAggregate(args.aggregatePath)
  const { importPlanReadinessAggregateForNovel } = await import("../../src/harness/plan-readiness-import")
  const result = await importPlanReadinessAggregateForNovel({
    novelId: args.novelId,
    aggregate,
    importedByKind: "script",
    importedByRef: args.importedByRef ?? `plan-readiness-import:${resolve(args.aggregatePath)}`,
    refreshStaleness: args.refreshStaleness,
  })
  return {
    novelId: args.novelId,
    aggregatePath: resolve(args.aggregatePath),
    importedByRef: args.importedByRef,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    itemIds: result.items.map(item => item.id),
  }
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

async function closeDb(): Promise<void> {
  const { default: db } = await import("../../src/db/connection")
  await db.end().catch(() => {})
}

async function main(): Promise<number> {
  let args: PlanReadinessImportArgs
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/plan-readiness-import.ts --novel <novelId> --aggregate <aggregate.json> [--imported-by-ref <ref>] [--no-refresh-staleness] [--json]")
    return 2
  }

  try {
    const result = await run(args)
    console.log(args.json ? JSON.stringify(result, null, 2) : renderImportResult(result))
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  process.exit(await main())
}
