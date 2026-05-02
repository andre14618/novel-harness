import { describe, expect, test } from "bun:test"
import {
  buildClaudeArgs,
  buildCyclePrompt,
  buildDisplayCommand,
  buildOpencodeArgs,
  nextLaneFromQueueText,
  parseLaneQueue,
  parseArgs,
  type RunnerArgs,
} from "./lane-runner"

function baseArgs(overrides: Partial<RunnerArgs> = {}): RunnerArgs {
  return {
    lanePath: "docs/sessions/lane.md",
    engine: "opencode",
    maxCycles: 4,
    maxHours: 3,
    cycleTimeoutMinutes: 45,
    staleMinutes: 10,
    maxNoChangeCycles: 1,
    agent: null,
    model: null,
    permissionMode: null,
    workerIo: "capture",
    queuePath: null,
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
    expect(args.engine).toBe("opencode")
    expect(args.maxCycles).toBe(4)
    expect(args.maxHours).toBe(3)
    expect(args.cycleTimeoutMinutes).toBe(45)
    expect(args.maxNoChangeCycles).toBe(1)
    expect(args.workerIo).toBe("capture")
    expect(args.dryRun).toBe(false)
  })

  test("parses OpenCode controls", () => {
    const args = parseArgs([
      "docs/sessions/lane.md",
      "--engine", "claude",
      "--max-cycles", "6",
      "--max-hours", "2.5",
      "--cycle-timeout-minutes", "30",
      "--agent", "build",
      "--model", "openai/gpt-5.5",
      "--permission-mode", "auto",
      "--worker-io", "terminal",
      "--queue", "docs/sessions/lane-queue.md",
      "--title", "L38-A",
      "--instruction", "stay narrow",
      "--dry-run",
      "--dangerously-skip-permissions",
    ])
    expect(args.maxCycles).toBe(6)
    expect(args.engine).toBe("claude")
    expect(args.maxHours).toBe(2.5)
    expect(args.cycleTimeoutMinutes).toBe(30)
    expect(args.agent).toBe("build")
    expect(args.model).toBe("openai/gpt-5.5")
    expect(args.permissionMode).toBe("auto")
    expect(args.workerIo).toBe("terminal")
    expect(args.queuePath).toBe("docs/sessions/lane-queue.md")
    expect(args.title).toBe("L38-A")
    expect(args.extraInstruction).toBe("stay narrow")
    expect(args.dryRun).toBe(true)
    expect(args.dangerouslySkipPermissions).toBe(true)
  })

  test("rejects missing lane", () => {
    expect(() => parseArgs([])).toThrow("lane-runner requires")
  })

  test("parses interactive as terminal worker I/O", () => {
    const args = parseArgs(["docs/sessions/lane.md", "--interactive"])
    expect(args.workerIo).toBe("terminal")
  })
})

describe("lane-runner prompt and command", () => {
  test("builds bounded cycle prompt from lane status", () => {
    const prompt = buildCyclePrompt(baseArgs({ engine: "claude", queuePath: "docs/sessions/lane-queue.md", extraInstruction: "Use focused tests only." }), 2, "state: CONTINUE")
    expect(prompt).toContain("Cycle 2/4")
    expect(prompt).toContain("docs/sessions/lane.md")
    expect(prompt).toContain("claude work cycle")
    expect(prompt).toContain("Record a heartbeat")
    expect(prompt).toContain("--actor claude")
    expect(prompt).toContain("Do not touch deferred out-of-lane runtime changes")
    expect(prompt).toContain("Lane finalization before stop or queue handoff")
    expect(prompt).toContain("Results: Outcome, Stop gate fired, Evidence link/row/path, Cost, and Commit(s)")
    expect(prompt).toContain("conclude-experiment.ts")
    expect(prompt).toContain("resolve-stale-gates.ts")
    expect(prompt).toContain("Queue handoff is configured at docs/sessions/lane-queue.md")
    expect(prompt).toContain("Use focused tests only.")
  })

  test("builds opencode args with model, agent, title, and prompt", () => {
    const args = buildOpencodeArgs(baseArgs({ agent: "build", model: "openai/gpt-5.5", title: "L38-A" }), "hello", 1)
    expect(args).toEqual(["run", "--model", "openai/gpt-5.5", "--agent", "build", "--title", "L38-A", "hello"])
  })

  test("builds opencode terminal args with a visible prompt", () => {
    const args = buildOpencodeArgs(baseArgs({ agent: "build", model: "openai/gpt-5.5", title: "L38-A", workerIo: "terminal" }), "hello", 1)
    expect(args).toEqual([".", "--model", "openai/gpt-5.5", "--agent", "build", "--prompt", "hello"])
  })

  test("builds claude args with print mode and permission mode", () => {
    const args = buildClaudeArgs(baseArgs({ agent: "build", model: "opus", permissionMode: "auto", title: "L38-A" }), "hello", 1)
    expect(args).toEqual(["-p", "--model", "opus", "--agent", "build", "--permission-mode", "auto", "--name", "L38-A", "hello"])
  })

  test("builds claude terminal args without print mode", () => {
    const args = buildClaudeArgs(baseArgs({ engine: "claude", agent: "build", model: "opus", permissionMode: "auto", title: "L38-A", workerIo: "terminal" }), "hello", 1)
    expect(args).toEqual(["--model", "opus", "--agent", "build", "--permission-mode", "auto", "--name", "L38-A", "hello"])
  })

  test("terminal prompt tells workers how to communicate", () => {
    const prompt = buildCyclePrompt(baseArgs({ workerIo: "terminal" }), 1, "state: CONTINUE")
    expect(prompt).toContain("Terminal worker mode")
    expect(prompt).toContain("durable status via lane-heartbeat events")
  })

  test("display command omits full prompt", () => {
    const command = buildDisplayCommand(baseArgs({ engine: "claude", model: "opus" }), 1)
    expect(command).toContain("claude")
    expect(command).toContain("<cycle-prompt>")
    expect(command).not.toContain("Required workflow")
  })
})

describe("lane-runner queue parsing", () => {
  const QUEUE = `# Lane Queue

## Active

- docs/sessions/current.md

## Next

1. docs/sessions/next-a.md
2. [Next B](docs/sessions/next-b.md)
`

  test("parses active and next lane docs", () => {
    expect(parseLaneQueue(QUEUE)).toEqual({
      active: ["docs/sessions/current.md"],
      next: ["docs/sessions/next-a.md", "docs/sessions/next-b.md"],
    })
  })

  test("finds next lane after active lane", () => {
    expect(nextLaneFromQueueText(QUEUE, "docs/sessions/current.md")).toBe("docs/sessions/next-a.md")
  })

  test("finds next lane after current next item", () => {
    expect(nextLaneFromQueueText(QUEUE, "docs/sessions/next-a.md")).toBe("docs/sessions/next-b.md")
  })
})
