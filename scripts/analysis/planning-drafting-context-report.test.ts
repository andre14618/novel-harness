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
            temporalAnchor: "after the council vote",
            placeAnchor: "Chancellor's Chambers",
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
      canonFactCount: 1,
      canonKnowledgeChangeCount: 0,
      canonCharacterStateChangeCount: 0,
      canonChangeCount: 1,
      chapterPlanCount: 2,
      plannedSceneCount: 2,
      sceneLoad: {
        maxScenesPerChapter: 1,
        minTargetWordsPerScene: 1500,
        denseChapterCount: 0,
        overloadedChapterCount: 0,
      },
      planContinuity: {
        futureEventAnchors: [],
        factContradictions: [],
      },
      scenesWithCharacters: 2,
      scenesWithSceneIds: 2,
      scenesWithSceneContract: 1,
      scenesWithTemporalAnchor: 1,
      scenesWithPlaceAnchor: 1,
      sceneContractsWithDramaticShape: 1,
      sceneContractsWithChoiceShape: 0,
      sceneContractsWithEndpointShape: 1,
      sceneContractsWithFullDramaticShape: 0,
      anchorOnlySceneContracts: 0,
      sceneContractShape: {
        missingDramaticShape: [{
          label: "DRAMATIC-SCENE-CONTRACT-MISSING",
          sceneRef: "ch-002-scene-001",
          severity: "low",
        }],
        missingChoiceShape: [{
          label: "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE",
          sceneRef: "ch-001-scene-001-ledger",
          severity: "medium",
          missingFields: ["crisisChoice", "choiceAlternatives"],
          obligationIds: ["obl-ledger"],
          sourceIds: ["fact-ledger"],
          threadIds: ["thread-court"],
        }],
        missingFullDramaticShape: [{
          label: "SCENE-CONTRACT-FULL-SHAPE-INCOMPLETE",
          sceneRef: "ch-001-scene-001-ledger",
          severity: "medium",
          missingFields: [
            "opposition",
            "turningPoint",
            "crisisChoice",
            "choiceAlternatives",
            "povPersonalStake",
            "valueIn",
            "valueOut",
          ],
        }],
        anchorOnly: [],
      },
      scenesWithObligations: 1,
      scenesWithImplicitReferences: 1,
      implicitReferenceScenes: [{
        chapterNumber: 1,
        beatIndex: 0,
        sceneRef: "ch-001-scene-001-ledger",
      }],
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
            canonFacts: true,
            worldBible: true,
            setting: true,
            storySpine: false,
            readerInfoState: true,
            resolvedReferences: true,
            sceneContract: true,
          },
          counts: {
            obligations: 1,
            canonSourceRefs: 1,
            storyRefIds: 1,
            activeThreadIds: 1,
            readerInfoStateChars: 24,
            sceneContractFields: 5,
            sceneContractAnchorFields: 2,
            sceneContractDramaticFields: 3,
            sceneContractBudgetFields: 0,
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
            factContinuityAnchors: false,
            characterSnapshots: true,
            characterContextCapsules: true,
            resolvedReferences: true,
            readerInfoState: true,
            setting: true,
          },
          counts: {
            characters: 2,
            obligations: 1,
            canonSourceRefs: 1,
            storyRefIds: 1,
            activeThreadIds: 1,
            activePromiseIds: 0,
            activePayoffIds: 0,
            readerInfoStateChars: 24,
            sceneContractFields: 5,
            sceneContractAnchorFields: 2,
            sceneContractDramaticFields: 3,
            sceneContractBudgetFields: 0,
            choiceAlternatives: 0,
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
      canonFacts: "covered",
      setting: "covered",
      storySpine: "covered",
      storyRefLineage: "covered",
      readerInfoState: "covered",
      resolvedReferences: "covered",
      sceneContract: "covered",
      obligations: "covered",
      draftingBrief: "covered",
    })
    expect(report.gaps).toHaveLength(0)
    expect(renderPlanningToDraftingContextReport(report)).toContain("Gaps: 0")
    expect(renderPlanningToDraftingContextReport(report)).toContain("canonFacts=1, canonKnowledge=0, canonStates=0")
    expect(renderPlanningToDraftingContextReport(report)).toContain("canon=1 (sourceRefs=1, factAnchors=0)")
    expect(renderPlanningToDraftingContextReport(report)).toContain("story=1 (storyRefs=1)")
    expect(renderPlanningToDraftingContextReport(report)).toContain("storyRefLineage: covered; upstream=1; downstream=1")
    expect(renderPlanningToDraftingContextReport(report)).toContain("readerInfo=1 (readerChars=24)")
    expect(renderPlanningToDraftingContextReport(report)).toContain("Scene load: maxScenesPerChapter=1")
    expect(renderPlanningToDraftingContextReport(report)).toContain("Plan continuity: futureEventAnchors=0")
    expect(renderPlanningToDraftingContextReport(report)).toContain("sceneContracts=1 (dramatic=1, choice=0, endpoint=1, full=0, anchorOnly=0, temporal=1, place=1)")
    expect(renderPlanningToDraftingContextReport(report)).toContain("sceneContract=1 (shapeCounts=1, dramatic=1, anchorOnly=0, anchors=1)")
    expect(renderPlanningToDraftingContextReport(report)).toContain("Scene contract shape gaps: missingDramatic=1, missingChoice=1, missingFull=1, anchorOnly=0")
    expect(renderPlanningToDraftingContextReport(report)).toContain("SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE")
  })

  test("separates anchor-only scene contracts from dramatic scene shape", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characters: [{ id: "char-maren", name: "Maren" }],
      outlines: [outline(1, {
        scenes: [{
          ...scenes(1)[0]!,
          temporalAnchor: "dawn the next morning",
          placeAnchor: "Iron Bridge",
          targetWords: 400,
        }],
      })],
    })

    expect(upstream).toMatchObject({
      scenesWithSceneContract: 1,
      scenesWithTemporalAnchor: 1,
      scenesWithPlaceAnchor: 1,
      sceneContractsWithDramaticShape: 0,
      sceneContractsWithChoiceShape: 0,
      sceneContractsWithEndpointShape: 0,
      sceneContractsWithFullDramaticShape: 0,
      anchorOnlySceneContracts: 1,
      sceneContractShape: {
        missingDramaticShape: [{
          label: "ANCHOR-ONLY-SCENE-CONTRACT",
          sceneRef: "scene-1",
          severity: "medium",
          hasTemporalAnchor: true,
          hasPlaceAnchor: true,
          hasObligations: false,
          missingFields: [
            "goal",
            "opposition",
            "turningPoint",
            "outcome",
            "consequence",
            "povPersonalStake",
            "valueIn",
            "valueOut",
          ],
        }],
        missingChoiceShape: [],
        missingFullDramaticShape: [],
        anchorOnly: [{
          sceneRef: "scene-1",
        }],
      },
    })

    const writerContext = buildWriterContextTelemetryReport([
      row(1, {
        path: "beat",
        stage: "initial",
        writerContextMode: "thread-character-context-v1",
        contextSurface: {
          surfaces: { sceneContract: true },
          counts: {
            sceneContractFields: 3,
            sceneContractAnchorFields: 2,
            sceneContractDramaticFields: 0,
            sceneContractBudgetFields: 1,
          },
        },
        draftingBrief: null,
      }),
    ], "novel-anchor-only")
    const report = buildPlanningToDraftingContextReport({ novelId: "novel-anchor-only", upstream, writerContext })

    expect(renderPlanningToDraftingContextReport(report)).toContain("sceneContracts=1 (dramatic=0, choice=0, endpoint=0, full=0, anchorOnly=1, temporal=1, place=1)")
    expect(renderPlanningToDraftingContextReport(report)).toContain("sceneContract=1 (shapeCounts=1, dramatic=0, anchorOnly=1, anchors=1)")
    expect(renderPlanningToDraftingContextReport(report)).toContain("Scene contract shape gaps: missingDramatic=1, missingChoice=0, missingFull=0, anchorOnly=1")
    expect(renderPlanningToDraftingContextReport(report)).toContain("ANCHOR-ONLY-SCENE-CONTRACT: scene-1")
  })

  test("summarizes dense and overloaded scene load before drafting", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characters: [{ id: "char-maren", name: "Maren" }],
      outlines: [
        outline(1, { targetWords: 1200, scenes: scenes(10) }),
        outline(2, { targetWords: 1500, scenes: scenes(13) }),
        outline(3, { targetWords: 1500, scenes: scenes(6) }),
      ],
    })

    expect(upstream.sceneLoad.maxScenesPerChapter).toBe(13)
    expect(upstream.sceneLoad.minTargetWordsPerScene).toBeCloseTo(115.38, 2)
    expect(upstream.sceneLoad.overloadedChapterCount).toBe(2)
    expect(upstream.sceneLoad.denseChapterCount).toBe(0)
    expect(upstream.sceneLoad.chapters.map(chapter => chapter.signal)).toEqual([
      "overloaded",
      "overloaded",
      "balanced",
    ])
    expect(upstream.sceneLoad.chapters[0]?.sceneRefs).toEqual([
      "scene-1",
      "scene-2",
      "scene-3",
      "scene-4",
      "scene-5",
      "scene-6",
      "scene-7",
      "scene-8",
      "scene-9",
      "scene-10",
    ])
    const report = buildPlanningToDraftingContextReport({
      novelId: "novel-load",
      upstream,
      writerContext: buildWriterContextTelemetryReport([], "novel-load"),
    })
    expect(renderPlanningToDraftingContextReport(report)).toContain("overloadedChapters=2")
    expect(renderPlanningToDraftingContextReport(report)).toContain("ch2=13sc/115.4wps/overloaded")
  })

  test("flags later scenes that execute a scheduled future event without carrying the temporal anchor", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characters: [{ id: "char-maren", name: "Maren" }],
      outlines: [
        outline(1, {
          establishedFacts: [{
            id: "fact-verification-scheduled",
            fact: "A mandatory Verification test is scheduled for tomorrow at dawn",
            category: "event",
          }],
          scenes: [{
            ...scenes(1)[0]!,
            sceneId: "ch-001-scene-announcement",
            description: "The Arbiter announces a mandatory Verification test scheduled for tomorrow at dawn.",
          }],
        }),
        outline(2, {
          chapterId: "ch-002",
          scenes: [{
            ...scenes(1)[0]!,
            sceneId: "ch-002-scene-verification",
            description: "Cassel activates Verification on the bridge while the crowd watches.",
          }],
        }),
      ],
    })

    expect(upstream.planContinuity.futureEventAnchors).toHaveLength(1)
    expect(upstream.planContinuity.futureEventAnchors[0]).toMatchObject({
      label: "FUTURE-EVENT-ANCHOR-MISSING",
      sourceChapterId: "ch-001",
      targetChapterId: "ch-002",
      targetSceneRef: "ch-002-scene-verification",
      sourceRef: "fact-verification-scheduled",
    })
    const report = buildPlanningToDraftingContextReport({
      novelId: "novel-temporal",
      upstream,
      writerContext: buildWriterContextTelemetryReport([], "novel-temporal"),
    })
    expect(renderPlanningToDraftingContextReport(report)).toContain("Plan continuity: futureEventAnchors=1")
    expect(renderPlanningToDraftingContextReport(report)).toContain("FUTURE-EVENT-ANCHOR-MISSING")
  })

  test("does not flag a later future event scene that carries the declared time cue", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characters: [{ id: "char-maren", name: "Maren" }],
      outlines: [
        outline(1, {
          establishedFacts: [{
            id: "fact-verification-scheduled",
            fact: "A mandatory Verification test is scheduled for tomorrow at dawn",
            category: "event",
          }],
        }),
        outline(2, {
          scenes: [
            {
              ...scenes(1)[0]!,
              sceneId: "ch-002-scene-arrival",
              description: "Maren arrives for the Verification on the bridge.",
              temporalAnchor: "dawn the next morning",
            },
            {
              ...scenes(1)[0]!,
              sceneId: "ch-002-scene-verification",
              description: "Cassel activates Verification on the bridge.",
            },
          ],
        }),
      ],
    })

    expect(upstream.planContinuity.futureEventAnchors).toHaveLength(0)
  })

  test("flags later scenes that reverse an established entity debt status", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characters: [{ id: "char-maren", name: "Maren" }],
      outlines: [
        outline(1, {
          establishedFacts: [{
            id: "fact-corso-file",
            fact: "Foreman Corso is imprisoned for 200 silver thalers, has a wife and two children",
            category: "character",
          }],
        }),
        outline(2, {
          scenes: [{
            ...scenes(1)[0]!,
            sceneId: "ch-002-scene-clean-file",
            description: "Maren reviews the foreman's file, finding it clean of any significant debt or crime.",
          }],
        }),
      ],
    })

    expect(upstream.planContinuity.factContradictions).toHaveLength(1)
    expect(upstream.planContinuity.factContradictions[0]).toMatchObject({
      label: "PLAN-FACT-STATUS-CONTRADICTION",
      severity: "high",
      sourceRef: "fact-corso-file",
      targetSceneRef: "ch-002-scene-clean-file",
      sharedAnchors: ["foreman"],
      conflictTokens: ["clean-record-vs-debt"],
    })
    const report = buildPlanningToDraftingContextReport({
      novelId: "novel-fact-contradiction",
      upstream,
      writerContext: buildWriterContextTelemetryReport([], "novel-fact-contradiction"),
    })
    expect(renderPlanningToDraftingContextReport(report)).toContain("factContradictions=1")
    expect(renderPlanningToDraftingContextReport(report)).toContain("PLAN-FACT-STATUS-CONTRADICTION")
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
      storyRefLineage: "not_available",
      canonFacts: "not_available",
      resolvedReferences: "not_available",
      obligations: "not_available",
      draftingBrief: "not_available",
    })
    expect(report.gaps.map(row => row.surface)).toContain("characterProfiles")
    expect(report.gaps.map(row => row.surface)).toContain("storySpine")
    expect(report.gaps.map(row => row.surface)).not.toContain("storyRefLineage")
  })

  test("separates broad story context from explicit story-ref lineage", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characters: [{ id: "char-maren", name: "Maren" }],
      outlines: [outline(1, {
        scenes: [{
          ...scenes(1)[0]!,
          obligations: {
            mustEstablish: [{
              obligationId: "obl-thread",
              threadId: "thread-court",
              text: "Carry the court pressure forward.",
            }],
            mustPayOff: [],
            mustTransferKnowledge: [],
            mustShowStateChange: [],
            mustNotReveal: [],
            allowedNewEntities: [],
          },
        }],
      })],
    })
    const writerContext = buildWriterContextTelemetryReport([
      row(1, {
        path: "beat",
        stage: "initial",
        writerContextMode: "thread-character-context-v1",
        contextSurface: {
          surfaces: {
            storySpine: false,
          },
          counts: {
            obligations: 1,
          },
        },
        draftingBrief: null,
      }),
    ], "novel-story-lineage")

    const report = buildPlanningToDraftingContextReport({ novelId: "novel-story-lineage", upstream, writerContext })

    expect(statuses(report.surfaces)).toMatchObject({
      storySpine: "covered",
      storyRefLineage: "missing_downstream",
    })
    expect(report.gaps.map(row => row.surface)).toContain("storyRefLineage")
    expect(renderPlanningToDraftingContextReport(report)).toContain("storyRefLineage: missing_downstream; upstream=1; downstream=0")
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
            canonFacts: true,
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
      canonFacts: "represented_without_upstream",
      worldBible: "represented_without_upstream",
    })
    expect(report.gaps.map(row => row.status)).toContain("represented_without_upstream")
  })

  test("separates attempted empty reference lookups from missing downstream context", () => {
    const upstream = summarizePlanningArtifacts({
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characters: [{ id: "char-maren", name: "Maren" }],
      outlines: [outline(1, {
        scenes: [{
          sceneId: "ch-001-scene-002",
          description: "After the riot is suppressed, Maren returns to the ledger.",
          characters: ["Maren"],
          kind: "reaction",
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
      })],
    })
    const writerContext = buildWriterContextTelemetryReport([
      row(1, {
        path: "beat",
        stage: "initial",
        writerContextMode: "thread-character-context-v1",
        characterContext: {
          missingCharacterIds: ["char-prior-riot"],
        },
        contextSurface: {
          surfaces: {
            implicitReferences: true,
            resolvedReferences: false,
          },
          counts: {
            implicitReferenceMarkers: 1,
            referenceLookups: 3,
            referenceLlmCalls: 1,
            missingCharacterIds: 1,
          },
        },
        draftingBrief: null,
      }),
    ], "novel-d")

    const report = buildPlanningToDraftingContextReport({ novelId: "novel-d", upstream, writerContext })

    expect(statuses(report.surfaces)).toMatchObject({
      resolvedReferences: "attempted_no_context",
    })
    expect(report.referenceContextAttempts).toEqual([{
      eventIds: [1],
      eventCount: 1,
      chapter: 1,
      beatIndex: 0,
      stages: ["initial"],
      sceneRef: "ch-001-scene-002",
      descriptionExcerpt: "After the riot is suppressed, Maren returns to the ledger.",
      referenceLookups: 3,
      referenceLlmCalls: 1,
      canonSourceRefs: 0,
      storyRefIds: 0,
      readerInfoStateChars: 0,
      missingCharacterIds: 1,
      missingCharacterIdValues: ["char-prior-riot"],
    }])
    expect(report.gaps.map(row => row.surface)).not.toContain("resolvedReferences")
    expect(renderPlanningToDraftingContextReport(report)).toContain("attempted_no_context")
    expect(renderPlanningToDraftingContextReport(report)).toContain("Reference context attempts: scenes=1, events=1")
    expect(renderPlanningToDraftingContextReport(report)).toContain("REF-ATTEMPT: events=#1 ch1 beat1 stages=initial; scene=ch-001-scene-002; lookups=3; llm=1")
    expect(renderPlanningToDraftingContextReport(report)).toContain("missingChars=1 (char-prior-riot)")
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

function scenes(count: number): NonNullable<ChapterOutline["scenes"]> {
  return Array.from({ length: count }, (_, index) => ({
    sceneId: `scene-${index + 1}`,
    description: `Scene ${index + 1}.`,
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
  }))
}
