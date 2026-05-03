import { describe, test, expect } from "bun:test"
import {
  computeFeatures,
  computeReferenceDistribution,
  standardizedDistance,
  countImprovedFeatures,
  FEATURE_KEYS,
  SENSORY_VOCABULARY,
} from "./voice-shape-metrics"

describe("computeFeatures", () => {
  test("handles empty string", () => {
    const f = computeFeatures("")
    expect(f.totalWords).toBe(0)
    expect(f.sentenceCount).toBe(0)
    expect(f.meanSentenceLength).toBe(0)
  })

  test("simple two-sentence prose", () => {
    const f = computeFeatures("The wind howled. It was cold.")
    expect(f.sentenceCount).toBe(2)
    expect(f.totalWords).toBe(6)
    expect(f.meanSentenceLength).toBeCloseTo(3, 5)
  })

  test("dialogue ratio counts chars-in-quotes", () => {
    const f = computeFeatures(`"Hello," he said. She nodded.`)
    // "Hello," = 8 chars of quote span; total ~28 chars → ratio ~0.28
    expect(f.dialogueRatio).toBeGreaterThan(0.2)
    expect(f.dialogueRatio).toBeLessThan(0.4)
  })

  test("clause complexity counts commas + semicolons per sentence", () => {
    const f = computeFeatures("He ran, stumbled, and fell. She watched.")
    // 2 commas total, 2 sentences → 1.0
    expect(f.clauseComplexity).toBeCloseTo(1.0, 5)
  })

  test("sensory density detects frozen-vocabulary words", () => {
    const f = computeFeatures("The cold wind whispered through the dark shadow.")
    // "cold" + "wind" + "whispered" + "dark" + "shadow" are all in vocabulary
    // Wait — "whispered" isn't; "whisper" is. Past tense won't match. Adjust.
    expect(f.sensoryDensity).toBeGreaterThan(0)
    // Stem-less: "cold", "wind", "dark", "shadow" → 4 hits / 8 words
    expect(f.sensoryDensity).toBeCloseTo(0.5, 1)
  })

  test("sentenceLengthStd is 0 for single sentence", () => {
    const f = computeFeatures("The wind howled in the distance.")
    expect(f.sentenceLengthStd).toBe(0)
  })

  test("sentenceLengthStd is positive for varied sentences", () => {
    const f = computeFeatures("Short. A much longer sentence follows here.")
    expect(f.sentenceLengthStd).toBeGreaterThan(0)
  })
})

describe("SENSORY_VOCABULARY", () => {
  test("contains expected categories", () => {
    expect(SENSORY_VOCABULARY.has("cold")).toBe(true)
    expect(SENSORY_VOCABULARY.has("whisper")).toBe(true)
    expect(SENSORY_VOCABULARY.has("shadow")).toBe(true)
    expect(SENSORY_VOCABULARY.has("blood")).toBe(true)
  })
  test("excludes non-sensory words", () => {
    expect(SENSORY_VOCABULARY.has("the")).toBe(false)
    expect(SENSORY_VOCABULARY.has("think")).toBe(false)
    expect(SENSORY_VOCABULARY.has("decide")).toBe(false)
  })
  test("size is in the charter-committed range (~120)", () => {
    // Exact count is stable via git; fuzz-window for test robustness
    expect(SENSORY_VOCABULARY.size).toBeGreaterThan(100)
    expect(SENSORY_VOCABULARY.size).toBeLessThan(150)
  })
})

describe("computeReferenceDistribution", () => {
  test("computes means and stds per feature", () => {
    const samples = [
      computeFeatures("The wind howled. It was cold."),
      computeFeatures("She ran fast. The shadows closed in."),
      computeFeatures("They fought. The blood flowed."),
    ]
    const ref = computeReferenceDistribution(samples)
    expect(ref.n).toBe(3)
    for (const k of FEATURE_KEYS) {
      expect(typeof ref.means[k]).toBe("number")
      expect(typeof ref.stds[k]).toBe("number")
      expect(ref.means[k]).toBeGreaterThanOrEqual(0)
      expect(ref.stds[k]).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("standardizedDistance", () => {
  test("zero distance when sample matches ref mean exactly", () => {
    const samples = [
      computeFeatures("One sentence exactly matches."),
      computeFeatures("One sentence exactly matches."),
      computeFeatures("One sentence exactly matches."),
    ]
    const ref = computeReferenceDistribution(samples)
    const d = standardizedDistance(samples[0], ref)
    for (const k of FEATURE_KEYS) {
      // Degenerate reference (std=0) + sample matches → 0
      expect(d[k]).toBe(0)
    }
  })

  test("positive distance when sample deviates from ref", () => {
    const refSamples = [
      computeFeatures("Short. Short. Short."),
      computeFeatures("Short. Short."),
      computeFeatures("Brief. Brief. Brief."),
    ]
    const ref = computeReferenceDistribution(refSamples)
    const deviant = computeFeatures("This is a much longer sentence with more words.")
    const d = standardizedDistance(deviant, ref)
    expect(d.meanSentenceLength).toBeGreaterThan(0)
  })
})

describe("countImprovedFeatures", () => {
  test("an arm that halves all distances improves on all 5", () => {
    const baseline = { meanSentenceLength: 2, sentenceLengthStd: 2, dialogueRatio: 2, clauseComplexity: 2, sensoryDensity: 2 }
    const arm = { meanSentenceLength: 1, sentenceLengthStd: 1, dialogueRatio: 1, clauseComplexity: 1, sensoryDensity: 1 }
    const r = countImprovedFeatures(arm, baseline)
    expect(r.count).toBe(5)
  })

  test("an arm that matches baseline exactly improves on none (not ≤ 0.75× baseline)", () => {
    const baseline = { meanSentenceLength: 1, sentenceLengthStd: 1, dialogueRatio: 1, clauseComplexity: 1, sensoryDensity: 1 }
    const r = countImprovedFeatures(baseline, baseline)
    expect(r.count).toBe(0)
  })

  test("partial improvements are counted correctly", () => {
    // Charter threshold is improvementRatio=0.75.
    // arm[k] ≤ 0.75 * baseline[k] → improved.
    const baseline = { meanSentenceLength: 1.0, sentenceLengthStd: 1.0, dialogueRatio: 1.0, clauseComplexity: 1.0, sensoryDensity: 1.0 }
    const arm = { meanSentenceLength: 0.7, sentenceLengthStd: 0.8, dialogueRatio: 0.6, clauseComplexity: 0.9, sensoryDensity: 0.5 }
    // 0.7 ≤ 0.75 ✓  0.8 > 0.75 ✗  0.6 ≤ 0.75 ✓  0.9 > 0.75 ✗  0.5 ≤ 0.75 ✓
    const r = countImprovedFeatures(arm, baseline)
    expect(r.count).toBe(3)
    expect(r.per_feature.meanSentenceLength).toBe(true)
    expect(r.per_feature.sentenceLengthStd).toBe(false)
    expect(r.per_feature.dialogueRatio).toBe(true)
    expect(r.per_feature.clauseComplexity).toBe(false)
    expect(r.per_feature.sensoryDensity).toBe(true)
  })
})
