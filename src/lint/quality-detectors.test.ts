import { test, expect, describe } from "bun:test"
import {
  detectRepetition,
  detectUnderlength,
  detectSyncDefects,
  type QualityDefect,
} from "./quality-detectors"

// ── detectRepetition ────────────────────────────────────────────────────────

describe("detectRepetition", () => {
  test("returns [] for empty string", () => {
    expect(detectRepetition("")).toEqual([])
  })

  test("returns [] for short prose with no repeated n-grams", () => {
    const prose = "The dwarf swung his axe. The elf drew her bow. Silence followed."
    expect(detectRepetition(prose)).toEqual([])
  })

  test("detects bigram repeated exactly 3 times (minCount default)", () => {
    // "dark sword" appears 3 times — should fire at low severity
    const prose =
      "He raised the dark sword high. Then he lowered the dark sword. " +
      "No one had ever wielded a dark sword like this before."
    const defects = detectRepetition(prose)
    const darkSword = defects.find(d => d.metadata?.gram === "dark sword")
    expect(darkSword).toBeDefined()
    expect(darkSword?.kind).toBe("repetition")
    expect(darkSword?.severity).toBe("low")
    expect(darkSword?.metadata?.count).toBe(3)
  })

  test("severity is medium at count=4", () => {
    const prose =
      "cold stone floor cold stone floor cold stone floor cold stone floor and nothing else"
    const defects = detectRepetition(prose)
    const candidate = defects.find(d => (d.metadata?.count as number) >= 4)
    expect(candidate?.severity).toBe("medium")
  })

  test("severity is high at count>=5", () => {
    const repeated = "lost in shadow ".repeat(5)
    const defects = detectRepetition(repeated + "the end")
    const candidate = defects.find(d => (d.metadata?.count as number) >= 5)
    expect(candidate?.severity).toBe("high")
  })

  test("does not flag bigrams below minCount=3 default", () => {
    // "silver coin" appears only twice
    const prose = "He tossed a silver coin to the merchant. Later he found another silver coin."
    const defects = detectRepetition(prose)
    expect(defects.length).toBe(0)
  })

  test("custom minCount=2 catches pairs", () => {
    const prose = "He tossed a silver coin to the merchant. Later he found another silver coin."
    const defects = detectRepetition(prose, { minCount: 2 })
    const found = defects.find(d => d.metadata?.gram === "silver coin")
    expect(found).toBeDefined()
  })

  test("span points to character offset of the first occurrence", () => {
    const prose = "He saw the broken gate. Then the broken gate collapsed entirely."
    const defects = detectRepetition(prose, { minCount: 2 })
    const found = defects.find(d => d.metadata?.gram === "broken gate")
    expect(found?.span).toBeDefined()
    expect(found!.span!.start).toBeGreaterThanOrEqual(0)
    // The first "broken gate" should appear before char 30
    expect(found!.span!.start).toBeLessThan(30)
  })

  test("ch2-b12 known repetition-loop fixture", () => {
    // The known conditioning-floor rotation-arm failure: a dialogue exchange
    // repeating 3+ times in the same beat window.
    const prose = [
      "\"Would it also show false debts?\" she asked.",
      "\"I mean, the power allocations—they don't match the verified marks, see?\"",
      "He paused, considering. \"Would it also show false debts?\"",
      "\"I mean, the power allocations—they don't match the verified marks, see?\" she repeated.",
      "Again she said: \"Would it also show false debts?\"",
      "\"I mean, the power allocations—they don't match the verified marks, see?\" came the echo.",
    ].join(" ")

    const defects = detectRepetition(prose, { minCount: 3 })
    expect(defects.length).toBeGreaterThan(0)

    // "false debts" bigram should appear 3 times
    const falseDebts = defects.find(d => d.metadata?.gram === "false debts")
    expect(falseDebts).toBeDefined()
    expect(falseDebts?.metadata?.count as number).toBeGreaterThanOrEqual(3)

    // All flagged defects should be "repetition" kind
    for (const d of defects) {
      expect(d.kind).toBe("repetition")
    }
  })

  test("n-gram detection only includes bigrams when trigrams disabled", () => {
    const prose = "red iron door red iron door red iron door"
    const bigramOnly = detectRepetition(prose, { trigrams: false })
    const trigramOnly = detectRepetition(prose, { bigrams: false })

    // With bigrams only: "red iron" and "iron door" each appear 3×
    expect(bigramOnly.some(d => (d.metadata?.n as number) === 2)).toBe(true)
    expect(bigramOnly.every(d => (d.metadata?.n as number) === 2)).toBe(true)

    // With trigrams only: "red iron door" appears 3×
    expect(trigramOnly.some(d => (d.metadata?.n as number) === 3)).toBe(true)
    expect(trigramOnly.every(d => (d.metadata?.n as number) === 3)).toBe(true)
  })

  test("description is a human-readable string containing the n-gram and count", () => {
    const prose = "heavy silence fell heavy silence fell heavy silence fell"
    const defects = detectRepetition(prose)
    expect(defects.length).toBeGreaterThan(0)
    for (const d of defects) {
      expect(typeof d.description).toBe("string")
      expect(d.description.length).toBeGreaterThan(0)
      // Should mention the n-gram text
      const gram = d.metadata?.gram as string
      expect(d.description.toLowerCase()).toContain(gram)
    }
  })

  test("defects sorted by count descending", () => {
    // "cold stone" appears 5×, "the floor" appears 3× — cold stone should come first
    const prose =
      "cold stone cold stone cold stone cold stone cold stone the floor the floor the floor"
    const defects = detectRepetition(prose)
    if (defects.length >= 2) {
      for (let i = 0; i < defects.length - 1; i++) {
        expect((defects[i].metadata?.count as number)).toBeGreaterThanOrEqual(
          defects[i + 1].metadata?.count as number
        )
      }
    }
  })

  test("windowWords limits scope — repetition outside window not flagged", () => {
    // "cold rain" appears once in words 1-3, then again at word 600+ (outside default 500-word window)
    const filler = "the wind blew across the empty plain and nothing moved ".repeat(22)
    const prose = "cold rain fell here " + filler + " cold rain again"
    const defects = detectRepetition(prose, { windowWords: 50 })
    // "cold rain" should NOT be caught — 2nd occurrence is outside window
    const found = defects.find(d => d.metadata?.gram === "cold rain")
    expect(found).toBeUndefined()
  })

  test("very short prose (<2 words) returns []", () => {
    expect(detectRepetition("hello")).toEqual([])
    expect(detectRepetition("")).toEqual([])
  })
})

// ── detectUnderlength ────────────────────────────────────────────────────────

describe("detectUnderlength", () => {
  test("returns [] when word count meets default threshold (50)", () => {
    const prose = "word ".repeat(50).trim()
    expect(detectUnderlength(prose)).toEqual([])
  })

  test("returns [] when word count exceeds threshold", () => {
    const prose = "word ".repeat(100).trim()
    expect(detectUnderlength(prose)).toEqual([])
  })

  test("returns one defect when word count is below default threshold", () => {
    const prose = "word ".repeat(49).trim()
    const defects = detectUnderlength(prose)
    expect(defects).toHaveLength(1)
    expect(defects[0].kind).toBe("underlength")
    expect(defects[0].severity).toBe("high")
  })

  test("defect description mentions actual count and minimum", () => {
    const prose = "word ".repeat(10).trim()
    const defects = detectUnderlength(prose)
    expect(defects[0].description).toContain("10")
    expect(defects[0].description).toContain("50")
  })

  test("metadata includes wordCount and minWords", () => {
    const prose = "one two three"
    const defects = detectUnderlength(prose)
    expect(defects[0].metadata?.wordCount).toBe(3)
    expect(defects[0].metadata?.minWords).toBe(50)
  })

  test("custom minWords threshold", () => {
    const prose = "word ".repeat(20).trim()
    expect(detectUnderlength(prose, 100)).toHaveLength(1)
    expect(detectUnderlength(prose, 20)).toHaveLength(0)
    expect(detectUnderlength(prose, 19)).toHaveLength(0)
  })

  test("empty string is flagged", () => {
    const defects = detectUnderlength("")
    expect(defects).toHaveLength(1)
    expect(defects[0].metadata?.wordCount).toBe(0)
  })

  test("whitespace-only string is flagged", () => {
    const defects = detectUnderlength("   \n\t  ")
    expect(defects).toHaveLength(1)
    expect(defects[0].metadata?.wordCount).toBe(0)
  })
})

// ── detectSyncDefects convenience ────────────────────────────────────────────

describe("detectSyncDefects", () => {
  test("combines repetition and underlength results", () => {
    // 10 words, with a repeated bigram → both underlength and repetition
    const prose = "cold iron cold iron cold iron what is this"
    const defects = detectSyncDefects(prose)
    expect(defects.some(d => d.kind === "underlength")).toBe(true)
    expect(defects.some(d => d.kind === "repetition")).toBe(true)
  })

  test("returns [] for prose that passes all sync checks", () => {
    // 80+ unique words, no repeated bigrams or trigrams
    const long =
      "The warrior strode into the chamber and raised her sword to the vaulted ceiling above. " +
      "Dust motes drifted in the amber light filtering through cracked stone. " +
      "She exhaled slowly, scanning the doorway for any sign of movement. " +
      "A cold draft carried the smell of iron and old ash across the floor. " +
      "Her fingers tightened around the hilt as footsteps echoed from the far stairwell."
    const defects = detectSyncDefects(long)
    expect(defects).toHaveLength(0)
  })
})
