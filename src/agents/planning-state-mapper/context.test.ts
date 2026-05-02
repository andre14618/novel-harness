import { expect, test } from "bun:test"

import { buildContext } from "./context"
import type { ChapterOutline, CharacterProfile, SceneBeat, SeedInput, StorySpine, WorldBible } from "../../types"

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
