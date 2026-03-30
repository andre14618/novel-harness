import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { existsSync } from "node:fs"
import {
  initDB, getDB, createNovel, getNovel, updatePhase, updateCurrentChapter,
  updateTotalChapters, saveWorldBible, getWorldBible, saveCharacter,
  getCharacters, saveStorySpine, getStorySpine, saveChapterOutline,
  getChapterOutline, getChapterOutlines, saveChapterDraft, approveChapterDraft,
  saveChapterSummary, getRecentSummaries, saveFact, getFactsUpToChapter,
  saveCharacterState, getCharacterStatesAtChapter, saveIssue, getOpenIssues,
  resolveIssuesForChapter,
} from "../src/db"
import {
  setupTestDB, setupTestNovel, cleanupTestDBs,
  makeSeedInput, makeWorldBible, makeCharacterProfile, makeCharacterProfileRina,
  makeStorySpine, makeChapterOutline,
} from "./helpers"

afterAll(() => cleanupTestDBs())

// ── Init ───────────────────────────────────────────────────────────────────

describe("initDB", () => {
  test("creates output directory and DB file", () => {
    const id = `test-init-${crypto.randomUUID()}`
    initDB(id)
    expect(existsSync(`output/${id}/novel.db`)).toBe(true)
    // cleanup
    const { rmSync } = require("node:fs")
    rmSync(`output/${id}`, { recursive: true, force: true })
  })

  test("is idempotent", () => {
    const id = setupTestDB()
    expect(() => initDB(id)).not.toThrow()
  })
})

// ── Novel CRUD ─────────────────────────────────────────────────────────────

describe("novel CRUD", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("createNovel + getNovel round-trips seed", () => {
    const novel = getNovel(novelId)
    expect(novel.id).toBe(novelId)
    expect(novel.phase).toBe("concept")
    expect(novel.seed.premise).toBe(makeSeedInput().premise)
    expect(novel.seed.characters).toHaveLength(2)
    expect(novel.currentChapter).toBe(1)
    expect(novel.totalChapters).toBe(0)
  })

  test("getNovel throws for nonexistent id", () => {
    expect(() => getNovel("nonexistent")).toThrow()
  })

  test("updatePhase changes phase", () => {
    updatePhase(novelId, "planning")
    expect(getNovel(novelId).phase).toBe("planning")
  })

  test("updateCurrentChapter sets chapter", () => {
    updateCurrentChapter(novelId, 5)
    expect(getNovel(novelId).currentChapter).toBe(5)
  })

  test("updateTotalChapters sets total", () => {
    updateTotalChapters(novelId, 10)
    expect(getNovel(novelId).totalChapters).toBe(10)
  })
})

// ── World Bible ────────────────────────────────────────────────────────────

describe("world bible", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("save + get round-trips", () => {
    const wb = makeWorldBible()
    saveWorldBible(novelId, wb)
    const loaded = getWorldBible(novelId)
    expect(loaded.setting).toBe(wb.setting)
    expect(loaded.rules).toEqual(wb.rules)
    expect(loaded.locations).toHaveLength(2)
  })

  test("getWorldBible throws for nonexistent novel", () => {
    expect(() => getWorldBible("nonexistent")).toThrow()
  })

  test("save overwrites on duplicate", () => {
    saveWorldBible(novelId, makeWorldBible())
    const updated = { ...makeWorldBible(), setting: "Updated setting" }
    saveWorldBible(novelId, updated)
    expect(getWorldBible(novelId).setting).toBe("Updated setting")
  })
})

// ── Characters ─────────────────────────────────────────────────────────────

describe("characters", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("save + get round-trips", () => {
    const char = makeCharacterProfile()
    saveCharacter(novelId, char)
    const chars = getCharacters(novelId)
    expect(chars).toHaveLength(1)
    expect(chars[0].name).toBe("Kael")
    expect(chars[0].traits).toEqual(char.traits)
  })

  test("multiple characters returned", () => {
    saveCharacter(novelId, makeCharacterProfile())
    saveCharacter(novelId, makeCharacterProfileRina())
    expect(getCharacters(novelId)).toHaveLength(2)
  })

  test("upserts on same id", () => {
    saveCharacter(novelId, makeCharacterProfile())
    saveCharacter(novelId, makeCharacterProfile({ goals: "New goals" }))
    const chars = getCharacters(novelId)
    expect(chars).toHaveLength(1)
    expect(chars[0].goals).toBe("New goals")
  })
})

// ── Story Spine ────────────────────────────────────────────────────────────

describe("story spine", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("save + get round-trips", () => {
    const spine = makeStorySpine()
    saveStorySpine(novelId, spine)
    const loaded = getStorySpine(novelId)
    expect(loaded.centralConflict).toBe(spine.centralConflict)
    expect(loaded.acts).toHaveLength(3)
  })

  test("getStorySpine throws for nonexistent", () => {
    expect(() => getStorySpine("nonexistent")).toThrow()
  })
})

// ── Chapter Outlines ───────────────────────────────────────────────────────

describe("chapter outlines", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("save + get round-trips", () => {
    const outline = makeChapterOutline()
    saveChapterOutline(novelId, outline)
    const loaded = getChapterOutline(novelId, 1)
    expect(loaded.title).toBe(outline.title)
    expect(loaded.scenes).toHaveLength(2)
  })

  test("getChapterOutlines returns all ordered", () => {
    saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: 3, title: "Ch3" }))
    saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: 1, title: "Ch1" }))
    saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: 2, title: "Ch2" }))
    const outlines = getChapterOutlines(novelId)
    expect(outlines).toHaveLength(3)
    expect(outlines[0].chapterNumber).toBe(1)
    expect(outlines[1].chapterNumber).toBe(2)
    expect(outlines[2].chapterNumber).toBe(3)
  })

  test("getChapterOutline throws for nonexistent chapter", () => {
    expect(() => getChapterOutline(novelId, 99)).toThrow()
  })
})

// ── Chapter Drafts ─────────────────────────────────────────────────────────

describe("chapter drafts", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("first save creates version 1", () => {
    saveChapterDraft(novelId, 1, "Draft text", 500)
    const row = getDB().prepare(
      "SELECT version, status FROM chapter_drafts WHERE novel_id = ? AND chapter_number = ?"
    ).get(novelId, 1) as any
    expect(row.version).toBe(1)
    expect(row.status).toBe("draft")
  })

  test("second save auto-increments version", () => {
    saveChapterDraft(novelId, 1, "Draft v1", 500)
    saveChapterDraft(novelId, 1, "Draft v2", 600)
    const rows = getDB().prepare(
      "SELECT version FROM chapter_drafts WHERE novel_id = ? AND chapter_number = ? ORDER BY version"
    ).all(novelId, 1) as any[]
    expect(rows).toHaveLength(2)
    expect(rows[0].version).toBe(1)
    expect(rows[1].version).toBe(2)
  })

  test("approveChapterDraft marks latest version", () => {
    saveChapterDraft(novelId, 1, "Draft v1", 500)
    saveChapterDraft(novelId, 1, "Draft v2", 600)
    approveChapterDraft(novelId, 1)
    const rows = getDB().prepare(
      "SELECT version, status FROM chapter_drafts WHERE novel_id = ? AND chapter_number = ? ORDER BY version"
    ).all(novelId, 1) as any[]
    expect(rows[0].status).toBe("draft")    // v1 unchanged
    expect(rows[1].status).toBe("approved") // v2 approved
  })
})

// ── Chapter Summaries ──────────────────────────────────────────────────────

describe("chapter summaries", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("save + getRecentSummaries round-trips", () => {
    saveChapterSummary(novelId, 1, "Chapter 1 summary", ["event1"])
    const summaries = getRecentSummaries(novelId, 2, 3)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].summary).toBe("Chapter 1 summary")
    expect(summaries[0].keyEvents).toEqual(["event1"])
  })

  test("returns ordered ascending, limited", () => {
    for (let i = 1; i <= 5; i++) {
      saveChapterSummary(novelId, i, `Summary ${i}`, [`event${i}`])
    }
    const summaries = getRecentSummaries(novelId, 5, 3)
    expect(summaries).toHaveLength(3)
    expect(summaries[0].chapterNumber).toBe(2)
    expect(summaries[1].chapterNumber).toBe(3)
    expect(summaries[2].chapterNumber).toBe(4)
  })

  test("returns empty for chapter 1", () => {
    saveChapterSummary(novelId, 1, "Summary", ["event"])
    const summaries = getRecentSummaries(novelId, 1, 3)
    expect(summaries).toHaveLength(0)
  })
})

// ── Facts ──────────────────────────────────────────────────────────────────

describe("facts", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("save + get round-trips", () => {
    saveFact(novelId, { fact: "The door is red", category: "physical", establishedInChapter: 1 })
    const facts = getFactsUpToChapter(novelId, 1)
    expect(facts).toHaveLength(1)
    expect(facts[0].fact).toBe("The door is red")
    expect(facts[0].category).toBe("physical")
  })

  test("filters by chapter number", () => {
    saveFact(novelId, { fact: "Fact ch1", category: "physical", establishedInChapter: 1 })
    saveFact(novelId, { fact: "Fact ch3", category: "rule", establishedInChapter: 3 })
    saveFact(novelId, { fact: "Fact ch5", category: "knowledge", establishedInChapter: 5 })

    const upTo3 = getFactsUpToChapter(novelId, 3)
    expect(upTo3).toHaveLength(2)
    expect(upTo3.map(f => f.fact)).toContain("Fact ch1")
    expect(upTo3.map(f => f.fact)).toContain("Fact ch3")
  })

  test("ordered by established chapter", () => {
    saveFact(novelId, { fact: "Late", category: "physical", establishedInChapter: 3 })
    saveFact(novelId, { fact: "Early", category: "physical", establishedInChapter: 1 })
    const facts = getFactsUpToChapter(novelId, 5)
    expect(facts[0].fact).toBe("Early")
    expect(facts[1].fact).toBe("Late")
  })
})

// ── Character States ───────────────────────────────────────────────────────

describe("character states", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("save + get round-trips", () => {
    saveCharacterState(novelId, "char_kael", 1, {
      characterId: "char_kael",
      chapterNumber: 1,
      location: "Dust Throne",
      emotionalState: "suspicious",
      knows: ["Rina is here"],
      doesNotKnow: ["The truth"],
    })
    const states = getCharacterStatesAtChapter(novelId, 2)
    expect(states).toHaveLength(1)
    expect(states[0].location).toBe("Dust Throne")
  })

  test("returns latest state per character", () => {
    saveCharacterState(novelId, "char_kael", 1, {
      characterId: "char_kael", chapterNumber: 1,
      location: "Frontier", emotionalState: "bitter",
      knows: [], doesNotKnow: [],
    })
    saveCharacterState(novelId, "char_kael", 3, {
      characterId: "char_kael", chapterNumber: 3,
      location: "Capital", emotionalState: "determined",
      knows: ["the lie"], doesNotKnow: [],
    })
    const states = getCharacterStatesAtChapter(novelId, 4)
    expect(states).toHaveLength(1)
    expect(states[0].location).toBe("Capital")
  })

  test("returns empty before first state", () => {
    saveCharacterState(novelId, "char_kael", 3, {
      characterId: "char_kael", chapterNumber: 3,
      location: "here", emotionalState: "fine",
      knows: [], doesNotKnow: [],
    })
    expect(getCharacterStatesAtChapter(novelId, 1)).toHaveLength(0)
    expect(getCharacterStatesAtChapter(novelId, 3)).toHaveLength(0) // < 3, not <=
  })
})

// ── Issues ─────────────────────────────────────────────────────────────────

describe("issues", () => {
  let novelId: string

  beforeEach(() => {
    novelId = setupTestNovel()
  })

  test("save + getOpenIssues round-trips", () => {
    saveIssue(novelId, { severity: "blocker", description: "Kael teleported", chapter: 2 })
    const issues = getOpenIssues(novelId)
    expect(issues).toHaveLength(1)
    expect(issues[0].description).toBe("Kael teleported")
  })

  test("filters by chapter", () => {
    saveIssue(novelId, { severity: "blocker", description: "Issue ch2", chapter: 2 })
    saveIssue(novelId, { severity: "warning", description: "Issue ch3", chapter: 3 })
    expect(getOpenIssues(novelId, 2)).toHaveLength(1)
    expect(getOpenIssues(novelId, 3)).toHaveLength(1)
    expect(getOpenIssues(novelId)).toHaveLength(2)
  })

  test("resolveIssuesForChapter clears issues", () => {
    saveIssue(novelId, { severity: "blocker", description: "Issue", chapter: 2 })
    resolveIssuesForChapter(novelId, 2)
    expect(getOpenIssues(novelId, 2)).toHaveLength(0)
  })

  test("resolve only affects target chapter", () => {
    saveIssue(novelId, { severity: "blocker", description: "Ch2 issue", chapter: 2 })
    saveIssue(novelId, { severity: "warning", description: "Ch3 issue", chapter: 3 })
    resolveIssuesForChapter(novelId, 2)
    expect(getOpenIssues(novelId, 2)).toHaveLength(0)
    expect(getOpenIssues(novelId, 3)).toHaveLength(1)
  })
})
