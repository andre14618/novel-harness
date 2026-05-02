import { describe, expect, test } from "bun:test"
import { buildOpencodeArgs, buildPrompt, parseArgs } from "./finalize-docs"

describe("finalize-docs args", () => {
  test("parses required finalization inputs", () => {
    const args = parseArgs([
      "docs/sessions/L50.md",
      "--result", "new blocker",
      "--commit", "abc123",
      "--evidence", "chapter_exhaustions#84",
      "--cost", "$0.12",
      "--message", "[docs] finalize L50",
    ])
    expect(args.lanePath).toBe("docs/sessions/L50.md")
    expect(args.result).toBe("new blocker")
    expect(args.commits).toEqual(["abc123"])
    expect(args.evidence).toEqual(["chapter_exhaustions#84"])
    expect(args.model).toBe("deepseek/deepseek-v4-flash")
    expect(args.variant).toBe("high")
    expect(args.message).toBe("[docs] finalize L50")
  })

  test("derives docs commit message from lane path", () => {
    const args = parseArgs(["docs/sessions/L50.md", "--result", "pass"])
    expect(args.message).toBe("[docs] finalize L50 documentation")
  })

  test("requires result", () => {
    expect(() => parseArgs(["docs/sessions/L50.md"])).toThrow("requires --result")
  })
})

describe("finalize-docs prompt and command", () => {
  test("builds an opencode docs-finalizer command", () => {
    const args = parseArgs(["docs/sessions/L50.md", "--result", "refuted", "--commit", "abc123"])
    const commandArgs = buildOpencodeArgs(args)
    expect(commandArgs.slice(0, 7)).toEqual([
      "run",
      "--agent", "docs-finalizer",
      "--model", "deepseek/deepseek-v4-flash",
      "--variant", "high",
    ])
    expect(commandArgs).toContain("--title")
  })

  test("prompt authorizes docs-only commit", () => {
    const prompt = buildPrompt(parseArgs([
      "docs/sessions/L50.md",
      "--result", "pass",
      "--evidence", "experiment#400",
    ]))
    expect(prompt).toContain("authorized to update and commit docs-only changes")
    expect(prompt).toContain("Commit only allowed documentation files")
    expect(prompt).toContain("experiment#400")
  })
})
