import { describe, test, expect } from "bun:test"
import {
  worldBibleSchema, characterProfileSchema, characterProfilesSchema,
  storySpineSchema, chapterOutlineSchema, chapterOutlinesSchema,
  chapterDraftSchema, continuityCheckSchema, chapterSummarySchema,
  factExtractionSchema, characterStateUpdateSchema,
} from "../src/types"
import { makeWorldBible, makeCharacterProfile, makeStorySpine, makeChapterOutline } from "./helpers"

// ── World Bible ────────────────────────────────────────────────────────────

describe("worldBibleSchema", () => {
  test("accepts valid world bible", () => {
    const result = worldBibleSchema.safeParse(makeWorldBible())
    expect(result.success).toBe(true)
  })

  test("rejects missing rules", () => {
    const { rules, ...rest } = makeWorldBible()
    expect(worldBibleSchema.safeParse(rest).success).toBe(false)
  })

  test("rejects locations with missing name", () => {
    const wb = makeWorldBible()
    wb.locations = [{ description: "a place" } as any]
    expect(worldBibleSchema.safeParse(wb).success).toBe(false)
  })

  test("rejects setting as number", () => {
    const wb = { ...makeWorldBible(), setting: 42 }
    expect(worldBibleSchema.safeParse(wb).success).toBe(false)
  })
})

// ── Character Profile ──────────────────────────────────────────────────────

describe("characterProfileSchema", () => {
  test("accepts valid profile", () => {
    expect(characterProfileSchema.safeParse(makeCharacterProfile()).success).toBe(true)
  })

  test("rejects traits as string instead of array", () => {
    const p = { ...makeCharacterProfile(), traits: "brave" }
    expect(characterProfileSchema.safeParse(p).success).toBe(false)
  })

  test("rejects missing id", () => {
    const { id, ...rest } = makeCharacterProfile()
    expect(characterProfileSchema.safeParse(rest).success).toBe(false)
  })

  test("rejects relationships missing characterName", () => {
    const p = makeCharacterProfile()
    p.relationships = [{ nature: "friend" } as any]
    expect(characterProfileSchema.safeParse(p).success).toBe(false)
  })
})

describe("characterProfilesSchema", () => {
  test("accepts characters array", () => {
    const result = characterProfilesSchema.safeParse({ characters: [makeCharacterProfile()] })
    expect(result.success).toBe(true)
  })

  test("rejects when characters is not an array", () => {
    expect(characterProfilesSchema.safeParse({ characters: "nope" }).success).toBe(false)
  })

  test("rejects missing characters key", () => {
    expect(characterProfilesSchema.safeParse({}).success).toBe(false)
  })
})

// ── Story Spine ────────────────────────────────────────────────────────────

describe("storySpineSchema", () => {
  test("accepts valid spine", () => {
    expect(storySpineSchema.safeParse(makeStorySpine()).success).toBe(true)
  })

  test("rejects missing centralConflict", () => {
    const { centralConflict, ...rest } = makeStorySpine()
    expect(storySpineSchema.safeParse(rest).success).toBe(false)
  })

  test("rejects acts missing number", () => {
    const spine = makeStorySpine()
    spine.acts = [{ name: "Act 1", summary: "stuff", emotionalArc: "rising" } as any]
    expect(storySpineSchema.safeParse(spine).success).toBe(false)
  })
})

// ── Chapter Outline ────────────────────────────────────────────────────────

describe("chapterOutlineSchema", () => {
  test("accepts valid outline", () => {
    expect(chapterOutlineSchema.safeParse(makeChapterOutline()).success).toBe(true)
  })

  test("accepts scenes missing emotionalShift (has default)", () => {
    const o = makeChapterOutline()
    o.scenes = [{ description: "stuff", characters: ["Kael"] } as any]
    expect(chapterOutlineSchema.safeParse(o).success).toBe(true)
  })

  test("rejects chapterNumber as string", () => {
    const o = { ...makeChapterOutline(), chapterNumber: "one" }
    expect(chapterOutlineSchema.safeParse(o).success).toBe(false)
  })
})

describe("chapterOutlinesSchema", () => {
  test("accepts chapters array", () => {
    const result = chapterOutlinesSchema.safeParse({ chapters: [makeChapterOutline()] })
    expect(result.success).toBe(true)
  })

  test("rejects missing chapters", () => {
    expect(chapterOutlinesSchema.safeParse({}).success).toBe(false)
  })
})

// ── Chapter Draft ──────────────────────────────────────────────────────────

describe("chapterDraftSchema", () => {
  test("accepts valid draft", () => {
    expect(chapterDraftSchema.safeParse({ prose: "Once upon a time..." }).success).toBe(true)
  })

  test("rejects missing prose", () => {
    expect(chapterDraftSchema.safeParse({}).success).toBe(false)
  })

  test("rejects prose as number", () => {
    expect(chapterDraftSchema.safeParse({ prose: 42 }).success).toBe(false)
  })
})

// ── Continuity Check ───────────────────────────────────────────────────────

describe("continuityCheckSchema", () => {
  test("accepts empty issues array", () => {
    expect(continuityCheckSchema.safeParse({ issues: [] }).success).toBe(true)
  })

  test("accepts valid issue", () => {
    const result = continuityCheckSchema.safeParse({
      issues: [{ severity: "blocker", description: "Kael is in two places" }],
    })
    expect(result.success).toBe(true)
  })

  test("accepts issue with optional fields", () => {
    const result = continuityCheckSchema.safeParse({
      issues: [{
        severity: "warning",
        description: "Timeline unclear",
        conflictsWith: "Chapter 2 states it was night",
        suggestedFix: "Change to evening",
      }],
    })
    expect(result.success).toBe(true)
  })

  test("rejects invalid severity", () => {
    const result = continuityCheckSchema.safeParse({
      issues: [{ severity: "critical", description: "bad" }],
    })
    expect(result.success).toBe(false)
  })

  test("rejects missing issues key", () => {
    expect(continuityCheckSchema.safeParse({}).success).toBe(false)
  })
})

// ── Chapter Summary ────────────────────────────────────────────────────────

describe("chapterSummarySchema", () => {
  test("accepts valid summary", () => {
    const result = chapterSummarySchema.safeParse({
      summary: "Kael returned to the capital.",
      keyEvents: ["Kael meets Rina"],
      emotionalState: "tense",
      openThreads: ["The documents"],
    })
    expect(result.success).toBe(true)
  })

  test("rejects keyEvents as string", () => {
    const result = chapterSummarySchema.safeParse({
      summary: "stuff",
      keyEvents: "event",
      emotionalState: "fine",
      openThreads: [],
    })
    expect(result.success).toBe(false)
  })
})

// ── Fact Extraction ────────────────────────────────────────────────────────

describe("factExtractionSchema", () => {
  test("accepts valid facts", () => {
    const result = factExtractionSchema.safeParse({
      facts: [{ fact: "The tavern door is red", category: "physical" }],
    })
    expect(result.success).toBe(true)
  })

  test("accepts all category values", () => {
    for (const cat of ["physical", "rule", "relationship", "knowledge"]) {
      const result = factExtractionSchema.safeParse({
        facts: [{ fact: "test", category: cat }],
      })
      expect(result.success).toBe(true)
    }
  })

  test("rejects invalid category", () => {
    const result = factExtractionSchema.safeParse({
      facts: [{ fact: "test", category: "emotional" }],
    })
    expect(result.success).toBe(false)
  })
})

// ── Character State Update ─────────────────────────────────────────────────

describe("characterStateUpdateSchema", () => {
  test("accepts valid update", () => {
    const result = characterStateUpdateSchema.safeParse({
      characters: [{
        name: "Kael",
        location: "Dust Throne",
        emotionalState: "suspicious",
        knows: ["Rina is in the capital"],
        doesNotKnow: ["The truth about the founding"],
      }],
    })
    expect(result.success).toBe(true)
  })

  test("rejects knows as string instead of array", () => {
    const result = characterStateUpdateSchema.safeParse({
      characters: [{
        name: "Kael",
        location: "here",
        emotionalState: "fine",
        knows: "stuff",
        doesNotKnow: [],
      }],
    })
    expect(result.success).toBe(false)
  })
})
