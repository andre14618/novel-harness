import { describe, expect, test } from "bun:test"
import { isEligible, stratifyBeats, type EligibleBeat } from "./conditioning-floor-pair-builder"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBeat(chapter: number, beatIndex: number, kind: string, characters: string[]): EligibleBeat {
  return {
    chapter_number: chapter,
    beat_index_in_chapter: beatIndex,
    pov_character: "Hero",
    characters_present: characters,
    kind,
    description: `Chapter ${chapter} beat ${beatIndex} (${kind})`,
  }
}

// ── isEligible ────────────────────────────────────────────────────────────────

describe("isEligible", () => {
  test("dialogue beat with 2 characters is eligible", () => {
    expect(isEligible({ kind: "dialogue", characters_present: ["Alice", "Bob"] })).toBe(true)
  })

  test("dialogue beat with 3 characters is eligible", () => {
    expect(isEligible({ kind: "dialogue", characters_present: ["Alice", "Bob", "Carol"] })).toBe(true)
  })

  test("dialogue beat with only 1 character is not eligible", () => {
    expect(isEligible({ kind: "dialogue", characters_present: ["Alice"] })).toBe(false)
  })

  test("dialogue beat with 0 characters is not eligible", () => {
    expect(isEligible({ kind: "dialogue", characters_present: [] })).toBe(false)
  })

  test("action beat with 2 characters is not eligible (wrong kind)", () => {
    expect(isEligible({ kind: "action", characters_present: ["Alice", "Bob"] })).toBe(false)
  })

  test("interiority beat with 2 characters is not eligible (wrong kind)", () => {
    expect(isEligible({ kind: "interiority", characters_present: ["Alice", "Bob"] })).toBe(false)
  })

  test("description beat with 2 characters is not eligible (wrong kind)", () => {
    expect(isEligible({ kind: "description", characters_present: ["Alice", "Bob"] })).toBe(false)
  })
})

// ── stratifyBeats ─────────────────────────────────────────────────────────────

describe("stratifyBeats", () => {
  test("returns all beats unchanged if total <= cap", () => {
    const beats = [
      makeBeat(1, 0, "dialogue", ["A", "B"]),
      makeBeat(1, 1, "dialogue", ["A", "B"]),
      makeBeat(2, 0, "dialogue", ["A", "B"]),
    ]
    const result = stratifyBeats(beats, 10)
    expect(result).toHaveLength(3)
    expect(result).toEqual(beats)
  })

  test("returns exactly cap beats when total > cap", () => {
    const beats = [
      makeBeat(1, 0, "dialogue", ["A", "B"]),
      makeBeat(1, 1, "dialogue", ["A", "B"]),
      makeBeat(1, 2, "dialogue", ["A", "B"]),
      makeBeat(2, 0, "dialogue", ["A", "B"]),
      makeBeat(2, 1, "dialogue", ["A", "B"]),
      makeBeat(2, 2, "dialogue", ["A", "B"]),
    ]
    const result = stratifyBeats(beats, 4)
    expect(result).toHaveLength(4)
  })

  test("round-robin interleaves chapters evenly", () => {
    // 3 beats from chapter 1, 3 beats from chapter 2 — cap 4
    // Expected order: ch1[0], ch2[0], ch1[1], ch2[1]
    const beats = [
      makeBeat(1, 0, "dialogue", ["A", "B"]),
      makeBeat(1, 1, "dialogue", ["A", "B"]),
      makeBeat(1, 2, "dialogue", ["A", "B"]),
      makeBeat(2, 0, "dialogue", ["A", "B"]),
      makeBeat(2, 1, "dialogue", ["A", "B"]),
      makeBeat(2, 2, "dialogue", ["A", "B"]),
    ]
    const result = stratifyBeats(beats, 4)
    expect(result).toHaveLength(4)
    expect(result[0].chapter_number).toBe(1)
    expect(result[1].chapter_number).toBe(2)
    expect(result[2].chapter_number).toBe(1)
    expect(result[3].chapter_number).toBe(2)
  })

  test("round-robin with 3 chapters, cap 6 picks 2 from each", () => {
    const beats = [
      makeBeat(1, 0, "dialogue", ["A", "B"]),
      makeBeat(1, 1, "dialogue", ["A", "B"]),
      makeBeat(1, 2, "dialogue", ["A", "B"]),
      makeBeat(2, 0, "dialogue", ["A", "B"]),
      makeBeat(2, 1, "dialogue", ["A", "B"]),
      makeBeat(2, 2, "dialogue", ["A", "B"]),
      makeBeat(3, 0, "dialogue", ["A", "B"]),
      makeBeat(3, 1, "dialogue", ["A", "B"]),
      makeBeat(3, 2, "dialogue", ["A", "B"]),
    ]
    const result = stratifyBeats(beats, 6)
    expect(result).toHaveLength(6)
    const ch1 = result.filter((b) => b.chapter_number === 1)
    const ch2 = result.filter((b) => b.chapter_number === 2)
    const ch3 = result.filter((b) => b.chapter_number === 3)
    expect(ch1).toHaveLength(2)
    expect(ch2).toHaveLength(2)
    expect(ch3).toHaveLength(2)
  })

  test("handles uneven chapters — smaller chapters exhausted first, larger chapters pick up the slack", () => {
    // Chapter 1 has 1 beat, chapter 2 has 4 beats — cap 4
    // Round 1: ch1[0], ch2[0]; Round 2: ch1 exhausted, ch2[1]; Round 3: ch2[2]
    const beats = [
      makeBeat(1, 0, "dialogue", ["A", "B"]),
      makeBeat(2, 0, "dialogue", ["A", "B"]),
      makeBeat(2, 1, "dialogue", ["A", "B"]),
      makeBeat(2, 2, "dialogue", ["A", "B"]),
      makeBeat(2, 3, "dialogue", ["A", "B"]),
    ]
    const result = stratifyBeats(beats, 4)
    expect(result).toHaveLength(4)
    // First two should be ch1 and ch2 interleaved
    expect(result[0].chapter_number).toBe(1)
    expect(result[1].chapter_number).toBe(2)
    // After ch1 exhausted, remaining picks from ch2
    expect(result[2].chapter_number).toBe(2)
    expect(result[3].chapter_number).toBe(2)
  })

  test("cap of 0 returns empty array", () => {
    const beats = [makeBeat(1, 0, "dialogue", ["A", "B"])]
    const result = stratifyBeats(beats, 0)
    expect(result).toHaveLength(0)
  })

  test("empty input returns empty array", () => {
    const result = stratifyBeats([], 10)
    expect(result).toHaveLength(0)
  })

  test("does not mutate the original array", () => {
    const beats = [
      makeBeat(1, 0, "dialogue", ["A", "B"]),
      makeBeat(2, 0, "dialogue", ["A", "B"]),
    ]
    const original = [...beats]
    stratifyBeats(beats, 1)
    expect(beats).toEqual(original)
  })
})
