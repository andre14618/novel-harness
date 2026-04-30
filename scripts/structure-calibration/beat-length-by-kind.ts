/**
 * Beat-length distribution per beat-kind across 3 IWD books.
 *
 * Pure compute on beats.jsonl. Feeds the beat-expander's targetWords-per-beat
 * soft prior — currently the planner uses a single "targetWords / 100" beat-count
 * floor with no per-kind size differentiation.
 *
 * Output: timestamped JSON appended to structure-calibration/.
 */

import { readFileSync, writeFileSync } from "node:fs"

const BEATS = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/beats.jsonl"

type Beat = { book: string; chapter: string | number; beat_idx: number; kind: string; words: number }

const lines = readFileSync(BEATS, "utf-8").trim().split("\n")
const beats: Beat[] = lines.map(l => JSON.parse(l))

const KINDS = ["action", "dialogue", "interiority", "description"] as const

function stats(values: number[]): { n: number; mean: number; median: number; p25: number; p75: number; min: number; max: number } {
  if (values.length === 0) return { n: 0, mean: 0, median: 0, p25: 0, p75: 0, min: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    n: sorted.length,
    mean: Math.round((sum / sorted.length) * 10) / 10,
    median: sorted[Math.floor(sorted.length / 2)]!,
    p25: sorted[Math.floor(sorted.length * 0.25)]!,
    p75: sorted[Math.floor(sorted.length * 0.75)]!,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  }
}

const books = ["crystal_shard", "streams_of_silver", "halflings_gem"]

const perBook: Record<string, any> = {}
const perKind: Record<string, any> = {}

for (const book of books) {
  perBook[book] = { total_beats: 0, by_kind: {} }
  for (const kind of KINDS) {
    const ws = beats.filter(b => b.book === book && b.kind === kind).map(b => b.words)
    perBook[book].by_kind[kind] = stats(ws)
    perBook[book].total_beats += ws.length
  }
}

for (const kind of KINDS) {
  const all = beats.filter(b => b.kind === kind).map(b => b.words)
  perKind[kind] = stats(all)
}

const overall = stats(beats.map(b => b.words))

// Directional analysis — does the per-kind ordering of mean beat lengths reproduce?
const meanRanksPerBook: Record<string, string[]> = {}
for (const book of books) {
  const ranks = [...KINDS]
    .map(k => ({ k, mean: perBook[book].by_kind[k].mean }))
    .sort((a, b) => b.mean - a.mean)
    .map(r => r.k)
  meanRanksPerBook[book] = ranks
}

const allBookRanks = books.map(b => meanRanksPerBook[b])
const directionalStable = allBookRanks.every((r, i) => i === 0 || r!.join(",") === allBookRanks[0]!.join(","))

const out = {
  computedAt: new Date().toISOString(),
  description: "Beat-length distribution per beat-kind across 3 IWD books. Pure compute on beats.jsonl.",
  rationale: "Feeds beat-expander targetWords-per-beat soft prior. Currently the planner has a single targetWords/100 beat-count floor with no per-kind size differentiation. If different beat kinds have stably different lengths across books, that's a directional planner prior.",
  methodology: "Per-book per-kind word-count stats (mean/median/p25/p75/min/max). Directional gate: does the per-kind ordering of mean lengths reproduce across all 3 books?",
  per_book: perBook,
  per_kind_aggregate: perKind,
  overall: overall,
  per_book_kind_ordering_by_mean_length: meanRanksPerBook,
  directional_stable: directionalStable,
  directional_assessment: directionalStable
    ? `Yes — per-kind ordering ${allBookRanks[0]!.join(" > ")} reproduces across all 3 books. Ship as planner prior.`
    : `Mixed — orderings differ across books: ${books.map(b => `${b}: ${meanRanksPerBook[b]!.join(" > ")}`).join("; ")}.`,
}

const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")
const path = `/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/structure-calibration/crystal_shard.${ts}.beat-length-by-kind.json`
writeFileSync(path, JSON.stringify(out, null, 2))
console.log(`wrote ${path}`)
console.log("\n=== per-kind aggregate (across all 3 books) ===")
for (const k of KINDS) {
  console.log(`${k}: n=${perKind[k].n} mean=${perKind[k].mean}w median=${perKind[k].median}w p25=${perKind[k].p25} p75=${perKind[k].p75}`)
}
console.log("\n=== per-book kind-ordering by mean length ===")
for (const b of books) console.log(`${b}: ${meanRanksPerBook[b]!.join(" > ")}`)
console.log(`\ndirectional_stable: ${directionalStable}`)
