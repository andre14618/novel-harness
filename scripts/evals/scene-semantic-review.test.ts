import { describe, expect, test } from "bun:test"
import {
  applicabilitySkipReason,
  buildSceneSemanticReplayTasks,
} from "./scene-semantic-review"
import type { ChapterOutline } from "../../src/types"

function chapter(num: number, scenesData: Array<Record<string, unknown>>, opts: Partial<ChapterOutline> = {}): {
  chapterNumber: number
  outline: ChapterOutline
  prose: string
  wordCount: number
  draftVersion: number
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
  }
}

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
  test("sceneDramaturgy never skips on applicability counts", () => {
    expect(applicabilitySkipReason("sceneDramaturgy", { worldFactCount: 0, characterCount: 0, threadRefCount: 0, promiseOrPayoffRefCount: 0 })).toBeNull()
  })
})

describe("scene-semantic-review task building", () => {
  test("emits one task per (scene, dimension) when applicability passes", () => {
    const ch = chapter(3, [
      {
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
      dimensions: ["sceneDramaturgy", "worldFactPressure"],
      promptMode: "evidence-first",
    })

    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.map(t => t.dimension).sort()).toEqual(["sceneDramaturgy", "worldFactPressure"])
    expect(result.skips).toHaveLength(0)
    expect(result.tasks[0]?.beatId).toBe("ch3-b1")
    expect(result.tasks[0]?.relevantWorldFactIds).toContain("fact-ledger")
  })

  test("records applicability skips for inapplicable dimensions", () => {
    const ch = chapter(1, [
      {
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
  })

  test("excerpt names the chapter, scene contract, and prose", () => {
    const ch = chapter(7, [
      {
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
    expect(excerpt).toContain("Goal: win the council's vote")
    expect(excerpt).toContain("Crisis choice: expose the steward or yield")
    expect(excerpt).toContain("CHAPTER PROSE")
    expect(excerpt).toContain("Mira walked into the archive")
  })
})
