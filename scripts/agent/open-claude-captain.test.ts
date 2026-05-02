import { describe, expect, test } from "bun:test"
import type { LaneStatusReport } from "./lane-core"
import { buildCaptainPrompt, buildClaudeArgs, buildDisplayCommand, buildRecommendation, buildWezTermArgs, parseArgs } from "./open-claude-captain"

describe("open-claude-captain args", () => {
  test("defaults to Claude opus captain in a new WezTerm window", () => {
    const args = parseArgs([])
    expect(args.model).toBe("opus")
    expect(args.permissionMode).toBe("auto")
    expect(args.actor).toBe("captain-claude")
    expect(args.newWindow).toBe(true)
  })

  test("parses lane, tab, actor, and disabled model/permission", () => {
    const args = parseArgs(["docs/sessions/lane.md", "--tab", "--actor", "human-captain", "--no-model", "--no-permission-mode"])
    expect(args.lanePath).toBe("docs/sessions/lane.md")
    expect(args.newWindow).toBe(false)
    expect(args.actor).toBe("human-captain")
    expect(args.model).toBeNull()
    expect(args.permissionMode).toBeNull()
  })

  test("rejects workspace with tab mode", () => {
    expect(() => parseArgs(["--tab", "--workspace", "lanes"])).toThrow("--workspace requires --new-window")
  })
})

describe("open-claude-captain prompt", () => {
  test("states lane-runner retirement and captain duties", () => {
    const prompt = buildCaptainPrompt({
      lanePath: "docs/sessions/lane.md",
      laneId: "lane",
      actor: "captain-claude",
      objective: "Run smoke",
      experimentId: "384",
      primaryLane: "L61 e2e smoke",
      feedbackSignal: "result doc",
      state: "continue",
      reason: "lane contract complete",
      monitorSnapshot: "state: CONTINUE",
      recommendedAction: "Read monitor",
      recommendedCommand: "monitor --once",
    })

    expect(prompt).toContain("lane-runner is retired as the default orchestrator")
    expect(prompt).toContain("You own orchestration")
    expect(prompt).toContain("Use Claude Code subagents")
    expect(prompt).toContain("Recommended first action: Read monitor")
  })
})

describe("open-claude-captain command", () => {
  test("builds Claude args for interactive session", () => {
    const args = parseArgs(["--model", "opus", "--permission-mode", "auto", "--agent", "general"])
    expect(buildClaudeArgs(args, "hello", "lane captain")).toEqual([
      "--model", "opus", "--permission-mode", "auto", "--agent", "general", "--name", "lane captain", "hello",
    ])
  })

  test("builds WezTerm spawn command for Claude", () => {
    const args = parseArgs(["--no-model", "--no-permission-mode"])
    expect(buildWezTermArgs(args, "/repo", "hello", "lane captain")).toEqual([
      "cli", "spawn", "--new-window", "--cwd", "/repo", "--", "claude", "--name", "lane captain", "hello",
    ])
  })

  test("display command references prompt artifact", () => {
    const args = parseArgs(["--no-model", "--no-permission-mode"])
    const command = buildDisplayCommand(args, "/repo", "output/prompt.md", "lane captain")
    expect(command).toContain("\"claude\"")
    expect(command).toContain("\"<output/prompt.md contents>\"")
    expect(command).not.toContain("opus")
  })
})

describe("open-claude-captain recommendation", () => {
  test("dirty worktree recommendation protects concurrent work", () => {
    const report = {
      assessment: { state: "continue", reason: "lane contract complete" },
      git: { dirtyFiles: ["M docs/sessions/lane.md"] },
    } as unknown as LaneStatusReport

    const recommendation = buildRecommendation(report, "docs/sessions/lane.md")
    expect(recommendation.action).toContain("dirty worktree")
    expect(recommendation.command).toBe("git status --short && monitor --once")
  })

  test("continue state recommendation tells captain to own the next step", () => {
    const report = {
      assessment: { state: "continue", reason: "lane contract complete" },
      git: { dirtyFiles: [] },
    } as unknown as LaneStatusReport

    const recommendation = buildRecommendation(report, "docs/sessions/lane.md")
    expect(recommendation.action).toContain("interactive lane captain")
    expect(recommendation.command).toBe("monitor --once")
  })
})
