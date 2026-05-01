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
