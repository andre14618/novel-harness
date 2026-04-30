import { expect, test } from "bun:test"

import { characterMentionedInProse, findMissingCharacterMentions } from "./adherence-checker"
import type { ChapterOutline, SceneBeat } from "../../types"

test("character presence accepts possessive relationship labels with curly apostrophes", () => {
  expect(characterMentionedInProse(
    "Wren's grandmother",
    "Wren’s grandmother gripped the doorframe and whispered a prayer.",
  )).toBe(true)
})

test("character presence does not satisfy possessive relationship labels with owner only", () => {
  expect(characterMentionedInProse(
    "Wren's grandmother",
    "Wren gripped the doorframe and whispered a prayer.",
  )).toBe(false)
})

test("character presence ignores title words when checking titled names", () => {
  expect(characterMentionedInProse("Captain Wren", "The captain waited in the rain.")).toBe(false)
  expect(characterMentionedInProse("Captain Wren", "Wren waited in the rain.")).toBe(true)
})

test("deterministic character presence does not require spelling out the POV character", () => {
  const issues = findMissingCharacterMentions(
    "She walked toward the isolation room door. The handle was cold when she touched it.",
    beat({ characters: ["Istra Vellian"] }),
    outline({ povCharacter: "Istra Vellian" }),
  )

  expect(issues).not.toContain('Character "Istra Vellian" not found in prose')
})

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description: "Istra walks toward the isolation room door.",
    characters: ["Istra Vellian"],
    kind: "action",
    requiredPayoffs: [],
    ...overrides,
  }
}

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Test",
    povCharacter: "Istra Vellian",
    setting: "Clinic",
    purpose: "Test",
    scenes: [],
    targetWords: 1000,
    charactersPresent: ["Istra Vellian"],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}
