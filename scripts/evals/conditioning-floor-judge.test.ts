import { describe, expect, test } from "bun:test"
import {
  shufflePair,
  unshuffleVerdict,
  resolveLossShortCircuit,
  type PairRow,
} from "./conditioning-floor-judge"

function makePair(overrides: Partial<PairRow> = {}): PairRow {
  return {
    pair_id: "test-pair-001",
    pov_character: "Drizzt",
    characters_present: ["Drizzt", "Entreri"],
    beat_description: "A tense standoff in the cave.",
    arm_a_prose: "Prose from the fixed arm.",
    arm_b_prose: "Prose from the rotation arm.",
    arm_a_label: "fixed",
    arm_b_label: "rotation",
    ...overrides
  }
}

// ── shufflePair ───────────────────────────────────────────────────────────────

describe("shufflePair — determinism", () => {
  test("same seed + same pair_id always produces the same assignment", () => {
    const pair = makePair()
    const first = shufflePair(pair, "conditioning-floor-v1")
    const second = shufflePair(pair, "conditioning-floor-v1")
    expect(first.shuffled_a_label).toBe(second.shuffled_a_label)
    expect(first.shuffled_b_label).toBe(second.shuffled_b_label)
    expect(first.prose_a).toBe(second.prose_a)
    expect(first.prose_b).toBe(second.prose_b)
  })

  test("different pair_ids produce at least one swap across a sample set", () => {
    const aLabels = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const pair = makePair({ pair_id: `pair-${i}` })
      const result = shufflePair(pair, "conditioning-floor-v1")
      aLabels.add(result.shuffled_a_label)
    }
    // With 20 different pair_ids, we expect both "fixed" and "rotation" to
    // appear in position A at least once (probability of missing either is ~2^{-20}).
    expect(aLabels.has("fixed")).toBe(true)
    expect(aLabels.has("rotation")).toBe(true)
  })

  test("shuffled labels are always the original two labels (just possibly swapped)", () => {
    const pair = makePair()
    for (let i = 0; i < 10; i++) {
      const result = shufflePair(pair, `seed-${i}`)
      const labels = new Set([result.shuffled_a_label, result.shuffled_b_label])
      expect(labels).toEqual(new Set(["fixed", "rotation"]))
    }
  })

  test("swapped pair has prose_a = arm_b_prose and prose_b = arm_a_prose", () => {
    // Find a seed that swaps for pair-id "test-pair-001"
    // We'll test both cases by using different pair_ids until we get both orderings
    const pair = makePair()
    let foundSwapped = false
    let foundNormal = false

    for (let i = 0; i < 50; i++) {
      const result = shufflePair({ ...pair, pair_id: `seek-${i}` }, "conditioning-floor-v1")
      if (result.shuffled_a_label === "rotation") {
        // swapped: arm_b_prose went to position A
        expect(result.prose_a).toBe(pair.arm_b_prose)
        expect(result.prose_b).toBe(pair.arm_a_prose)
        foundSwapped = true
      } else {
        // normal: arm_a_prose stays in position A
        expect(result.prose_a).toBe(pair.arm_a_prose)
        expect(result.prose_b).toBe(pair.arm_b_prose)
        foundNormal = true
      }
      if (foundSwapped && foundNormal) break
    }

    expect(foundSwapped).toBe(true)
    expect(foundNormal).toBe(true)
  })
})

// ── unshuffleVerdict ─────────────────────────────────────────────────────────

describe("unshuffleVerdict — arm-label resolution", () => {
  test('judge winner "A" maps to shuffled_a_label', () => {
    expect(unshuffleVerdict("A", "rotation", "fixed")).toBe("rotation")
    expect(unshuffleVerdict("A", "fixed", "rotation")).toBe("fixed")
  })

  test('judge winner "B" maps to shuffled_b_label', () => {
    expect(unshuffleVerdict("B", "rotation", "fixed")).toBe("fixed")
    expect(unshuffleVerdict("B", "fixed", "rotation")).toBe("rotation")
  })

  test('judge winner "tie" always returns "tie" regardless of labels', () => {
    expect(unshuffleVerdict("tie", "rotation", "fixed")).toBe("tie")
    expect(unshuffleVerdict("tie", "fixed", "rotation")).toBe("tie")
    expect(unshuffleVerdict("tie", "arm-x", "arm-y")).toBe("tie")
  })

  test("round-trip: shuffle then unshuffle correctly identifies the winning arm", () => {
    const pair = makePair()

    // Run across several seeds to cover both swap and non-swap cases
    for (let i = 0; i < 30; i++) {
      const seed = `test-seed-${i}`
      const { shuffled_a_label, shuffled_b_label } = shufflePair(pair, seed)

      // Simulate judge picking position A
      const winnerViaA = unshuffleVerdict("A", shuffled_a_label, shuffled_b_label)
      expect(winnerViaA).toBe(shuffled_a_label)

      // Simulate judge picking position B
      const winnerViaB = unshuffleVerdict("B", shuffled_a_label, shuffled_b_label)
      expect(winnerViaB).toBe(shuffled_b_label)
    }
  })
})

// ── resolveLossShortCircuit ───────────────────────────────────────────────────

describe("resolveLossShortCircuit — charter §7 loss encoding", () => {
  test("clean pair (no losses, no errors) returns null — judge evaluates normally", () => {
    expect(resolveLossShortCircuit(makePair())).toBeNull()
  })

  test("fixed arm below min-words → automatic rotation win", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_fixed: true,
      words_fixed: 12,
      words_rotation: 240,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("rotation")
    expect(result!.reason).toContain("fixed=12w")
  })

  test("rotation arm below min-words → automatic fixed win", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_rotation: true,
      words_fixed: 300,
      words_rotation: 30,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("fixed")
    expect(result!.reason).toContain("rotation=30w")
  })

  test("both arms below min-words → error row, not a tie (doesn't count toward tally)", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_fixed: true,
      loss_rotation: true,
      words_fixed: 10,
      words_rotation: 5,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("error")
  })

  test("error_text alone (no loss flags) → error row", () => {
    const result = resolveLossShortCircuit(makePair({
      error_text: "transport timeout on both arms",
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("error")
  })

  test("error_text combined with partial loss → that loss still wins its arm", () => {
    // If the fixed arm lost AND there was an error, rotation still auto-wins;
    // the error text is folded into the loss reason.
    const result = resolveLossShortCircuit(makePair({
      loss_fixed: true,
      error_text: "fixed arm hit transport error",
      words_fixed: 0,
      words_rotation: 230,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("rotation")
  })
})
