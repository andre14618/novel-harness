/**
 * Planning-state-mapper telemetry summary.
 *
 * Usage:
 *   bun scripts/planning-state-mapper-summary.ts --novel-id=<novel-id> [--json]
 *
 * Combines three durable/local surfaces:
 * - llm_calls: token/cost/json-retry telemetry
 * - chapter_outlines: final writer-visible coverage state
 * - output/<novel-id>/harness.log: per-attempt mapper orphan telemetry, if present
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import db from "../src/db/connection"
import { chapterBeatsSchema } from "../src/agents/planning-beats/schema"
import { validateBeatObligationCoverage } from "../src/harness/beat-obligations"

interface Args {
  novelId: string
  json: boolean
}

interface LlmCallRow {
  id: number
  run_id: number
  timestamp: string
  chapter: number | null
  attempt: number | null
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number | null
  max_tokens: number | null
  cost: string | number
  json_extraction_success: boolean | null
  json_extraction_retried: boolean | null
  zod_validation_success: boolean | null
  failed: boolean | null
}

interface OutlineRow {
  chapter_number: number
  outline_json: unknown
}

interface MapperAttemptLog {
  chapter: number
  attempt: number
  mappedBeats: number
  totalBeats: number
  ignoredMappings: number
  facts: number
  orphanFacts: number
  knowledge: number
  orphanKnowledge: number
  state: number
  orphanState: number
  overloadedBeats: number
}

function parseArgs(): Args {
  const novelId = process.argv
    .map(arg => arg.startsWith("--novel-id=") ? arg.slice("--novel-id=".length) : undefined)
    .find((value): value is string => Boolean(value?.trim()))
  if (!novelId) {
    console.error("usage: bun scripts/planning-state-mapper-summary.ts --novel-id=<novel-id> [--json]")
    process.exit(2)
  }
  return { novelId, json: process.argv.includes("--json") }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function parseAttemptLogs(novelId: string): { path: string; attempts: MapperAttemptLog[] } {
  const path = join(process.cwd(), "output", novelId, "harness.log")
  if (!existsSync(path)) return { path, attempts: [] }

  const attempts: MapperAttemptLog[] = []
  const attemptRe = /Planning state mapper ch(\d+) attempt=(\d+): mappedBeats=(\d+)\/(\d+) ignoredMappings=(\d+) facts=(\d+) orphanFacts=(\d+) knowledge=(\d+) orphanKnowledge=(\d+) state=(\d+) orphanState=(\d+) overloadedBeats=(\d+)/

  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const attemptMatch = line.match(attemptRe)
    if (attemptMatch) {
      attempts.push({
        chapter: Number(attemptMatch[1]),
        attempt: Number(attemptMatch[2]),
        mappedBeats: Number(attemptMatch[3]),
        totalBeats: Number(attemptMatch[4]),
        ignoredMappings: Number(attemptMatch[5]),
        facts: Number(attemptMatch[6]),
        orphanFacts: Number(attemptMatch[7]),
        knowledge: Number(attemptMatch[8]),
        orphanKnowledge: Number(attemptMatch[9]),
        state: Number(attemptMatch[10]),
        orphanState: Number(attemptMatch[11]),
        overloadedBeats: Number(attemptMatch[12]),
      })
    }
  }

  return { path, attempts }
}

function aggregateAttempts(attempts: MapperAttemptLog[]) {
  const initial = attempts.filter(item => item.attempt === 1)
  const latestByChapter = new Map<number, MapperAttemptLog>()
  for (const item of attempts) {
    const previous = latestByChapter.get(item.chapter)
    if (!previous || item.attempt > previous.attempt) latestByChapter.set(item.chapter, item)
  }
  const latest = Array.from(latestByChapter.values())

  return {
    log_available: attempts.length > 0,
    attempts_logged: attempts.length,
    chapters_logged: unique(attempts.map(item => item.chapter)).length,
    retry_chapters: latest.filter(item => item.attempt > 1).length,
    retry_calls: attempts.filter(item => item.attempt > 1).length,
    max_attempt: Math.max(0, ...attempts.map(item => item.attempt)),
    ignored_mappings: sum(attempts.map(item => item.ignoredMappings)),
    initial_orphans: {
      facts: sum(initial.map(item => item.orphanFacts)),
      knowledge: sum(initial.map(item => item.orphanKnowledge)),
      state: sum(initial.map(item => item.orphanState)),
      total: sum(initial.map(item => item.orphanFacts + item.orphanKnowledge + item.orphanState)),
    },
    latest_logged_orphans: {
      facts: sum(latest.map(item => item.orphanFacts)),
      knowledge: sum(latest.map(item => item.orphanKnowledge)),
      state: sum(latest.map(item => item.orphanState)),
      total: sum(latest.map(item => item.orphanFacts + item.orphanKnowledge + item.orphanState)),
    },
    latest_logged_overloaded_beats: sum(latest.map(item => item.overloadedBeats)),
  }
}

function aggregateCalls(rows: LlmCallRow[]) {
  return {
    calls: rows.length,
    run_ids: unique(rows.map(row => row.run_id)),
    chapters: unique(rows.map(row => row.chapter).filter((value): value is number => value !== null)).sort((a, b) => a - b),
    prompt_tokens: sum(rows.map(row => Number(row.prompt_tokens ?? 0))),
    completion_tokens: sum(rows.map(row => Number(row.completion_tokens ?? 0))),
    cached_tokens: sum(rows.map(row => Number(row.cached_tokens ?? 0))),
    max_completion_tokens: Math.max(0, ...rows.map(row => Number(row.completion_tokens ?? 0))),
    max_tokens_cap: Math.max(0, ...rows.map(row => Number(row.max_tokens ?? 0))),
    cost: sum(rows.map(row => Number(row.cost ?? 0))),
    json_retried_calls: rows.filter(row => row.json_extraction_retried === true).length,
    json_failed_calls: rows.filter(row => row.json_extraction_success === false).length,
    zod_failed_calls: rows.filter(row => row.zod_validation_success === false).length,
    failed_calls: rows.filter(row => row.failed === true).length,
  }
}

function aggregateFinalOutlines(rows: OutlineRow[]) {
  let parseFailures = 0
  const validations = []
  for (const row of rows) {
    const parsed = chapterBeatsSchema.safeParse(row.outline_json)
    if (!parsed.success) {
      parseFailures++
      continue
    }
    validations.push(validateBeatObligationCoverage(parsed.data))
  }

  return {
    chapters: rows.length,
    parse_failures: parseFailures,
    final_orphans: {
      facts: sum(validations.map(item => item.summary.orphanFacts)),
      knowledge: sum(validations.map(item => item.summary.orphanKnowledgeChanges)),
      state: sum(validations.map(item => item.summary.orphanStateChanges)),
      total: sum(validations.map(item => item.summary.orphanFacts + item.summary.orphanKnowledgeChanges + item.summary.orphanStateChanges)),
    },
    final_counts: {
      facts: sum(validations.map(item => item.summary.factCount)),
      knowledge: sum(validations.map(item => item.summary.knowledgeCount)),
      state: sum(validations.map(item => item.summary.stateChangeCount)),
      overloaded_beats: sum(validations.map(item => item.summary.overloadedBeats)),
    },
  }
}

function printHuman(summary: any): void {
  console.log(`Planning-state-mapper telemetry — novel=${summary.novel_id}`)
  console.log(`LLM calls: ${summary.llm.calls}  runs=${summary.llm.run_ids.join(",") || "none"}  chapters=${summary.llm.chapters.join(",") || "none"}`)
  console.log(`Tokens: prompt=${summary.llm.prompt_tokens} cached=${summary.llm.cached_tokens} completion=${summary.llm.completion_tokens} max_completion=${summary.llm.max_completion_tokens}/${summary.llm.max_tokens_cap}`)
  console.log(`Cost: $${summary.llm.cost.toFixed(6)}  json_retried=${summary.llm.json_retried_calls} json_failed=${summary.llm.json_failed_calls} zod_failed=${summary.llm.zod_failed_calls} failed=${summary.llm.failed_calls}`)
  console.log(`Attempt log: ${summary.attempt_log.log_available ? summary.attempt_log.path : `missing (${summary.attempt_log.path})`}`)
  console.log(`Mapper attempts: logged=${summary.attempts.attempts_logged} retry_chapters=${summary.attempts.retry_chapters} retry_calls=${summary.attempts.retry_calls} max_attempt=${summary.attempts.max_attempt} ignored_mappings=${summary.attempts.ignored_mappings}`)
  console.log(`Initial logged orphans: facts=${summary.attempts.initial_orphans.facts} knowledge=${summary.attempts.initial_orphans.knowledge} state=${summary.attempts.initial_orphans.state} total=${summary.attempts.initial_orphans.total}`)
  console.log(`Latest logged orphans: facts=${summary.attempts.latest_logged_orphans.facts} knowledge=${summary.attempts.latest_logged_orphans.knowledge} state=${summary.attempts.latest_logged_orphans.state} total=${summary.attempts.latest_logged_orphans.total} overloaded=${summary.attempts.latest_logged_overloaded_beats}`)
  console.log(`Final outline orphans: facts=${summary.final.final_orphans.facts} knowledge=${summary.final.final_orphans.knowledge} state=${summary.final.final_orphans.state} total=${summary.final.final_orphans.total}`)
  console.log(`Final outline counts: facts=${summary.final.final_counts.facts} knowledge=${summary.final.final_counts.knowledge} state=${summary.final.final_counts.state} overloaded=${summary.final.final_counts.overloaded_beats} parse_failures=${summary.final.parse_failures}`)
}

async function main(): Promise<void> {
  const args = parseArgs()
  const llmRows = await db<LlmCallRow[]>`
    SELECT id, run_id, timestamp, chapter, attempt, prompt_tokens, completion_tokens,
           cached_tokens, max_tokens, cost, json_extraction_success,
           json_extraction_retried, zod_validation_success, failed
    FROM llm_calls
    WHERE novel_id = ${args.novelId}
      AND agent = 'planning-state-mapper'
    ORDER BY timestamp, id
  `
  const outlineRows = await db<OutlineRow[]>`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${args.novelId}
    ORDER BY chapter_number
  `

  const attemptLog = parseAttemptLogs(args.novelId)
  const summary = {
    novel_id: args.novelId,
    llm: aggregateCalls(llmRows),
    attempt_log: { path: attemptLog.path, log_available: attemptLog.attempts.length > 0 },
    attempts: aggregateAttempts(attemptLog.attempts),
    final: aggregateFinalOutlines(outlineRows),
  }

  if (args.json) console.log(JSON.stringify(summary, null, 2))
  else printHuman(summary)
}

main().catch(err => {
  console.error("[planning-state-mapper-summary] fatal:", err)
  process.exit(1)
})
