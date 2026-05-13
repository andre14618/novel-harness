import { expect, test } from "bun:test"

import { formatStoryRefIssue, validateOutlineStoryRefs } from "./story-refs"
import type { ChapterOutline } from "../types"
import type { PlanningDirectives } from "../schemas/planning-directives"

test("validateOutlineStoryRefs accepts matched thread, promise, and payoff refs", () => {
  const validation = validateOutlineStoryRefs(outline({
    threadId: "thread-folio",
    promiseId: "debt-folio",
    payoffId: "payoff-folio-reveal",
    storyDebtStage: "final_payoff",
  }), directives())

  expect(validation.issues).toEqual([])
  expect(validation.summary).toMatchObject({
    checkedObligations: 1,
    threadRefCount: 1,
    promiseRefCount: 1,
    payoffRefCount: 1,
  })
})

test("validateOutlineStoryRefs flags unknown and mismatched story refs as warnings", () => {
  const validation = validateOutlineStoryRefs(outline({
    obligationId: "obl-bad-ref",
    threadId: "thread-relationship",
    promiseId: "debt-folio",
    payoffId: "payoff-other",
    storyDebtStage: "progress",
  }), directives())

  expect(validation.issues.map(issue => issue.code)).toEqual([
    "unknown_payoff_id",
    "promise_thread_mismatch",
    "payoff_ref_on_non_payoff_stage",
  ])
  expect(validation.issues.every(issue => issue.severity === "warning")).toBe(true)
  expect(formatStoryRefIssue(validation.issues[1]!)).toContain("obl-bad-ref")
})

test("validateOutlineStoryRefs flags payoff stages missing known payoff IDs", () => {
  const validation = validateOutlineStoryRefs(outline({
    threadId: "thread-folio",
    promiseId: "debt-folio",
    storyDebtStage: "partial_payoff",
  }), directives())

  expect(validation.issues.map(issue => issue.code)).toEqual(["payoff_stage_missing_payoff_id"])
})

function directives(): PlanningDirectives {
  return {
    lockedCharacters: [],
    requiredBeats: [],
    forbidden: [],
    tonalAnchors: [],
    structuralConstraints: { povRotation: "", pacing: "" },
    storyThreads: [
      { threadId: "thread-folio", label: "Folio inquiry", description: "", kind: "" },
      { threadId: "thread-relationship", label: "Trust relationship", description: "", kind: "" },
    ],
    storyDebts: [
      { storyDebtId: "debt-folio", threadId: "thread-folio", promiseText: "The folio truth must land.", payoffPolicy: "" },
    ],
    storyPayoffs: [
      { payoffId: "payoff-folio-reveal", storyDebtId: "debt-folio", threadId: "thread-folio", payoffText: "Noor reveals the folio truth." },
    ],
    chapterContracts: [],
    chapterSequenceGuards: [],
    rawNotes: "",
  }
}

function outline(obligation: Record<string, unknown>): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-001-folio",
    title: "Folio",
    povCharacter: "Noor",
    setting: "Archive",
    purpose: "Noor follows the folio clue.",
    targetWords: 1500,
    charactersPresent: ["Noor"],
    charactersPresentIds: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    scenes: [{
      beatId: "beat-001-folio",
      description: "Noor follows the folio clue.",
      characters: ["Noor"],
      kind: "action",
      requiredPayoffs: [],
      obligations: {
        mustEstablish: [{ text: "The folio clue matters.", ...obligation } as any],
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
    }],
  }
}
