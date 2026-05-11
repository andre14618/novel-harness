import { describe, expect, test } from "bun:test"

import {
  buildPlanningContextReadinessAggregate,
  parseArgs,
  renderPlanningContextReadinessAggregate,
} from "./planning-context-readiness"
import type { PlanningToDraftingContextReport } from "./planning-drafting-context-report"
import { buildPlanReadinessDraftsFromAggregate } from "../../src/harness/plan-readiness"

describe("planning-context-readiness", () => {
  test("parses novel or report inputs", () => {
    expect(parseArgs(["--novel", "n"]).novelId).toBe("n")
    expect(parseArgs(["--report", "context.json", "--include-dense"]).includeDense).toBe(true)
    expect(() => parseArgs([])).toThrow(/--novel or --report/)
  })

  test("turns overloaded scene-load chapters into readiness groups", () => {
    const aggregate = buildPlanningContextReadinessAggregate({
      report: report(),
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(aggregate.groupCount).toBe(1)
    expect(aggregate.findingCount).toBe(1)
    const group = aggregate.groups[0]!
    expect(group.chapterId).toBe("ch-001")
    expect(group.highestSeverity).toBe("high")
    expect(group.findings[0]).toMatchObject({
      label: "SCENE-LOAD-OVERLOADED",
      dimension: "sceneLoad",
      fixIntent: "rebalance_scene_load",
      evidence: {
        sceneRefs: "scene-1,scene-2",
      },
    })
    expect(group.rewritePacket.proposalCandidate).toMatchObject({
      action: "beat_reorder",
      target: {
        kind: "chapter_outline",
        ref: "ch-001",
        fieldPath: "scenes",
      },
      safeToAutoApply: false,
    })
    expect(renderPlanningContextReadinessAggregate(aggregate)).toContain("Should this chapter be split")
  })

  test("includes dense chapters only when requested", () => {
    const base = buildPlanningContextReadinessAggregate({
      report: report(),
      generatedAt: "2026-05-11T00:00:00.000Z",
    })
    const withDense = buildPlanningContextReadinessAggregate({
      report: report(),
      includeDense: true,
      generatedAt: "2026-05-11T00:00:00.000Z",
    })

    expect(base.groups.map(group => group.chapterId)).toEqual(["ch-001"])
    expect(withDense.groups.map(group => group.chapterId)).toEqual(["ch-001", "ch-002"])
    expect(withDense.groups[1]!.findings[0]!.label).toBe("SCENE-LOAD-DENSE")
    expect(withDense.groups[1]!.highestSeverity).toBe("medium")
  })

  test("emits aggregates consumable by the shared readiness importer", () => {
    const aggregate = buildPlanningContextReadinessAggregate({
      report: report(),
      sourceReport: "context.json",
      generatedAt: "2026-05-11T00:00:00.000Z",
    })
    const built = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-load",
      aggregate,
      targetVersions: {
        "chapter_outline:ch-001": "outline-hash-1",
      },
      importedByKind: "script",
      importedByRef: "planning-context-readiness-test",
    })

    expect(built.skipped).toEqual([])
    expect(built.drafts).toHaveLength(1)
    expect(built.drafts[0]).toMatchObject({
      target: { kind: "chapter_outline", ref: "ch-001", fieldPath: "scenes" },
      sourceHash: "outline-hash-1",
      sourceHashKind: "target_current_version",
      diagnosticLabel: "SCENE-LOAD-OVERLOADED",
      dimension: "sceneLoad",
      fixIntent: "rebalance_scene_load",
      severity: "high",
      importedByRef: "planning-context-readiness-test",
      metadata: {
        proposalCandidate: {
          action: "beat_reorder",
          target: { kind: "chapter_outline", ref: "ch-001", fieldPath: "scenes" },
          requiresProposedValue: true,
          proposedValueStatus: "operator_required",
          safeToAutoApply: false,
          sourceAgent: "planning-context-readiness",
        },
      },
    })
  })
})

function report(): PlanningToDraftingContextReport {
  return {
    novelId: "novel-load",
    upstream: {
      worldBibleAvailable: true,
      storySpineAvailable: true,
      characterCount: 3,
      chapterPlanCount: 3,
      plannedSceneCount: 25,
      sceneLoad: {
        maxScenesPerChapter: 10,
        minTargetWordsPerScene: 120,
        denseChapterCount: 1,
        overloadedChapterCount: 1,
        chapters: [
          {
            chapterNumber: 1,
            chapterId: "ch-001",
            sceneRefs: ["scene-1", "scene-2"],
            sceneCount: 10,
            targetWords: 1200,
            targetWordsPerScene: 120,
            signal: "overloaded",
          },
          {
            chapterNumber: 2,
            chapterId: "ch-002",
            sceneRefs: ["scene-11", "scene-12"],
            sceneCount: 9,
            targetWords: 2400,
            targetWordsPerScene: 266.6666667,
            signal: "dense",
          },
          {
            chapterNumber: 3,
            chapterId: "ch-003",
            sceneRefs: ["scene-21"],
            sceneCount: 6,
            targetWords: 1800,
            targetWordsPerScene: 300,
            signal: "balanced",
          },
        ],
      },
      scenesWithCharacters: 25,
      scenesWithSceneIds: 25,
      scenesWithSceneContract: 0,
      scenesWithObligations: 12,
      scenesWithImplicitReferences: 0,
      chaptersWithSetting: 3,
      chaptersWithCharactersPresentIds: 3,
      readerInfoSourceChapters: 2,
      obligationIds: 12,
      obligationSourceRefs: 12,
      activeStoryRefIds: 0,
    },
    downstream: {
      events: 0,
      withCharacterContext: 0,
      withCharacterProfiles: 0,
      withCharacterSnapshots: 0,
      withCharacterContextCapsules: 0,
      withWorldContext: 0,
      withWorldBible: 0,
      withSetting: 0,
      withStoryContext: 0,
      withReaderInfoState: 0,
      withImplicitReferences: 0,
      withResolvedReferences: 0,
      referenceLookups: 0,
      referenceLlmCalls: 0,
      withSceneContract: 0,
      withObligations: 0,
      withDraftingBriefTrace: 0,
    },
    surfaces: [],
    gaps: [],
  }
}
