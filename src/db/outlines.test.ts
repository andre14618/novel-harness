import { expect, test } from "bun:test"

import { normalizeChapterOutlineForPersistence } from "./outlines"
import type { ChapterOutline, SceneBeat } from "../types"

test("normalizeChapterOutlineForPersistence assigns stable chapter, beat, state, knowledge, and obligation ids", () => {
  const normalized = normalizeChapterOutlineForPersistence({
    chapterNumber: 2,
    title: "The Forged Ledger",
    povCharacter: "Istra",
    setting: "The infirmary",
    purpose: "Reveal the lie",
    targetWords: 500,
    charactersPresent: ["Istra"],
    scenes: [
      {
        description: "Istra proves the ledger is forged.",
        characters: ["Istra"],
        kind: "action",
        requiredPayoffs: [],
        obligations: {
          mustEstablish: [
            { text: "Aldric forged the ledger", sourceId: "fact-ledger-forgery", sourceKind: "fact" } as any,
          ],
          mustPayOff: [],
          mustTransferKnowledge: [
            { text: "Istra learns the ledger is forged", sourceId: "know-istra-ledger", sourceKind: "knowledge", characterId: "char-istra" } as any,
          ],
          mustShowStateChange: [
            { text: "Istra becomes resolved", sourceId: "state-istra-resolved", sourceKind: "state", characterId: "char-istra" } as any,
          ],
          mustNotReveal: [
            { text: "Do not reveal Wren's hiding place" } as any,
          ],
          allowedNewEntities: [],
        },
        lifeValueAxes: [],
        miceActive: [],
        miceOpens: [],
        miceCloses: [],
      } as SceneBeat,
    ],
    establishedFacts: [
      { id: "fact-ledger-forgery", fact: "Aldric forged the ledger", category: "knowledge" },
    ],
    knowledgeChanges: [
      { characterName: "Istra", knowledge: "The ledger is forged", source: "deduced" } as any,
    ],
    characterStateChanges: [
      { name: "Istra", location: "The infirmary", emotionalState: "resolved", knows: [], doesNotKnow: [] } as any,
    ],
  } as ChapterOutline)

  expect(normalized.chapterId).toBe("ch-002-forged-ledger")
  expect(normalized.scenes[0].beatId).toBe("ch-002-forged-ledger-beat-001-istra-proves-ledger-forged")
  expect(normalized.knowledgeChanges[0].id).toBe("know-istra-ledger-forged")
  expect(normalized.knowledgeChanges[0].characterId).toBe("char-istra")
  expect(normalized.characterStateChanges[0].id).toBe("state-istra-infirmary-resolved")
  expect(normalized.characterStateChanges[0].characterId).toBe("char-istra")
  expect((normalized.scenes[0].obligations.mustEstablish[0] as any).obligationId).toMatch(/^obl-002-forged-ledger-beat-001-istra-proves-ledger-forged-fact-/)
  expect((normalized.scenes[0].obligations.mustTransferKnowledge[0] as any).obligationId).toMatch(/^obl-002-forged-ledger-beat-001-istra-proves-ledger-forged-know-/)
  expect((normalized.scenes[0].obligations.mustShowStateChange[0] as any).obligationId).toMatch(/^obl-002-forged-ledger-beat-001-istra-proves-ledger-forged-state-/)
  expect((normalized.scenes[0].obligations.mustNotReveal[0] as any).obligationId).toMatch(/^obl-002-forged-ledger-beat-001-istra-proves-ledger-forged-avoid-/)
})

test("normalizeChapterOutlineForPersistence does not mutate caller-owned outline", () => {
  const outline = {
    chapterNumber: 1,
    title: "Mutable Caller",
    scenes: [{ description: "A beat.", characters: [], requiredPayoffs: [] }],
    establishedFacts: [],
    knowledgeChanges: [],
    characterStateChanges: [],
  } as unknown as ChapterOutline

  const normalized = normalizeChapterOutlineForPersistence(outline)

  expect(outline.chapterId).toBeUndefined()
  expect(outline.scenes[0].beatId).toBeUndefined()
  expect(normalized.chapterId).toBe("ch-001-mutable-caller")
  expect(normalized.scenes[0].beatId).toBe("ch-001-mutable-caller-beat-001-beat")
})
