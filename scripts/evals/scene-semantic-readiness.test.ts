import { describe, expect, test } from "bun:test"

import { buildPlanReadinessDraftsFromAggregate } from "../../src/harness/plan-readiness"
import type { SceneSemanticReplayReport } from "./scene-semantic-review"
import {
  buildSceneSemanticReadinessAggregate,
  renderSceneSemanticReadinessAggregate,
} from "./scene-semantic-readiness"

describe("scene-semantic-readiness", () => {
  test("turns low production scene-semantic rows into Plan Readiness-compatible groups", () => {
    const aggregate = buildSceneSemanticReadinessAggregate([{
      report: report(),
      sourceReport: "output/scene-semantic-review/run/scene-semantic-review.json",
    }], { generatedAt: "2026-05-10T00:00:00.000Z" })

    expect(aggregate.groupCount).toBe(1)
    expect(aggregate.findingCount).toBe(2)
    expect(aggregate.groups[0]).toMatchObject({
      fixtureId: "novel-abc",
      armId: "scene-semantic-review:p1:brief",
      unitType: "scene",
      chapterId: "chapter:1",
      sceneId: "scn-001-01",
      sourceIds: {
        obligationIds: ["obl-endpoint"],
        characterIds: ["char-nara"],
        worldFactIds: ["world-key"],
        sceneTurnIds: ["turn-choice"],
        threadIds: ["thread-key"],
        promiseIds: ["debt-key"],
        payoffIds: ["payoff-key"],
      },
      rewritePacket: {
        proposalCandidate: {
          target: {
            kind: "scene_plan",
            ref: "scn-001-01",
            fieldPath: "description",
          },
          sourceAgent: "production-scene-semantic-review",
          safeToAutoApply: false,
        },
      },
    })
    expect(aggregate.groups[0]!.dimensions.sort()).toEqual(["endpointLanding", "sceneDramaturgy"])

    const readiness = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-abc",
      aggregate,
      importedByKind: "test",
    })
    expect(readiness.skipped).toEqual([])
    expect(readiness.drafts).toHaveLength(2)
    expect(readiness.drafts.map(draft => draft.diagnosticLabel).sort()).toEqual(["ENDPOINT-1", "SCENE-1"])
    expect(readiness.drafts[0]!.preserveIds).toMatchObject({
      obligationIds: ["obl-endpoint"],
      characterIds: ["char-nara"],
      worldFactIds: ["world-key"],
      sceneTurnIds: ["turn-choice"],
      threadIds: ["thread-key"],
      promiseIds: ["debt-key"],
      payoffIds: ["payoff-key"],
    })
    expect(readiness.drafts[0]!.preserveIds.worldFactIds).not.toContain("know-key-cost")
    expect(readiness.drafts[0]!.preserveIds.sourceIds).toContain("know-key-cost")
    expect(readiness.drafts[0]!.metadata.proposalCandidate).toMatchObject({
      sourceAgent: "production-scene-semantic-review",
      safeToAutoApply: false,
    })

    const rendered = renderSceneSemanticReadinessAggregate(aggregate)
    expect(rendered).toContain("Target: scene_plan:scn-001-01:description")
    expect(rendered).toContain("Should the scene contract make the endpoint land")
    expect(rendered).toContain("Preserve threads: thread-key")
    expect(rendered).toContain("ENDPOINT-1 endpointLanding")
  })

  test("can narrow readiness candidates by explicit labels", () => {
    const aggregate = buildSceneSemanticReadinessAggregate([{
      report: report(),
      sourceReport: "scene-semantic-review.json",
    }], {
      labels: ["SCENE-1"],
      generatedAt: "2026-05-10T00:00:00.000Z",
    })

    expect(aggregate.groupCount).toBe(1)
    expect(aggregate.findingCount).toBe(1)
    expect(aggregate.groups[0]!.findings[0]!.label).toBe("SCENE-1")
  })

  test("gives character/world materiality findings specific review intents", () => {
    const aggregate = buildSceneSemanticReadinessAggregate([{
      report: {
        ...report(),
        dimensions: ["characterMateriality", "worldFactPressure"],
        results: [
          row("characterMateriality", "MATERIAL-1", 1, "The required character only observes."),
          row("worldFactPressure", "WFACT-1", 1, "The world fact is named but does not constrain action."),
        ],
        summaries: [
          { dimension: "characterMateriality", count: 1, meanOrdinal: 1, lowCount: 1, labelCounts: { "MATERIAL-1": 1 } },
          { dimension: "worldFactPressure", count: 1, meanOrdinal: 1, lowCount: 1, labelCounts: { "WFACT-1": 1 } },
        ],
      },
      sourceReport: "scene-semantic-review.json",
    }], { generatedAt: "2026-05-10T00:00:00.000Z" })

    expect(aggregate.groupCount).toBe(1)
    expect(aggregate.groups[0]!.fixIntents.sort()).toEqual([
      "make_required_character_material_or_remove_requirement",
      "make_world_fact_operational_or_remove_requirement",
    ])

    const readiness = buildPlanReadinessDraftsFromAggregate({
      novelId: "novel-abc",
      aggregate,
      importedByKind: "test",
    })
    expect(readiness.drafts.map(draft => draft.dimension).sort()).toEqual([
      "characterMateriality",
      "worldFactPressure",
    ])
    expect(readiness.drafts.map(draft => draft.fixIntent).sort()).toEqual([
      "make_required_character_material_or_remove_requirement",
      "make_world_fact_operational_or_remove_requirement",
    ])
    expect(readiness.drafts[0]!.preserveIds).toMatchObject({
      characterIds: ["char-nara"],
      worldFactIds: ["world-key"],
    })

    const rendered = renderSceneSemanticReadinessAggregate(aggregate)
    expect(rendered).toContain("make required characters and world facts operational")
    expect(rendered).toContain("Make required characters materially affect")
    expect(rendered).toContain("Make the required world fact constrain")
  })

  test("ignores errored judge rows instead of importing them as lows", () => {
    const source = report()
    source.results = [{
      ...row("endpointLanding", "ERROR", 0, "scene semantic judge failed"),
      error: "DeepSeek deepseek-v4-flash hit max token cap",
      output: {
        label: "ERROR",
        confidence: 0,
        evidence: {},
        gates: {},
        missingForNextLevel: "scene semantic judge failed",
      },
    }]
    source.summaries = []
    const aggregate = buildSceneSemanticReadinessAggregate([{ report: source }])

    expect(aggregate.groupCount).toBe(0)
    expect(aggregate.findingCount).toBe(0)
  })
})

function report(): SceneSemanticReplayReport {
  return {
    generatedAt: "2026-05-10T00:00:00.000Z",
    novelId: "novel-abc",
    setName: "scene-semantic-review:p1:brief",
    chapters: [1],
    live: true,
    model: "deepseek-v4-flash",
    thinking: true,
    promptMode: "evidence-first",
    dimensions: ["endpointLanding", "sceneDramaturgy"],
    taskCount: 3,
    skipCount: 0,
    results: [
      row("endpointLanding", "ENDPOINT-1", 1, "The endpoint needs concrete consequence."),
      row("sceneDramaturgy", "SCENE-1", 1, "The turn and consequence need to be playable."),
      {
        ...row("endpointLanding", "ENDPOINT-3", 3, ""),
        sceneId: "scn-001-02",
        taskId: "ch1-scn-001-02-endpointLanding",
      },
    ],
    skips: [],
    summaries: [
      { dimension: "endpointLanding", count: 2, meanOrdinal: 2, lowCount: 1, labelCounts: { "ENDPOINT-1": 1, "ENDPOINT-3": 1 } },
      { dimension: "sceneDramaturgy", count: 1, meanOrdinal: 1, lowCount: 1, labelCounts: { "SCENE-1": 1 } },
    ],
  }
}

function row(
  dimension: SceneSemanticReplayReport["results"][number]["dimension"],
  label: string,
  ordinal: number,
  missingForNextLevel: string,
): SceneSemanticReplayReport["results"][number] {
  return {
    taskId: `ch1-scn-001-01-${dimension}`,
    chapterNumber: 1,
    sceneIndex: 0,
    sceneId: "scn-001-01",
    legacyBeatId: "beat-001",
    dimension,
    promptMode: "evidence-first",
    excerpt: "CHAPTER 1\nSCENE scn-001-01\nCHAPTER PROSE ...",
    obligationIds: ["obl-endpoint"],
    relevantCharacterIds: ["char-nara"],
    relevantWorldFactIds: ["world-key", "know-key-cost"],
    sceneTurnIds: ["turn-choice"],
    threadIds: ["thread-key"],
    promiseIds: ["debt-key"],
    payoffIds: ["payoff-key"],
    sourceIds: ["world-key", "char-nara", "know-key-cost"],
    label,
    ordinal,
    confidence: 0.81,
    evidenceFields: 2,
    missingForNextLevel,
    output: {
      label,
      confidence: 0.81,
      evidence: {
        finalAction: "Nara decides to take the key.",
        consequence: "The consequence is only implied.",
      },
      gates: {},
      missingForNextLevel,
    },
  }
}
