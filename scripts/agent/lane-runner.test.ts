import { describe, expect, test } from "bun:test"
import {
  buildCyclePrompt,
  buildDisplayCommand,
  buildOpencodeArgs,
  parseArgs,
  type RunnerArgs,
} from "./lane-runner"

function baseArgs(overrides: Partial<RunnerArgs> = {}): RunnerArgs {
  return {
    lanePath: "docs/sessions/lane.md",
    maxCycles: 4,
    maxHours: 3,
    cycleTimeoutMinutes: 45,
    staleMinutes: 10,
    maxNoChangeCycles: 1,
    agent: null,
    model: null,
    title: null,
    extraInstruction: "",
    dryRun: false,
    dangerouslySkipPermissions: false,
    ...overrides,
  }
}

describe("lane-runner args", () => {
  test("parses defaults", () => {
    const args = parseArgs(["docs/sessions/lane.md"])
    expect(args.lanePath).toBe("docs/sessions/lane.md")
    expect(args.maxCycles).toBe(4)
    expect(args.maxHours).toBe(3)
    expect(args.cycleTimeoutMinutes).toBe(45)
    expect(args.maxNoChangeCycles).toBe(1)
    expect(args.dryRun).toBe(false)
  })

  test("parses OpenCode controls", () => {
    const args = parseArgs([
      "docs/sessions/lane.md",
      "--max-cycles", "6",
      "--max-hours", "2.5",
      "--cycle-timeout-minutes", "30",
      "--agent", "build",
      "--model", "openai/gpt-5.5",
      "--title", "L38-A",
      "--instruction", "stay narrow",
      "--dry-run",
      "--dangerously-skip-permissions",
    ])
    expect(args.maxCycles).toBe(6)
    expect(args.maxHours).toBe(2.5)
    expect(args.cycleTimeoutMinutes).toBe(30)
    expect(args.agent).toBe("build")
    expect(args.model).toBe("openai/gpt-5.5")
    expect(args.title).toBe("L38-A")
    expect(args.extraInstruction).toBe("stay narrow")
    expect(args.dryRun).toBe(true)
    expect(args.dangerouslySkipPermissions).toBe(true)
  })

  test("rejects missing lane", () => {
    expect(() => parseArgs([])).toThrow("lane-runner requires")
  })
})

describe("lane-runner prompt and command", () => {
  test("builds bounded cycle prompt from lane status", () => {
    const prompt = buildCyclePrompt(baseArgs({ extraInstruction: "Use focused tests only." }), 2, "state: CONTINUE")
    expect(prompt).toContain("Cycle 2/4")
    expect(prompt).toContain("docs/sessions/lane.md")
    expect(prompt).toContain("Record a heartbeat")
    expect(prompt).toContain("Do not touch deferred out-of-lane runtime changes")
    expect(prompt).toContain("Use focused tests only.")
  })

  test("builds opencode args with model, agent, title, and prompt", () => {
    const args = buildOpencodeArgs(baseArgs({ agent: "build", model: "openai/gpt-5.5", title: "L38-A" }), "hello", 1)
    expect(args).toEqual(["run", "--model", "openai/gpt-5.5", "--agent", "build", "--title", "L38-A", "hello"])
  })

  test("display command omits full prompt", () => {
    const command = buildDisplayCommand(baseArgs({ model: "openai/gpt-5.5" }), 1)
    expect(command).toContain("opencode")
    expect(command).toContain("<cycle-prompt>")
    expect(command).not.toContain("Required workflow")
  })
})
