import { expect, test } from "bun:test"

import { deriveBeatObligations, renderBeatObligations } from "./beat-obligations"
import type { ChapterOutline, SceneBeat } from "../types"

test("deriveBeatObligations maps payoff links to seed and payoff beat obligations", () => {
  const outline = chapter({
    scenes: [
      beat({ description: "Istra notices the marsh fungus compound slows the Ashrot but keeps quiet.", requiredPayoffs: [{ fact_id: "fungus-slows-ashrot", payoff_beat: 2 }] }),
      beat({ description: "Aldric pressures Istra for a clean answer." }),
      beat({ description: "Istra uses the marsh fungus compound to buy Wren another hour." }),
    ],
    establishedFacts: [
      { id: "fungus-slows-ashrot", fact: "The marsh fungus compound slows Ashrot symptoms", category: "rule" },
    ],
  })

  const result = deriveBeatObligations(outline)

  expect(result.summary.orphanFacts).toBe(0)
  expect(result.beats[0].mustEstablish).toEqual([
    expect.objectContaining({ text: "The marsh fungus compound slows Ashrot symptoms", confidence: "explicit", factId: "fungus-slows-ashrot" }),
  ])
  expect(result.beats[2].mustPayOff).toEqual([
    expect.objectContaining({ text: "The marsh fungus compound slows Ashrot symptoms", confidence: "explicit", seededAtBeat: 0 }),
  ])
})

test("deriveBeatObligations treats planner-authored obligations as explicit assignments", () => {
  const result = deriveBeatObligations(chapter({
    scenes: [
      beat({
        description: "Calla studies Davan's skin.",
        obligations: {
          mustEstablish: [{ id: "old-script", text: "Davan bears the Old Tongue on his skin" }],
          mustPayOff: [],
          mustTransferKnowledge: [{ characterName: "Calla", text: "Calla learns Davan bears the Old Tongue" }],
          mustShowStateChange: [{ characterName: "Calla", text: "Calla changes from detached executioner to protective witness" }],
          mustNotReveal: [{ text: "Do not reveal Orvath's full plan" }],
          allowedNewEntities: ["Old Tongue"],
        },
      }),
    ],
    establishedFacts: [
      { id: "old-script", fact: "Davan bears the Old Tongue on his skin", category: "identity" },
    ],
    knowledgeChanges: [
      { characterName: "Calla", knowledge: "Davan bears the Old Tongue", source: "discovered" },
    ],
    characterStateChanges: [
      { name: "Calla", location: "Iron Hall", emotionalState: "protective witness", knows: [], doesNotKnow: [] },
    ],
  }))

  expect(result.summary.orphanFacts).toBe(0)
  expect(result.summary.orphanKnowledgeChanges).toBe(0)
  expect(result.summary.orphanStateChanges).toBe(0)
  expect(result.beats[0].mustEstablish[0]).toEqual(expect.objectContaining({ confidence: "explicit", source: "scene.obligations.mustEstablish" }))
  expect(result.beats[0].mustNotReveal[0]).toEqual(expect.objectContaining({ kind: "avoid", text: "Do not reveal Orvath's full plan" }))
  expect(result.beats[0].allowedNewEntities).toContain("Old Tongue")
})

test("deriveBeatObligations infers fact and knowledge obligations from beat text", () => {
  const outline = chapter({
    scenes: [
      beat({ description: "Istra examines Wren's green-lit memory and realizes the cure damages language." }),
      beat({ description: "Aldric waits outside the curtain." }),
    ],
    establishedFacts: [
      { id: "cure-damages-language", fact: "The cure damages language memory", category: "knowledge" },
    ],
    knowledgeChanges: [
      { characterName: "Istra", knowledge: "The cure damages language memory", source: "deduced" },
    ],
  })

  const result = deriveBeatObligations(outline)

  expect(result.summary.orphanFacts).toBe(0)
  expect(result.summary.orphanKnowledgeChanges).toBe(0)
  expect(result.beats[0].mustEstablish[0]).toEqual(expect.objectContaining({ source: "establishedFacts.text-match", confidence: "inferred" }))
  expect(result.beats[0].mustTransferKnowledge[0]).toEqual(expect.objectContaining({ characterName: "Istra", source: "knowledgeChanges.text-match" }))
})

test("deriveBeatObligations warns about orphan state that is not writer-visible", () => {
  const outline = chapter({
    scenes: [
      beat({ description: "Istra prepares another dose." }),
      beat({ description: "Aldric leaves the infirmary." }),
    ],
    characterStateChanges: [
      { name: "Istra", location: "The sealed archive", emotionalState: "furious clarity", knows: ["Aldric falsified the plague ledgers"], doesNotKnow: [] },
    ],
  })

  const result = deriveBeatObligations(outline)

  expect(result.summary.orphanStateChanges).toBe(1)
  expect(result.warnings[0]).toContain("characterStateChange")
  expect(result.warnings[0]).toContain("Istra")
})

test("deriveBeatObligations counts id-less established facts as orphan telemetry", () => {
  const result = deriveBeatObligations(chapter({
    scenes: [beat({ description: "Istra records the cure result." })],
    establishedFacts: [
      { id: "", fact: "The cure result is unstable", category: "knowledge" },
    ],
  }))

  expect(result.summary.factCount).toBe(1)
  expect(result.summary.orphanFacts).toBe(1)
  expect(result.warnings[0]).toContain("without id")
})

test("deriveBeatObligations warns when a payoff target is outside the chapter", () => {
  const result = deriveBeatObligations(chapter({
    scenes: [
      beat({ description: "Istra plants a cure clue.", requiredPayoffs: [{ fact_id: "cure-clue", payoff_beat: 9 }] }),
    ],
    establishedFacts: [
      { id: "cure-clue", fact: "The cure clue points to the archive", category: "knowledge" },
    ],
  }))

  expect(result.warnings[0]).toContain("points outside the chapter")
  expect(result.beats[0].mustEstablish[0]).toEqual(expect.objectContaining({ factId: "cure-clue" }))
})

test("deriveBeatObligations does not mark known chapter characters as allowed new entities", () => {
  const result = deriveBeatObligations(chapter({
    charactersPresent: ["Istra", "Wren"],
    scenes: [beat({ description: "Wren coughs behind the curtain while the Ledger Key glows.", characters: ["Istra"] })],
  }))

  expect(result.beats[0].allowedNewEntities).not.toContain("Wren")
  expect(result.beats[0].allowedNewEntities).toContain("Ledger Key")
})

test("deriveBeatObligations avoids substring character matches", () => {
  const result = deriveBeatObligations(chapter({
    charactersPresent: ["Al", "Istra"],
    scenes: [
      beat({ description: "Aldric reads the plague ledgers and falsified dates.", characters: ["Aldric"] }),
      beat({ description: "Al hides in the infirmary.", characters: ["Al"] }),
    ],
    knowledgeChanges: [
      { characterName: "Al", knowledge: "plague ledgers and falsified dates", source: "read" },
    ],
  }))

  expect(result.summary.orphanKnowledgeChanges).toBe(1)
  expect(result.beats[0].mustTransferKnowledge).toEqual([])
})

test("renderBeatObligations emits compact writer-facing sections", () => {
  const result = deriveBeatObligations(chapter({
    scenes: [
      beat({ description: "Istra finds the Ledger Key under Wren's pillow.", requiredPayoffs: [{ fact_id: "ledger-key", payoff_beat: 1 }] }),
      beat({ description: "Istra unlocks the ledger with the key." }),
    ],
    establishedFacts: [
      { id: "ledger-key", fact: "The Ledger Key is hidden under Wren's pillow", category: "physical" },
    ],
  }))

  const rendered = renderBeatObligations(result.beats[0])

  expect(rendered).toContain("BEAT OBLIGATIONS")
  expect(rendered).toContain("Must establish")
  expect(rendered).toContain("The Ledger Key is hidden under Wren's pillow")
  expect(rendered).toContain("Allowed new named entities")
  expect(rendered).toContain("Ledger Key")
})

function chapter(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "The Treatment",
    povCharacter: "Istra",
    setting: "The Chancel Infirmary",
    purpose: "Test beat obligations",
    targetWords: 450,
    charactersPresent: ["Istra", "Aldric", "Wren"],
    scenes: [beat()],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  }
}

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description: "Istra treats Wren.",
    characters: ["Istra"],
    kind: "action",
    requiredPayoffs: [],
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  }
}
