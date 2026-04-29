/**
 * Phase C Round 2 — promise cardinality pivot.
 *
 * Loads all 5 promise sources for Crystal Shard and tabulates:
 *   - Per-chapter promise OPEN counts
 *   - Per-chapter promise CLOSE counts
 *   - Payoff-span distribution (close_idx - open_idx)
 * across runs to test whether the CARDINALITY signal is more stable
 * than the discrete-set signal (which had v1↔v2 Jaccard 0.326).
 *
 * Inputs:
 *   - structure/crystal_shard/promises.20260429T184705.json    (Flash, 14)
 *   - structure/crystal_shard/promises.20260429T213820.pro.json    (Pro@T=0.3, 22)
 *   - structure/crystal_shard/promises.20260429T221035.pro-t0.json (Pro@T=0, 22)
 *   - structure-gold/crystal_shard/promise-gold.20260429T214936.v1.jsonl (Pro judge v1, 30)
 *   - structure-gold/crystal_shard/promise-gold.20260429T220650.v2.jsonl (Pro judge v2, 27)
 *   - structure/crystal_shard/promises.20260429T215322.sonnet.json (Sonnet, 38)
 */

import { join } from "node:path"

interface Promise {
  promise_id?: string
  sample_id?: string
  promise_text: string
  opened_chapter_index: number
  closed_chapter_index?: number | null
}

const REPO = "/Users/andre/Desktop/personal_projects/novel-harness"

async function loadJson(path: string): Promise<any[]> {
  const text = await Bun.file(path).text()
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : (parsed.promises ?? [])
}

async function loadJsonl(path: string): Promise<any[]> {
  const text = await Bun.file(path).text()
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l))
}

const sources = [
  { label: "Flash extractor",  path: `${REPO}/novels/salvatore-icewind-dale/structure/crystal_shard/promises.20260429T184705.json`,             type: "json" },
  { label: "Pro@T=0.3 extractor",  path: `${REPO}/novels/salvatore-icewind-dale/structure/crystal_shard/promises.20260429T213820.pro.json`,         type: "json" },
  { label: "Pro@T=0 extractor",    path: `${REPO}/novels/salvatore-icewind-dale/structure/crystal_shard/promises.20260429T221035.pro-t0.json`,      type: "json" },
  { label: "Pro judge gold v1",    path: `${REPO}/novels/salvatore-icewind-dale/structure-gold/crystal_shard/promise-gold.20260429T214936.v1.jsonl`, type: "jsonl" },
  { label: "Pro judge gold v2",    path: `${REPO}/novels/salvatore-icewind-dale/structure-gold/crystal_shard/promise-gold.20260429T220650.v2.jsonl`, type: "jsonl" },
  { label: "Sonnet Tier 3",        path: `${REPO}/novels/salvatore-icewind-dale/structure/crystal_shard/promises.20260429T215322.sonnet.json`,      type: "json" },
]

const results: Record<string, any> = {}

for (const s of sources) {
  const rows = s.type === "json" ? await loadJson(s.path) : await loadJsonl(s.path)
  // For gold files, opens info is in row.output or top-level
  const promises: Promise[] = rows.map(r => {
    if (r.gold_promise) return r.gold_promise as Promise
    return r as Promise
  }).filter(p => p && typeof p.opened_chapter_index === "number")

  const opensByCh = new Map<number, number>()
  const closesByCh = new Map<number, number>()
  const spans: number[] = []
  let openCount = 0, closeCount = 0
  for (const p of promises) {
    opensByCh.set(p.opened_chapter_index, (opensByCh.get(p.opened_chapter_index) ?? 0) + 1)
    openCount++
    if (p.closed_chapter_index != null) {
      closesByCh.set(p.closed_chapter_index, (closesByCh.get(p.closed_chapter_index) ?? 0) + 1)
      spans.push(p.closed_chapter_index - p.opened_chapter_index)
      closeCount++
    }
  }

  const allCh = new Set<number>([...opensByCh.keys(), ...closesByCh.keys()])
  const minCh = Math.min(...allCh)
  const maxCh = Math.max(...allCh)

  results[s.label] = {
    n: promises.length,
    openCount, closeCount,
    chapters: [...allCh].sort((a, b) => a - b),
    opensByCh: Object.fromEntries([...opensByCh.entries()].sort((a, b) => a[0] - b[0])),
    closesByCh: Object.fromEntries([...closesByCh.entries()].sort((a, b) => a[0] - b[0])),
    spanDist: {
      n: spans.length,
      mean: spans.length === 0 ? null : spans.reduce((a, b) => a + b, 0) / spans.length,
      median: spans.length === 0 ? null : [...spans].sort((a, b) => a - b)[Math.floor(spans.length / 2)],
      min: spans.length === 0 ? null : Math.min(...spans),
      max: spans.length === 0 ? null : Math.max(...spans),
      buckets: {
        same_chapter: spans.filter(s => s === 0).length,
        within_3: spans.filter(s => s > 0 && s <= 3).length,
        within_4_to_8: spans.filter(s => s >= 4 && s <= 8).length,
        far_9plus: spans.filter(s => s >= 9).length,
        unresolved: 0,
      },
    },
    chRange: { min: minCh, max: maxCh },
  }
}

// Print readable comparison table
console.log("\n=== Promise count summary ===")
for (const [label, r] of Object.entries(results) as any) {
  console.log(`${label.padEnd(28)}  total=${r.n}  opens=${r.openCount}  closes=${r.closeCount}  chRange=[${r.chRange.min}..${r.chRange.max}]`)
}

console.log("\n=== Opens per chapter ===")
const allChapters = new Set<number>()
for (const r of Object.values(results) as any[]) for (const ch of r.chapters) allChapters.add(ch)
const chList = [...allChapters].sort((a, b) => a - b)
const labelHeader = "Chapter".padEnd(8) + Object.keys(results).map(l => l.slice(0, 16).padEnd(18)).join("")
console.log(labelHeader)
for (const ch of chList) {
  const row = [`ch${ch}`.padEnd(8)]
  for (const r of Object.values(results) as any[]) {
    const v = r.opensByCh[ch] ?? 0
    row.push(String(v).padEnd(18))
  }
  console.log(row.join(""))
}

console.log("\n=== Span distribution (closed_ch - opened_ch) ===")
for (const [label, r] of Object.entries(results) as any) {
  const sd = r.spanDist
  console.log(`${label.padEnd(28)}  n=${sd.n}  mean=${sd.mean?.toFixed(1)}  median=${sd.median}  range=[${sd.min}..${sd.max}]  buckets: same=${sd.buckets.same_chapter} 1-3=${sd.buckets.within_3} 4-8=${sd.buckets.within_4_to_8} 9+=${sd.buckets.far_9plus}`)
}

// Compute pairwise cardinality stability
console.log("\n=== Pairwise opens-per-chapter correlation ===")
const labels = Object.keys(results)
function correlation(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb)
    da += (a[i]! - ma) ** 2
    db += (b[i]! - mb) ** 2
  }
  return num / (Math.sqrt(da) * Math.sqrt(db))
}
const opensVecs: Record<string, number[]> = {}
for (const label of labels) {
  opensVecs[label] = chList.map(ch => results[label].opensByCh[ch] ?? 0)
}
console.log("".padEnd(28) + labels.map(l => l.slice(0, 12).padEnd(14)).join(""))
for (const a of labels) {
  const row = [a.padEnd(28)]
  for (const b of labels) {
    const c = correlation(opensVecs[a]!, opensVecs[b]!)
    row.push(c.toFixed(3).padEnd(14))
  }
  console.log(row.join(""))
}

// Save summary
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").slice(0, 15)
const outPath = `${REPO}/novels/salvatore-icewind-dale/structure-calibration/crystal_shard.${stamp}.cardinality.json`
await Bun.write(outPath, JSON.stringify({
  computedAt: new Date().toISOString(),
  sources,
  results,
}, null, 2))
console.log(`\nwrote → ${outPath}`)
