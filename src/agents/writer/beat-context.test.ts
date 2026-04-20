/**
 * Unit tests for pickExampleLineSubset.
 *
 * Preset cycle math:
 *   presetIdx = (chapterNumber * 100 + beatIndex) % 3
 *   0 → preset-a [0,1,2]
 *   1 → preset-b [0,3,4]
 *   2 → preset-c [1,3,4]
 *
 * Examples:
 *   chapter=0, beat=0  → (0*100+0)%3 = 0 → preset-a
 *   chapter=1, beat=0  → (1*100+0)%3 = 1 → preset-b [0,3,4]
 *   chapter=1, beat=1  → (1*100+1)%3 = 2 → preset-c [1,3,4]
 *   chapter=1, beat=2  → (1*100+2)%3 = 0 → preset-a [0,1,2]
 */

import { describe, it, expect } from "bun:test"
import { pickExampleLineSubset } from "./beat-context"

const FIVE_LINES = ["line0", "line1", "line2", "line3", "line4"]
const SIX_LINES  = ["line0", "line1", "line2", "line3", "line4", "line5"]

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

  it("length-3 array returns unchanged (fewer than 5 lines)", () => {
    const three = ["x", "y", "z"]
    expect(pickExampleLineSubset(three, 0, 0, "fixed")).toEqual(["x", "y", "z"])
    expect(pickExampleLineSubset(three, 2, 1, "rotation")).toEqual(["x", "y", "z"])
  })

  it("length-4 array returns unchanged (fewer than 5 lines)", () => {
    const four = ["a", "b", "c", "d"]
    expect(pickExampleLineSubset(four, 0, 0, "fixed")).toEqual(["a", "b", "c", "d"])
    expect(pickExampleLineSubset(four, 1, 0, "rotation")).toEqual(["a", "b", "c", "d"])
  })
})
