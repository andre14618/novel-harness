import { describe, expect, test } from "bun:test"
import { routeValidationBlockers } from "./validation-routing"
import type { ChapterOutline, ValidationFinding } from "../types"

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
      { beatId: "beat-1", description: "Mira waits.", characters: ["Mira", "Jon"], kind: "dialogue", requiredPayoffs: [], obligations: emptyObligations, lifeValueAxes: [], miceActive: [], miceOpens: [], miceCloses: [] },
      { beatId: "beat-2", description: "Jon watches.", characters: ["Jon"], kind: "description", requiredPayoffs: [], obligations: emptyObligations, lifeValueAxes: [], miceActive: [], miceOpens: [], miceCloses: [] },
      { beatId: "beat-3", description: "Mira decides.", characters: ["Mira"], kind: "action", requiredPayoffs: [], obligations: emptyObligations, lifeValueAxes: [], miceActive: [], miceOpens: [], miceCloses: [] },
    ],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  } as ChapterOutline
}

describe("routeValidationBlockers", () => {
  test("routes word-count blockers from structured findings to the shortest beats", () => {
    const description = "Chapter too short: 20 words (minimum 500)"
    const findings: ValidationFinding[] = [
      { severity: "blocker", code: "word_count_min", description, chapterNumber: 1, chapterId: "ch-001-archive" },
    ]

    const routed = routeValidationBlockers(
      [description],
      outline(),
      ["one two three", "one", "one two"],
      findings,
    )

    expect([...routed.keys()]).toEqual([1, 2])
    expect(routed.get(1)?.[0]).toContain("under the target word count")
    expect(routed.get(2)?.[0]).toContain("under the target word count")
  })

  test("routes beat-scoped validation findings directly to their beat index", () => {
    const description = "Scene beat 2 has no keyword matches — may be missing entirely"
    const findings: ValidationFinding[] = [
      {
        severity: "blocker",
        code: "beat_keyword_missing",
        description,
        chapterNumber: 1,
        chapterId: "ch-001-archive",
        beatIndex: 1,
        beatId: "beat-2",
      },
    ]

    const routed = routeValidationBlockers(
      [description],
      outline(),
      ["long enough", "short", "also enough"],
      findings,
    )

    expect([...routed.keys()]).toEqual([1])
    expect(routed.get(1)?.[0]).toContain("planned beat is clearly present")
  })

  test("falls back to legacy blocker strings when findings do not match current blockers", () => {
    const findings: ValidationFinding[] = [
      { severity: "blocker", code: "word_count_min", description: "stale blocker", chapterNumber: 1 },
    ]

    const routed = routeValidationBlockers(
      ['POV character "Mira" never mentioned in draft'],
      outline(),
      ["one", "two", "three"],
      findings,
    )

    expect([...routed.keys()]).toEqual([2])
    expect(routed.get(2)?.[0]).toContain('POV character "Mira" must be dramatized')
  })
})
