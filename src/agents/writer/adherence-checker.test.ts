import { expect, test } from "bun:test"

import { characterMentionedInProse } from "./adherence-checker"

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
