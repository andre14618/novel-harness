import { describe, expect, test } from "bun:test"
import {
  assertGuardrails,
  derivePriorBeatCoords,
  type ReplayPairRow,
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

// ── Word-count loss encoding ───────────────────────────────────────────────────

describe("word-count loss encoding", () => {
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

  test("loss_fixed is true when fixed arm prose is below minWords", () => {
    const row = makeReplayRow({
      arm_a_prose: "Short.",
      words_fixed: 1,
      loss_fixed: true,
    })
    expect(row.loss_fixed).toBe(true)
    expect(row.arm_a_prose).toBeTruthy() // prose is present even with loss
  })

  test("loss_rotation is true when rotation arm prose is below minWords", () => {
    const row = makeReplayRow({
      arm_b_prose: "Too short.",
      words_rotation: 2,
      loss_rotation: true,
    })
    expect(row.loss_rotation).toBe(true)
  })

  test("neither loss flag is set when both arms exceed minWords", () => {
    const row = makeReplayRow({
      arm_a_prose: "This is a sufficiently long piece of prose with many words in it.",
      arm_b_prose: "This is also a sufficiently long piece of prose with many words in it.",
      words_fixed: 13,
      words_rotation: 14,
      // loss_fixed and loss_rotation not set
    })
    expect(row.loss_fixed).toBeUndefined()
    expect(row.loss_rotation).toBeUndefined()
  })

  test("loss-encoded pairs retain the prose (judge can see what was produced)", () => {
    const row = makeReplayRow({
      arm_a_prose: "Too short.",
      arm_b_prose: "Also too short but has content.",
      words_fixed: 2,
      words_rotation: 6,
      loss_fixed: true,
      loss_rotation: true,
    })
    // Prose is still present — judge sees it but counts it as a loss
    expect(row.arm_a_prose.length).toBeGreaterThan(0)
    expect(row.arm_b_prose.length).toBeGreaterThan(0)
  })

  test("error row has both loss flags and zero-length prose", () => {
    const row = makeReplayRow({
      arm_a_prose: "",
      arm_b_prose: "",
      words_fixed: 0,
      words_rotation: 0,
      loss_fixed: true,
      loss_rotation: true,
      error_text: "network timeout after 3 retries",
    })
    expect(row.loss_fixed).toBe(true)
    expect(row.loss_rotation).toBe(true)
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

  test("chapter 2 beat 0 → last beat of chapter 1", () => {
    // chapter 1 has 8 beats (indices 0..7), so last is index 7
    const result = derivePriorBeatCoords(2, 0, 8)
    expect(result).toEqual({ chapter: 1, beatIndex: 7 })
  })

  test("chapter 3 beat 0 → last beat of chapter 2", () => {
    const result = derivePriorBeatCoords(3, 0, 12)
    expect(result).toEqual({ chapter: 2, beatIndex: 11 })
  })

  test("chapter 2 beat 0 with priorChapterBeatCount=0 → null", () => {
    // Prior chapter had no beats — treat as no prior
    expect(derivePriorBeatCoords(2, 0, 0)).toBeNull()
  })

  test("chapter 2 beat 0 with priorChapterBeatCount=null → null", () => {
    // Prior chapter outline missing — treat as no prior
    expect(derivePriorBeatCoords(2, 0, null)).toBeNull()
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
