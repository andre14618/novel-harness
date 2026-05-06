#!/usr/bin/env bun
/**
 * Read-only diagnostic for chapter length shape.
 *
 * This separates two common failure sources before prompt/runtime changes:
 * over-planned outlines (too many beats for targetWords) and writer expansion
 * (too many prose words per planned beat).
 */

import { assessBeatCountForTarget } from "../../src/harness/beat-counts"

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
  plannedBeats: number
  minRecommendedBeats: number | null
  recommendedBeats: number | null
  draft: {
    version: number
    status: string
    wordCount: number
  } | null
  wordRatio: number | null
  wordsPerBeat: number | null
  beatDeltaFromRecommended: number | null
  flags: WriterExpansionFlag[]
}

export type WriterExpansionFlag =
  | "no_draft"
  | "over_target"
  | "severe_over_target"
  | "under_target"
  | "high_words_per_beat"
  | "low_words_per_beat"
  | "over_planned_beats"
  | "under_planned_beats"

export interface WriterExpansionReport {
  novelId: string | null
  chapters: WriterExpansionChapter[]
  totals: {
    outlineChapters: number
    draftedChapters: number
    targetWords: number
    draftedTargetWords: number
    actualWords: number
    plannedBeats: number
    draftedPlannedBeats: number
    wordRatio: number | null
    averageWordsPerBeat: number | null
    overTargetChapters: number
    severeOverTargetChapters: number
    highWordsPerBeatChapters: number
    overPlannedBeatChapters: number
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
      const plannedBeats = Array.isArray(outline.scenes) ? outline.scenes.length : 0
      const beatAssessment = targetWords === null ? null : assessBeatCountForTarget(targetWords, plannedBeats)
      const minRecommendedBeats = beatAssessment?.minRecommendedBeats ?? null
      const recommendedBeats = beatAssessment?.recommendedBeats ?? null
      const latest = latestDrafts.get(row.chapter_number) ?? null
      const wordCount = latest ? Number(latest.word_count) : null
      const wordRatio = wordCount !== null && targetWords !== null && targetWords > 0
        ? wordCount / targetWords
        : null
      const wordsPerBeat = wordCount !== null && plannedBeats > 0 ? wordCount / plannedBeats : null
      const beatDeltaFromRecommended = beatAssessment?.beatDeltaFromRecommended ?? null
      const flags = expansionFlags({
        hasDraft: latest !== null,
        wordRatio,
        wordsPerBeat,
        underPlannedBeats: beatAssessment?.underPlanned ?? false,
        overPlannedBeats: beatAssessment?.overPlanned ?? false,
      })

      return {
        chapter: row.chapter_number,
        targetWords,
        plannedBeats,
        minRecommendedBeats,
        recommendedBeats,
        draft: latest ? {
          version: Number(latest.version),
          status: latest.status,
          wordCount: Number(latest.word_count),
        } : null,
        wordRatio,
        wordsPerBeat,
        beatDeltaFromRecommended,
        flags,
      }
    })

  const drafted = chapters.filter(chapter => chapter.draft)
  const targetWords = chapters.reduce((sum, chapter) => sum + (chapter.targetWords ?? 0), 0)
  const draftedTargetWords = drafted.reduce((sum, chapter) => sum + (chapter.targetWords ?? 0), 0)
  const actualWords = drafted.reduce((sum, chapter) => sum + (chapter.draft?.wordCount ?? 0), 0)
  const plannedBeats = chapters.reduce((sum, chapter) => sum + chapter.plannedBeats, 0)
  const draftedPlannedBeats = drafted.reduce((sum, chapter) => sum + chapter.plannedBeats, 0)
  return {
    novelId,
    chapters,
    totals: {
      outlineChapters: chapters.length,
      draftedChapters: drafted.length,
      targetWords,
      draftedTargetWords,
      actualWords,
      plannedBeats,
      draftedPlannedBeats,
      wordRatio: draftedTargetWords > 0 && actualWords > 0 ? actualWords / draftedTargetWords : null,
      averageWordsPerBeat: draftedPlannedBeats > 0 && actualWords > 0 ? actualWords / draftedPlannedBeats : null,
      overTargetChapters: chapters.filter(chapter => chapter.flags.includes("over_target")).length,
      severeOverTargetChapters: chapters.filter(chapter => chapter.flags.includes("severe_over_target")).length,
      highWordsPerBeatChapters: chapters.filter(chapter => chapter.flags.includes("high_words_per_beat")).length,
      overPlannedBeatChapters: chapters.filter(chapter => chapter.flags.includes("over_planned_beats")).length,
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
      `plannedBeats=${report.totals.plannedBeats}, draftedBeats=${report.totals.draftedPlannedBeats}, ` +
      `avgWordsPerDraftedBeat=${formatNullable(report.totals.averageWordsPerBeat, 0)}`,
  )
  lines.push(
    `Flags: overTarget=${report.totals.overTargetChapters}, ` +
      `severeOverTarget=${report.totals.severeOverTargetChapters}, ` +
      `highWordsPerBeat=${report.totals.highWordsPerBeatChapters}, ` +
      `overPlannedBeats=${report.totals.overPlannedBeatChapters}`,
  )
  if (report.chapters.length === 0) {
    lines.push("No chapter outlines found.")
    return lines.join("\n")
  }

  for (const chapter of report.chapters) {
    const draft = chapter.draft
    const flags = chapter.flags.length > 0 ? ` flags=${chapter.flags.join(",")}` : ""
    lines.push(
      `ch${chapter.chapter}: target=${chapter.targetWords ?? "?"}, beats=${chapter.plannedBeats}` +
        ` (min=${chapter.minRecommendedBeats ?? "?"}, rec=${chapter.recommendedBeats ?? "?"}, delta=${chapter.beatDeltaFromRecommended ?? "?"})` +
        `, draft=${draft ? `${draft.wordCount}w/${draft.status}/v${draft.version}` : "none"}` +
        `, ratio=${formatNullable(chapter.wordRatio, 2)}, wordsPerBeat=${formatNullable(chapter.wordsPerBeat, 0)}${flags}`,
    )
  }
  return lines.join("\n")
}

function expansionFlags(input: {
  hasDraft: boolean
  wordRatio: number | null
  wordsPerBeat: number | null
  underPlannedBeats: boolean
  overPlannedBeats: boolean
}): WriterExpansionFlag[] {
  const flags: WriterExpansionFlag[] = []
  if (!input.hasDraft) flags.push("no_draft")
  if (input.wordRatio !== null && input.wordRatio > 1.25) flags.push("over_target")
  if (input.wordRatio !== null && input.wordRatio > 1.5) flags.push("severe_over_target")
  if (input.wordRatio !== null && input.wordRatio < 0.75) flags.push("under_target")
  if (input.wordsPerBeat !== null && input.wordsPerBeat > 450) flags.push("high_words_per_beat")
  if (input.wordsPerBeat !== null && input.wordsPerBeat < 200) flags.push("low_words_per_beat")
  if (input.overPlannedBeats) flags.push("over_planned_beats")
  if (input.underPlannedBeats) flags.push("under_planned_beats")
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
