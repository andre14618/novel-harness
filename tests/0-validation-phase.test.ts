import { describe, test, expect, beforeEach, afterAll, spyOn } from "bun:test"

import {
  getNovel, updatePhase, updateTotalChapters,
  saveWorldBible, saveCharacter, saveStorySpine, saveChapterOutline,
  saveChapterDraft, approveChapterDraft, saveChapterSummary, saveFact,
  saveCharacterState, getOpenIssues, getApprovedDraft, getValidationAttempts,
  saveValidationPass, resolveIssuesForChapter,
} from "../src/db"
import {
  setupTestNovel, cleanupTestDBs,
  makeWorldBible, makeCharacterProfile, makeCharacterProfileRina,
  makeStorySpine, makeChapterOutline, makeChapterDraft, makeLLMResponse,
} from "./helpers"
// This file is named 0-* to run before phases.test.ts, which uses mock.module
// that permanently replaces the validation module for the test process
import { runValidationPhase } from "../src/phases/validation"

afterAll(() => cleanupTestDBs())

function seedForValidation(novelId: string, numChapters: number = 3) {
  saveWorldBible(novelId, makeWorldBible())
  saveCharacter(novelId, makeCharacterProfile())
  saveCharacter(novelId, makeCharacterProfileRina())
  saveStorySpine(novelId, makeStorySpine())

  for (let i = 1; i <= numChapters; i++) {
    saveChapterOutline(novelId, makeChapterOutline({ chapterNumber: i, title: `Chapter ${i}` }))
    const draft = makeChapterDraft(2500)
    saveChapterDraft(novelId, i, draft, draft.split(/\s+/).length)
    approveChapterDraft(novelId, i)
    saveChapterSummary(novelId, i, `Summary of chapter ${i}`, [`event${i}`])
    saveFact(novelId, { fact: `Fact from chapter ${i}`, category: "physical", establishedInChapter: i })
    saveCharacterState(novelId, "char_kael", i, {
      characterId: "char_kael", chapterNumber: i,
      location: "Dust Throne", emotionalState: "determined",
      knows: ["something"], doesNotKnow: ["the truth"],
    })
  }

  updateTotalChapters(novelId, numChapters)
  updatePhase(novelId, "validation")
}

describe("runValidationPhase", () => {
  test("converges immediately when no issues found", async () => {
    const novelId = setupTestNovel()
    seedForValidation(novelId, 3)

    // Mock LLM: cross-chapter continuity returns no issues
    globalThis.fetch = async () => makeLLMResponse({ issues: [] })

    const writeSpy = spyOn(Bun, "write").mockResolvedValue(0 as any)

    // using top-level import
    await runValidationPhase(novelId)

    const novel = getNovel(novelId)
    expect(novel.phase).toBe("done")
    expect(getOpenIssues(novelId)).toHaveLength(0)

    writeSpy.mockRestore()
  })

  test("detects cross-chapter issues and rewrites", async () => {
    const novelId = setupTestNovel()
    seedForValidation(novelId, 3)

    const rewrittenDraft = makeChapterDraft(2500)

    // Track calls by inspecting the request body to route mocks correctly
    globalThis.fetch = async (_url: any, opts: any) => {
      const body = JSON.parse(opts.body)
      const userMsg = body.messages?.[1]?.content ?? ""

      // Cross-chapter continuity check
      if (userMsg.includes("MANUSCRIPT REVIEW")) {
        if (getOpenIssues(novelId).length === 0 && getValidationAttempts(novelId, 2) > 0) {
          return makeLLMResponse({ issues: [] }) // pass 2: clean
        }
        return makeLLMResponse({
          issues: [{
            severity: "warning",
            description: "Kael is at the frontier in ch1 but appears in the capital in ch2 with no travel",
            chapter: 2,
            conflictsWith: "Chapter 1 ending location",
            suggestedFix: "Add a transition mentioning travel",
          }],
        })
      }
      // Prose quality check
      if (userMsg.includes("show-don't-tell")) {
        return makeLLMResponse({ issues: [] })
      }
      // Rewriter
      if (userMsg.includes("ISSUES TO FIX")) {
        return makeLLMResponse({ prose: rewrittenDraft })
      }
      // Summary extractor
      if (userMsg.includes("Summarize this chapter")) {
        return makeLLMResponse({
          summary: "Rewritten chapter 2 summary",
          keyEvents: ["revised event"],
          emotionalState: "tense",
          openThreads: [],
        })
      }
      // Fact extractor
      if (userMsg.includes("Extract all concrete")) {
        return makeLLMResponse({
          facts: [{ fact: "New fact from rewrite", category: "physical" }],
        })
      }
      // Character state
      if (userMsg.includes("describe their state")) {
        return makeLLMResponse({
          characters: [{ name: "Kael", location: "Capital", emotionalState: "angry", knows: [], doesNotKnow: [] }],
        })
      }
      // Fallback
      return makeLLMResponse({ issues: [] })
    }

    const writeSpy = spyOn(Bun, "write").mockResolvedValue(0 as any)

    // using top-level import
    await runValidationPhase(novelId)

    expect(getNovel(novelId).phase).toBe("done")
    // Chapter 2 should have been rewritten
    expect(getValidationAttempts(novelId, 2)).toBe(1)
    // Open issues should be resolved after rewrite
    expect(getOpenIssues(novelId, 2)).toHaveLength(0)

    writeSpy.mockRestore()
  })

  test("marks chapter as stuck after max rewrites", async () => {
    const novelId = setupTestNovel()
    seedForValidation(novelId, 1)

    // Seed the DB with 3 prior rewrite attempts
    saveValidationPass(novelId, 1, 1, "rewritten", 1)
    saveValidationPass(novelId, 2, 1, "rewritten", 1)
    saveValidationPass(novelId, 3, 1, "rewritten", 1)

    let callCount = 0
    globalThis.fetch = async () => {
      callCount++
      // Cross-chapter check finds an issue
      if (callCount === 1) {
        return makeLLMResponse({
          issues: [{ severity: "blocker", description: "Still broken", chapter: 1 }],
        })
      }
      // Should not get further calls since chapter is stuck
      return makeLLMResponse({ issues: [] })
    }

    const writeSpy = spyOn(Bun, "write").mockResolvedValue(0 as any)

    // using top-level import
    await runValidationPhase(novelId)

    // Phase should still complete
    expect(getNovel(novelId).phase).toBe("done")
    // Should have open issues remaining (stuck, not resolved)
    expect(getOpenIssues(novelId, 1).length).toBeGreaterThan(0)

    writeSpy.mockRestore()
  })
})
