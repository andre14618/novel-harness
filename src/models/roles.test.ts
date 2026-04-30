import { describe, expect, test } from "bun:test"
import { getModelForAgent, resolveStructuralPriors } from "./roles"

describe("writer genre pack routing", () => {
  test("fantasy genre supplies structural priors without changing the writer model", () => {
    const priors = resolveStructuralPriors("dark fantasy")
    const writer = getModelForAgent("beat-writer")

    expect(priors?.beatsPerChapter).toEqual([11, 40])
    expect(writer?.provider).toBe("deepseek")
    expect(writer?.model).toBe("deepseek-v4-flash")
  })

  test("non-fantasy genre does not receive fantasy structural priors", () => {
    expect(resolveStructuralPriors("near-future romance")).toBeNull()
  })

  test("active checker slots use base DeepSeek rather than W&B adapters", () => {
    expect(getModelForAgent("adherence-events")?.provider).toBe("deepseek")
    expect(getModelForAgent("halluc-ungrounded")?.provider).toBe("deepseek")
    expect(getModelForAgent("functional-state-checker")?.provider).toBe("deepseek")
    expect(getModelForAgent("continuity-facts")?.provider).toBe("deepseek")
    expect(getModelForAgent("continuity-state")?.provider).toBe("deepseek")
  })
})
