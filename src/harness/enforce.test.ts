import { expect, test } from "bun:test"

import { enforcePlanningOutput, validateChapterSequenceGuards } from "./enforce"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../types"

test("planning enforcement drops same-beat payoff links before drafting", () => {
  const outline = chapter({
    scenes: [
      beat({ description: "Istra administers the cure.", requiredPayoffs: [{ fact_id: "cure-works", payoff_beat: 0 }] }),
      beat({ description: "Wren wakes." }),
      beat({ description: "Istra records the result." }),
    ],
    establishedFacts: [{ id: "cure-works", fact: "The cure works immediately", category: "knowledge" }],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")])

  expect(result.valid).toBe(true)
  expect(result.chapters[0].scenes[0].requiredPayoffs).toEqual([])
  expect(result.warnings[0]).toContain("dropped payoff link")
  expect(result.warnings[0]).toContain("non-forward payoff beat 1")
})

test("planning enforcement keeps valid forward payoff links", () => {
  const outline = chapter({
    scenes: [
      beat({ description: "Istra plants a clue.", requiredPayoffs: [{ fact_id: "cure-works", payoff_beat: 1 }] }),
      beat({ description: "Wren wakes." }),
      beat({ description: "Istra records the result." }),
    ],
    establishedFacts: [{ id: "cure-works", fact: "The cure works immediately", category: "knowledge" }],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")])

  expect(result.valid).toBe(true)
  expect(result.chapters[0].scenes[0].requiredPayoffs).toEqual([{ fact_id: "cure-works", payoff_beat: 1 }])
  expect(result.warnings).toEqual([])
})

test("planning enforcement uses calibrated scene count floor", () => {
  const outline = chapter({
    targetWords: 1500,
    scenes: [
      beat({ description: "Istra finds the missing dose." }),
      beat({ description: "Wren refuses the treatment." }),
    ],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")])

  expect(result.valid).toBe(false)
  expect(result.errors).toEqual(["Chapter 1: 2 scene entries below floor 3 for 1500w target"])
})

test("scene contract planning treats word-derived count floor as advisory", () => {
  const outline = chapter({
    targetWords: 1500,
    scenes: [
      beat({ description: "Istra finds the missing dose." }),
      beat({ description: "Wren accepts the cost." }),
    ],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")], {
    nativePlanningContractV1: true,
    scenePlanContractV1: true,
  })

  expect(result.valid).toBe(true)
  expect(result.errors).toEqual([])
  expect(result.warnings).toContain("Chapter 1: 2 scene contracts below rough scope guide 3 for 1500w target")
})

test("planning enforcement accepts a compact 1500 word chapter at four scene entries", () => {
  const outline = chapter({
    targetWords: 1500,
    scenes: [
      beat({ description: "Istra finds the missing dose." }),
      beat({ description: "Wren refuses the treatment." }),
      beat({ description: "Istra proves the danger." }),
      beat({ description: "Wren accepts the cost." }),
    ],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")])

  expect(result.valid).toBe(true)
  expect(result.errors).toEqual([])
})

test("planning enforcement rejects outlines above the planning max override", () => {
  const outline = chapter({
    targetWords: 1500,
    scenes: [
      beat({ description: "Istra finds the missing dose." }),
      beat({ description: "Wren refuses the treatment." }),
      beat({ description: "Istra proves the danger." }),
      beat({ description: "Wren accepts the cost." }),
      beat({ description: "The council arrives." }),
      beat({ description: "Istra locks the ward." }),
    ],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")], { maxScenesPerChapter: 5 })

  expect(result.valid).toBe(false)
  expect(result.errors).toEqual(["Chapter 1: 6 scene entries above planning max 5 for 1500w target"])
})

test("planning enforcement raises a planning max override below the floor", () => {
  const outline = chapter({
    targetWords: 2000,
    scenes: [
      beat({ description: "Istra finds the missing dose." }),
      beat({ description: "Wren refuses the treatment." }),
      beat({ description: "Istra proves the danger." }),
    ],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")], { maxScenesPerChapter: 2 })

  expect(result.valid).toBe(true)
  expect(result.errors).toEqual([])
})

test("planning enforcement rejects over-fragmented native contract outlines without a cap", () => {
  const outline = chapter({
    targetWords: 1500,
    scenes: [
      beat({ description: "Istra finds the missing dose." }),
      beat({ description: "Wren refuses the treatment." }),
      beat({ description: "Istra proves the danger." }),
      beat({ description: "Wren accepts the cost." }),
      beat({ description: "The council arrives." }),
      beat({ description: "Istra locks the ward." }),
      beat({ description: "Wren names the price." }),
    ],
  })

  const legacy = enforcePlanningOutput([outline], 1, [character("Istra Venn")])
  const native = enforcePlanningOutput([outline], 1, [character("Istra Venn")], {
    nativePlanningContractV1: true,
  })

  expect(legacy.valid).toBe(true)
  expect(native.valid).toBe(false)
  expect(native.errors).toEqual([
    "Chapter 1: 7 scene entries above native planning budget 3+1 for 1500w target",
  ])
})

test("scene contract planning treats word-derived overage as advisory", () => {
  const outline = chapter({
    targetWords: 1500,
    scenes: [
      beat({ description: "Istra finds the missing dose." }),
      beat({ description: "Wren refuses the treatment." }),
      beat({ description: "Istra proves the danger." }),
      beat({ description: "Wren accepts the cost." }),
      beat({ description: "The council arrives." }),
      beat({ description: "Istra locks the ward." }),
      beat({ description: "Wren names the price." }),
    ],
  })

  const result = enforcePlanningOutput([outline], 1, [character("Istra Venn")], {
    nativePlanningContractV1: true,
    scenePlanContractV1: true,
  })

  expect(result.valid).toBe(true)
  expect(result.errors).toEqual([])
  expect(result.warnings).toContain("Chapter 1: 7 scene contracts above rough scope guide 3+1 for 1500w target")
})

test("chapter sequence guards reject events that drift into the wrong chapter", () => {
  const outline = chapter({
    purpose: "Maren should only learn the debt pressure.",
    scenes: [
      beat({ description: "Maren finds the risky writ on the board." }),
      beat({ description: "Maren signs the contract before she understands the creditor trap." }),
    ],
  })

  const errors = validateChapterSequenceGuards([outline], {
    lockedCharacters: [],
    requiredBeats: [],
    forbidden: [],
    tonalAnchors: [],
    structuralConstraints: { povRotation: "", pacing: "" },
    storyThreads: [],
    storyDebts: [],
    storyPayoffs: [],
    chapterContracts: [],
    chapterSequenceGuards: [{
      guardId: "ch1-no-signing",
      chapter: 1,
      description: "Signing belongs to chapter 2.",
      mustContainAny: [],
      mustNotContain: ["signs the contract"],
    }],
    rawNotes: "",
  })

  expect(errors).toEqual([
    'Chapter 1 sequence guard ch1-no-signing: forbidden phrase "signs the contract" found in scene 2 description',
  ])
})

test("chapter sequence guards can require a chapter-owned event", () => {
  const outline = chapter({
    chapterNumber: 2,
    purpose: "Maren evaluates the contract but does not make a decision.",
    scenes: [
      beat({ description: "Maren audits the terms." }),
      beat({ description: "The clerk warns that delay will cost her the witness." }),
    ],
  })

  const errors = validateChapterSequenceGuards([outline], {
    lockedCharacters: [],
    requiredBeats: [],
    forbidden: [],
    tonalAnchors: [],
    structuralConstraints: { povRotation: "", pacing: "" },
    storyThreads: [],
    storyDebts: [],
    storyPayoffs: [],
    chapterContracts: [],
    chapterSequenceGuards: [{
      guardId: "ch2-signing",
      chapter: 2,
      description: "Contract decision belongs here.",
      mustContainAny: ["signs the contract", "accepts the contract"],
      mustNotContain: [],
    }],
    rawNotes: "",
  })

  expect(errors).toEqual([
    "Chapter 2 sequence guard ch2-signing: expected at least one phrase but found none: signs the contract; accepts the contract",
  ])
})

test("chapter sequence guards do not treat doesNotKnow as an in-story reveal", () => {
  const outline = chapter({
    characterStateChanges: [{
      id: "state-maren-withheld-truth",
      characterId: "char-maren",
      name: "Maren",
      location: "Counting-House",
      emotionalState: "alert",
      knows: [],
      doesNotKnow: ["The creditor's contract hides an illegal core harvest."],
    }],
  })

  const errors = validateChapterSequenceGuards([outline], {
    lockedCharacters: [],
    requiredBeats: [],
    forbidden: [],
    tonalAnchors: [],
    structuralConstraints: { povRotation: "", pacing: "" },
    storyThreads: [],
    storyDebts: [],
    storyPayoffs: [],
    chapterContracts: [],
    chapterSequenceGuards: [{
      guardId: "no-early-harvest-reveal",
      chapter: 1,
      description: "Hidden truth may exist as withheld knowledge but not as revealed state.",
      mustContainAny: [],
      mustNotContain: ["illegal core harvest"],
    }],
    rawNotes: "",
  })

  expect(errors).toEqual([])
})

test("chapter sequence guards ignore withheld-language mentions in scene fields", () => {
  const outline = chapter({
    scenes: [
      beat({
        description: "Maren marks a safe route through the ward.",
        consequence: "The illegal core harvest remains undiscovered while Maren keeps moving toward the lower door.",
      }),
    ],
  })

  const errors = validateChapterSequenceGuards([outline], {
    lockedCharacters: [],
    requiredBeats: [],
    forbidden: [],
    tonalAnchors: [],
    structuralConstraints: { povRotation: "", pacing: "" },
    storyThreads: [],
    storyDebts: [],
    storyPayoffs: [],
    chapterContracts: [],
    chapterSequenceGuards: [{
      guardId: "no-early-harvest-reveal",
      chapter: 1,
      description: "The harvest should remain hidden.",
      mustContainAny: [],
      mustNotContain: ["illegal core harvest"],
    }],
    rawNotes: "",
  })

  expect(errors).toEqual([])
})

test("chapter sequence guards catch concrete arena entry drift", () => {
  const outline = chapter({
    chapterNumber: 3,
    scenes: [
      beat({
        description: "Maren enters the mine and sees the brine wards flare as a pressurized jet crosses the chamber.",
      }),
    ],
  })

  const errors = validateChapterSequenceGuards([outline], {
    lockedCharacters: [],
    requiredBeats: [],
    forbidden: [],
    tonalAnchors: [],
    structuralConstraints: { povRotation: "", pacing: "" },
    storyThreads: [],
    storyDebts: [],
    storyPayoffs: [],
    chapterContracts: [],
    chapterSequenceGuards: [{
      guardId: "ch3-no-arena-entry",
      chapter: 3,
      description: "Arena entry belongs to chapter 4.",
      mustContainAny: [],
      mustNotContain: ["enters the mine", "brine wards", "pressurized jet"],
    }],
    rawNotes: "",
  })

  expect(errors).toContain(
    'Chapter 3 sequence guard ch3-no-arena-entry: forbidden phrase "enters the mine" found in scene 1 description',
  )
  expect(errors).toContain(
    'Chapter 3 sequence guard ch3-no-arena-entry: forbidden phrase "brine wards" found in scene 1 description',
  )
  expect(errors).toContain(
    'Chapter 3 sequence guard ch3-no-arena-entry: forbidden phrase "pressurized jet" found in scene 1 description',
  )
})

function chapter(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "The Treatment",
    povCharacter: "Istra Venn",
    setting: "The Chancel Infirmary",
    purpose: "Test payoff sanitation",
    targetWords: 300,
    charactersPresent: ["Istra Venn"],
    charactersPresentIds: [],
    scenes: [beat()],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description: "Istra treats Wren.",
    characters: ["Istra Venn"],
    kind: "action",
    requiredPayoffs: [],
    obligations: { mustEstablish: [], mustPayOff: [], mustTransferKnowledge: [], mustShowStateChange: [], mustNotReveal: [], allowedNewEntities: [] },
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  }
}

function character(name: string): CharacterProfile {
  return {
    id: name.toLowerCase().replaceAll(" ", "_"),
    name,
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
  }
}
