#!/usr/bin/env bun
import { chapterPlanCheckSchema } from "../../src/agents/chapter-plan-checker/schema"

export interface PlanCheckCallRow {
  id: number
  novel_id?: string | null
  chapter: number | null
  attempt: number | null
  response_content: string | null
  timestamp?: string | Date | null
}

export interface PlanDriftDeviation {
  description: string
  beatIndex: number | null
  beatId?: string
}

export interface PlanDriftCall {
  id: number
  chapter: number | null
  attempt: number | null
  timestamp: string | null
  pass: boolean | null
  parseError?: string
  deviations: PlanDriftDeviation[]
}

export interface PlanDriftChapter {
  chapter: number | null
  totalCalls: number
  passingCalls: number
  failingCalls: number
  parseErrors: number
  finalPass: boolean | null
  finalDeviationCount: number
  hadDrift: boolean
  recovered: boolean
  unresolved: boolean
  deviationCount: number
  beatDeviationCount: number
  chapterLevelDeviationCount: number
  driftedBeatRefs: string[]
  driftCalls: PlanDriftCall[]
}

export interface PlanDriftReport {
  novelId: string | null
  totalCalls: number
  passingCalls: number
  failingCalls: number
  parseErrors: number
  chaptersWithDrift: number
  recoveredChapters: number
  unresolvedChapters: number
  driftedBeatRefs: string[]
  chapters: PlanDriftChapter[]
}

interface Args {
  novelId: string | null
  json: boolean
}

export function buildPlanDriftReport(rows: PlanCheckCallRow[], novelId: string | null = null): PlanDriftReport {
  const calls = rows
    .map(rowToCall)
    .sort((a, b) =>
      compareNullableNumber(a.chapter, b.chapter) ||
      compareNullableNumber(a.attempt, b.attempt) ||
      a.id - b.id
    )

  const byChapter = new Map<string, PlanDriftCall[]>()
  for (const call of calls) {
    const key = call.chapter === null ? "null" : String(call.chapter)
    const list = byChapter.get(key) ?? []
    list.push(call)
    byChapter.set(key, list)
  }

  const chapters = [...byChapter.values()].map((chapterCalls): PlanDriftChapter => {
    const final = chapterCalls[chapterCalls.length - 1]
    const stats = collectDeviationStats(chapterCalls)
    const hadDrift = chapterCalls.some(call => call.pass === false)
    const finalPass = final?.pass ?? null
    return {
      chapter: final?.chapter ?? null,
      totalCalls: chapterCalls.length,
      passingCalls: chapterCalls.filter(call => call.pass === true).length,
      failingCalls: chapterCalls.filter(call => call.pass === false).length,
      parseErrors: chapterCalls.filter(call => call.pass === null).length,
      finalPass,
      finalDeviationCount: final?.deviations.length ?? 0,
      hadDrift,
      recovered: hadDrift && finalPass === true,
      unresolved: finalPass === false,
      deviationCount: stats.deviationCount,
      beatDeviationCount: stats.beatDeviationCount,
      chapterLevelDeviationCount: stats.chapterLevelDeviationCount,
      driftedBeatRefs: stats.driftedBeatRefs,
      driftCalls: chapterCalls.filter(call => call.pass === false || call.parseError),
    }
  })
  const driftedBeatRefs = uniqueSorted(chapters.flatMap(chapter => chapter.driftedBeatRefs))

  return {
    novelId,
    totalCalls: calls.length,
    passingCalls: calls.filter(call => call.pass === true).length,
    failingCalls: calls.filter(call => call.pass === false).length,
    parseErrors: calls.filter(call => call.pass === null).length,
    chaptersWithDrift: chapters.filter(chapter => chapter.hadDrift).length,
    recoveredChapters: chapters.filter(chapter => chapter.recovered).length,
    unresolvedChapters: chapters.filter(chapter => chapter.unresolved).length,
    driftedBeatRefs,
    chapters,
  }
}

export function renderPlanDriftReport(report: PlanDriftReport): string {
  const lines: string[] = []
  lines.push(`Plan drift report${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(`Calls: ${report.totalCalls} total, ${report.failingCalls} failing, ${report.passingCalls} passing, ${report.parseErrors} parse errors`)
  lines.push(`Chapters: ${report.chaptersWithDrift} with drift, ${report.recoveredChapters} recovered, ${report.unresolvedChapters} unresolved`)
  if (report.driftedBeatRefs.length > 0) {
    lines.push(`Stable beat refs: ${report.driftedBeatRefs.join(", ")}`)
  }
  if (report.chapters.length === 0) {
    lines.push("No chapter-plan-checker calls found.")
    return lines.join("\n")
  }

  for (const chapter of report.chapters) {
    const label = chapter.chapter === null ? "chapter ?" : `chapter ${chapter.chapter}`
    const final = chapter.finalPass === null ? "unknown" : chapter.finalPass ? "pass" : "fail"
    const status = chapter.recovered ? ", recovered" : chapter.unresolved ? ", unresolved" : ""
    const refs = chapter.driftedBeatRefs.length > 0 ? `, refs=${chapter.driftedBeatRefs.join(",")}` : ""
    lines.push("")
    lines.push(
      `${label}: final=${final}${status}, calls=${chapter.totalCalls}, ` +
        `failing=${chapter.failingCalls}, deviations=${chapter.deviationCount}, ` +
        `chapterLevel=${chapter.chapterLevelDeviationCount}, parseErrors=${chapter.parseErrors}${refs}`,
    )
    for (const call of chapter.driftCalls) {
      const callLabel = `call ${call.id}${call.attempt === null ? "" : ` attempt ${call.attempt}`}`
      if (call.parseError) {
        lines.push(`  - ${callLabel}: parse error: ${call.parseError}`)
        continue
      }
      if (call.deviations.length === 0) {
        lines.push(`  - ${callLabel}: fail with no deviations`)
        continue
      }
      for (const deviation of call.deviations) {
        const beat = deviation.beatIndex === null ? "chapter-level" : `beat ${deviation.beatIndex + 1}`
        const ref = deviation.beatId ? ` [${deviation.beatId}]` : ""
        lines.push(`  - ${callLabel}: ${beat}${ref}: ${deviation.description}`)
      }
    }
  }
  return lines.join("\n")
}

function collectDeviationStats(calls: PlanDriftCall[]): {
  deviationCount: number
  beatDeviationCount: number
  chapterLevelDeviationCount: number
  driftedBeatRefs: string[]
} {
  const deviations = calls.flatMap(call => call.pass === false ? call.deviations : [])
  return {
    deviationCount: deviations.length,
    beatDeviationCount: deviations.filter(deviation => deviation.beatIndex !== null).length,
    chapterLevelDeviationCount: deviations.filter(deviation => deviation.beatIndex === null).length,
    driftedBeatRefs: uniqueSorted(deviations.flatMap(deviation => deviation.beatId ? [deviation.beatId] : [])),
  }
}

function rowToCall(row: PlanCheckCallRow): PlanDriftCall {
  const timestamp = row.timestamp instanceof Date
    ? row.timestamp.toISOString()
    : typeof row.timestamp === "string"
      ? row.timestamp
      : null

  if (!row.response_content) {
    return {
      id: row.id,
      chapter: row.chapter,
      attempt: row.attempt,
      timestamp,
      pass: null,
      parseError: "missing response_content",
      deviations: [],
    }
  }

  try {
    const raw = JSON.parse(row.response_content)
    const parsed = chapterPlanCheckSchema.parse(raw)
    return {
      id: row.id,
      chapter: row.chapter,
      attempt: row.attempt,
      timestamp,
      pass: parsed.pass,
      deviations: parsed.deviations.map(deviation => ({
        description: deviation.description,
        beatIndex: deviation.beat_index,
        ...(deviation.beatId ? { beatId: deviation.beatId } : {}),
      })),
    }
  } catch (err) {
    return {
      id: row.id,
      chapter: row.chapter,
      attempt: row.attempt,
      timestamp,
      pass: null,
      parseError: err instanceof Error ? err.message : String(err),
      deviations: [],
    }
  }
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
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

async function loadRows(novelId: string): Promise<PlanCheckCallRow[]> {
  const { default: db } = await import("../../src/db/connection")
  return await db`
    SELECT id, novel_id, chapter, attempt, response_content, timestamp
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'chapter-plan-checker'
    ORDER BY chapter, attempt NULLS LAST, id
  ` as PlanCheckCallRow[]
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/plan-drift-report.ts --novel <novelId> [--json]")
    return 2
  }

  if (!args.novelId) {
    console.error("usage: bun scripts/analysis/plan-drift-report.ts --novel <novelId> [--json]")
    return 2
  }

  const report = buildPlanDriftReport(await loadRows(args.novelId), args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderPlanDriftReport(report))
  return report.parseErrors > 0 ? 1 : 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
