import { describe, expect, test } from "bun:test"
import { AGENT_MODELS, getAgentConfig, getModelForAgent, resolveStructuralPriors } from "./roles"

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

  test("active agent routes use only DeepSeek V4 Flash or Pro", () => {
    const allowed = new Set(["deepseek-v4-flash", "deepseek-v4-pro"])
    for (const [agent, assignment] of Object.entries(AGENT_MODELS)) {
      expect({ agent, provider: assignment.provider }).toEqual({ agent, provider: "deepseek" })
      expect({ agent, allowed: allowed.has(assignment.model) }).toEqual({ agent, allowed: true })
      if (assignment.model === "deepseek-v4-pro") {
        expect({ agent, thinking: assignment.thinking }).toEqual({ agent, thinking: true })
      }
    }
  })

  test("getAgentConfig is available immediately after module initialization", () => {
    expect(getAgentConfig("method-pack-planner-diagnostic")).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinking: false,
      maxTokens: 14000,
    })
    expect(getAgentConfig("method-pack-planner-diagnostic-pro")).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      thinking: true,
      maxTokens: 32000,
    })
  })
})
