/**
 * Byte-parity gate for the D1 typed-slot refactor of buildSceneContext.
 *
 * Every fixture in `tests/beat-context-fixtures/*.json` is run through
 * BOTH the preserved legacy snapshot (`buildBeatContextLegacy`) and the
 * new typed-slot composer (`buildSceneContext`). The test asserts:
 *   - byte-equal `userPrompt`
 *   - equal `targetWords`
 *
 * If you change formatting in `src/agents/writer/beat-context-render.ts`
 * (or the slot builder) and this test fails, you have introduced a
 * runtime divergence. Either:
 *   (a) The change is intentional → backport the same change to
 *       `tests/beat-context-fixtures/legacy-snapshot.ts` in a separate
 *       deliberate commit so the parity gate continues to enforce future
 *       refactors; OR
 *   (b) The change is a regression → fix it in beat-context.ts /
 *       beat-context-render.ts so parity is restored.
 *
 * This file (and the legacy snapshot) stays in the suite long-term as a
 * regression check (Codex round-3 Q2).
 */

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buildSceneContext } from "../src/agents/writer/beat-context"
import { buildBeatContextLegacy, type BeatContextInputLegacy } from "./beat-context-fixtures/legacy-snapshot"

const FIXTURE_DIR = join(import.meta.dir, "beat-context-fixtures")

interface Fixture {
  name: string
  input: BeatContextInputLegacy
  description?: string
}

function loadFixtures(): Fixture[] {
  const files = readdirSync(FIXTURE_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
  return files.map(f => {
    const path = join(FIXTURE_DIR, f)
    const raw = JSON.parse(readFileSync(path, "utf8"))
    return {
      name: f.replace(/\.json$/, ""),
      input: raw.input as BeatContextInputLegacy,
      description: raw.description as string | undefined,
    }
  })
}

const fixtures = loadFixtures()

describe("buildSceneContext byte-parity vs legacy snapshot", () => {
  test("at least 20 fixtures present (diversity gate)", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20)
  })

  for (const fx of fixtures) {
    test(`${fx.name}${fx.description ? " — " + fx.description : ""}`, async () => {
      // Both implementations share the same try/catch around getRelationshipBetween,
      // so a missing DB connection produces identical output (no With/Tension lines)
      // in both paths. resolveReferences is bypassed via preResolvedRefs in every
      // fixture so we never hit the LLM.
      const legacy = await buildBeatContextLegacy(fx.input)
      const next = await buildSceneContext(fx.input)
      expect(next.targetWords).toBe(legacy.targetWords)
      expect(next.userPrompt).toBe(legacy.userPrompt)
    })
  }
})
