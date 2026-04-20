/**
 * Unit tests for pickExampleLineSubset.
 *
 * Preset cycle math (both families):
 *   presetIdx = (chapterNumber * 100 + beatIndex) % 3
 *   0 → preset-a
 *   1 → preset-b
 *   2 → preset-c
 *
 * 5-line family:   preset-a [0,1,2]  preset-b [0,3,4]  preset-c [1,3,4]
 * 4-line family:   preset-a [0,1,2]  preset-b [0,1,3]  preset-c [1,2,3]
 *
 * The 4-line family is the production default (character-agent emits 4
 * exampleLines per character). The 5-line family is used when characters
 * ship with ≥5 lines (legacy / hand-curated eval cases).
 */

import { describe, it, expect } from "bun:test"
import { pickExampleLineSubset } from "./beat-context"

const FIVE_LINES = ["line0", "line1", "line2", "line3", "line4"]
const SIX_LINES  = ["line0", "line1", "line2", "line3", "line4", "line5"]
const FOUR_LINES = ["line0", "line1", "line2", "line3"]

// ── Fixed mode ────────────────────────────────────────────────────────────

describe("pickExampleLineSubset — fixed mode", () => {
  it("always returns preset-a indexes [0,1,2] regardless of chapter/beat", () => {
    expect(pickExampleLineSubset(FIVE_LINES, 0, 0, "fixed")).toEqual(["line0", "line1", "line2"])
    expect(pickExampleLineSubset(FIVE_LINES, 1, 0, "fixed")).toEqual(["line0", "line1", "line2"])
    expect(pickExampleLineSubset(FIVE_LINES, 5, 7, "fixed")).toEqual(["line0", "line1", "line2"])
    expect(pickExampleLineSubset(FIVE_LINES, 99, 99, "fixed")).toEqual(["line0", "line1", "line2"])
  })

  it("same (chapter, beat) gives same subset across multiple calls", () => {
    const a = pickExampleLineSubset(FIVE_LINES, 2, 3, "fixed")
    const b = pickExampleLineSubset(FIVE_LINES, 2, 3, "fixed")
    expect(a).toEqual(b)
  })
})

// ── Rotation mode ─────────────────────────────────────────────────────────

describe("pickExampleLineSubset — rotation mode", () => {
  it("chapter=0 beat=0 → presetIdx 0 → preset-a [0,1,2]", () => {
    // (0*100+0)%3 = 0 → preset-a
    expect(pickExampleLineSubset(FIVE_LINES, 0, 0, "rotation")).toEqual(["line0", "line1", "line2"])
  })

  it("chapter=1 beat=0 → presetIdx 1 → preset-b [0,3,4]", () => {
    // (1*100+0)%3 = 100%3 = 1 → preset-b
    expect(pickExampleLineSubset(FIVE_LINES, 1, 0, "rotation")).toEqual(["line0", "line3", "line4"])
  })

  it("chapter=1 beat=1 → presetIdx 2 → preset-c [1,3,4]", () => {
    // (1*100+1)%3 = 101%3 = 2 → preset-c
    expect(pickExampleLineSubset(FIVE_LINES, 1, 1, "rotation")).toEqual(["line1", "line3", "line4"])
  })

  it("chapter=1 beat=2 → presetIdx 0 → preset-a [0,1,2]", () => {
    // (1*100+2)%3 = 102%3 = 0 → preset-a
    expect(pickExampleLineSubset(FIVE_LINES, 1, 2, "rotation")).toEqual(["line0", "line1", "line2"])
  })

  it("same (chapter, beat) always gives the same subset", () => {
    const a = pickExampleLineSubset(FIVE_LINES, 3, 7, "rotation")
    const b = pickExampleLineSubset(FIVE_LINES, 3, 7, "rotation")
    expect(a).toEqual(b)
  })

  it("consecutive beats on the same chapter cycle through 3 distinct presets", () => {
    // chapter=0: beats 0→preset-a, 1→preset-b, 2→preset-c, 3→preset-a, ...
    const subsets = [0, 1, 2].map(bi => pickExampleLineSubset(FIVE_LINES, 0, bi, "rotation"))
    // All three should be distinct
    expect(subsets[0]).not.toEqual(subsets[1])
    expect(subsets[1]).not.toEqual(subsets[2])
    expect(subsets[0]).not.toEqual(subsets[2])
  })

  it("beat 3 wraps back to same preset as beat 0 on same chapter", () => {
    const beat0 = pickExampleLineSubset(FIVE_LINES, 0, 0, "rotation")
    const beat3 = pickExampleLineSubset(FIVE_LINES, 0, 3, "rotation")
    expect(beat0).toEqual(beat3)
  })

  it("works correctly with a 6-line array", () => {
    // preset-b should still read indexes [0,3,4] from the longer array
    // (1*100+0)%3 = 1 → preset-b [0,3,4]
    expect(pickExampleLineSubset(SIX_LINES, 1, 0, "rotation")).toEqual(["line0", "line3", "line4"])
  })
})

// ── Production default (conditioning === undefined) ──────────────────────

describe("pickExampleLineSubset — production default (undefined)", () => {
  it("returns raw slice(0,5) unchanged on a 4-line array (preserves live behavior)", () => {
    const four = ["line0", "line1", "line2", "line3"]
    expect(pickExampleLineSubset(four, 0, 0, undefined)).toEqual(four)
    expect(pickExampleLineSubset(four, 5, 7, undefined)).toEqual(four)
  })

  it("returns first 5 lines on a 5-line array", () => {
    expect(pickExampleLineSubset(FIVE_LINES, 0, 0, undefined)).toEqual(FIVE_LINES)
  })

  it("returns first 5 lines on a 6-line array (slice cap)", () => {
    expect(pickExampleLineSubset(SIX_LINES, 0, 0, undefined)).toEqual(SIX_LINES.slice(0, 5))
  })

  it("chapter and beat coordinates are ignored in production mode", () => {
    const four = ["a", "b", "c", "d"]
    expect(pickExampleLineSubset(four, 0, 0, undefined)).toEqual(four)
    expect(pickExampleLineSubset(four, 1, 1, undefined)).toEqual(four)
    expect(pickExampleLineSubset(four, 99, 99, undefined)).toEqual(four)
  })
})

// ── Short-array fallback ──────────────────────────────────────────────────

describe("pickExampleLineSubset — short array fallback", () => {
  it("length-0 array returns empty slice regardless of mode", () => {
    expect(pickExampleLineSubset([], 0, 0, "fixed")).toEqual([])
    expect(pickExampleLineSubset([], 1, 2, "rotation")).toEqual([])
  })

  it("length-1 array returns unchanged (too short for distinct presets)", () => {
    expect(pickExampleLineSubset(["only"], 0, 0, "fixed")).toEqual(["only"])
    expect(pickExampleLineSubset(["only"], 1, 0, "rotation")).toEqual(["only"])
  })

  it("length-2 array returns unchanged in both modes", () => {
    const two = ["a", "b"]
    expect(pickExampleLineSubset(two, 0, 0, "fixed")).toEqual(["a", "b"])
    expect(pickExampleLineSubset(two, 5, 3, "rotation")).toEqual(["a", "b"])
  })

  it("length-3 array returns unchanged (fewer than 4 lines)", () => {
    const three = ["x", "y", "z"]
    expect(pickExampleLineSubset(three, 0, 0, "fixed")).toEqual(["x", "y", "z"])
    expect(pickExampleLineSubset(three, 2, 1, "rotation")).toEqual(["x", "y", "z"])
  })
})

// ── 4-line preset family (production default) ─────────────────────────────

describe("pickExampleLineSubset — 4-line preset family", () => {
  it("fixed mode returns 4-line preset-a [0,1,2] on 4-line array", () => {
    expect(pickExampleLineSubset(FOUR_LINES, 0, 0, "fixed")).toEqual(["line0", "line1", "line2"])
    expect(pickExampleLineSubset(FOUR_LINES, 99, 99, "fixed")).toEqual(["line0", "line1", "line2"])
  })

  it("rotation chapter=0 beat=0 → preset-a [0,1,2]", () => {
    expect(pickExampleLineSubset(FOUR_LINES, 0, 0, "rotation")).toEqual(["line0", "line1", "line2"])
  })

  it("rotation chapter=1 beat=0 → preset-b [0,1,3]", () => {
    // (100 % 3) = 1 → preset-b
    expect(pickExampleLineSubset(FOUR_LINES, 1, 0, "rotation")).toEqual(["line0", "line1", "line3"])
  })

  it("rotation chapter=1 beat=1 → preset-c [1,2,3]", () => {
    // (101 % 3) = 2 → preset-c
    expect(pickExampleLineSubset(FOUR_LINES, 1, 1, "rotation")).toEqual(["line1", "line2", "line3"])
  })

  it("all three 4-line rotation presets are distinct", () => {
    const subsets = [0, 1, 2].map(bi => pickExampleLineSubset(FOUR_LINES, 0, bi, "rotation"))
    expect(subsets[0]).not.toEqual(subsets[1])
    expect(subsets[1]).not.toEqual(subsets[2])
    expect(subsets[0]).not.toEqual(subsets[2])
  })

  it("5-line array still uses 5-line presets (preset-b = [0,3,4])", () => {
    expect(pickExampleLineSubset(FIVE_LINES, 1, 0, "rotation")).toEqual(["line0", "line3", "line4"])
  })
})
