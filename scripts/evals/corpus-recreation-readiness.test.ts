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
        sceneTurns: [{
          sceneTurnId: "turn-ch02-ward-crossing",
          sceneId: "analog-ch02-sc01",
          summary: "Nara crosses the ward and the bells expose the key's cost.",
          turnType: "cost",
        }],
        obligations: [{
          obligationId: "obl-bells",
          sceneId: "analog-ch02-sc01",
          sceneTurnId: "turn-ch02-ward-crossing",
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
            sceneTurnIds: ["turn-ch02-ward-crossing"],
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
          sceneTurnIds: ["turn-ch02-ward-crossing"],
          threadIds: ["thread-key-cost"],
          promiseIds: ["debt-key-cost"],
          payoffIds: ["payoff-key-cost-exposure"],
          sourceIds: ["world-aurora-bells", "turn-ch02-ward-crossing", "thread-key-cost", "debt-key-cost", "payoff-key-cost-exposure"],
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
      expect(readiness.drafts[0]!.preserveIds.sceneTurnIds).toEqual(["turn-ch02-ward-crossing"])
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
          sceneTurnId: "turn-ch05-tovin-pressure",
          sourceId: "char-tovin",
          threadId: "thread-tovin-leverage",
          promiseId: "debt-key-cost",
          requirementText: "Tovin pressures Nara through the key's cost.",
        }],
      })
      writeJson(join(pocDir, "packet.json"), {
        originalAnalogSeed: {
          storyDebts: [
            { storyDebtId: "debt-key-cost", threadId: "thread-key-cost" },
          ],
          storyPayoffs: [],
        },
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
            sceneTurnIds: ["turn-ch05-tovin-pressure"],
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
          sceneTurnIds: ["turn-ch05-tovin-pressure"],
          threadIds: ["thread-key-cost", "thread-tovin-leverage"],
          promiseIds: ["debt-key-cost"],
        },
      })
      expect(aggregate.groups[0]!.findings[0]).toMatchObject({
        label: "THREADREF-1",
        promptMode: "deterministic-plan-comparison",
        evidence: {
          mismatchRefs: "obl-tovin-leverage:debt-key-cost",
          repairHints: "obl-tovin-leverage: promiseId debt-key-cost belongs to thread-key-cost; split relationship pressure from promise progress or reroute the promise obligation to thread-key-cost.",
        },
      })

      const readiness = buildPlanReadinessDraftsFromAggregate({
        novelId: "readiness-test",
        aggregate,
      })
      expect(readiness.drafts).toHaveLength(1)
      expect(readiness.drafts[0]!.preserveIds.threadIds).toEqual(["thread-key-cost", "thread-tovin-leverage"])
      expect(readiness.drafts[0]!.preserveIds.sceneTurnIds).toEqual(["turn-ch05-tovin-pressure"])
      expect(readiness.drafts[0]!.preserveIds.promiseIds).toEqual(["debt-key-cost"])
      const rendered = renderCorpusRecreationReadinessAggregate(aggregate)
      expect(rendered).toContain("THREADREF-1")
      expect(rendered).toContain("Preserve scene turns: turn-ch05-tovin-pressure")
      expect(rendered).toContain("Preserve promises: debt-key-cost")
      expect(rendered).toContain("split into separate obligations")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("turns deterministic character-context issues into readiness groups", () => {
    const root = mkdtempSync(join(tmpdir(), "corpus-recreation-readiness-"))
    try {
      const pocDir = join(root, "poc-ch1")
      writeJson(join(pocDir, "plan.json"), {
        chapterId: "analog-ch01",
        scenes: [{
          sceneId: "analog-ch01-sc02",
          structuralRole: "Force Nara to choose whether to trust Kael.",
          goal: "Nara wants to hide the key's cost from Kael.",
          outcome: "Kael realizes she is concealing something.",
          consequence: "Their alliance starts with leverage instead of trust.",
        }],
        obligations: [{
          obligationId: "obl-key-cost",
          sceneId: "analog-ch01-sc02",
          sceneTurnId: "turn-ch01-key-cost",
          sourceId: "world-key-cost",
          threadId: "thread-key-cost",
          promiseId: "debt-key-cost",
          payoffId: "payoff-key-cost-exposure",
          requirementText: "The key's cost should pressure the choice.",
        }],
      })
      writeJson(join(pocDir, "character-context.json"), {
        source: { book: "crystal_shard", chapterLabel: "1" },
        plannerVariant: "scene-turn-child-thread-v4",
        sceneCount: 1,
        contextCount: 1,
        issueCount: 1,
        contexts: [{
          sceneId: "analog-ch01-sc02",
          sceneIndex: 1,
          povCharacterId: "char-nara",
          sceneGoal: "Nara wants to hide the key's cost from Kael.",
          sceneOutcome: "Kael realizes she is concealing something.",
          sceneConsequence: "Their alliance starts with leverage instead of trust.",
          activeCharacterIds: ["char-nara", "char-kael"],
          characterCards: [
            {
              characterId: "char-nara",
              sourceObligationIds: [],
              activeThreadIds: ["thread-key-cost"],
              activePromiseIds: ["debt-key-cost"],
              activePayoffIds: ["payoff-key-cost-exposure"],
            },
            {
              characterId: "char-kael",
              sourceObligationIds: [],
              activeThreadIds: ["thread-uneasy-alliance"],
              activePromiseIds: [],
              activePayoffIds: [],
            },
          ],
          currentResponsibilities: [],
          structuralIssues: [
            "analog-ch01-sc02: character char-kael is named in scene contract but missing requiredCharacterIds/source obligation",
          ],
        }],
      })

      const aggregate = buildCorpusRecreationReadinessAggregate([pocDir], undefined, "2026-05-09T00:00:00.000Z")

      expect(aggregate.groupCount).toBe(1)
      expect(aggregate.groups[0]).toMatchObject({
        fixtureId: "crystal_shard:1",
        sceneId: "analog-ch01-sc02",
        dimensions: ["characterRefClosure"],
        fixIntents: ["close_character_context_refs"],
        sourceIds: {
          obligationIds: ["obl-key-cost"],
          characterIds: ["char-nara", "char-kael"],
          sceneTurnIds: ["turn-ch01-key-cost"],
          threadIds: ["thread-key-cost", "thread-uneasy-alliance"],
          promiseIds: ["debt-key-cost"],
          payoffIds: ["payoff-key-cost-exposure"],
        },
        rewritePacket: {
          proposalCandidate: {
            sourceAgent: "corpus-recreation-character-context",
            safeToAutoApply: false,
          },
        },
      })
      expect(aggregate.groups[0]!.findings[0]).toMatchObject({
        label: "CHARACTERREF-1",
        promptMode: "deterministic-character-context",
        evidence: {
          activeCharacterIds: "char-nara, char-kael",
        },
      })

      const readiness = buildPlanReadinessDraftsFromAggregate({
        novelId: "readiness-test",
        aggregate,
      })
      expect(readiness.drafts).toHaveLength(1)
      expect(readiness.drafts[0]!.preserveIds.characterIds).toEqual(["char-nara", "char-kael"])
      expect(readiness.drafts[0]!.preserveIds.threadIds).toEqual(["thread-key-cost", "thread-uneasy-alliance"])
      expect(readiness.drafts[0]!.preserveIds.sceneTurnIds).toEqual(["turn-ch01-key-cost"])

      const rendered = renderCorpusRecreationReadinessAggregate(aggregate)
      expect(rendered).toContain("CHARACTERREF-1")
      expect(rendered).toContain("requiredCharacterIds")
      expect(rendered).toContain("Preserve characters: char-nara, char-kael")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeJson(path: string, value: unknown): void {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
