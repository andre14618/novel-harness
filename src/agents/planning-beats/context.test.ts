import { expect, test } from "bun:test"

import { buildContext } from "./context"

test("planning beat context omits scene plan contract guidance when flag is off", () => {
  const context = buildContext({
    targetChapter: chapter(1, 1500),
    allSkeletons: [chapter(1, 1500)],
    priorChapters: [],
    worldBible: {
      setting: "A test city", timePeriod: "now", geography: "g", politicalStructure: "p",
      technologyConstraints: "t", socialCustoms: [], sensoryPalette: "s",
      rules: ["r"], locations: [{ name: "L", description: "d" }],
      culture: "c", history: "h", systems: [], cultures: [],
    },
    characters: [{
      id: "char-x", name: "X", role: "protagonist", backstory: "", traits: [],
      speechPattern: "plain", goals: "g", fears: "f",
      relationships: [], culturalBackground: [], systemAwareness: [], exampleLines: [],
    }],
    spine: { acts: [], centralConflict: "c", theme: "t", endingDirection: "e" },
    seed: { genre: "fantasy", premise: "p", characters: [{ name: "X", role: "protagonist", description: "d" }] },
  } as Parameters<typeof buildContext>[0])

  expect(context).not.toContain("Scene plan contract (scenePlanContractV1)")
  expect(context).not.toContain("choiceAlternatives")
})

test("planning beat context renders scene plan contract guidance when flag is on", () => {
  const context = buildContext({
    targetChapter: chapter(1, 1500),
    allSkeletons: [chapter(1, 1500)],
    priorChapters: [],
    worldBible: {
      setting: "A test city", timePeriod: "now", geography: "g", politicalStructure: "p",
      technologyConstraints: "t", socialCustoms: [], sensoryPalette: "s",
      rules: ["r"], locations: [{ name: "L", description: "d" }],
      culture: "c", history: "h", systems: [], cultures: [],
    },
    characters: [{
      id: "char-x", name: "X", role: "protagonist", backstory: "", traits: [],
      speechPattern: "plain", goals: "g", fears: "f",
      relationships: [], culturalBackground: [], systemAwareness: [], exampleLines: [],
    }],
    spine: { acts: [], centralConflict: "c", theme: "t", endingDirection: "e" },
    seed: {
      genre: "fantasy",
      premise: "p",
      characters: [{ name: "X", role: "protagonist", description: "d" }],
      pipelineOverrides: { scenePlanContractV1: true },
    },
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Scene plan contract (scenePlanContractV1)")
  expect(context).toContain("temporalAnchor")
  expect(context).toContain("placeAnchor")
  expect(context).toContain("choiceAlternatives")
  expect(context).toContain("povPersonalStake")
  expect(context).toContain("crisisChoice")
  expect(context).toContain("Causal-motivation-v3 expectations")
  expect(context).toContain("must NOT simply restate the outcome")
  expect(context).toContain("is insufficient without an immediate external cost")
  expect(context).toContain("Do not make the endpoint a promised later confrontation")
  expect(context).toContain("through the existing outcome/consequence pair")
  expect(context).toContain("Spend the scene's limited scope on executing the endpoint")
  expect(context).toContain("Recommended scene contracts for this chapter size: around 5")
  expect(context).toContain("Do not rely on per-scene word targets")
  expect(context).not.toContain("minimum structural floor")
})

test("planning beat context renders calibrated beat count guidance", () => {
  const context = buildContext({
    targetChapter: chapter(1, 1500),
    allSkeletons: [chapter(1, 1500)],
    priorChapters: [],
    worldBible: {
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
    },
    characters: [{
      id: "char-istra-venn",
      name: "Istra Venn",
      role: "protagonist",
      backstory: "",
      traits: ["precise"],
      speechPattern: "plain",
      goals: "protect the archive",
      fears: "losing the records",
      relationships: [],
      culturalBackground: [],
      systemAwareness: [],
      exampleLines: [],
    }],
    spine: {
      acts: [],
      centralConflict: "truth vs safety",
      theme: "truth has a cost",
      endingDirection: "hard-won clarity",
    },
    seed: {
      genre: "fantasy",
      premise: "A scribe hides a dangerous record",
      characters: [{ name: "Istra Venn", role: "protagonist", description: "A precise archivist" }],
    },
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Target words are a rough chapter-size signal")
  expect(context).toContain("Recommended story-turn entries for this chapter size: 5")
  expect(context).toContain("minimum structural floor: 4")
  expect(context).toContain("Scope by content load")
  expect(context).not.toContain("100-140 words")
})

test("planning beat context renders explicit planning max override guidance", () => {
  const context = buildContext({
    targetChapter: chapter(1, 1500),
    allSkeletons: [chapter(1, 1500)],
    priorChapters: [],
    worldBible: {
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
    },
    characters: [{
      id: "char-istra-venn",
      name: "Istra Venn",
      role: "protagonist",
      backstory: "",
      traits: ["precise"],
      speechPattern: "plain",
      goals: "protect the archive",
      fears: "losing the records",
      relationships: [],
      culturalBackground: [],
      systemAwareness: [],
      exampleLines: [],
    }],
    spine: {
      acts: [],
      centralConflict: "truth vs safety",
      theme: "truth has a cost",
      endingDirection: "hard-won clarity",
    },
    seed: {
      genre: "fantasy",
      premise: "A scribe hides a dangerous record",
      characters: [{ name: "Istra Venn", role: "protagonist", description: "A precise archivist" }],
      pipelineOverrides: { planningMaxBeatsPerChapter: 4 },
    },
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Planning max override: 4 entries")
  expect(context).toContain("Do not exceed this explicit cap")
})

test("planning beat context renders native contract guidance by default with explicit legacy override", () => {
  const context = buildContext({
    targetChapter: chapter(1, 1500),
    allSkeletons: [chapter(1, 1500)],
    priorChapters: [],
    worldBible: {
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
    },
    characters: [{
      id: "char-istra-venn",
      name: "Istra Venn",
      role: "protagonist",
      backstory: "",
      traits: ["precise"],
      speechPattern: "plain",
      goals: "protect the archive",
      fears: "losing the records",
      relationships: [],
      culturalBackground: [],
      systemAwareness: [],
      exampleLines: [],
    }],
    spine: {
      acts: [],
      centralConflict: "truth vs safety",
      theme: "truth has a cost",
      endingDirection: "hard-won clarity",
    },
    seed: {
      genre: "fantasy",
      premise: "A scribe hides a dangerous record",
      characters: [{ name: "Istra Venn", role: "protagonist", description: "A precise archivist" }],
    },
  } as Parameters<typeof buildContext>[0])
  const legacy = buildContext({
    targetChapter: chapter(1, 1500),
    allSkeletons: [chapter(1, 1500)],
    priorChapters: [],
    worldBible: {
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
    },
    characters: [{
      id: "char-istra-venn",
      name: "Istra Venn",
      role: "protagonist",
      backstory: "",
      traits: ["precise"],
      speechPattern: "plain",
      goals: "protect the archive",
      fears: "losing the records",
      relationships: [],
      culturalBackground: [],
      systemAwareness: [],
      exampleLines: [],
    }],
    spine: {
      acts: [],
      centralConflict: "truth vs safety",
      theme: "truth has a cost",
      endingDirection: "hard-won clarity",
    },
    seed: {
      genre: "fantasy",
      premise: "A scribe hides a dangerous record",
      characters: [{ name: "Istra Venn", role: "protagonist", description: "A precise archivist" }],
      pipelineOverrides: { nativePlanningContractV1: false },
    },
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Native planning contract")
  expect(context).toContain("Author about 5 complete story-turn entries")
  expect(context).toContain("include povPersonalStake")
  expect(context).toContain("want, need, fear")
  expect(context).toContain("Do not emit micro-actions")
  expect(context).toContain("final entry must preserve the chapter endpoint/hook")
  expect(context).toContain("sized by dramatic load rather than by a word-count quota")
  expect(context).not.toContain("Planning max override")
  expect(legacy).not.toContain("Native planning contract")
})

test("planning beat context carries native-contract retry feedback", () => {
  const context = buildContext({
    targetChapter: chapter(1, 1500),
    allSkeletons: [chapter(1, 1500)],
    priorChapters: [],
    worldBible: {
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
    },
    characters: [{
      id: "char-istra-venn",
      name: "Istra Venn",
      role: "protagonist",
      backstory: "",
      traits: ["precise"],
      speechPattern: "plain",
      goals: "protect the archive",
      fears: "losing the records",
      relationships: [],
      culturalBackground: [],
      systemAwareness: [],
      exampleLines: [],
    }],
    spine: {
      acts: [],
      centralConflict: "truth vs safety",
      theme: "truth has a cost",
      endingDirection: "hard-won clarity",
    },
    seed: {
      genre: "fantasy",
      premise: "A scribe hides a dangerous record",
      characters: [{ name: "Istra Venn", role: "protagonist", description: "A precise archivist" }],
      pipelineOverrides: { nativePlanningContractV1: true },
    },
    retryFeedback: "9 beats > native planning budget 5+1 for 1500w target",
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("PREVIOUS BEAT EXPANSION FAILED")
  expect(context).toContain("9 beats > native planning budget 5+1")
  expect(context).toContain("Do not drop the endpoint")
})

function chapter(chapterNumber: number, targetWords: number) {
  return {
    chapterNumber,
    title: "The Hidden Record",
    povCharacter: "Istra Venn",
    setting: "Archive",
    purpose: "Istra discovers a record that changes the case.",
    targetWords,
    charactersPresent: ["Istra Venn"],
    charactersPresentIds: [],
    scenes: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  }
}
