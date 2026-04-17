/**
 * Planner-isolated test — exp #221 verification.
 *
 * Runs concept + planning for a seed, stops BEFORE drafting. Queries
 * llm_calls for per-call token usage and reports truncation risk against
 * each agent's maxTokens ceiling.
 *
 * Usage:
 *   bun scripts/test-planner-isolated.ts fantasy-healer
 *   bun scripts/test-planner-isolated.ts fantasy-healer,fantasy-archive,fantasy-cartographer,fantasy-cultivation-void
 */
import { initDB, createNovel } from "../src/db"
import { setAutoMode, setResolverMode } from "../src/cli"
import { getMode } from "../src/gates"
import { runConceptPhase } from "../src/phases/concept"
import { runPlanningPhase } from "../src/phases/planning"
import { initNovelRun } from "../src/logger"
import type { SeedInput } from "../src/types"
import db from "../src/db/connection"

async function loadSeed(name: string): Promise<SeedInput> {
  const path = new URL(`../src/seeds/${name}.json`, import.meta.url).pathname
  const file = Bun.file(path)
  if (!await file.exists()) throw new Error(`Seed not found: src/seeds/${name}.json`)
  return file.json() as Promise<SeedInput>
}

interface CallStat {
  agent: string
  attempt: number
  chapter: number | null
  prompt_tokens: number
  completion_tokens: number
  max_tokens: number
  finish_reason: string | null
  headroom_pct: number
}

async function testSeed(seedName: string): Promise<{ seedName: string; novelId: string; stats: CallStat[]; chapters: number; totalBeats: number }> {
  console.log(`\n━━━ ${seedName} ━━━`)
  const seed = await loadSeed(seedName)
  const novelId = `test-planner-${seedName}-${Date.now()}`
  await initDB(novelId)
  await createNovel(novelId, seed)
  await initNovelRun(novelId)
  console.log(`  novel: ${novelId}`)

  console.log(`  [1/2] concept phase...`)
  await runConceptPhase(novelId, seed)
  console.log(`  [2/2] planning phase...`)
  await runPlanningPhase(novelId)

  const calls = await db`
    SELECT agent, attempt, chapter, prompt_tokens, completion_tokens,
           max_tokens, failed, error_text
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent IN ('planning-plotter', 'planning-beats')
    ORDER BY timestamp
  ` as any[]

  const stats: CallStat[] = calls.map(c => {
    const comp = c.completion_tokens ?? 0
    const max = c.max_tokens ?? 0
    // Infer truncation: completion at the ceiling + no explicit finish reason in this schema
    const truncated = max > 0 && comp >= max - 2
    return {
      agent: c.agent,
      attempt: c.attempt ?? 1,
      chapter: c.chapter ?? null,
      prompt_tokens: c.prompt_tokens ?? 0,
      completion_tokens: comp,
      max_tokens: max,
      finish_reason: truncated ? "length" : (c.failed ? "error" : "stop"),
      headroom_pct: max ? Math.round(100 * (1 - comp / max)) : 0,
    }
  })

  const chapterRows = await db`SELECT count(*)::int as c FROM chapter_outlines WHERE novel_id = ${novelId}` as any[]
  const chapters = chapterRows[0]?.c ?? 0
  const beatRows = await db`SELECT chapter_number, outline_json FROM chapter_outlines WHERE novel_id = ${novelId} ORDER BY chapter_number` as any[]
  const totalBeats = beatRows.reduce((s, r) => {
    const o = typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json
    return s + (Array.isArray(o?.scenes) ? o.scenes.length : 0)
  }, 0)

  return { seedName, novelId, stats, chapters, totalBeats }
}

async function main() {
  setAutoMode(true)
  setResolverMode(getMode(true))

  const arg = process.argv[2] ?? "fantasy-healer"
  const seedNames = arg.split(",").map(s => s.trim())

  const results = []
  for (const s of seedNames) {
    try {
      results.push(await testSeed(s))
    } catch (err) {
      console.error(`✗ ${s}: ${err instanceof Error ? err.message : err}`)
      results.push({ seedName: s, novelId: "", stats: [], chapters: 0, totalBeats: 0, error: String(err) })
    }
  }

  // Summary
  console.log(`\n\n━━━━━━━━━━ SUMMARY ━━━━━━━━━━`)
  for (const r of results) {
    console.log(`\n${r.seedName} → ${r.chapters} chapters, ${r.totalBeats} total beats`)
    if ("error" in r && r.error) { console.log(`  FAILED: ${r.error}`); continue }
    const byAgent = new Map<string, CallStat[]>()
    for (const s of r.stats) {
      if (!byAgent.has(s.agent)) byAgent.set(s.agent, [])
      byAgent.get(s.agent)!.push(s)
    }
    for (const [agent, calls] of byAgent) {
      const max = calls.reduce((m, c) => Math.max(m, c.completion_tokens), 0)
      const avg = Math.round(calls.reduce((s, c) => s + c.completion_tokens, 0) / calls.length)
      const minHeadroom = calls.reduce((m, c) => Math.min(m, c.headroom_pct), 100)
      const truncated = calls.filter(c => c.finish_reason === "length").length
      console.log(`  ${agent}: ${calls.length} calls, avg ${avg} / max ${max} out of ${calls[0].max_tokens} tokens, min headroom ${minHeadroom}%, truncated ${truncated}`)
    }
  }

  console.log(`\n━━━━━━━━━━ VERDICT ━━━━━━━━━━`)
  const anyTruncated = results.some(r => r.stats.some(s => s.finish_reason === "length"))
  const anyLowHeadroom = results.some(r => r.stats.some(s => s.headroom_pct < 30))
  if (anyTruncated) console.log("✗ FAIL: at least one call hit truncation")
  else if (anyLowHeadroom) console.log("⚠ WARN: at least one call used > 70% of maxTokens")
  else console.log("✓ PASS: all calls finished cleanly with ≥30% headroom")

  process.exit(0)
}

main()
