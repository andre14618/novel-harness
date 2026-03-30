import { describe, test, expect } from "bun:test"
import { validateChapterDraft } from "../src/validation"
import { makeChapterOutline, makeChapterDraft } from "./helpers"

describe("validateChapterDraft", () => {
  // ── Word Count ─────────────────────────────────────────────────────────

  describe("word count", () => {
    test("< 500 words is a blocker", () => {
      const draft = "Kael walked. Rina watched. The end."
      const outline = makeChapterOutline({ targetWords: 2500 })
      const result = validateChapterDraft(draft, outline)
      expect(result.passed).toBe(false)
      expect(result.blockers.some(b => b.includes("too short"))).toBe(true)
    })

    test("< 50% of target is a blocker", () => {
      // 2500 * 0.5 = 1250. Make a ~1000 word draft
      const words = Array(1000).fill("word").join(" ")
      const draft = `Kael spoke to Rina. ${words}`
      const outline = makeChapterOutline({ targetWords: 2500 })
      const result = validateChapterDraft(draft, outline)
      expect(result.passed).toBe(false)
      expect(result.blockers.some(b => b.includes("far below target"))).toBe(true)
    })

    test("< 70% of target is a warning (not blocker)", () => {
      // 2500 * 0.7 = 1750. Make ~1600 word draft (above 500 and above 50%)
      const words = Array(1590).fill("word").join(" ")
      const draft = `Kael met Rina at the gate. ${words}`
      const outline = makeChapterOutline({ targetWords: 2500 })
      const result = validateChapterDraft(draft, outline)
      expect(result.passed).toBe(true)
      expect(result.warnings.some(w => w.includes("below target"))).toBe(true)
    })

    test("in range passes cleanly", () => {
      const draft = makeChapterDraft(2500)
      const outline = makeChapterOutline({ targetWords: 2500 })
      const result = validateChapterDraft(draft, outline)
      expect(result.passed).toBe(true)
      expect(result.blockers).toHaveLength(0)
    })

    test("> 2x target is a warning", () => {
      const draft = makeChapterDraft(6000)
      const outline = makeChapterOutline({ targetWords: 2500 })
      const result = validateChapterDraft(draft, outline)
      expect(result.passed).toBe(true)
      expect(result.warnings.some(w => w.includes("very long"))).toBe(true)
    })
  })

  // ── Character Checks ───────────────────────────────────────────────────

  describe("character checks", () => {
    test("missing POV character is a blocker", () => {
      const words = Array(2500).fill("word").join(" ")
      const draft = `The stranger walked into the room. Rina watched. ${words}`
      const outline = makeChapterOutline({ povCharacter: "Kael" })
      const result = validateChapterDraft(draft, outline)
      expect(result.passed).toBe(false)
      expect(result.blockers.some(b => b.includes("POV character"))).toBe(true)
    })

    test("listed character not mentioned is a warning", () => {
      const draft = makeChapterDraft(2500) // contains Kael and Rina
      const outline = makeChapterOutline({
        charactersPresent: ["Kael", "Rina", "Moran"],
      })
      const result = validateChapterDraft(draft, outline)
      expect(result.passed).toBe(true)
      expect(result.warnings.some(w => w.includes("Moran"))).toBe(true)
    })

    test("all characters mentioned passes cleanly", () => {
      const draft = makeChapterDraft(2500) // contains Kael and Rina
      const outline = makeChapterOutline({
        charactersPresent: ["Kael", "Rina"],
      })
      const result = validateChapterDraft(draft, outline)
      expect(result.blockers).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })
  })

  // ── Combined ───────────────────────────────────────────────────────────

  describe("combined", () => {
    test("multiple failures reported", () => {
      const draft = "The stranger walked alone." // no Kael, no Rina, too short
      const outline = makeChapterOutline({
        povCharacter: "Kael",
        charactersPresent: ["Kael", "Rina"],
        targetWords: 2500,
      })
      const result = validateChapterDraft(draft, outline)
      expect(result.passed).toBe(false)
      expect(result.blockers.length).toBeGreaterThanOrEqual(2) // too short + missing POV
    })

    test("full pass with good draft", () => {
      const draft = makeChapterDraft(2500)
      const outline = makeChapterOutline()
      const result = validateChapterDraft(draft, outline)
      expect(result.passed).toBe(true)
      expect(result.blockers).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })
  })
})
