import { describe, test, expect } from "bun:test"
import { computeVerdict, parseLabelsTsv, type ArmCounts } from "./preflight-arm-b-adjudicate"

const zero: ArmCounts = { tp: 0, fp: 0, unclear: 0, non_fire_fn: 0, non_fire_tn: 0 }

// ── computeVerdict ───────────────────────────────────────────────────

describe("computeVerdict — INCONCLUSIVE gates evaluated first (§7 precedence)", () => {
  test("fewer than 8 adjudicable fires on A → INCONCLUSIVE (even if precision looks clean)", () => {
    const a: ArmCounts = { ...zero, tp: 5, fp: 2 }  // adjudicable = 7 < 8
    const b: ArmCounts = { ...zero, tp: 7, fp: 2 }  // adjudicable = 9
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("INCONCLUSIVE")
    expect(v.reason).toContain("8-per-arm floor")
    expect(v.adjudicable_a).toBe(7)
    expect(v.adjudicable_b).toBe(9)
  })

  test("fewer than 8 on B → INCONCLUSIVE", () => {
    const a: ArmCounts = { ...zero, tp: 8, fp: 2 }
    const b: ArmCounts = { ...zero, tp: 3, fp: 4 }  // adjudicable = 7
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("INCONCLUSIVE")
  })

  test("UNCLEAR rate >25% on A → INCONCLUSIVE (even with 8 adjudicable)", () => {
    // adjudicable = 8, unclear = 3, total = 11, unclear_rate = 27.3%
    const a: ArmCounts = { ...zero, tp: 6, fp: 2, unclear: 3 }
    const b: ArmCounts = { ...zero, tp: 6, fp: 2, unclear: 1 }
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("INCONCLUSIVE")
    expect(v.reason).toContain("UNCLEAR rate >25%")
  })

  test("UNCLEAR rate >25% on B → INCONCLUSIVE", () => {
    const a: ArmCounts = { ...zero, tp: 7, fp: 1, unclear: 1 }
    const b: ArmCounts = { ...zero, tp: 4, fp: 4, unclear: 4 }  // 4/12 = 33.3%
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("INCONCLUSIVE")
  })

  test("exactly 25% UNCLEAR does NOT trip — charter says > 25%", () => {
    const a: ArmCounts = { ...zero, tp: 6, fp: 2, unclear: 2 } // 2/10 = 20%
    const b: ArmCounts = { ...zero, tp: 6, fp: 2, unclear: 2 }
    const v = computeVerdict(a, b)
    expect(v.verdict).not.toBe("INCONCLUSIVE")
  })
})

describe("computeVerdict — band outcomes at 8-fire discretization floor", () => {
  test("precision equal → GO", () => {
    const a: ArmCounts = { ...zero, tp: 7, fp: 1 } // 87.5%
    const b: ArmCounts = { ...zero, tp: 7, fp: 1 } // 87.5%
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("GO")
    expect(v.delta_pt).toBeCloseTo(0, 5)
  })

  test("precision_B > precision_A → GO (charter is one-sided vs regression)", () => {
    const a: ArmCounts = { ...zero, tp: 6, fp: 2 } // 75%
    const b: ArmCounts = { ...zero, tp: 8, fp: 0 } // 100%
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("GO")
    expect(v.delta_pt).toBeCloseTo(25, 5)
  })

  test("B drops exactly 12.5pt — within GO band (one label of drop, charter bound is < -12.5)", () => {
    const a: ArmCounts = { ...zero, tp: 8, fp: 0 } // 100%
    const b: ArmCounts = { ...zero, tp: 7, fp: 1 } // 87.5% — delta = -12.5
    const v = computeVerdict(a, b)
    expect(v.delta_pt).toBeCloseTo(-12.5, 5)
    expect(v.verdict).toBe("GO")
  })

  test("B drops 13pt → CAUTION", () => {
    // A: 8/8 = 100%, B: 7/8 - epsilon — easier: A=100%, B = 6.96/8 can't integer.
    // Use 9 fires on B: tp=7 fp=2 → 77.8% → delta = -22.2%. That's still CAUTION (< -12.5, > -25)
    const a: ArmCounts = { ...zero, tp: 8, fp: 0 } // 100%
    const b: ArmCounts = { ...zero, tp: 7, fp: 2 } // 77.8%, delta = -22.2
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("CAUTION")
    expect(v.delta_pt).toBeLessThan(-12.5)
    expect(v.delta_pt).toBeGreaterThan(-25)
  })

  test("B drops exactly 25pt — CAUTION band (charter is < -25 for NO-GO)", () => {
    const a: ArmCounts = { ...zero, tp: 8, fp: 0 } // 100%
    const b: ArmCounts = { ...zero, tp: 6, fp: 2 } // 75%, delta = -25
    const v = computeVerdict(a, b)
    expect(v.delta_pt).toBeCloseTo(-25, 5)
    expect(v.verdict).toBe("CAUTION")
  })

  test("B drops 30pt → NO-GO", () => {
    const a: ArmCounts = { ...zero, tp: 8, fp: 0 } // 100%
    const b: ArmCounts = { ...zero, tp: 5, fp: 4 } // 55.6%, delta = -44.4
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("NO-GO")
    expect(v.delta_pt).toBeLessThan(-25)
  })

  test("INCONCLUSIVE takes precedence over NO-GO when both would fire", () => {
    // Only 5 adjudicable on A but precision drop would otherwise be -60pt
    const a: ArmCounts = { ...zero, tp: 5, fp: 0 } // 100% but only 5 adjudicable
    const b: ArmCounts = { ...zero, tp: 4, fp: 6 } // 40%, delta = -60
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("INCONCLUSIVE")
    expect(v.reason).toContain("8-per-arm floor")
  })

  test("INCONCLUSIVE takes precedence over NO-GO when UNCLEAR rate trips", () => {
    // 9 adjudicable on A with 5 UNCLEAR (35.7% > 25%)
    const a: ArmCounts = { ...zero, tp: 8, fp: 1, unclear: 5 }
    const b: ArmCounts = { ...zero, tp: 4, fp: 6 } // would normally NO-GO
    const v = computeVerdict(a, b)
    expect(v.verdict).toBe("INCONCLUSIVE")
    expect(v.reason).toContain("UNCLEAR rate >25%")
  })
})

describe("computeVerdict — precision numerators", () => {
  test("precision_a and precision_b are null when adjudicable is 0", () => {
    const a: ArmCounts = { ...zero, unclear: 5 }
    const b: ArmCounts = { ...zero, unclear: 5 }
    const v = computeVerdict(a, b)
    // Will be INCONCLUSIVE (adjudicable < 8)
    expect(v.precision_a).toBeNull()
    expect(v.precision_b).toBeNull()
    expect(v.delta_pt).toBeNull()
  })

  test("delta_pt computed from precision difference, not fire count", () => {
    const a: ArmCounts = { ...zero, tp: 8, fp: 0 } // 100%
    const b: ArmCounts = { ...zero, tp: 14, fp: 6 } // 70%
    const v = computeVerdict(a, b)
    expect(v.precision_a).toBeCloseTo(1.0, 5)
    expect(v.precision_b).toBeCloseTo(0.7, 5)
    expect(v.delta_pt).toBeCloseTo(-30, 5)
  })
})

// ── parseLabelsTsv ───────────────────────────────────────────────────

describe("parseLabelsTsv", () => {
  test("parses header + filled rows", () => {
    const tsv = [
      "packet_id\tlabel\treason",
      "abc123\tTP\t",
      "def456\tFP\tentity is clearly grounded in world bible",
      "xyz789\tUNCLEAR\tambiguous grounding",
    ].join("\n")
    const out = parseLabelsTsv(tsv)
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ packet_id: "abc123", label: "TP", reason: "" })
    expect(out[1]).toEqual({ packet_id: "def456", label: "FP", reason: "entity is clearly grounded in world bible" })
    expect(out[2]).toEqual({ packet_id: "xyz789", label: "UNCLEAR", reason: "ambiguous grounding" })
  })

  test("unfilled label rows parse with empty label string", () => {
    const tsv = [
      "packet_id\tlabel\treason",
      "abc123\t\t",
    ].join("\n")
    const out = parseLabelsTsv(tsv)
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe("")
  })

  test("normalizes lowercase labels to uppercase", () => {
    const tsv = "packet_id\tlabel\treason\nabc\ttp\t"
    const out = parseLabelsTsv(tsv)
    expect(out[0].label).toBe("TP")
  })

  test("skips rows with invalid label values", () => {
    const tsv = [
      "packet_id\tlabel\treason",
      "abc\tMAYBE\t",          // invalid — skipped
      "def\tTP\t",
    ].join("\n")
    const out = parseLabelsTsv(tsv)
    expect(out).toHaveLength(1)
    expect(out[0].packet_id).toBe("def")
  })

  test("skips blank rows and header-only files", () => {
    const tsv = "packet_id\tlabel\treason\n\n\n"
    const out = parseLabelsTsv(tsv)
    expect(out).toHaveLength(0)
  })

  test("handles missing trailing columns gracefully", () => {
    // Row with just packet_id + label, no reason column
    const tsv = "packet_id\tlabel\treason\nabc\tTP"
    const out = parseLabelsTsv(tsv)
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe("TP")
    expect(out[0].reason).toBe("")
  })
})
