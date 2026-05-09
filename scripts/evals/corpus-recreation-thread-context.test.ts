import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  buildCorpusRecreationThreadContext,
  renderCorpusRecreationThreadContext,
} from "./corpus-recreation-thread-context"

describe("corpus-recreation-thread-context", () => {
  test("builds compact per-scene context with prior movement and future impact preview", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-thread-context-"))
    try {
      const pocDir = join(root, "poc")
      writeThreadContextFixture(pocDir)

      const report = buildCorpusRecreationThreadContext(pocDir, "2026-05-09T00:00:00.000Z")
      const sceneOne = report.contexts[0]!
      const sceneTwo = report.contexts[1]!

      expect(report.contextCount).toBe(3)
      expect(sceneOne).toMatchObject({
        sceneId: "analog-sc01",
        activeThreadIds: ["thread-main"],
        activePromiseIds: ["debt-folio"],
        activePayoffIds: [],
      })
      expect(sceneOne.futureImpactPreview).toEqual(expect.arrayContaining([
        expect.objectContaining({
          refKind: "thread",
          ref: "thread-main",
          affectedSceneIds: ["analog-sc02"],
        }),
        expect.objectContaining({
          refKind: "promise",
          ref: "debt-folio",
          affectedSceneIds: ["analog-sc02"],
        }),
      ]))
      expect(sceneTwo.activePayoffIds).toEqual(["payoff-folio-seen"])
      expect(sceneTwo.ledger.map(row => `${row.refKind}:${row.ref}`)).toEqual([
        "thread:thread-main",
        "promise:debt-folio",
        "payoff:payoff-folio-seen",
      ])
      expect(sceneTwo.priorMovements).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sceneId: "analog-sc01",
          ref: "debt-folio",
          movement: "promise_progress",
          summary: "Noor knows the folio hides imperial succession danger.",
        }),
      ]))

      const rendered = renderCorpusRecreationThreadContext(report)
      expect(rendered).toContain("Writer Context Boundary")
      expect(rendered).toContain("thread:thread-main Folio truth")
      expect(rendered).toContain("promise:debt-folio")
      expect(rendered).toContain("thread:thread-main -> analog-sc02")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("keeps structural issues visible without semantic inference", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-thread-context-"))
    try {
      const pocDir = join(root, "poc")
      writeThreadContextFixture(pocDir, {
        badObligation: {
          obligationId: "obl-missing-thread",
          sceneId: "analog-sc03",
          sourceId: "local-risk",
          requirementText: "Carry danger without a thread.",
        },
      })

      const report = buildCorpusRecreationThreadContext(pocDir, "2026-05-09T00:00:00.000Z")
      const sceneThree = report.contexts[2]!

      expect(report.issueCount).toBeGreaterThan(0)
      expect(sceneThree.structuralIssues.join("\n")).toContain("missing threadId")
      expect(renderCorpusRecreationThreadContext(report)).toContain("missing_thread_id")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeThreadContextFixture(path: string, opts: {
  badObligation?: Record<string, unknown>
} = {}): void {
  writeJson(join(path, "packet.json"), {
    sourceReference: { book: "crystal_shard", chapterLabel: "1" },
    diagnosticConfig: { plannerVariant: "baseline" },
    originalAnalogSeed: {
      storyThreads: [
        { threadId: "thread-main", kind: "plot", label: "Folio truth", description: "Noor learns the folio's political danger." },
        { threadId: "thread-rel", kind: "relationship", label: "Reluctant trust", description: "Noor and Cassius test each other." },
      ],
      storyDebts: [
        { storyDebtId: "debt-folio", threadId: "thread-main", promiseText: "The folio predicts dangerous succession facts." },
        { storyDebtId: "debt-trust", threadId: "thread-rel", promiseText: "Noor must decide if Cassius is useful or dangerous." },
      ],
      storyPayoffs: [
        { payoffId: "payoff-folio-seen", threadId: "thread-main", storyDebtId: "debt-folio", payoffText: "Noor sees the first succession reveal." },
      ],
    },
  })
  writeJson(join(path, "plan.json"), {
    chapterId: "analog-ch01",
    title: "The Deep Stacks",
    scenes: [
      {
        sceneId: "analog-sc01",
        goal: "Find the marked folio.",
        turningPoint: "The stacks close behind her.",
        outcome: "She realizes the folio is dangerous.",
        consequence: "Noor knows the folio hides imperial succession danger.",
      },
      {
        sceneId: "analog-sc02",
        goal: "Decode the folio.",
        turningPoint: "Cassius warns her what it means.",
        outcome: "Noor sees the first reveal.",
        consequence: "Noor must leave with proof and a new risk.",
      },
      {
        sceneId: "analog-sc03",
        goal: "Escape with Cassius.",
        turningPoint: "They choose a shared lie.",
        outcome: "They escape into deeper suspicion.",
        consequence: "Their trust remains unstable.",
      },
    ],
    obligations: [
      {
        obligationId: "obl-open-folio",
        sceneId: "analog-sc01",
        sourceId: "debt-folio",
        threadId: "thread-main",
        promiseId: "debt-folio",
        requirementText: "Open the folio promise.",
      },
      {
        obligationId: "obl-payoff-folio",
        sceneId: "analog-sc02",
        sourceId: "payoff-folio-seen",
        threadId: "thread-main",
        promiseId: "debt-folio",
        payoffId: "payoff-folio-seen",
        requirementText: "Pay off the first succession reveal.",
      },
      {
        obligationId: "obl-trust",
        sceneId: "analog-sc03",
        sourceId: "debt-trust",
        threadId: "thread-rel",
        promiseId: "debt-trust",
        requirementText: "Progress Noor and Cassius's trust debt.",
      },
      ...(opts.badObligation ? [opts.badObligation] : []),
    ],
  })
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
