/**
 * Unit tests for operator-summary helpers (no DB required).
 *
 * Covers:
 *   - recommendForStaleGate: branching action/reason classifier
 *   - parseArgs: CLI surface for stale-gates mode + flag interactions
 */

import { describe, expect, test } from "bun:test"
import { recommendForStaleGate, parseArgs } from "./operator-summary"

describe("recommendForStaleGate", () => {
  const NOW = new Date("2026-05-02T12:00:00Z")
  const HOUR = 3_600_000

  test("orphan when novel.phase is 'complete'", () => {
    const fired = new Date(NOW.getTime() - 30 * 60 * 1000) // 30m ago
    const updated = new Date(NOW.getTime() - 15 * 60 * 1000)
    const rec = recommendForStaleGate(fired, "complete", updated, NOW)
    expect(rec.action).toBe("orphan")
    expect(rec.reason).toContain("complete")
  })

  test("orphan when novel.phase is 'failed'", () => {
    const fired = new Date(NOW.getTime() - 30 * 60 * 1000)
    const updated = new Date(NOW.getTime() - 15 * 60 * 1000)
    const rec = recommendForStaleGate(fired, "failed", updated, NOW)
    expect(rec.action).toBe("orphan")
    expect(rec.reason).toContain("failed")
  })

  test("orphan when novel.phase is 'aborted'", () => {
    const fired = new Date(NOW.getTime() - 30 * 60 * 1000)
    const updated = new Date(NOW.getTime() - 15 * 60 * 1000)
    const rec = recommendForStaleGate(fired, "aborted", updated, NOW)
    expect(rec.action).toBe("orphan")
    expect(rec.reason).toContain("aborted")
  })

  test("orphan when fire is >24h old, regardless of novel state", () => {
    const fired = new Date(NOW.getTime() - 25 * HOUR)
    const updated = new Date(NOW.getTime() - 1 * HOUR) // novel still active
    const rec = recommendForStaleGate(fired, "drafting", updated, NOW)
    expect(rec.action).toBe("orphan")
    expect(rec.reason).toContain("24h")
  })

  test("orphan when novel idle >12h", () => {
    const fired = new Date(NOW.getTime() - 5 * HOUR)
    const updated = new Date(NOW.getTime() - 13 * HOUR)
    const rec = recommendForStaleGate(fired, "drafting", updated, NOW)
    expect(rec.action).toBe("orphan")
    expect(rec.reason).toContain("idle")
  })

  test("resume when novel updated <6h ago", () => {
    const fired = new Date(NOW.getTime() - 3 * HOUR)
    const updated = new Date(NOW.getTime() - 30 * 60 * 1000) // 30m ago
    const rec = recommendForStaleGate(fired, "drafting", updated, NOW)
    expect(rec.action).toBe("resume")
    expect(rec.reason).toMatch(/active/)
  })

  test("investigate when novel idle 6-12h and fire <24h", () => {
    const fired = new Date(NOW.getTime() - 5 * HOUR)
    const updated = new Date(NOW.getTime() - 8 * HOUR)
    const rec = recommendForStaleGate(fired, "drafting", updated, NOW)
    expect(rec.action).toBe("investigate")
  })

  test("investigate when novel row is missing (LEFT JOIN null)", () => {
    const fired = new Date(NOW.getTime() - 30 * 60 * 1000)
    const rec = recommendForStaleGate(fired, null, null, NOW)
    expect(rec.action).toBe("investigate")
    expect(rec.reason).toContain("missing")
  })

  test("orphan precedence: complete-phase wins over fresh fire", () => {
    const fired = new Date(NOW.getTime() - 5 * 60 * 1000) // 5m ago — very fresh
    const updated = new Date(NOW.getTime() - 1 * 60 * 1000)
    const rec = recommendForStaleGate(fired, "complete", updated, NOW)
    expect(rec.action).toBe("orphan")
    expect(rec.reason).toContain("complete")
  })

  test("orphan precedence: 24h+ fire wins over recent novel update", () => {
    const fired = new Date(NOW.getTime() - 30 * HOUR)
    const updated = new Date(NOW.getTime() - 1 * 60 * 1000) // 1m ago
    const rec = recommendForStaleGate(fired, "drafting", updated, NOW)
    expect(rec.action).toBe("orphan")
    expect(rec.reason).toContain("24h")
  })
})

describe("parseArgs", () => {
  test("default: no flags → empty Args", () => {
    const a = parseArgs([])
    expect(a.novelId).toBeNull()
    expect(a.latest).toBe(false)
    expect(a.json).toBe(false)
    expect(a.staleGates).toBe(false)
    expect(a.minAgeHours).toBe(1)
  })

  test("positional → novelId", () => {
    const a = parseArgs(["novel-12345"])
    expect(a.novelId).toBe("novel-12345")
  })

  test("--latest", () => {
    const a = parseArgs(["--latest"])
    expect(a.latest).toBe(true)
  })

  test("--json", () => {
    const a = parseArgs(["--json"])
    expect(a.json).toBe(true)
  })

  test("--stale-gates with default age", () => {
    const a = parseArgs(["--stale-gates"])
    expect(a.staleGates).toBe(true)
    expect(a.minAgeHours).toBe(1)
  })

  test("--stale-gates --min-age-hours 6", () => {
    const a = parseArgs(["--stale-gates", "--min-age-hours", "6"])
    expect(a.staleGates).toBe(true)
    expect(a.minAgeHours).toBe(6)
  })

  test("--min-age-hours accepts fractional values", () => {
    const a = parseArgs(["--stale-gates", "--min-age-hours", "0.5"])
    expect(a.minAgeHours).toBe(0.5)
  })

  test("--min-age-hours 0 is allowed (audit everything)", () => {
    const a = parseArgs(["--stale-gates", "--min-age-hours", "0"])
    expect(a.minAgeHours).toBe(0)
  })

  test("--min-age-hours rejects negative values", () => {
    expect(() => parseArgs(["--stale-gates", "--min-age-hours", "-1"])).toThrow()
  })

  test("--min-age-hours rejects non-numeric", () => {
    expect(() => parseArgs(["--stale-gates", "--min-age-hours", "abc"])).toThrow()
  })

  test("--min-age-hours rejects missing value", () => {
    expect(() => parseArgs(["--stale-gates", "--min-age-hours"])).toThrow()
  })

  test("--min-age-hours rejects another flag as value", () => {
    expect(() => parseArgs(["--stale-gates", "--min-age-hours", "--json"])).toThrow()
  })

  test("--stale-gates + --json combine", () => {
    const a = parseArgs(["--stale-gates", "--json"])
    expect(a.staleGates).toBe(true)
    expect(a.json).toBe(true)
  })

  test("positional + --json combine", () => {
    const a = parseArgs(["novel-abc", "--json"])
    expect(a.novelId).toBe("novel-abc")
    expect(a.json).toBe(true)
  })
})
