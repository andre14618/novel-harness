import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { buildPlanReadinessDraftsFromAggregate } from "../../src/harness/plan-readiness"
import {
  buildCorpusRecreationReadinessAggregate,
  renderCorpusRecreationReadinessAggregate,
} from "./corpus-recreation-readiness"

describe("corpus-recreation-readiness", () => {
  test("turns low semantic scene findings into Plan Readiness-compatible groups", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-readiness-"))
    try {
      const pocDir = join(root, "poc-ch2")
      writeJson(join(pocDir, "plan.json"), {
        chapterId: "analog-ch02",
        scenes: [{
          sceneId: "analog-ch02-sc01",
          structuralRole: "Pressure Nara with the ward.",
          goal: "Nara wants a route through the ward.",
          outcome: "Nara gets through.",
          consequence: "The bells mark her passage.",
        }],
        obligations: [{
          obligationId: "obl-bells",
          sceneId: "analog-ch02-sc01",
          sourceId: "world-aurora-bells",
          requirementText: "The bells constrain Nara's crossing.",
        }],
      })
      writeJson(join(pocDir, "semantic-review-live/semantic-review.json"), {
        source: { book: "crystal_shard", chapterLabel: "2" },
        results: [
          {
            sceneId: "analog-ch02-sc01",
            sceneIndex: 0,
            dimension: "worldFactPressure",
            promptMode: "evidence-first",
            relevantWorldFactIds: ["world-aurora-bells"],
            relevantCharacterIds: [],
            obligationIds: ["obl-bells"],
            label: "WFACT-1",
            ordinal: 1,
            excerpt: "SCENE CONTRACT:\n...",
            missingForNextLevel: "The world fact must constrain choice or outcome.",
            output: {
              evidence: {
                worldFact: "The bells are mentioned.",
                effect: "",
              },
            },
          },
          {
            sceneId: "analog-ch02-sc01",
            sceneIndex: 0,
            dimension: "sceneDramaturgy",
            label: "SCENE-2",
            ordinal: 2,
          },
        ],
      })

      const aggregate = buildCorpusRecreationReadinessAggregate([pocDir], undefined, "2026-05-09T00:00:00.000Z")
      expect(aggregate.groupCount).toBe(1)
      expect(aggregate.findingCount).toBe(1)
      expect(aggregate.groups[0]).toMatchObject({
        fixtureId: "crystal_shard:2",
        armId: "corpus-recreation:exact-id-scene",
        unitType: "scene",
        sceneId: "analog-ch02-sc01",
        sourceIds: {
          obligationIds: ["obl-bells"],
          worldFactIds: ["world-aurora-bells"],
          sourceIds: ["world-aurora-bells"],
        },
        rewritePacket: {
          proposalCandidate: {
            target: {
              kind: "beat_plan",
              ref: "analog-ch02-sc01",
              fieldPath: "description",
            },
            safeToAutoApply: false,
          },
        },
      })

      const readiness = buildPlanReadinessDraftsFromAggregate({
        novelId: "readiness-test",
        aggregate,
      })
      expect(readiness.drafts).toHaveLength(1)
      expect(readiness.drafts[0]!.target.ref).toBe("analog-ch02-sc01")
      expect(readiness.drafts[0]!.preserveIds.worldFactIds).toEqual(["world-aurora-bells"])

      const rendered = renderCorpusRecreationReadinessAggregate(aggregate)
      expect(rendered).toContain("Should this world fact actively constrain choice/outcome here")
      expect(rendered).toContain("WFACT-1 worldFactPressure")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
