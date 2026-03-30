import { describe, test, expect, beforeEach, afterAll, afterEach, spyOn, mock } from "bun:test"
import {
  setupTestNovel, cleanupTestDBs,
  makeWorldBible, makeCharacterProfile, makeCharacterProfileRina,
  makeStorySpine, makeChapterOutline, makeChapterDraft, makeLLMResponse,
} from "./helpers"

// Mock CLI module before any phase imports
mock.module("../src/cli", () => ({
  displayPhaseHeader: () => {},
  displayProgress: () => {},
  presentForApproval: () => Promise.resolve("approve"),
  getRevisionNotes: () => Promise.resolve([]),
  formatWorldBible: (wb: any) => JSON.stringify(wb),
  formatCharacterProfiles: (chars: any) => JSON.stringify(chars),
  formatStorySpine: (spine: any) => JSON.stringify(spine),
  formatChapterOutlines: (outlines: any) => JSON.stringify(outlines),
  closeInput: () => {},
  collectSeedInput: () => Promise.resolve(null),
}))

import {
  getNovel, getWorldBible, getCharacters, getStorySpine,
  getChapterOutlines, saveWorldBible, saveCharacter, saveStorySpine,
  saveChapterOutline, updatePhase, updateTotalChapters,
} from "../src/db"

const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key-fake"
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

afterAll(() => cleanupTestDBs())

// ── Concept Phase ──────────────────────────────────────────────────────────

describe("runConceptPhase", () => {
  test("calls 3 agents and saves results", async () => {
    const novelId = setupTestNovel()
    let fetchCount = 0

    globalThis.fetch = async (_url: any, opts: any) => {
      fetchCount++
      const body = JSON.parse(opts.body)
      const systemPrompt: string = body.messages[0].content

      if (systemPrompt.includes("world-building")) {
        return makeLLMResponse(makeWorldBible())
      } else if (systemPrompt.includes("character development")) {
        return makeLLMResponse({ characters: [makeCharacterProfile(), makeCharacterProfileRina()] })
      } else {
        return makeLLMResponse(makeStorySpine())
      }
    }

    const { runConceptPhase } = await import("../src/phases/concept")
    const seed = getNovel(novelId).seed
    await runConceptPhase(novelId, seed)

    expect(getNovel(novelId).phase).toBe("planning")
    expect(getWorldBible(novelId).setting).toContain("Ashen Expanse")
    expect(getCharacters(novelId).length).toBeGreaterThanOrEqual(2)
    expect(getStorySpine(novelId).acts).toHaveLength(3)
    expect(fetchCount).toBe(3)
  })
})

// ── Planning Phase ─────────────────────────────────────────────────────────

describe("runPlanningPhase", () => {
  test("generates outlines and advances to drafting", async () => {
    const novelId = setupTestNovel()
    saveWorldBible(novelId, makeWorldBible())
    saveCharacter(novelId, makeCharacterProfile())
    saveCharacter(novelId, makeCharacterProfileRina())
    saveStorySpine(novelId, makeStorySpine())
    updatePhase(novelId, "planning")

    globalThis.fetch = async () => makeLLMResponse({
      chapters: [
        makeChapterOutline({ chapterNumber: 1, title: "Chapter 1" }),
        makeChapterOutline({ chapterNumber: 2, title: "Chapter 2" }),
        makeChapterOutline({ chapterNumber: 3, title: "Chapter 3" }),
      ],
    })

    const { runPlanningPhase } = await import("../src/phases/planning")
    await runPlanningPhase(novelId)

    const novel = getNovel(novelId)
    expect(novel.phase).toBe("drafting")
    expect(novel.totalChapters).toBe(3)
    expect(getChapterOutlines(novelId)).toHaveLength(3)
  })
})

// ── Drafting Phase ─────────────────────────────────────────────────────────

describe("runDraftingPhase", () => {
  function seedForDrafting(novelId: string, numChapters: number = 1) {
    saveWorldBible(novelId, makeWorldBible())
    saveCharacter(novelId, makeCharacterProfile())
    saveCharacter(novelId, makeCharacterProfileRina())
    saveStorySpine(novelId, makeStorySpine())
    for (let i = 1; i <= numChapters; i++) {
      saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: i, title: `Chapter ${i}` }))
    }
    updateTotalChapters(novelId, numChapters)
    updatePhase(novelId, "drafting")
  }

  test("drafts a chapter and updates state", async () => {
    const novelId = setupTestNovel()
    seedForDrafting(novelId, 1)

    const draft = makeChapterDraft(2500)
    let callCount = 0

    globalThis.fetch = async () => {
      callCount++
      if (callCount === 1) return makeLLMResponse({ prose: draft })
      if (callCount === 2) return makeLLMResponse({ issues: [] })
      if (callCount === 3) return makeLLMResponse({
        summary: "Kael returned to the capital.",
        keyEvents: ["Kael meets Rina"],
        emotionalState: "tense",
        openThreads: ["The documents"],
      })
      if (callCount === 4) return makeLLMResponse({
        facts: [{ fact: "The tavern is dusty", category: "physical" }],
      })
      return makeLLMResponse({
        characters: [{
          name: "Kael", location: "Dust Throne", emotionalState: "suspicious",
          knows: ["Rina is here"], doesNotKnow: ["The truth"],
        }],
      })
    }

    const writeSpy = spyOn(Bun, "write").mockResolvedValue(0 as any)

    const { runDraftingPhase } = await import("../src/phases/drafting")
    await runDraftingPhase(novelId)

    const novel = getNovel(novelId)
    expect(novel.phase).toBe("done")
    expect(novel.currentChapter).toBe(2)
    expect(callCount).toBe(5)

    writeSpy.mockRestore()
  })
})

// ── State Machine ──────────────────────────────────────────────────────────

describe("runNovel (state machine)", () => {
  test("transitions through all phases", async () => {
    const novelId = setupTestNovel()
    let conceptRan = false, planningRan = false, draftingRan = false

    // Mock phase modules to just advance state
    mock.module("../src/phases/concept", () => ({
      runConceptPhase: async (id: string) => { conceptRan = true; updatePhase(id, "planning") },
    }))
    mock.module("../src/phases/planning", () => ({
      runPlanningPhase: async (id: string) => { planningRan = true; updatePhase(id, "drafting") },
    }))
    mock.module("../src/phases/drafting", () => ({
      runDraftingPhase: async (id: string) => { draftingRan = true; updatePhase(id, "done") },
    }))

    const { runNovel } = await import("../src/state-machine")
    await runNovel(novelId)

    expect(conceptRan).toBe(true)
    expect(planningRan).toBe(true)
    expect(draftingRan).toBe(true)
    expect(getNovel(novelId).phase).toBe("done")
  })

  test("resumes from drafting phase", async () => {
    const novelId = setupTestNovel()
    updatePhase(novelId, "drafting")
    let conceptRan = false, draftingRan = false

    mock.module("../src/phases/concept", () => ({
      runConceptPhase: async () => { conceptRan = true },
    }))
    mock.module("../src/phases/drafting", () => ({
      runDraftingPhase: async (id: string) => { draftingRan = true; updatePhase(id, "done") },
    }))

    const { runNovel } = await import("../src/state-machine")
    await runNovel(novelId)

    expect(conceptRan).toBe(false)
    expect(draftingRan).toBe(true)
  })

  test("does nothing when already done", async () => {
    const novelId = setupTestNovel()
    updatePhase(novelId, "done")
    let anyPhaseRan = false

    mock.module("../src/phases/concept", () => ({
      runConceptPhase: async () => { anyPhaseRan = true },
    }))
    mock.module("../src/phases/planning", () => ({
      runPlanningPhase: async () => { anyPhaseRan = true },
    }))
    mock.module("../src/phases/drafting", () => ({
      runDraftingPhase: async () => { anyPhaseRan = true },
    }))

    const { runNovel } = await import("../src/state-machine")
    await runNovel(novelId)

    expect(anyPhaseRan).toBe(false)
  })
})
