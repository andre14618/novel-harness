import { test, expect } from "bun:test"
import { aggregateIssues, summarizeIssues, formatRetryLine, type BeatIssue } from "./beat-checks"

test("aggregate: zero issues => pass=true, empty arrays", () => {
  const r = aggregateIssues({ adherence: [], ungrounded: [], leak: [] })
  expect(r.pass).toBe(true)
  expect(r.issues).toEqual([])
  expect(r.retryLines).toEqual([])
})

test("aggregate: OR semantics — any single source with a blocker fails the beat", () => {
  const onlyAdherence = aggregateIssues({ adherence: ["x"], ungrounded: [], leak: [] })
  const onlyUngrounded = aggregateIssues({ adherence: [], ungrounded: ["y"], leak: [] })
  const onlyLeak = aggregateIssues({ adherence: [], ungrounded: [], leak: ["z"] })
  expect(onlyAdherence.pass).toBe(false)
  expect(onlyUngrounded.pass).toBe(false)
  expect(onlyLeak.pass).toBe(false)
})

test("aggregate: every issue is tagged with its correct source + blocker severity", () => {
  const r = aggregateIssues({
    adherence: ["A1", "A2"],
    ungrounded: ["U1"],
    leak: ["L1", "L2", "L3"],
  })
  expect(r.issues.filter(i => i.source === "adherence")).toHaveLength(2)
  expect(r.issues.filter(i => i.source === "halluc-ungrounded")).toHaveLength(1)
  expect(r.issues.filter(i => i.source === "halluc-leak-salvatore")).toHaveLength(3)
  expect(r.issues.every(i => i.severity === "blocker")).toBe(true)
})

test("aggregate: retryLines preserves order (adherence, then ungrounded, then leak)", () => {
  const r = aggregateIssues({ adherence: ["A"], ungrounded: ["U"], leak: ["L"] })
  expect(r.retryLines).toEqual(["A", "U", "L"])
})

test("aggregate: descriptions round-trip verbatim without rewriting", () => {
  const longDesc = 'Ungrounded entity "Captain Rael" — context: "She drew close to Captain Rael, who..."'
  const r = aggregateIssues({ adherence: [], ungrounded: [longDesc], leak: [] })
  expect(r.issues[0]?.description).toBe(longDesc)
  expect(r.retryLines[0]).toBe(longDesc)
})

test("summarizeIssues: empty returns 'no issues'", () => {
  expect(summarizeIssues([])).toBe("no issues")
})

test("summarizeIssues: groups by source with counts + joins descriptions", () => {
  const issues: BeatIssue[] = [
    { source: "adherence", severity: "blocker", description: "A1" },
    { source: "adherence", severity: "blocker", description: "A2" },
    { source: "halluc-ungrounded", severity: "blocker", description: "U1" },
  ]
  const s = summarizeIssues(issues)
  expect(s).toContain("adherence(2)")
  expect(s).toContain("halluc-ungrounded(1)")
  expect(s).toContain("A1; A2")
  expect(s).toContain("U1")
  expect(s).toContain(" | ") // group separator
})

test("formatRetryLine: passes through the description for every source", () => {
  const sources: BeatIssue["source"][] = ["adherence", "halluc-ungrounded", "halluc-leak-salvatore"]
  for (const source of sources) {
    const line = formatRetryLine({ source, severity: "blocker", description: "the-description" })
    expect(line).toBe("the-description")
  }
})
