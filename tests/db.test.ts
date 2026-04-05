import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import {
  initDB, createNovel, getNovel, updatePhase, updateCurrentChapter,
  updateTotalChapters, saveWorldBible, getWorldBible, saveCharacter,
  getCharacters, saveStorySpine, getStorySpine, saveChapterOutline,
  getChapterOutline, getChapterOutlines, saveChapterDraft, approveChapterDraft,
  saveChapterSummary, getRecentSummaries, saveFact, getFactsUpToChapter,
  saveCharacterState, getCharacterStatesAtChapter, saveIssue, getOpenIssues,
  resolveIssuesForChapter,
  getApprovedDraft, unapproveChapterDraft, getFactsForChapter,
  clearFactsForChapter, clearCharacterStatesForChapter,
  saveValidationPass, getValidationAttempts,
} from "../src/db"
import {
  setupTestNovel, cleanupTestDBs,
  makeSeedInput, makeWorldBible, makeCharacterProfile, makeCharacterProfileRina,
  makeStorySpine, makeChapterOutline,
} from "./helpers"

afterAll(async () => await cleanupTestDBs())

// ── Init ───────────────────────────────────────────────────────────────────

describe("initDB", () => {
  test("is a no-op for Postgres (schema managed by migrations)", async () => {
    const id = `test-init-${crypto.randomUUID()}`
    await expect(initDB(id)).resolves.toBeUndefined()
  })
})

// ── Novel CRUD ─────────────────────────────────────────────────────────────

describe("novel CRUD", () => {
  let novelId: string

  beforeEach(async () => {
    novelId = await setupTestNovel()
  })

  test("createNovel + getNovel round-trips seed", async () => {
    const novel = await getNovel(novelId)
    expect(novel.id).toBe(novelId)
    expect(novel.phase).toBe("concept")
    expect(novel.seed.premise).toBe(makeSeedInput().premise)
    expect(novel.seed.characters).toHaveLength(2)
    expect(novel.currentChapter).toBe(1)
    expect(novel.totalChapters).toBe(0)
  })

  test("getNovel throws for nonexistent id", async () => {
    await expect(getNovel("nonexistent")).rejects.toThrow()
  })

  test("updatePhase changes phase", async () => {
    await updatePhase(novelId, "planning")
    expect((await getNovel(novelId)).phase).toBe("planning")
  })

  test("updateCurrentChapter sets chapter", async () => {
    await updateCurrentChapter(novelId, 5)
    expect((await getNovel(novelId)).currentChapter).toBe(5)
  })

  test("updateTotalChapters sets total", async () => {
    await updateTotalChapters(novelId, 10)
    expect((await getNovel(novelId)).totalChapters).toBe(10)
  })
})

// ── World Bible ────────────────────────────────────────────────────────────

describe("world bible", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("save + get round-trips", async () => {
    const wb = makeWorldBible()
    await saveWorldBible(novelId, wb)
    const loaded = await getWorldBible(novelId)
    expect(loaded.setting).toBe(wb.setting)
    expect(loaded.rules).toEqual(wb.rules)
    expect(loaded.locations).toHaveLength(2)
  })

  test("getWorldBible throws for nonexistent novel", async () => {
    await expect(getWorldBible("nonexistent")).rejects.toThrow()
  })

  test("save overwrites on duplicate", async () => {
    await saveWorldBible(novelId, makeWorldBible())
    const updated = { ...makeWorldBible(), setting: "Updated setting" }
    await saveWorldBible(novelId, updated)
    expect((await getWorldBible(novelId)).setting).toBe("Updated setting")
  })
})

// ── Characters ─────────────────────────────────────────────────────────────

describe("characters", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("save + get round-trips", async () => {
    const char = makeCharacterProfile()
    await saveCharacter(novelId, char)
    const chars = await getCharacters(novelId)
    expect(chars).toHaveLength(1)
    expect(chars[0].name).toBe("Kael")
    expect(chars[0].traits).toEqual(char.traits)
  })

  test("multiple characters returned", async () => {
    await saveCharacter(novelId, makeCharacterProfile())
    await saveCharacter(novelId, makeCharacterProfileRina())
    expect(await getCharacters(novelId)).toHaveLength(2)
  })

  test("upserts on same id", async () => {
    await saveCharacter(novelId, makeCharacterProfile())
    await saveCharacter(novelId, makeCharacterProfile({ goals: "New goals" }))
    const chars = await getCharacters(novelId)
    expect(chars).toHaveLength(1)
    expect(chars[0].goals).toBe("New goals")
  })
})

// ── Story Spine ────────────────────────────────────────────────────────────

describe("story spine", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("save + get round-trips", async () => {
    const spine = makeStorySpine()
    await saveStorySpine(novelId, spine)
    const loaded = await getStorySpine(novelId)
    expect(loaded.centralConflict).toBe(spine.centralConflict)
    expect(loaded.acts).toHaveLength(3)
  })

  test("getStorySpine throws for nonexistent", async () => {
    await expect(getStorySpine("nonexistent")).rejects.toThrow()
  })
})

// ── Chapter Outlines ───────────────────────────────────────────────────────

describe("chapter outlines", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("save + get round-trips", async () => {
    const outline = makeChapterOutline()
    await saveChapterOutline(novelId, outline)
    const loaded = await getChapterOutline(novelId, 1)
    expect(loaded.title).toBe(outline.title)
    expect(loaded.scenes).toHaveLength(2)
  })

  test("getChapterOutlines returns all ordered", async () => {
    await saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: 3, title: "Ch3" }))
    await saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: 1, title: "Ch1" }))
    await saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: 2, title: "Ch2" }))
    const outlines = await getChapterOutlines(novelId)
    expect(outlines).toHaveLength(3)
    expect(outlines[0].chapterNumber).toBe(1)
    expect(outlines[1].chapterNumber).toBe(2)
    expect(outlines[2].chapterNumber).toBe(3)
  })

  test("getChapterOutline throws for nonexistent chapter", async () => {
    await expect(getChapterOutline(novelId, 99)).rejects.toThrow()
  })
})

// ── Chapter Drafts ─────────────────────────────────────────────────────────

describe("chapter drafts", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("approve + get round-trips", async () => {
    await saveChapterDraft(novelId, 1, "Draft v1", 500)
    await saveChapterDraft(novelId, 1, "Draft v2", 600)
    await approveChapterDraft(novelId, 1)
    const draft = await getApprovedDraft(novelId, 1)
    expect(draft).not.toBeNull()
    expect(draft!.prose).toBe("Draft v2")
    expect(draft!.wordCount).toBe(600)
    expect(draft!.version).toBe(2)
  })

  test("getApprovedDraft returns null when none approved", async () => {
    await saveChapterDraft(novelId, 1, "Draft", 500)
    expect(await getApprovedDraft(novelId, 1)).toBeNull()
  })

  test("unapproveChapterDraft reverts status", async () => {
    await saveChapterDraft(novelId, 1, "Draft", 500)
    await approveChapterDraft(novelId, 1)
    expect(await getApprovedDraft(novelId, 1)).not.toBeNull()
    await unapproveChapterDraft(novelId, 1)
    expect(await getApprovedDraft(novelId, 1)).toBeNull()
  })
})

// ── Chapter Summaries ──────────────────────────────────────────────────────

describe("chapter summaries", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("save + getRecentSummaries round-trips", async () => {
    await saveChapterSummary(novelId, 1, "Chapter 1 summary", ["event1"])
    const summaries = await getRecentSummaries(novelId, 2, 3)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].summary).toBe("Chapter 1 summary")
    expect(summaries[0].keyEvents).toEqual(["event1"])
  })

  test("returns ordered ascending, limited", async () => {
    for (let i = 1; i <= 5; i++) {
      await saveChapterSummary(novelId, i, `Summary ${i}`, [`event${i}`])
    }
    const summaries = await getRecentSummaries(novelId, 5, 3)
    expect(summaries).toHaveLength(3)
    expect(summaries[0].chapterNumber).toBe(2)
    expect(summaries[1].chapterNumber).toBe(3)
    expect(summaries[2].chapterNumber).toBe(4)
  })

  test("returns empty for chapter 1", async () => {
    await saveChapterSummary(novelId, 1, "Summary", ["event"])
    const summaries = await getRecentSummaries(novelId, 1, 3)
    expect(summaries).toHaveLength(0)
  })
})

// ── Facts ──────────────────────────────────────────────────────────────────

describe("facts", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("save + get round-trips", async () => {
    await saveFact(novelId, { fact: "The door is red", category: "physical", establishedInChapter: 1 })
    const facts = await getFactsUpToChapter(novelId, 1)
    expect(facts).toHaveLength(1)
    expect(facts[0].fact).toBe("The door is red")
    expect(facts[0].category).toBe("physical")
  })

  test("filters by chapter number", async () => {
    await saveFact(novelId, { fact: "Fact ch1", category: "physical", establishedInChapter: 1 })
    await saveFact(novelId, { fact: "Fact ch3", category: "rule", establishedInChapter: 3 })
    await saveFact(novelId, { fact: "Fact ch5", category: "knowledge", establishedInChapter: 5 })

    const upTo3 = await getFactsUpToChapter(novelId, 3)
    expect(upTo3).toHaveLength(2)
    expect(upTo3.map(f => f.fact)).toContain("Fact ch1")
    expect(upTo3.map(f => f.fact)).toContain("Fact ch3")
  })

  test("getFactsForChapter returns only that chapter", async () => {
    await saveFact(novelId, { fact: "Fact ch1", category: "physical", establishedInChapter: 1 })
    await saveFact(novelId, { fact: "Fact ch2", category: "rule", establishedInChapter: 2 })
    const ch1Facts = await getFactsForChapter(novelId, 1)
    expect(ch1Facts).toHaveLength(1)
    expect(ch1Facts[0].fact).toBe("Fact ch1")
  })

  test("clearFactsForChapter deletes only that chapter", async () => {
    await saveFact(novelId, { fact: "Fact ch1", category: "physical", establishedInChapter: 1 })
    await saveFact(novelId, { fact: "Fact ch2", category: "rule", establishedInChapter: 2 })
    await clearFactsForChapter(novelId, 1)
    expect(await getFactsForChapter(novelId, 1)).toHaveLength(0)
    expect(await getFactsForChapter(novelId, 2)).toHaveLength(1)
  })
})

// ── Character States ───────────────────────────────────────────────────────

describe("character states", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("save + get round-trips", async () => {
    await saveCharacterState(novelId, "char_kael", 1, {
      characterId: "char_kael", chapterNumber: 1,
      location: "Dust Throne", emotionalState: "suspicious",
      knows: ["Rina is here"], doesNotKnow: ["The truth"],
    })
    const states = await getCharacterStatesAtChapter(novelId, 2)
    expect(states).toHaveLength(1)
    expect(states[0].location).toBe("Dust Throne")
  })

  test("returns latest state per character", async () => {
    await saveCharacterState(novelId, "char_kael", 1, {
      characterId: "char_kael", chapterNumber: 1,
      location: "Frontier", emotionalState: "bitter", knows: [], doesNotKnow: [],
    })
    await saveCharacterState(novelId, "char_kael", 3, {
      characterId: "char_kael", chapterNumber: 3,
      location: "Capital", emotionalState: "determined", knows: ["the lie"], doesNotKnow: [],
    })
    const states = await getCharacterStatesAtChapter(novelId, 4)
    expect(states).toHaveLength(1)
    expect(states[0].location).toBe("Capital")
  })

  test("clearCharacterStatesForChapter deletes only that chapter", async () => {
    await saveCharacterState(novelId, "char_kael", 1, {
      characterId: "char_kael", chapterNumber: 1,
      location: "Frontier", emotionalState: "bitter", knows: [], doesNotKnow: [],
    })
    await saveCharacterState(novelId, "char_kael", 2, {
      characterId: "char_kael", chapterNumber: 2,
      location: "Capital", emotionalState: "angry", knows: [], doesNotKnow: [],
    })
    await clearCharacterStatesForChapter(novelId, 1)
    const states = await getCharacterStatesAtChapter(novelId, 3)
    expect(states).toHaveLength(1)
    expect(states[0].location).toBe("Capital")
  })
})

// ── Issues ─────────────────────────────────────────────────────────────────

describe("issues", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("save + getOpenIssues round-trips", async () => {
    await saveIssue(novelId, { severity: "blocker", description: "Kael teleported", chapter: 2 })
    const issues = await getOpenIssues(novelId)
    expect(issues).toHaveLength(1)
    expect(issues[0].description).toBe("Kael teleported")
  })

  test("filters by chapter", async () => {
    await saveIssue(novelId, { severity: "blocker", description: "Issue ch2", chapter: 2 })
    await saveIssue(novelId, { severity: "warning", description: "Issue ch3", chapter: 3 })
    expect(await getOpenIssues(novelId, 2)).toHaveLength(1)
    expect(await getOpenIssues(novelId, 3)).toHaveLength(1)
    expect(await getOpenIssues(novelId)).toHaveLength(2)
  })

  test("resolveIssuesForChapter clears issues", async () => {
    await saveIssue(novelId, { severity: "blocker", description: "Issue", chapter: 2 })
    await resolveIssuesForChapter(novelId, 2)
    expect(await getOpenIssues(novelId, 2)).toHaveLength(0)
  })
})

// ── Validation Passes ─────────────────────────────────────────────────────

describe("validation passes", () => {
  let novelId: string
  beforeEach(async () => { novelId = await setupTestNovel() })

  test("saveValidationPass + getValidationAttempts counts rewrites", async () => {
    expect(await getValidationAttempts(novelId, 1)).toBe(0)
    await saveValidationPass(novelId, 1, 1, "rewritten", 2)
    expect(await getValidationAttempts(novelId, 1)).toBe(1)
    await saveValidationPass(novelId, 2, 1, "rewritten", 1)
    expect(await getValidationAttempts(novelId, 1)).toBe(2)
  })

  test("getValidationAttempts only counts rewritten status", async () => {
    await saveValidationPass(novelId, 1, 1, "passed", 0)
    await saveValidationPass(novelId, 1, 2, "has_issues", 3)
    await saveValidationPass(novelId, 2, 1, "rewritten", 1)
    expect(await getValidationAttempts(novelId, 1)).toBe(1)
    expect(await getValidationAttempts(novelId, 2)).toBe(0)
  })
})
