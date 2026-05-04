/**
 * Step 2B runner: audit actual generated planner/state mapper IDs from
 * chapter_outlines.outline_json.
 *
 * Usage:
 *   bun scripts/audits/run-live-planner-canon-delta.ts --latest
 *   bun scripts/audits/run-live-planner-canon-delta.ts --novel-id=<id>
 *   bun scripts/audits/run-live-planner-canon-delta.ts --latest --json
 */

import db from "../../src/db/connection"
import { chapterOutlineSchema, type ChapterOutline } from "../../src/agents/planning-plotter/schema"
import {
  runPlannerCanonDeltaAudit,
  type PlannerCanonDeltaReport,
} from "../../src/canon/planner-canon-delta"

interface Args {
  novelId: string | null
  latest: boolean
  json: boolean
}

interface NovelRow {
  id: string
  phase: string
  seed_json: { genre?: string; premise?: string; chapterCount?: number } | null
  current_chapter: number
  total_chapters: number
  created_at: Date
}

interface OutlineRow {
  chapter_number: number
  outline_json: unknown
}

interface PersistenceSnapshot {
  approvedChapters: number[]
  legacyFacts: number
  legacyCharacterStates: number
  legacyKnowledge: number
}

function parseArgs(): Args {
  const novelId = process.argv
    .map((arg) => arg.startsWith("--novel-id=") ? arg.slice("--novel-id=".length) : undefined)
    .find((value): value is string => Boolean(value?.trim())) ?? null
  return {
    novelId,
    latest: process.argv.includes("--latest"),
    json: process.argv.includes("--json"),
  }
}

async function main(): Promise<void> {
  const args = parseArgs()
  if (!args.latest && !args.novelId) {
    console.error("usage: bun scripts/audits/run-live-planner-canon-delta.ts --latest|--novel-id=<id> [--json]")
    process.exit(2)
  }

  const novel = args.latest
    ? await fetchLatestNovelWithOutlines()
    : await fetchNovel(args.novelId!)
  if (!novel) {
    throw new Error(args.latest ? "No novel with chapter_outlines found" : `Novel not found: ${args.novelId}`)
  }

  const outlineRows = await fetchOutlines(novel.id)
  const outlines = parseOutlines(outlineRows)
  const report = runPlannerCanonDeltaAudit(novel.id, outlines)
  const persistence = await fetchPersistenceSnapshot(novel.id)

  if (args.json) {
    console.log(JSON.stringify({ novel, persistence, report }, null, 2))
    return
  }

  printHumanReport(novel, persistence, report)
}

async function fetchNovel(novelId: string): Promise<NovelRow | null> {
  const rows = await db<NovelRow[]>`
    SELECT id, phase, seed_json, current_chapter, total_chapters, created_at
    FROM novels
    WHERE id = ${novelId}
  `
  return rows[0] ?? null
}

async function fetchLatestNovelWithOutlines(): Promise<NovelRow | null> {
  const rows = await db<NovelRow[]>`
    SELECT n.id, n.phase, n.seed_json, n.current_chapter, n.total_chapters, n.created_at
    FROM novels n
    WHERE EXISTS (
      SELECT 1 FROM chapter_outlines o WHERE o.novel_id = n.id
    )
    ORDER BY n.created_at DESC
    LIMIT 1
  `
  return rows[0] ?? null
}

async function fetchOutlines(novelId: string): Promise<OutlineRow[]> {
  return await db<OutlineRow[]>`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  `
}

async function fetchPersistenceSnapshot(novelId: string): Promise<PersistenceSnapshot> {
  const approvedRows = await db<Array<{ chapter_number: number }>>`
    SELECT DISTINCT chapter_number
    FROM chapter_drafts
    WHERE novel_id = ${novelId} AND status = 'approved'
    ORDER BY chapter_number
  `
  const factRows = await db<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM facts WHERE novel_id = ${novelId}
  `
  const stateRows = await db<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM character_states WHERE novel_id = ${novelId}
  `
  const knowledgeRows = await db<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM character_knowledge WHERE novel_id = ${novelId}
  `
  return {
    approvedChapters: approvedRows.map((row) => row.chapter_number),
    legacyFacts: factRows[0]?.n ?? 0,
    legacyCharacterStates: stateRows[0]?.n ?? 0,
    legacyKnowledge: knowledgeRows[0]?.n ?? 0,
  }
}

function parseOutlines(rows: readonly OutlineRow[]): ChapterOutline[] {
  const out: ChapterOutline[] = []
  for (const row of rows) {
    const parsed = chapterOutlineSchema.safeParse(row.outline_json)
    if (!parsed.success) {
      throw new Error(`chapter_outlines ch${row.chapter_number} failed schema parse: ${parsed.error.message}`)
    }
    out.push(parsed.data)
  }
  return out
}

function printHumanReport(
  novel: NovelRow,
  persistence: PersistenceSnapshot,
  report: PlannerCanonDeltaReport,
): void {
  console.log("=".repeat(76))
  console.log(`Step 2B live planner Canon delta - ${novel.id}`)
  console.log("=".repeat(76))
  console.log()
  console.log("NOVEL")
  console.log("-".repeat(76))
  console.log(`  phase:             ${novel.phase}`)
  console.log(`  current/total ch:  ${novel.current_chapter}/${novel.total_chapters}`)
  console.log(`  genre:             ${novel.seed_json?.genre ?? "(unknown)"}`)
  console.log(`  approvedChapters:  ${persistence.approvedChapters.join(",") || "none"}`)
  console.log()

  console.log("MECHANICAL ID GRAPH")
  console.log("-".repeat(76))
  console.log(`  chapters:                 ${report.summary.chapterCount}`)
  console.log(`  beats:                    ${report.summary.beatCount}`)
  console.log(`  sourceItems:              ${report.summary.sourceItemCount}`)
  console.log(`  facts/knowledge/states:   ${report.summary.factCount}/${report.summary.knowledgeCount}/${report.summary.stateCount}`)
  console.log(`  validSourceIds:           ${report.summary.validSourceIdCount}`)
  console.log(`  invalidSourceIds:         ${report.summary.invalidSourceIdCount}`)
  console.log(`  duplicateSourceIds:       ${report.summary.duplicateSourceIdCount}`)
  console.log(`  payoffLinks:              ${report.summary.payoffLinkCount}`)
  console.log(`  invalidPayoffLinks:       ${report.summary.invalidPayoffLinkCount}`)
  console.log(`  obligations:              ${report.summary.obligationCount}`)
  console.log(`  missingSourceCoverage:    ${report.summary.missingSourceIdCoverageCount}`)
  console.log(`  unknownObligationSources: ${report.summary.unknownObligationSourceIdCount}`)
  console.log(`  sourceKindMismatches:     ${report.summary.sourceKindMismatchCount}`)
  console.log(`  characterIdMismatches:    ${report.summary.characterIdMismatchCount}`)
  console.log(`  overloadedBeats:          ${report.summary.overloadedBeatCount}`)
  console.log(`  validationErrors:         ${report.summary.validationErrorCount}`)
  console.log(`  artifactGateClear:        ${gate(report.summary.artifactGateClear)}`)
  console.log(`  idGraphGateClear:         ${gate(report.summary.idGraphGateClear)}`)
  console.log(`  recommendation:           ${report.summary.recommendation}`)
  console.log()

  console.log("LEGACY PLANNED-STATE ROWS")
  console.log("-".repeat(76))
  console.log(`  facts:             ${persistence.legacyFacts}`)
  console.log(`  characterStates:   ${persistence.legacyCharacterStates}`)
  console.log(`  characterKnowledge:${persistence.legacyKnowledge}`)
  console.log("  note: stable source IDs are retained in chapter_outlines; legacy tables store derived rows without planner source IDs.")
  console.log()

  console.log("CHAPTERS")
  console.log("-".repeat(76))
  const header = `  ${"ch".padEnd(3)} ${"beats".padStart(5)} ${"facts".padStart(5)} ${"know".padStart(5)} ${"state".padStart(5)} ${"pay".padStart(4)} ${"obl".padStart(5)} ${"valid".padStart(6)}  title`
  console.log(header)
  for (const chapter of report.chapters) {
    const facts = chapter.sourceItems.filter((item) => item.kind === "fact").length
    const knowledge = chapter.sourceItems.filter((item) => item.kind === "knowledge").length
    const states = chapter.sourceItems.filter((item) => item.kind === "state").length
    console.log(
      `  ${String(chapter.chapterN).padEnd(3)} ${String(chapter.beatCount).padStart(5)} ${String(facts).padStart(5)} ${String(knowledge).padStart(5)} ${String(states).padStart(5)} ${String(chapter.payoffLinks.length).padStart(4)} ${String(chapter.obligations.length).padStart(5)} ${gate(chapter.validation.valid).padStart(6)}  ${chapter.title}`,
    )
  }
  console.log()

  printProblems(report)
  printDelta(report)
}

function printProblems(report: PlannerCanonDeltaReport): void {
  console.log("PROBLEMS")
  console.log("-".repeat(76))
  let printed = false
  for (const item of report.invalidSourceItems) {
    printed = true
    console.log(`  invalid source id: ch${item.chapterN} ${item.kind} id=${item.id || "(missing)"} text=${item.text}`)
  }
  for (const duplicate of report.duplicateSourceIds) {
    printed = true
    console.log(`  duplicate source id: ${duplicate.id}`)
    for (const occurrence of duplicate.occurrences) {
      console.log(`    ch${occurrence.chapterN} ${occurrence.kind}: ${occurrence.text}`)
    }
  }
  for (const chapter of report.chapters) {
    for (const error of chapter.validation.errors) {
      printed = true
      console.log(`  ch${chapter.chapterN}: ${error}`)
    }
    for (const link of chapter.payoffLinks.filter((item) => !item.factExists || !item.targetBeatExists)) {
      printed = true
      console.log(`  ch${chapter.chapterN}: invalid payoff link fact_id=${link.factId} payoff_beat=${link.payoffBeatIndex}`)
    }
  }
  if (!printed) console.log("  (none)")
  console.log()
}

function printDelta(report: PlannerCanonDeltaReport): void {
  console.log("CANON DELTA BY ID")
  console.log("-".repeat(76))
  for (const chapter of report.chapters) {
    console.log(`  ch${chapter.chapterN} ${chapter.title}`)
    for (const item of chapter.sourceItems) {
      const who = item.characterName ? ` ${item.characterName}` : ""
      console.log(`    ${item.kind.padEnd(9)} ${item.id}${who} - ${item.text}`)
    }
    for (const link of chapter.payoffLinks) {
      console.log(`    payoff    ${link.factId} beat${link.setupBeatIndex + 1}->beat${link.payoffBeatIndex + 1}`)
    }
  }
  console.log()
}

function gate(clear: boolean): string {
  return clear ? "YES" : "NO"
}

void main().catch((err) => {
  console.error("[run-live-planner-canon-delta] fatal:", err)
  process.exit(1)
})
