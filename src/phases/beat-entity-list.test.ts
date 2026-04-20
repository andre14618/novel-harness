import { test, expect } from "bun:test"
import { deriveBeatEntities, extractProperNouns } from "./beat-entity-list"

const baseBeat = {
  description: "Kael steps into the chamber.",
  kind: "action" as const,
  characters: ["Kael"],
  requiredPayoffs: [],
} as any

const baseOutline = {
  chapterNumber: 2,
  title: "The Hearth",
  povCharacter: "Kael",
  setting: "The Broken Anchor Tavern",
  purpose: "",
  scenes: [],
  targetWords: 1000,
  charactersPresent: ["Kael"],
  establishedFacts: [
    { id: "", fact: "The Heartstone lies hidden beneath the Iron Spine Garrison.", category: "world" },
    { id: "", fact: "Rynn swore an oath to the Dust Road caravans.", category: "world" },
  ],
  characterStateChanges: [],
  knowledgeChanges: [],
} as any

test("derivedOutlineFact pulls proper nouns from establishedFacts[*].fact", () => {
  const out = deriveBeatEntities(baseBeat, baseOutline)
  // "The Heartstone" surfaces as a multi-word span — the extractor
  // legitimately treats "The X" as a bound name (per the existing
  // 'The Ashen Wastes' test in context.test.ts). Callers that want
  // to dedupe against bible-known entries do so downstream.
  expect(out.sources.derivedOutlineFact).toContain("The Heartstone")
  expect(out.sources.derivedOutlineFact).toContain("Iron Spine Garrison")
  expect(out.sources.derivedOutlineFact).toContain("Rynn")
  expect(out.sources.derivedOutlineFact).toContain("Dust Road")
})

test("derivedPriorBeat pulls proper nouns from prevBeat.description only", () => {
  const prev = {
    description: "Tamsin watched the sky over Baldur's Gate turn green.",
    kind: "action" as const,
    characters: ["Tamsin"],
    requiredPayoffs: [],
  } as any
  const out = deriveBeatEntities(baseBeat, baseOutline, prev)
  expect(out.sources.derivedPriorBeat).toContain("Tamsin")
  expect(out.sources.derivedPriorBeat).toContain("Baldur's Gate")
})

test("union entities list is deduped case-insensitively", () => {
  const outline = {
    ...baseOutline,
    establishedFacts: [
      { id: "", fact: "Rynn entered the Iron Spine Garrison.", category: "world" },
    ],
  }
  const prev = {
    description: "RYNN had last visited the iron spine garrison years ago.",
    kind: "action" as const,
    characters: ["Rynn"],
    requiredPayoffs: [],
  } as any
  const out = deriveBeatEntities(baseBeat, outline, prev)
  // "Rynn" appears in both sources; union should only have it once.
  expect(out.entities.filter(e => e.toLowerCase() === "rynn")).toHaveLength(1)
})

test("empty inputs degrade to empty lists", () => {
  const outline = { ...baseOutline, establishedFacts: [] }
  const out = deriveBeatEntities(baseBeat, outline)
  expect(out.entities).toEqual([])
  expect(out.sources.derivedOutlineFact).toEqual([])
  expect(out.sources.derivedPriorBeat).toEqual([])
})

test("extractProperNouns is re-exported (used by beat-entity-list consumers)", () => {
  expect(extractProperNouns("Kael met Rynn.")).toEqual(["Kael", "Rynn"])
})
