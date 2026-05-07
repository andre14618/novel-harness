import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

import { buildRealDataReport } from "./planner-discernment-real-data"

describe("planner-discernment-real-data", () => {
  test("extracts real cohort cells and summarizes labels by arm and dimension", async () => {
    const dir = mkdtempSync(join(tmpdir(), "planner-discernment-real-data-"))
    const fixturePath = join(dir, "fixture.json")
    const cellDir = join(dir, "cohort", "cells")
    await Bun.$`mkdir -p ${cellDir}`.quiet()

    writeFileSync(fixturePath, JSON.stringify(fixture(), null, 2))
    writeFileSync(join(cellDir, "cell-r01.json"), JSON.stringify(cell(fixturePath), null, 2))

    const report = await buildRealDataReport({
      cohortDir: join(dir, "cohort"),
      cellPaths: [],
      outputDir: null,
      live: false,
      model: "deepseek-v4-flash",
      thinking: false,
      maxTokens: 1400,
      concurrency: 2,
      promptMode: "direct-label",
      dimensions: ["characterAgency", "sceneDramaturgy"],
      chapterLimit: 1,
      replicate: 1,
      json: false,
    }, "2026-05-07T00:00:00.000Z")

    expect(report.cellPaths).toHaveLength(1)
    expect(report.excerptCount).toBe(6)
    expect(report.resultCount).toBe(6)
    expect(report.summaries.map(row => `${row.armId}:${row.dimension}:${row.count}`).sort()).toEqual([
      "control:no-method:flash:characterAgency:1",
      "control:no-method:flash:sceneDramaturgy:2",
      "test:commercial-fantasy-adventure-v0:flash:characterAgency:1",
      "test:commercial-fantasy-adventure-v0:flash:sceneDramaturgy:2",
    ])
    expect(report.comparisons).toHaveLength(2)
  })
})

function fixture() {
  return {
    diagnosticId: "fixture",
    methodPackId: "commercial-fantasy-adventure-v0",
    templateId: "template",
    targetSlots: [
      { structureSlotId: "BASE-01", structureJob: "start", planningTest: "starts" },
    ],
    concept: {
      genreProfileId: "general-commercial-fantasy-adventure",
      premise: "A cartographer exposes a hidden province.",
      readerPromise: "forbidden maps reveal buried power",
      centralConflict: "law versus truth",
      protagonist: {
        characterId: "char-mara",
        name: "Mara",
        desire: "restore her charter",
        fear: "betraying hidden villages",
        flaw: "trusts measurements over people",
      },
      characters: [
        { characterId: "char-sena", name: "Sena", role: "smuggler", materiality: "forces trust" },
      ],
      worldFacts: [
        { worldFactId: "world-ink", fact: "true-ink burns on false maps" },
      ],
      storyPromise: { promiseId: "promise-erased", text: "who erased the province" },
      constraints: [],
    },
  }
}

function cell(fixturePath: string) {
  return {
    diagnosticId: "fixture",
    generatedAt: "2026-05-07T00:00:00.000Z",
    mode: "live",
    fixturePath,
    arms: [
      arm("control:no-method:flash", false),
      arm("test:commercial-fantasy-adventure-v0:flash", true),
    ],
    comparison: {
      controlArmId: "control:no-method:flash",
      testArmId: "test:commercial-fantasy-adventure-v0:flash",
      totalRatioDelta: 0,
      verdict: "HOLD",
      reason: "fixture",
    },
  }
}

function arm(armId: string, methodPackEnabled: boolean) {
  return {
    armId,
    label: armId,
    methodPackEnabled,
    plan: {
      armId,
      methodPackId: methodPackEnabled ? "commercial-fantasy-adventure-v0" : null,
      templateId: methodPackEnabled ? "template" : null,
      chapters: [
        {
          chapterId: "ch-001",
          structureSlotId: "BASE-01",
          chapterFunction: "Mara finds the first false map.",
          povCharacterId: "char-mara",
          protagonistPressure: "Mara must decide whether to trust Sena.",
          centralConflict: "The map law blocks the truth.",
          irreversibleChange: "Mara burns her charter.",
          endpointOrHook: "Ashren learns she has the forbidden map.",
          requiredCharacterWork: "Mara chooses truth over legal safety.",
          requiredWorldWork: "True-ink burns on the false border.",
          requiredStoryDebtWork: "The erased province becomes a moral promise.",
          scenes: [
            scene("scn-001-01"),
            scene("scn-001-02"),
          ],
          obligations: [
            {
              obligationId: "obl-001",
              sourceId: "char-mara",
              sourceKind: "character",
              coveragePolicy: "must_satisfy",
              requirementText: "Mara must choose truth over safety.",
              linkedCharacterIds: ["char-mara"],
              linkedWorldFactIds: ["world-ink"],
            },
          ],
        },
      ],
    },
    score: {
      armId,
      methodPackEnabled,
      totalPassed: 1,
      totalPossible: 1,
      totalRatio: 1,
      dimensions: {},
    },
  }
}

function scene(sceneId: string) {
  return {
    sceneId,
    chapterId: "ch-001",
    structureSlotId: "BASE-01",
    sceneFunction: "Mara tests the map.",
    povCharacterId: "char-mara",
    locationOrArena: "archive",
    goal: "Mara wants to prove the border is false.",
    conflict: "The clerk demands the page.",
    turnOrValueShift: "The ink burns and exposes the missing valley.",
    outcome: "Mara hides the smoking map.",
    consequence: "The clerk calls a guard.",
    requiredObligationIds: ["obl-001"],
    requiredSourceIds: ["char-mara"],
    requiredCharacterIds: ["char-mara"],
    requiredWorldFactIds: ["world-ink"],
  }
}
