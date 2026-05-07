import { expect, test } from "bun:test"

import { buildContext } from "./context"

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

  expect(context).toContain("Minimum beats required: 4")
  expect(context).toContain("Recommended: 5 beats")
  expect(context).toContain("~300-450 words per planned beat")
  expect(context).not.toContain("100-140 words")
})

test("planning beat context renders default-off experiment cap guidance", () => {
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

  expect(context).toContain("Planning max for this experiment: 4 beats")
  expect(context).toContain("Do not exceed this cap")
})

test("planning beat context renders native contract guidance without cap language", () => {
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
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Native planning contract experiment")
  expect(context).toContain("Author exactly 5 complete story-turn beats")
  expect(context).toContain("Do not emit micro-actions")
  expect(context).toContain("final beat must preserve the chapter endpoint/hook")
  expect(context).not.toContain("Planning max for this experiment")
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
