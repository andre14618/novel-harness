import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildDraftingLengthAttributionReport,
  loadDraftingRunReportRef,
  renderDraftingLengthAttributionReport,
} from "./drafting-length-attribution"

describe("drafting-length-attribution", () => {
  test("joins sidecars and classifies mixed load plus budget-control evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "drafting-length-attribution-"))
    try {
      const planningDir = join(dir, "planning")
      const proseDir = join(dir, "prose")
      const sceneDir = join(dir, "scene")
      const checkerDir = join(dir, "checker")
      mkdirSync(planningDir, { recursive: true })
      mkdirSync(proseDir, { recursive: true })
      mkdirSync(sceneDir, { recursive: true })
      mkdirSync(checkerDir, { recursive: true })

      writeJson(join(planningDir, "planning-drafting-context-report.json"), {
        upstream: {
          scenesWithObligations: 3,
          sceneLoad: {
            chapters: [
              { chapterNumber: 1, sceneCount: 3, targetWords: 900, targetWordsPerScene: 300, signal: "balanced" },
            ],
          },
        },
      })
      writeJson(join(proseDir, "prose-semantic-report.json"), {
        telemetry: {
          dimensionMeans: { earnedLength: 2 },
          harnessGuidance: { lengthSignal: "not_falsified_as_padding" },
          chapterSummaries: [
            {
              chapterNumber: 1,
              targetWords: 900,
              proseWords: 1200,
              wordRatio: 1.333,
              labels: { earnedLength: "LENGTH-2" },
              ordinals: { earnedLength: 2 },
              lowDimensions: [],
              errorDimensions: [],
            },
          ],
        },
      })
      writeJson(join(sceneDir, "scene-semantic-review.json"), {
        results: [
          semanticRow(0, "endpointLanding", "ENDPOINT-2", 2, {
            obligationIds: ["obl-1", "obl-2", "obl-3"],
            sourceIds: ["fact-1", "fact-2", "state-1"],
            words: 420,
          }),
          semanticRow(0, "sceneDramaturgy", "SCENE-3", 3, {
            obligationIds: ["obl-1", "obl-2", "obl-3"],
            sourceIds: ["fact-1", "fact-2", "state-1"],
            words: 420,
          }),
          semanticRow(1, "endpointLanding", "ENDPOINT-2", 2, {
            obligationIds: ["obl-4", "obl-5"],
            sourceIds: ["fact-3", "fact-4"],
            words: 395,
          }),
          semanticRow(2, "endpointLanding", "ENDPOINT-3", 3, {
            obligationIds: [],
            sourceIds: [],
            words: 390,
          }),
        ],
      })
      writeJson(join(checkerDir, "checker-warning-report.json"), {
        totalItems: 2,
        chapters: [
          {
            chapter: 1,
            items: [
              { chapter: 1, beatIndex: 0, severity: "warning", polarity: "negative" },
              { chapter: 1, beatIndex: 1, severity: "warning", polarity: "ambiguous" },
            ],
          },
        ],
      })
      const runPath = join(dir, "drafting-isolated-report.json")
      writeJson(runPath, {
        source: "fixture",
        targetPrefix: "length-test",
        results: [
          {
            arm: "drafting-brief-tight-v1",
            novelId: "novel-a",
            totalWords: 1200,
            totalTarget: 900,
            meanRatio: 1.333,
            draftingBrief: { avgSelectedPromptChars: 8000, avgFullContextPromptChars: 7000, avgCharsRatio: 1.14, totalCharsDelta: 1000 },
            planningContext: { outputDir: planningDir },
            proseSemantic: { outputDir: proseDir, lowRows: 0, errorRows: 0, lengthSignal: "not_falsified_as_padding" },
            sceneSemantic: { outputDir: sceneDir, lowRows: 0, errorRows: 0 },
            checkerReadiness: { outputDir: checkerDir, warningItems: 2 },
          },
        ],
      })

      const report = buildDraftingLengthAttributionReport({
        refs: [loadDraftingRunReportRef(runPath)],
        generatedAt: "2026-05-12T00:00:00.000Z",
      })

      const arm = report.runs[0]!.arms[0]!
      expect(arm.chapterRows[0]).toMatchObject({ sceneCount: 3, checkerWarnings: 2 })
      expect(arm.sceneRows).toHaveLength(3)
      expect(arm.sceneRows[0]).toMatchObject({
        proseWords: 420,
        wordRatio: 1.4,
        obligationCount: 3,
        sourceRefCount: 3,
        checkerWarnings: 1,
      })
      expect(arm.telemetry.cleanSceneSemantics).toBe(true)
      expect(arm.telemetry.highOverTargetSceneCount).toBe(3)
      expect(arm.telemetry.loadPressureSceneCount).toBe(2)
      expect(arm.attribution.primaryCause).toBe("mixed_scope_load_and_budget_control")
      expect(renderDraftingLengthAttributionReport(report)).toContain("cause=mixed_scope_load_and_budget_control")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("flags low-load over-target scenes as writer expansion or budget-control evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "drafting-length-low-load-"))
    try {
      const planningDir = join(dir, "planning")
      const proseDir = join(dir, "prose")
      const sceneDir = join(dir, "scene")
      mkdirSync(planningDir, { recursive: true })
      mkdirSync(proseDir, { recursive: true })
      mkdirSync(sceneDir, { recursive: true })
      writeJson(join(planningDir, "planning-drafting-context-report.json"), {
        upstream: {
          scenesWithObligations: 0,
          sceneLoad: {
            chapters: [
              { chapterNumber: 1, sceneCount: 4, targetWords: 1200, targetWordsPerScene: 300, signal: "balanced" },
            ],
          },
        },
      })
      writeJson(join(proseDir, "prose-semantic-report.json"), {
        telemetry: {
          dimensionMeans: { earnedLength: 2 },
          harnessGuidance: { lengthSignal: "not_falsified_as_padding" },
          chapterSummaries: [
            { chapterNumber: 1, targetWords: 1200, proseWords: 1640, wordRatio: 1.367, labels: {}, ordinals: {} },
          ],
        },
      })
      writeJson(join(sceneDir, "scene-semantic-review.json"), {
        results: [0, 1, 2, 3].flatMap(sceneIndex => [
          semanticRow(sceneIndex, "endpointLanding", "ENDPOINT-2", 2, {
            obligationIds: [],
            sourceIds: [],
            words: 410,
          }),
          semanticRow(sceneIndex, "sceneDramaturgy", "SCENE-2", 2, {
            obligationIds: [],
            sourceIds: [],
            words: 410,
          }),
        ]),
      })
      const runPath = join(dir, "drafting-isolated-report.json")
      writeJson(runPath, {
        targetPrefix: "low-load",
        results: [
          {
            arm: "drafting-brief-tight-v1",
            totalWords: 1640,
            totalTarget: 1200,
            meanRatio: 1.367,
            planningContext: { outputDir: planningDir },
            proseSemantic: { outputDir: proseDir, lowRows: 0, errorRows: 0, lengthSignal: "not_falsified_as_padding" },
            sceneSemantic: { outputDir: sceneDir, lowRows: 0, errorRows: 0 },
          },
        ],
      })
      const report = buildDraftingLengthAttributionReport({
        refs: [loadDraftingRunReportRef(runPath)],
        generatedAt: "2026-05-12T00:00:00.000Z",
      })
      const arm = report.runs[0]!.arms[0]!
      expect(arm.telemetry.lowLoadOverTargetSceneCount).toBe(4)
      expect(arm.attribution.primaryCause).toBe("writer_expansion_or_budget_control")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function semanticRow(
  sceneIndex: number,
  dimension: string,
  label: string,
  ordinal: number,
  opts: {
    obligationIds: string[]
    sourceIds: string[]
    words: number
  },
): Record<string, unknown> {
  return {
    chapterNumber: 1,
    sceneIndex,
    sceneId: `scene-${sceneIndex + 1}`,
    dimension,
    label,
    ordinal,
    confidence: 0.9,
    obligationIds: opts.obligationIds,
    sourceIds: opts.sourceIds,
    excerpt: [
      "SCENE CONTRACT:",
      `Scene id: scene-${sceneIndex + 1}`,
      "",
      "SCENE PROSE (captured beat-writer response for this scene):",
      repeatedWords(opts.words),
    ].join("\n"),
  }
}

function repeatedWords(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ")
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
