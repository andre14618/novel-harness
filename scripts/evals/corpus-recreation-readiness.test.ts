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
          threadId: "thread-key-cost",
          promiseId: "debt-key-cost",
          payoffId: "payoff-key-cost-exposure",
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
            threadIds: ["thread-key-cost"],
            promiseIds: ["debt-key-cost"],
            payoffIds: ["payoff-key-cost-exposure"],
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
          threadIds: ["thread-key-cost"],
          promiseIds: ["debt-key-cost"],
          payoffIds: ["payoff-key-cost-exposure"],
          sourceIds: ["world-aurora-bells", "thread-key-cost", "debt-key-cost", "payoff-key-cost-exposure"],
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
      expect(readiness.drafts[0]!.preserveIds.threadIds).toEqual(["thread-key-cost"])
      expect(readiness.drafts[0]!.preserveIds.promiseIds).toEqual(["debt-key-cost"])
      expect(readiness.drafts[0]!.preserveIds.payoffIds).toEqual(["payoff-key-cost-exposure"])

      const rendered = renderCorpusRecreationReadinessAggregate(aggregate)
      expect(rendered).toContain("Should this world fact actively constrain choice/outcome here")
      expect(rendered).toContain("WFACT-1 worldFactPressure")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("turns deterministic thread-ref plan comparison issues into readiness groups", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-readiness-"))
    try {
      const pocDir = join(root, "poc-ch5")
      writeJson(join(pocDir, "plan.json"), {
        chapterId: "analog-ch05",
        scenes: [{
          sceneId: "analog-ch05-sc01",
          structuralRole: "Pressure Nara with Tovin's leverage.",
          goal: "Nara wants a clean pass.",
          outcome: "Nara gains only temporary passage.",
          consequence: "Tovin now has leverage.",
        }],
        obligations: [{
          obligationId: "obl-tovin-leverage",
          sceneId: "analog-ch05-sc01",
          sourceId: "char-tovin",
          threadId: "thread-tovin-leverage",
          promiseId: "debt-key-cost",
          requirementText: "Tovin pressures Nara through the key's cost.",
        }],
      })
      writeJson(join(pocDir, "plan-comparison.json"), {
        sceneContract: {
          scenes: [{
            sceneId: "analog-ch05-sc01",
            issues: [
              "promiseIds belong to different threadId: obl-tovin-leverage:debt-key-cost",
            ],
            promiseThreadMismatchIds: ["obl-tovin-leverage:debt-key-cost"],
            payoffThreadMismatchIds: [],
            unknownThreadIds: [],
            unknownPromiseIds: [],
            unknownPayoffIds: [],
          }],
        },
      })

      const aggregate = buildCorpusRecreationReadinessAggregate([pocDir], undefined, "2026-05-09T00:00:00.000Z")

      expect(aggregate.groupCount).toBe(1)
      expect(aggregate.groups[0]).toMatchObject({
        sceneId: "analog-ch05-sc01",
        dimensions: ["threadRefConsistency"],
        fixIntents: ["split_or_reroute_cross_thread_pressure"],
        sourceIds: {
          obligationIds: ["obl-tovin-leverage"],
          threadIds: ["thread-tovin-leverage"],
          promiseIds: ["debt-key-cost"],
        },
      })
      expect(aggregate.groups[0]!.findings[0]).toMatchObject({
        label: "THREADREF-1",
        promptMode: "deterministic-plan-comparison",
        evidence: {
          mismatchRefs: "obl-tovin-leverage:debt-key-cost",
        },
      })

      const readiness = buildPlanReadinessDraftsFromAggregate({
        novelId: "readiness-test",
        aggregate,
      })
      expect(readiness.drafts).toHaveLength(1)
      expect(readiness.drafts[0]!.preserveIds.threadIds).toEqual(["thread-tovin-leverage"])
      expect(readiness.drafts[0]!.preserveIds.promiseIds).toEqual(["debt-key-cost"])
      const rendered = renderCorpusRecreationReadinessAggregate(aggregate)
      expect(rendered).toContain("THREADREF-1")
      expect(rendered).toContain("Preserve promises: debt-key-cost")
      expect(rendered).toContain("split into separate obligations")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
