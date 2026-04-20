/**
 * Unit tests for `exitsFunction()` loop-statement classification (T4 /
 * exp #247). Each case parses a TS snippet, extracts the last top-level
 * statement, calls `exitsFunction(stmt)`, asserts expected boolean.
 *
 * Codex threads: `a624cc89` (triage, green), `aef73a30a2a74ce51` (full
 * review; HIGH do-while-regardless-of-cond, MEDIUM named-export over
 * wrapper, LOW parenthesized-true accepted). All applied in the
 * classifier + these tests.
 */

import { test, expect } from "bun:test"
import ts from "typescript"
import { exitsFunction } from "./invariants-check"

function lastStatement(src: string): ts.Statement {
  const sf = ts.createSourceFile("__test__.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const stmts = sf.statements
  const last = stmts[stmts.length - 1]
  if (!last) throw new Error("no statements in fixture source")
  return last
}

// (a) while(true) + throw → terminal
test("(a) while (true) { throw new Error('x') } is terminal", () => {
  const stmt = lastStatement(`while (true) { throw new Error('x') }`)
  expect(exitsFunction(stmt)).toBe(true)
})

// (b) for(;;) + return → terminal
test("(b) for (;;) { return 1 } is terminal", () => {
  const stmt = lastStatement(`for (;;) { return 1 }`)
  expect(exitsFunction(stmt)).toBe(true)
})

// (c) do { return } while (true) → terminal
test("(c) do { return 1 } while (true) is terminal", () => {
  const stmt = lastStatement(`do { return 1 } while (true)`)
  expect(exitsFunction(stmt)).toBe(true)
})

// (c') do { return } while (someCondition) → terminal regardless of cond
test("(c') do { return 1 } while (someCondition) is terminal (Codex HIGH fix)", () => {
  const stmt = lastStatement(`do { return 1 } while (someCondition)`)
  expect(exitsFunction(stmt)).toBe(true)
})

// (d) while (cond) + throw → NOT terminal (cond may be false)
test("(d) while (cond) { throw new Error('x') } is NOT terminal", () => {
  const stmt = lastStatement(`while (cond) { throw new Error('x') }`)
  expect(exitsFunction(stmt)).toBe(false)
})

// (e) while (true) { if (x) break; throw } → NOT terminal
test("(e) while (true) { if (x) break; throw } is NOT terminal", () => {
  const stmt = lastStatement(`while (true) { if (x) break; throw new Error('x') }`)
  expect(exitsFunction(stmt)).toBe(false)
})

// (f) while (true) { if (x) continue; throw } → NOT terminal
test("(f) while (true) { if (x) continue; throw } is NOT terminal", () => {
  const stmt = lastStatement(`while (true) { if (x) continue; throw new Error('x') }`)
  expect(exitsFunction(stmt)).toBe(false)
})

// (g) while (true) { switch (x) { case 1: continue } throw } → NOT terminal
// (continue inside a switch still targets the enclosing loop)
test("(g) while (true) { switch { case 1: continue } throw } is NOT terminal", () => {
  const stmt = lastStatement(
    `while (true) { switch (x) { case 1: continue } throw new Error('x') }`,
  )
  expect(exitsFunction(stmt)).toBe(false)
})

// (h) while (true) { for (const y of ys) break; throw } → TERMINAL
// (inner break targets the inner for-of, not the outer while)
test("(h) while (true) { for-of break; throw } is TERMINAL", () => {
  const stmt = lastStatement(
    `while (true) { for (const y of ys) break; throw new Error('x') }`,
  )
  expect(exitsFunction(stmt)).toBe(true)
})

// (i) while (true) { switch (x) { case 1: break } throw } → TERMINAL
// (switch-break targets the switch, not the loop)
test("(i) while (true) { switch { case 1: break } throw } is TERMINAL", () => {
  const stmt = lastStatement(
    `while (true) { switch (x) { case 1: break } throw new Error('x') }`,
  )
  expect(exitsFunction(stmt)).toBe(true)
})

// (j) while (true) { for (const y of ys) continue; throw } → TERMINAL
// (inner continue targets the inner for-of, not the outer while)
test("(j) while (true) { for-of continue; throw } is TERMINAL", () => {
  const stmt = lastStatement(
    `while (true) { for (const y of ys) continue; throw new Error('x') }`,
  )
  expect(exitsFunction(stmt)).toBe(true)
})

// (k) do { return } while (someConditionName) → TERMINAL
test("(k) do { return } while (someConditionName) is TERMINAL", () => {
  const stmt = lastStatement(`do { return } while (someConditionName)`)
  expect(exitsFunction(stmt)).toBe(true)
})
