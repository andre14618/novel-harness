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

  // ── Validation Mode: Scene Beat Coverage ────────────────────────────────

  describe("scene beat coverage (validation mode)", () => {
    test("beats with keyword matches pass", () => {
      const draft = makeChapterDraft(2500)
      const outline = makeChapterOutline({
        scenes: [
          { description: "Kael drinks alone in a frontier tavern", characters: ["Kael"], emotionalShift: "" },
          { description: "Rina appears at the doorway and warns Kael", characters: ["Kael", "Rina"], emotionalShift: "" },
        ],
      })
      const result = validateChapterDraft(draft, outline, "validation")
      expect(result.blockers.filter(b => b.includes("beat"))).toHaveLength(0)
    })

    test("beat with zero keyword matches is a blocker", () => {
      const draft = makeChapterDraft(2500)
      const outline = makeChapterOutline({
        scenes: [
          { description: "Kael drinks alone in a frontier tavern", characters: ["Kael"], emotionalShift: "" },
          { description: "Dragons swarm the crystalline fortress underwater", characters: ["Kael"], emotionalShift: "" },
        ],
      })
      const result = validateChapterDraft(draft, outline, "validation")
      expect(result.blockers.some(b => b.includes("beat 2"))).toBe(true)
    })

    test("beat checks only run in validation mode", () => {
      const draft = makeChapterDraft(2500)
      const outline = makeChapterOutline({
        scenes: [
          { description: "Dragons swarm the crystalline fortress underwater", characters: ["Kael"], emotionalShift: "" },
        ],
      })
      const result = validateChapterDraft(draft, outline, "drafting")
      expect(result.blockers.filter(b => b.includes("beat"))).toHaveLength(0)
    })
  })

  // ── Validation Mode: POV Pronoun Check ─────────────────────────────────

  describe("POV pronoun check (validation mode)", () => {
    test("third-person prose passes", () => {
      const draft = makeChapterDraft(2500)
      const outline = makeChapterOutline()
      const result = validateChapterDraft(draft, outline, "validation")
      expect(result.warnings.filter(w => w.includes("first-person")).length).toBe(0)
    })

    test("first-person narration outside dialogue warns", () => {
      const words = Array(2500).fill("word").join(" ")
      const draft = `I walked to the gate. I saw Kael there. I felt the wind. I heard Rina speak. I drew my sword. I charged forward. I fell. Rina watched. ${words}`
      const outline = makeChapterOutline()
      const result = validateChapterDraft(draft, outline, "validation")
      expect(result.warnings.some(w => w.includes("first-person"))).toBe(true)
    })

    test("I inside dialogue is not flagged", () => {
      const words = Array(2400).fill("word").join(" ")
      const draft = `Kael spoke. "I will not surrender," she said. "I refuse." Rina replied, "I expected as much." ${words}`
      const outline = makeChapterOutline()
      const result = validateChapterDraft(draft, outline, "validation")
      expect(result.warnings.filter(w => w.includes("first-person")).length).toBe(0)
    })
  })

  // ── Validation Mode: Dialogue Presence ─────────────────────────────────

  describe("dialogue presence (validation mode)", () => {
    test("no dialogue warns", () => {
      const words = Array(2500).fill("word").join(" ")
      const draft = `Kael walked through the desert. Rina followed. ${words}`
      const outline = makeChapterOutline()
      const result = validateChapterDraft(draft, outline, "validation")
      expect(result.warnings.some(w => w.includes("No dialogue"))).toBe(true)
    })

    test("normal dialogue ratio passes", () => {
      const draft = makeChapterDraft(2500)
      const outline = makeChapterOutline()
      const result = validateChapterDraft(draft, outline, "validation")
      expect(result.warnings.filter(w => w.includes("dialogue")).length).toBe(0)
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
