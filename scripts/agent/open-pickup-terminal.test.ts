import { describe, expect, test } from "bun:test"
import { buildDisplayCommand, buildPickupPrompt, buildRecommendation, buildWezTermArgs, parseArgs } from "./open-pickup-terminal"
import type { LaneStatusReport } from "./lane-core"

describe("open-pickup-terminal args", () => {
  test("defaults to a new WezTerm window with gpt-5.5", () => {
    const args = parseArgs([])
    expect(args.newWindow).toBe(true)
    expect(args.model).toBe("openai/gpt-5.5")
    expect(args.actor).toBe("pickup-opencode")
  })

  test("parses lane, tab mode, actor, and no-model", () => {
    const args = parseArgs(["docs/sessions/lane.md", "--tab", "--actor", "human-helper", "--no-model"])
    expect(args.lanePath).toBe("docs/sessions/lane.md")
    expect(args.newWindow).toBe(false)
    expect(args.actor).toBe("human-helper")
    expect(args.model).toBeNull()
  })

  test("rejects workspace with tab mode", () => {
    expect(() => parseArgs(["--tab", "--workspace", "lanes"])).toThrow("--workspace requires --new-window")
  })
})

describe("open-pickup-terminal prompt", () => {
  test("frames pickup as a user briefing, not implementation", () => {
    const prompt = buildPickupPrompt({
      lanePath: "docs/sessions/lane.md",
      laneId: "lane",
      actor: "pickup-opencode",
      objective: "Build a helper",
      experimentId: "382",
      primaryLane: "L59 replay-first harness",
      feedbackSignal: "Dry-run output exists",
      state: "blocked",
      reason: "latest heartbeat is stale",
      monitorSnapshot: "state: BLOCKED",
      recommendedAction: "Run the dry-run",
      recommendedCommand: "bun scripts/agent/lane-runner.ts docs/sessions/lane.md --dry-run",
    })

    expect(prompt).toContain("Do not begin implementation")
    expect(prompt).toContain("Lane doc: docs/sessions/lane.md")
    expect(prompt).toContain("Current outside-loop state: BLOCKED")
    expect(prompt).toContain("Recommended next action: Run the dry-run")
    expect(prompt).toContain("First response format")
    expect(prompt).toContain("Do not ask `what do you want next?`")
  })
})

describe("open-pickup-terminal recommendation", () => {
  test("recommends resolving dirty worktree before runner launch", () => {
    const report = {
      assessment: { state: "continue", reason: "lane contract complete" },
      git: { dirtyFiles: ["M package.json"] },
    } as unknown as LaneStatusReport

    const recommendation = buildRecommendation(report, "docs/sessions/lane.md")
    expect(recommendation.action).toContain("dirty worktree")
    expect(recommendation.command).toContain("git status --short")
  })

  test("recommends dry-run for stale heartbeat stops on clean worktree", () => {
    const report = {
      assessment: { state: "blocked", reason: "latest heartbeat is stale" },
      git: { dirtyFiles: [] },
    } as unknown as LaneStatusReport

    const recommendation = buildRecommendation(report, "docs/sessions/lane.md")
    expect(recommendation.action).toContain("stale heartbeat")
    expect(recommendation.command).toContain("--dry-run")
  })
})

describe("open-pickup-terminal command", () => {
  test("builds WezTerm spawn command with OpenCode prompt", () => {
    const args = parseArgs(["--model", "openai/gpt-5.5", "--agent", "general"])
    const command = buildWezTermArgs(args, "/repo", "hello")
    expect(command).toEqual([
      "cli", "spawn", "--new-window", "--cwd", "/repo", "--", "opencode", ".",
      "--model", "openai/gpt-5.5", "--agent", "general", "--prompt", "hello",
    ])
  })

  test("display command references prompt artifact instead of inlining prompt", () => {
    const args = parseArgs(["--no-model"])
    const command = buildDisplayCommand(args, "/repo", "output/prompt.md")
    expect(command).toContain("\"wezterm\" \"cli\" \"spawn\"")
    expect(command).toContain("\"<output/prompt.md contents>\"")
    expect(command).not.toContain("openai/gpt-5.5")
  })
})
