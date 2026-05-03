/**
 * exampleLines conditioning preset selection. Extracted from
 * `./beat-context.ts` (2026-04-28) so the unit tests in
 * `./beat-context.test.ts` can import directly without going through
 * the process-global module mocks installed by the drafting tests
 * (`src/phases/drafting-revision-used-persistence.test.ts` +
 * `src/phases/drafting-reviser-escalation.test.ts`). beat-context.ts
 * re-exports the function so the public surface is unchanged.
 *
 * Preset definitions are frozen and shared with the distinctness eval
 * scorer at scripts/archive/evals/run-salvatore-distinctness-v1.ts.
 *
 * Two preset families to match what production actually ships:
 *
 * 5-line presets (legacy / hand-curated eval characters):
 *   preset-a: [0, 1, 2]
 *   preset-b: [0, 3, 4]
 *   preset-c: [1, 3, 4]
 * These match docs/evals/salvatore-distinctness-v1.md §"Preset definitions"
 * and the 5-line voice cards hand-curated for the frozen distinctness eval.
 *
 * 4-line presets (production character-agent default — 4 exampleLines per
 * character per src/agents/character-agent/character-profile-system.md:22):
 *   preset-a: [0, 1, 2]  (omits 3)
 *   preset-b: [0, 1, 3]  (omits 2)
 *   preset-c: [1, 2, 3]  (omits 0)
 * Each size-3 subset of a size-4 array; pairwise overlap = 2 lines. Preset-a
 * matches the 5-line preset-a so "fixed" behavior is consistent when the
 * character has ≥4 lines.
 *
 * Added 2026-04-20 after Codex round-4 adversarial review (charter §10.4)
 * flagged that the 5-line-only preset set was a runtime no-op on the
 * deployed 4-anchor surface.
 */

const CANONICAL_LINE_PRESET_INDEXES_5: Record<"preset-a" | "preset-b" | "preset-c", number[]> = {
  "preset-a": [0, 1, 2],
  "preset-b": [0, 3, 4],
  "preset-c": [1, 3, 4],
}
const CANONICAL_LINE_PRESET_INDEXES_4: Record<"preset-a" | "preset-b" | "preset-c", number[]> = {
  "preset-a": [0, 1, 2],
  "preset-b": [0, 1, 3],
  "preset-c": [1, 2, 3],
}
const PRESET_CYCLE: Array<"preset-a" | "preset-b" | "preset-c"> = ["preset-a", "preset-b", "preset-c"]

/**
 * Pick a subset of a character's exampleLines based on the current
 * conditioning mode and (chapter, beat) coordinates.
 *
 * Undefined (production default): return lines.slice(0, 5) — the behavior
 *   live novels have always shipped. No preset logic applied. This is what
 *   any non-experiment code path gets.
 * Fixed mode:   always returns preset-a (experiment intervention, not
 *   production).
 * Rotation mode: cycles preset-a → b → c → a … by (chapter * 100 + beat) % 3
 *   (experiment intervention, not production).
 *
 * Selects the 4-line preset family when the array has exactly 4 elements
 * (production default for experiment arms), the 5-line family when it has
 * ≥5 (legacy / hand-curated eval characters), and falls back to the raw
 * slice when there are fewer than 4 lines (not enough to form distinct
 * 3-line subsets).
 *
 * Changed 2026-04-20 after parity harness caught that pack-level default
 * "fixed" was regressing production to 3-of-4 lines on every beat.
 */
export function pickExampleLineSubset(
  lines: string[],
  chapterNumber: number,
  beatIndex: number,
  conditioning: "fixed" | "rotation" | undefined,
): string[] {
  // Production default: undefined conditioning → raw slice, unchanged.
  if (conditioning === undefined) return lines.slice(0, 5)
  if (lines.length < 4) return lines.slice(0, 5) // not enough lines to form distinct 3-line subsets
  const presetFamily = lines.length >= 5 ? CANONICAL_LINE_PRESET_INDEXES_5 : CANONICAL_LINE_PRESET_INDEXES_4
  if (conditioning === "fixed") {
    return presetFamily["preset-a"]
      .map(i => lines[i])
      .filter((v): v is string => typeof v === "string")
  }
  const presetIdx = (chapterNumber * 100 + beatIndex) % 3
  const preset = PRESET_CYCLE[presetIdx]
  return presetFamily[preset]
    .map(i => lines[i])
    .filter((v): v is string => typeof v === "string")
}
