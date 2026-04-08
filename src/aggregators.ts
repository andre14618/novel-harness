/**
 * Aggregation utilities for best-of-N inference.
 *
 * These are pure helper functions that agent-specific aggregators compose
 * into the actual reduction logic. The agent-specific aggregator lives next
 * to the agent (e.g. src/agents/writer/adherence-checker.ts) and uses these
 * primitives to combine N parallel call outputs into a single result.
 *
 * The principle: parallel-N is only useful when the output is aggregable.
 * "Aggregable" means at least one of these primitives applies cleanly to
 * the output shape. Creative prose is not aggregable; structured analytical
 * outputs (booleans, lists, numbers) are.
 */

/** Pick the most-frequently-occurring value. Ties resolved by first occurrence. */
export function majorityValue<T>(values: T[]): T {
  if (values.length === 0) throw new Error("majorityValue: empty input")
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = values[0]
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}

/** Union of items from multiple lists, deduplicated by a key function. Order preserved. */
export function unionByKey<T>(arrays: T[][], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const arr of arrays) {
    for (const item of arr) {
      const key = keyFn(item)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(item)
      }
    }
  }
  return out
}

/** Items present in EVERY input list, keyed by a function. Order from the first list. */
export function intersectionByKey<T>(arrays: T[][], keyFn: (item: T) => string): T[] {
  if (arrays.length === 0) return []
  const keysPerArray = arrays.map(arr => new Set(arr.map(keyFn)))
  return arrays[0].filter(item => {
    const key = keyFn(item)
    return keysPerArray.every(s => s.has(key))
  })
}

/** Mean of numeric values. Throws on empty input. */
export function meanNumber(values: number[]): number {
  if (values.length === 0) throw new Error("meanNumber: empty input")
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Median of numeric values. Throws on empty input. */
export function medianNumber(values: number[]): number {
  if (values.length === 0) throw new Error("medianNumber: empty input")
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
