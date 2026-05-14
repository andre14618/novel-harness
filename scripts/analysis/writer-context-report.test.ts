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
            canonFacts: true,
            sceneContract: false,
            sceneEndpointLandingGuidance: true,
            worldBible: true,
            setting: false,
            storySpine: false,
            implicitReferences: true,
            semanticRetrieval: true,
            minimalFallback: false,
            resolvedReferences: false,
            readerInfoState: false,
          },
          counts: {
            obligations: 0,
            canonSourceRefs: 2,
            storyRefIds: 1,
            sceneContractFields: 5,
            sceneContractAnchorFields: 2,
            sceneContractDramaticFields: 2,
            sceneContractEndpointFields: 2,
            sceneContractBudgetFields: 1,
            activeThreadIds: 1,
            readerInfoStateChars: 0,
            implicitReferenceMarkers: 1,
            referenceLookups: 2,
            referenceLlmCalls: 1,
            missingCharacterIds: 1,
          },
          ids: {
            canonSourceRefs: ["fact-ledger"],
            activeThreadIds: ["thread-report"],
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
            sceneEndpointLandingGuidance: true,
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
            canonSourceRefs: 2,
            storyRefIds: 2,
            activeThreadIds: 1,
            activePromiseIds: 1,
            activePayoffIds: 0,
            readerInfoStateChars: 32,
            sceneContractFields: 5,
            sceneContractAnchorFields: 2,
            sceneContractDramaticFields: 2,
            sceneContractEndpointFields: 2,
            sceneContractBudgetFields: 1,
            choiceAlternatives: 1,
          },
          ids: {
            canonSourceRefs: ["fact-ledger", "fact-warrant"],
            activeThreadIds: ["thread-report"],
            activePromiseIds: ["promise-return"],
            activePayoffIds: [],
          },
        },
      })),
      row(2, 1, null, {
        path: "chapter",
        stage: "beat-fallback",
        writerContextMode: "legacy",
        writerPromptIdRendering: "raw",
        targetWords: null,
        hasCharacterContext: false,
        contextSurface: {
          surfaces: {
            characterProfiles: false,
            worldBible: true,
            storySpine: true,
            semanticRetrieval: false,
            minimalFallback: true,
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
      withSceneEndpointLandingGuidance: 1,
      withSceneContractShapeCounts: 1,
      withSceneContractAnchors: 1,
      withDramaticSceneContract: 1,
      withAnchorOnlySceneContract: 0,
      sceneContractFields: 5,
      sceneContractAnchorFields: 2,
      sceneContractDramaticFields: 2,
      sceneContractEndpointFields: 2,
      sceneContractBudgetFields: 1,
      withObligations: 1,
      withCanonFactContext: 1,
      withFactContinuityAnchors: 1,
      canonSourceRefs: 2,
      canonSourceRefCounts: { "fact-ledger": 1, "fact-warrant": 1 },
      storyRefIds: 2,
      activeThreadIdCounts: { "thread-report": 1 },
      activePromiseIdCounts: { "promise-return": 1 },
      activePayoffIdCounts: {},
      withWorldContext: 2,
      withWorldBible: 2,
      withSetting: 1,
      withStoryContext: 2,
      withImplicitReferences: 1,
      withSemanticRetrieval: 1,
      withMinimalFallback: 1,
      withReaderInfoState: 1,
      readerInfoStateChars: 32,
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
      missingCharacterIdCounts: { "char-missing": 1 },
    })
    expect(report.events[0]?.missingCharacterIdValues).toEqual(["char-missing"])
    expect(report.events[0]?.canonSourceRefValues).toEqual(["fact-ledger", "fact-warrant"])
    expect(report.events[0]?.activeThreadIdValues).toEqual(["thread-report"])
    expect(report.events[0]?.activePromiseIdValues).toEqual(["promise-return"])
    expect(report.byPath).toEqual({ beat: 1, chapter: 1, unknown: 1 })
    expect(report.byStage).toEqual({ initial: 1, "beat-fallback": 1, unknown: 1 })
    expect(report.byWriterContextMode).toEqual({
      legacy: 1,
      "thread-character-context-v1": 1,
      unknown: 1,
    })
    expect(report.byDraftingBriefMode).toEqual({ "scene-budget-v1": 1 })

    const rendered = renderWriterContextTelemetryReport(report)
    expect(rendered).toContain("Writer context telemetry for novel-a")
    expect(rendered).toContain("character=1/3 (profiles=1, snapshots=1, capsules=1)")
    expect(rendered).toContain("sceneContract=1/3 (shapeCounts=1, dramatic=1, endpointGuidance=1, anchorOnly=0, anchors=1)")
    expect(rendered).toContain("obligations=1/3")
    expect(rendered).toContain("canon=1/3 (sourceRefs=2; fact-ledger=1, fact-warrant=1, factAnchors=1)")
    expect(rendered).toContain("world=2/3 (bible=2, setting=1)")
    expect(rendered).toContain("story=2/3 (refs=2, threads=thread-report=1, promises=promise-return=1, payoffs=none)")
    expect(rendered).toContain("implicitRefs=1/3")
    expect(rendered).toContain("retrieval=1/3")
    expect(rendered).toContain("minimalFallback=1/3")
    expect(rendered).toContain("readerInfo=1/3 (chars=32)")
    expect(rendered).toContain("Stages: beat-fallback=1, initial=1, unknown=1")
    expect(rendered).toContain("refLookups=2, refLlm=1")
    expect(rendered).toContain("missingCharacterIds=1 (char-missing=1)")
    expect(rendered).toContain("avgChars=500/1000")
    expect(rendered).toContain("avgRatio=0.500")
    expect(rendered).toContain("#1 ch1 beat1 beat/initial: surfaces=char,scene,endpointGuidance,canon,obligations")
    expect(rendered).toContain("missingCharacterIds=char-missing")
    expect(rendered).toContain("traceIds=canon:fact-ledger,fact-warrant; threads:thread-report; promises:promise-return")
    expect(rendered).toContain("brief=scene-budget-v1 500/1000 (0.500)")
  })

  test("renders empty reports without throwing", () => {
    const report = buildWriterContextTelemetryReport([], null)

    expect(report.totals.events).toBe(0)
    expect(renderWriterContextTelemetryReport(report)).toContain("No writer-context events found.")
  })

  test("normalizes context coverage by beat scene instead of retry event volume", () => {
    const rows: WriterContextEventRow[] = [
      row(1, 2, 4, {
        path: "beat",
        stage: "initial",
        contextSurface: {
          surfaces: {
            canonFacts: true,
            storySpine: false,
            readerInfoState: true,
            resolvedReferences: false,
          },
          counts: {
            canonSourceRefs: 1,
            storyRefIds: 1,
            activeThreadIds: 1,
            readerInfoStateChars: 100,
            referenceLookups: 2,
          },
          ids: {
            canonSourceRefs: ["fact-a"],
            activeThreadIds: ["thread-a"],
          },
        },
      }),
      row(2, 2, 4, {
        path: "beat",
        stage: "integrity-rewrite",
        characterContext: {
          missingCharacterIds: ["char-missing"],
        },
        contextSurface: {
          surfaces: {
            canonFacts: true,
            storySpine: false,
            readerInfoState: true,
            resolvedReferences: false,
          },
          counts: {
            canonSourceRefs: 2,
            storyRefIds: 2,
            activeThreadIds: 1,
            activePromiseIds: 1,
            readerInfoStateChars: 160,
            referenceLookups: 4,
            referenceLlmCalls: 1,
            missingCharacterIds: 1,
          },
          ids: {
            canonSourceRefs: ["fact-a", "fact-b"],
            activeThreadIds: ["thread-a"],
            activePromiseIds: ["promise-b"],
          },
        },
      }),
    ]

    const report = buildWriterContextTelemetryReport(rows, "novel-retry")

    expect(report.totals.events).toBe(2)
    expect(report.totals.canonSourceRefs).toBe(3)
    expect(report.totals.storyRefIds).toBe(3)
    expect(report.totals.readerInfoStateChars).toBe(260)
    expect(report.totals.sceneCoverage).toMatchObject({
      beatScenes: 1,
      withCanonFactContext: 1,
      canonSourceRefs: 2,
      canonSourceRefCounts: { "fact-a": 1, "fact-b": 1 },
      withStoryContext: 1,
      storyRefIds: 2,
      activeThreadIdCounts: { "thread-a": 1 },
      activePromiseIdCounts: { "promise-b": 1 },
      withReaderInfoState: 1,
      readerInfoStateChars: 160,
      referenceLookups: 4,
      referenceLlmCalls: 1,
      missingCharacterIds: 1,
      missingCharacterIdCounts: { "char-missing": 1 },
    })
    expect(renderWriterContextTelemetryReport(report)).toContain("Scene-normalized context: scenes=1")
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
