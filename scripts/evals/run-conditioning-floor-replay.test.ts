import { describe, expect, test } from "bun:test"
import {
  assertGuardrails,
  derivePriorBeatCoords,
  tripletToFixedVsRotation,
  tripletToRawVsRotation,
  tripletToRawVsFixed,
  type ReplayPairRow,
  type ReplayTriplet,
} from "./run-conditioning-floor-replay"
import { shufflePair } from "./conditioning-floor-judge"
import type { PairRow } from "./conditioning-floor-judge"

// ── assertGuardrails ──────────────────────────────────────────────────────────

describe("assertGuardrails — env violations", () => {
  test("passes with clean env (no override vars set)", () => {
    // Should not throw
    const clean: Record<string, string | undefined> = {}
    expect(() => assertGuardrails(clean)).not.toThrow()
  })

  test("fails when WRITER_MODEL_OVERRIDE is set", () => {
    const env: Record<string, string | undefined> = {
      WRITER_MODEL_OVERRIDE: "some-other-model",
    }
    // assertGuardrails calls process.exit(1) on violation, so we intercept it
    const originalExit = process.exit.bind(process)
    let exitCode: number | undefined
    ;(process as any).exit = (code: number) => {
      exitCode = code
      throw new Error(`process.exit(${code})`)
    }
    try {
      assertGuardrails(env)
    } catch (err) {
      // expected — guardrail calls process.exit(1)
    } finally {
      ;(process as any).exit = originalExit
    }
    expect(exitCode).toBe(1)
  })

  test("fails when WRITER_PROVIDER_OVERRIDE is set", () => {
    const env: Record<string, string | undefined> = {
      WRITER_PROVIDER_OVERRIDE: "cerebras",
    }
    const originalExit = process.exit.bind(process)
    let exitCode: number | undefined
    ;(process as any).exit = (code: number) => {
      exitCode = code
      throw new Error(`process.exit(${code})`)
    }
    try {
      assertGuardrails(env)
    } catch {
      // expected
    } finally {
      ;(process as any).exit = originalExit
    }
    expect(exitCode).toBe(1)
  })

  test("fails when STYLE_PRIMER is set", () => {
    const env: Record<string, string | undefined> = {
      STYLE_PRIMER: "howard",
    }
    const originalExit = process.exit.bind(process)
    let exitCode: number | undefined
    ;(process as any).exit = (code: number) => {
      exitCode = code
      throw new Error(`process.exit(${code})`)
    }
    try {
      assertGuardrails(env)
    } catch {
      // expected
    } finally {
      ;(process as any).exit = originalExit
    }
    expect(exitCode).toBe(1)
  })

  test("fails when any DEBUG_FORCE_* var is set", () => {
    const env: Record<string, string | undefined> = {
      DEBUG_FORCE_BEAT_PASS: "1",
    }
    const originalExit = process.exit.bind(process)
    let exitCode: number | undefined
    ;(process as any).exit = (code: number) => {
      exitCode = code
      throw new Error(`process.exit(${code})`)
    }
    try {
      assertGuardrails(env)
    } catch {
      // expected
    } finally {
      ;(process as any).exit = originalExit
    }
    expect(exitCode).toBe(1)
  })

  test("fails when multiple violations are present", () => {
    const env: Record<string, string | undefined> = {
      WRITER_MODEL_OVERRIDE: "foo",
      STYLE_PRIMER: "bar",
      DEBUG_FORCE_WHATEVER: "1",
    }
    const originalExit = process.exit.bind(process)
    let exitCode: number | undefined
    ;(process as any).exit = (code: number) => {
      exitCode = code
      throw new Error(`process.exit(${code})`)
    }
    try {
      assertGuardrails(env)
    } catch {
      // expected
    } finally {
      ;(process as any).exit = originalExit
    }
    expect(exitCode).toBe(1)
  })

  test("passes with unrelated env vars set (DEBUG_ prefix without FORCE_)", () => {
    const env: Record<string, string | undefined> = {
      DEBUG_VERBOSE: "1",
      NODE_ENV: "test",
    }
    // Should not throw or call process.exit
    expect(() => assertGuardrails(env)).not.toThrow()
  })
})

// ── shufflePair (from judge) — determinism check ──────────────────────────────

function makePairRow(overrides: Partial<PairRow> = {}): PairRow {
  return {
    pair_id: "test-pair-replay-001",
    pov_character: "Kael",
    characters_present: ["Kael", "Mira"],
    beat_description: "A tense confrontation at the gate.",
    arm_a_prose: "Prose from the fixed arm, many words here.",
    arm_b_prose: "Prose from the rotation arm, many words here.",
    arm_a_label: "fixed",
    arm_b_label: "rotation",
    ...overrides,
  }
}

describe("shufflePair — determinism across replay runner", () => {
  test("same seed + pair_id produces the same A/B assignment every time", () => {
    const pair = makePairRow()
    const seed = "conditioning-floor-v1-replay"

    const r1 = shufflePair(pair, seed)
    const r2 = shufflePair(pair, seed)
    const r3 = shufflePair(pair, seed)

    expect(r1.shuffled_a_label).toBe(r2.shuffled_a_label)
    expect(r1.shuffled_a_label).toBe(r3.shuffled_a_label)
    expect(r1.prose_a).toBe(r2.prose_a)
  })

  test("different pair_ids produce at least one swap across 20 pairs", () => {
    const seed = "conditioning-floor-v1-replay"
    const aLabels = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const pair = makePairRow({ pair_id: `replay-pair-${i}` })
      aLabels.add(shufflePair(pair, seed).shuffled_a_label)
    }
    expect(aLabels.has("fixed")).toBe(true)
    expect(aLabels.has("rotation")).toBe(true)
  })

  test("shuffle always returns both original labels across positions", () => {
    const pair = makePairRow()
    for (let i = 0; i < 10; i++) {
      const result = shufflePair(pair, `test-seed-${i}`)
      expect(new Set([result.shuffled_a_label, result.shuffled_b_label])).toEqual(
        new Set(["fixed", "rotation"])
      )
    }
  })
})

// ── Three-arm loss encoding ───────────────────────────────────────────────────

function makeReplayTriplet(overrides: Partial<ReplayTriplet> = {}): ReplayTriplet {
  return {
    pair_id: "test-triplet-001",
    pov_character: "Kael",
    characters_present: ["Kael", "Mira"],
    beat_description: "A tense confrontation.",
    raw_prose: "This is the raw arm prose with enough words to pass the minimum word gate.",
    fixed_prose: "This is the fixed arm prose with enough words to pass the minimum word gate.",
    rotation_prose: "This is the rotation arm prose with enough words to pass the minimum word gate.",
    words_raw: 15,
    words_fixed: 15,
    words_rotation: 15,
    http_attempts_raw: 1,
    http_attempts_fixed: 1,
    http_attempts_rotation: 1,
    loss_raw: false,
    loss_fixed: false,
    loss_rotation: false,
    cost_usd: 0.001,
    ...overrides,
  }
}

describe("three-arm loss encoding — triplet fan-out", () => {
  test("valid triplet produces three clean PairRows with no loss flags", () => {
    const triplet = makeReplayTriplet()
    const fvr = tripletToFixedVsRotation(triplet)
    const rvr = tripletToRawVsRotation(triplet)
    const rvf = tripletToRawVsFixed(triplet)

    expect(fvr.loss_a).toBeUndefined()
    expect(fvr.loss_b).toBeUndefined()
    expect(rvr.loss_a).toBeUndefined()
    expect(rvr.loss_b).toBeUndefined()
    expect(rvf.loss_a).toBeUndefined()
    expect(rvf.loss_b).toBeUndefined()
  })

  test("fixed-vs-rotation: arm_a=fixed, arm_b=rotation", () => {
    const triplet = makeReplayTriplet()
    const row = tripletToFixedVsRotation(triplet)
    expect(row.arm_a_label).toBe("fixed")
    expect(row.arm_b_label).toBe("rotation")
    expect(row.arm_a_prose).toBe(triplet.fixed_prose)
    expect(row.arm_b_prose).toBe(triplet.rotation_prose)
  })

  test("raw-vs-rotation: arm_a=raw, arm_b=rotation", () => {
    const triplet = makeReplayTriplet()
    const row = tripletToRawVsRotation(triplet)
    expect(row.arm_a_label).toBe("raw")
    expect(row.arm_b_label).toBe("rotation")
    expect(row.arm_a_prose).toBe(triplet.raw_prose)
    expect(row.arm_b_prose).toBe(triplet.rotation_prose)
  })

  test("raw-vs-fixed: arm_a=raw, arm_b=fixed", () => {
    const triplet = makeReplayTriplet()
    const row = tripletToRawVsFixed(triplet)
    expect(row.arm_a_label).toBe("raw")
    expect(row.arm_b_label).toBe("fixed")
    expect(row.arm_a_prose).toBe(triplet.raw_prose)
    expect(row.arm_b_prose).toBe(triplet.fixed_prose)
  })

  test("loss_raw=true → raw-vs-rotation has loss_a=true, raw-vs-fixed has loss_a=true, fixed-vs-rotation unaffected", () => {
    const triplet = makeReplayTriplet({ loss_raw: true, words_raw: 3 })
    const fvr = tripletToFixedVsRotation(triplet)
    const rvr = tripletToRawVsRotation(triplet)
    const rvf = tripletToRawVsFixed(triplet)

    // fixed-vs-rotation: raw arm not involved
    expect(fvr.loss_a).toBeUndefined()
    expect(fvr.loss_b).toBeUndefined()

    // raw-vs-rotation: arm_a=raw → loss_a=true
    expect(rvr.loss_a).toBe(true)
    expect(rvr.loss_b).toBeUndefined()

    // raw-vs-fixed: arm_a=raw → loss_a=true
    expect(rvf.loss_a).toBe(true)
    expect(rvf.loss_b).toBeUndefined()
  })

  test("loss_fixed=true → fixed-vs-rotation has loss_a=true, raw-vs-fixed has loss_b=true, raw-vs-rotation unaffected", () => {
    const triplet = makeReplayTriplet({ loss_fixed: true, words_fixed: 5 })
    const fvr = tripletToFixedVsRotation(triplet)
    const rvr = tripletToRawVsRotation(triplet)
    const rvf = tripletToRawVsFixed(triplet)

    // fixed-vs-rotation: arm_a=fixed → loss_a=true
    expect(fvr.loss_a).toBe(true)
    expect(fvr.loss_b).toBeUndefined()

    // raw-vs-rotation: fixed arm not involved
    expect(rvr.loss_a).toBeUndefined()
    expect(rvr.loss_b).toBeUndefined()

    // raw-vs-fixed: arm_b=fixed → loss_b=true
    expect(rvf.loss_a).toBeUndefined()
    expect(rvf.loss_b).toBe(true)
  })

  test("loss_rotation=true → fixed-vs-rotation has loss_b=true, raw-vs-rotation has loss_b=true, raw-vs-fixed unaffected", () => {
    const triplet = makeReplayTriplet({ loss_rotation: true, words_rotation: 2 })
    const fvr = tripletToFixedVsRotation(triplet)
    const rvr = tripletToRawVsRotation(triplet)
    const rvf = tripletToRawVsFixed(triplet)

    // fixed-vs-rotation: arm_b=rotation → loss_b=true
    expect(fvr.loss_a).toBeUndefined()
    expect(fvr.loss_b).toBe(true)

    // raw-vs-rotation: arm_b=rotation → loss_b=true
    expect(rvr.loss_a).toBeUndefined()
    expect(rvr.loss_b).toBe(true)

    // raw-vs-fixed: rotation arm not involved
    expect(rvf.loss_a).toBeUndefined()
    expect(rvf.loss_b).toBeUndefined()
  })

  test("all arms lost → all three pair sets have both loss flags set", () => {
    const triplet = makeReplayTriplet({
      loss_raw: true,
      loss_fixed: true,
      loss_rotation: true,
      words_raw: 0,
      words_fixed: 0,
      words_rotation: 0,
      error_text: "all arms failed",
    })
    const fvr = tripletToFixedVsRotation(triplet)
    const rvr = tripletToRawVsRotation(triplet)
    const rvf = tripletToRawVsFixed(triplet)

    expect(fvr.loss_a).toBe(true)
    expect(fvr.loss_b).toBe(true)
    expect(rvr.loss_a).toBe(true)
    expect(rvr.loss_b).toBe(true)
    expect(rvf.loss_a).toBe(true)
    expect(rvf.loss_b).toBe(true)

    // All three rows carry the error text
    expect(fvr.error_text).toContain("all arms failed")
    expect(rvr.error_text).toContain("all arms failed")
    expect(rvf.error_text).toContain("all arms failed")
  })

  test("backward-compat aliases: loss_fixed/loss_rotation set on fixed-vs-rotation row", () => {
    // fixed-vs-rotation rows carry the old aliases so old judge code still works
    const triplet = makeReplayTriplet({ loss_fixed: true, loss_rotation: false })
    const row = tripletToFixedVsRotation(triplet)
    // New fields
    expect(row.loss_a).toBe(true)
    expect(row.loss_b).toBeUndefined()
    // Backward compat aliases
    expect(row.loss_fixed).toBe(true)
    expect(row.loss_rotation).toBeUndefined()
  })

  test("http_attempts flow through to pair rows", () => {
    const triplet = makeReplayTriplet({
      http_attempts_raw: 1,
      http_attempts_fixed: 1,
      http_attempts_rotation: 1,
    })
    const rvr = tripletToRawVsRotation(triplet)
    expect(rvr.http_attempts_a).toBe(1)
    expect(rvr.http_attempts_b).toBe(1)
  })

  test("http_attempts zero (error arm) are omitted (undefined) in pair rows", () => {
    const triplet = makeReplayTriplet({
      http_attempts_raw: 0,
      loss_raw: true,
    })
    const rvr = tripletToRawVsRotation(triplet)
    // 0 is falsy → stripped to undefined
    expect(rvr.http_attempts_a).toBeUndefined()
  })
})

// ── env-var switching — raw arm deletes WRITER_CONDITIONING ──────────────────

describe("env-var switching — raw arm semantics", () => {
  test("raw arm label produces a pair row with arm_a_label='raw'", () => {
    const triplet = makeReplayTriplet({ raw_prose: "Some raw prose content here." })
    const row = tripletToRawVsRotation(triplet)
    expect(row.arm_a_label).toBe("raw")
    expect(row.arm_a_prose).toBe("Some raw prose content here.")
  })

  test("raw arm is distinct from fixed and rotation arms in the triplet structure", () => {
    const triplet = makeReplayTriplet({
      raw_prose: "RAW",
      fixed_prose: "FIXED",
      rotation_prose: "ROTATION",
    })
    const fvr = tripletToFixedVsRotation(triplet)
    const rvr = tripletToRawVsRotation(triplet)
    const rvf = tripletToRawVsFixed(triplet)

    // Each pair set has the correct prose in each slot
    expect(fvr.arm_a_prose).toBe("FIXED")
    expect(fvr.arm_b_prose).toBe("ROTATION")
    expect(rvr.arm_a_prose).toBe("RAW")
    expect(rvr.arm_b_prose).toBe("ROTATION")
    expect(rvf.arm_a_prose).toBe("RAW")
    expect(rvf.arm_b_prose).toBe("FIXED")
  })
})

// ── Three JSONL output shape ──────────────────────────────────────────────────

describe("three JSONL output shape — PairRow contract", () => {
  test("all three fan-out rows have required PairRow fields", () => {
    const triplet = makeReplayTriplet()
    for (const row of [
      tripletToFixedVsRotation(triplet),
      tripletToRawVsRotation(triplet),
      tripletToRawVsFixed(triplet),
    ]) {
      expect(typeof row.pair_id).toBe("string")
      expect(typeof row.pov_character).toBe("string")
      expect(Array.isArray(row.characters_present)).toBe(true)
      expect(typeof row.beat_description).toBe("string")
      expect(typeof row.arm_a_prose).toBe("string")
      expect(typeof row.arm_b_prose).toBe("string")
      expect(typeof row.arm_a_label).toBe("string")
      expect(typeof row.arm_b_label).toBe("string")
    }
  })

  test("pair_id is consistent across all three pair sets for the same triplet", () => {
    const triplet = makeReplayTriplet({ pair_id: "novel-ch1-b3" })
    const fvr = tripletToFixedVsRotation(triplet)
    const rvr = tripletToRawVsRotation(triplet)
    const rvf = tripletToRawVsFixed(triplet)
    expect(fvr.pair_id).toBe("novel-ch1-b3")
    expect(rvr.pair_id).toBe("novel-ch1-b3")
    expect(rvf.pair_id).toBe("novel-ch1-b3")
  })
})

// ── Word-count loss encoding (legacy shape compat) ────────────────────────────

describe("word-count loss encoding — legacy test compat", () => {
  function makeReplayRow(overrides: Partial<ReplayPairRow> = {}): ReplayPairRow {
    return {
      pair_id: "test-replay-pair",
      pov_character: "Kael",
      characters_present: ["Kael", "Mira"],
      beat_description: "A tense confrontation.",
      arm_a_prose: "",
      arm_b_prose: "",
      arm_a_label: "fixed",
      arm_b_label: "rotation",
      ...overrides,
    }
  }

  test("loss_a is true when arm_a prose is below minWords", () => {
    const row = makeReplayRow({
      arm_a_prose: "Short.",
      words_a: 1,
      loss_a: true,
    })
    expect(row.loss_a).toBe(true)
    expect(row.arm_a_prose).toBeTruthy()
  })

  test("loss_b is true when arm_b prose is below minWords", () => {
    const row = makeReplayRow({
      arm_b_prose: "Too short.",
      words_b: 2,
      loss_b: true,
    })
    expect(row.loss_b).toBe(true)
  })

  test("neither loss flag is set when both arms exceed minWords", () => {
    const row = makeReplayRow({
      arm_a_prose: "This is a sufficiently long piece of prose with many words in it.",
      arm_b_prose: "This is also a sufficiently long piece of prose with many words in it.",
      words_a: 13,
      words_b: 14,
    })
    expect(row.loss_a).toBeUndefined()
    expect(row.loss_b).toBeUndefined()
  })

  test("loss-encoded pairs retain the prose (judge can see what was produced)", () => {
    const row = makeReplayRow({
      arm_a_prose: "Too short.",
      arm_b_prose: "Also too short but has content.",
      words_a: 2,
      words_b: 6,
      loss_a: true,
      loss_b: true,
    })
    expect(row.arm_a_prose.length).toBeGreaterThan(0)
    expect(row.arm_b_prose.length).toBeGreaterThan(0)
  })

  test("error row has both loss flags and zero-length prose", () => {
    const row = makeReplayRow({
      arm_a_prose: "",
      arm_b_prose: "",
      words_a: 0,
      words_b: 0,
      loss_a: true,
      loss_b: true,
      error_text: "network timeout after 3 retries",
    })
    expect(row.loss_a).toBe(true)
    expect(row.loss_b).toBe(true)
    expect(row.error_text).toContain("timeout")
  })
})

// ── derivePriorBeatCoords ─────────────────────────────────────────────────────

describe("derivePriorBeatCoords — prior-beat lookup logic", () => {
  test("chapter 1 beat 0 → null (no prior beat)", () => {
    expect(derivePriorBeatCoords(1, 0, null)).toBeNull()
  })

  test("chapter 1 beat 0 → null even with priorChapterBeatCount set (impossible case handled gracefully)", () => {
    // chapter 1 has no prior chapter, so this is always null
    expect(derivePriorBeatCoords(1, 0, 5)).toBeNull()
  })

  test("chapter 2 beat 0 → null (no cross-chapter bridge, matches live drafting contract)", () => {
    // Codex round-5 blocker #4: live drafting only passes beatProses[bi-1]
    // within the same chapter. Chapter-openers receive NO transition bridge.
    const result = derivePriorBeatCoords(2, 0, 8)
    expect(result).toBeNull()
  })

  test("chapter 3 beat 0 → null (no cross-chapter bridge)", () => {
    const result = derivePriorBeatCoords(3, 0, 12)
    expect(result).toBeNull()
  })

  test("chapter 2 beat 0 ignores priorChapterBeatCount entirely (always null)", () => {
    expect(derivePriorBeatCoords(2, 0, 0)).toBeNull()
    expect(derivePriorBeatCoords(2, 0, null)).toBeNull()
    expect(derivePriorBeatCoords(2, 0, 50)).toBeNull()
  })

  test("chapter 1 beat 3 → chapter 1 beat 2 (same-chapter prior)", () => {
    const result = derivePriorBeatCoords(1, 3, null)
    expect(result).toEqual({ chapter: 1, beatIndex: 2 })
  })

  test("chapter 5 beat 7 → chapter 5 beat 6 (same-chapter prior)", () => {
    const result = derivePriorBeatCoords(5, 7, null)
    expect(result).toEqual({ chapter: 5, beatIndex: 6 })
  })

  test("chapter 4 beat 1 → chapter 4 beat 0 (same-chapter prior, priorChapterBeatCount irrelevant)", () => {
    // beat_index > 0 so we stay in the same chapter regardless of priorChapterBeatCount
    const result = derivePriorBeatCoords(4, 1, 99)
    expect(result).toEqual({ chapter: 4, beatIndex: 0 })
  })
})
