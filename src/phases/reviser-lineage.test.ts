import { describe, expect, test } from "bun:test"
import type { ChapterOutline } from "../types"
import { buildReviserAcceptedLineage } from "./reviser-lineage"

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
      kind: "action",
      characters: ["Ari"],
    } as any],
    charactersPresent: ["Ari"],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  } as ChapterOutline
}

describe("chapter-plan-reviser planning lineage", () => {
  test("builds chapter_revisions-sourced lineage for accepted plan-check revisions", () => {
    const previous = outline()
    const next = outline({
      scenes: [{
        beatId: "ch-001-existing-beat-001-open-door",
        description: "Ari opens the hidden door",
        kind: "action",
        characters: ["Ari"],
      } as any],
    })

    const lineage = buildReviserAcceptedLineage({
      novelId: "novel-1",
      chapter: 1,
      attempt: 2,
      source: "plan-check",
      revisionId: 99,
      previousOutline: previous,
      nextOutline: next,
      issueCount: 3,
      changedAt: "2026-05-05T12:00:00.000Z",
    })

    expect(lineage).toMatchObject({
      proposalId: "99",
      proposalKind: "planning_edit",
      sourceTable: "chapter_revisions",
      actorKind: "agent",
      actorRef: "chapter-plan-reviser",
      source: "chapter-plan-reviser:plan-check",
      targetKind: "chapter_outline",
      previousRef: "ch-001-existing",
      nextRef: "ch-001-existing",
      fieldPath: "outline",
      metadata: {
        chapter: 1,
        attempt: 2,
        source: "plan-check",
        revisionId: 99,
        issueCount: 3,
      },
    })
    expect(lineage.affectedDownstreamRefs.map((ref) => ref.ref)).toContain("ch-001-existing-beat-001-open-door")
  })

  test("falls back to deterministic source ids when a revision row id is unavailable", () => {
    const lineage = buildReviserAcceptedLineage({
      novelId: "novel-1",
      chapter: 1,
      attempt: 2,
      source: "validation",
      previousOutline: outline(),
      nextOutline: outline({ purpose: "Show the secret with clearer causality" }),
      issueCount: 1,
      changedAt: "2026-05-05T12:00:00.000Z",
    })

    expect(lineage.proposalId.startsWith("chapter-reviser:")).toBe(true)
    expect(lineage.source).toBe("chapter-plan-reviser:validation")
    expect(lineage.metadata.revisionId).toBeNull()
  })
})
