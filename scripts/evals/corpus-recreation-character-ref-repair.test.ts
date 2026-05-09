import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import {
  buildCharacterRefRepairReport,
  renderCharacterRefRepairReport,
} from "./corpus-recreation-character-ref-repair"

describe("corpus-recreation-character-ref-repair", () => {
  test("builds manual field-replace candidates for required and affected refs", () => {
    const root = mkdtempSync(join(tmpdir(), "character-ref-repair-"))
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
            requiredCharacterIds: ["char-nara"],
            affectedCharacterIds: ["char-tovin"],
          },
        ],
        obligations: [
          {
            obligationId: "obl-1",
            sceneId: "analog-ch01-sc02",
            sourceId: "char-nara",
            threadId: "thread-oath",
            sceneTurnId: "turn-1",
          },
        ],
      })
      writeJson(join(pocDir, "character-context.json"), {
        issueCount: 3,
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
              "analog-ch01-sc02: character char-mirel is named in scene contract but missing requiredCharacterIds/source obligation",
              "analog-ch01-sc02: unknown requiredCharacterId char-ghost",
            ],
          },
        ],
      })

      const report = buildCharacterRefRepairReport([pocDir], "2026-05-09T00:00:00.000Z")

      expect(report.totals.candidateCount).toBe(2)
      expect(report.totals.proposedCharacterRefAdditions).toBe(3)
      expect(report.totals.byField.requiredCharacterIds).toBe(1)
      expect(report.totals.byField.affectedCharacterIds).toBe(1)
      expect(report.totals.manualFindingCount).toBe(1)

      const affectedCandidate = report.candidates.find(candidate => candidate.fieldPath === "affectedCharacterIds")
      expect(affectedCandidate).toMatchObject({
        candidateId: "001",
        sceneId: "analog-ch01-sc01",
        characterIdsToAdd: ["char-tovin"],
        currentValue: [],
        proposedValue: ["char-tovin"],
      })
      expect(affectedCandidate?.proposalCandidate).toMatchObject({
        action: "field_replace",
        requiresProposedValue: false,
        proposedValueStatus: "deterministic_candidate_available",
        safeToAutoApply: false,
        target: {
          kind: "beat_plan",
          ref: "analog-ch01-sc01",
          fieldPath: "affectedCharacterIds",
        },
      })

      const requiredCandidate = report.candidates.find(candidate => candidate.fieldPath === "requiredCharacterIds")
      expect(requiredCandidate?.characterIdsToAdd).toEqual(["char-kael", "char-mirel"])
      expect(requiredCandidate?.proposedValue).toEqual(["char-nara", "char-kael", "char-mirel"])
      expect(requiredCandidate?.preserveIds).toMatchObject({
        obligationIds: ["obl-1"],
        sceneTurnIds: ["turn-1"],
        threadIds: ["thread-oath"],
      })
      expect(report.dispositionPlanDraft.actions).toHaveLength(2)
      expect(report.dispositionPlanDraft.actions[0]).toMatchObject({
        decision: "field_replace",
        approve: false,
      })
      expect(report.manualFindings[0]).toMatchObject({
        kind: "unknown_required_character",
        characterIds: ["char-ghost"],
      })

      const rendered = renderCharacterRefRepairReport(report)
      expect(rendered).toContain("Character Ref Repair Candidates")
      expect(rendered).toContain("Safe to auto-apply: false")
      expect(rendered).toContain("affectedCharacterIds")
      expect(rendered).toContain("requiredCharacterIds")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
