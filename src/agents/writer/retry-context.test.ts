/**
 * Unit tests for retry-context.ts.
 *
 * Covers `buildRetryPrompt` (legacy beat-level retry) and
 * `formatChapterIntegrityRetryContext` (L41 chapter-level integrity retry).
 *
 * Pure-function tests — no async, no DB, no LLM calls.
 */

import { test, expect } from "bun:test"
import { buildRetryPrompt, formatChapterIntegrityRetryContext } from "./retry-context"

test("buildRetryPrompt: includes prior prose beyond 2000 chars up to the 8000-char adherence window", () => {
  const previousProse = "a".repeat(2500) + "VISIBLE_AFTER_2000" + "b".repeat(5500) + "TRUNCATED_AFTER_8000"
  const out = buildRetryPrompt({
    beatContext: { userPrompt: "BASE PROMPT", targetWords: 500 },
    systemPrompt: "SYSTEM PROMPT",
    v1Prose: previousProse,
    issues: ["Beat event missing: opened the locked door"],
    attempt: 2,
  })

  expect(out.systemPrompt).toBe("SYSTEM PROMPT")
  expect(out.userPrompt).toContain("BASE PROMPT")
  expect(out.userPrompt).toContain("VISIBLE_AFTER_2000")
  expect(out.userPrompt).not.toContain("TRUNCATED_AFTER_8000")
})

test("formatChapterIntegrityRetryContext: empty issues array returns empty string", () => {
  expect(formatChapterIntegrityRetryContext([])).toBe("")
})

test("formatChapterIntegrityRetryContext: single issue produces a context block with kind + excerpt", () => {
  const out = formatChapterIntegrityRetryContext([
    { kind: "fused-boundary", excerpt: "he ran.She turned" },
  ])
  expect(out).toContain("--- AVOID THESE INTEGRITY ISSUES FROM YOUR PRIOR DRAFT ---")
  expect(out).toContain('- fused-boundary: "he ran.She turned"')
  expect(out).toContain("Keep sentence boundaries clean")
  expect(out).toContain("Do not repeat the same phrase verbatim")
  expect(out).toContain("Pair and attribute every quote mark")
})

test("formatChapterIntegrityRetryContext: multiple issues all listed in order", () => {
  const out = formatChapterIntegrityRetryContext([
    { kind: "fused-boundary", excerpt: "alpha.Beta" },
    { kind: "duplicate-fragment", excerpt: "the cold steel ... the cold steel" },
    { kind: "quote-integrity", excerpt: 'she said,"He left.' },
  ])
  // All three kinds appear
  expect(out).toContain("- fused-boundary:")
  expect(out).toContain("- duplicate-fragment:")
  expect(out).toContain("- quote-integrity:")
  // Order preserved
  expect(out.indexOf("fused-boundary")).toBeLessThan(out.indexOf("duplicate-fragment"))
  expect(out.indexOf("duplicate-fragment")).toBeLessThan(out.indexOf("quote-integrity"))
})

test("formatChapterIntegrityRetryContext: long excerpt is sliced to 200 chars to bound prompt growth", () => {
  const longExcerpt = "x".repeat(500)
  const out = formatChapterIntegrityRetryContext([
    { kind: "duplicate-sentence", excerpt: longExcerpt },
  ])
  // The block contains at most 200 chars of x's between quotes.
  const xRun = out.match(/x+/)?.[0] ?? ""
  expect(xRun.length).toBeLessThanOrEqual(200)
})

test("formatChapterIntegrityRetryContext: caps at 12 issues for extreme cases", () => {
  const issues = Array.from({ length: 50 }, (_, i) => ({
    kind: "duplicate-fragment",
    excerpt: `excerpt-${i}`,
  }))
  const out = formatChapterIntegrityRetryContext(issues)
  // Should include exactly 12 list items.
  const itemCount = (out.match(/^- duplicate-fragment:/gm) ?? []).length
  expect(itemCount).toBe(12)
  // First 12 (excerpt-0 .. excerpt-11) should be present; excerpt-12 should not.
  expect(out).toContain("excerpt-0")
  expect(out).toContain("excerpt-11")
  expect(out).not.toContain("excerpt-12")
})

test("formatChapterIntegrityRetryContext: trims whitespace around excerpts", () => {
  const out = formatChapterIntegrityRetryContext([
    { kind: "fused-boundary", excerpt: "   spaced excerpt   " },
  ])
  expect(out).toContain('- fused-boundary: "spaced excerpt"')
  expect(out).not.toContain('"   spaced')
})
