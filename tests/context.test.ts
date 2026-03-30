import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import {
  buildConceptContext, buildPlanningContext,
  buildWriterContext, buildContinuityContext,
  buildSummaryContext, buildFactExtractionContext, buildCharacterStateContext,
} from "../src/context"
import {
  saveWorldBible, saveCharacter, saveStorySpine, saveChapterOutline,
  saveChapterSummary, saveFact, saveCharacterState, saveIssue,
} from "../src/db"
import {
  setupTestNovel, cleanupTestDBs,
  makeSeedInput, makeWorldBible, makeCharacterProfile, makeCharacterProfileRina,
  makeStorySpine, makeChapterOutline,
} from "./helpers"

afterAll(() => cleanupTestDBs())

// ── Concept Context ────────────────────────────────────────────────────────

describe("buildConceptContext", () => {
  const seed = makeSeedInput()
  const ctx = buildConceptContext(seed)

  test("returns world, character, plotter keys", () => {
    expect(ctx).toHaveProperty("world")
    expect(ctx).toHaveProperty("character")
    expect(ctx).toHaveProperty("plotter")
  })

  test("all contain genre", () => {
    expect(ctx.world).toContain("epic fantasy")
    expect(ctx.character).toContain("epic fantasy")
    expect(ctx.plotter).toContain("epic fantasy")
  })

  test("all contain premise", () => {
    expect(ctx.world).toContain("disgraced general")
    expect(ctx.character).toContain("disgraced general")
    expect(ctx.plotter).toContain("disgraced general")
  })

  test("all contain character names", () => {
    expect(ctx.world).toContain("Kael")
    expect(ctx.character).toContain("Rina")
  })
})

// ── Planning Context ───────────────────────────────────────────────────────

describe("buildPlanningContext", () => {
  test("assembles all components", () => {
    const ctx = buildPlanningContext(
      makeWorldBible(),
      [makeCharacterProfile(), makeCharacterProfileRina()],
      makeStorySpine(),
      makeSeedInput(),
    )

    expect(ctx).toContain("Ashen Expanse") // world setting
    expect(ctx).toContain("Kael")           // character
    expect(ctx).toContain("Rina")           // character
    expect(ctx).toContain("Truth vs. stability") // central conflict
    expect(ctx).toContain("The Discovery")  // act name
    expect(ctx).toContain("epic fantasy")   // genre
  })
})

// ── Writer Context ─────────────────────────────────────────────────────────

describe("buildWriterContext", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
    saveWorldBible(novelId, makeWorldBible())
    saveCharacter(novelId, makeCharacterProfile())
    saveCharacter(novelId, makeCharacterProfileRina())
    saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: 1 }))
  })

  test("includes chapter outline info", () => {
    const ctx = buildWriterContext(novelId, 1)
    expect(ctx).toContain("Sand and Ashes")  // title
    expect(ctx).toContain("Kael")            // POV
    expect(ctx).toContain("Dust Throne")     // setting
  })

  test("includes character speech patterns", () => {
    const ctx = buildWriterContext(novelId, 1)
    expect(ctx).toContain("Short, clipped sentences") // Kael's speech pattern
  })

  test("includes world rules", () => {
    const ctx = buildWriterContext(novelId, 1)
    expect(ctx).toContain("Magic is drawn from sunlight")
  })

  test("includes scene beats", () => {
    const ctx = buildWriterContext(novelId, 1)
    expect(ctx).toContain("frontier tavern")
    expect(ctx).toContain("resignation")
  })

  test("includes previous summaries when available", () => {
    saveChapterSummary(novelId, 1, "Kael returned to the capital and met Rina.", ["meeting"])
    saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: 2, title: "Ch2" }))
    const ctx = buildWriterContext(novelId, 2)
    expect(ctx).toContain("PREVIOUS CHAPTERS")
    expect(ctx).toContain("returned to the capital")
  })

  test("includes open issues when present", () => {
    saveIssue(novelId, { severity: "blocker", description: "Fix the timeline", chapter: 1 })
    const ctx = buildWriterContext(novelId, 1)
    expect(ctx).toContain("ISSUES TO ADDRESS")
    expect(ctx).toContain("Fix the timeline")
  })

  test("includes character states when available", () => {
    saveCharacterState(novelId, "char_kael", 1, {
      characterId: "char_kael", chapterNumber: 1,
      location: "The Capital", emotionalState: "wary",
      knows: ["Rina is watching"], doesNotKnow: ["The truth"],
    })
    saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: 2, title: "Ch2" }))
    const ctx = buildWriterContext(novelId, 2)
    expect(ctx).toContain("CHARACTER STATES")
    expect(ctx).toContain("The Capital")
  })
})

// ── Continuity Context ─────────────────────────────────────────────────────

describe("buildContinuityContext", () => {
  test("includes draft text", () => {
    const ctx = buildContinuityContext("The chapter draft text.", [], [])
    expect(ctx).toContain("The chapter draft text.")
  })

  test("includes facts when present", () => {
    const facts = [{ id: "1", fact: "The door is red", category: "physical", establishedInChapter: 1 }]
    const ctx = buildContinuityContext("Draft.", facts, [])
    expect(ctx).toContain("ESTABLISHED FACTS")
    expect(ctx).toContain("The door is red")
    expect(ctx).toContain("[physical]")
  })

  test("includes character states when present", () => {
    const states = [{
      characterId: "char_kael", chapterNumber: 1,
      location: "Frontier", emotionalState: "bitter",
      knows: ["something"], doesNotKnow: ["other thing"],
    }]
    const ctx = buildContinuityContext("Draft.", [], states)
    expect(ctx).toContain("CHARACTER STATES")
    expect(ctx).toContain("Frontier")
    expect(ctx).toContain("bitter")
  })

  test("works with empty facts and states", () => {
    const ctx = buildContinuityContext("Draft.", [], [])
    expect(ctx).toContain("Draft.")
    expect(ctx).not.toContain("ESTABLISHED FACTS")
    expect(ctx).not.toContain("CHARACTER STATES")
  })
})

// ── Simple Context Builders ────────────────────────────────────────────────

describe("buildSummaryContext", () => {
  test("includes draft text", () => {
    expect(buildSummaryContext("Draft here.")).toContain("Draft here.")
  })
})

describe("buildFactExtractionContext", () => {
  test("includes draft text", () => {
    expect(buildFactExtractionContext("Some draft.")).toContain("Some draft.")
  })
})

describe("buildCharacterStateContext", () => {
  test("includes draft and character names", () => {
    const ctx = buildCharacterStateContext("Draft.", [makeCharacterProfile()])
    expect(ctx).toContain("Draft.")
    expect(ctx).toContain("Kael")
  })
})
