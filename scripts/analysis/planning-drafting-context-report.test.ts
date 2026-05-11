import { describe, expect, test } from "bun:test"

import { buildWriterContextTelemetryReport, type WriterContextEventRow } from "./writer-context-report"
import {
  buildPlanningToDraftingContextReport,
  renderPlanningToDraftingContextReport,
  summarizePlanningArtifacts,
  type ContextContractStatus,
} from "./planning-drafting-context-report"
import type { ChapterOutline } from "../../src/types"

describe("planning-drafting-context-report", () => {
  test("compares upstream context availability with downstream writer telemetry", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characters: [
        { id: "char-maren", name: "Maren" },
        { id: "char-halric", name: "Halric" },
      ],
      outlines: [
        outline(1, {
          establishedFacts: [{ id: "fact-ledger", fact: "The ledger exists.", category: "knowledge" }],
          scenes: [{
            sceneId: "ch-001-scene-001-ledger",
            description: "Maren forces Halric to open the ledger because of their last encounter.",
            characters: ["Maren", "Halric"],
            goal: "Expose the ledger.",
            outcome: "Halric opens the ledger.",
            consequence: "Maren controls the next accusation.",
            obligations: {
              mustEstablish: [{
                obligationId: "obl-ledger",
                sourceId: "fact-ledger",
                threadId: "thread-court",
                text: "The ledger is opened in public.",
              }],
              mustPayOff: [],
              mustTransferKnowledge: [],
              mustShowStateChange: [],
              mustNotReveal: [],
              allowedNewEntities: [],
            },
          }],
        }),
        outline(2),
      ],
    })

    expect(upstream).toMatchObject({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characterCount: 2,
      chapterPlanCount: 2,
      plannedSceneCount: 2,
      scenesWithCharacters: 2,
      scenesWithSceneIds: 2,
      scenesWithSceneContract: 1,
      scenesWithObligations: 1,
      scenesWithImplicitReferences: 1,
      chaptersWithSetting: 2,
      chaptersWithCharactersPresentIds: 2,
      readerInfoSourceChapters: 1,
      obligationIds: 1,
      obligationSourceRefs: 1,
      activeStoryRefIds: 1,
    })

    const writerContext = buildWriterContextTelemetryReport([
      row(1, {
        path: "beat",
        stage: "initial",
        writerContextMode: "thread-character-context-v1",
        writerPromptIdRendering: "raw",
        targetWords: 700,
        contextSurface: {
          surfaces: {
            characterProfiles: true,
            characterSnapshots: true,
            characterContextCapsules: true,
            worldBible: true,
            setting: true,
            storySpine: false,
            readerInfoState: true,
            resolvedReferences: true,
            sceneContract: true,
          },
          counts: {
            obligations: 1,
            activeThreadIds: 1,
          },
        },
        draftingBrief: {
          mode: "scene-budget-v1",
          selectedPromptChars: 800,
          fullContextPromptChars: 1200,
          targetWords: 700,
          charsDelta: -400,
          charsRatio: 0.667,
          sections: {
            sceneContract: true,
            obligations: true,
            characterSnapshots: true,
            characterContextCapsules: true,
            resolvedReferences: true,
            readerInfoState: true,
            setting: true,
          },
          counts: {
            characters: 2,
            obligations: 1,
            sceneContractFields: 3,
          },
        },
      }),
    ], "novel-a")

    const report = buildPlanningToDraftingContextReport({ novelId: "novel-a", upstream, writerContext })

    expect(statuses(report.surfaces)).toMatchObject({
      characterProfiles: "covered",
      characterSnapshots: "covered",
      characterContextCapsules: "covered",
      worldBible: "covered",
      setting: "covered",
      storySpine: "covered",
      readerInfoState: "covered",
      resolvedReferences: "covered",
      sceneContract: "covered",
      obligations: "covered",
      draftingBrief: "covered",
    })
    expect(report.gaps).toHaveLength(0)
    expect(renderPlanningToDraftingContextReport(report)).toContain("Gaps: 0")
  })

  test("marks available upstream surfaces as not observed when no writer telemetry exists", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characters: [{ id: "char-maren", name: "Maren" }],
      outlines: [outline(1)],
    })
    const writerContext = buildWriterContextTelemetryReport([], "novel-b")
    const report = buildPlanningToDraftingContextReport({ novelId: "novel-b", upstream, writerContext })

    expect(statuses(report.surfaces)).toMatchObject({
      characterProfiles: "not_observed",
      characterSnapshots: "not_observed",
      characterContextCapsules: "not_observed",
      worldBible: "not_observed",
      setting: "not_observed",
      storySpine: "not_observed",
      resolvedReferences: "not_available",
      obligations: "not_available",
      draftingBrief: "not_available",
    })
    expect(report.gaps.map(row => row.surface)).toContain("characterProfiles")
    expect(report.gaps.map(row => row.surface)).toContain("storySpine")
  })

  test("marks represented telemetry without upstream artifacts as a contract mismatch", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: false,
      storySpineAvailable: false,
      characters: [],
      outlines: [],
    })
    const writerContext = buildWriterContextTelemetryReport([
      row(1, {
        path: "beat",
        stage: "initial",
        writerContextMode: "thread-character-context-v1",
        contextSurface: {
          surfaces: {
            characterProfiles: true,
            worldBible: true,
          },
          counts: {},
        },
        draftingBrief: null,
      }),
    ], "novel-c")

    const report = buildPlanningToDraftingContextReport({ novelId: "novel-c", upstream, writerContext })

    expect(statuses(report.surfaces)).toMatchObject({
      characterProfiles: "represented_without_upstream",
      worldBible: "represented_without_upstream",
    })
    expect(report.gaps.map(row => row.status)).toContain("represented_without_upstream")
  })
})

function statuses(rows: { surface: string; status: ContextContractStatus }[]): Record<string, ContextContractStatus> {
  return Object.fromEntries(rows.map(row => [row.surface, row.status])) as Record<string, ContextContractStatus>
}

function row(id: number, payload: unknown): WriterContextEventRow {
  return {
    id,
    chapter: 1,
    beat_index: 0,
    payload,
    timestamp: null,
  }
}

function outline(chapterNumber: number, overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber,
    chapterId: `ch-${chapterNumber.toString().padStart(3, "0")}`,
    title: `Chapter ${chapterNumber}`,
    povCharacter: "Maren",
    povCharacterId: "char-maren",
    setting: "Chancellor's Chambers",
    purpose: "Force a public consequence.",
    targetWords: 1500,
    charactersPresent: ["Maren"],
    charactersPresentIds: ["char-maren"],
    scenes: [{
      sceneId: `ch-${chapterNumber.toString().padStart(3, "0")}-scene-001`,
      description: "Maren enters the chamber.",
      characters: ["Maren"],
      kind: "dialogue",
      requiredPayoffs: [],
      obligations: {
        mustEstablish: [],
        mustPayOff: [],
        mustTransferKnowledge: [],
        mustShowStateChange: [],
        mustNotReveal: [],
        allowedNewEntities: [],
      },
      lifeValueAxes: [],
      miceActive: [],
      miceOpens: [],
      miceCloses: [],
    }],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  } as ChapterOutline
}
