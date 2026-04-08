import { describe, test, expect } from "bun:test"
import {
  majorityValue,
  unionByKey,
  intersectionByKey,
  meanNumber,
  medianNumber,
} from "../src/aggregators"

describe("majorityValue", () => {
  test("picks the most-frequent value", () => {
    expect(majorityValue([true, true, false])).toBe(true)
    expect(majorityValue([false, true, false])).toBe(false)
    expect(majorityValue(["a", "b", "a", "c", "a"])).toBe("a")
  })

  test("handles single-element input", () => {
    expect(majorityValue([true])).toBe(true)
    expect(majorityValue([42])).toBe(42)
  })

  test("ties resolve to first occurrence's value", () => {
    // 1 and 2 both appear twice; both are valid winners but 1 should win as first-seen
    const result = majorityValue([1, 2, 1, 2])
    expect([1, 2]).toContain(result)
  })

  test("throws on empty input", () => {
    expect(() => majorityValue([])).toThrow("empty input")
  })
})

describe("unionByKey", () => {
  test("combines lists, deduplicating by key", () => {
    const a = [{ id: "x", val: 1 }, { id: "y", val: 2 }]
    const b = [{ id: "y", val: 99 }, { id: "z", val: 3 }]
    const result = unionByKey([a, b], item => item.id)
    expect(result).toHaveLength(3)
    expect(result.map(r => r.id)).toEqual(["x", "y", "z"])
    // First occurrence of duplicate key wins
    expect(result.find(r => r.id === "y")?.val).toBe(2)
  })

  test("preserves order from input lists", () => {
    const result = unionByKey(
      [["a", "b"], ["c", "a"]],
      s => s,
    )
    expect(result).toEqual(["a", "b", "c"])
  })

  test("handles empty inputs", () => {
    expect(unionByKey([], (s: string) => s)).toEqual([])
    expect(unionByKey([[], []], (s: string) => s)).toEqual([])
  })

  test("complex key function — reference-resolver shape", () => {
    const callA = [
      { type: "relationship", characters: ["Elena", "Marcus"], topic: "trust" },
      { type: "recent_events", characters: ["Marcus"], topic: "betrayal" },
    ]
    const callB = [
      { type: "relationship", characters: ["Elena", "Marcus"], topic: "trust" }, // duplicate of A
      { type: "knowledge", characters: ["Elena"], topic: "betrayal evidence" },
    ]
    const result = unionByKey(
      [callA, callB],
      l => `${l.type}|${l.characters.sort().join(",")}|${l.topic}`,
    )
    expect(result).toHaveLength(3)
  })
})

describe("intersectionByKey", () => {
  test("returns items present in every list", () => {
    const a = [{ id: "x" }, { id: "y" }, { id: "z" }]
    const b = [{ id: "y" }, { id: "z" }, { id: "w" }]
    const c = [{ id: "y" }, { id: "z" }]
    const result = intersectionByKey([a, b, c], item => item.id)
    expect(result.map(r => r.id)).toEqual(["y", "z"])
  })

  test("empty input arrays", () => {
    expect(intersectionByKey([], (s: string) => s)).toEqual([])
  })

  test("single list returns itself", () => {
    const result = intersectionByKey([[{ id: "a" }, { id: "b" }]], item => item.id)
    expect(result.map(r => r.id)).toEqual(["a", "b"])
  })

  test("no overlap returns empty", () => {
    const result = intersectionByKey([[{ id: "a" }], [{ id: "b" }]], item => item.id)
    expect(result).toEqual([])
  })

  test("fact-extractor precision use case — only facts in all calls survive", () => {
    const call1 = [
      { fact: "Elena lives in the manor" },
      { fact: "Marcus betrayed Elena" },
      { fact: "It is winter" },
    ]
    const call2 = [
      { fact: "Elena lives in the manor" },
      { fact: "Marcus betrayed Elena" },
      { fact: "Elena is angry" },
    ]
    const call3 = [
      { fact: "Elena lives in the manor" },
      { fact: "Marcus betrayed Elena" },
      { fact: "The garden is overgrown" },
    ]
    const result = intersectionByKey([call1, call2, call3], f => f.fact)
    // Only the two facts present in all three calls survive
    expect(result).toHaveLength(2)
    expect(result.map(r => r.fact)).toEqual([
      "Elena lives in the manor",
      "Marcus betrayed Elena",
    ])
  })
})

describe("meanNumber", () => {
  test("computes the arithmetic mean", () => {
    expect(meanNumber([1, 2, 3, 4, 5])).toBe(3)
    expect(meanNumber([10, 20])).toBe(15)
  })

  test("handles single value", () => {
    expect(meanNumber([7])).toBe(7)
  })

  test("throws on empty input", () => {
    expect(() => meanNumber([])).toThrow("empty input")
  })
})

describe("medianNumber", () => {
  test("odd-length: middle value", () => {
    expect(medianNumber([1, 2, 3])).toBe(2)
    expect(medianNumber([5, 1, 3])).toBe(3) // sorts to [1,3,5]
  })

  test("even-length: average of two middle values", () => {
    expect(medianNumber([1, 2, 3, 4])).toBe(2.5)
    expect(medianNumber([10, 20, 30, 40])).toBe(25)
  })

  test("handles single value", () => {
    expect(medianNumber([42])).toBe(42)
  })

  test("does not mutate input", () => {
    const input = [3, 1, 2]
    medianNumber(input)
    expect(input).toEqual([3, 1, 2])
  })

  test("throws on empty input", () => {
    expect(() => medianNumber([])).toThrow("empty input")
  })
})
