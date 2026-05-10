import { describe, expect, test } from "bun:test"

import { routeChapterPlanDeviations } from "./chapter-plan-routing"
import type { ChapterOutline } from "../types"
import type { ChapterPlanCheckResult } from "../agents/chapter-plan-checker/schema"

const emptyObligations = {
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
}

function outline(): ChapterOutline {
  return {
    chapterNumber: 1,
    chapterId: "ch-001-archive",
    title: "Archive",
    povCharacter: "Mira",
    setting: "Archive",
    purpose: "Test routing.",
    targetWords: 800,
    charactersPresent: ["Mira", "Jon"],
    charactersPresentIds: ["char-mira", "char-jon"],
    scenes: [
      { beatId: "beat-1", description: "Mira waits.", characters: ["Mira"], kind: "dialogue", requiredPayoffs: [], obligations: emptyObligations, lifeValueAxes: [], miceActive: [], miceOpens: [], miceCloses: [] },
      {
        beatId: "beat-2",
        description: "Jon watches.",
        characters: ["Jon"],
        kind: "description",
        requiredPayoffs: [],
        obligations: {
          ...emptyObligations,
          mustEstablish: [{ text: "Jon watches the door.", sourceId: "fact-door", obligationId: "obl-jon-watch" }],
        },
        lifeValueAxes: [], miceActive: [], miceOpens: [], miceCloses: [],
      },
      {
        beatId: "beat-3",
        description: "Mira decides.",
        characters: ["Mira"],
        kind: "action",
        requiredPayoffs: [],
        obligations: {
          ...emptyObligations,
          mustShowStateChange: [{ text: "Mira commits.", sourceId: "state-mira", obligationId: "obl-mira-decide" }],
        },
        lifeValueAxes: [], miceActive: [], miceOpens: [], miceCloses: [],
      },
    ],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  } as ChapterOutline
}

function result(partial: Partial<ChapterPlanCheckResult>): ChapterPlanCheckResult {
  return {
    pass: false,
    deviations: [],
    ...partial,
  }
}

describe("routeChapterPlanDeviations", () => {
  test("routes obligation-keyed scene deviations to the matching entry, not beat 0", () => {
    const routed = routeChapterPlanDeviations(result({
      deviations: [{
        beat_index: null,
        obligationIds: ["obl-jon-watch"],
        description: "Scene did not satisfy the door-watch obligation.",
      }],
    }), outline())

    expect([...routed.keys()]).toEqual([1])
    expect(routed.get(1)?.[0]).toContain("door-watch")
  })

  test("prefers explicit beat_index over obligation IDs", () => {
    const routed = routeChapterPlanDeviations(result({
      deviations: [{
        beat_index: 0,
        obligationIds: ["obl-jon-watch"],
        description: "Conflicting refs.",
      }],
    }), outline())

    expect([...routed.keys()]).toEqual([0])
  })

  test("falls back to beat 0 when obligation IDs do not match any entry", () => {
    const routed = routeChapterPlanDeviations(result({
      deviations: [{
        beat_index: null,
        obligationIds: ["obl-missing"],
        description: "Unknown obligation route.",
      }],
    }), outline())

    expect([...routed.keys()]).toEqual([0])
    expect(routed.get(0)?.[0]).toContain("Unknown obligation")
  })

  test("keeps legacy setting and emotional-arc routing", () => {
    const routed = routeChapterPlanDeviations(result({
      deviations: [],
      setting_match: { planned: "Archive", observed: "Docks", matches: false },
      emotional_arc_correct: false,
    }), outline())

    expect(routed.get(0)?.[0]).toContain("Chapter setting mismatch")
    expect(routed.get(1)?.[0]).toContain("Emotional arc reversed")
    expect(routed.get(2)?.[0]).toContain("Emotional arc reversed")
  })
})
