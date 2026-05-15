import { describe, expect, test } from "bun:test"

import {
  buildAuthoringBiblePackFromPlanningArtifact,
  validateAuthoringBiblePlanningArtifact,
  type AuthoringBiblePlanningArtifact,
} from "./authoring-bible-cards"

describe("authoring bible planning artifact", () => {
  test("converts interactive planning cards into a runtime pack", () => {
    const artifact: AuthoringBiblePlanningArtifact = {
      mode: "authoring-bible-planning-artifact-v1",
      packId: "rillgate-test-v1",
      title: "Rillgate Test",
      description: "Test pack.",
      cards: [
        {
          id: "rillgate-test-v1:char:kael",
          kind: "character",
          title: "Kael risk math",
          appliesWhen: "Kael is present.",
          characterId: "char-kael",
          characterName: "Kael",
          operatingModel: "Kael prices risk before sentiment.",
          dialogueModel: "Short bargaining clauses.",
          interiorAttention: "leverage, witness status, debt exposure",
          microExamples: ["Name the price. Then the catch."],
        },
        {
          id: "rillgate-test-v1:world:guild-law",
          kind: "world",
          title: "Paper is a weapon",
          appliesWhen: "A scene invokes contracts or witnessed claims.",
          selectionHints: ["contract", "witnessed claim"],
          worldPressure: "Guild paper changes who can claim salvage.",
          vocabulary: ["witness", "seal"],
        },
      ],
    }

    expect(validateAuthoringBiblePlanningArtifact(artifact)).toEqual([])
    const pack = buildAuthoringBiblePackFromPlanningArtifact(artifact)

    expect(pack.id).toBe("rillgate-test-v1")
    expect(pack.characterRules?.[0]).toMatchObject({
      id: "pack:rillgate-test-v1:char:kael",
      kind: "character",
      characterName: "Kael",
    })
    expect(pack.characterRules?.[0]?.text).toContain("Name the price")
    expect(pack.worldRules?.[0]?.selectionHints).toEqual(["contract", "witnessed claim"])
  })

  test("detects duplicate and incomplete card data", () => {
    const artifact: AuthoringBiblePlanningArtifact = {
      mode: "authoring-bible-planning-artifact-v1",
      packId: "",
      title: "",
      description: "",
      cards: [
        {
          id: "dup",
          kind: "voice",
          title: "",
          appliesWhen: "",
          voicePrinciple: "Keep pressure concrete.",
        },
        {
          id: "dup",
          kind: "story",
          title: "Mission loop",
          appliesWhen: "Mission scenes.",
          storyFunction: "Keep the contract active.",
        },
      ],
    }

    expect(validateAuthoringBiblePlanningArtifact(artifact)).toContain("packId is required")
    expect(validateAuthoringBiblePlanningArtifact(artifact)).toContain("duplicate card id: dup")
  })
})
