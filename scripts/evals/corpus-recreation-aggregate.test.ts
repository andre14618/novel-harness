import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  buildCorpusRecreationAggregate,
  renderCorpusRecreationAggregate,
} from "./corpus-recreation-aggregate"

describe("corpus-recreation-aggregate", () => {
  test("joins deterministic POC checks with semantic review summaries", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-aggregate-"))
    try {
      const pocDir = join(root, "poc-ch1")
      writeJson(join(pocDir, "packet.json"), {
        sourceReference: { book: "crystal_shard", chapterLabel: "1" },
        diagnosticConfig: { plannerVariant: "materiality-v1" },
      })
      writeJson(join(pocDir, "plan-comparison.json"), {
        sceneCount: { expected: 2, actual: 2 },
        sceneContract: {
          total: 2,
          choiceAlternativeCount: 2,
          declaredObligationCount: 2,
          knownSourceIdCount: 2,
          observableConsequenceCount: 1,
        },
        issues: ["scene contract weak for scene-b"],
      })
      writeJson(join(pocDir, "chapter-comparison.json"), {
        wordCount: { target: 1000, actual: 820, ratio: 0.82 },
        sceneWordCounts: [
          { sceneId: "scene-a", meetsMinimum: true },
          { sceneId: "scene-b", meetsMinimum: false },
        ],
        sourceBoundary: { forbiddenTermsPresent: [] },
        issues: [],
        warnings: ["scene prose below advisory floor for scene-b"],
      })
      writeJson(join(pocDir, "semantic-review-live/semantic-review.json"), {
        taskCount: 4,
        skipCount: 1,
        summaries: [
          { dimension: "sceneDramaturgy", count: 2, meanOrdinal: 2, lowCount: 0, labelCounts: { "SCENE-2": 2 } },
          { dimension: "worldFactPressure", count: 2, meanOrdinal: 1.5, lowCount: 1, labelCounts: { "WFACT-1": 1, "WFACT-2": 1 } },
        ],
        results: [
          { sceneId: "scene-a", dimension: "sceneDramaturgy", label: "SCENE-2", ordinal: 2 },
          {
            sceneId: "scene-b",
            dimension: "worldFactPressure",
            label: "WFACT-1",
            ordinal: 1,
            missingForNextLevel: "world fact must change the outcome",
          },
        ],
      })

      const aggregate = buildCorpusRecreationAggregate([pocDir], "2026-05-09T00:00:00.000Z")
      expect(aggregate.rows[0]).toMatchObject({
        chapterLabel: "1",
        plannerVariant: "materiality-v1",
        actualScenes: 2,
        expectedScenes: 2,
        actualWords: 820,
        targetWords: 1000,
        planIssueCount: 1,
        chapterIssueCount: 0,
        chapterWarningCount: 1,
        sceneMinimumFailures: 1,
        contractObservableConsequenceCount: 1,
        semanticTaskCount: 4,
        semanticSkipCount: 1,
        semanticLowCount: 1,
      })

      const rendered = renderCorpusRecreationAggregate(aggregate)
      expect(rendered).toContain("choices 2/2; ids 2/2; conseq 1/2")
      expect(rendered).toContain("| 1 | materiality-v1 |")
      expect(rendered).toContain("Warnings")
      expect(rendered).toContain("scene-floor 1")
      expect(rendered).toContain("4 tasks; low 1; skips 1")
      expect(rendered).toContain("scene-b worldFactPressure WFACT-1: world fact must change the outcome")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeJson(path: string, value: unknown): void {
  const dir = path.slice(0, path.lastIndexOf("/"))
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
