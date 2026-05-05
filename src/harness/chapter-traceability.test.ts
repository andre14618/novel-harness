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
        beatId: "beat-ledger-verdict",
        attempt: 1,
        failed: false,
        timestamp: "2026-05-05T00:00:00.000Z",
        promptTokens: 100,
        completionTokens: 200,
        requestJson: {
          meta: {
            chapterId: "ch-001-ledger-test",
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
      { kind: "beat_plan", ref: "beat-ledger-verdict", label: "Chapter 1, beat 1" },
    ]))
    expect(beat.upstreamTargets).toEqual(expect.arrayContaining([
      { kind: "chapter_outline", ref: "ch-001-ledger-test" },
      { kind: "world_fact", ref: "fact-ledger-forgery" },
      { kind: "character", ref: "char-istra" },
    ]))
    expect(beat.upstreamTargets).not.toContainEqual({ kind: "character", ref: "know-istra-ledger-forgery" })
    expect(beat.obligations.every((item) => item.sourceFound)).toBe(true)
    expect(beat.llmCalls.map((call) => [call.agent, call.linkEvidence])).toEqual([
      ["beat-writer", "beat_id"],
      ["adherence-checker", "beat_index"],
    ])
    expect(beat.llmCalls[0].metaRefs).toEqual(expect.arrayContaining([
      { kind: "beat_obligation", ref: "obl-ledger-fact" },
      { kind: "source", ref: "fact-ledger-forgery" },
    ]))
    expect(beat.traceEvents[0].linkEvidence).toBe("payload_beat_id")
    expect(beat.traceEvents[0].refs).toEqual(expect.arrayContaining([
      { kind: "beat_plan", ref: "beat-ledger-verdict" },
      { kind: "beat_obligation", ref: "obl-ledger-fact" },
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
