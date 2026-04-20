import { test, expect } from "bun:test"
import { buildContext, extractProperNouns } from "./context"

const baseBeat = {
  description: "Kael finds the torn map behind the tavern hearth.",
  kind: "action" as const,
  characters: ["Kael"],
  requiredPayoffs: [],
}

const baseOutline = {
  chapterNumber: 2,
  title: "The Hearth",
  povCharacter: "Kael",
  setting: "The Broken Anchor Tavern",
  purpose: "",
  scenes: [],
  targetWords: 1000,
  charactersPresent: ["Kael", "Meera"],
  establishedFacts: [],
  characterStateChanges: [],
  knowledgeChanges: [],
} as any

const baseChars = [
  { id: "kael", name: "Kael", role: "", speechPattern: "clipped, wry" },
  { id: "meera", name: "Meera", role: "", speechPattern: "deferential" },
  { id: "not_in_beat", name: "Doran", role: "", speechPattern: "booming" },
] as any

const baseWorldBible = {
  locations: [{ name: "The Broken Anchor" }, { name: "Lowport" }],
  cultures: [{ name: "Coast-born" }],
  systems: [{ name: "Tide-calling" }],
  rules: ["A rule that should NOT render"],
}

test("renders the four required blocks in order", () => {
  const out = buildContext("He leaned close.", baseBeat as any, baseOutline, baseChars, baseWorldBible)
  const briefIdx = out.indexOf("BEAT BRIEF:")
  const wbIdx = out.indexOf("WORLD BIBLE")
  const speakersIdx = out.indexOf("SPEAKERS:")
  const proseIdx = out.indexOf("PROSE TO CHECK:")
  expect(briefIdx).toBeGreaterThanOrEqual(0)
  expect(wbIdx).toBeGreaterThan(briefIdx)
  expect(speakersIdx).toBeGreaterThan(wbIdx)
  expect(proseIdx).toBeGreaterThan(speakersIdx)
})

test("SPEAKERS section includes only beat.characters", () => {
  const out = buildContext("x", baseBeat as any, baseOutline, baseChars, baseWorldBible)
  expect(out).toContain("Kael: clipped, wry")
  expect(out).not.toContain("Meera:")
  expect(out).not.toContain("Doran:")
})

test("WORLD BIBLE block renders names only — no descriptions or rules", () => {
  const out = buildContext("x", baseBeat as any, baseOutline, baseChars, baseWorldBible)
  expect(out).toContain("The Broken Anchor")
  expect(out).toContain("Coast-born")
  expect(out).toContain("Tide-calling")
  expect(out).not.toContain("A rule that should NOT render")
})

test("missing world-bible sections degrade gracefully", () => {
  const wb = {}
  const out = buildContext("x", baseBeat as any, baseOutline, baseChars, wb)
  expect(out).toContain("Locations: (none)")
  expect(out).toContain("Cultures:  (none)")
  expect(out).toContain("Systems:   (none)")
})

test("PROSE TO CHECK section carries prose verbatim at the end", () => {
  const prose = "She lit the lamp. It guttered."
  const out = buildContext(prose, baseBeat as any, baseOutline, baseChars, baseWorldBible)
  expect(out.endsWith(prose)).toBe(true)
})

test("extractProperNouns: picks single- and multi-word proper nouns, filters stopwords", () => {
  const text = "Kael cryptically hints that the war is fueled by a cursed artifact called the Heartstone, which drains the land."
  const names = extractProperNouns(text)
  expect(names).toContain("Kael")
  expect(names).toContain("Heartstone")
  expect(names).not.toContain("The")
  expect(names).not.toContain("She")
})

test("extractProperNouns: picks multi-word spans with connectors", () => {
  const names = extractProperNouns("Tamsin rode along the Dust Road from Baldur's Gate to the Spine of the World.")
  expect(names).toContain("Tamsin")
  expect(names).toContain("Dust Road")
  expect(names).toContain("Baldur's Gate")
  expect(names).toContain("Spine of the World")
})

test("extractProperNouns: dedupes", () => {
  const names = extractProperNouns("Heartstone corrupts leaders. The Heartstone hums.")
  expect(names.filter(n => n === "Heartstone")).toHaveLength(1)
})

test("buildContext: From-brief line surfaces brief-only proper nouns and dedupes against world bible", () => {
  const beat = {
    description: "Kael cryptically hints that the war is fueled by a cursed artifact called the Heartstone.",
    kind: "dialogue" as const,
    characters: ["Kael"],
    requiredPayoffs: [],
  } as any
  const outline = { ...baseOutline, setting: "The Broken Anchor" }
  const out = buildContext("prose", beat, outline, baseChars, baseWorldBible)
  expect(out).toContain("From-brief:")
  expect(out).toContain("Heartstone")
  // "The Broken Anchor" is already in the bible Locations list — don't duplicate into From-brief
  const fromBriefLine = out.split("\n").find(l => l.trim().startsWith("From-brief:")) ?? ""
  expect(fromBriefLine).not.toContain("The Broken Anchor")
})

test("buildContext: From-brief line renders '(none)' when brief has no proper nouns", () => {
  const beat = {
    description: "she ran toward him in the dark.",
    kind: "action" as const,
    characters: ["Kael"],
    requiredPayoffs: [],
  } as any
  const outline = { ...baseOutline, setting: "" }
  const out = buildContext("prose", beat, outline, baseChars, { locations: [], cultures: [], systems: [] })
  // Kael is in beat.characters so it's in bibleKnown; should be excluded from From-brief.
  expect(out).toContain("From-brief: (none)")
})
