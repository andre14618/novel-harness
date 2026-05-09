import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  buildCorpusRecreationSequenceAudit,
  renderCorpusRecreationSequenceAudit,
} from "./corpus-recreation-sequence-audit"

describe("corpus-recreation-sequence-audit", () => {
  test("flags repeated parent payoff IDs without child events and progress after final payoff", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-sequence-audit-"))
    try {
      const ch1 = join(root, "ch1")
      const ch2 = join(root, "ch2")
      writePoc(ch1, "1", [
        {
          obligationId: "obl-open",
          sceneId: "sc01",
          threadId: "thread-key",
          promiseId: "debt-key",
        },
        {
          obligationId: "obl-payoff",
          sceneId: "sc02",
          threadId: "thread-key",
          promiseId: "debt-key",
          payoffId: "payoff-key",
        },
      ])
      writePoc(ch2, "2", [
        {
          obligationId: "obl-progress-after-payoff",
          sceneId: "sc01",
          threadId: "thread-key",
          promiseId: "debt-key",
        },
        {
          obligationId: "obl-repeat-payoff",
          sceneId: "sc02",
          threadId: "thread-key",
          promiseId: "debt-key",
          payoffId: "payoff-key",
        },
      ])

      const report = buildCorpusRecreationSequenceAudit([ch1, ch2], "2026-05-09T00:00:00.000Z")
      const codes = report.findings.map(finding => finding.code)

      expect(codes).toContain("payoff_id_reused_without_event_id")
      expect(codes).toContain("promise_continues_after_final_payoff")
      expect(report.promises).toContainEqual(expect.objectContaining({
        promiseId: "debt-key",
        progressAfterFinalPayoff: ["2/sc01"],
      }))
      expect(report.payoffs).toContainEqual(expect.objectContaining({
        payoffId: "payoff-key",
        chapterLabels: ["1", "2"],
        payoffEventIds: [],
      }))

      const rendered = renderCorpusRecreationSequenceAudit(report)
      expect(rendered).toContain("payoff_id_reused_without_event_id")
      expect(rendered).toContain("promise_continues_after_final_payoff")
      expect(rendered).toContain("## Interpretation Boundary")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("allows one promise to progress before a later single payoff", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-sequence-audit-"))
    try {
      const ch1 = join(root, "ch1")
      const ch2 = join(root, "ch2")
      writePoc(ch1, "1", [
        {
          obligationId: "obl-open",
          sceneId: "sc01",
          threadId: "thread-key",
          promiseId: "debt-key",
        },
      ])
      writePoc(ch2, "2", [
        {
          obligationId: "obl-payoff",
          sceneId: "sc01",
          threadId: "thread-key",
          promiseId: "debt-key",
          payoffId: "payoff-key-final",
        },
      ])

      const report = buildCorpusRecreationSequenceAudit([ch1, ch2], "2026-05-09T00:00:00.000Z")

      expect(report.findings).toEqual([])
      expect(report.promises).toContainEqual(expect.objectContaining({
        promiseId: "debt-key",
        firstProgress: "1/sc01",
        firstFinalPayoff: "2/sc01",
        progressAfterFinalPayoff: [],
      }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("allows repeated parent payoff IDs when child event IDs and partial stages distinguish local events", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-sequence-audit-"))
    try {
      const ch1 = join(root, "ch1")
      const ch2 = join(root, "ch2")
      writePoc(ch1, "1", [
        {
          obligationId: "obl-partial-one",
          sceneId: "sc01",
          threadId: "thread-key",
          promiseId: "debt-key",
          payoffId: "payoff-key",
          payoffEventId: "payoff-event-ch01-key-glimpse",
          storyDebtStage: "partial_payoff",
        },
      ])
      writePoc(ch2, "2", [
        {
          obligationId: "obl-progress",
          sceneId: "sc01",
          threadId: "thread-key",
          promiseId: "debt-key",
          storyDebtStage: "progress",
        },
        {
          obligationId: "obl-partial-two",
          sceneId: "sc02",
          threadId: "thread-key",
          promiseId: "debt-key",
          payoffId: "payoff-key",
          payoffEventId: "payoff-event-ch02-key-cost",
          storyDebtStage: "partial_payoff",
        },
      ])

      const report = buildCorpusRecreationSequenceAudit([ch1, ch2], "2026-05-09T00:00:00.000Z")

      expect(report.findings).toEqual([])
      expect(report.payoffs).toContainEqual(expect.objectContaining({
        payoffId: "payoff-key",
        payoffEventIds: ["payoff-event-ch01-key-glimpse", "payoff-event-ch02-key-cost"],
      }))
      expect(report.promises).toContainEqual(expect.objectContaining({
        promiseId: "debt-key",
        firstFinalPayoff: null,
        progressAfterFinalPayoff: [],
      }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writePoc(
  dir: string,
  chapterLabel: string,
  obligations: Array<{
    obligationId: string
    sceneId: string
    threadId?: string
    promiseId?: string
    payoffId?: string
    payoffEventId?: string
    storyDebtStage?: string
  }>,
): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "packet.json"), `${JSON.stringify({
    sourceReference: {
      book: "fixture",
      chapterLabel,
    },
  }, null, 2)}\n`)
  writeFileSync(join(dir, "plan.json"), `${JSON.stringify({
    chapterId: `analog-ch${chapterLabel.padStart(2, "0")}`,
    scenes: [
      { sceneId: "sc01" },
      { sceneId: "sc02" },
    ],
    obligations,
  }, null, 2)}\n`)
}
