import { test, expect } from "bun:test"
import { aggregateIssues, summarizeIssues, formatRetryLine, type BeatIssue } from "./beat-checks"

test("aggregate: zero issues => pass=true, empty arrays", () => {
  const r = aggregateIssues({ adherence: [], ungrounded: [] })
  expect(r.pass).toBe(true)
  expect(r.issues).toEqual([])
  expect(r.retryLines).toEqual([])
})

test("aggregate: OR semantics — any single source with a blocker fails the beat", () => {
  const onlyAdherence = aggregateIssues({ adherence: ["x"], ungrounded: [] })
  const onlyUngrounded = aggregateIssues({ adherence: [], ungrounded: ["y"] })
  expect(onlyAdherence.pass).toBe(false)
  expect(onlyUngrounded.pass).toBe(false)
})

test("aggregate: every issue is tagged with its correct source + blocker severity", () => {
  const r = aggregateIssues({
    adherence: ["A1", "A2"],
    ungrounded: ["U1"],
  })
  expect(r.issues.filter(i => i.source === "adherence")).toHaveLength(2)
  expect(r.issues.filter(i => i.source === "halluc-ungrounded")).toHaveLength(1)
  expect(r.issues.every(i => i.severity === "blocker")).toBe(true)
})

test("aggregate: retryLines preserves order (adherence, then ungrounded)", () => {
  const r = aggregateIssues({ adherence: ["A"], ungrounded: ["U"] })
  // Adherence passes through; ungrounded gets resolution-space guidance.
  expect(r.retryLines.length).toBe(2)
  expect(r.retryLines[0]).toBe("A")
  expect(r.retryLines[1]).toContain("U")
  expect(r.retryLines[1]).toContain("beat brief, world bible, character roster, or planner-sanctioned new entities")
})

test("aggregate: descriptions round-trip verbatim in `issues[]`", () => {
  const longDesc = 'Ungrounded entity "Captain Rael" — context: "She drew close to Captain Rael, who..."'
  const r = aggregateIssues({ adherence: [], ungrounded: [longDesc] })
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

test("formatRetryLine: adherence passes through; ungrounded appends pinned resolution guidance", () => {
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
    "D — Fix: use only entities from the beat brief, world bible, character roster, or planner-sanctioned new entities; otherwise remove the reference.",
  )
})

// ── L31a: warning-severity handling in aggregateIssues ─────────────────────────
//
// Warnings should appear in issues[] and retryLines[] (writer awareness) but
// must NOT set pass=false. Only severity:"blocker" issues block the beat.

test("L31a: aggregate — warning-only ungrounded issues do NOT block the beat (pass=true)", () => {
  const r = aggregateIssues({
    adherence: [],
    ungrounded: ['Ungrounded entity "the Ministry of Accounts" [NER-only warning — LLM passed]'],
    ungroundedSeverity: ["warning"],
  })
  // pass=true because warnings don't block.
  expect(r.pass).toBe(true)
  // Issue is still present in issues[] for operator visibility.
  expect(r.issues).toHaveLength(1)
  expect(r.issues[0]?.severity).toBe("warning")
  // Issue appears in retryLines (writer awareness).
  expect(r.retryLines).toHaveLength(1)
  expect(r.retryLines[0]).toContain("Ministry of Accounts")
})

test("L31a: aggregate — warning does not block even when combined with adherence blocker", () => {
  // adherence blocker is present → pass=false. The warning is still surfaced.
  const r = aggregateIssues({
    adherence: ["Beat events not enacted."],
    ungrounded: ['Ungrounded entity "Ministry of Accounts" [NER-only warning — LLM passed]'],
    ungroundedSeverity: ["warning"],
  })
  expect(r.pass).toBe(false) // adherence blocker causes fail
  expect(r.issues).toHaveLength(2)
  expect(r.issues[0]?.severity).toBe("blocker")
  expect(r.issues[1]?.severity).toBe("warning")
  expect(r.retryLines).toHaveLength(2)
})

test("L31a: aggregate — missing ungroundedSeverity defaults all ungrounded issues to blocker (back-compat)", () => {
  // When ungroundedSeverity is omitted (legacy callers / v0/v2 variant), all
  // ungrounded issues remain blocker-class (preserving prior behavior).
  const r = aggregateIssues({
    adherence: [],
    ungrounded: ["some ungrounded entity"],
    // ungroundedSeverity intentionally omitted
  })
  expect(r.pass).toBe(false)
  expect(r.issues[0]?.severity).toBe("blocker")
})

test("L31b: aggregate — mixed warning+blocker ungrounded issues: pass=false only because blocker present", () => {
  // Disjoint NER+LLM case: "Vesh Order" is NER-only (warning) and "Yarrow" is
  // LLM-only (blocker). Combined pass=false because of the blocker.
  const r = aggregateIssues({
    adherence: [],
    ungrounded: [
      'Ungrounded entity "Vesh Order" [NER-only warning — LLM passed]',
      'Ungrounded entity "Yarrow"',
    ],
    ungroundedSeverity: ["warning", "blocker"],
  })
  expect(r.pass).toBe(false) // blocker present
  expect(r.issues[0]?.severity).toBe("warning")
  expect(r.issues[1]?.severity).toBe("blocker")
  expect(r.retryLines).toHaveLength(2)
})
