import { describe, expect, test } from "bun:test"
import { parseArgs } from "./lane-message"

describe("lane-message args", () => {
  test("parses send command", () => {
    const args = parseArgs([
      "send",
      "docs/sessions/lane.md",
      "--actor", "captain",
      "--to", "evidence",
      "--kind", "request",
      "--subject", "Monitor replay",
      "--body", "Check until chapter 2 completes",
      "--ref", "novel-1",
    ])
    expect(args.command).toBe("send")
    expect(args.lanePath).toBe("docs/sessions/lane.md")
    expect(args.actor).toBe("captain")
    expect(args.to).toBe("evidence")
    expect(args.refs).toEqual(["novel-1"])
  })

  test("parses claim command with lease", () => {
    const args = parseArgs([
      "claim",
      "docs/sessions/lane.md",
      "msg-1",
      "--actor", "evidence",
      "--lease-minutes", "15",
    ])
    expect(args.command).toBe("claim")
    expect(args.id).toBe("msg-1")
    expect(args.leaseMinutes).toBe(15)
  })

  test("rejects missing message id for resolve", () => {
    expect(() => parseArgs(["resolve", "docs/sessions/lane.md", "--actor", "evidence"])).toThrow("resolve requires a message id")
  })
})
