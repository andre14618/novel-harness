import { expect, test } from "bun:test"

import { characterMentionedInProse, findMissingCharacterMentions } from "./adherence-checker"
import type { BeatObligationsContract, ChapterOutline, SceneBeat } from "../../types"

const emptyObligations: BeatObligationsContract = {
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
}

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
  // Cast: SceneBeat is z.infer<typeof sceneBeatSchema>, and obligations is
  // a Zod-inferred shape with `objectOutputType<...>` generics. TypeScript
  // sometimes treats two structurally-identical Zod-inferred types as
  // unrelated when the inference path differs (z.infer reaches the same
  // shape via slightly different generic instantiations). The runtime
  // shape is correct; the cast bypasses the nominal-identity check.
  return {
    description: "Istra walks toward the isolation room door.",
    characters: ["Istra Vellian"],
    kind: "action",
    requiredPayoffs: [],
    obligations: emptyObligations,
    ...overrides,
  } as SceneBeat
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
    charactersPresentIds: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}
