import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { buildContext } from "./context"
import type { SeedInput } from "../../types"

test("planning scene context omits scene plan contract guidance when flag is off", () => {
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
  expect(context).not.toContain("Selective scene-turn shaping")
  expect(context).not.toContain("choiceAlternatives")
})

test("planning scene context renders scene plan contract guidance when flag is on", () => {
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
  expect(context).toContain("Scene budget for this chapter size: around 3 scene contracts")
  expect(context).toContain("Do not rely on per-scene word targets")
  expect(context).not.toContain("minimum structural floor")
})

test("planning scene context renders selective scene-turn shaping without full scene-plan contract", () => {
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
      pipelineOverrides: { planningSceneTurnShapingV1: true },
    },
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Selective scene-turn shaping (planningSceneTurnShapingV1)")
  expect(context).toContain("Count contract: emit 3 entries")
  expect(context).toContain("Turn-shaping scope limit: do not exceed 3 entries")
  expect(context).toContain("final entry MUST include \"outcome\" and \"consequence\"")
  expect(context).toContain("Preserve the skeleton's scope")
  expect(context).toContain("Populate the final entry's \"outcome\" and \"consequence\"")
  expect(context).toContain("Do not leave an obligation-bearing action/revelation entry as description-only")
  expect(context).toContain("Add \"crisisChoice\" and two \"choiceAlternatives\" only when there is a real tradeoff")
  expect(context).toContain("Do not add standalone labels for context that does not change the turn")
  expect(context).toContain("repair those fields directly")
  expect(context).toContain("Source hygiene: do not invent a new offstage crime")
  expect(context).toContain("Character hygiene: \"characters\" must contain actual named cast members only")
  expect(context).not.toContain("Scene plan contract (scenePlanContractV1)")
  expect(context).not.toContain("Compliance rules (validator will fail")
})

test("planning scene context gives long turn-shaped chapters an explicit count ceiling", () => {
  const context = buildContext({
    targetChapter: chapter(7, 3100),
    allSkeletons: [chapter(7, 3100)],
    priorChapters: [],
    worldBible: {
      setting: "A test mine", timePeriod: "now", geography: "g", politicalStructure: "p",
      technologyConstraints: "t", socialCustoms: [], sensoryPalette: "s",
      rules: ["Brine wards punish blood"], locations: [{ name: "Mine", description: "d" }],
      culture: "c", history: "h", systems: [], cultures: [],
    },
    characters: [{
      id: "char-x", name: "X", role: "protagonist", backstory: "", traits: [],
      speechPattern: "plain", goals: "g", fears: "f",
      relationships: [], culturalBackground: [], systemAwareness: [], exampleLines: [],
    }],
    spine: { acts: [], centralConflict: "c", theme: "t", endingDirection: "e" },
    seed: {
      genre: "adult guild mission progression fantasy",
      premise: "p",
      characters: [{ name: "X", role: "protagonist", description: "d" }],
      pipelineOverrides: { planningSceneTurnShapingV1: true },
    },
    retryFeedback: "7 scene entries > native planning budget 5+1 for 3100w target",
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Count contract: emit 3-5 entries")
  expect(context).toContain("Turn-shaping scope limit: do not exceed 5 entries")
  expect(context).toContain("Retry count requirement: emit 3-5 entries")
  expect(context).toContain("merging adjacent middle movements")
})

test("planning scene context renders calibrated scene count guidance", () => {
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
  expect(context).toContain("Recommended scene/turn entries for this chapter size: 3")
  expect(context).toContain("minimum structural floor: 3")
  expect(context).toContain("Count contract: emit 3-4 entries")
  expect(context).toContain("Native planning scope limit: do not exceed 4 entries")
  expect(context).toContain("Scope by content load")
  expect(context).not.toContain("100-140 words")
})

test("planning scene context renders explicit planning max override guidance", () => {
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
      pipelineOverrides: { planningMaxScenesPerChapter: 4 },
    },
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Planning max override: 4 entries")
  expect(context).toContain("Do not exceed this explicit cap")
})

test("planning scene context renders native contract guidance by default with explicit legacy override", () => {
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
  expect(context).toContain("Author about 3 complete story-turn entries")
  expect(context).toContain("include povPersonalStake")
  expect(context).toContain("want, need, fear")
  expect(context).toContain("Do not emit micro-actions")
  expect(context).toContain("final entry must preserve the chapter endpoint/hook")
  expect(context).toContain("sized by dramatic load rather than by a word-count quota")
  expect(context).not.toContain("Planning max override")
  expect(legacy).not.toContain("Native planning contract")
})

test("planning scene context carries native-contract retry feedback", () => {
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
    retryFeedback: "5 scene entries > native planning budget 3+1 for 1500w target",
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("PREVIOUS SCENE EXPANSION FAILED")
  expect(context).toContain("5 scene entries > native planning budget 3+1")
  expect(context).toContain("Retry count requirement: emit 3-4 entries")
  expect(context).toContain("Do not drop the endpoint")
})

test("planning scene context scopes mercenary directives and hides future skeleton purpose detail", () => {
  const mercenarySeed = JSON.parse(readFileSync("src/seeds/mercenary-rillgate-saltmine.json", "utf8")) as SeedInput
  const ch1 = {
    ...chapter(1, 3100),
    title: "The Debt Bell",
    purpose: "Kael learns Mira's marker will be sold and leaves with Lady Varn only as a lead.",
  }
  const ch2 = {
    ...chapter(2, 3100),
    title: "The Varn Offer",
    purpose: "Kael first meets Lady Varn, signs the contract, and leaves Rillgate.",
  }
  const ch6 = {
    ...chapter(6, 3100),
    title: "The Core Vault",
    purpose: "Kael discovers the illegal monster-core harvest in the sealed chamber.",
  }
  const context = buildContext({
    targetChapter: ch1,
    allSkeletons: [ch1, ch2, ch6],
    priorChapters: [],
    worldBible: {
      setting: "Rillgate",
      timePeriod: "now",
      geography: "salt flats",
      politicalStructure: "guild",
      technologyConstraints: "contracts",
      socialCustoms: [],
      sensoryPalette: "salt and ink",
      rules: ["Rank law matters"],
      locations: [{ name: "Contract Hall", description: "A contract hub" }],
      culture: "ranked",
      history: "old mines",
      systems: [],
      cultures: [],
    },
    characters: [{
      id: "kael-rusk",
      name: "Kael Rusk",
      role: "protagonist",
      backstory: "",
      traits: ["tactical"],
      speechPattern: "clipped",
      goals: "earn bronze",
      fears: "losing Mira",
      relationships: [],
      culturalBackground: [],
      systemAwareness: [],
      exampleLines: [],
    }],
    spine: {
      acts: [],
      centralConflict: "rank versus debt",
      theme: "law has teeth",
      endingDirection: "provisional victory",
    },
    seed: mercenarySeed,
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("CHAPTER-SCOPED DIRECTIVES")
  expect(context).toContain("mpa-ch01-hub-debt-pressure")
  expect(context).toContain("CHAPTER STORY SCOPE")
  expect(context).toContain("Boundary locks:")
  expect(context).toContain("TARGET REQUIRED BEATS")
  expect(context).toContain("MPA-01 Hub pressure")
  expect(context).toContain("Ch 2: \"The Varn Offer\" — FUTURE CHAPTER BOUNDARY ONLY")
  expect(context).not.toContain("First Lady Varn office meeting")
  expect(context).not.toContain("Lady Varn's office")
  expect(context).not.toContain("Kael first meets Lady Varn, signs the contract")
  expect(context).not.toContain("Kael discovers the illegal monster-core harvest")
  expect(context).not.toContain("First two chapter scene pressure notes")
  expect(context).not.toContain("Chapter separation guard")
})

test("planning scene context redacts future reveal vocabulary from current character and world context", () => {
  const mercenarySeed = JSON.parse(readFileSync("src/seeds/mercenary-rillgate-saltmine.json", "utf8")) as SeedInput
  const ch2 = {
    ...chapter(2, 3100),
    title: "The Salt-Mine Contract",
    povCharacter: "Kael Rusk",
    setting: "Lady Varn's Office, Rillgate Contract Hall",
    purpose: "Kael first meets Lady Varn, evaluates the contract, signs, checks Orin, and leaves.",
    charactersPresent: ["Kael Rusk", "Lady Varn", "Orin Vale"],
  }
  const context = buildContext({
    targetChapter: ch2,
    allSkeletons: [ch2],
    priorChapters: [],
    worldBible: {
      setting: "Rillgate hides monster cores under contract law",
      timePeriod: "now",
      geography: "salt flats",
      politicalStructure: "guild",
      technologyConstraints: "contracts",
      socialCustoms: [],
      sensoryPalette: "salt and ink",
      rules: ["Contract law matters", "Monster cores degrade unless sealed in brine", "Brine wards react to stolen cores"],
      locations: [
        { name: "Lady Varn's Office", description: "A contract office" },
        { name: "Sealed Ruin Chamber", description: "A future monster core vault" },
      ],
      culture: "ranked",
      history: "old mines",
      systems: [],
      cultures: [],
    },
    characters: [
      {
        id: "kael-rusk",
        name: "Kael Rusk",
        role: "protagonist",
        backstory: "",
        traits: ["tactical"],
        speechPattern: "clipped",
        goals: "earn bronze",
        fears: "losing Mira",
        relationships: [],
        culturalBackground: [],
        systemAwareness: [],
        exampleLines: [],
      },
      {
        id: "lady-varn",
        name: "Lady Varn",
        role: "antagonist",
        backstory: "",
        traits: ["polite", "monster core broker"],
        speechPattern: "formal",
        goals: "Complete the illegal core harvest before Kael understands the job.",
        fears: "Admissible evidence exposes the monster core operation.",
        relationships: [],
        culturalBackground: [],
        systemAwareness: [],
        exampleLines: [],
      },
    ],
    spine: {
      acts: [],
      centralConflict: "rank versus debt",
      theme: "law has teeth",
      endingDirection: "provisional victory",
    },
    seed: mercenarySeed,
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Lady Varn's Office")
  expect(context).toContain("Withheld here because it belongs to a later chapter boundary")
  expect(context).not.toContain("Monster cores degrade")
  expect(context).not.toContain("stolen cores")
  expect(context).not.toContain("monster core broker")
  expect(context).not.toContain("Complete the illegal core harvest")
  expect(context).not.toContain("Sealed Ruin Chamber")
})

test("planning scene context redacts future-boundary terms from current chapter purpose and story debts", () => {
  const mercenarySeed = JSON.parse(readFileSync("src/seeds/mercenary-rillgate-saltmine.json", "utf8")) as SeedInput
  const ch5 = {
    ...chapter(5, 3100),
    title: "The Iron Cost",
    povCharacter: "Kael Rusk",
    setting: "Gray Salt Mine, side tunnel",
    purpose: "Kael gains a ward-pattern read, but the illegal harvest remains hidden until the sealed chamber reveal.",
    charactersPresent: ["Kael Rusk", "Tessa Mire"],
  }
  const ch6 = {
    ...chapter(6, 3100),
    title: "The Core Vault",
    purpose: "Kael discovers the illegal monster-core harvest in the sealed chamber.",
  }
  const context = buildContext({
    targetChapter: ch5,
    allSkeletons: [ch5, ch6],
    priorChapters: [],
    worldBible: {
      setting: "Rillgate",
      timePeriod: "now",
      geography: "salt flats",
      politicalStructure: "guild",
      technologyConstraints: "contracts",
      socialCustoms: [],
      sensoryPalette: "salt and ink",
      rules: ["Monster cores degrade unless sealed in brine", "Rank law matters"],
      locations: [
        { name: "Gray Salt Mine", description: "A flooded mine" },
        { name: "Sealed Ruin Chamber", description: "A monster core vault" },
      ],
      culture: "ranked",
      history: "old mines",
      systems: [],
      cultures: [],
    },
    characters: [
      {
        id: "kael-rusk",
        name: "Kael Rusk",
        role: "protagonist",
        backstory: "",
        traits: ["tactical"],
        speechPattern: "clipped",
        goals: "earn bronze",
        fears: "losing Mira",
        relationships: [],
        culturalBackground: [],
        systemAwareness: [],
        exampleLines: [],
      },
      {
        id: "tessa-mire",
        name: "Tessa Mire",
        role: "supporting",
        backstory: "",
        traits: ["witness"],
        speechPattern: "legal",
        goals: "uncover sponsor pressure",
        fears: "the illegal operation",
        relationships: [],
        culturalBackground: [],
        systemAwareness: [],
        exampleLines: [],
      },
    ],
    spine: {
      acts: [],
      centralConflict: "rank versus debt",
      theme: "law has teeth",
      endingDirection: "provisional victory",
    },
    seed: mercenarySeed,
  } as Parameters<typeof buildContext>[0])

  expect(context).toContain("Withheld here because it includes future-boundary material")
  expect(context).toContain("Withheld here because it belongs to a later payoff boundary")
  expect(context.toLowerCase()).not.toContain("illegal")
  expect(context.toLowerCase()).not.toContain("monster core")
  expect(context.toLowerCase()).not.toContain("sealed chamber")
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
