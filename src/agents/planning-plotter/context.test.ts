import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { buildContext } from "./context"
import type { SeedInput } from "../../types"

test("planning plotter context renders native chapter contract guidance by default with explicit legacy override", () => {
  const base = buildContext(worldBible(), characters(), spine(), seed())
  const legacy = buildContext(worldBible(), characters(), spine(), {
    ...seed(),
    pipelineOverrides: { nativePlanningContractV1: false },
  })

  expect(base).toContain("UPSTREAM NATIVE PLANNING CONTRACT")
  expect(base).toContain("protagonist pressure")
  expect(base).toContain("personal stake")
  expect(base).toContain("want, need, fear")
  expect(base).toContain("endpoint or hook")
  expect(base).toContain("Do not hide a")
  expect(legacy).not.toContain("UPSTREAM NATIVE PLANNING CONTRACT")
})

test("planning plotter context keeps selective semantic telemetry from widening skeleton scope", () => {
  const context = buildContext(worldBible(), characters(), spine(), {
    ...seed(),
    chapterCount: 2,
    pipelineOverrides: {
      planningSceneTurnShapingV1: true,
      planningMaterialPressureV1: true,
    },
  })
  const fullContract = buildContext(worldBible(), characters(), spine(), {
    ...seed(),
    chapterCount: 2,
    pipelineOverrides: {
      planningSceneTurnShapingV1: true,
      planningMaterialPressureV1: true,
      scenePlanContractV1: true,
    },
  })

  expect(context).toContain("SEMANTIC PLANNING SCOPE CONTROL")
  expect(context).toContain("do not raise targetWords")
  expect(context).toContain("1200-1800")
  expect(context).toContain("not extra accounting room")
  expect(fullContract).not.toContain("SEMANTIC PLANNING SCOPE CONTROL")
})

test("planning plotter context carries mercenary progression Book 1 packet through production directives", () => {
  const mercenarySeed = JSON.parse(readFileSync("src/seeds/mercenary-rillgate-saltmine.json", "utf8")) as SeedInput
  const context = buildContext(worldBible(), characters(), spine(), mercenarySeed)

  expect(context).toContain("DIRECTIVES (author-specified")
  expect(context).toContain("MPA-01 Hub pressure")
  expect(context).toContain("MPA-10 Return and next hook")
  expect(context).toContain("Slot: MPA-01")
  expect(context).toContain("Job function: Hub pressure")
  expect(context).toContain("Pressure focus: objectivePressure; tacticalConstraint")
  expect(context).toContain("threadId=thread-rillgate-contract-loop")
  expect(context).toContain("promiseId=debt-mispriced-contract")
  expect(context).toContain("First two chapter pressure notes")
  expect(context).toContain("Produce a SKELETON outline with exactly 10 chapters")
})

function seed() {
  return {
    genre: "fantasy",
    premise: "A scribe hides a dangerous record",
    chapterCount: 3,
    characters: [{ name: "Istra Venn", role: "protagonist" as const, description: "A precise archivist" }],
  }
}

function worldBible() {
  return {
    setting: "A test city",
    timePeriod: "now",
    geography: "streets and archives",
    politicalStructure: "council",
    technologyConstraints: "paper records",
    socialCustoms: [],
    sensoryPalette: "dust and ink",
    rules: ["Records matter"],
    locations: [{ name: "Archive", description: "A narrow archive" }],
    culture: "archival",
    history: "old records shaped the city",
    systems: [],
    cultures: [],
  }
}

function characters() {
  return [{
    id: "char-istra-venn",
    name: "Istra Venn",
    role: "protagonist" as const,
    backstory: "",
    traits: ["precise"],
    speechPattern: "plain",
    goals: "protect the archive",
    fears: "losing the records",
    relationships: [],
    culturalBackground: [],
    systemAwareness: [],
    exampleLines: [],
  }]
}

function spine() {
  return {
    acts: [],
    centralConflict: "truth vs safety",
    theme: "truth has a cost",
    endingDirection: "hard-won clarity",
  }
}
