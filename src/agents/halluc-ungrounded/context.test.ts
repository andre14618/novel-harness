import { test, expect } from "bun:test"
import { buildContext } from "./context"

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
