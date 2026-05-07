import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"

import { buildCohortReport, renderCohortReport } from "./method-pack-planner-cohort"

describe("method-pack-planner-cohort", () => {
  test("aggregates repeated fixture diagnostics into a cohort verdict", async () => {
    const dir = mkdtempSync(join(tmpdir(), "method-pack-cohort-"))
    writeFileSync(join(dir, "a.json"), JSON.stringify(fixture("fixture-a"), null, 2))
    writeFileSync(join(dir, "b.json"), JSON.stringify(fixture("fixture-b"), null, 2))

    const report = await buildCohortReport({
      live: false,
      json: false,
      fixtureDir: dir,
      fixturePaths: [],
      outputDir: null,
      replicates: 1,
      concurrency: 2,
      scenesPerChapter: 2,
      obligationsPerChapter: 2,
      includePro: false,
      proReplicates: 0,
    }, "2026-05-07T00:00:00.000Z")

    expect(report.cellCount).toBe(2)
    expect(report.aggregate.meanDelta).toBeGreaterThan(0.03)
    expect(report.aggregate.winRate).toBe(1)
    expect(report.aggregate.verdict).toBe("DIRECTIONAL-PASS")
    expect(renderCohortReport(report)).toContain("Method-pack planner cohort")
  })
})

function fixture(diagnosticId: string) {
  return {
    diagnosticId,
    methodPackId: "commercial-fantasy-adventure-v0",
    templateId: "commercial-24-flex-v0",
    targetSlots: [
      { structureSlotId: "CFA-01", structureJob: "Pressure baseline", planningTest: "baseline" },
    ],
    concept: {
      genreProfileId: "general-commercial-fantasy-adventure",
      premise: "Mara maps a hidden road.",
      readerPromise: "map adventure",
      centralConflict: "Mara exposes the Crown Survey.",
      protagonist: {
        characterId: "char-mara-vey",
        name: "Mara Vey",
        desire: "restore her charter",
        fear: "being used",
        flaw: "withholds plans",
      },
      characters: [
        { characterId: "char-sena-vale", name: "Sena Vale", role: "supporting", materiality: "forces trust" },
      ],
      worldFacts: [
        { worldFactId: "world-living-roads", fact: "roads shift around lies" },
      ],
      storyPromise: { promiseId: "promise-erased-province", text: "find the erased province" },
      constraints: ["contracts only"],
    },
    arms: [
      { armId: "control:no-method", label: "Control", methodPackEnabled: false, plan: weakPlan() },
      { armId: "test:commercial-fantasy-adventure-v0", label: "Method", methodPackEnabled: true, plan: strongPlan() },
    ],
  }
}

function weakPlan() {
  return {
    armId: "control:no-method",
    methodPackId: null,
    templateId: null,
    chapters: [{
      chapterId: "ch-base-01",
      structureSlotId: "BASE-01",
      chapterFunction: "Setup",
      povCharacterId: "char-mara-vey",
      protagonistPressure: "Mara begins.",
      centralConflict: "Trouble starts.",
      irreversibleChange: "Something changes.",
      endpointOrHook: "Mara continues.",
      requiredCharacterWork: "Mara is present.",
      requiredWorldWork: "The world exists.",
      requiredStoryDebtWork: "Promise exists.",
      obligations: [],
      scenes: [{
        sceneId: "scene-base-01",
        chapterId: "ch-base-01",
        structureSlotId: "BASE-01",
        sceneFunction: "start",
        povCharacterId: "char-mara-vey",
        locationOrArena: "road",
        goal: "start",
        conflict: "trouble",
        turnOrValueShift: "change",
        outcome: "Mara continues.",
        consequence: "next",
        requiredObligationIds: [],
        requiredSourceIds: [],
        requiredCharacterIds: ["char-mara-vey"],
        requiredWorldFactIds: [],
      }],
    }],
  }
}

function strongPlan() {
  return {
    armId: "test:commercial-fantasy-adventure-v0",
    methodPackId: "commercial-fantasy-adventure-v0",
    templateId: "commercial-24-flex-v0",
    chapters: [{
      chapterId: "ch-cfa-01",
      structureSlotId: "CFA-01",
      chapterFunction: "CFA-01 forces Mara to choose between safety and truth under pressure.",
      povCharacterId: "char-mara-vey",
      protagonistPressure: "Mara must choose truth before Ashren can punish the altered map.",
      centralConflict: "Sena demands trust while the living roads expose sanctioned lies.",
      irreversibleChange: "Mara proves the official map hides a road that should exist.",
      endpointOrHook: "Mara chooses the truthful route despite losing the charter.",
      requiredCharacterWork: "Mara chooses to trust Sena, making secrecy costlier than exposure.",
      requiredWorldWork: "The living roads force the choice by punishing false directions.",
      requiredStoryDebtWork: "The erased-province promise advances through a concrete map discovery.",
      obligations: [{
        obligationId: "obl-cfa-01-map",
        sourceId: "world-living-roads",
        sourceKind: "world",
        coveragePolicy: "must_satisfy",
        requirementText: "Mara must use living-road evidence to choose the truthful route.",
        linkedCharacterIds: ["char-mara-vey", "char-sena-vale"],
        linkedWorldFactIds: ["world-living-roads"],
      }],
      scenes: [{
        sceneId: "scene-cfa-01",
        chapterId: "ch-cfa-01",
        structureSlotId: "CFA-01",
        sceneFunction: "Force Mara into a choice where the world rule changes the cost.",
        povCharacterId: "char-mara-vey",
        locationOrArena: "border road",
        goal: "Mara tries to prove the map was altered without trusting anyone.",
        conflict: "Sena demands trust while charter law threatens punishment.",
        turnOrValueShift: "The living road moves, proving safety depends on a lie.",
        outcome: "Mara chooses the truthful route despite losing the charter.",
        consequence: "The route exposes her but advances the erased-province promise.",
        requiredObligationIds: ["obl-cfa-01-map"],
        requiredSourceIds: ["world-living-roads"],
        requiredCharacterIds: ["char-mara-vey", "char-sena-vale"],
        requiredWorldFactIds: ["world-living-roads"],
      }],
    }],
  }
}
