import { describe, expect, test } from "bun:test"
import type { ChapterOutline } from "../types"
import type { PlanAssistGatePayload } from "../gates"
import {
  buildPlanAssistOutlineLineage,
  buildPlanAssistOverrideLineage,
  normalizePlanAssistReplacementOutline,
} from "./plan-assist-lineage"

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterId: "ch-001-existing",
    chapterNumber: 1,
    title: "Original",
    povCharacter: "Ari",
    setting: "Archive",
    purpose: "Show the secret",
    targetWords: 1200,
    scenes: [{
      beatId: "ch-001-existing-beat-001-open-door",
      description: "Ari opens the door",
      kind: "setup",
      characters: ["Ari"],
    }],
    charactersPresent: ["Ari"],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  } as ChapterOutline
}

function payload(): PlanAssistGatePayload {
  return {
    kind: "plan-check-exhausted",
    novelId: "novel-1",
    chapter: 1,
    attempt: 3,
    outline: outline(),
    prose: "draft",
    unresolvedDeviations: [{ description: "missing beat", beat_index: 0, beatId: "beat-1" }],
  }
}

describe("plan-assist planning lineage", () => {
  test("normalizes replacement outlines while preserving chapter identity", () => {
    const previous = outline()
    const replacement = outline({
      chapterId: "ch-999-wrong",
      chapterNumber: 99,
      title: "Replacement",
      scenes: [{ description: "Ari chooses a new door", kind: "action", characters: ["Ari"] } as any],
    })

    const normalized = normalizePlanAssistReplacementOutline(previous, replacement)

    expect(normalized.chapterId).toBe("ch-001-existing")
    expect(normalized.chapterNumber).toBe(1)
    expect(normalized.title).toBe("Replacement")
    expect(normalized.scenes[0]?.beatId?.startsWith("ch-001-existing-beat-001")).toBe(true)
  })

  test("builds chapter_exhaustions-sourced lineage for edit-plan", () => {
    const previous = outline()
    const next = normalizePlanAssistReplacementOutline(previous, outline({
      title: "Replacement",
      scenes: [{ description: "Ari chooses a new door", kind: "action", characters: ["Ari"] } as any],
    }))

    const lineage = buildPlanAssistOutlineLineage({
      novelId: "novel-1",
      chapter: 1,
      payload: payload(),
      exhaustionId: 42,
      previousOutline: previous,
      nextOutline: next,
      changedAt: "2026-05-05T12:00:00.000Z",
    })

    expect(lineage).toMatchObject({
      proposalId: "42",
      proposalKind: "planning_edit",
      sourceTable: "chapter_exhaustions",
      source: "plan-assist:plan-check-exhausted",
      targetKind: "chapter_outline",
      previousRef: "ch-001-existing",
      nextRef: "ch-001-existing",
      fieldPath: "outline",
      metadata: {
        decision: "edit-plan",
        attempt: 3,
        planAssistKind: "plan-check-exhausted",
      },
    })
    expect(lineage.affectedDownstreamRefs.map((ref) => ref.kind)).toContain("beat_plan")
  })

  test("builds chapter_exhaustions-sourced lineage for override", () => {
    const lineage = buildPlanAssistOverrideLineage({
      novelId: "novel-1",
      chapter: 1,
      payload: payload(),
      exhaustionId: 43,
      outline: outline(),
      previousValue: false,
      nextValue: true,
      changedAt: "2026-05-05T12:00:00.000Z",
    })

    expect(lineage).toMatchObject({
      proposalId: "43",
      proposalKind: "planning_edit",
      sourceTable: "chapter_exhaustions",
      targetKind: "chapter_outline",
      previousRef: "ch-001-existing",
      nextRef: "ch-001-existing",
      fieldPath: "planCheckOverridden",
      metadata: {
        decision: "override",
        previousValue: false,
        nextValue: true,
      },
    })
  })
})
