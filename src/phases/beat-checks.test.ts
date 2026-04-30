import { test, expect } from "bun:test"
import { aggregateIssues, summarizeIssues, formatRetryLine, shouldRunLeakChecker, type BeatIssue } from "./beat-checks"

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
  // Adherence passes through; ungrounded and leak get resolution-space guidance.
  expect(r.retryLines.length).toBe(3)
  expect(r.retryLines[0]).toBe("A")
  expect(r.retryLines[1]).toContain("U")
  expect(r.retryLines[1]).toContain("beat brief or world bible")
  expect(r.retryLines[2]).toContain("L")
  expect(r.retryLines[2]).toContain("Salvatore-corpus proper name")
})

test("aggregate: descriptions round-trip verbatim in `issues[]`", () => {
  const longDesc = 'Ungrounded entity "Captain Rael" — context: "She drew close to Captain Rael, who..."'
  const r = aggregateIssues({ adherence: [], ungrounded: [longDesc], leak: [] })
  expect(r.issues[0]?.description).toBe(longDesc)
  // retryLines appends source-specific resolution guidance (see formatRetryLine).
  expect(r.retryLines[0]?.startsWith(longDesc)).toBe(true)
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

test("formatRetryLine: adherence passes through; ungrounded+leak append pinned resolution guidance", () => {
  // Pin the exact clauses so drift in the wording trips the test rather than
  // silently changing the writer's retry prompt. If you deliberately change
  // the wording, update this assertion and the mirrored mocks in
  // drafting-revision-used-persistence.test.ts + drafting-reviser-escalation.test.ts.
  expect(
    formatRetryLine({ source: "adherence", severity: "blocker", description: "D" }),
  ).toBe("D")

  expect(
    formatRetryLine({ source: "halluc-ungrounded", severity: "blocker", description: "D" }),
  ).toBe(
    "D — Fix: replace with an entity from the beat brief or world bible, or remove the reference entirely. Do not invent new named entities.",
  )

  expect(
    formatRetryLine({ source: "halluc-leak-salvatore", severity: "blocker", description: "D" }),
  ).toBe(
    `D — Fix: remove the token or replace with a generic descriptor (e.g. "the drow warrior" instead of a Salvatore-corpus proper name).`,
  )
})

test("shouldRunLeakChecker gates only on explicit Salvatore leak profile", () => {
  expect(shouldRunLeakChecker("salvatore")).toBe(true)
  expect(shouldRunLeakChecker(null)).toBe(false)
})
