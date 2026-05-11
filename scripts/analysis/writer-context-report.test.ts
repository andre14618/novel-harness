import { describe, expect, test } from "bun:test"

import {
  buildWriterContextTelemetryReport,
  renderWriterContextTelemetryReport,
  type WriterContextEventRow,
} from "./writer-context-report"

describe("writer-context-report", () => {
  test("summarizes production writer context and drafting brief telemetry", () => {
    const rows: WriterContextEventRow[] = [
      row(1, 1, 0, JSON.stringify({
        path: "beat",
        stage: "initial",
        writerContextMode: "thread-character-context-v1",
        writerPromptIdRendering: "raw",
        targetWords: 800,
        hasCharacterContext: false,
        characterContext: {
          characterIds: ["char-maret", "char-cassel"],
          activeThreadIds: ["thread-report"],
          missingCharacterIds: ["char-missing"],
        },
        contextSurface: {
          surfaces: {
            characterProfiles: true,
            sceneContract: false,
            worldBible: true,
            setting: false,
            storySpine: false,
            implicitReferences: true,
            resolvedReferences: false,
            readerInfoState: false,
          },
          counts: {
            obligations: 0,
            activeThreadIds: 1,
            implicitReferenceMarkers: 1,
            referenceLookups: 2,
            referenceLlmCalls: 1,
            missingCharacterIds: 1,
          },
        },
        draftingBrief: {
          mode: "scene-budget-v1",
          selectedPromptChars: 500,
          fullContextPromptChars: 1000,
          targetWords: 800,
          charsDelta: -500,
          charsRatio: 0.5,
          sections: {
            sceneContract: true,
            obligations: true,
            factContinuityAnchors: true,
            characterSnapshots: true,
            characterContextCapsules: true,
            resolvedReferences: true,
            readerInfoState: true,
            setting: true,
          },
          counts: {
            characters: 2,
            obligations: 3,
            sceneContractFields: 5,
          },
        },
      })),
      row(2, 1, null, {
        path: "chapter",
        stage: "chapter",
        writerContextMode: "legacy",
        writerPromptIdRendering: "raw",
        targetWords: null,
        hasCharacterContext: false,
        contextSurface: {
          surfaces: {
            characterProfiles: false,
            worldBible: true,
            storySpine: true,
          },
          counts: {},
        },
        draftingBrief: null,
      }),
      row(3, null, null, "not-json"),
    ]

    const report = buildWriterContextTelemetryReport(rows, "novel-a")

    expect(report.totals).toMatchObject({
      events: 3,
      beatEvents: 1,
      chapterEvents: 1,
      targetWords: 800,
      withCharacterContext: 1,
      withCharacterProfiles: 1,
      withCharacterSnapshots: 1,
      withCharacterContextCapsules: 1,
      withSceneContract: 1,
      withObligations: 1,
      withWorldContext: 2,
      withWorldBible: 2,
      withSetting: 1,
      withStoryContext: 2,
      withImplicitReferences: 1,
      withReaderInfoState: 1,
      withResolvedReferences: 1,
      referenceLookups: 2,
      referenceLlmCalls: 1,
      withDraftingBriefTrace: 1,
      draftingBriefEnabledEvents: 1,
      avgDraftingBriefCharsRatio: 0.5,
      avgSelectedPromptChars: 500,
      avgFullContextPromptChars: 1000,
      totalDraftingBriefCharsDelta: -500,
      missingCharacterIds: 1,
    })
    expect(report.byPath).toEqual({ beat: 1, chapter: 1, unknown: 1 })
    expect(report.byStage).toEqual({ initial: 1, chapter: 1, unknown: 1 })
    expect(report.byWriterContextMode).toEqual({
      legacy: 1,
      "thread-character-context-v1": 1,
      unknown: 1,
    })
    expect(report.byDraftingBriefMode).toEqual({ "scene-budget-v1": 1 })

    const rendered = renderWriterContextTelemetryReport(report)
    expect(rendered).toContain("Writer context telemetry for novel-a")
    expect(rendered).toContain("character=1/3 (profiles=1, snapshots=1, capsules=1)")
    expect(rendered).toContain("obligations=1/3")
    expect(rendered).toContain("world=2/3 (bible=2, setting=1)")
    expect(rendered).toContain("implicitRefs=1/3")
    expect(rendered).toContain("refLookups=2, refLlm=1")
    expect(rendered).toContain("avgChars=500/1000")
    expect(rendered).toContain("avgRatio=0.500")
    expect(rendered).toContain("#1 ch1 beat1 beat/initial")
    expect(rendered).toContain("brief=scene-budget-v1 500/1000 (0.500)")
  })

  test("renders empty reports without throwing", () => {
    const report = buildWriterContextTelemetryReport([], null)

    expect(report.totals.events).toBe(0)
    expect(renderWriterContextTelemetryReport(report)).toContain("No writer-context events found.")
  })
})

function row(
  id: number,
  chapter: number | null,
  beatIndex: number | null,
  payload: unknown,
): WriterContextEventRow {
  return {
    id,
    chapter,
    beat_index: beatIndex,
    payload,
    timestamp: null,
  }
}
