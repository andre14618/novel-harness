import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { deriveBeatObligations, validateBeatObligationCoverage } from "./beat-obligations"
import { enrichOutlineIds } from "./ids"
import { beatStableIdTraceMeta } from "./stable-id-trace"
import type { ChapterOutline, SceneBeat } from "../types"

test("stable-ID trace links chapter state to obligations and beat-writer metadata", () => {
  const outline = chapter({
    chapterId: "ch-001-ledger-test",
    scenes: [
      beat({
        beatId: "ch-001-ledger-test-beat-001-ledger-breaks",
        description: "Istra proves the ledger is forged and chooses to protect Wren.",
        characters: ["Istra"],
        obligations: {
          mustEstablish: [
            { obligationId: "obl-ledger-fact", sourceId: "fact-ledger-forgery", sourceKind: "fact", text: "Aldric falsified the plague ledgers" } as any,
          ],
          mustPayOff: [],
          mustTransferKnowledge: [
            { obligationId: "obl-ledger-know", sourceId: "know-istra-ledger-forgery", sourceKind: "knowledge", characterId: "char-istra", characterName: "Istra", text: "Istra learns Aldric falsified the plague ledgers" } as any,
          ],
          mustShowStateChange: [
            { obligationId: "obl-ledger-state", sourceId: "state-istra-protective", sourceKind: "state", characterId: "char-istra", characterName: "Istra", text: "Istra becomes protective of Wren" } as any,
          ],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      }),
    ],
    establishedFacts: [
      { id: "fact-ledger-forgery", fact: "Aldric falsified the plague ledgers", category: "knowledge" },
    ],
    knowledgeChanges: [
      { id: "know-istra-ledger-forgery", characterId: "char-istra", characterName: "Istra", knowledge: "Aldric falsified the plague ledgers", source: "deduced" } as any,
    ],
    characterStateChanges: [
      { id: "state-istra-protective", characterId: "char-istra", name: "Istra", location: "The Chancel Infirmary", emotionalState: "protective", knows: ["Aldric falsified the plague ledgers"], doesNotKnow: [] } as any,
    ],
  })

  enrichOutlineIds(outline)
  const validation = validateBeatObligationCoverage(outline)
  const derived = deriveBeatObligations(outline)
  const meta = beatStableIdTraceMeta(outline, outline.scenes[0])

  expect(validation.valid).toBe(true)
  expect(validation.summary.missingSourceIds).toBe(0)
  expect(validation.summary.unknownObligationSourceIds).toBe(0)
  expect(validation.summary.duplicateSourceIds).toBe(0)
  expect(validation.summary.sourceKindMismatches).toBe(0)
  expect(validation.summary.characterIdMismatches).toBe(0)

  expect(derived.beats[0].mustEstablish[0].sourceId).toBe("fact-ledger-forgery")
  expect(derived.beats[0].mustTransferKnowledge[0].sourceId).toBe("know-istra-ledger-forgery")
  expect(derived.beats[0].mustShowStateChange[0].sourceId).toBe("state-istra-protective")

  expect(meta.chapterId).toBe("ch-001-ledger-test")
  expect(meta.beatId).toBe("ch-001-ledger-test-beat-001-ledger-breaks")
  expect(meta.obligationIds).toEqual(["obl-ledger-fact", "obl-ledger-know", "obl-ledger-state"])
  expect(meta.sourceIds.sort()).toEqual(["fact-ledger-forgery", "know-istra-ledger-forgery", "state-istra-protective"].sort())
  expect(meta.characterIds).toEqual(["char-istra"])
})

test("stable-ID harness path contains no fuzzy/text-overlap linking helpers", () => {
  const root = process.cwd()
  const files = [
    "src/harness/ids.ts",
    "src/harness/beat-obligations.ts",
    "src/harness/stable-id-trace.ts",
  ]
  const forbidden = [
    "bestBeatMatch",
    "meaningfulTokens",
    "lookupSourceIdByText",
    "textsMatchForLink",
    "resolveObligationSourceIds",
    "implicitTextMatches",
    "implicit_text_matches",
  ]

  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8")
    for (const token of forbidden) {
      expect(source.includes(token), `${file} must not contain ${token}`).toBe(false)
    }
  }
})

function chapter(overrides: Partial<ChapterOutline> = {}): ChapterOutline {
  return {
    chapterNumber: 1,
    title: "Ledger Test",
    povCharacter: "Istra",
    setting: "The Chancel Infirmary",
    purpose: "Test stable-ID trace",
    targetWords: 450,
    charactersPresent: ["Istra"],
    scenes: [beat()],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
    ...overrides,
  } as ChapterOutline
}

function beat(overrides: Partial<SceneBeat> = {}): SceneBeat {
  return {
    description: "Istra studies the ledger.",
    characters: ["Istra"],
    kind: "action",
    requiredPayoffs: [],
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
    ...overrides,
  } as SceneBeat
}
