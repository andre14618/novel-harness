import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  buildCharacterRefCohortReport,
  renderCharacterRefCohortReport,
} from "./corpus-recreation-character-ref-cohort"

describe("corpus-recreation-character-ref-cohort", () => {
  test("classifies local and affected character-ref closure issues", () => {
    const root = mkdtempSync(join(tmpdir(), "character-ref-cohort-"))
    try {
      const pocDir = join(root, "poc-ch1")
      writeJson(join(pocDir, "packet.json"), {
        sourceReference: { book: "crystal_shard", chapterLabel: "1" },
      })
      writeJson(join(pocDir, "plan.json"), {
        chapterId: "analog-ch01",
        scenes: [
          {
            sceneId: "analog-ch01-sc01",
            requiredCharacterIds: ["char-nara"],
            affectedCharacterIds: [],
          },
          {
            sceneId: "analog-ch01-sc02",
            requiredCharacterIds: ["char-nara", "char-kael"],
            affectedCharacterIds: ["char-tovin"],
          },
        ],
        obligations: [
          { obligationId: "obl-1", sceneId: "analog-ch01-sc02", sourceId: "char-kael", threadId: "thread-oath" },
        ],
      })
      writeJson(join(pocDir, "plan-comparison.json"), {
        sceneCount: { actual: 2 },
        sceneContract: {
          total: 2,
          declaredObligationCount: 1,
          knownSourceIdCount: 1,
          knownThreadRefCount: 1,
          sceneTurnRefIssueCount: 0,
          characterRefClosureCount: 0,
          characterRefIssueCount: 2,
        },
        issues: [
          "scene contract weak for analog-ch01-sc01: consequence characters missing affectedCharacterIds/requiredCharacterIds/source obligation: char-tovin",
        ],
      })
      writeJson(join(pocDir, "character-context.json"), {
        issueCount: 2,
        contexts: [
          {
            sceneId: "analog-ch01-sc01",
            structuralIssues: [
              "analog-ch01-sc01: character char-tovin is named in consequence but missing affectedCharacterIds/requiredCharacterIds/source obligation",
            ],
          },
          {
            sceneId: "analog-ch01-sc02",
            structuralIssues: [
              "analog-ch01-sc02: character char-kael is named in scene contract but missing requiredCharacterIds/source obligation",
            ],
          },
        ],
      })

      const report = buildCharacterRefCohortReport([pocDir], "2026-05-09T00:00:00.000Z")

      expect(report.rowCount).toBe(1)
      expect(report.totals.sceneCount).toBe(2)
      expect(report.totals.requiredCharacterRefCount).toBe(3)
      expect(report.totals.affectedCharacterRefCount).toBe(1)
      expect(report.totals.classifiedIssueCount).toBe(2)
      expect(report.totals.byKind.missing_affected_ref).toBe(1)
      expect(report.totals.byKind.missing_local_required_or_source).toBe(1)
      expect(report.rows[0]!.classifiedIssues.map(issue => issue.characterIds)).toEqual([
        ["char-tovin"],
        ["char-kael"],
      ])

      const rendered = renderCharacterRefCohortReport(report)
      expect(rendered).toContain("Character refs closed: 0/2")
      expect(rendered).toContain("missing_affected_ref: 1")
      expect(rendered).toContain("missing_local_required_or_source: 1")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
