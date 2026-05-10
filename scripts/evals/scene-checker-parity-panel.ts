#!/usr/bin/env bun
/**
 * Scene-checker parity panel — L098 Slice 3.5 second deliverable.
 *
 * Diagnostic-only paired-replay harness. For each chapter of a persisted
 * novel, runs the same chapter prose through both the existing beat-level
 * chapter-plan-checker and a narrow per-scene satisfaction prompt; emits an
 * agreement matrix.
 *
 * Replay-only: never writes to the novel's pipeline state, never blocks
 * drafting, and explicitly does NOT promote scene-satisfaction findings to
 * blockers (per L092 + L098). Promotion remains contingent on a separately-
 * authored decision after sufficient parity evidence.
 *
 * Two LLM call shapes per chapter:
 *
 *   1. **Beat-shape** — one call to `chapter-plan-checker` using the existing
 *      `prompt` + `chapterPlanCheckSchema` + `buildContext`. Returns
 *      `{ pass, deviations[] }`. Each deviation may carry `beat_index` (the
 *      production representation of the entry the deviation pins to).
 *
 *   2. **Scene-shape** — one call per scene asking four narrow gates:
 *        - goalPursued: was the scene's stated goal pursued in the prose?
 *        - crisisChoiceMade: did the POV character make the declared choice?
 *        - outcomeLanded: did the declared outcome occur observably?
 *        - obligationsCovered: did the scene's declared obligations land?
 *      Each gate returns true/false + a short evidence string. The scene
 *      "fails" if any gate is false.
 *
 * Per-scene comparison:
 *   - Both flagged   → agree (issue): structural + scene-shape both spot a problem.
 *   - Both clean     → agree (clean).
 *   - Beat-only      → beat-shape catches what scene-shape misses.
 *   - Scene-only     → scene-shape catches what beat-shape misses (L092 hypothesis).
 *
 * Usage:
 *   bun scripts/evals/scene-checker-parity-panel.ts \
 *     --novel-id <persisted-novel-id> \
 *     [--chapters 1-5]
 *     [--live]              # default: synthetic (dry) for testing
 *     [--concurrency 4]
 *     [--output-dir <path>]
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { z } from "zod"

import db from "../../src/db/connection"
import { callAgent } from "../../src/llm"
import {
  prompt as CHAPTER_PLAN_CHECKER_PROMPT,
  chapterPlanCheckSchema,
} from "../../src/agents/chapter-plan-checker"
import { buildContext as buildChapterPlanCheckContext } from "../../src/agents/chapter-plan-checker/context"
import type { ChapterOutline, SceneBeat } from "../../src/types"
import type { ChapterPlanCheckResult } from "../../src/agents/chapter-plan-checker/schema"

interface Args {
  novelId: string
  chapters: number[] | null
  outputDir: string | null
  live: boolean
  concurrency: number
  json: boolean
}

interface ChapterRow {
  chapterNumber: number
  outline: ChapterOutline
  prose: string
  wordCount: number
}

const sceneSatisfactionSchema = z.object({
  goalPursued: z.object({ result: z.boolean(), evidence: z.string().default("") }),
  crisisChoiceMade: z.object({ result: z.boolean(), evidence: z.string().default("") }),
  outcomeLanded: z.object({ result: z.boolean(), evidence: z.string().default("") }),
  obligationsCovered: z.object({ result: z.boolean(), evidence: z.string().default("") }),
})
type SceneSatisfactionResult = z.infer<typeof sceneSatisfactionSchema>

const SCENE_SATISFACTION_PROMPT = `You are a narrow scene-satisfaction reviewer. You receive ONE scene's contract plus the prose of the entire chapter, and return four boolean gates with evidence.

Return strict JSON matching this shape exactly:

{
  "goalPursued":         { "result": boolean, "evidence": string },
  "crisisChoiceMade":    { "result": boolean, "evidence": string },
  "outcomeLanded":       { "result": boolean, "evidence": string },
  "obligationsCovered":  { "result": boolean, "evidence": string }
}

Rules:
- A gate is TRUE only if the prose shows the contract item observably. "Mentioned" or "implied" is not enough — the contract item must change something the reader can name.
- "obligationsCovered" is TRUE only when EVERY declared obligation is satisfied by the prose. If even one is missing, mark FALSE and name the missing one in evidence.
- If the contract field is "(none declared)" treat that gate as TRUE with evidence "no contract item declared".
- Evidence ≤ 240 chars per gate. Quote prose phrases briefly when possible. NEVER copy more than ~20 words at once.
- This is a per-scene narrow check. Do NOT comment on chapter-level structure, pacing, or other scenes.`

interface SceneParityRow {
  chapterNumber: number
  sceneIndex: number
  beatId: string
  beatShapeFlagged: boolean
  beatShapeDeviationCount: number
  sceneShapeFlagged: boolean
  sceneShapeFailedGates: string[]
  agreement: "both-flagged" | "both-clean" | "beat-only" | "scene-only"
  beatShapeDeviationSummaries: string[]
  sceneShapeEvidence: SceneSatisfactionResult | null
}

interface ChapterParityResult {
  chapterNumber: number
  beatShapePass: boolean
  beatShapeDeviationCount: number
  beatShapeError: string | null
  sceneRows: SceneParityRow[]
  sceneShapeError: string | null
}

export interface SceneCheckerParityReport {
  generatedAt: string
  novelId: string
  live: boolean
  chapters: ChapterParityResult[]
  matrix: {
    bothFlagged: number
    bothClean: number
    beatOnly: number
    sceneOnly: number
    totalScenes: number
    agreementRate: number
  }
}

export function classifyAgreement(beatFlagged: boolean, sceneFlagged: boolean): SceneParityRow["agreement"] {
  if (beatFlagged && sceneFlagged) return "both-flagged"
  if (!beatFlagged && !sceneFlagged) return "both-clean"
  if (beatFlagged && !sceneFlagged) return "beat-only"
  return "scene-only"
}

export function computeMatrix(rows: SceneParityRow[]): SceneCheckerParityReport["matrix"] {
  const total = rows.length
  let bothFlagged = 0, bothClean = 0, beatOnly = 0, sceneOnly = 0
  for (const row of rows) {
    if (row.agreement === "both-flagged") bothFlagged++
    else if (row.agreement === "both-clean") bothClean++
    else if (row.agreement === "beat-only") beatOnly++
    else sceneOnly++
  }
  const agreementRate = total > 0 ? (bothFlagged + bothClean) / total : 0
  return { bothFlagged, bothClean, beatOnly, sceneOnly, totalScenes: total, agreementRate }
}

export function buildScenePrompt(input: {
  outline: ChapterOutline
  scene: SceneBeat
  sceneIndex: number
  prose: string
}): string {
  const { outline, scene, sceneIndex, prose } = input
  const totalScenes = outline.scenes?.length ?? 0
  const obligations = flattenObligationsForPrompt(scene)
  const sceneAny = scene as Record<string, unknown>
  return [
    `CHAPTER ${outline.chapterNumber}: ${outline.title ?? ""}`,
    `POV: ${outline.povCharacter ?? "(unspecified)"}`,
    `Setting: ${outline.setting ?? "(unspecified)"}`,
    "",
    `SCENE ${sceneIndex + 1} of ${totalScenes} CONTRACT (this is the only scene under review):`,
    `Beat id: ${scene.beatId ?? "(unset)"}`,
    `Description: ${scene.description ?? "(none)"}`,
    `Goal: ${sceneAny.goal ?? "(none declared)"}`,
    `Opposition: ${sceneAny.opposition ?? "(none declared)"}`,
    `Turning point: ${sceneAny.turningPoint ?? "(none declared)"}`,
    `Crisis choice: ${sceneAny.crisisChoice ?? "(none declared)"}`,
    `Outcome: ${sceneAny.outcome ?? "(none declared)"}`,
    `Consequence: ${sceneAny.consequence ?? "(none declared)"}`,
    `Value shift: ${sceneAny.valueIn ?? ""} -> ${sceneAny.valueOut ?? ""}`,
    "",
    "DECLARED OBLIGATIONS (every one must be satisfied for obligationsCovered=true):",
    ...formatList(obligations.map(o => {
      const refs = [
        o.obligationId ? `obligationId=${o.obligationId}` : "",
        o.sourceId ? `sourceId=${o.sourceId}` : "",
        o.sourceKind ? `kind=${o.sourceKind}` : "",
      ].filter(Boolean).join(" ")
      return `${refs}: ${o.text}`
    })),
    "",
    "CHAPTER PROSE (the chapter is stored as a single string in production; judge whether THIS scene's contract is satisfied somewhere in the prose):",
    prose,
  ].join("\n")
}

function flattenObligationsForPrompt(scene: SceneBeat): Array<{
  obligationId?: string
  sourceId?: string
  sourceKind?: string
  text: string
}> {
  const out: ReturnType<typeof flattenObligationsForPrompt> = []
  const lists: Array<keyof NonNullable<SceneBeat["obligations"]>> = [
    "mustEstablish", "mustPayOff", "mustTransferKnowledge", "mustShowStateChange", "mustNotReveal",
  ]
  for (const list of lists) {
    const items = (scene.obligations?.[list] ?? []) as Array<Record<string, unknown>>
    for (const item of items) {
      out.push({
        obligationId: typeof item.obligationId === "string" ? item.obligationId : undefined,
        sourceId: typeof item.sourceId === "string" ? item.sourceId : undefined,
        sourceKind: typeof item.sourceKind === "string" ? item.sourceKind : undefined,
        text: typeof item.text === "string" ? item.text : "",
      })
    }
  }
  return out
}

async function runBeatShape(novelId: string, chapter: ChapterRow, live: boolean): Promise<{
  result: ChapterPlanCheckResult | null
  error: string | null
}> {
  if (!live) {
    return {
      result: { pass: true, deviations: [] },
      error: null,
    }
  }
  try {
    const response = await callAgent({
      novelId, agentName: "chapter-plan-checker", chapter: chapter.chapterNumber, attempt: 1,
      systemPrompt: CHAPTER_PLAN_CHECKER_PROMPT,
      userPrompt: buildChapterPlanCheckContext(chapter.prose, chapter.outline),
      schema: chapterPlanCheckSchema,
    })
    return { result: response.output, error: null }
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function runSceneShape(novelId: string, chapter: ChapterRow, sceneIndex: number, live: boolean): Promise<{
  result: SceneSatisfactionResult | null
  error: string | null
}> {
  const scene = chapter.outline.scenes?.[sceneIndex]
  if (!scene) return { result: null, error: `scene ${sceneIndex} not in outline` }
  if (!live) {
    return {
      result: {
        goalPursued: { result: true, evidence: "(dry run)" },
        crisisChoiceMade: { result: true, evidence: "(dry run)" },
        outcomeLanded: { result: true, evidence: "(dry run)" },
        obligationsCovered: { result: true, evidence: "(dry run)" },
      },
      error: null,
    }
  }
  try {
    const response = await callAgent({
      novelId, agentName: "chapter-plan-checker", chapter: chapter.chapterNumber, attempt: 1,
      beatIndex: sceneIndex,
      systemPrompt: SCENE_SATISFACTION_PROMPT,
      userPrompt: buildScenePrompt({
        outline: chapter.outline,
        scene,
        sceneIndex,
        prose: chapter.prose,
      }),
      schema: sceneSatisfactionSchema,
    })
    return { result: response.output, error: null }
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : String(err) }
  }
}

function summarizeBeatDeviationsForScene(
  deviations: ChapterPlanCheckResult["deviations"],
  sceneIndex: number,
  beatId: string | undefined,
): string[] {
  const out: string[] = []
  for (const dev of deviations) {
    if (dev.beat_index === sceneIndex) { out.push(dev.description); continue }
    if (beatId && dev.beatId === beatId) { out.push(dev.description); continue }
  }
  return out
}

function failedScenesGates(result: SceneSatisfactionResult): string[] {
  const out: string[] = []
  if (!result.goalPursued.result) out.push("goalPursued")
  if (!result.crisisChoiceMade.result) out.push("crisisChoiceMade")
  if (!result.outcomeLanded.result) out.push("outcomeLanded")
  if (!result.obligationsCovered.result) out.push("obligationsCovered")
  return out
}

async function reviewChapter(novelId: string, chapter: ChapterRow, args: Args): Promise<ChapterParityResult> {
  console.log(`  reviewing ch${chapter.chapterNumber} (${chapter.outline.scenes?.length ?? 0} scenes)`)
  const beat = await runBeatShape(novelId, chapter, args.live)
  const beatPass = beat.result?.pass ?? true
  const beatDeviations = beat.result?.deviations ?? []

  const scenes = chapter.outline.scenes ?? []
  const sceneRows: SceneParityRow[] = []
  let sceneShapeErrorAggregate: string | null = null

  const tasks = scenes.map((scene, sceneIndex) => async () => {
    const beatSummaries = summarizeBeatDeviationsForScene(beatDeviations, sceneIndex, scene.beatId)
    const beatFlagged = beatSummaries.length > 0
    const sceneOutcome = await runSceneShape(novelId, chapter, sceneIndex, args.live)
    if (sceneOutcome.error) sceneShapeErrorAggregate = (sceneShapeErrorAggregate ?? "") + `\n[scene ${sceneIndex}] ${sceneOutcome.error}`
    const failedGates = sceneOutcome.result ? failedScenesGates(sceneOutcome.result) : []
    const sceneFlagged = failedGates.length > 0
    return {
      chapterNumber: chapter.chapterNumber,
      sceneIndex,
      beatId: scene.beatId ?? `ch${chapter.chapterNumber}-scene${sceneIndex + 1}`,
      beatShapeFlagged: beatFlagged,
      beatShapeDeviationCount: beatSummaries.length,
      sceneShapeFlagged: sceneFlagged,
      sceneShapeFailedGates: failedGates,
      agreement: classifyAgreement(beatFlagged, sceneFlagged),
      beatShapeDeviationSummaries: beatSummaries,
      sceneShapeEvidence: sceneOutcome.result,
    } satisfies SceneParityRow
  })
  const settled = await runBounded(tasks, args.concurrency)
  for (const row of settled) sceneRows.push(row)

  return {
    chapterNumber: chapter.chapterNumber,
    beatShapePass: beatPass,
    beatShapeDeviationCount: beatDeviations.length,
    beatShapeError: beat.error,
    sceneRows,
    sceneShapeError: sceneShapeErrorAggregate,
  }
}

export async function buildSceneCheckerParityReport(args: Args, generatedAt = new Date().toISOString()): Promise<SceneCheckerParityReport> {
  const chapters = await loadChapterRows(args.novelId, args.chapters)
  if (chapters.length === 0) {
    throw new Error(`no chapters with both an outline and a draft were found for novel ${args.novelId}`)
  }
  const chapterResults: ChapterParityResult[] = []
  for (const chapter of chapters) {
    chapterResults.push(await reviewChapter(args.novelId, chapter, args))
  }
  const allRows = chapterResults.flatMap(c => c.sceneRows)
  return {
    generatedAt,
    novelId: args.novelId,
    live: args.live,
    chapters: chapterResults,
    matrix: computeMatrix(allRows),
  }
}

export function renderSceneCheckerParityReport(report: SceneCheckerParityReport): string {
  const lines: string[] = []
  lines.push("# Scene-Checker Parity Panel")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Novel: ${report.novelId}`)
  lines.push(`Live: ${report.live}`)
  lines.push("")
  lines.push("## Agreement Matrix")
  lines.push("")
  lines.push(`- Total scenes: ${report.matrix.totalScenes}`)
  lines.push(`- Both flagged: ${report.matrix.bothFlagged}`)
  lines.push(`- Both clean: ${report.matrix.bothClean}`)
  lines.push(`- Beat-only: ${report.matrix.beatOnly}`)
  lines.push(`- Scene-only: ${report.matrix.sceneOnly}`)
  lines.push(`- Agreement rate: ${(report.matrix.agreementRate * 100).toFixed(1)}%`)
  lines.push("")

  lines.push("## Per-Chapter Breakdown")
  lines.push("")
  for (const chapter of report.chapters) {
    lines.push(`### Chapter ${chapter.chapterNumber}`)
    lines.push("")
    lines.push(`- Beat-shape pass: ${chapter.beatShapePass}; deviations: ${chapter.beatShapeDeviationCount}`)
    if (chapter.beatShapeError) lines.push(`- Beat-shape error: ${chapter.beatShapeError}`)
    if (chapter.sceneShapeError) lines.push(`- Scene-shape error(s): ${chapter.sceneShapeError}`)
    for (const row of chapter.sceneRows) {
      lines.push(`  - scene ${row.sceneIndex + 1} (${row.beatId}) [${row.agreement}]: beat=${row.beatShapeFlagged ? row.beatShapeDeviationCount + " deviation(s)" : "clean"}; scene=${row.sceneShapeFlagged ? "failed " + row.sceneShapeFailedGates.join(",") : "all gates pass"}`)
    }
    lines.push("")
  }

  const sceneOnly = report.chapters.flatMap(c => c.sceneRows).filter(r => r.agreement === "scene-only")
  if (sceneOnly.length > 0) {
    lines.push("## Scene-Only Disagreements")
    lines.push("")
    lines.push("These are scenes where the new scene-shape prompt flagged an issue the existing beat-level checker missed. Per L092 this is the disagreement class to scrutinize before any promotion.")
    lines.push("")
    for (const row of sceneOnly) {
      lines.push(`- ch${row.chapterNumber} ${row.beatId}: failed gates ${row.sceneShapeFailedGates.join(",")}`)
      if (row.sceneShapeEvidence) {
        for (const gate of row.sceneShapeFailedGates) {
          const evidence = (row.sceneShapeEvidence as Record<string, { result: boolean; evidence: string }>)[gate]
          if (evidence) lines.push(`    - ${gate}: ${evidence.evidence}`)
        }
      }
    }
    lines.push("")
  }

  const beatOnly = report.chapters.flatMap(c => c.sceneRows).filter(r => r.agreement === "beat-only")
  if (beatOnly.length > 0) {
    lines.push("## Beat-Only Disagreements")
    lines.push("")
    for (const row of beatOnly) {
      lines.push(`- ch${row.chapterNumber} ${row.beatId}: ${row.beatShapeDeviationSummaries.join("; ")}`)
    }
    lines.push("")
  }

  lines.push("## Promotion Standard")
  lines.push("")
  lines.push("- Per L092, scene-satisfaction findings are NOT a blocker until a separate decision authorizes promotion.")
  lines.push("- This panel is diagnostic. Even strong agreement here does not flip default flags.")
  return `${lines.join("\n")}\n`
}

async function loadChapterRows(novelId: string, chapterFilter: number[] | null): Promise<ChapterRow[]> {
  const filter = chapterFilter && chapterFilter.length > 0 ? chapterFilter : null
  const rows = filter
    ? await db`
        SELECT co.chapter_number, co.outline_json, cd.prose, cd.word_count
        FROM chapter_outlines co
        JOIN LATERAL (
          SELECT prose, word_count FROM chapter_drafts
          WHERE novel_id = co.novel_id AND chapter_number = co.chapter_number
          ORDER BY version DESC
          LIMIT 1
        ) cd ON true
        WHERE co.novel_id = ${novelId}
          AND co.chapter_number = ANY(${filter})
        ORDER BY co.chapter_number ASC
      ` as Array<{ chapter_number: number; outline_json: ChapterOutline; prose: string; word_count: number }>
    : await db`
        SELECT co.chapter_number, co.outline_json, cd.prose, cd.word_count
        FROM chapter_outlines co
        JOIN LATERAL (
          SELECT prose, word_count FROM chapter_drafts
          WHERE novel_id = co.novel_id AND chapter_number = co.chapter_number
          ORDER BY version DESC
          LIMIT 1
        ) cd ON true
        WHERE co.novel_id = ${novelId}
        ORDER BY co.chapter_number ASC
      ` as Array<{ chapter_number: number; outline_json: ChapterOutline; prose: string; word_count: number }>
  return rows.map(row => ({
    chapterNumber: row.chapter_number,
    outline: row.outline_json,
    prose: row.prose,
    wordCount: row.word_count,
  }))
}

function formatList(rows: string[]): string[] {
  return rows.length > 0 ? rows.map(row => `- ${row}`) : ["- none"]
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  if (tasks.length === 0) return []
  const results: T[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]!()
    }
  })
  await Promise.all(workers)
  return results
}

function parseChapterRange(value: string | null): number[] | null {
  if (!value) return null
  const out = new Set<number>()
  for (const segment of value.split(",")) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    const dashMatch = trimmed.match(/^(\d+)-(\d+)$/)
    if (dashMatch) {
      const start = Number.parseInt(dashMatch[1]!, 10)
      const end = Number.parseInt(dashMatch[2]!, 10)
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
        throw new Error(`invalid --chapters range segment: ${trimmed}`)
      }
      for (let n = start; n <= end; n++) out.add(n)
      continue
    }
    const single = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(single) || single < 1) throw new Error(`invalid --chapters segment: ${trimmed}`)
    out.add(single)
  }
  return [...out].sort((a, b) => a - b)
}

function parseArgs(argv = process.argv.slice(2)): Args {
  let novelId: string | null = null
  let chapters: string | null = null
  let outputDir: string | null = null
  let live = false
  let concurrency = 4
  let json = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const eat = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} requires a value`)
      return v
    }
    if (a === "--novel-id") { novelId = eat(); continue }
    if (a === "--chapters") { chapters = eat(); continue }
    if (a === "--output-dir") { outputDir = eat(); continue }
    if (a === "--live") { live = true; continue }
    if (a === "--concurrency") {
      const parsed = Number.parseInt(eat(), 10)
      if (!Number.isFinite(parsed) || parsed < 1) throw new Error("--concurrency must be a positive integer")
      concurrency = parsed
      continue
    }
    if (a === "--json") { json = true; continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!novelId) throw new Error("--novel-id <persisted-novel-id> is required")
  return { novelId, chapters: parseChapterRange(chapters), outputDir, live, concurrency, json }
}

async function main(): Promise<void> {
  const args = parseArgs()
  console.log(`scene-checker-parity-panel novel=${args.novelId} live=${args.live}`)
  const report = await buildSceneCheckerParityReport(args)

  const dateSlug = report.generatedAt.slice(0, 10).replace(/-/g, "")
  const outputDir = resolve(process.cwd(), args.outputDir ?? `output/scene-checker-parity/${dateSlug}-${args.novelId}`)
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "scene-checker-parity.json"), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outputDir, "scene-checker-parity.md"), renderSceneCheckerParityReport(report))

  console.log(args.json ? JSON.stringify(report, null, 2) : renderSceneCheckerParityReport(report))
  console.log(`wrote ${join(outputDir, "scene-checker-parity.json")}`)
  console.log(`wrote ${join(outputDir, "scene-checker-parity.md")}`)
  process.exit(0)
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack : err)
    process.exit(1)
  })
}
