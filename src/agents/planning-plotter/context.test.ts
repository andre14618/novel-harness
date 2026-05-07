import { expect, test } from "bun:test"

import { buildContext } from "./context"

test("planning plotter context renders native chapter contract guidance only when enabled", () => {
  const base = buildContext(worldBible(), characters(), spine(), seed())
  const native = buildContext(worldBible(), characters(), spine(), {
    ...seed(),
    pipelineOverrides: { nativePlanningContractV1: true },
  })

  expect(base).not.toContain("UPSTREAM NATIVE PLANNING CONTRACT EXPERIMENT")
  expect(native).toContain("UPSTREAM NATIVE PLANNING CONTRACT EXPERIMENT")
  expect(native).toContain("protagonist pressure")
  expect(native).toContain("endpoint or hook")
  expect(native).toContain("Do not hide a")
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
