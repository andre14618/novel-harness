import { describe, expect, test } from "bun:test"

import {
  buildSceneSemanticTasks,
  renderCorpusSemanticReviewReport,
  type CorpusSemanticReviewReport,
} from "./corpus-recreation-semantic-review"

describe("corpus-recreation-semantic-review", () => {
  test("builds scene semantic tasks with applicability skips", () => {
    const built = buildSceneSemanticTasks({
      packet: packet() as any,
      plan: plan() as any,
      chapter: chapter() as any,
      promptMode: "evidence-first",
      dimensions: ["sceneDramaturgy", "motivationSpecificity", "worldFactPressure", "relationshipDelta"],
    })

    expect(built.tasks.map(task => `${task.sceneId}:${task.dimension}`)).toEqual([
      "scene-a:sceneDramaturgy",
      "scene-a:motivationSpecificity",
      "scene-a:worldFactPressure",
      "scene-a:relationshipDelta",
      "scene-b:sceneDramaturgy",
      "scene-b:motivationSpecificity",
    ])
    expect(built.skips).toEqual([
      {
        sceneId: "scene-b",
        sceneIndex: 1,
        dimension: "worldFactPressure",
        reason: "no world-fact sourceId obligation declared for this scene",
      },
      {
        sceneId: "scene-b",
        sceneIndex: 1,
        dimension: "relationshipDelta",
        reason: "no supporting-character sourceId obligation declared for this scene",
      },
    ])
    expect(built.tasks[0]!.excerpt).toContain("SCENE CONTRACT:")
    expect(built.tasks[2]!.relevantWorldFactIds).toEqual(["world-aurora-bells"])
    expect(built.tasks[3]!.relevantCharacterIds).toEqual(["char-tovin-ash"])
  })

  test("renders summaries and low-signal findings", () => {
    const report: CorpusSemanticReviewReport = {
      generatedAt: "2026-05-09T00:00:00.000Z",
      pocDir: "output/poc",
      source: { book: "crystal_shard", chapterLabel: "1" },
      live: false,
      model: "deepseek-v4-flash",
      thinking: false,
      promptMode: "evidence-first",
      dimensions: ["sceneDramaturgy"],
      sceneCount: 1,
      taskCount: 1,
      skipCount: 0,
      results: [{
        taskId: "scene-a:sceneDramaturgy",
        sceneId: "scene-a",
        sceneIndex: 0,
        dimension: "sceneDramaturgy",
        promptMode: "evidence-first",
        excerpt: "x",
        relevantWorldFactIds: [],
        relevantCharacterIds: [],
        obligationIds: [],
        label: "SCENE-1",
        ordinal: 1,
        confidence: 0.7,
        evidenceFields: 2,
        missingForNextLevel: "needs outcome",
        output: {
          label: "SCENE-1",
          confidence: 0.7,
          evidence: { goal: "x" },
          gates: {},
          missingForNextLevel: "needs outcome",
        },
      }],
      skips: [],
      summaries: [{
        dimension: "sceneDramaturgy",
        count: 1,
        meanOrdinal: 1,
        lowCount: 1,
        labelCounts: { "SCENE-1": 1 },
      }],
    }

    const rendered = renderCorpusSemanticReviewReport(report)

    expect(rendered).toContain("Corpus Recreation Semantic Review")
    expect(rendered).toContain("scene-a sceneDramaturgy SCENE-1: needs outcome")
  })
})

function packet() {
  return {
    sourceReference: { book: "crystal_shard", chapterLabel: "1" },
    originalAnalogSeed: {
      conceptId: "analog",
      genreLane: "fantasy",
      premise: "A courier carries a dangerous key.",
      readerPromise: "Frontier fantasy pressure.",
      protagonist: {
        characterId: "char-nara-venn",
        name: "Nara Venn",
        want: "restore her oathmark",
        need: "accept public responsibility",
        lie: "escape can restore honor",
        truth: "honor needs witnesses",
      },
      supportingCharacters: [
        {
          characterId: "char-tovin-ash",
          name: "Tovin Ash",
          role: "rival surveyor",
          pressure: "He offers legal restoration if Nara helps him.",
        },
      ],
      worldFacts: [
        {
          worldFactId: "world-aurora-bells",
          fact: "Aurora bells ring false when an oath-breaker crosses a ward line.",
          operationalUse: "The bells can expose Nara.",
        },
      ],
      storyDebts: [],
    },
  }
}

function plan() {
  return {
    chapterId: "ch1",
    title: "Gate",
    chapterFunction: "Nara reaches the city under pressure.",
    endpointOrHook: "The bells expose her.",
    scenes: [
      {
        sceneId: "scene-a",
        referenceSceneOrdinal: 0,
        targetWords: 500,
        structuralRole: "Gate confrontation.",
        povCharacterId: "char-nara-venn",
        locationOrArena: "gate",
        goal: "Nara wants entry.",
        opposition: "Tovin Ash pressures her to lie.",
        turningPoint: "The aurora bells ring.",
        crisisChoice: "Confess or accept Tovin's bargain.",
        climaxAction: "Nara refuses Tovin.",
        outcome: "The gate guards notice her.",
        consequence: "She is exposed.",
        valueIn: "+",
        valueOut: "-",
        miceThread: "C",
        beatHints: [
          { kind: "action", boundarySignal: "scene_start", gapSize: "medium", purpose: "Nara approaches the gate." },
        ],
      },
      {
        sceneId: "scene-b",
        referenceSceneOrdinal: 1,
        targetWords: 300,
        structuralRole: "Solo recovery.",
        povCharacterId: "char-nara-venn",
        locationOrArena: "stable",
        goal: "Nara binds her burned hand.",
        opposition: "Pain slows her.",
        turningPoint: "She decides to continue.",
        crisisChoice: "Rest or move.",
        climaxAction: "Nara leaves.",
        outcome: "She keeps moving.",
        consequence: "She risks collapse.",
        valueIn: "-",
        valueOut: "+",
        miceThread: "C",
        beatHints: [
          { kind: "interiority", boundarySignal: "scene_start", gapSize: "small", purpose: "Nara chooses endurance." },
        ],
      },
    ],
    obligations: [
      {
        obligationId: "obl-bells",
        sceneId: "scene-a",
        sourceId: "world-aurora-bells",
        requirementText: "The aurora bells expose Nara at the gate.",
      },
      {
        obligationId: "obl-tovin",
        sceneId: "scene-a",
        sourceId: "char-tovin-ash",
        requirementText: "Tovin gains leverage from Nara's exposed lie.",
      },
    ],
  }
}

function chapter() {
  return {
    chapterTitle: "Gate",
    scenes: [
      {
        sceneId: "scene-a",
        prose: "Nara reached the gate with Tovin Ash beside her. The aurora bells rang false when she crossed the ward line.",
      },
      {
        sceneId: "scene-b",
        prose: "Nara wrapped her burned hand and remembered Tovin Ash warning that the aurora bells would betray her.",
      },
    ],
  }
}
