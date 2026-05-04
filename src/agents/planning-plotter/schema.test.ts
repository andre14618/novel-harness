import { describe, expect, test } from "bun:test"
import { chapterOutlineSchema, persistedChapterOutlineSchema } from "./schema"

describe("persistedChapterOutlineSchema (Codex round-2 MEDIUM 1)", () => {
  const validOutline = {
    chapterNumber: 1,
    title: "Test Chapter",
    povCharacter: "Hero",
    setting: "Tower",
    purpose: "Test",
    targetWords: 1000,
    charactersPresent: [],
    charactersPresentIds: [],
    scenes: [
      {
        description: "Test beat.",
        characters: [],
        kind: "action" as const,
        requiredPayoffs: [],
        obligations: {
          mustEstablish: [],
          mustPayOff: [],
          mustTransferKnowledge: [],
          mustShowStateChange: [],
          mustNotReveal: [],
          allowedNewEntities: [],
        },
      },
    ],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  }

  test("accepts a fully-populated valid outline", () => {
    const r = persistedChapterOutlineSchema.safeParse(validOutline)
    expect(r.success).toBe(true)
  })

  test("rejects an outline missing the `scenes` field (permissive accepts it)", () => {
    // Permissive schema defaults missing scenes to [] — silently accepts.
    const without = { ...validOutline } as Record<string, unknown>
    delete without.scenes
    const permissive = chapterOutlineSchema.safeParse(without)
    expect(permissive.success).toBe(true)
    // Strict schema requires scenes — fails with "Required" issue.
    const strict = persistedChapterOutlineSchema.safeParse(without)
    expect(strict.success).toBe(false)
    if (!strict.success) {
      const sceneIssue = strict.error.issues.find((i) => i.path[0] === "scenes")
      expect(sceneIssue).toBeDefined()
    }
  })

  test("rejects an outline missing the `establishedFacts` field", () => {
    const without = { ...validOutline } as Record<string, unknown>
    delete without.establishedFacts
    const strict = persistedChapterOutlineSchema.safeParse(without)
    expect(strict.success).toBe(false)
    if (!strict.success) {
      const issue = strict.error.issues.find((i) => i.path[0] === "establishedFacts")
      expect(issue).toBeDefined()
    }
  })

  test("rejects an outline missing the `characterStateChanges` field", () => {
    const without = { ...validOutline } as Record<string, unknown>
    delete without.characterStateChanges
    const strict = persistedChapterOutlineSchema.safeParse(without)
    expect(strict.success).toBe(false)
  })

  test("rejects an outline missing the `knowledgeChanges` field", () => {
    const without = { ...validOutline } as Record<string, unknown>
    delete without.knowledgeChanges
    const strict = persistedChapterOutlineSchema.safeParse(without)
    expect(strict.success).toBe(false)
  })

  test("rejects an outline whose beat obligations are corrupt (permissive .catch([]) → strict fails)", () => {
    const corrupt = {
      ...validOutline,
      scenes: [
        {
          ...validOutline.scenes[0],
          obligations: {
            mustEstablish: "this-should-be-an-array-of-objects",
            mustPayOff: [],
            mustTransferKnowledge: [],
            mustShowStateChange: [],
            mustNotReveal: [],
            allowedNewEntities: [],
          },
        },
      ],
    }
    // Permissive schema's .catch([]) on mustEstablish silently rescues this.
    const permissive = chapterOutlineSchema.safeParse(corrupt)
    expect(permissive.success).toBe(true)
    if (permissive.success) {
      // Permissive masks the corruption — empties the field instead of failing.
      expect(permissive.data.scenes[0].obligations.mustEstablish).toEqual([])
    }
    // Strict schema raises a structured failure on the same input.
    const strict = persistedChapterOutlineSchema.safeParse(corrupt)
    expect(strict.success).toBe(false)
  })

  test("rejects a corrupt beat obligations field that's a number (not even an object)", () => {
    const corrupt = {
      ...validOutline,
      scenes: [
        {
          ...validOutline.scenes[0],
          obligations: 42,
        },
      ],
    }
    const strict = persistedChapterOutlineSchema.safeParse(corrupt)
    expect(strict.success).toBe(false)
  })
})
