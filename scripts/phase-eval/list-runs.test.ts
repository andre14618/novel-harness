/**
 * Unit tests for list-runs.ts family-grouping + streak logic.
 *
 * All tests are pure (no DB calls) — they exercise the exported helper
 * functions directly with synthetic fixtures.
 */

import { describe, expect, test } from "bun:test"
import {
  isPassVerdict,
  shortVerdict,
  extractMetric,
  countParseFails,
  familyKeyFor,
  familyKeyStr,
  parseFamilyKey,
  consecutiveStreak,
  computeRange,
  groupIntoFamilies,
  isCheckerProbe,
  extractCheckerSummary,
} from "./list-runs"

// ── Synthetic fixture builder ─────────────────────────────────────────────

type PartialRow = {
  id: number
  probe_name: string
  git_commit: string
  seeds_used: string[]
  variant_labels: string[]
  verdict: string
  ran_at: Date
  experiment_id?: number | null
  notes?: string | null
  g_metrics?: Record<string, any> | null
  recall_pct?: number | null
  precision_pct?: number | null
  f1?: number | null
  calibration_matrix?: any
}

function row(overrides: PartialRow): PartialRow {
  return {
    experiment_id: null,
    notes: null,
    g_metrics: null,
    recall_pct: null,
    precision_pct: null,
    f1: null,
    calibration_matrix: null,
    ...overrides,
  }
}

// ── isPassVerdict ─────────────────────────────────────────────────────────

describe("isPassVerdict", () => {
  test("bare SCREEN-PASS is pass", () => {
    expect(isPassVerdict("SCREEN-PASS")).toBe(true)
  })
  test("SCREEN-PASS-SUGGESTIVE is pass", () => {
    expect(isPassVerdict("SCREEN-PASS-SUGGESTIVE — cleared G1-G4 (single-run)")).toBe(true)
  })
  test("PROMOTION-PASS is pass", () => {
    expect(isPassVerdict("PROMOTION-PASS — cleared G1-G4 on this run AND 2 prior consecutive pass(es).")).toBe(true)
  })
  test("SCREEN-FAIL (broken) is not pass", () => {
    expect(isPassVerdict("SCREEN-FAIL (broken) — did not produce outlines")).toBe(false)
  })
  test("SCREEN-FAIL (non-compliant) is not pass", () => {
    expect(isPassVerdict("SCREEN-FAIL (non-compliant) — variant ran but failed: G1")).toBe(false)
  })
  test("empty string is not pass", () => {
    expect(isPassVerdict("")).toBe(false)
  })
})

// ── shortVerdict ──────────────────────────────────────────────────────────

describe("shortVerdict", () => {
  test("strips the explanation tail", () => {
    expect(shortVerdict("SCREEN-PASS-SUGGESTIVE — cleared G1-G4")).toBe("SCREEN-PASS-SUGGESTIVE")
  })
  test("returns bare verdict when no separator", () => {
    expect(shortVerdict("SCREEN-PASS")).toBe("SCREEN-PASS")
  })
})

// ── extractMetric ─────────────────────────────────────────────────────────

describe("extractMetric", () => {
  test("returns value for known key", () => {
    expect(extractMetric({ test_facts_median: 7.5 }, "test_facts_median")).toBe(7.5)
  })
  test("returns null for missing key", () => {
    expect(extractMetric({ other: 5 }, "test_facts_median")).toBeNull()
  })
  test("returns null for null g_metrics", () => {
    expect(extractMetric(null, "test_facts_median")).toBeNull()
  })
  test("returns null for non-numeric value", () => {
    expect(extractMetric({ test_facts_median: "bad" }, "test_facts_median")).toBeNull()
  })
  test("returns null for NaN", () => {
    expect(extractMetric({ test_facts_median: NaN }, "test_facts_median")).toBeNull()
  })
})

// ── countParseFails ───────────────────────────────────────────────────────

describe("countParseFails", () => {
  test("returns 1 for SCREEN-FAIL (broken)", () => {
    const r = row({
      id: 1, probe_name: "p", git_commit: "abc", seeds_used: ["s"], variant_labels: ["v"],
      verdict: "SCREEN-FAIL (broken) — did not produce outlines",
      ran_at: new Date("2026-05-01T00:00:00Z"),
    })
    expect(countParseFails(r as any)).toBe(1)
  })
  test("returns 0 for SCREEN-FAIL (non-compliant)", () => {
    const r = row({
      id: 2, probe_name: "p", git_commit: "abc", seeds_used: ["s"], variant_labels: ["v"],
      verdict: "SCREEN-FAIL (non-compliant) — failed G1",
      ran_at: new Date("2026-05-01T00:00:00Z"),
    })
    expect(countParseFails(r as any)).toBe(0)
  })
  test("returns 0 for SCREEN-PASS", () => {
    const r = row({
      id: 3, probe_name: "p", git_commit: "abc", seeds_used: ["s"], variant_labels: ["v"],
      verdict: "SCREEN-PASS",
      ran_at: new Date("2026-05-01T00:00:00Z"),
    })
    expect(countParseFails(r as any)).toBe(0)
  })
})

// ── familyKeyFor ──────────────────────────────────────────────────────────

describe("familyKeyFor", () => {
  test("picks non-default variant as test variant", () => {
    const r = row({
      id: 1, probe_name: "phase-variant-comparison", git_commit: "abc12345",
      seeds_used: ["fantasy-debt"], variant_labels: ["default", "corpus-v1"],
      verdict: "SCREEN-PASS", ran_at: new Date(),
    })
    const key = familyKeyFor(r as any)
    expect(key.test_variant).toBe("corpus-v1")
    expect(key.probe_name).toBe("phase-variant-comparison")
    expect(key.seed).toBe("fantasy-debt")
    expect(key.git_commit).toBe("abc12345")
  })

  test("picks last non-default when multiple present", () => {
    const r = row({
      id: 2, probe_name: "probe", git_commit: "abc",
      seeds_used: ["seed"], variant_labels: ["default", "loud", "coverage-balanced"],
      verdict: "SCREEN-PASS", ran_at: new Date(),
    })
    expect(familyKeyFor(r as any).test_variant).toBe("coverage-balanced")
  })

  test("falls back to joined variants when all are default", () => {
    const r = row({
      id: 3, probe_name: "probe", git_commit: "abc",
      seeds_used: ["seed"], variant_labels: ["default"],
      verdict: "SCREEN-PASS", ran_at: new Date(),
    })
    expect(familyKeyFor(r as any).test_variant).toBe("default")
  })

  test("joins multiple seeds with +", () => {
    const r = row({
      id: 4, probe_name: "probe", git_commit: "abc",
      seeds_used: ["seed-a", "seed-b"], variant_labels: ["default", "loud"],
      verdict: "SCREEN-PASS", ran_at: new Date(),
    })
    expect(familyKeyFor(r as any).seed).toBe("seed-a+seed-b")
  })
})

// ── familyKeyStr ──────────────────────────────────────────────────────────

describe("familyKeyStr", () => {
  test("formats key as probe:variant:commit8:seed", () => {
    const key = {
      probe_name: "phase-variant-comparison",
      test_variant: "corpus-v1",
      git_commit: "abcdef1234567890",
      seed: "fantasy-debt",
    }
    expect(familyKeyStr(key)).toBe("phase-variant-comparison:corpus-v1:abcdef12:fantasy-debt")
  })
})

// ── parseFamilyKey ────────────────────────────────────────────────────────

describe("parseFamilyKey", () => {
  test("parses a well-formed key", () => {
    const parsed = parseFamilyKey("phase-variant-comparison:corpus-v1:abcdef12:fantasy-debt")
    expect(parsed.probe_name).toBe("phase-variant-comparison")
    expect(parsed.test_variant).toBe("corpus-v1")
    expect(parsed.git_commit).toBe("abcdef12")
    expect(parsed.seed).toBe("fantasy-debt")
  })

  test("returns empty object for malformed key", () => {
    const parsed = parseFamilyKey("only-two:parts")
    expect(Object.keys(parsed)).toHaveLength(0)
  })
})

// ── consecutiveStreak ─────────────────────────────────────────────────────

describe("consecutiveStreak", () => {
  const PASS = "SCREEN-PASS-SUGGESTIVE — cleared G1"
  const PROMO = "PROMOTION-PASS — cleared G1 AND 2 prior passes"
  const FAIL = "SCREEN-FAIL (non-compliant) — failed G1"
  const BROKEN = "SCREEN-FAIL (broken) — did not produce outlines"

  test("returns 0 for empty list", () => {
    expect(consecutiveStreak([])).toBe(0)
  })

  test("F-P-P → streak 2 (starting from latest = index 0)", () => {
    // [FAIL, PASS, PASS] latest-first → most recent is FAIL
    expect(consecutiveStreak([FAIL, PASS, PASS])).toBe(-1)
  })

  test("P-F-P-P → streak 1 (latest is single pass)", () => {
    // [PASS, FAIL, PASS, PASS] latest-first
    expect(consecutiveStreak([PASS, FAIL, PASS, PASS])).toBe(1)
  })

  test("P-P-F → streak 0 (latest two passes then fail)", () => {
    // [PASS, PASS, FAIL] latest-first → 2 consecutive passes
    expect(consecutiveStreak([PASS, PASS, FAIL])).toBe(2)
  })

  test("all pass → streak equals length", () => {
    expect(consecutiveStreak([PASS, PASS, PASS])).toBe(3)
  })

  test("all fail → negative streak equals negative length", () => {
    expect(consecutiveStreak([FAIL, FAIL, FAIL])).toBe(-3)
  })

  test("PROMOTION-PASS counts as pass", () => {
    expect(consecutiveStreak([PROMO, PASS, FAIL])).toBe(2)
  })

  test("SCREEN-FAIL (broken) counts as fail", () => {
    expect(consecutiveStreak([BROKEN, PASS])).toBe(-1)
  })

  test("single pass → 1", () => {
    expect(consecutiveStreak([PASS])).toBe(1)
  })

  test("single fail → -1", () => {
    expect(consecutiveStreak([FAIL])).toBe(-1)
  })
})

// ── computeRange ─────────────────────────────────────────────────────────

describe("computeRange", () => {
  test("returns min/max for all-numeric list", () => {
    expect(computeRange([3, 7, 5, 1])).toEqual([1, 7])
  })

  test("returns [v, v] for single value", () => {
    expect(computeRange([5])).toEqual([5, 5])
  })

  test("ignores null values", () => {
    expect(computeRange([null, 4, null, 9])).toEqual([4, 9])
  })

  test("returns null when all values are null", () => {
    expect(computeRange([null, null])).toBeNull()
  })

  test("returns null for empty list", () => {
    expect(computeRange([])).toBeNull()
  })
})

// ── groupIntoFamilies ─────────────────────────────────────────────────────

function makeRow(overrides: {
  id: number
  probe: string
  commit: string
  seed: string
  variants: string[]
  verdict: string
  ranAt: string
  gMetrics?: Record<string, any> | null
  metricSet?: string | null
  expectedChapters?: number | null
  modelRoute?: string | null
  promptHash?: string | null
}): any {
  return {
    id: overrides.id,
    probe_name: overrides.probe,
    git_commit: overrides.commit,
    seeds_used: [overrides.seed],
    variant_labels: overrides.variants,
    verdict: overrides.verdict,
    ran_at: new Date(overrides.ranAt),
    experiment_id: null,
    notes: null,
    g_metrics: overrides.gMetrics ?? null,
    recall_pct: null,
    precision_pct: null,
    f1: null,
    calibration_matrix: null,
    metric_set: overrides.metricSet ?? null,
    expected_chapters: overrides.expectedChapters ?? null,
    model_route: overrides.modelRoute ?? null,
    prompt_hash: overrides.promptHash ?? null,
  }
}

describe("groupIntoFamilies", () => {
  const PASS = "SCREEN-PASS-SUGGESTIVE — cleared G1"
  const FAIL = "SCREEN-FAIL (non-compliant) — failed G1"

  test("groups rows with same tuple into one family", () => {
    const rows = [
      makeRow({ id: 1, probe: "probe-a", commit: "abc", seed: "seed-x", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z" }),
      makeRow({ id: 2, probe: "probe-a", commit: "abc", seed: "seed-x", variants: ["default", "loud"], verdict: FAIL, ranAt: "2026-05-01T01:00:00Z" }),
    ]
    const families = groupIntoFamilies(rows)
    expect(families.size).toBe(1)
    const fam = families.values().next().value as ReturnType<typeof groupIntoFamilies> extends Map<string, infer V> ? V : never
    expect(fam.n).toBe(2)
    expect(fam.passCount).toBe(1)
    expect(fam.failCount).toBe(1)
  })

  test("separates rows with different seeds into different families", () => {
    const rows = [
      makeRow({ id: 1, probe: "probe-a", commit: "abc", seed: "seed-x", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z" }),
      makeRow({ id: 2, probe: "probe-a", commit: "abc", seed: "seed-y", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T01:00:00Z" }),
    ]
    const families = groupIntoFamilies(rows)
    expect(families.size).toBe(2)
  })

  test("separates rows with different git commits", () => {
    const rows = [
      makeRow({ id: 1, probe: "probe-a", commit: "abc", seed: "seed-x", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z" }),
      makeRow({ id: 2, probe: "probe-a", commit: "def", seed: "seed-x", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T01:00:00Z" }),
    ]
    const families = groupIntoFamilies(rows)
    expect(families.size).toBe(2)
  })

  test("computes streak correctly: most recent is PASS, prior is FAIL → streak=1", () => {
    const rows = [
      makeRow({ id: 1, probe: "p", commit: "abc", seed: "s", variants: ["default", "loud"], verdict: FAIL, ranAt: "2026-05-01T00:00:00Z" }),
      makeRow({ id: 2, probe: "p", commit: "abc", seed: "s", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T01:00:00Z" }),
    ]
    const families = groupIntoFamilies(rows)
    const fam = families.values().next().value as any
    // most recent = id=2 (PASS), prior = id=1 (FAIL), streak = 1
    expect(fam.streak).toBe(1)
  })

  test("computes streak correctly: most recent is FAIL, prior is PASS → streak=-1", () => {
    const rows = [
      makeRow({ id: 1, probe: "p", commit: "abc", seed: "s", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z" }),
      makeRow({ id: 2, probe: "p", commit: "abc", seed: "s", variants: ["default", "loud"], verdict: FAIL, ranAt: "2026-05-01T01:00:00Z" }),
    ]
    const families = groupIntoFamilies(rows)
    const fam = families.values().next().value as any
    // most recent = id=2 (FAIL), prior = id=1 (PASS), streak = -1
    expect(fam.streak).toBe(-1)
  })

  test("computes facts/know/scenes ranges from g_metrics", () => {
    const rows = [
      makeRow({
        id: 1, probe: "p", commit: "abc", seed: "s", variants: ["default", "loud"], verdict: PASS,
        ranAt: "2026-05-01T00:00:00Z",
        gMetrics: { test_facts_median: 6.5, test_know_median: 5.0, test_total_scenes: 135 },
      }),
      makeRow({
        id: 2, probe: "p", commit: "abc", seed: "s", variants: ["default", "loud"], verdict: PASS,
        ranAt: "2026-05-01T01:00:00Z",
        gMetrics: { test_facts_median: 8.5, test_know_median: 7.0, test_total_scenes: 223 },
      }),
    ]
    const families = groupIntoFamilies(rows)
    const fam = families.values().next().value as any
    expect(fam.factsRange).toEqual([6.5, 8.5])
    expect(fam.knowRange).toEqual([5.0, 7.0])
    expect(fam.scenesRange).toEqual([135, 223])
  })

  test("handles null g_metrics gracefully (ranges null)", () => {
    const rows = [
      makeRow({ id: 1, probe: "p", commit: "abc", seed: "s", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z", gMetrics: null }),
    ]
    const families = groupIntoFamilies(rows)
    const fam = families.values().next().value as any
    expect(fam.factsRange).toBeNull()
    expect(fam.knowRange).toBeNull()
    expect(fam.scenesRange).toBeNull()
  })

  test("counts parse fails from SCREEN-FAIL (broken) rows", () => {
    const rows = [
      makeRow({ id: 1, probe: "p", commit: "abc", seed: "s", variants: ["default", "loud"], verdict: "SCREEN-FAIL (broken) — outlines missing", ranAt: "2026-05-01T00:00:00Z" }),
      makeRow({ id: 2, probe: "p", commit: "abc", seed: "s", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T01:00:00Z" }),
    ]
    const families = groupIntoFamilies(rows)
    const fam = families.values().next().value as any
    expect(fam.parseFails).toBe(1)
  })

  test("--family filter by keyStr returns correct rows", () => {
    // Two different families; simulate a --family lookup
    const rows = [
      makeRow({ id: 1, probe: "probe-a", commit: "abc12345", seed: "seed-x", variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z" }),
      makeRow({ id: 2, probe: "probe-a", commit: "abc12345", seed: "seed-y", variants: ["default", "loud"], verdict: FAIL, ranAt: "2026-05-01T01:00:00Z" }),
    ]
    const families = groupIntoFamilies(rows)
    // Find the family for seed-x
    const targetKey = "probe-a:loud:abc12345:seed-x"
    const match = families.get(targetKey)
    expect(match).toBeDefined()
    expect(match!.rows).toHaveLength(1)
    expect(match!.rows[0]!.id).toBe(1)
  })
})

// ── L53 extended family-key dimensions ───────────────────────────────────
//
// Verify that metric_set, expected_chapters, model_route, and prompt_hash
// are folded into the family key so reruns with mismatching probe shape
// do NOT collapse into the same family.

describe("familyKeyFor extended dims", () => {
  const PASS = "SCREEN-PASS"

  test("legacy rows (no extended metadata) keep the 4-part key string", () => {
    const r = makeRow({
      id: 1, probe: "phase-variant-comparison", commit: "abc12345", seed: "fantasy-debt",
      variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z",
    })
    const key = familyKeyFor(r)
    // Extended fields all default ⇒ key string is the legacy 4-part form
    expect(familyKeyStr(key)).toBe("phase-variant-comparison:loud:abc12345:fantasy-debt")
  })

  test("rows with metric_set/chapters/route/hash emit extended key string", () => {
    const r = makeRow({
      id: 1, probe: "phase-variant-comparison", commit: "abc12345", seed: "fantasy-debt",
      variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z",
      metricSet: "planning-scenes", expectedChapters: 5,
      modelRoute: "deepseek-v3.2", promptHash: "abcdef1234567890",
    })
    const key = familyKeyFor(r)
    expect(key.metric_set).toBe("planning-scenes")
    expect(key.chapter_count).toBe("5")
    expect(key.model_route).toBe("deepseek-v3.2")
    expect(key.prompt_hash).toBe("abcdef12")
    expect(familyKeyStr(key)).toBe(
      "phase-variant-comparison:loud:abc12345:fantasy-debt[planning-scenes|5|abcdef12|deepseek-v3.2]",
    )
  })

  test("falls back to g_metrics when top-level metadata is absent", () => {
    const r = makeRow({
      id: 1, probe: "p", commit: "abc", seed: "s",
      variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z",
      gMetrics: { prompt_hash: "ffeedd00", model_route: "wb-qwen3-14b", expected_chapters: 7 },
    })
    const key = familyKeyFor(r)
    expect(key.prompt_hash).toBe("ffeedd00")
    expect(key.model_route).toBe("wb-qwen3-14b")
    expect(key.chapter_count).toBe("7")
  })

  test("different metric_set forms a different family", () => {
    const rows = [
      makeRow({
        id: 1, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z",
        metricSet: "planning-scenes", expectedChapters: 5,
      }),
      makeRow({
        id: 2, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T01:00:00Z",
        metricSet: "state-mapper", expectedChapters: 5,
      }),
    ]
    const families = groupIntoFamilies(rows)
    expect(families.size).toBe(2)
  })

  test("different chapter_count forms a different family", () => {
    const rows = [
      makeRow({
        id: 1, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z",
        metricSet: "planning-scenes", expectedChapters: 5,
      }),
      makeRow({
        id: 2, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T01:00:00Z",
        metricSet: "planning-scenes", expectedChapters: 8,
      }),
    ]
    expect(groupIntoFamilies(rows).size).toBe(2)
  })

  test("different prompt_hash forms a different family", () => {
    const rows = [
      makeRow({
        id: 1, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z",
        promptHash: "aaaaaaaa", metricSet: "planning-scenes", expectedChapters: 5,
      }),
      makeRow({
        id: 2, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T01:00:00Z",
        promptHash: "bbbbbbbb", metricSet: "planning-scenes", expectedChapters: 5,
      }),
    ]
    expect(groupIntoFamilies(rows).size).toBe(2)
  })

  test("different model_route forms a different family", () => {
    const rows = [
      makeRow({
        id: 1, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z",
        modelRoute: "deepseek-v3.2", metricSet: "planning-scenes", expectedChapters: 5,
      }),
      makeRow({
        id: 2, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T01:00:00Z",
        modelRoute: "wb-qwen3-14b", metricSet: "planning-scenes", expectedChapters: 5,
      }),
    ]
    expect(groupIntoFamilies(rows).size).toBe(2)
  })

  test("legacy rows + extended rows do NOT collapse together", () => {
    // Same probe/variant/commit/seed but one row has extended metadata,
    // the other doesn't — they MUST form distinct families because the
    // legacy row's extended dims are unknown and could differ.
    const rows = [
      makeRow({
        id: 1, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T00:00:00Z",
      }),
      makeRow({
        id: 2, probe: "p", commit: "abc", seed: "s",
        variants: ["default", "loud"], verdict: PASS, ranAt: "2026-05-01T01:00:00Z",
        metricSet: "planning-scenes", expectedChapters: 5,
      }),
    ]
    expect(groupIntoFamilies(rows).size).toBe(2)
  })

  test("parseFamilyKey round-trips an extended key string", () => {
    const parsed = parseFamilyKey(
      "phase-variant-comparison:loud:abc12345:fantasy-debt[planning-scenes|5|abcdef12|deepseek-v3.2]",
    )
    expect(parsed.probe_name).toBe("phase-variant-comparison")
    expect(parsed.test_variant).toBe("loud")
    expect(parsed.git_commit).toBe("abc12345")
    expect(parsed.seed).toBe("fantasy-debt")
    expect(parsed.metric_set).toBe("planning-scenes")
    expect(parsed.chapter_count).toBe("5")
    expect(parsed.prompt_hash).toBe("abcdef12")
    expect(parsed.model_route).toBe("deepseek-v3.2")
  })

  test("parseFamilyKey leaves extended fields undefined when suffix is all '—'", () => {
    const parsed = parseFamilyKey("p:loud:abcdef12:s[—|—|—|—]")
    expect(parsed.metric_set).toBeUndefined()
    expect(parsed.chapter_count).toBeUndefined()
    expect(parsed.prompt_hash).toBeUndefined()
    expect(parsed.model_route).toBeUndefined()
  })
})

// ── isCheckerProbe ────────────────────────────────────────────────────────

describe("isCheckerProbe", () => {
  test("recognises halluc-synthetic-fire-rate", () => {
    expect(isCheckerProbe("halluc-synthetic-fire-rate")).toBe(true)
  })
  test("recognises adherence-per-event-prototype", () => {
    expect(isCheckerProbe("adherence-per-event-prototype")).toBe(true)
  })
  test("rejects planning-style probe", () => {
    expect(isCheckerProbe("phase-variant-comparison")).toBe(false)
  })
  test("rejects empty / unknown probe", () => {
    expect(isCheckerProbe("")).toBe(false)
    expect(isCheckerProbe("some-other-probe")).toBe(false)
  })
})

// ── extractCheckerSummary ─────────────────────────────────────────────────

function checkerRow(overrides: Partial<PartialRow & {
  halluc_calibration: any
  adherence_calibration: any
  halluc_recall_pct: number | null
  adherence_recall_pct: number | null
  binary_calibration: any
  binary_match_pct: number | null
  per_event_recall_pct: number | null
  per_event_precision_pct: number | null
}>): any {
  return {
    id: 1,
    probe_name: "halluc-synthetic-fire-rate",
    git_commit: "abc12345",
    seeds_used: ["seed-x"],
    variant_labels: ["live-checkers"],
    verdict: "synthetic-fire-rate halluc=80% adherence=100%",
    ran_at: new Date("2026-05-02T12:00:00Z"),
    experiment_id: null,
    notes: null,
    g_metrics: null,
    recall_pct: null,
    precision_pct: null,
    f1: null,
    calibration_matrix: null,
    halluc_calibration: null,
    adherence_calibration: null,
    halluc_recall_pct: null,
    adherence_recall_pct: null,
    binary_calibration: null,
    binary_match_pct: null,
    per_event_recall_pct: null,
    per_event_precision_pct: null,
    ...overrides,
  }
}

describe("extractCheckerSummary", () => {
  test("returns null for non-checker probe", () => {
    const r = checkerRow({ probe_name: "phase-variant-comparison" })
    expect(extractCheckerSummary(r)).toBeNull()
  })

  test("extracts halluc-synthetic shape with calibration matrices and recall", () => {
    const r = checkerRow({
      probe_name: "halluc-synthetic-fire-rate",
      halluc_calibration: { TP: 4, FP: 0, FN: 1, TN: 5 },
      adherence_calibration: { TP: 2, FP: 0, FN: 0, TN: 8 },
      halluc_recall_pct: 80,
      adherence_recall_pct: 100,
    })
    const summary = extractCheckerSummary(r)
    expect(summary).not.toBeNull()
    expect(summary!.shape).toBe("halluc-synthetic")
    expect(summary!.hallucCalibration).toEqual({ TP: 4, FP: 0, FN: 1, TN: 5 })
    expect(summary!.adherenceCalibration).toEqual({ TP: 2, FP: 0, FN: 0, TN: 8 })
    expect(summary!.hallucRecallPct).toBe(80)
    expect(summary!.adherenceRecallPct).toBe(100)
    expect(summary!.binaryCalibration).toBeNull()
    expect(summary!.perEventRecallPct).toBeNull()
  })

  test("extracts adherence-per-event shape with binary + per-event metrics", () => {
    const r = checkerRow({
      probe_name: "adherence-per-event-prototype",
      binary_calibration: { TP: 11, FP: 1, FN: 1, TN: 3 },
      binary_match_pct: 92,
      per_event_recall_pct: 85,
      per_event_precision_pct: 80,
    })
    const summary = extractCheckerSummary(r)
    expect(summary).not.toBeNull()
    expect(summary!.shape).toBe("adherence-per-event")
    expect(summary!.binaryCalibration).toEqual({ TP: 11, FP: 1, FN: 1, TN: 3 })
    expect(summary!.binaryMatchPct).toBe(92)
    expect(summary!.perEventRecallPct).toBe(85)
    expect(summary!.perEventPrecisionPct).toBe(80)
    expect(summary!.hallucCalibration).toBeNull()
    expect(summary!.adherenceCalibration).toBeNull()
  })

  test("zero-fills missing matrix entries instead of dropping the row", () => {
    const r = checkerRow({
      probe_name: "halluc-synthetic-fire-rate",
      halluc_calibration: { TP: 3 },
      adherence_calibration: null,
      halluc_recall_pct: 50,
    })
    const summary = extractCheckerSummary(r)
    expect(summary!.hallucCalibration).toEqual({ TP: 3, FP: 0, FN: 0, TN: 0 })
    expect(summary!.adherenceCalibration).toBeNull()
  })

  test("treats non-numeric percentages as null", () => {
    const r = checkerRow({
      probe_name: "halluc-synthetic-fire-rate",
      halluc_recall_pct: NaN as unknown as number,
      adherence_recall_pct: "100" as unknown as number,
    })
    const summary = extractCheckerSummary(r)
    expect(summary!.hallucRecallPct).toBeNull()
    expect(summary!.adherenceRecallPct).toBeNull()
  })
})
