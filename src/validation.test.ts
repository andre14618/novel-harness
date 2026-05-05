import { describe, expect, test } from "bun:test"
import { validateChapterDraft } from "./validation"
import type { ChapterOutline, SceneBeat } from "./types"

const emptyObligations = {
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
}

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description: "Mira reveals the secret ledger beneath the archive.",
    characters: ["Mira"],
    kind: "revelation",
    requiredPayoffs: [],
    obligations: emptyObligations,
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  } as SceneBeat
}

function outline(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 2,
    chapterId: "ch-002-ledger",
    title: "Ledger",
    povCharacter: "Mira",
    setting: "Archive",
    purpose: "Validate findings.",
    targetWords: 700,
    charactersPresent: ["Mira"],
    charactersPresentIds: ["char-mira"],
    scenes: [
      beat({ beatId: "ch-002-ledger-beat-001-secret-ledger" }),
    ],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  } as ChapterOutline
}

function longDraft(sentence: string, count = 520): string {
  return Array.from({ length: count }, () => sentence).join(" ")
}

describe("validateChapterDraft structured findings", () => {
  test("adds stable chapter refs to advisory word-count findings", () => {
    const result = validateChapterDraft("Mira", outline())

    expect(result.passed).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.warnings).toEqual([
      "Chapter too short: 1 words (minimum 500)",
    ])
    expect(result.findings?.find(f => f.code === "word_count_min")).toMatchObject({
      severity: "warning",
      description: "Chapter too short: 1 words (minimum 500)",
      chapterNumber: 2,
      chapterId: "ch-002-ledger",
      metadata: { wordCount: 1, minimumWords: 500 },
    })
  })

  test("far-below-target word count is advisory, not blocking", () => {
    const result = validateChapterDraft(
      longDraft("Mira studies the ledger quietly.", 180),
      outline({ targetWords: 2000 }),
    )

    expect(result.passed).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.warnings).toContain("Chapter far below target: 900 words (target: 2000)")
    expect(result.findings?.find(f => f.code === "word_count_far_below")).toMatchObject({
      severity: "warning",
      chapterNumber: 2,
      chapterId: "ch-002-ledger",
      metadata: { wordCount: 900, targetWords: 2000 },
    })
  })

  test("keeps legacy blocker strings while adding structured beatId refs", () => {
    const result = validateChapterDraft(
      longDraft("Mira walks quietly through the corridor."),
      outline(),
      "validation",
    )

    expect(result.blockers).toEqual([
      "Scene beat 1 has no keyword matches — may be missing entirely",
    ])
    expect(result.findings?.find(f => f.code === "beat_keyword_missing")).toMatchObject({
      severity: "blocker",
      description: "Scene beat 1 has no keyword matches — may be missing entirely",
      chapterNumber: 2,
      chapterId: "ch-002-ledger",
      beatIndex: 0,
      beatId: "ch-002-ledger-beat-001-secret-ledger",
    })
  })

  test("adds structured low-coverage warnings without changing warning text", () => {
    const result = validateChapterDraft(
      longDraft("Mira studies the ledger quietly."),
      outline(),
      "validation",
    )

    expect(result.blockers).toEqual([])
    expect(result.warnings).toContain("Scene beat 1 has low keyword coverage (1/5)")
    expect(result.findings?.find(f => f.code === "beat_keyword_low_coverage")).toMatchObject({
      severity: "warning",
      description: "Scene beat 1 has low keyword coverage (1/5)",
      chapterNumber: 2,
      chapterId: "ch-002-ledger",
      beatIndex: 0,
      beatId: "ch-002-ledger-beat-001-secret-ledger",
      metadata: { matchedKeywords: 1, keywordCount: 5 },
    })
  })

  test("drafting mode skips beat keyword findings", () => {
    const result = validateChapterDraft(
      longDraft("Mira walks quietly through the corridor."),
      outline(),
    )

    expect(result.blockers).toEqual([])
    expect(result.findings?.some(f => f.code.startsWith("beat_keyword_"))).toBe(false)
  })
})
