#!/usr/bin/env bun
/**
 * Read-only diagnostic for chapter length shape.
 *
 * This separates two common failure sources before prompt/runtime changes:
 * over-planned outlines (too many scene entries for targetWords) and writer
 * expansion (too many prose words per planned entry).
 */

import { assessSceneCountForTarget } from "../../src/harness/scene-counts"

export interface WriterExpansionOutlineRow {
  chapter_number: number
  outline_json: {
    chapterNumber?: number
    targetWords?: number
    scenes?: unknown[]
  } | null
}

export interface WriterExpansionDraftRow {
  chapter_number: number
  version: number
  status: string
  word_count: number
}

export interface WriterExpansionChapter {
  chapter: number
  targetWords: number | null
  plannedScenes: number
  minRecommendedScenes: number | null
  recommendedScenes: number | null
  draft: {
    version: number
    status: string
    wordCount: number
  } | null
  wordRatio: number | null
  wordsPerScene: number | null
  sceneDeltaFromRecommended: number | null
  flags: WriterExpansionFlag[]
}

export type WriterExpansionFlag =
  | "no_draft"
  | "over_target"
  | "severe_over_target"
  | "under_target"
  | "high_words_per_scene"
  | "low_words_per_scene"
  | "over_planned_scenes"
  | "under_planned_scenes"

export interface WriterExpansionReport {
  novelId: string | null
  chapters: WriterExpansionChapter[]
  totals: {
    outlineChapters: number
    draftedChapters: number
    targetWords: number
    draftedTargetWords: number
    actualWords: number
    plannedScenes: number
    draftedPlannedScenes: number
    wordRatio: number | null
    averageWordsPerScene: number | null
    overTargetChapters: number
    severeOverTargetChapters: number
    highWordsPerSceneChapters: number
    overPlannedSceneChapters: number
  }
}

interface Args {
  novelId: string | null
  json: boolean
}

export function buildWriterExpansionReport(
  outlines: readonly WriterExpansionOutlineRow[],
  drafts: readonly WriterExpansionDraftRow[],
  novelId: string | null = null,
): WriterExpansionReport {
  const latestDrafts = new Map<number, WriterExpansionDraftRow>()
  for (const draft of [...drafts].sort((a, b) =>
    a.chapter_number - b.chapter_number || b.version - a.version
  )) {
    if (!latestDrafts.has(draft.chapter_number)) latestDrafts.set(draft.chapter_number, draft)
  }

  const chapters = [...outlines]
    .sort((a, b) => a.chapter_number - b.chapter_number)
    .map((row): WriterExpansionChapter => {
      const outline = row.outline_json ?? {}
      const targetWords = positiveNumber(outline.targetWords) ? Number(outline.targetWords) : null
      const plannedScenes = Array.isArray(outline.scenes) ? outline.scenes.length : 0
      const sceneAssessment = targetWords === null ? null : assessSceneCountForTarget(targetWords, plannedScenes)
      const minRecommendedScenes = sceneAssessment?.minRecommendedScenes ?? null
      const recommendedScenes = sceneAssessment?.recommendedScenes ?? null
      const latest = latestDrafts.get(row.chapter_number) ?? null
      const wordCount = latest ? Number(latest.word_count) : null
      const wordRatio = wordCount !== null && targetWords !== null && targetWords > 0
        ? wordCount / targetWords
        : null
      const wordsPerScene = wordCount !== null && plannedScenes > 0 ? wordCount / plannedScenes : null
      const sceneDeltaFromRecommended = sceneAssessment?.sceneDeltaFromRecommended ?? null
      const flags = expansionFlags({
        hasDraft: latest !== null,
        wordRatio,
        wordsPerScene,
        underPlannedScenes: sceneAssessment?.underPlanned ?? false,
        overPlannedScenes: sceneAssessment?.overPlanned ?? false,
      })

      return {
        chapter: row.chapter_number,
        targetWords,
        plannedScenes,
        minRecommendedScenes,
        recommendedScenes,
        draft: latest ? {
          version: Number(latest.version),
          status: latest.status,
          wordCount: Number(latest.word_count),
        } : null,
        wordRatio,
        wordsPerScene,
        sceneDeltaFromRecommended,
        flags,
      }
    })

  const drafted = chapters.filter(chapter => chapter.draft)
  const targetWords = chapters.reduce((sum, chapter) => sum + (chapter.targetWords ?? 0), 0)
  const draftedTargetWords = drafted.reduce((sum, chapter) => sum + (chapter.targetWords ?? 0), 0)
  const actualWords = drafted.reduce((sum, chapter) => sum + (chapter.draft?.wordCount ?? 0), 0)
  const plannedScenes = chapters.reduce((sum, chapter) => sum + chapter.plannedScenes, 0)
  const draftedPlannedScenes = drafted.reduce((sum, chapter) => sum + chapter.plannedScenes, 0)
  return {
    novelId,
    chapters,
    totals: {
      outlineChapters: chapters.length,
      draftedChapters: drafted.length,
      targetWords,
      draftedTargetWords,
      actualWords,
      plannedScenes,
      draftedPlannedScenes,
      wordRatio: draftedTargetWords > 0 && actualWords > 0 ? actualWords / draftedTargetWords : null,
      averageWordsPerScene: draftedPlannedScenes > 0 && actualWords > 0 ? actualWords / draftedPlannedScenes : null,
      overTargetChapters: chapters.filter(chapter => chapter.flags.includes("over_target")).length,
      severeOverTargetChapters: chapters.filter(chapter => chapter.flags.includes("severe_over_target")).length,
      highWordsPerSceneChapters: chapters.filter(chapter => chapter.flags.includes("high_words_per_scene")).length,
      overPlannedSceneChapters: chapters.filter(chapter => chapter.flags.includes("over_planned_scenes")).length,
    },
  }
}

export function renderWriterExpansionReport(report: WriterExpansionReport): string {
  const lines: string[] = []
  lines.push(`Writer expansion report${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(
    `Chapters: ${report.totals.outlineChapters} outlined, ${report.totals.draftedChapters} drafted; ` +
      `target=${report.totals.targetWords}, draftedTarget=${report.totals.draftedTargetWords}, ` +
      `actual=${report.totals.actualWords}, ` +
      `ratio=${formatNullable(report.totals.wordRatio, 2)}, ` +
      `plannedScenes=${report.totals.plannedScenes}, draftedScenes=${report.totals.draftedPlannedScenes}, ` +
      `avgWordsPerDraftedScene=${formatNullable(report.totals.averageWordsPerScene, 0)}`,
  )
  lines.push(
    `Flags: overTarget=${report.totals.overTargetChapters}, ` +
      `severeOverTarget=${report.totals.severeOverTargetChapters}, ` +
      `highWordsPerScene=${report.totals.highWordsPerSceneChapters}, ` +
      `overPlannedScenes=${report.totals.overPlannedSceneChapters}`,
  )
  if (report.chapters.length === 0) {
    lines.push("No chapter outlines found.")
    return lines.join("\n")
  }

  for (const chapter of report.chapters) {
    const draft = chapter.draft
    const flags = chapter.flags.length > 0 ? ` flags=${chapter.flags.join(",")}` : ""
    lines.push(
      `ch${chapter.chapter}: target=${chapter.targetWords ?? "?"}, scenes=${chapter.plannedScenes}` +
        ` (min=${chapter.minRecommendedScenes ?? "?"}, rec=${chapter.recommendedScenes ?? "?"}, delta=${chapter.sceneDeltaFromRecommended ?? "?"})` +
        `, draft=${draft ? `${draft.wordCount}w/${draft.status}/v${draft.version}` : "none"}` +
        `, ratio=${formatNullable(chapter.wordRatio, 2)}, wordsPerScene=${formatNullable(chapter.wordsPerScene, 0)}${flags}`,
    )
  }
  return lines.join("\n")
}

function expansionFlags(input: {
  hasDraft: boolean
  wordRatio: number | null
  wordsPerScene: number | null
  underPlannedScenes: boolean
  overPlannedScenes: boolean
}): WriterExpansionFlag[] {
  const flags: WriterExpansionFlag[] = []
  if (!input.hasDraft) flags.push("no_draft")
  if (input.wordRatio !== null && input.wordRatio > 1.25) flags.push("over_target")
  if (input.wordRatio !== null && input.wordRatio > 1.5) flags.push("severe_over_target")
  if (input.wordRatio !== null && input.wordRatio < 0.75) flags.push("under_target")
  if (input.wordsPerScene !== null && input.wordsPerScene > 450) flags.push("high_words_per_scene")
  if (input.wordsPerScene !== null && input.wordsPerScene < 200) flags.push("low_words_per_scene")
  if (input.overPlannedScenes) flags.push("over_planned_scenes")
  if (input.underPlannedScenes) flags.push("under_planned_scenes")
  return flags
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function formatNullable(value: number | null, digits: number): string {
  return value === null ? "?" : value.toFixed(digits)
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

async function loadInputs(novelId: string): Promise<{
  outlines: WriterExpansionOutlineRow[]
  drafts: WriterExpansionDraftRow[]
}> {
  const { default: db } = await import("../../src/db/connection")
  const outlines = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  ` as WriterExpansionOutlineRow[]
  const drafts = await db`
    SELECT DISTINCT ON (chapter_number) chapter_number, version, status, word_count
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number, version DESC
  ` as WriterExpansionDraftRow[]
  await db.end().catch(() => {})
  return { outlines, drafts }
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/writer-expansion-report.ts --novel <novelId> [--json]")
    return 2
  }

  if (!args.novelId) {
    console.error("usage: bun scripts/analysis/writer-expansion-report.ts --novel <novelId> [--json]")
    return 2
  }

  const inputs = await loadInputs(args.novelId)
  const report = buildWriterExpansionReport(inputs.outlines, inputs.drafts, args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderWriterExpansionReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
