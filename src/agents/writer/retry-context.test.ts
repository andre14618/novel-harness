/**
 * Unit tests for retry-context.ts.
 *
 * Covers `buildRetryPrompt` (legacy beat-level retry) and
 * `formatChapterIntegrityRetryContext` (L41 chapter-level integrity retry).
 *
 * Pure-function tests — no async, no DB, no LLM calls.
 */

import { test, expect } from "bun:test"
import {
  buildRetryPrompt,
  formatChapterIntegrityRetryContext,
  formatChapterUngroundedRetryContext,
  extractUngroundedEntitiesFromDescriptions,
} from "./retry-context"

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

// L63 / Lever A: matched-pair rendering for duplicate-* kinds.
test("formatChapterIntegrityRetryContext: duplicate-sentence renders both halves of the collision (L63)", () => {
  const out = formatChapterIntegrityRetryContext([
    {
      kind: "duplicate-sentence",
      excerpt: "The hall narrowed.",
      firstExcerpt: "The hall narrowed.",
    },
  ])
  expect(out).toContain("- duplicate-sentence (rewrite at least one side with different verbs/imagery):")
  expect(out).toContain('first:  "The hall narrowed."')
  expect(out).toContain('second: "The hall narrowed."')
  // L70 / Lever I-D: prompt directive escalates "paraphrase one side" to
  // "rewrite at least one side using distinct concrete language" plus
  // permission to rewrite both. Surfaced after exp #396 A/B showed 5 of 7
  // novels surviving 3 attempts with ≥1 duplicate-fragment unresolved.
  expect(out).toContain("Rewrite at least one side using distinct concrete language")
  expect(out).toContain("If a single paraphrase still leaves the 8-word phrase shared, rewrite both sides")
  expect(out).toContain("Keep the beats themselves intact")
})

test("formatChapterIntegrityRetryContext: duplicate-fragment with both excerpts renders the pair (L63)", () => {
  const out = formatChapterIntegrityRetryContext([
    {
      kind: "duplicate-fragment",
      excerpt: "set down on cot turned hands outstretched.",
      firstExcerpt: "set down on cot turned hands outstretched.",
    },
  ])
  expect(out).toContain("- duplicate-fragment (rewrite at least one side with different verbs/imagery):")
  expect(out).toContain('first:  "set down on cot')
  expect(out).toContain('second: "set down on cot')
})

test("formatChapterIntegrityRetryContext: non-duplicate kinds keep single-excerpt rendering (L63 boundary)", () => {
  const out = formatChapterIntegrityRetryContext([
    { kind: "fused-boundary", excerpt: "alpha.Beta" },
    { kind: "quote-integrity", excerpt: 'she said,"He left.' },
    { kind: "camel-fusion", excerpt: "againShe" },
  ])
  expect(out).toContain('- fused-boundary: "alpha.Beta"')
  expect(out).toContain('- quote-integrity: "she said,"He left."')
  expect(out).toContain('- camel-fusion: "againShe"')
  // No matched-pair "(rewrite at least one side ...)" directive on these kinds.
  expect(out).not.toContain("(rewrite at least one side")
})

test("formatChapterIntegrityRetryContext: duplicate-* without firstExcerpt falls back to single-excerpt (L63 back-compat)", () => {
  // Older issue payloads that haven't been re-built since L63 still need to render.
  const out = formatChapterIntegrityRetryContext([
    { kind: "duplicate-sentence", excerpt: "She paused." },
  ])
  expect(out).toContain('- duplicate-sentence: "She paused."')
  expect(out).not.toContain("(rewrite at least one side")
})

// L65 / Lever G-A: chapter-attempt carry-over of LLM-confirmed ungrounded
// entities. Mirrors L63 / L41 surface but for halluc-ungrounded.

test("formatChapterUngroundedRetryContext: empty entities array returns empty string", () => {
  expect(formatChapterUngroundedRetryContext([])).toBe("")
})

test("formatChapterUngroundedRetryContext: single entity with excerpt renders both", () => {
  const out = formatChapterUngroundedRetryContext([
    { entity: "central spire", excerpt: "timestamps against the central spire's heartbeat records" },
  ])
  expect(out).toContain("AVOID THESE UNGROUNDED ENTITIES FROM YOUR PRIOR DRAFT")
  expect(out).toContain('- "central spire" — appeared in: "timestamps against the central spire')
})

test("formatChapterUngroundedRetryContext: entity without excerpt renders just the name", () => {
  const out = formatChapterUngroundedRetryContext([
    { entity: "Vesh Order" },
  ])
  expect(out).toContain('- "Vesh Order"')
  expect(out).not.toContain('appeared in:')
})

test("formatChapterUngroundedRetryContext: multiple entities all listed in order", () => {
  const out = formatChapterUngroundedRetryContext([
    { entity: "central spire" },
    { entity: "regional node", excerpt: "the regional node's backup logs" },
    { entity: "Framework" },
  ])
  expect(out.indexOf('"central spire"')).toBeLessThan(out.indexOf('"regional node"'))
  expect(out.indexOf('"regional node"')).toBeLessThan(out.indexOf('"Framework"'))
})

test("formatChapterUngroundedRetryContext: long excerpt is sliced to 200 chars to bound prompt growth", () => {
  const longExcerpt = "x".repeat(500)
  const out = formatChapterUngroundedRetryContext([
    { entity: "central spire", excerpt: longExcerpt },
  ])
  // 200 chars + the 36 chars of `- "central spire" — appeared in: "` prefix and trailing `"`
  // means the full ` - ...` line should not exceed ~250 chars.
  const line = out.split("\n").find(l => l.includes("central spire"))!
  expect(line.length).toBeLessThan(260)
  expect(line).toContain('"' + "x".repeat(200) + '"')
})

test("formatChapterUngroundedRetryContext: caps at 12 entities for extreme cases", () => {
  const entities = Array.from({ length: 25 }, (_, i) => ({ entity: `Entity${i}` }))
  const out = formatChapterUngroundedRetryContext(entities)
  expect(out).toContain('"Entity0"')
  expect(out).toContain('"Entity11"')
  expect(out).not.toContain('"Entity12"')
  expect(out).not.toContain('"Entity24"')
})

test("formatChapterUngroundedRetryContext: trims whitespace around excerpts", () => {
  const out = formatChapterUngroundedRetryContext([
    { entity: "Skill Point", excerpt: "   she earned a Skill Point   " },
  ])
  expect(out).toContain('appeared in: "she earned a Skill Point"')
})

// L65: extractor parses the agent's printf format and dedupes by lowercase entity.

test("extractUngroundedEntitiesFromDescriptions: parses entity-only line", () => {
  const out = extractUngroundedEntitiesFromDescriptions([
    'Ungrounded entity "central spire"',
  ])
  expect(out).toEqual([{ entity: "central spire" }])
})

test("extractUngroundedEntitiesFromDescriptions: parses entity + excerpt line", () => {
  const out = extractUngroundedEntitiesFromDescriptions([
    'Ungrounded entity "central spire" — context: "the central spire pulsed"',
  ])
  expect(out).toEqual([{ entity: "central spire", excerpt: "the central spire pulsed" }])
})

test("extractUngroundedEntitiesFromDescriptions: tolerates [NER prepass] suffix on compound-blocker entries", () => {
  const out = extractUngroundedEntitiesFromDescriptions([
    'Ungrounded entity "Vesh Order" [NER prepass]',
  ])
  expect(out).toEqual([{ entity: "Vesh Order" }])
})

test("extractUngroundedEntitiesFromDescriptions: dedupes by lowercase entity, keeps first occurrence", () => {
  const out = extractUngroundedEntitiesFromDescriptions([
    'Ungrounded entity "central spire" — context: "first occurrence"',
    'Ungrounded entity "Central Spire"',
    'Ungrounded entity "central spire" — context: "second occurrence"',
  ])
  expect(out).toHaveLength(1)
  expect(out[0]).toEqual({ entity: "central spire", excerpt: "first occurrence" })
})

test("extractUngroundedEntitiesFromDescriptions: drops lines that don't match the format", () => {
  const out = extractUngroundedEntitiesFromDescriptions([
    'Ungrounded entity "central spire"',
    'Beat 13: missing required action',
    'random log line with no entity',
    'Ungrounded entity "Vesh Order" [NER-only warning — LLM passed]', // pre-filtered out by severity in production; defensive drop here
  ])
  // First entry parses; the NER-only-warning suffix doesn't match the
  // permissive regex, so it's dropped — defense-in-depth in case a caller
  // forgets to pre-filter by severity.
  expect(out).toEqual([{ entity: "central spire" }])
})

test("extractUngroundedEntitiesFromDescriptions: empty input returns empty array", () => {
  expect(extractUngroundedEntitiesFromDescriptions([])).toEqual([])
})
