import { describe, expect, test } from "bun:test"
import {
  attachChapterPlanDeviationBeatIds,
  chapterPlanCheckSchema,
  resolveDeviationBeatId,
} from "./schema"
import { enrichOutlineIds } from "../../harness/ids"
import type { ChapterOutline, SceneBeat } from "../../types"

const emptyObligations = {
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
}

function makeBeat(description: string): SceneBeat {
  return {
    description,
    characters: ["Mira"],
    kind: "action",
    requiredPayoffs: [],
    obligations: emptyObligations,
    lifeValueAxes: [],
    miceActive: [],
    miceOpens: [],
    miceCloses: [],
  } as SceneBeat
}

function baseOutline(): ChapterOutline {
  return {
    chapterNumber: 3,
    title: "The Lantern Debt",
    povCharacter: "Mira",
    setting: "Moonwell Archive",
    purpose: "Test chapter-plan checker ref threading.",
    targetWords: 1800,
    charactersPresent: ["Mira"],
    charactersPresentIds: [],
    scenes: [
      makeBeat("Mira enters the archive before dawn."),
      makeBeat("Mira finds the ledger hidden under glass."),
      makeBeat("Mira leaves knowing the debt is unpaid."),
    ],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  } as ChapterOutline
}

describe("chapter-plan-checker stable refs", () => {
  test("attaches beatId from an enriched outline without changing legacy fields", () => {
    const outline = baseOutline()
    enrichOutlineIds(outline)
    const expectedBeatId = outline.scenes[1]!.beatId

    const result = attachChapterPlanDeviationBeatIds({
      pass: false,
      deviations: [
        { description: "Beat omits the ledger discovery.", beat_index: 1 },
        { description: "The emotional arc is reversed.", beat_index: null },
      ],
    }, outline)

    expect(result.deviations[0]).toEqual({
      description: "Beat omits the ledger discovery.",
      beat_index: 1,
      beatId: expectedBeatId,
    })
    expect(result.deviations[1]).toEqual({
      description: "The emotional arc is reversed.",
      beat_index: null,
    })
  })

  test("leaves beatId absent for un-enriched or out-of-range beat indices", () => {
    const outline = baseOutline()

    expect(resolveDeviationBeatId(outline, 0)).toBeUndefined()
    expect(resolveDeviationBeatId(outline, 99)).toBeUndefined()
    expect(resolveDeviationBeatId(outline, null)).toBeUndefined()

    const result = attachChapterPlanDeviationBeatIds({
      pass: false,
      deviations: [{ description: "Model pointed outside the plan.", beat_index: 99 }],
    }, outline)

    expect(result.deviations).toEqual([
      { description: "Model pointed outside the plan.", beat_index: 99 },
    ])
  })

  test("keeps legacy string-deviation coercion compatible", () => {
    const parsed = chapterPlanCheckSchema.parse({
      pass: false,
      deviations: ["chapter-level mismatch"],
    })

    expect(parsed.deviations).toEqual([
      { description: "chapter-level mismatch", beat_index: null },
    ])
  })
})
