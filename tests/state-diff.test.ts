import { describe, test, expect } from "bun:test"
import { diffPlanAgainstState, type PriorCharacterState } from "../src/state-diff"
import { makeChapterOutline } from "./helpers"

describe("diffPlanAgainstState", () => {
  test("empty inputs return ok", () => {
    const outline = makeChapterOutline({
      characterStateChanges: [],
      knowledgeChanges: [],
    })
    const result = diffPlanAgainstState(outline, [])
    expect(result.ok).toBe(true)
    expect(result.conflicts).toHaveLength(0)
  })

  test("knowledge regression: doesNotKnow contradicts prior knows", () => {
    const outline = makeChapterOutline({
      chapterNumber: 5,
      characterStateChanges: [
        { name: "Elena", location: "manor", emotionalState: "tense", knows: [], doesNotKnow: ["the betrayal"] },
      ],
      knowledgeChanges: [],
    })
    const prior: PriorCharacterState[] = [
      { characterName: "Elena", chapterNumber: 3, knows: ["the betrayal"], doesNotKnow: [] },
    ]
    const result = diffPlanAgainstState(outline, prior)
    expect(result.ok).toBe(false)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].type).toBe("knowledge_regression")
    expect(result.conflicts[0].characterName).toBe("Elena")
    expect(result.conflicts[0].priorChapter).toBe(3)
  })

  test("legitimate learning: doesNotKnow → knows is allowed", () => {
    const outline = makeChapterOutline({
      chapterNumber: 5,
      characterStateChanges: [
        { name: "Elena", location: "manor", emotionalState: "shocked", knows: ["the betrayal"], doesNotKnow: [] },
      ],
      knowledgeChanges: [],
    })
    const prior: PriorCharacterState[] = [
      { characterName: "Elena", chapterNumber: 3, knows: [], doesNotKnow: ["the betrayal"] },
    ]
    const result = diffPlanAgainstState(outline, prior)
    expect(result.ok).toBe(true)
  })

  test("redundant learning: knowledgeChanges for already-known topic", () => {
    const outline = makeChapterOutline({
      chapterNumber: 7,
      characterStateChanges: [],
      knowledgeChanges: [
        { characterName: "Elena", knowledge: "the betrayal", source: "told" },
      ],
    })
    const prior: PriorCharacterState[] = [
      { characterName: "Elena", chapterNumber: 5, knows: ["the betrayal"], doesNotKnow: [] },
    ]
    const result = diffPlanAgainstState(outline, prior)
    expect(result.ok).toBe(false)
    expect(result.conflicts[0].type).toBe("redundant_learning")
    expect(result.conflicts[0].priorChapter).toBe(5)
  })

  test("character isolation: Marcus's knowledge does not affect Elena", () => {
    const outline = makeChapterOutline({
      chapterNumber: 5,
      characterStateChanges: [
        { name: "Elena", location: "", emotionalState: "", knows: [], doesNotKnow: ["the betrayal"] },
      ],
      knowledgeChanges: [],
    })
    const prior: PriorCharacterState[] = [
      { characterName: "Marcus", chapterNumber: 3, knows: ["the betrayal"], doesNotKnow: [] },
    ]
    const result = diffPlanAgainstState(outline, prior)
    expect(result.ok).toBe(true)
  })

  test("normalized matching handles case and punctuation differences", () => {
    const outline = makeChapterOutline({
      chapterNumber: 5,
      characterStateChanges: [
        { name: "elena", location: "", emotionalState: "", knows: [], doesNotKnow: ["The Betrayal!"] },
      ],
      knowledgeChanges: [],
    })
    const prior: PriorCharacterState[] = [
      { characterName: "Elena", chapterNumber: 3, knows: ["the betrayal"], doesNotKnow: [] },
    ]
    const result = diffPlanAgainstState(outline, prior)
    expect(result.ok).toBe(false)
    expect(result.conflicts[0].type).toBe("knowledge_regression")
  })

  test("redundant learning is detected even when most recent state doesn't repeat the topic", () => {
    // Planner emits per-chapter deltas, not cumulative snapshots.
    // Topic established in ch3 must still be remembered in ch7 even though ch5 didn't mention it.
    const outline = makeChapterOutline({
      chapterNumber: 7,
      characterStateChanges: [],
      knowledgeChanges: [
        { characterName: "Elena", knowledge: "the betrayal", source: "discovered" },
      ],
    })
    const prior: PriorCharacterState[] = [
      { characterName: "Elena", chapterNumber: 3, knows: ["the betrayal"], doesNotKnow: [] },
      { characterName: "Elena", chapterNumber: 5, knows: ["something else"], doesNotKnow: [] },
    ]
    const result = diffPlanAgainstState(outline, prior)
    expect(result.ok).toBe(false)
    expect(result.conflicts[0].type).toBe("redundant_learning")
    expect(result.conflicts[0].priorChapter).toBe(3)
  })

  test("knowledge regression is detected against earlier chapter even when latest chapter is silent on the topic", () => {
    // Same union-vs-snapshot point for the regression path.
    const outline = makeChapterOutline({
      chapterNumber: 7,
      characterStateChanges: [
        { name: "Elena", location: "", emotionalState: "", knows: [], doesNotKnow: ["the betrayal"] },
      ],
      knowledgeChanges: [],
    })
    const prior: PriorCharacterState[] = [
      { characterName: "Elena", chapterNumber: 2, knows: ["the betrayal"], doesNotKnow: [] },
      { characterName: "Elena", chapterNumber: 5, knows: ["something else"], doesNotKnow: [] },
    ]
    const result = diffPlanAgainstState(outline, prior)
    expect(result.ok).toBe(false)
    expect(result.conflicts[0].type).toBe("knowledge_regression")
    expect(result.conflicts[0].priorChapter).toBe(2)
  })

  test("earliest chapter wins when topic appears in multiple prior chapters", () => {
    const outline = makeChapterOutline({
      chapterNumber: 7,
      characterStateChanges: [],
      knowledgeChanges: [
        { characterName: "Elena", knowledge: "the betrayal", source: "discovered" },
      ],
    })
    const prior: PriorCharacterState[] = [
      { characterName: "Elena", chapterNumber: 2, knows: ["the betrayal"], doesNotKnow: [] },
      { characterName: "Elena", chapterNumber: 5, knows: ["the betrayal"], doesNotKnow: [] },
    ]
    const result = diffPlanAgainstState(outline, prior)
    expect(result.ok).toBe(false)
    expect(result.conflicts[0].priorChapter).toBe(2)
  })

  test("multiple conflicts are all reported", () => {
    const outline = makeChapterOutline({
      chapterNumber: 5,
      characterStateChanges: [
        { name: "Elena", location: "", emotionalState: "", knows: [], doesNotKnow: ["the betrayal", "marcus is alive"] },
      ],
      knowledgeChanges: [
        { characterName: "Elena", knowledge: "the betrayal", source: "told" },
      ],
    })
    const prior: PriorCharacterState[] = [
      { characterName: "Elena", chapterNumber: 3, knows: ["the betrayal", "marcus is alive"], doesNotKnow: [] },
    ]
    const result = diffPlanAgainstState(outline, prior)
    expect(result.ok).toBe(false)
    // 2 regressions + 1 redundant learning
    expect(result.conflicts).toHaveLength(3)
    const types = result.conflicts.map(c => c.type).sort()
    expect(types).toEqual(["knowledge_regression", "knowledge_regression", "redundant_learning"])
  })

  test("character with no prior state is not flagged (first appearance)", () => {
    const outline = makeChapterOutline({
      chapterNumber: 1,
      characterStateChanges: [
        { name: "Elena", location: "manor", emotionalState: "calm", knows: ["her own name"], doesNotKnow: ["the betrayal"] },
      ],
      knowledgeChanges: [
        { characterName: "Elena", knowledge: "the manor's history", source: "told" },
      ],
    })
    const result = diffPlanAgainstState(outline, [])
    expect(result.ok).toBe(true)
  })
})
