import { test, expect } from "bun:test"
import { regexLeakMatches } from "./regex-leak"

test("catches the top adapter-misses Harpells, Baldur's Gate, Waterdeep", () => {
  expect(regexLeakMatches("The Harpells arrived at dusk.")).toContain("Harpells")
  expect(regexLeakMatches("Important news from Baldur's Gate?")).toContain("Baldur's Gate")
  expect(regexLeakMatches("A caravan bound for Waterdeep.")).toContain("Waterdeep")
})

test("catches canonical IWD trilogy names (characters, places, items)", () => {
  expect(regexLeakMatches("Drizzt and Bruenor crossed Ten-Towns.")).toEqual(
    expect.arrayContaining(["Drizzt", "Bruenor", "Ten-Towns"]),
  )
  expect(regexLeakMatches("Aegis-fang struck the duergar.")).toEqual(
    expect.arrayContaining(["Aegis-fang", "duergar"]),
  )
  expect(regexLeakMatches("The halfling, Rumblebelly, laughed.")).toContain("Rumblebelly")
})

test("case-insensitive but preserves first-appearance casing", () => {
  expect(regexLeakMatches("waterdeep and WATERDEEP and Waterdeep")).toEqual(["waterdeep"])
})

test("word-boundary discipline: drow matches but drowsy does not", () => {
  expect(regexLeakMatches("The drow slipped forward.")).toContain("drow")
  expect(regexLeakMatches("She grew drowsy in the sun.")).toEqual([])
  expect(regexLeakMatches("They would drown in the river.")).toEqual([])
})

test("word-boundary with apostrophe-containing tokens", () => {
  // "Baldur's Gate" must match on plain boundaries, not substring of "Baldur'sy"
  expect(regexLeakMatches("Reached Baldur's Gate by noon.")).toContain("Baldur's Gate")
  // "Do'Urden" must not match "Do'Urdenish" (fake) — boundary should stop at ish
  expect(regexLeakMatches("His name was Do'Urden.")).toContain("Do'Urden")
})

test("multi-word tokens with spaces inside require exact sequence", () => {
  expect(regexLeakMatches("Spine of the World")).toContain("Spine of the World")
  // "Spine" alone shouldn't match — it's not in the token list
  expect(regexLeakMatches("A spine of ice rose from the ground.")).toEqual([])
})

test("empty / whitespace prose returns empty list", () => {
  expect(regexLeakMatches("")).toEqual([])
  expect(regexLeakMatches("   \n ")).toEqual([])
})

test("non-leak prose returns empty list", () => {
  const clean = "Taryn Cross ran her finger along the ledger, measuring each entry with care."
  expect(regexLeakMatches(clean)).toEqual([])
})

test("dedupes across repeated mentions, first-appearance order preserved", () => {
  const out = regexLeakMatches("Drizzt fought. Drizzt won. Bruenor cheered. Drizzt grinned.")
  expect(out).toEqual(["Drizzt", "Bruenor"])
})
