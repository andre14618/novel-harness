/**
 * Regression guard for `beat-writer-system.md`.
 *
 * Specifically guards the L66 BIBLE-binding constraint (line 18) against
 * future edits that accidentally narrow the rule back to character names
 * only, drop the description-equivalent example, or invert the framing
 * to a negative-prime ("do not invent"). The exp #392 trace showed the
 * pre-L66 wording ("characters and entities") was class-incomplete and
 * the writer drift-invented institutions, lore concepts, and titles.
 *
 * Each assertion documents WHY the phrase matters so a future maintainer
 * editing the prompt knows what they'd be removing.
 */

import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

const promptPath = resolve(
  dirname(new URL(import.meta.url).pathname),
  "beat-writer-system.md",
)
const prompt = readFileSync(promptPath, "utf-8")

test("L66: BIBLE-binding constraint enumerates ALL named-entity classes", () => {
  // Why: pre-L66 the rule said "characters and entities" which the writer
  // read as ambiguous and treated lore concepts / titles as outside scope
  // (exp #392 drift-invention pattern). The categorical enumeration is the
  // structural fix.
  expect(prompt).toContain("ALL named-entity classes")
  for (const cls of [
    "character names",
    "place names",
    "institutions",
    "organizations",
    "titles and ranks",
    "named lore concepts",
    "named artifacts",
    "named events",
  ]) {
    expect(prompt).toContain(cls)
  }
})

test("L66: BIBLE-binding constraint binds to the same grounded sources halluc-ungrounded checker uses", () => {
  // Why: the writer's allowed sources must mirror the checker's grounded
  // surface, otherwise the writer's prompt is permissive of entities the
  // checker will reject — generating extra retries or chapter exhaustions.
  for (const src of [
    "beat brief",
    "CHARACTERS",
    "WORLD-BIBLE",
    "prior beat",
    'Allowed-new-entities',
  ]) {
    expect(prompt).toContain(src)
  }
})

test("L66: includes a concrete description-equivalent example for the exp #392 case", () => {
  // Why: abstract rules under-perform vs concrete examples per L29 reframing
  // evidence. The "Senior Cataloguer" example anchors the rule to the actual
  // failure mode the smoke surfaced.
  expect(prompt).toContain('"a senior cataloguer"')
  // The capitalized form appears with a trailing comma in the prompt's
  // example sentence (",rather than..."), so match the prefix.
  expect(prompt).toContain('"Senior Cataloguer')
})

test("L66: framing is positive (allowed sources + description-equivalent), not negative-prime", () => {
  // Why: feedback_priming_suppression_ab — the 2026-04-20 Salvatore A/B
  // doubled absolute fire rate when negative-prime "do not invent" copy
  // was added. The L29 reframing in halluc-ungrounded retry guidance
  // ("Do not invent" → "use only [...]") is the proven shape. This test
  // catches accidental reversion to negative framing.
  const line18 = prompt.split("\n").find(l => l.startsWith("- Use named entities only"))
  expect(line18).toBeDefined()
  // The constraint line itself should NOT contain raw negative directives
  // about inventing, fabricating, or making up entities.
  expect(line18!.toLowerCase()).not.toMatch(/\bdo not invent\b/)
  expect(line18!.toLowerCase()).not.toMatch(/\bnever invent\b/)
  expect(line18!.toLowerCase()).not.toMatch(/\bdo not fabricate\b/)
  expect(line18!.toLowerCase()).not.toMatch(/\bdo not make up\b/)
})

test("beat-writer-system.md is loadable and non-empty (smoke)", () => {
  expect(prompt.length).toBeGreaterThan(500)
  expect(prompt).toContain("scene beat")
})
