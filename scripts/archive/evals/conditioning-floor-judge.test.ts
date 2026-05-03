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

  test("works with non-fixed/rotation arm labels (raw vs rotation)", () => {
    const pair = makePair({
      arm_a_label: "raw",
      arm_b_label: "rotation",
      arm_a_prose: "Raw arm prose here.",
      arm_b_prose: "Rotation arm prose here.",
    })
    for (let i = 0; i < 10; i++) {
      const result = shufflePair(pair, `seed-${i}`)
      const labels = new Set([result.shuffled_a_label, result.shuffled_b_label])
      expect(labels).toEqual(new Set(["raw", "rotation"]))
    }
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

  test("works with arbitrary arm labels (raw, fixed, rotation)", () => {
    expect(unshuffleVerdict("A", "raw", "rotation")).toBe("raw")
    expect(unshuffleVerdict("B", "raw", "rotation")).toBe("rotation")
    expect(unshuffleVerdict("A", "raw", "fixed")).toBe("raw")
    expect(unshuffleVerdict("B", "raw", "fixed")).toBe("fixed")
  })
})

// ── resolveLossShortCircuit — loss_a/loss_b (canonical) ──────────────────────

describe("resolveLossShortCircuit — loss_a/loss_b canonical fields", () => {
  test("clean pair (no losses, no errors) returns null — judge evaluates normally", () => {
    expect(resolveLossShortCircuit(makePair())).toBeNull()
  })

  test("loss_a=true → automatic arm_b_label win, reason names arm_a_label", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_a: true,
      words_a: 12,
      words_b: 240,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("rotation") // arm_b_label
    expect(result!.reason).toContain("fixed=12w")
  })

  test("loss_b=true → automatic arm_a_label win, reason names arm_b_label", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_b: true,
      words_a: 300,
      words_b: 30,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("fixed") // arm_a_label
    expect(result!.reason).toContain("rotation=30w")
  })

  test("both loss_a and loss_b → error row, not a tie", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_a: true,
      loss_b: true,
      words_a: 10,
      words_b: 5,
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

  test("error_text combined with partial loss → that loss arm still auto-wins", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_a: true,
      error_text: "fixed arm hit transport error",
      words_a: 0,
      words_b: 230,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("rotation") // arm_b_label
  })
})

// ── resolveLossShortCircuit — loss_a/loss_b with raw arm labels ───────────────

describe("resolveLossShortCircuit — raw vs rotation pair set (arm labels vary)", () => {
  function makeRawVsRotationPair(overrides: Partial<PairRow> = {}): PairRow {
    return {
      pair_id: "raw-vs-rotation-001",
      pov_character: "Drizzt",
      characters_present: ["Drizzt", "Entreri"],
      beat_description: "A tense standoff in the cave.",
      arm_a_prose: "Prose from the raw arm.",
      arm_b_prose: "Prose from the rotation arm.",
      arm_a_label: "raw",
      arm_b_label: "rotation",
      ...overrides,
    }
  }

  test("clean raw-vs-rotation pair → null (judge evaluates normally)", () => {
    expect(resolveLossShortCircuit(makeRawVsRotationPair())).toBeNull()
  })

  test("loss_a=true on raw-vs-rotation → automatic 'rotation' win", () => {
    const result = resolveLossShortCircuit(makeRawVsRotationPair({
      loss_a: true,
      words_a: 8,
      words_b: 200,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("rotation")
    // Reason should mention 'raw' (the arm_a_label) not 'fixed'
    expect(result!.reason).toContain("raw")
    expect(result!.reason).not.toContain("fixed")
  })

  test("loss_b=true on raw-vs-rotation → automatic 'raw' win", () => {
    const result = resolveLossShortCircuit(makeRawVsRotationPair({
      loss_b: true,
      words_a: 300,
      words_b: 15,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("raw")
    expect(result!.reason).toContain("rotation")
  })

  test("both arms lost on raw-vs-rotation → error", () => {
    const result = resolveLossShortCircuit(makeRawVsRotationPair({
      loss_a: true,
      loss_b: true,
      words_a: 0,
      words_b: 0,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("error")
    // Reason names both arm labels
    expect(result!.reason).toContain("raw=0w")
    expect(result!.reason).toContain("rotation=0w")
  })
})

// ── resolveLossShortCircuit — raw vs fixed pair set ───────────────────────────

describe("resolveLossShortCircuit — raw vs fixed pair set (arm labels vary)", () => {
  function makeRawVsFixedPair(overrides: Partial<PairRow> = {}): PairRow {
    return {
      pair_id: "raw-vs-fixed-001",
      pov_character: "Drizzt",
      characters_present: ["Drizzt", "Entreri"],
      beat_description: "A tense standoff in the cave.",
      arm_a_prose: "Prose from the raw arm.",
      arm_b_prose: "Prose from the fixed arm.",
      arm_a_label: "raw",
      arm_b_label: "fixed",
      ...overrides,
    }
  }

  test("loss_b=true on raw-vs-fixed → automatic 'raw' win", () => {
    const result = resolveLossShortCircuit(makeRawVsFixedPair({
      loss_b: true,
      words_a: 250,
      words_b: 3,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("raw")
    expect(result!.reason).toContain("fixed")
  })

  test("loss_a=true on raw-vs-fixed → automatic 'fixed' win", () => {
    const result = resolveLossShortCircuit(makeRawVsFixedPair({
      loss_a: true,
      words_a: 0,
      words_b: 180,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("fixed")
    expect(result!.reason).toContain("raw")
  })
})

// ── resolveLossShortCircuit — backward compat (loss_fixed/loss_rotation) ──────

describe("resolveLossShortCircuit — backward compat: loss_fixed/loss_rotation", () => {
  test("loss_fixed=true (old field) → automatic rotation win (reads as loss_a compat)", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_fixed: true,
      words_fixed: 12,
      words_rotation: 240,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("rotation")
    expect(result!.reason).toContain("fixed=12w")
  })

  test("loss_rotation=true (old field) → automatic fixed win (reads as loss_b compat)", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_rotation: true,
      words_fixed: 300,
      words_rotation: 30,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("fixed")
    expect(result!.reason).toContain("rotation=30w")
  })

  test("both loss_fixed and loss_rotation (old fields) → error row", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_fixed: true,
      loss_rotation: true,
      words_fixed: 10,
      words_rotation: 5,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("error")
  })

  test("new loss_a/loss_b fields take precedence over old loss_fixed/loss_rotation", () => {
    // If both old and new fields are present, new wins.
    // loss_a=false + loss_fixed=true → should be no-loss (loss_a wins)
    const result = resolveLossShortCircuit(makePair({
      loss_a: false,
      loss_b: false,
      loss_fixed: true,  // old field — should be ignored when loss_a is present
      loss_rotation: true,  // old field — should be ignored when loss_b is present
    }))
    // loss_a / loss_b are false → pair is eligible for judging → null
    expect(result).toBeNull()
  })

  test("error_text combined with partial loss — old field names still work", () => {
    // Old runner output: has loss_fixed, no loss_a
    const result = resolveLossShortCircuit(makePair({
      loss_fixed: true,
      error_text: "fixed arm hit transport error",
      words_fixed: 0,
      words_rotation: 230,
    }))
    expect(result).not.toBeNull()
    expect(result!.winner_arm_label).toBe("rotation")
  })

  test("old words_fixed/words_rotation used in reason when words_a/words_b absent", () => {
    const result = resolveLossShortCircuit(makePair({
      loss_fixed: true,
      words_fixed: 7,
      words_rotation: 300,
      // No words_a / words_b set
    }))
    expect(result).not.toBeNull()
    expect(result!.reason).toContain("fixed=7w")
  })
})
