import { expect, test } from "bun:test"

import { buildContext } from "./context"

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
