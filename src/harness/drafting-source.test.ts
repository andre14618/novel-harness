import { describe, expect, test } from "bun:test"
import {
  assessSourceDraftingIsolation,
  formatSourceDraftingIsolationAssessment,
  sourceDraftingIsolationIssue,
} from "./drafting-source"

describe("drafting source isolation", () => {
  test("accepts a clean chapter-1 source with outlines and no drafts", () => {
    expect(sourceDraftingIsolationIssue({
      phase: "drafting",
      currentChapter: 1,
      outlineCount: 2,
      draftCount: 0,
    })).toBeNull()
  })

  test("rejects a source that already has drafts", () => {
    expect(sourceDraftingIsolationIssue({
      phase: "drafting",
      currentChapter: 1,
      outlineCount: 2,
      draftCount: 2,
    })).toMatch(/already has 2 chapter_drafts/)
  })

  test("rejects terminal phase sources even without visible drafts", () => {
    expect(sourceDraftingIsolationIssue({
      phase: "complete",
      currentChapter: 3,
      outlineCount: 2,
      draftCount: 0,
    })).toMatch(/phase is complete/)
  })

  test("rejects sources advanced beyond chapter 1", () => {
    expect(sourceDraftingIsolationIssue({
      phase: "drafting",
      currentChapter: 2,
      outlineCount: 2,
      draftCount: 0,
    })).toMatch(/current_chapter is 2/)
  })

  test("formats an advisory assessment with operator guidance", () => {
    const assessment = assessSourceDraftingIsolation({
      phase: "drafting",
      currentChapter: 1,
      outlineCount: 2,
      draftCount: 1,
    })

    expect(assessment.clean).toBe(false)
    expect(formatSourceDraftingIsolationAssessment(assessment)).toContain("explicit contaminated-source flag")
  })
})
