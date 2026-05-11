import { expect, test } from "bun:test"

import { buildContext } from "./context"
import type { ChapterOutline, CharacterProfile, SceneBeat, SeedInput, StorySpine, WorldBible } from "../../types"

test("planning-state-mapper context omits scene plan contract guidance when flag is off", () => {
  const context = buildContext({
    targetChapter: chapter(),
    allSkeletons: [chapter()],
    priorChapters: [],
    scenes: [beat({ description: "Istra discovers the plague ledger was altered.", characters: ["Istra"] })],
    worldBible: worldBible(),
    characters: [character()],
    spine: storySpine(),
    seed: seed(),
  })

  expect(context).not.toContain("SCENE PLAN CONTRACT (scenePlanContractV1)")
  expect(context).not.toContain("SELECTIVE SCENE-TURN SHAPING")
  expect(context).not.toContain("materialityTest")
})

test("planning-state-mapper context renders scene plan contract guidance when flag is on", () => {
  const context = buildContext({
    targetChapter: chapter(),
    allSkeletons: [chapter()],
    priorChapters: [],
    scenes: [beat({ description: "Istra discovers the plague ledger was altered.", characters: ["Istra"] })],
    worldBible: worldBible(),
    characters: [character()],
    spine: storySpine(),
    seed: { ...seed(), pipelineOverrides: { scenePlanContractV1: true } },
  })

  expect(context).toContain("SCENE PLAN CONTRACT (scenePlanContractV1)")
  expect(context).toContain("materialityTest")
  expect(context).toContain("complicate")
  expect(context).toContain("escalation")
  expect(context).toContain("payoffEventId")
})

test("planning-state-mapper context renders selective scene-turn obligation guidance", () => {
  const context = buildContext({
    targetChapter: chapter(),
    allSkeletons: [chapter()],
    priorChapters: [],
    scenes: [beat({
      description: "Istra discovers the plague ledger was altered.",
      characters: ["Istra"],
      goal: "Expose who altered the ledger.",
      opposition: "The archive seal makes the false entry look official.",
      outcome: "Istra marks the false entry.",
      consequence: "The council clerk is forced to summon the accused treasurer.",
      povPersonalStake: "Istra fears condemning the wrong person.",
    })],
    worldBible: worldBible(),
    characters: [character()],
    spine: storySpine(),
    seed: { ...seed(), pipelineOverrides: { planningSceneTurnShapingV1: true } },
  })

  expect(context).toContain("SELECTIVE SCENE-TURN SHAPING (planningSceneTurnShapingV1)")
  expect(context).toContain("map facts, knowledge changes, and character-state changes onto obligations")
  expect(context).toContain("Prefer one to three source-refed obligations per scene")
  expect(context).toContain("Do not add obligations for decorative context")
  expect(context).not.toContain("SCENE PLAN CONTRACT (scenePlanContractV1)")
})

test("planning-state-mapper context renders material pressure guidance", () => {
  const context = buildContext({
    targetChapter: chapter(),
    allSkeletons: [chapter()],
    priorChapters: [],
    scenes: [beat({ description: "Istra forces the clerk to honor the archive seal.", characters: ["Istra", "Clerk"] })],
    worldBible: worldBible(),
    characters: [character()],
    spine: storySpine(),
    seed: { ...seed(), pipelineOverrides: { planningMaterialPressureV1: true } },
  })

  expect(context).toContain("MATERIAL PRESSURE (planningMaterialPressureV1)")
  expect(context).toContain("For non-final scenes, every selected source-refed fact, knowledge, or state obligation should include \"materialityTest\"")
  expect(context).toContain("Do not add new obligations to satisfy this")
  expect(context).not.toContain("SCENE PLAN CONTRACT (scenePlanContractV1)")
})

test("planning-state-mapper context carries beat indexes without asking for rewrites", () => {
  const context = buildContext({
    targetChapter: chapter(),
    allSkeletons: [chapter()],
    priorChapters: [],
    scenes: [beat({ description: "Istra discovers the plague ledger was altered.", characters: ["Istra"] })],
    worldBible: worldBible(),
    characters: [character()],
    spine: storySpine(),
    seed: seed(),
  })

  expect(context).toContain("BEATS TO MAP (0-based indexes; do not rewrite descriptions)")
  expect(context).toContain("  0. [action] chars: Istra")
  expect(context).toContain("Istra discovers the plague ledger was altered.")
  expect(context).toContain("Map Chapter 1's end-of-chapter state")
})

test("planning-state-mapper context carries runtime story refs from directives", () => {
  const context = buildContext({
    targetChapter: chapter(),
    allSkeletons: [chapter()],
    priorChapters: [],
    scenes: [beat({ description: "Istra discovers the plague ledger was altered.", characters: ["Istra"] })],
    worldBible: worldBible(),
    characters: [character()],
    spine: storySpine(),
    seed: {
      ...seed(),
      directives: {
        lockedCharacters: [],
        requiredBeats: [],
        forbidden: [],
        tonalAnchors: [],
        structuralConstraints: { povRotation: "", pacing: "" },
        storyThreads: [{ threadId: "thread-ledger-truth", label: "Ledger truth", description: "Istra tracks who falsified the plague ledger.", kind: "" }],
        storyDebts: [{ storyDebtId: "debt-ledger-betrayal", threadId: "thread-ledger-truth", promiseText: "The altered ledger points to a civic betrayal.", payoffPolicy: "" }],
        storyPayoffs: [{ payoffId: "payoff-ledger-betrayal-proved", storyDebtId: "debt-ledger-betrayal", threadId: "thread-ledger-truth", payoffText: "Istra proves who falsified the plague ledger." }],
        rawNotes: "",
      },
    },
  })

  expect(context).toContain("STORY THREADS")
  expect(context).toContain("threadId=thread-ledger-truth")
  expect(context).toContain("promiseId=debt-ledger-betrayal")
  expect(context).toContain("payoffId=payoff-ledger-betrayal-proved")
  expect(context).toContain("STORY REF RULE")
})

function chapter(): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "The Ledger",
    povCharacter: "Istra",
    setting: "The Chancel Archive",
    purpose: "Istra finds evidence of betrayal",
    targetWords: 600,
    charactersPresent: ["Istra"],
    charactersPresentIds: [],
    scenes: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  }
}

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description: "Istra searches the archive.",
    characters: ["Istra"],
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
    ...overrides,
  }
}

function worldBible(): WorldBible {
  return {
    setting: "A plague city",
    timePeriod: "late winter",
    geography: "river delta",
    politicalStructure: "council rule",
    technologyConstraints: "lamps and ledgers",
    socialCustoms: [],
    sensoryPalette: "ink and smoke",
    rules: ["Ledgers are legally binding"],
    locations: [{ name: "The Chancel Archive", description: "A sealed civic archive" }],
    culture: "ledger-bound civic order",
    history: "The plague began after the flood",
    systems: [],
    cultures: [],
  }
}

function character(): CharacterProfile {
  return {
    id: "istra",
    name: "Istra",
    role: "investigator",
    backstory: "Former archivist",
    traits: ["precise"],
    speechPattern: "spare",
    goals: "prove the ledger was falsified",
    fears: "condemning the wrong person",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
  }
}

function storySpine(): StorySpine {
  return {
    acts: [],
    centralConflict: "Truth versus civic stability",
    theme: "Records can become weapons",
    endingDirection: "Istra exposes the falsification",
  }
}

function seed(): SeedInput {
  return {
    premise: "An archivist investigates a plague ledger.",
    genre: "fantasy",
    characters: [],
  }
}
