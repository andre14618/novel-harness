import { describe, expect, test } from "bun:test"
import {
  applicabilitySkipReason,
  buildSceneSemanticReplayTasks,
  parseArgs,
} from "./scene-semantic-review"
import type { ChapterOutline } from "../../src/types"

function chapter(num: number, scenesData: Array<Record<string, unknown>>, opts: Partial<ChapterOutline> = {}): {
  chapterNumber: number
  outline: ChapterOutline
  prose: string
  wordCount: number
  draftVersion: number
  sceneProseBySceneId: Map<string, string>
} {
  return {
    chapterNumber: num,
    outline: {
      chapterNumber: num,
      title: opts.title ?? `Chapter ${num}`,
      povCharacter: opts.povCharacter ?? "Mira",
      setting: opts.setting ?? "Moonwell Archive",
      purpose: opts.purpose ?? "exposition",
      targetWords: opts.targetWords ?? 1500,
      charactersPresent: opts.charactersPresent ?? ["Mira"],
      charactersPresentIds: opts.charactersPresentIds ?? [],
      scenes: scenesData as ChapterOutline["scenes"],
      establishedFacts: opts.establishedFacts ?? [],
      characterStateChanges: opts.characterStateChanges ?? [],
      knowledgeChanges: opts.knowledgeChanges ?? [],
    } as ChapterOutline,
    prose: opts.purpose === "empty" ? "" : "Mira walked into the archive. The lantern was already lit, and Renn looked up.",
    wordCount: 18,
    draftVersion: 1,
    sceneProseBySceneId: new Map(),
  }
}

describe("scene-semantic-review parseArgs", () => {
  test("uses quality-packet token headroom by default", () => {
    const args = parseArgs(["--novel-id", "novel-1"])

    expect(args.maxTokens).toBe(8000)
  })

  test("allows explicit max-token override", () => {
    const args = parseArgs(["--novel-id", "novel-1", "--max-tokens", "12000"])

    expect(args.maxTokens).toBe(12000)
  })
})

describe("scene-semantic-review applicability skip", () => {
  test("threadProgression skips when no threadId obligation declared", () => {
    expect(applicabilitySkipReason("threadProgression", { worldFactCount: 0, characterCount: 0, threadRefCount: 0, promiseOrPayoffRefCount: 0 })).toContain("threadId")
  })
  test("threadProgression keeps when threadId obligation present", () => {
    expect(applicabilitySkipReason("threadProgression", { worldFactCount: 0, characterCount: 0, threadRefCount: 1, promiseOrPayoffRefCount: 0 })).toBeNull()
  })
  test("worldFactPressure skips with no world facts", () => {
    expect(applicabilitySkipReason("worldFactPressure", { worldFactCount: 0, characterCount: 2, threadRefCount: 1, promiseOrPayoffRefCount: 1 })).toContain("world-fact")
  })
  test("relationshipDelta skips with no characters", () => {
    expect(applicabilitySkipReason("relationshipDelta", { worldFactCount: 5, characterCount: 0, threadRefCount: 1, promiseOrPayoffRefCount: 1 })).toContain("supporting-character")
  })
  test("relationshipDelta skips with only one distinct character id", () => {
    expect(applicabilitySkipReason("relationshipDelta", {
      worldFactCount: 5,
      characterCount: 2,
      relationshipParticipantCount: 1,
      threadRefCount: 1,
      promiseOrPayoffRefCount: 1,
    })).toContain("fewer than two")
  })
  test("relationshipDelta keeps when two distinct character ids are declared", () => {
    expect(applicabilitySkipReason("relationshipDelta", {
      worldFactCount: 0,
      characterCount: 2,
      relationshipParticipantCount: 2,
      threadRefCount: 0,
      promiseOrPayoffRefCount: 0,
    })).toBeNull()
  })
  test("sceneDramaturgy never skips on applicability counts", () => {
    expect(applicabilitySkipReason("sceneDramaturgy", { worldFactCount: 0, characterCount: 0, threadRefCount: 0, promiseOrPayoffRefCount: 0 })).toBeNull()
  })
})

describe("scene-semantic-review task building", () => {
  test("emits one task per (scene, dimension) when applicability passes", () => {
    const ch = chapter(3, [
      {
        sceneId: "ch3-s1",
        beatId: "ch3-b1",
        description: "Mira finds the ledger.",
        characters: ["Mira"],
        kind: "action",
        requiredPayoffs: [],
        obligations: {
          mustEstablish: [{
            obligationId: "obl-001", sourceId: "fact-ledger", sourceKind: "fact",
            text: "Ledger discovered hidden under glass.", worldFactId: "fact-ledger",
          }],
          mustPayOff: [],
          mustTransferKnowledge: [{
            obligationId: "obl-know", sourceId: "know-mira-ledger-cost", sourceKind: "knowledge",
            text: "Mira learns what the ledger cost.",
          }],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      },
    ])

    const result = buildSceneSemanticReplayTasks({
      chapters: [ch],
      dimensions: ["sceneDramaturgy", "worldFactPressure"],
      promptMode: "evidence-first",
    })

    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.map(t => t.dimension).sort()).toEqual(["sceneDramaturgy", "worldFactPressure"])
    expect(result.skips).toHaveLength(0)
    expect(result.tasks[0]?.sceneId).toBe("ch3-s1")
    expect(result.tasks[0]?.legacyBeatId).toBe("ch3-b1")
    expect(result.tasks[0]?.relevantWorldFactIds).toContain("fact-ledger")
    expect(result.tasks[0]?.relevantWorldFactIds).not.toContain("know-mira-ledger-cost")
    expect(result.tasks[0]?.sourceIds).toContain("know-mira-ledger-cost")
  })

  test("records applicability skips for inapplicable dimensions", () => {
    const ch = chapter(1, [
      {
        sceneId: "ch1-s1",
        beatId: "ch1-b1",
        description: "Mira opens her ledger and stares at the lantern.",
        characters: ["Mira"],
        kind: "action",
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
      },
    ])

    const result = buildSceneSemanticReplayTasks({
      chapters: [ch],
      dimensions: ["threadProgression", "promisePayoff", "worldFactPressure"],
      promptMode: "evidence-first",
    })

    expect(result.tasks).toHaveLength(0)
    expect(result.skips).toHaveLength(3)
    const dimensionsSkipped = result.skips.map(s => s.dimension).sort()
    expect(dimensionsSkipped).toEqual(["promisePayoff", "threadProgression", "worldFactPressure"])
    expect(result.skips[0]?.sceneId).toBe("ch1-s1")
  })

  test("skips relationshipDelta for solo character-state scenes", () => {
    const ch = chapter(2, [
      {
        sceneId: "ch2-solo",
        beatId: "ch2-b1",
        description: "Mira decides to burn the ledger alone.",
        characters: ["Mira"],
        kind: "interiority",
        requiredPayoffs: [],
        obligations: {
          mustEstablish: [],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [{
            obligationId: "obl-state",
            sourceId: "state-mira-resolve",
            sourceKind: "state",
            characterId: "char-mira",
            text: "Mira resolves to burn the ledger.",
          }],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      },
    ])

    const result = buildSceneSemanticReplayTasks({
      chapters: [ch],
      dimensions: ["characterMateriality", "relationshipDelta"],
      promptMode: "evidence-first",
    })

    expect(result.tasks.map(task => task.dimension)).toEqual(["characterMateriality"])
    expect(result.skips).toMatchObject([{
      sceneId: "ch2-solo",
      dimension: "relationshipDelta",
      reason: expect.stringContaining("fewer than two"),
    }])
  })

  test("excerpt names the chapter, scene contract, and prose", () => {
    const ch = chapter(7, [
      {
        sceneId: "ch7-s2",
        beatId: "ch7-b2",
        description: "Renn confronts the council.",
        characters: ["Renn", "Council"],
        kind: "dialogue",
        goal: "win the council's vote",
        opposition: "the steward blocks the agenda",
        turningPoint: "renn names the missing ledger",
        crisisChoice: "expose the steward or yield",
        outcome: "council demands a vote",
        consequence: "renn is now a target",
        povPersonalStake: "his sister's life depends on this seat",
        valueIn: "powerless",
        valueOut: "exposed",
        miceThread: "I",
        requiredPayoffs: [],
        obligations: {
          mustEstablish: [],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [{
            obligationId: "obl-renn-002", sourceId: "state-renn-exposed", sourceKind: "state",
            text: "Renn publicly committed against the steward.", characterId: "char-renn",
          }],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      },
    ])

    const result = buildSceneSemanticReplayTasks({
      chapters: [ch],
      dimensions: ["sceneDramaturgy"],
      promptMode: "evidence-first",
    })

    expect(result.tasks).toHaveLength(1)
    const excerpt = result.tasks[0]!.excerpt
    expect(excerpt).toContain("CHAPTER 7")
    expect(excerpt).toContain("Scene id: ch7-s2")
    expect(excerpt).toContain("Legacy/beat-specific beat id: ch7-b2")
    expect(excerpt).toContain("Goal: win the council's vote")
    expect(excerpt).toContain("Crisis choice: expose the steward or yield")
    expect(excerpt).toContain("Declared scene endpoint: Outcome: council demands a vote Consequence: renn is now a target")
    expect(excerpt).toContain("For endpointLanding, use the declared scene endpoint above.")
    expect(excerpt).toContain("APPLICABILITY TARGETS:")
    expect(excerpt).toContain("characterMateriality targets: char-renn (char-renn, state-renn-exposed)")
    expect(excerpt).toContain("Judge characterMateriality only against declared characterId")
    expect(excerpt).toContain("CHAPTER PROSE")
    expect(excerpt).toContain("Mira walked into the archive")
    expect(result.tasks[0]?.proseSource).toBe("chapter_draft")
  })

  test("excerpt prefers captured per-scene writer prose over whole chapter prose", () => {
    const ch = chapter(8, [
      {
        sceneId: "ch8-s1",
        description: "Mira refuses the archivist's bargain.",
        characters: ["Mira"],
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
      },
    ])
    ch.sceneProseBySceneId.set(
      "ch8-s1",
      "Mira closed the archive ledger and refused to sign. The archivist barred the door.",
    )

    const result = buildSceneSemanticReplayTasks({
      chapters: [ch],
      dimensions: ["endpointLanding"],
      promptMode: "evidence-first",
    })

    expect(result.tasks).toHaveLength(1)
    const task = result.tasks[0]!
    expect(task.proseSource).toBe("scene_writer_call")
    expect(task.excerpt).toContain("SCENE PROSE")
    expect(task.excerpt).toContain("Mira closed the archive ledger")
    expect(task.excerpt).not.toContain("Mira walked into the archive")
  })
})
