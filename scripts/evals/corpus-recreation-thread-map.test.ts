import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  buildCorpusRecreationThreadMap,
  renderCorpusRecreationThreadMap,
} from "./corpus-recreation-thread-map"

describe("corpus-recreation-thread-map", () => {
  test("maps thread, promise, payoff, and impact refs from POC plans", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-thread-map-"))
    try {
      const pocDir = join(root, "poc")
      writeThreadMapFixture(pocDir)

      const report = buildCorpusRecreationThreadMap([pocDir], "2026-05-09T00:00:00.000Z")

      expect(report.rowCount).toBe(4)
      expect(report.horizonNoteCount).toBe(0)
      expect(report.scenes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sceneId: "analog-sc01",
          movementCount: 2,
          sceneTurnIds: ["turn-sc01-folio-reveal"],
          threadIds: ["thread-main"],
          promiseIds: ["debt-folio"],
          payoffIds: ["payoff-folio-seen"],
        }),
        expect.objectContaining({
          sceneId: "analog-sc02",
          movementCount: 1,
          threadIds: ["thread-rel"],
          promiseIds: [],
        }),
      ]))
      expect(report.threads).toEqual(expect.arrayContaining([
        expect.objectContaining({
          threadId: "thread-main",
          obligationCount: 2,
          sceneIds: ["analog-sc01"],
          promiseIds: ["debt-folio"],
          payoffIds: ["payoff-folio-seen"],
        }),
      ]))
      expect(report.promises).toEqual(expect.arrayContaining([
        expect.objectContaining({
          promiseId: "debt-folio",
          progressSceneIds: ["analog-sc01"],
          payoffSceneIds: ["analog-sc01"],
          payoffIds: ["payoff-folio-seen"],
        }),
      ]))
      expect(report.sceneTurns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sceneTurnId: "turn-sc01-folio-reveal",
          sceneId: "analog-sc01",
          obligationIds: ["obl-open-folio", "obl-payoff-folio"],
          threadIds: ["thread-main"],
          promiseIds: ["debt-folio"],
          payoffIds: ["payoff-folio-seen"],
          issueCount: 0,
        }),
      ]))
      expect(report.impacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          refKind: "sceneTurn",
          ref: "turn-sc01-folio-reveal",
          affectedSceneIds: ["analog-sc01"],
          affectedObligationIds: ["obl-open-folio", "obl-payoff-folio"],
        }),
        expect.objectContaining({
          refKind: "thread",
          ref: "thread-main",
          affectedSceneIds: ["analog-sc01"],
          affectedObligationIds: ["obl-open-folio", "obl-payoff-folio"],
        }),
        expect.objectContaining({
          refKind: "payoff",
          ref: "payoff-folio-seen",
          affectedSceneIds: ["analog-sc01"],
        }),
      ]))

      const rendered = renderCorpusRecreationThreadMap(report)
      expect(rendered).toContain("## Scenes")
      expect(rendered).toContain("## Scene Turns")
      expect(rendered).toContain("## Impact Preview")
      expect(rendered).toContain("## Horizon Notes")
      expect(rendered).toContain("turn-sc01-folio-reveal")
      expect(rendered).toContain("thread-main")
      expect(rendered).toContain("payoff-folio-seen")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("reports missing, unrouted, and mismatched refs without semantic judgment", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-thread-map-"))
    try {
      const pocDir = join(root, "poc")
      writeThreadMapFixture(pocDir, {
        extraObligations: [
          {
            obligationId: "obl-wrong-promise-thread",
            sceneId: "analog-sc02",
            sourceId: "debt-trust",
            threadId: "thread-main",
            promiseId: "debt-trust",
            payoffId: "payoff-folio-seen",
            requirementText: "Incorrectly combine the relationship debt with the folio payoff.",
          },
          {
            obligationId: "obl-unknown-thread",
            sceneId: "analog-sc02",
            sourceId: "unknown",
            threadId: "thread-unknown",
            requirementText: "Point to an unknown thread.",
          },
          {
            obligationId: "obl-wrong-turn-scene",
            sceneId: "analog-sc02",
            sceneTurnId: "turn-sc01-folio-reveal",
            sourceId: "local-risk",
            threadId: "thread-rel",
            requirementText: "Point an obligation to a turn from another scene.",
          },
          {
            obligationId: "obl-unknown-turn",
            sceneId: "analog-sc02",
            sceneTurnId: "turn-missing",
            sourceId: "local-risk",
            threadId: "thread-rel",
            requirementText: "Point an obligation to an unknown turn.",
          },
        ],
      })

      const report = buildCorpusRecreationThreadMap([pocDir], "2026-05-09T00:00:00.000Z")
      const codes = report.issues.map(issue => issue.code)

      expect(codes).toContain("story_debt_without_promise_ref")
      expect(codes).toContain("missing_thread_id")
      expect(codes).toContain("promise_thread_mismatch")
      expect(codes).toContain("payoff_promise_mismatch")
      expect(codes).toContain("unknown_thread_id")
      expect(codes).toContain("scene_turn_scene_mismatch")
      expect(codes).toContain("unknown_scene_turn_id")
      expect(report.rows.find(row => row.obligationId === "obl-unrouted-debt")?.movement).toBe("unrouted_story_debt")

      const rendered = renderCorpusRecreationThreadMap(report)
      expect(rendered).toContain("sourceId debt-trust is a story debt but promiseId is missing")
      expect(rendered).toContain("payoffId payoff-folio-seen belongs to debt-folio, not debt-trust")
      expect(rendered).toContain("sceneTurnId turn-sc01-folio-reveal belongs to scene analog-sc01, not analog-sc02")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("treats active promises without local payoff as horizon notes, not issues", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-thread-map-"))
    try {
      const pocDir = join(root, "poc")
      writeThreadMapFixture(pocDir, {
        extraPayoffs: [
          {
            payoffId: "payoff-trust-earned",
            storyDebtId: "debt-trust",
            threadId: "thread-rel",
            payoffText: "Noor and Cassius earn trust later.",
          },
        ],
        extraObligations: [
          {
            obligationId: "obl-progress-trust",
            sceneId: "analog-sc02",
            sourceId: "debt-trust",
            threadId: "thread-rel",
            promiseId: "debt-trust",
            requirementText: "Progress the trust promise but leave it unresolved.",
          },
        ],
      })

      const report = buildCorpusRecreationThreadMap([pocDir], "2026-05-09T00:00:00.000Z")

      expect(report.issueCount).toBeGreaterThan(0)
      expect(report.issues.map(issue => issue.code)).not.toContain("promise_without_payoff")
      expect(report.issues.map(issue => issue.code)).not.toContain("payoff_without_scene")
      expect(report.horizonNotes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "open_promise_no_report_payoff",
          ref: "debt-trust",
        }),
        expect.objectContaining({
          code: "planned_payoff_not_in_report",
          ref: "payoff-trust-earned",
        }),
      ]))
      expect(renderCorpusRecreationThreadMap(report)).toContain("treat as future-horizon")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("resolves horizon notes when a later POC dir lands the payoff", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-thread-map-"))
    try {
      const chapterOne = join(root, "chapter-one")
      const chapterTwo = join(root, "chapter-two")
      const trustPayoff = {
        payoffId: "payoff-trust-earned",
        storyDebtId: "debt-trust",
        threadId: "thread-rel",
        payoffText: "Noor and Cassius earn trust later.",
      }
      writeThreadMapFixture(chapterOne, {
        extraPayoffs: [trustPayoff],
        extraObligations: [
          {
            obligationId: "obl-progress-trust",
            sceneId: "analog-sc02",
            sourceId: "debt-trust",
            threadId: "thread-rel",
            promiseId: "debt-trust",
            requirementText: "Progress the trust promise but leave it unresolved.",
          },
        ],
      })
      writeThreadMapFixture(chapterTwo, {
        extraPayoffs: [trustPayoff],
        extraObligations: [
          {
            obligationId: "obl-payoff-trust",
            sceneId: "analog-sc02",
            sourceId: "payoff-trust-earned",
            threadId: "thread-rel",
            promiseId: "debt-trust",
            payoffId: "payoff-trust-earned",
            requirementText: "Land the trust payoff in the later sample.",
          },
        ],
      })

      const report = buildCorpusRecreationThreadMap([chapterOne, chapterTwo], "2026-05-09T00:00:00.000Z")
      const horizonRefs = report.horizonNotes.map(note => note.ref)

      expect(horizonRefs).not.toContain("debt-trust")
      expect(horizonRefs).not.toContain("payoff-trust-earned")
      expect(report.impacts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          refKind: "payoff",
          ref: "payoff-trust-earned",
          affectedSceneIds: ["analog-sc02"],
        }),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeThreadMapFixture(path: string, opts: {
  extraObligations?: Array<Record<string, unknown>>
  extraPayoffs?: Array<Record<string, unknown>>
  extraSceneTurns?: Array<Record<string, unknown>>
} = {}): void {
  writeJson(join(path, "packet.json"), {
    sourceReference: { book: "crystal_shard", chapterLabel: "1" },
    diagnosticConfig: { plannerVariant: "baseline" },
    originalAnalogSeed: {
      storyThreads: [
        { threadId: "thread-main", kind: "plot", label: "Folio truth" },
        { threadId: "thread-rel", kind: "relationship", label: "Reluctant trust" },
      ],
      storyDebts: [
        { storyDebtId: "debt-folio", threadId: "thread-main", promiseText: "The folio contains a dangerous truth." },
        { storyDebtId: "debt-trust", threadId: "thread-rel", promiseText: "Noor and Cassius must decide whether to trust each other." },
      ],
      storyPayoffs: [
        { payoffId: "payoff-folio-seen", storyDebtId: "debt-folio", threadId: "thread-main", payoffText: "Noor sees what the folio predicts." },
        ...(opts.extraPayoffs ?? []),
      ],
    },
  })
  writeJson(join(path, "plan.json"), {
    chapterId: "analog-ch01",
    scenes: [
      { sceneId: "analog-sc01", consequence: "Noor understands the folio is dangerous." },
      { sceneId: "analog-sc02", consequence: "Noor and Cassius leave with unresolved trust." },
    ],
    sceneTurns: [
      {
        sceneTurnId: "turn-sc01-folio-reveal",
        sceneId: "analog-sc01",
        summary: "Noor opens the folio and learns it carries a dangerous prediction.",
        turnType: "reveal",
      },
      ...(opts.extraSceneTurns ?? []),
    ],
    obligations: [
      {
        obligationId: "obl-open-folio",
        sceneId: "analog-sc01",
        sceneTurnId: "turn-sc01-folio-reveal",
        sourceId: "debt-folio",
        threadId: "thread-main",
        promiseId: "debt-folio",
        requirementText: "Open the folio promise.",
        materialityTest: "The folio changes Noor's choices.",
      },
      {
        obligationId: "obl-payoff-folio",
        sceneId: "analog-sc01",
        sceneTurnId: "turn-sc01-folio-reveal",
        sourceId: "payoff-folio-seen",
        threadId: "thread-main",
        promiseId: "debt-folio",
        payoffId: "payoff-folio-seen",
        requirementText: "Pay off the first folio reveal.",
      },
      {
        obligationId: "obl-unrouted-debt",
        sceneId: "analog-sc02",
        sourceId: "debt-trust",
        threadId: "thread-rel",
        requirementText: "Progress the trust debt without a promise ref.",
      },
      {
        obligationId: "obl-missing-thread",
        sceneId: "analog-sc02",
        sourceId: "local-risk",
        requirementText: "Carry local danger without a thread ref.",
      },
      ...(opts.extraObligations ?? []),
    ],
  })
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
