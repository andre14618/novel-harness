import { describe, expect, test } from "bun:test"

import { buildChapterHealthReport, type ChapterHealthProposalInput } from "./chapter-health"
import type { ChapterOutline, SceneBeat } from "../types"

describe("buildChapterHealthReport", () => {
  test("recomputes validation findings with durable chapter and beat refs", () => {
    const outline = chapterOutline()
    const report = buildChapterHealthReport({
      novelId: "novel-health-test",
      generatedAt: "2026-05-05T00:00:00.000Z",
      outlines: [outline],
      drafts: [{
        chapterNumber: 1,
        prose: longProse(["Istra", '"We wait."']),
        wordCount: 520,
        version: 2,
        status: "draft",
      }],
    })

    expect(report.summary.fail).toBe(1)
    expect(report.chapters[0].status).toBe("fail")
    expect(report.chapters[0].health.latestValidationPassed).toBe(false)
    const beatFinding = report.chapters[0].findings.find((finding) =>
      finding.code === "beat_keyword_missing"
    )
    expect(beatFinding).toEqual(expect.objectContaining({
      source: "validation",
      severity: "blocker",
      chapterId: "ch-001-ledger-test",
      beatIndex: 0,
      beatId: "beat-ledger-verdict",
    }))
    expect(beatFinding?.refs).toEqual(expect.arrayContaining([
      { kind: "chapter_outline", ref: "ch-001-ledger-test" },
      { kind: "beat_plan", ref: "beat-ledger-verdict" },
    ]))
    expect(beatFinding?.stableSource).toEqual(expect.objectContaining({
      kind: "computed",
      name: "validateChapterDraft",
    }))
  })

  test("keeps missing outline and missing draft states visible", () => {
    const report = buildChapterHealthReport({
      novelId: "novel-health-test",
      totalChapters: 2,
      generatedAt: "2026-05-05T00:00:00.000Z",
      outlines: [chapterOutline()],
      drafts: [],
    })

    expect(report.chapters.map((chapter) => chapter.status)).toEqual([
      "missing_draft",
      "missing_outline",
    ])
    expect(report.summary.missingDraft).toBe(1)
    expect(report.summary.missingOutline).toBe(1)
  })

  test("folds open issues, pending proposals, trace, calls, and checker observations into the chapter", () => {
    const proposal: ChapterHealthProposalInput = {
      id: "editorial-flag:1",
      kind: "editorial_flag",
      targetKind: "chapter_outline",
      targetRef: "chapter:1",
      status: "pending",
      risk: "medium",
      summary: "warning: missing-beat-coverage @ chapter:1",
      preconditionHash: "draft-hash",
      createdAt: "2026-05-05T00:00:00.000Z",
      payload: {
        issueType: "missing-beat-coverage",
        severity: "warning",
        chapterRef: "chapter:1",
        beatRef: "beat-ledger-verdict",
      },
    }
    const report = buildChapterHealthReport({
      novelId: "novel-health-test",
      generatedAt: "2026-05-05T00:00:00.000Z",
      outlines: [chapterOutline()],
      drafts: [{
        chapterNumber: 1,
        prose: longProse(["Istra", "ledger", "verdict", "shatters", "council", '"Look."']),
        wordCount: 520,
        version: 1,
        status: "draft",
      }],
      issues: [{
        id: 11,
        chapterNumber: 1,
        severity: "warning",
        description: "Continuity issue remains open.",
      }],
      exhaustions: [{
        id: 12,
        chapterNumber: 1,
        kind: "plan-check-exhausted",
        attempt: 3,
        unresolvedDeviations: [{
          description: "Planner beat was not satisfied.",
          beat_index: 0,
          beatId: "beat-ledger-verdict",
        }],
      }],
      proposals: [proposal],
      traceEvents: [{
        id: 21,
        chapterNumber: 1,
        beatIndex: 0,
        eventType: "validation-check",
        timestamp: "2026-05-05T00:00:00.000Z",
        payload: { passed: false },
      }],
      checkerCalls: [{
        id: 31,
        chapterNumber: 1,
        agent: "halluc-ungrounded",
        beatIndex: 0,
        beatId: "beat-ledger-verdict",
        failed: false,
        zodValidationSuccess: true,
        jsonExtractionSuccess: true,
        timestamp: "2026-05-05T00:00:00.000Z",
        nerPrepass: { andGateDecision: "pass", nerFindings: [], nerOnlyFindings: [] },
      }],
      checkerObservations: [{
        id: "obs-1",
        proposalId: "editorial-flag:1",
        proposalKind: "editorial_flag",
        targetKind: "draft",
        targetRef: "chapter:1",
        chapterNumber: 1,
        checkerName: "validation",
        fired: true,
        observedAt: "2026-05-05T00:00:00.000Z",
        details: {},
      }],
    })

    const chapter = report.chapters[0]
    expect(chapter.health.pendingProposalCount).toBe(1)
    expect(chapter.findings.map((finding) => finding.source)).toEqual(expect.arrayContaining([
      "issue",
      "exhaustion",
      "proposal",
    ]))
    expect(chapter.trace.latestEvents).toHaveLength(1)
    expect(chapter.trace.checkerCalls[0].nerPrepass?.andGateDecision).toBe("pass")
    expect(chapter.proposals.envelopes[0].id).toBe("editorial-flag:1")
    expect(chapter.proposals.checkerObservations[0].id).toBe("obs-1")
  })
})

function chapterOutline(): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-001-ledger-test",
    title: "Ledger Test",
    povCharacter: "Istra",
    povCharacterId: "char-istra",
    setting: "The infirmary",
    purpose: "Reveal the forged ledger.",
    targetWords: 600,
    charactersPresent: ["Istra"],
    charactersPresentIds: ["char-istra"],
    establishedFacts: [
      { id: "fact-ledger-forgery", fact: "The ledger is forged.", category: "knowledge" },
    ],
    characterStateChanges: [],
    knowledgeChanges: [],
    scenes: [sceneBeat()],
  } as ChapterOutline
}

function sceneBeat(): SceneBeat {
  return {
    description: "Ledger verdict shatters the council.",
    characters: ["Istra"],
    kind: "action",
    beatId: "beat-ledger-verdict",
    requiredPayoffs: [],
    obligations: {
      mustEstablish: [{
        obligationId: "obl-ledger-fact",
        sourceId: "fact-ledger-forgery",
        sourceKind: "fact",
        text: "The ledger is forged.",
      } as any],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
  } as SceneBeat
}

function longProse(seedWords: string[]): string {
  const filler = Array.from({ length: 520 - seedWords.length }, (_, index) => `word${index}`)
  return [...seedWords, ...filler].join(" ")
}
