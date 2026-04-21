import { describe, test, expect } from "bun:test"
import { computePairwiseVerdict, parsePairwiseLabelsTsv } from "./arm-b-pairwise"

// ── computePairwiseVerdict ───────────────────────────────────────────

describe("computePairwiseVerdict — INCONCLUSIVE precedence (retest flips evaluated first)", () => {
  test("≥2/4 retest flips → INCONCLUSIVE even with clean B win", () => {
    const v = computePairwiseVerdict(4, 16, 0, 2, 4)
    expect(v.verdict).toBe("INCONCLUSIVE")
    expect(v.reason).toContain("position bias")
  })
  test("1/4 retest flip still allows a verdict", () => {
    const v = computePairwiseVerdict(4, 14, 2, 1, 4)
    expect(v.verdict).toBe("GO")
  })
  test("0 retests (edge case) cannot trigger INCONCLUSIVE", () => {
    const v = computePairwiseVerdict(14, 6, 0, 0, 0)
    expect(v.verdict).not.toBe("INCONCLUSIVE")
  })
})

describe("computePairwiseVerdict — band outcomes at N=20", () => {
  test("B wins 14/20 → GO", () => {
    const v = computePairwiseVerdict(6, 14, 0, 0, 4)
    expect(v.verdict).toBe("GO")
    expect(v.b_score).toBe(14)
  })
  test("B wins 15/20 → GO", () => {
    const v = computePairwiseVerdict(5, 15, 0, 0, 4)
    expect(v.verdict).toBe("GO")
  })
  test("B wins 13/20 → CAUTION (below threshold)", () => {
    const v = computePairwiseVerdict(7, 13, 0, 0, 4)
    expect(v.verdict).toBe("CAUTION")
  })
  test("A wins 14/20 → NO-GO", () => {
    const v = computePairwiseVerdict(14, 6, 0, 0, 4)
    expect(v.verdict).toBe("NO-GO")
  })
  test("10/10 split → CAUTION (symmetric null)", () => {
    const v = computePairwiseVerdict(10, 10, 0, 0, 4)
    expect(v.verdict).toBe("CAUTION")
  })
  test("ties contribute to score as 0.5 per arm", () => {
    const v = computePairwiseVerdict(8, 8, 4, 0, 4)
    expect(v.a_score).toBe(10)
    expect(v.b_score).toBe(10)
    expect(v.verdict).toBe("CAUTION")
  })
})

describe("computePairwiseVerdict — win-threshold scales with N", () => {
  test("at N=10, threshold is 7 (ceil(0.7*10))", () => {
    const v = computePairwiseVerdict(3, 7, 0, 0, 4)
    expect(v.verdict).toBe("GO")
  })
  test("at N=10, 6/10 is below threshold", () => {
    const v = computePairwiseVerdict(4, 6, 0, 0, 4)
    expect(v.verdict).toBe("CAUTION")
  })
  test("at N=40, threshold is 28", () => {
    const v = computePairwiseVerdict(12, 28, 0, 0, 4)
    expect(v.verdict).toBe("GO")
  })
  test("at N=40, 27/40 is CAUTION", () => {
    const v = computePairwiseVerdict(13, 27, 0, 0, 4)
    expect(v.verdict).toBe("CAUTION")
  })
})

describe("computePairwiseVerdict — INCONCLUSIVE beats NO-GO and GO in precedence", () => {
  test("B wins 14/20 AND retest flips ≥2 → INCONCLUSIVE (not GO)", () => {
    const v = computePairwiseVerdict(6, 14, 0, 2, 4)
    expect(v.verdict).toBe("INCONCLUSIVE")
  })
  test("A wins 14/20 AND retest flips ≥2 → INCONCLUSIVE (not NO-GO)", () => {
    const v = computePairwiseVerdict(14, 6, 0, 2, 4)
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
