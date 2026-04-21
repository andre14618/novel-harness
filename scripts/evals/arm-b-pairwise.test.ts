import { describe, test, expect } from "bun:test"
import { computePairwiseVerdict, parsePairwiseLabelsTsv } from "./arm-b-pairwise"

// ── computePairwiseVerdict ───────────────────────────────────────────

describe("computePairwiseVerdict — INCONCLUSIVE precedence (retest flips evaluated first)", () => {
  test("≥2/4 retest flips → INCONCLUSIVE even with clean B decisive win", () => {
    const v = computePairwiseVerdict(4, 16, 0, 2, 4)
    expect(v.verdict).toBe("INCONCLUSIVE")
    expect(v.reason).toContain("position bias")
  })
  test("1/4 retest flip still allows a verdict", () => {
    const v = computePairwiseVerdict(4, 15, 1, 1, 4)
    expect(v.verdict).toBe("GO")
  })
  test("0 retests (edge case) cannot trigger INCONCLUSIVE", () => {
    const v = computePairwiseVerdict(15, 5, 0, 0, 0)
    expect(v.verdict).not.toBe("INCONCLUSIVE")
  })
})

describe("computePairwiseVerdict — decisive-pair thresholds at N_primary=20 (ties excluded)", () => {
  test("B wins 15/20 decisive, 0 ties → GO (exact p ≈ 0.021)", () => {
    const v = computePairwiseVerdict(5, 15, 0, 0, 4)
    expect(v.verdict).toBe("GO")
    expect(v.decisive_pairs).toBe(20)
  })
  test("B wins 14/20 decisive, 0 ties → CAUTION (p ≈ 0.058, above 0.025)", () => {
    const v = computePairwiseVerdict(6, 14, 0, 0, 4)
    expect(v.verdict).toBe("CAUTION")
    expect(v.reason).toContain("middle range")
  })
  test("B wins 14/14 decisive with 6 ties → GO (14/14 far above 11-threshold at N_decisive=14)", () => {
    // Ties excluded: decisive=14, threshold at 14 = 11. 14 ≥ 11.
    const v = computePairwiseVerdict(0, 14, 6, 0, 4)
    expect(v.verdict).toBe("GO")
    expect(v.decisive_pairs).toBe(14)
  })
  test("A wins 15/20 decisive → NO-GO", () => {
    const v = computePairwiseVerdict(15, 5, 0, 0, 4)
    expect(v.verdict).toBe("NO-GO")
  })
  test("10/10 split, 0 ties → CAUTION (symmetric null)", () => {
    const v = computePairwiseVerdict(10, 10, 0, 0, 4)
    expect(v.verdict).toBe("CAUTION")
  })
})

describe("computePairwiseVerdict — ties excluded from denominator (blocker #1 fix)", () => {
  test("ties do NOT count as 0.5-each in win computation", () => {
    // Previously: 8 A + 8 B + 4 ties → a_score=10, b_score=10, would have been CAUTION at 10/20
    // Now: decisive=16, threshold at 16 = 12. Neither A nor B hits 12 → CAUTION on decisive grounds.
    const v = computePairwiseVerdict(8, 8, 4, 0, 4)
    expect(v.verdict).toBe("CAUTION")
    expect(v.decisive_pairs).toBe(16)
  })
  test("many ties → underpowered CAUTION even if decisive ratio looks strong", () => {
    // 4 B wins, 2 A wins, 14 ties. Decisive=6, min_decisive at N_primary=20 is ceil(0.70*20)=14.
    // 6 < 14 → underpowered → CAUTION per the MIN_DECISIVE_FRACTION gate.
    const v = computePairwiseVerdict(2, 4, 14, 0, 4)
    expect(v.verdict).toBe("CAUTION")
    expect(v.reason).toContain("underpowered")
  })
})

describe("computePairwiseVerdict — threshold table correctness vs exact binomial", () => {
  test("N_decisive=10 requires 9 wins (p ≈ 0.011)", () => {
    expect(computePairwiseVerdict(1, 9, 0, 0, 4).verdict).toBe("GO")
    expect(computePairwiseVerdict(2, 8, 0, 0, 4).verdict).toBe("CAUTION")
  })
  test("N_decisive=20 requires 15 wins (p ≈ 0.021)", () => {
    expect(computePairwiseVerdict(5, 15, 0, 0, 4).verdict).toBe("GO")
    expect(computePairwiseVerdict(6, 14, 0, 0, 4).verdict).toBe("CAUTION")
  })
  test("N_decisive=30 requires 21 wins (p ≈ 0.021)", () => {
    expect(computePairwiseVerdict(9, 21, 0, 0, 4).verdict).toBe("GO")
    expect(computePairwiseVerdict(10, 20, 0, 0, 4).verdict).toBe("CAUTION")
  })
  test("N_decisive=40 requires 27 wins (p ≈ 0.019)", () => {
    expect(computePairwiseVerdict(13, 27, 0, 0, 4).verdict).toBe("GO")
    expect(computePairwiseVerdict(14, 26, 0, 0, 4).verdict).toBe("CAUTION")
  })
})

describe("computePairwiseVerdict — precedence: INCONCLUSIVE beats all others", () => {
  test("clean GO becomes INCONCLUSIVE when retest flips ≥ 2", () => {
    const v = computePairwiseVerdict(5, 15, 0, 2, 4)
    expect(v.verdict).toBe("INCONCLUSIVE")
  })
  test("clean NO-GO becomes INCONCLUSIVE when retest flips ≥ 2", () => {
    const v = computePairwiseVerdict(15, 5, 0, 2, 4)
    expect(v.verdict).toBe("INCONCLUSIVE")
  })
})

// ── parsePairwiseLabelsTsv ───────────────────────────────────────────

describe("parsePairwiseLabelsTsv", () => {
  test("parses the three valid label forms", () => {
    const tsv = [
      "packet_id\tlabel\tnotes",
      "a\tVERSION-1-WINS\tcleaner voice",
      "b\tVERSION-2-WINS\t",
      "c\tTIE\tgenuinely equivalent",
    ].join("\n")
    const out = parsePairwiseLabelsTsv(tsv)
    expect(out).toHaveLength(3)
    expect(out[0].label).toBe("VERSION-1-WINS")
    expect(out[0].notes).toBe("cleaner voice")
    expect(out[1].label).toBe("VERSION-2-WINS")
    expect(out[2].label).toBe("TIE")
  })
  test("normalizes lowercase + spaces to canonical form", () => {
    const tsv = "packet_id\tlabel\tnotes\nabc\tversion 1 wins\t"
    const out = parsePairwiseLabelsTsv(tsv)
    expect(out[0].label).toBe("VERSION-1-WINS")
  })
  test("empty label string preserved (used to detect unfilled rows)", () => {
    const tsv = "packet_id\tlabel\tnotes\nabc\t\t"
    const out = parsePairwiseLabelsTsv(tsv)
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe("")
  })
  test("invalid label values skipped", () => {
    const tsv = [
      "packet_id\tlabel\tnotes",
      "abc\tMAYBE\t",
      "def\tTIE\t",
    ].join("\n")
    const out = parsePairwiseLabelsTsv(tsv)
    expect(out).toHaveLength(1)
    expect(out[0].packet_id).toBe("def")
  })
  test("handles missing trailing columns", () => {
    const tsv = "packet_id\tlabel\tnotes\nabc\tTIE"
    const out = parsePairwiseLabelsTsv(tsv)
    expect(out).toHaveLength(1)
    expect(out[0].notes).toBe("")
  })
})
