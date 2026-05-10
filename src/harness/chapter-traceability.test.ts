import { describe, expect, test } from "bun:test"

import { buildPlanningTargetMap } from "./planning-targets"
import {
  buildChapterTraceabilityReport,
  type ChapterTraceabilityCallInput,
  type ChapterTraceabilityEventInput,
} from "./chapter-traceability"
import type { ChapterOutline, SceneBeat } from "../types"

describe("buildChapterTraceabilityReport", () => {
  test("links beats to obligations, source registry, and LLM evidence by durable IDs", () => {
    const outline = chapterOutline()
    const targetMap = buildPlanningTargetMap({
      novelId: "novel-trace-test",
      seed: null,
      world: null,
      characters: [{
        id: "char-istra",
        name: "Istra",
        role: "protagonist",
        backstory: "",
        traits: [],
        speechPattern: "",
        goals: "",
        fears: "",
        relationships: [],
        culturalBackground: [],
        systemAwareness: [],
        exampleLines: [],
      }],
      spine: null,
      outlines: [outline],
      worldSystems: [],
      cultures: [],
      planningSnapshotHash: "a".repeat(64),
    })
    const llmCalls: ChapterTraceabilityCallInput[] = [
      {
        id: 7,
        agent: "beat-writer",
        beatIndex: 0,
        sceneId: "ch-001-ledger-test-scene-001-ledger-verdict-shatters-council",
        beatId: "beat-ledger-verdict",
        attempt: 1,
        failed: false,
        timestamp: "2026-05-05T00:00:00.000Z",
        promptTokens: 100,
        completionTokens: 200,
        requestJson: {
          meta: {
            chapterId: "ch-001-ledger-test",
            sceneId: "ch-001-ledger-test-scene-001-ledger-verdict-shatters-council",
            beatId: "beat-ledger-verdict",
            obligationIds: ["obl-ledger-fact"],
            sourceIds: ["fact-ledger-forgery"],
            characterIds: ["char-istra"],
          },
        },
      },
      {
        id: 8,
        agent: "adherence-checker",
        beatIndex: 0,
        failed: false,
        timestamp: "2026-05-05T00:00:01.000Z",
      },
    ]
    const traceEvents: ChapterTraceabilityEventInput[] = [{
      id: 9,
      eventType: "llm-call-start",
      agent: "beat-writer",
      beatIndex: 0,
      timestamp: "2026-05-05T00:00:00.000Z",
      payload: {
        chapterId: "ch-001-ledger-test",
        sceneId: "ch-001-ledger-test-scene-001-ledger-verdict-shatters-council",
        beatId: "beat-ledger-verdict",
        obligationIds: ["obl-ledger-fact"],
        sourceIds: ["fact-ledger-forgery"],
      },
    }]

    const report = buildChapterTraceabilityReport({
      novelId: "novel-trace-test",
      chapterNumber: 1,
      generatedAt: "2026-05-05T00:00:00.000Z",
      outline,
      targetMap,
      llmCalls,
      traceEvents,
    })

    expect(report.chapterId).toBe("ch-001-ledger-test")
    expect(report.sourceRegistry.map((item) => `${item.kind}:${item.ref}`)).toEqual(
      expect.arrayContaining([
        "world_fact:fact-ledger-forgery",
        "knowledge:know-istra-ledger-forgery",
        "state:state-istra-protective",
        "character:char-istra",
      ]),
    )
    expect(report.summary).toEqual(expect.objectContaining({
      beatCount: 1,
      obligationCount: 3,
      linkedObligationCount: 3,
      missingSourceCount: 0,
      writerCallCount: 1,
      checkerCallCount: 1,
      traceEventCount: 1,
    }))
    const beat = report.beats[0]
    expect(beat.refs).toEqual(expect.arrayContaining([
      { kind: "chapter_outline", ref: "ch-001-ledger-test", label: "Chapter 1: Ledger Test" },
      { kind: "scene_plan", ref: "ch-001-ledger-test-scene-001-ledger-verdict-shatters-council", label: "Chapter 1, scene 1" },
      { kind: "beat_plan", ref: "beat-ledger-verdict" },
    ]))
    expect(beat.upstreamTargets).toEqual(expect.arrayContaining([
      { kind: "chapter_outline", ref: "ch-001-ledger-test" },
      { kind: "world_fact", ref: "fact-ledger-forgery" },
      { kind: "character", ref: "char-istra" },
    ]))
    expect(beat.upstreamTargets).not.toContainEqual({ kind: "character", ref: "know-istra-ledger-forgery" })
    expect(beat.obligations.every((item) => item.sourceFound)).toBe(true)
    expect(beat.llmCalls.map((call) => [call.agent, call.linkEvidence])).toEqual([
      ["beat-writer", "scene_id"],
      ["adherence-checker", "beat_index"],
    ])
    expect(beat.llmCalls[0].metaRefs).toEqual(expect.arrayContaining([
      { kind: "beat_obligation", ref: "obl-ledger-fact" },
      { kind: "source", ref: "fact-ledger-forgery" },
      { kind: "world_fact", ref: "fact-ledger-forgery" },
    ]))
    expect(beat.traceEvents[0].linkEvidence).toBe("payload_scene_id")
    expect(beat.traceEvents[0].refs).toEqual(expect.arrayContaining([
      { kind: "scene_plan", ref: "ch-001-ledger-test-scene-001-ledger-verdict-shatters-council" },
      { kind: "beat_plan", ref: "beat-ledger-verdict" },
      { kind: "beat_obligation", ref: "obl-ledger-fact" },
      { kind: "world_fact", ref: "fact-ledger-forgery" },
    ]))
  })

  test("does not treat character presence as a substitute for exact source IDs", () => {
    const outline = chapterOutline({
      scenes: [{
        ...sceneBeat(),
        obligations: {
          ...sceneBeat().obligations,
          mustTransferKnowledge: [{
            obligationId: "obl-unknown-knowledge",
            sourceId: "know-missing",
            sourceKind: "knowledge",
            characterId: "char-istra",
            characterName: "Istra",
            text: "Istra learns something not present in the source registry.",
          } as any],
        },
      } as SceneBeat],
      knowledgeChanges: [],
    })
    const report = buildChapterTraceabilityReport({
      novelId: "novel-trace-test",
      chapterNumber: 1,
      outline,
      targetMap: buildPlanningTargetMap({
        novelId: "novel-trace-test",
        seed: null,
        world: null,
        characters: [],
        spine: null,
        outlines: [outline],
        worldSystems: [],
        cultures: [],
        planningSnapshotHash: "a".repeat(64),
      }),
    })

    expect(report.summary.obligationCount).toBe(3)
    expect(report.summary.missingSourceCount).toBe(1)
    const missing = report.beats[0].obligations.find((item) => item.sourceId === "know-missing")
    expect(missing?.sourceFound).toBe(false)
    expect(missing?.refs).toEqual(expect.arrayContaining([
      { kind: "knowledge", ref: "know-missing" },
      { kind: "character", ref: "char-istra" },
    ]))
  })

  test("links proposal and mutation evidence by exact target refs only", () => {
    const outline = chapterOutline()
    const report = buildChapterTraceabilityReport({
      novelId: "novel-trace-test",
      chapterNumber: 1,
      outline,
      targetMap: buildPlanningTargetMap({
        novelId: "novel-trace-test",
        seed: null,
        world: null,
        characters: [],
        spine: null,
        outlines: [outline],
        worldSystems: [],
        cultures: [],
        planningSnapshotHash: "a".repeat(64),
      }),
      proposalEnvelopes: [
        // Legacy envelopes still link into the new scene_plan evidence bucket.
        {
          id: "planning-edit:beat",
          kind: "planning_edit",
          targetKind: "beat_plan",
          targetRef: "beat-ledger-verdict",
          targetFieldPath: "description",
          status: "approved",
          risk: "medium",
          summary: "Revise beat description",
          createdAt: "2026-05-05T00:00:00.000Z",
        },
        {
          id: "planning-edit:wrong-kind",
          kind: "planning_edit",
          targetKind: "character",
          targetRef: "beat-ledger-verdict",
          status: "approved",
          risk: "medium",
          summary: "Same value but different target kind",
          createdAt: "2026-05-05T00:00:00.000Z",
        },
      ],
      resolutionImpacts: [{
        id: "impact-1",
        proposalId: "prose-edit:1",
        proposalKind: "prose_edit",
        sourceTable: "proposal_envelopes",
        targetKind: "draft",
        targetRef: "fact-ledger-forgery",
        chapterNumber: 1,
        resolvedAt: "2026-05-05T00:00:00.000Z",
      }],
      checkerObservations: [{
        id: "obs-1",
        proposalId: "prose-edit:1",
        proposalKind: "prose_edit",
        sourceTable: "proposal_envelopes",
        targetKind: "draft",
        targetRef: "fact-ledger-forgery",
        chapterNumber: 1,
        checkerName: "validation",
        fired: true,
        observedAt: "2026-05-05T00:00:00.000Z",
      }],
      mutationLineage: [{
        id: "lineage-1",
        proposalId: "planning-edit:obligation",
        proposalKind: "planning_edit",
        sourceTable: "proposal_envelopes",
        actorKind: "operator",
        targetKind: "beat_obligation",
        previousRef: "obl-ledger-fact",
        nextRef: "obl-ledger-fact",
        fieldPath: "text",
        changedAt: "2026-05-05T00:00:00.000Z",
      }],
    })

    const beat = report.beats[0]
    expect(beat.proposalEvidence[0].target).toEqual({ kind: "beat_plan", ref: "beat-ledger-verdict" })
    expect(beat.proposalEvidence[0].proposalEnvelopes.map((item) => item.id)).toEqual([
      "planning-edit:beat",
    ])
    expect(beat.proposalEvidence[0].proposalEnvelopes.map((item) => item.id)).not.toContain("planning-edit:wrong-kind")

    const factSource = report.sourceRegistry.find((item) => item.kind === "world_fact")
    expect(factSource?.proposalEvidence[0].resolutionImpacts[0].id).toBe("impact-1")
    expect(factSource?.proposalEvidence[0].checkerObservations[0].id).toBe("obs-1")

    const factObligation = beat.obligations.find((item) => item.obligationId === "obl-ledger-fact")
    const obligationEvidence = factObligation?.proposalEvidence.find((item) =>
      item.target.kind === "beat_obligation" && item.target.ref === "obl-ledger-fact"
    )
    expect(obligationEvidence?.mutationLineage[0].id).toBe("lineage-1")
    expect(report.summary).toEqual(expect.objectContaining({
      proposalEnvelopeCount: 1,
      resolutionImpactCount: 1,
      checkerObservationCount: 1,
      mutationLineageCount: 1,
    }))
  })
})

function chapterOutline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-001-ledger-test",
    title: "Ledger Test",
    povCharacter: "Istra",
    povCharacterId: "char-istra",
    setting: "The infirmary",
    purpose: "Reveal the forged ledger.",
    targetWords: 600,
    charactersPresent: ["Istra"],
    charactersPresentIds: ["char-istra"],
    establishedFacts: [
      { id: "fact-ledger-forgery", fact: "The ledger is forged.", category: "knowledge" },
    ],
    knowledgeChanges: [{
      id: "know-istra-ledger-forgery",
      characterId: "char-istra",
      characterName: "Istra",
      knowledge: "The ledger is forged.",
      source: "deduced",
    }],
    characterStateChanges: [{
      id: "state-istra-protective",
      characterId: "char-istra",
      name: "Istra",
      location: "The infirmary",
      emotionalState: "protective",
      knows: ["The ledger is forged."],
      doesNotKnow: [],
    }],
    scenes: [sceneBeat()],
    ...overrides,
  } as ChapterOutline
}

function sceneBeat(): SceneBeat {
  return {
    description: "Ledger verdict shatters the council.",
    characters: ["Istra"],
    kind: "action",
    beatId: "beat-ledger-verdict",
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [{
        obligationId: "obl-ledger-fact",
        sourceId: "fact-ledger-forgery",
        sourceKind: "fact",
        text: "The ledger is forged.",
      } as any],
      mustPayOff: [],
      mustTransferKnowledge: [{
        obligationId: "obl-ledger-knowledge",
        sourceId: "know-istra-ledger-forgery",
        sourceKind: "knowledge",
        characterId: "char-istra",
        characterName: "Istra",
        text: "Istra learns the ledger is forged.",
      } as any],
      mustShowStateChange: [{
        obligationId: "obl-istra-protective",
        sourceId: "state-istra-protective",
        sourceKind: "state",
        characterId: "char-istra",
        characterName: "Istra",
        text: "Istra becomes protective.",
      } as any],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
  } as SceneBeat
}
