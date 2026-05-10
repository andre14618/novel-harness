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

// L098 Slice 3: outline with sourced obligations on specific scenes for
// scene-keyed routing tests. Beat-2 carries the "obl-jon-watch" obligation;
// beat-3 carries "obl-mira-decide". A finding referencing one of these
// obligationIds should route to the matching entry, not beat 0.
function outlineWithObligations(): ChapterOutline {
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

describe("routeValidationBlockers", () => {
  test("L098 Slice 3: routes obligation-keyed findings to the matching entry, not beat 0", () => {
    const description = "Scene did not satisfy the door-watch obligation."
    const findings: ValidationFinding[] = [
      {
        severity: "blocker",
        code: "scene_satisfaction",
        description,
        chapterNumber: 1,
        obligationIds: ["obl-jon-watch"],
      },
    ]

    const routed = routeValidationBlockers(
      [description],
      outlineWithObligations(),
      ["beat 1", "beat 2", "beat 3"],
      findings,
    )

    // Should route to beat-index 1 (the entry holding obl-jon-watch),
    // NOT to beat 0 (the legacy fallback).
    expect([...routed.keys()]).toEqual([1])
    expect(routed.get(1)?.[0]).toContain("did not satisfy the door-watch")
  })

  test("L098 Slice 3: prefers exact beatIndex over obligation-id lookup when both are present", () => {
    const description = "Scene-coverage finding with conflicting refs."
    const findings: ValidationFinding[] = [
      {
        severity: "blocker",
        code: "scene_satisfaction",
        description,
        chapterNumber: 1,
        beatIndex: 0,
        obligationIds: ["obl-jon-watch"],
      },
    ]

    const routed = routeValidationBlockers(
      [description],
      outlineWithObligations(),
      ["beat 1", "beat 2", "beat 3"],
      findings,
    )

    // beatIndex wins; obligation-id is not consulted when beatIndex is defined.
    expect([...routed.keys()]).toEqual([0])
  })

  test("L098 Slice 3: falls through to legacy beat-0 when obligation-id has no match", () => {
    const description = "Scene-coverage finding referencing an unknown obligation."
    const findings: ValidationFinding[] = [
      {
        severity: "blocker",
        code: "scene_satisfaction",
        description,
        chapterNumber: 1,
        obligationIds: ["obl-does-not-exist"],
      },
    ]

    const routed = routeValidationBlockers(
      [description],
      outlineWithObligations(),
      ["beat 1", "beat 2", "beat 3"],
      findings,
    )

    // No matching obligation → legacy default (beat 0).
    expect([...routed.keys()]).toEqual([0])
  })
})

describe("routeValidationBlockers", () => {
  test("does not route word-count findings because length is advisory", () => {
    const description = "Chapter too short: 20 words (minimum 500)"
    const findings: ValidationFinding[] = [
      { severity: "warning", code: "word_count_min", description, chapterNumber: 1, chapterId: "ch-001-archive" },
    ]

    const routed = routeValidationBlockers(
      [],
      outline(),
      ["one two three", "one", "one two"],
      findings,
    )

    expect([...routed.keys()]).toEqual([])
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
