/**
 * Scene-First Novella POC runner.
 *
 * Pragmatic, NOT production-grade. Lives outside `src/` because POC
 * lane discipline is "produce a readable artifact fast" — see
 * docs/sessions/2026-05-10-scene-migration-plan.md and the operator
 * call to split POC vs. Production lanes.
 *
 * One command: load a concept fixture, run concept + planning +
 * drafting end-to-end with scene-first flags set in
 * pipelineOverrides, capture per-chapter prose + scene contracts +
 * trace events to a timestamped output dir. Diagnostics + HTML are
 * separate scripts in this dir.
 *
 * No production default flips. The flags are all per-novel
 * pipelineOverrides. The chapter-level checker settle loops are
 * skipped via `draftCaptureModeV1=true` so checker hangs cannot
 * block prose collection.
 *
 * Usage:
 *   bun poc/scene-first-novella/run.ts \
 *     [--fixture docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-resolved.json] \
 *     [--chapters 3] \
 *     [--run-id poc-scene-first-<ts>]    # default auto-derived from timestamp
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { initDB, createNovel, getChapterOutline, getApprovedDraft, getLatestChapterDraft } from "../../src/db"
import { runConceptPhase } from "../../src/phases/concept"
import { runPlanningPhase } from "../../src/phases/planning"
import { runDraftingPhase } from "../../src/phases/drafting"
import { initNovelRun } from "../../src/logger"
import { setAutoMode, setResolverMode } from "../../src/cli"
import { getMode } from "../../src/gates"
import db from "../../src/db/connection"
import { parseConceptFixture } from "../../scripts/fixture/scene-first-fixture-schema"
import type { SeedInput } from "../../src/types"

const DEFAULT_FIXTURE = "docs/fixtures/scene-first/concepts/pre-resolved/P3-debt-binder-resolved.json"
const POC_OUTPUT_ROOT = "poc/scene-first-novella/output"

interface Args {
  fixturePath: string
  chapters: number
  runId: string
}

function parseArgs(argv: string[]): Args {
  let fixturePath = DEFAULT_FIXTURE
  let chapters = 3
  let runId: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--fixture") { fixturePath = argv[++i] ?? fixturePath; continue }
    if (a === "--chapters") { chapters = Number.parseInt(argv[++i] ?? "3", 10); continue }
    if (a === "--run-id") { runId = argv[++i] ?? null; continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!Number.isFinite(chapters) || chapters < 1) {
    throw new Error(`--chapters must be a positive integer; got ${chapters}`)
  }
  return {
    fixturePath,
    chapters,
    runId: runId ?? `poc-scene-first-${Date.now()}`,
  }
}

async function captureChapterArtifacts(
  novelId: string,
  outputDir: string,
  chapterCount: number,
): Promise<{ savedChapters: number[]; missingChapters: number[] }> {
  const saved: number[] = []
  const missing: number[] = []
  for (let ch = 1; ch <= chapterCount; ch++) {
    const outline = await getChapterOutline(novelId, ch).catch(() => null)
    if (!outline) {
      missing.push(ch)
      continue
    }
    // Approved draft is the post-checker artifact. In draftCaptureModeV1
    // the chapter is approved immediately after writer drafts prose, so
    // getApprovedDraft returns the writer output directly.
    const approved = await getApprovedDraft(novelId, ch).catch(() => null)
    const latest = approved ?? await getLatestChapterDraft(novelId, ch).catch(() => null)

    const traceEvents = await db`
      SELECT event_type, chapter, beat_index, payload, ts
      FROM pipeline_events
      WHERE novel_id = ${novelId} AND chapter = ${ch}
      ORDER BY ts ASC
    ` as Array<{ event_type: string; chapter: number; beat_index: number | null; payload: unknown; ts: string }>

    const llmCalls = await db`
      SELECT id, agent, attempt, scene_id, beat_id, beat_index,
             prompt_tokens, completion_tokens, cost,
             length(user_prompt) AS user_prompt_chars
      FROM llm_calls
      WHERE novel_id = ${novelId} AND chapter = ${ch}
      ORDER BY timestamp ASC
    ` as Array<{ id: number; agent: string; attempt: number; scene_id: string | null; beat_id: string | null; beat_index: number | null; prompt_tokens: number; completion_tokens: number; cost: number; user_prompt_chars: number }>

    const prose = latest?.prose ?? ""
    const wordCount = latest?.wordCount ?? 0
    const proseHeader = `# Chapter ${ch}: ${outline.title}\n\n*POV: ${outline.povCharacter}*\n*Setting: ${outline.setting}*\n*Word count: ${wordCount} (target ${outline.targetWords})*\n\n`
    await writeFile(join(outputDir, `chapter-${ch}.md`), proseHeader + prose, "utf8")

    const sceneContracts = {
      runId: novelId,
      chapterNumber: ch,
      chapterId: outline.chapterId ?? null,
      title: outline.title,
      povCharacter: outline.povCharacter,
      povCharacterId: outline.povCharacterId ?? null,
      setting: outline.setting,
      purpose: outline.purpose,
      targetWords: outline.targetWords,
      scenes: (outline.scenes ?? []).map((s: any, idx: number) => ({
        sceneIndex: idx,
        sceneId: s.sceneId ?? null,
        beatId: s.beatId ?? null,
        kind: s.kind ?? null,
        description: s.description ?? "",
        characters: s.characters ?? [],
        povPersonalStake: s.povPersonalStake ?? null,
        // Scene-contract fields (populated when scenePlanContractV1=true and the
        // planner authored them).
        contract: {
          goal: s.goal ?? null,
          opposition: s.opposition ?? null,
          turningPoint: s.turningPoint ?? null,
          crisisChoice: s.crisisChoice ?? null,
          choiceAlternatives: s.choiceAlternatives ?? [],
          outcome: s.outcome ?? null,
          consequence: s.consequence ?? null,
          valueIn: s.valueIn ?? null,
          valueOut: s.valueOut ?? null,
          targetWords: s.targetWords ?? null,
        },
        valueShifted: s.valueShifted ?? null,
        gapPresent: s.gapPresent ?? null,
        lifeValueAxes: s.lifeValueAxes ?? [],
        miceActive: s.miceActive ?? [],
        miceOpens: s.miceOpens ?? [],
        miceCloses: s.miceCloses ?? [],
        obligations: {
          mustEstablish: s.obligations?.mustEstablish ?? [],
          mustPayOff: s.obligations?.mustPayOff ?? [],
          mustTransferKnowledge: s.obligations?.mustTransferKnowledge ?? [],
          mustShowStateChange: s.obligations?.mustShowStateChange ?? [],
          mustNotReveal: s.obligations?.mustNotReveal ?? [],
          allowedNewEntities: s.obligations?.allowedNewEntities ?? [],
        },
        requiredPayoffs: s.requiredPayoffs ?? [],
      })),
      establishedFacts: outline.establishedFacts ?? [],
      characterStateChanges: outline.characterStateChanges ?? [],
      knowledgeChanges: outline.knowledgeChanges ?? [],
    }
    await writeFile(
      join(outputDir, `chapter-${ch}.scene-contracts.json`),
      JSON.stringify(sceneContracts, null, 2),
      "utf8",
    )

    const trace = {
      runId: novelId,
      chapterNumber: ch,
      events: traceEvents.map(e => ({
        eventType: e.event_type,
        chapter: e.chapter,
        beatIndex: e.beat_index,
        ts: e.ts,
        payload: e.payload,
      })),
      llmCalls: llmCalls.map(c => ({
        id: c.id,
        agent: c.agent,
        attempt: c.attempt,
        sceneId: c.scene_id,
        beatId: c.beat_id,
        beatIndex: c.beat_index,
        promptTokens: c.prompt_tokens,
        completionTokens: c.completion_tokens,
        cost: c.cost,
        userPromptChars: c.user_prompt_chars,
      })),
      counts: {
        events: traceEvents.length,
        llmCalls: llmCalls.length,
        writerCalls: llmCalls.filter(c => c.agent === "beat-writer").length,
      },
    }
    await writeFile(
      join(outputDir, `chapter-${ch}.trace.json`),
      JSON.stringify(trace, null, 2),
      "utf8",
    )

    saved.push(ch)
  }
  return { savedChapters: saved, missingChapters: missing }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  console.log(`fixture: ${args.fixturePath}`)
  console.log(`chapters: ${args.chapters}`)
  console.log(`runId: ${args.runId}`)

  setAutoMode(true)
  setResolverMode(getMode(true))

  const fixtureFile = Bun.file(args.fixturePath)
  if (!await fixtureFile.exists()) throw new Error(`fixture not found: ${args.fixturePath}`)
  const fixture = parseConceptFixture(await fixtureFile.json(), args.fixturePath)
  console.log(`profile: ${fixture.fixture_metadata.profile}`)
  console.log(`expected baseline ratio: ${fixture.fixture_metadata.expected_baseline_ratio}`)

  // Build the seed: fixture concept + chapter-count override + scene-first
  // pipelineOverrides. Production defaults are NOT touched — every flag is
  // set on this single novel via seed.pipelineOverrides.
  const seed: SeedInput = {
    ...fixture.concept,
    chapterCount: args.chapters,
    pipelineOverrides: {
      ...((fixture.concept as any).pipelineOverrides ?? {}),
      // Planner emits scene-contract fields per L096 (causal-motivation-v3).
      scenePlanContractV1: true,
      // Writer renders SCENE CONTRACT block + scene-call shape per L097.
      sceneCallWriterV1: true,
      // Expansion-retry path fires when actual words < advisory floor.
      writerExpansionMode: "retry-short-scenes-v1",
      // POC lane: skip chapter-level checker settle loops so prose
      // collection survives checker/API hangs. Diagnostics run post-hoc.
      draftCaptureModeV1: true,
    },
  }

  const outputDir = join(POC_OUTPUT_ROOT, args.runId)
  await mkdir(outputDir, { recursive: true })
  console.log(`output dir: ${outputDir}\n`)

  // Persist the resolved seed alongside the run for traceability.
  await writeFile(
    join(outputDir, "seed.json"),
    JSON.stringify({ runId: args.runId, fixturePath: args.fixturePath, seed }, null, 2),
    "utf8",
  )

  await initDB(args.runId)
  await createNovel(args.runId, seed)
  await initNovelRun(args.runId)
  console.log(`novel created: ${args.runId}\n`)

  console.log("━━━ concept phase ━━━")
  await runConceptPhase(args.runId, seed)

  console.log("\n━━━ planning phase ━━━")
  await runPlanningPhase(args.runId)

  // Sanity check: are any scene-contract fields populated? POC runs are
  // allowed to continue even if the planner under-populates (per the
  // operator's call to "stop only if planner produces unusable scene
  // contracts"). Log the populated-field rate so the operator can decide
  // whether to scrap and re-plan.
  const planCheck = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${args.runId}
    ORDER BY chapter_number ASC
  ` as Array<{ chapter_number: number; outline_json: unknown }>
  let totalScenes = 0
  let scenesWithAnyField = 0
  for (const row of planCheck) {
    const outline = typeof row.outline_json === "string" ? JSON.parse(row.outline_json) : row.outline_json
    for (const s of (outline as any)?.scenes ?? []) {
      totalScenes++
      if (s?.goal || s?.opposition || s?.turningPoint || s?.crisisChoice || s?.outcome || s?.povPersonalStake) {
        scenesWithAnyField++
      }
    }
  }
  console.log(`\nplanner output: ${planCheck.length} chapters, ${totalScenes} scenes; ${scenesWithAnyField}/${totalScenes} scenes have at least one scene-contract field populated.`)
  if (totalScenes === 0) {
    throw new Error(`planner produced no scenes; aborting before drafting (would burn tokens with no upside)`)
  }
  if (scenesWithAnyField === 0) {
    console.warn(`WARNING: planner populated 0 scene-contract fields. The scene-call writer prompt will degrade to legacy-shaped (header only). Continuing anyway — POC discipline says collect the artifact and decide post-hoc.`)
  }

  console.log("\n━━━ drafting phase (draft-capture mode) ━━━")
  const draftingResult = await runDraftingPhase(args.runId)
  console.log(`drafting kind: ${draftingResult.kind}`)

  console.log("\n━━━ capturing artifacts ━━━")
  const { savedChapters, missingChapters } = await captureChapterArtifacts(args.runId, outputDir, args.chapters)
  console.log(`saved chapters: [${savedChapters.join(", ")}]`)
  if (missingChapters.length > 0) {
    console.log(`missing chapters: [${missingChapters.join(", ")}] (no chapter_outlines row)`)
  }

  // Final summary written for downstream tools.
  await writeFile(
    join(outputDir, "run-summary.json"),
    JSON.stringify({
      runId: args.runId,
      fixturePath: args.fixturePath,
      profile: fixture.fixture_metadata.profile,
      chaptersRequested: args.chapters,
      chaptersSaved: savedChapters,
      chaptersMissing: missingChapters,
      plannerSceneContractFieldRate: totalScenes > 0 ? scenesWithAnyField / totalScenes : 0,
      draftingResultKind: draftingResult.kind,
      pipelineOverrides: seed.pipelineOverrides,
      capturedAt: new Date().toISOString(),
    }, null, 2),
    "utf8",
  )

  console.log(`\n✓ POC artifact at: ${outputDir}`)
  console.log(`  next: bun poc/scene-first-novella/diagnostics.ts --run-dir ${outputDir}`)
  console.log(`        bun poc/scene-first-novella/render-html.ts --run-dir ${outputDir}`)

  process.exit(0)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
