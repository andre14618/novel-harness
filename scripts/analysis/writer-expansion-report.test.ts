import { describe, expect, test } from "bun:test"

import {
  buildWriterExpansionReport,
  renderWriterExpansionReport,
  type WriterExpansionDraftRow,
  type WriterExpansionOutlineRow,
} from "./writer-expansion-report"

describe("writer-expansion-report", () => {
  test("separates over-planned outlines from writer expansion", () => {
    const outlines: WriterExpansionOutlineRow[] = [
      outline(1, 1500, 12),
      outline(2, 1500, 5),
      outline(3, 1500, 4),
    ]
    const drafts: WriterExpansionDraftRow[] = [
      draft(1, 1, "approved", 1500),
      draft(2, 1, "approved", 2400),
      draft(3, 1, "approved", 900),
    ]

    const report = buildWriterExpansionReport(outlines, drafts, "novel-test")

    expect(report.totals).toMatchObject({
      outlineChapters: 3,
      draftedChapters: 3,
      targetWords: 4500,
      draftedTargetWords: 4500,
      actualWords: 4800,
      plannedBeats: 21,
      draftedPlannedBeats: 21,
      overTargetChapters: 1,
      severeOverTargetChapters: 1,
      highWordsPerBeatChapters: 1,
      overPlannedBeatChapters: 1,
    })
    expect(report.chapters[0]!).toMatchObject({
      chapter: 1,
      plannedBeats: 12,
      recommendedBeats: 5,
      beatDeltaFromRecommended: 7,
      flags: ["low_words_per_beat", "over_planned_beats"],
    })
    expect(report.chapters[1]!.flags).toEqual(["over_target", "severe_over_target", "high_words_per_beat"])
    expect(report.chapters[2]!.flags).toEqual(["under_target"])

    const rendered = renderWriterExpansionReport(report)
    expect(rendered).toContain("Writer expansion report for novel-test")
    expect(rendered).toContain("highWordsPerBeat=1")
    expect(rendered).toContain("ch1: target=1500, beats=12")
    expect(rendered).toContain("over_planned_beats")
  })

  test("uses latest draft version per chapter and flags missing drafts", () => {
    const report = buildWriterExpansionReport([
      outline(1, 1200, 4),
      outline(2, 1200, 4),
    ], [
      draft(1, 1, "draft", 1800),
      draft(1, 2, "approved", 1100),
    ])

    expect(report.totals.draftedChapters).toBe(1)
    expect(report.totals.draftedTargetWords).toBe(1200)
    expect(report.totals.draftedPlannedBeats).toBe(4)
    expect(report.chapters[0]!.draft).toMatchObject({ version: 2, status: "approved", wordCount: 1100 })
    expect(report.chapters[0]!.flags).toEqual([])
    expect(report.chapters[1]!.flags).toEqual(["no_draft"])
  })

  test("renders empty outline sets without throwing", () => {
    const report = buildWriterExpansionReport([], [], null)

    expect(report.totals.outlineChapters).toBe(0)
    expect(renderWriterExpansionReport(report)).toContain("No chapter outlines found.")
  })
})

function outline(chapter: number, targetWords: number, beats: number): WriterExpansionOutlineRow {
  return {
    chapter_number: chapter,
    outline_json: {
      chapterNumber: chapter,
      targetWords,
      scenes: Array.from({ length: beats }, (_, i) => ({ beatId: `ch-${chapter}-beat-${i + 1}` })),
    },
  }
}

function draft(
  chapter: number,
  version: number,
  status: string,
  wordCount: number,
): WriterExpansionDraftRow {
  return {
    chapter_number: chapter,
    version,
    status,
    word_count: wordCount,
  }
}
