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
 *   bun scripts/test-planner-isolated.ts fantasy-healer --native-planning-contract
 *   bun scripts/test-planner-isolated.ts fantasy-healer --scene-plan-contract
 *   bun scripts/test-planner-isolated.ts fantasy-healer --scene-turn-planning
 *   bun scripts/test-planner-isolated.ts fantasy-healer --material-pressure-planning
 *   bun scripts/test-planner-isolated.ts --novel <concept-done-novel-id> [--native-planning-contract] [--scene-plan-contract]
 *   bun scripts/test-planner-isolated.ts --from-fixture docs/fixtures/scene-first/concepts/over-target/P1-fantasy-debt-binder.json
 *     [--report-dir output/planner-isolated/<run-id>]
 *
 * L096 Slice 1: --scene-plan-contract sets `scenePlanContractV1=true`,
 * exercising the causal-motivation-v3 planner prompt and the
 * `enforceScenePlanContract` retry path.
 *
 * adjusted-B2: --from-fixture loads a P1/P2/P3 concept fixture from
 * docs/fixtures/scene-first/concepts/<profile>/, creates a novel with
 * the fixture's concept block as seed, runs concept + planning. Resulting
 * novel-id is printed so the operator can chain into
 * scripts/test-drafting-isolated.ts. The fixture path takes a single
 * fixture; comma-separated multi-fixture mode is intentionally NOT
 * supported (one explicit fixture per planner run).
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { initDB, createNovel, getCharacters, getStorySpine, getWorldBible } from "../src/db"
import { setAutoMode, setResolverMode } from "../src/cli"
import { getMode } from "../src/gates"
import { runConceptPhase } from "../src/phases/concept"
import { runPlanningPhase } from "../src/phases/planning"
import { initNovelRun } from "../src/logger"
import type { ChapterOutline, SeedInput } from "../src/types"
import db from "../src/db/connection"
import { parseConceptFixture } from "./fixture/scene-first-fixture-schema"
import {
  summarizePlanningArtifacts,
  type PlanningArtifactSummary,
} from "./analysis/planning-drafting-context-report"

async function loadSeed(name: string): Promise<SeedInput> {
  const path = new URL(`../src/seeds/${name}.json`, import.meta.url).pathname
  const file = Bun.file(path)
  if (!await file.exists()) throw new Error(`Seed not found: src/seeds/${name}.json`)
  return file.json() as Promise<SeedInput>
}

async function loadFixtureConcept(fixturePath: string): Promise<{ seed: SeedInput; profile: string; metadataNotes?: string }> {
  const file = Bun.file(fixturePath)
  if (!await file.exists()) throw new Error(`Fixture not found: ${fixturePath}`)
  const json = await file.json()
  const fixture = parseConceptFixture(json, fixturePath)
  return {
    seed: fixture.concept,
    profile: fixture.fixture_metadata.profile,
    metadataNotes: fixture.fixture_metadata.notes,
  }
}

function fixtureSlugFromPath(fixturePath: string): string {
  const basename = fixturePath.split("/").pop() ?? fixturePath
  return basename.replace(/\.json$/i, "")
}

export interface CallStat {
  agent: string
  attempt: number
  chapter: number | null
  prompt_tokens: number
  completion_tokens: number
  max_tokens: number
  finish_reason: string | null
  headroom_pct: number
}

interface Args {
  seedNames: string[]
  novelId: string | null
  fixturePath: string | null
  nativePlanningContract: boolean
  planningSceneTurnShaping: boolean
  planningMaterialPressure: boolean
  scenePlanContract: boolean
  reportDir: string | null
}

export interface PlannerIsolatedResult {
  seedName: string
  novelId: string
  stats: CallStat[]
  chapters: number
  totalScenes: number
  sceneCounts: Array<{ chapter: number; scenes: number; targetWords: number }>
  planningArtifacts: PlanningArtifactSummary | null
  error?: string
}

export interface PlannerIsolatedRunReport {
  v: "planner-isolated-report-v1"
  generatedAt: string
  options: {
    nativePlanningContract: boolean
    planningSceneTurnShaping: boolean
    planningMaterialPressure: boolean
    scenePlanContract: boolean
    reportDir: string | null
  }
  results: PlannerIsolatedResult[]
}

async function testSeed(
  seedName: string,
  options: { nativePlanningContract: boolean; planningSceneTurnShaping: boolean; planningMaterialPressure: boolean; scenePlanContract: boolean },
): Promise<PlannerIsolatedResult> {
  console.log(`\n━━━ ${seedName} ━━━`)
  const seed = await loadSeed(seedName)
  if (options.nativePlanningContract) {
    seed.pipelineOverrides = {
      ...(seed.pipelineOverrides ?? {}),
      nativePlanningContractV1: true,
    }
  }
  if (options.scenePlanContract) {
    seed.pipelineOverrides = {
      ...(seed.pipelineOverrides ?? {}),
      scenePlanContractV1: true,
    }
  }
  if (options.planningSceneTurnShaping) {
    seed.pipelineOverrides = {
      ...(seed.pipelineOverrides ?? {}),
      planningSceneTurnShapingV1: true,
    }
  }
  if (options.planningMaterialPressure) {
    seed.pipelineOverrides = {
      ...(seed.pipelineOverrides ?? {}),
      planningMaterialPressureV1: true,
    }
  }
  const novelId = `test-planner-${seedName}-${Date.now()}`
  await initDB(novelId)
  await createNovel(novelId, seed)
  await initNovelRun(novelId)
  console.log(`  novel: ${novelId}`)

  console.log(`  [1/2] concept phase...`)
  await runConceptPhase(novelId, seed)
  console.log(`  [2/2] planning phase...`)
  await runPlanningPhase(novelId)

  return collectPlannerResult(seedName, novelId)
}

async function testFromFixture(
  fixturePath: string,
  options: { nativePlanningContract: boolean; planningSceneTurnShaping: boolean; planningMaterialPressure: boolean; scenePlanContract: boolean },
): Promise<PlannerIsolatedResult> {
  const { seed: fixtureSeed, profile, metadataNotes } = await loadFixtureConcept(fixturePath)
  const seed: SeedInput = { ...fixtureSeed }
  if (options.nativePlanningContract) {
    seed.pipelineOverrides = {
      ...(seed.pipelineOverrides ?? {}),
      nativePlanningContractV1: true,
    }
  }
  if (options.scenePlanContract) {
    seed.pipelineOverrides = {
      ...(seed.pipelineOverrides ?? {}),
      scenePlanContractV1: true,
    }
  }
  if (options.planningSceneTurnShaping) {
    seed.pipelineOverrides = {
      ...(seed.pipelineOverrides ?? {}),
      planningSceneTurnShapingV1: true,
    }
  }
  if (options.planningMaterialPressure) {
    seed.pipelineOverrides = {
      ...(seed.pipelineOverrides ?? {}),
      planningMaterialPressureV1: true,
    }
  }
  const slug = fixtureSlugFromPath(fixturePath)
  const novelId = `fixture-${slug}-${Date.now()}`
  console.log(`\n━━━ ${profile} ← ${fixturePath} ━━━`)
  if (metadataNotes) console.log(`  notes: ${metadataNotes}`)
  await initDB(novelId)
  await createNovel(novelId, seed)
  await initNovelRun(novelId)
  console.log(`  novel: ${novelId}`)
  console.log(`  [1/2] concept phase...`)
  await runConceptPhase(novelId, seed)
  console.log(`  [2/2] planning phase...`)
  await runPlanningPhase(novelId)
  return collectPlannerResult(slug, novelId)
}

async function testExistingConceptNovel(
  novelId: string,
  options: { nativePlanningContract: boolean; planningSceneTurnShaping: boolean; planningMaterialPressure: boolean; scenePlanContract: boolean },
): Promise<PlannerIsolatedResult> {
  console.log(`\n━━━ ${novelId} ━━━`)
  console.log(`  novel: ${novelId}`)
  await setNativePlanningContractOverride(novelId, options.nativePlanningContract)
  await setPlanningSceneTurnShapingOverride(novelId, options.planningSceneTurnShaping)
  await setPlanningMaterialPressureOverride(novelId, options.planningMaterialPressure)
  await setScenePlanContractOverride(novelId, options.scenePlanContract)
  await initNovelRun(novelId)
  console.log(`  [1/1] planning phase...`)
  await runPlanningPhase(novelId)
  return collectPlannerResult(novelId, novelId)
}

async function collectPlannerResult(seedName: string, novelId: string): Promise<PlannerIsolatedResult> {
  const calls = await db`
    SELECT agent, attempt, chapter, prompt_tokens, completion_tokens,
           max_tokens, failed, error_text
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent IN ('planning-plotter', 'planning-scenes', 'planning-state-mapper')
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
  const outlineRows = await db`SELECT chapter_number, outline_json FROM chapter_outlines WHERE novel_id = ${novelId} ORDER BY chapter_number` as any[]
  const outlines = outlineRows.map(r => typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json) as ChapterOutline[]
  const sceneCounts = outlineRows.map(r => {
    const o = typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json
    return {
      chapter: Number(r.chapter_number),
      scenes: Array.isArray(o?.scenes) ? o.scenes.length : 0,
      targetWords: Number(o?.targetWords ?? 0),
    }
  })
  const totalScenes = outlineRows.reduce((s, r) => {
    const o = typeof r.outline_json === "string" ? JSON.parse(r.outline_json) : r.outline_json
    return s + (Array.isArray(o?.scenes) ? o.scenes.length : 0)
  }, 0)
  const planningArtifacts = await loadPlanningArtifactSummary(novelId, outlines)

  return { seedName, novelId, stats, chapters, totalScenes, sceneCounts, planningArtifacts }
}

async function loadPlanningArtifactSummary(
  novelId: string,
  outlines: ChapterOutline[],
): Promise<PlanningArtifactSummary | null> {
  try {
    const [worldBible, storySpine, characters] = await Promise.all([
      getWorldBible(novelId).then(() => true).catch(() => false),
      getStorySpine(novelId).then(() => true).catch(() => false),
      getCharacters(novelId).catch(() => []),
    ])
    return summarizePlanningArtifacts({
      worldBibleAvailable: worldBible,
      storySpineAvailable: storySpine,
      characters,
      outlines,
    })
  } catch (err) {
    console.warn(`  planner artifact summary unavailable for ${novelId}: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

async function setNativePlanningContractOverride(novelId: string, enabled: boolean): Promise<void> {
  await db`
    UPDATE novels
    SET seed_json = jsonb_set(
          jsonb_set(
            COALESCE(seed_json, '{}'::jsonb),
            '{pipelineOverrides}',
            COALESCE(seed_json->'pipelineOverrides', '{}'::jsonb),
            true
          ),
          '{pipelineOverrides,nativePlanningContractV1}',
          to_jsonb(${enabled}::boolean),
          true
        ),
        updated_at = now()
    WHERE id = ${novelId}
  `
}

async function setPlanningSceneTurnShapingOverride(novelId: string, enabled: boolean): Promise<void> {
  await db`
    UPDATE novels
    SET seed_json = jsonb_set(
          jsonb_set(
            COALESCE(seed_json, '{}'::jsonb),
            '{pipelineOverrides}',
            COALESCE(seed_json->'pipelineOverrides', '{}'::jsonb),
            true
          ),
          '{pipelineOverrides,planningSceneTurnShapingV1}',
          to_jsonb(${enabled}::boolean),
          true
        ),
        updated_at = now()
    WHERE id = ${novelId}
  `
}

async function setPlanningMaterialPressureOverride(novelId: string, enabled: boolean): Promise<void> {
  await db`
    UPDATE novels
    SET seed_json = jsonb_set(
          jsonb_set(
            COALESCE(seed_json, '{}'::jsonb),
            '{pipelineOverrides}',
            COALESCE(seed_json->'pipelineOverrides', '{}'::jsonb),
            true
          ),
          '{pipelineOverrides,planningMaterialPressureV1}',
          to_jsonb(${enabled}::boolean),
          true
        ),
        updated_at = now()
    WHERE id = ${novelId}
  `
}

async function setScenePlanContractOverride(novelId: string, enabled: boolean): Promise<void> {
  await db`
    UPDATE novels
    SET seed_json = jsonb_set(
          jsonb_set(
            COALESCE(seed_json, '{}'::jsonb),
            '{pipelineOverrides}',
            COALESCE(seed_json->'pipelineOverrides', '{}'::jsonb),
            true
          ),
          '{pipelineOverrides,scenePlanContractV1}',
          to_jsonb(${enabled}::boolean),
          true
        ),
        updated_at = now()
    WHERE id = ${novelId}
  `
}

async function main() {
  setAutoMode(true)
  setResolverMode(getMode(true))

  const args = parseArgs(process.argv.slice(2))
  if (args.nativePlanningContract) {
    console.log("  nativePlanningContractV1=true")
  }
  if (args.scenePlanContract) {
    console.log("  scenePlanContractV1=true")
  }
  if (args.planningSceneTurnShaping) {
    console.log("  planningSceneTurnShapingV1=true")
  }
  if (args.planningMaterialPressure) {
    console.log("  planningMaterialPressureV1=true")
  }

  const results: PlannerIsolatedResult[] = []
  if (args.fixturePath) {
    try {
      results.push(await testFromFixture(args.fixturePath, {
        nativePlanningContract: args.nativePlanningContract,
        planningSceneTurnShaping: args.planningSceneTurnShaping,
        planningMaterialPressure: args.planningMaterialPressure,
        scenePlanContract: args.scenePlanContract,
      }))
    } catch (err) {
      console.error(`✗ ${args.fixturePath}: ${err instanceof Error ? err.message : err}`)
      results.push({ seedName: args.fixturePath, novelId: "", stats: [], chapters: 0, totalScenes: 0, sceneCounts: [], planningArtifacts: null, error: String(err) })
    }
  } else if (args.novelId) {
    try {
      results.push(await testExistingConceptNovel(args.novelId, {
        nativePlanningContract: args.nativePlanningContract,
        planningSceneTurnShaping: args.planningSceneTurnShaping,
        planningMaterialPressure: args.planningMaterialPressure,
        scenePlanContract: args.scenePlanContract,
      }))
    } catch (err) {
      console.error(`✗ ${args.novelId}: ${err instanceof Error ? err.message : err}`)
      results.push({ seedName: args.novelId, novelId: args.novelId, stats: [], chapters: 0, totalScenes: 0, sceneCounts: [], planningArtifacts: null, error: String(err) })
    }
  } else {
    for (const s of args.seedNames) {
      try {
        results.push(await testSeed(s, {
          nativePlanningContract: args.nativePlanningContract,
          planningSceneTurnShaping: args.planningSceneTurnShaping,
          planningMaterialPressure: args.planningMaterialPressure,
          scenePlanContract: args.scenePlanContract,
        }))
      } catch (err) {
        console.error(`✗ ${s}: ${err instanceof Error ? err.message : err}`)
        results.push({ seedName: s, novelId: "", stats: [], chapters: 0, totalScenes: 0, sceneCounts: [], planningArtifacts: null, error: String(err) })
      }
    }
  }

  // Summary
  console.log(`\n\n━━━━━━━━━━ SUMMARY ━━━━━━━━━━`)
  for (const r of results) {
    console.log(`\n${r.seedName} → ${r.chapters} chapters, ${r.totalScenes} total scenes`)
    if (r.sceneCounts.length) {
      console.log(`  scene counts: ${r.sceneCounts.map(b => `ch${b.chapter}=${b.scenes}/${b.targetWords}w`).join(", ")}`)
    }
    if (r.planningArtifacts) {
      const p = r.planningArtifacts
      console.log(
        `  plan shape: scenes=${p.plannedSceneCount}, sceneContracts=${p.scenesWithSceneContract}, ` +
          `dramatic=${p.sceneContractsWithDramaticShape}, choice=${p.sceneContractsWithChoiceShape}, ` +
          `endpoint=${p.sceneContractsWithEndpointShape}, full=${p.sceneContractsWithFullDramaticShape}, ` +
          `anchorOnly=${p.anchorOnlySceneContracts}, ` +
          `obligations=${p.scenesWithObligations}, sceneLoad=${p.sceneLoad.chapters.map(ch => `ch${ch.chapterNumber}:${ch.signal}`).join(",")}`,
      )
      console.log(
        `  scene-contract gaps: missingDramatic=${p.sceneContractShape.missingDramaticShape.length}, ` +
          `missingChoice=${p.sceneContractShape.missingChoiceShape.length}, ` +
          `missingFull=${p.sceneContractShape.missingFullDramaticShape.length}, ` +
          `anchorOnly=${p.sceneContractShape.anchorOnly.length}`,
      )
    }
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

  const report: PlannerIsolatedRunReport = {
    v: "planner-isolated-report-v1",
    generatedAt: new Date().toISOString(),
    options: {
      nativePlanningContract: args.nativePlanningContract,
      planningSceneTurnShaping: args.planningSceneTurnShaping,
      planningMaterialPressure: args.planningMaterialPressure,
      scenePlanContract: args.scenePlanContract,
      reportDir: args.reportDir,
    },
    results,
  }
  const outputDir = args.reportDir ?? defaultReportDir(results)
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "planner-isolated-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outputDir, "planner-isolated-report.md"), renderPlannerIsolatedReport(report))
  console.log(`report: ${join(outputDir, "planner-isolated-report.json")}`)

  process.exit(0)
}

if (import.meta.main) main()

export function parseArgs(argv: string[]): Args {
  let seedArg: string | null = null
  let novelId: string | null = null
  let fixturePath: string | null = null
  let nativePlanningContract = false
  let planningSceneTurnShaping = false
  let planningMaterialPressure = false
  let scenePlanContract = false
  let reportDir: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--native-planning-contract" || arg === "--native-planning-contract-v1") {
      nativePlanningContract = true
      continue
    }
    if (arg === "--scene-plan-contract" || arg === "--scene-plan-contract-v1") {
      scenePlanContract = true
      continue
    }
    if (arg === "--scene-turn-planning" || arg === "--planning-scene-turn-shaping-v1") {
      planningSceneTurnShaping = true
      continue
    }
    if (arg === "--material-pressure-planning" || arg === "--planning-material-pressure-v1") {
      planningMaterialPressure = true
      continue
    }
    if (arg === "--novel" || arg === "--novel-id") {
      novelId = argv[++i] ?? null
      if (!novelId) throw new Error(`${arg} requires a value`)
      continue
    }
    if (arg === "--from-fixture") {
      fixturePath = argv[++i] ?? null
      if (!fixturePath) throw new Error(`${arg} requires a path`)
      continue
    }
    if (arg === "--report-dir") {
      reportDir = argv[++i] ?? null
      if (!reportDir) throw new Error(`${arg} requires a value`)
      continue
    }
    if (arg.startsWith("--")) throw new Error(`unknown arg: ${arg}`)
    if (seedArg !== null) throw new Error(`unexpected extra seed arg: ${arg}`)
    seedArg = arg
  }
  const sources = [Boolean(novelId), Boolean(seedArg), Boolean(fixturePath)].filter(Boolean).length
  if (sources > 1) {
    throw new Error("pass exactly one of: a seed name (positional), --novel <id>, or --from-fixture <path>")
  }
  return {
    seedNames: (novelId || fixturePath) ? [] : (seedArg ?? "fantasy-healer").split(",").map(s => s.trim()).filter(Boolean),
    novelId,
    fixturePath,
    nativePlanningContract,
    planningSceneTurnShaping,
    planningMaterialPressure,
    scenePlanContract,
    reportDir,
  }
}

export function renderPlannerIsolatedReport(report: PlannerIsolatedRunReport): string {
  const lines: string[] = []
  lines.push(`# Planner Isolated Report`)
  lines.push("")
  lines.push(`generatedAt: ${report.generatedAt}`)
  lines.push(`nativePlanningContract: ${report.options.nativePlanningContract ? "on" : "off"}`)
  lines.push(`planningSceneTurnShaping: ${report.options.planningSceneTurnShaping ? "on" : "off"}`)
  lines.push(`planningMaterialPressure: ${report.options.planningMaterialPressure ? "on" : "off"}`)
  lines.push(`scenePlanContract: ${report.options.scenePlanContract ? "on" : "off"}`)
  for (const result of report.results) {
    lines.push("")
    lines.push(`## ${result.seedName}`)
    if (result.error) {
      lines.push(`FAILED: ${result.error}`)
      continue
    }
    lines.push(`novelId: ${result.novelId}`)
    lines.push(`chapters: ${result.chapters}; scenes: ${result.totalScenes}`)
    if (result.sceneCounts.length > 0) {
      lines.push(`sceneCounts: ${result.sceneCounts.map(b => `ch${b.chapter}=${b.scenes}/${b.targetWords}w`).join(", ")}`)
    }
    if (result.planningArtifacts) {
      const p = result.planningArtifacts
      lines.push(
        `planShape: sceneIds=${p.scenesWithSceneIds}/${p.plannedSceneCount}; ` +
          `sceneContracts=${p.scenesWithSceneContract}; dramatic=${p.sceneContractsWithDramaticShape}; ` +
          `choice=${p.sceneContractsWithChoiceShape}; endpoint=${p.sceneContractsWithEndpointShape}; ` +
          `full=${p.sceneContractsWithFullDramaticShape}; ` +
          `anchorOnly=${p.anchorOnlySceneContracts}; temporal=${p.scenesWithTemporalAnchor}; place=${p.scenesWithPlaceAnchor}; ` +
          `obligations=${p.scenesWithObligations}`,
      )
      lines.push(
        `sceneContractGaps: missingDramatic=${p.sceneContractShape.missingDramaticShape.length}; ` +
          `missingChoice=${p.sceneContractShape.missingChoiceShape.length}; ` +
          `missingFull=${p.sceneContractShape.missingFullDramaticShape.length}; ` +
          `anchorOnly=${p.sceneContractShape.anchorOnly.length}`,
      )
      lines.push(
        `sceneLoad: ${p.sceneLoad.chapters.map(ch =>
          `ch${ch.chapterNumber}=${ch.sceneCount}sc/${formatNullableNumber(ch.targetWordsPerScene)}wps/${ch.signal}`
        ).join(", ")}`,
      )
      lines.push(`futureEventAnchors: ${p.planContinuity.futureEventAnchors.length}`)
    }
    const byAgent = new Map<string, CallStat[]>()
    for (const stat of result.stats) {
      if (!byAgent.has(stat.agent)) byAgent.set(stat.agent, [])
      byAgent.get(stat.agent)!.push(stat)
    }
    for (const [agent, calls] of byAgent) {
      const max = calls.reduce((m, c) => Math.max(m, c.completion_tokens), 0)
      const avg = Math.round(calls.reduce((s, c) => s + c.completion_tokens, 0) / calls.length)
      const minHeadroom = calls.reduce((m, c) => Math.min(m, c.headroom_pct), 100)
      const truncated = calls.filter(c => c.finish_reason === "length").length
      lines.push(`${agent}: ${calls.length} calls; avg=${avg}; max=${max}/${calls[0]?.max_tokens ?? 0}; minHeadroom=${minHeadroom}%; truncated=${truncated}`)
    }
  }
  return `${lines.join("\n")}\n`
}

function defaultReportDir(results: PlannerIsolatedResult[]): string {
  const firstNovelId = results.find(result => result.novelId)?.novelId
  return `output/planner-isolated/${firstNovelId ?? Date.now()}`
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : Number.isInteger(value) ? String(value) : value.toFixed(1)
}
