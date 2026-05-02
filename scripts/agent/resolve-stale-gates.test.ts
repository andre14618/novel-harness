import { describe, expect, test } from "bun:test"
import { decideCandidate, parseArgs, type PendingGateCandidate } from "./resolve-stale-gates"

const NOW = new Date("2026-05-02T12:00:00Z")

function candidate(overrides: Partial<PendingGateCandidate> = {}): PendingGateCandidate {
  return {
    id: 10,
    novel_id: "novel-1",
    chapter: 1,
    attempt: 1,
    kind: "plan-check-exhausted",
    fired_at: new Date("2026-05-01T10:00:00Z"),
    novel_phase: "drafting",
    novel_updated_at: new Date("2026-05-01T10:00:00Z"),
    current_chapter: 1,
    total_chapters: 3,
    seed: "fantasy-debt",
    seed_name: null,
    llm_calls: 100,
    last_llm_call: new Date("2026-05-01T10:00:00Z"),
    ...overrides,
  }
}

describe("parseArgs", () => {
  test("defaults to dry-run older-than 24h", () => {
    const args = parseArgs([])
    expect(args.apply).toBe(false)
    expect(args.olderThanHours).toBe(24)
    expect(args.ids).toEqual([])
  })

  test("parses ids, novel, include-recent, reason, and apply", () => {
    const args = parseArgs(["--ids", "1,2", "--novel", "novel-1", "--include-recent", "--reason", "done", "--apply"])
    expect(args.ids).toEqual([1, 2])
    expect(args.novelId).toBe("novel-1")
    expect(args.includeRecent).toBe(true)
    expect(args.reason).toBe("done")
    expect(args.apply).toBe(true)
  })

  test("rejects invalid ids", () => {
    expect(() => parseArgs(["--ids", "abc"])).toThrow()
  })

  test("rejects negative age", () => {
    expect(() => parseArgs(["--older-than-hours", "-1"])).toThrow()
  })
})

describe("decideCandidate", () => {
  const baseArgs = parseArgs(["--older-than-hours", "24"])

  test("resolves when older than threshold", () => {
    const decision = decideCandidate(candidate(), baseArgs, NOW)
    expect(decision.action).toBe("resolve")
    expect(decision.reason).toContain("threshold")
  })

  test("skips recent gates by default", () => {
    const decision = decideCandidate(candidate({ fired_at: new Date("2026-05-02T11:30:00Z") }), baseArgs, NOW)
    expect(decision.action).toBe("skip")
    expect(decision.reason).toContain("recent")
  })

  test("explicit ids resolve recent gates", () => {
    const args = parseArgs(["--ids", "10"])
    const decision = decideCandidate(candidate({ fired_at: new Date("2026-05-02T11:30:00Z") }), args, NOW)
    expect(decision.action).toBe("resolve")
    expect(decision.reason).toContain("--ids")
  })

  test("novel include-recent resolves recent gates", () => {
    const args = parseArgs(["--novel", "novel-1", "--include-recent"])
    const decision = decideCandidate(candidate({ fired_at: new Date("2026-05-02T11:30:00Z") }), args, NOW)
    expect(decision.action).toBe("resolve")
    expect(decision.reason).toContain("--include-recent")
  })

  test("terminal novel phase resolves regardless of age", () => {
    const decision = decideCandidate(candidate({ fired_at: new Date("2026-05-02T11:30:00Z"), novel_phase: "failed" }), baseArgs, NOW)
    expect(decision.action).toBe("resolve")
    expect(decision.reason).toContain("failed")
  })
})
