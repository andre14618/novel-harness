/**
 * Stake-escalation directional check across 3 IWD books.
 *
 * Pure compute on beats.jsonl using the existing `boundary_signal` field.
 * Counts `stakes_recalibration` events per chapter quintile to test whether
 * stakes escalate within chapters (q4 > q0) and across the book arc.
 *
 * Output: timestamped JSON appended to structure-calibration/.
 */

import { readFileSync, writeFileSync } from "node:fs"

const BEATS = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/beats.jsonl"

type Beat = { book: string; chapter: string | number; beat_idx: number; boundary_signal: string }

const lines = readFileSync(BEATS, "utf-8").trim().split("\n")
const beats: Beat[] = lines.map(l => JSON.parse(l))

const books = ["crystal_shard", "streams_of_silver", "halflings_gem"]

// Group by chapter, then bucket beats into quintiles by beat_idx within chapter.
function chapterMap(book: string): Map<string, Beat[]> {
  const m = new Map<string, Beat[]>()
  for (const b of beats) {
    if (b.book !== book) continue
    const k = String(b.chapter)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(b)
  }
  for (const arr of m.values()) arr.sort((a, b) => a.beat_idx - b.beat_idx)
  return m
}

function bucketize(arr: Beat[], k: number): Beat[][] {
  const buckets: Beat[][] = Array.from({ length: k }, () => [])
  if (arr.length === 0) return buckets
  arr.forEach((b, i) => {
    const bucket = Math.min(k - 1, Math.floor((i / arr.length) * k))
    buckets[bucket]!.push(b)
  })
  return buckets
}

const perBook: Record<string, any> = {}

for (const book of books) {
  const chapterToBeats = chapterMap(book)
  const totalChapters = chapterToBeats.size

  // Per-chapter stake-escalation: count stakes_recalibration in q0..q4
  // Stakes-rising = q4_count > q0_count (within chapter)
  let chaptersStakesRising = 0
  let chaptersStakesFalling = 0
  let chaptersStakesFlat = 0

  // Aggregate quintile counts across all chapters
  const aggregateByQuintile = [0, 0, 0, 0, 0]

  // Across-book arc: stakes_recalibration per chapter as a function of chapter position
  const chapterPositions: { pos: number; stakes: number }[] = []

  // Sort chapter keys in book order — chapter is a number for most, string for prelude/epilogue
  const numericChapters = [...chapterToBeats.keys()]
    .filter(k => /^\d+$/.test(k))
    .map(k => parseInt(k))
    .sort((a, b) => a - b)

  for (const [chKey, beatsArr] of chapterToBeats) {
    const buckets = bucketize(beatsArr, 5)
    const counts = buckets.map(qb => qb.filter(b => b.boundary_signal === "stakes_recalibration").length)
    counts.forEach((c, i) => { aggregateByQuintile[i]! += c })

    if (counts[4]! > counts[0]!) chaptersStakesRising++
    else if (counts[4]! < counts[0]!) chaptersStakesFalling++
    else chaptersStakesFlat++

    if (/^\d+$/.test(chKey)) {
      const pos = numericChapters.indexOf(parseInt(chKey)) / (numericChapters.length - 1)
      const total = counts.reduce((a, b) => a + b, 0)
      chapterPositions.push({ pos, stakes: total })
    }
  }

  // Within-chapter trend (q0 → q4 pooled)
  const sumStart = aggregateByQuintile[0]! + aggregateByQuintile[1]!
  const sumEnd = aggregateByQuintile[3]! + aggregateByQuintile[4]!
  const withinChapterTrend = sumEnd > sumStart * 1.1 ? "rising" : sumEnd < sumStart * 0.9 ? "falling" : "flat"

  // Across-book arc — bin chapters into thirds
  const earlyStakes = chapterPositions.filter(c => c.pos < 0.33).map(c => c.stakes)
  const midStakes = chapterPositions.filter(c => c.pos >= 0.33 && c.pos < 0.67).map(c => c.stakes)
  const lateStakes = chapterPositions.filter(c => c.pos >= 0.67).map(c => c.stakes)
  const mean = (arr: number[]) => arr.length === 0 ? 0 : Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100

  perBook[book] = {
    n_chapters: totalChapters,
    chaptersStakesRising,
    chaptersStakesFalling,
    chaptersStakesFlat,
    chaptersStakesRisingPct: Math.round((chaptersStakesRising / totalChapters) * 1000) / 10,
    aggregate_quintile_counts: aggregateByQuintile,
    aggregate_quintile_pct_of_total: aggregateByQuintile.map(c => {
      const total = aggregateByQuintile.reduce((a, b) => a + b, 0)
      return total === 0 ? 0 : Math.round((c / total) * 1000) / 10
    }),
    within_chapter_trend: withinChapterTrend,
    across_book_arc: {
      early_third_stakes_per_chapter: mean(earlyStakes),
      mid_third_stakes_per_chapter: mean(midStakes),
      late_third_stakes_per_chapter: mean(lateStakes),
      arc_direction: mean(lateStakes) > mean(earlyStakes) * 1.1 ? "rising" : mean(lateStakes) < mean(earlyStakes) * 0.9 ? "falling" : "flat",
    },
  }
}

const withinChapterTrendsByBook = books.map(b => perBook[b].within_chapter_trend)
const arcDirectionsByBook = books.map(b => perBook[b].across_book_arc.arc_direction)

const within_directional_stable = new Set(withinChapterTrendsByBook).size === 1
const arc_directional_stable = new Set(arcDirectionsByBook).size === 1

const out = {
  computedAt: new Date().toISOString(),
  description: "Stake-escalation directional check across 3 IWD books. Counts boundary_signal='stakes_recalibration' events per chapter quintile (within-chapter) and per book-arc third (across-book).",
  rationale: "Tests whether stakes escalate (a) within chapters (q4 > q0) and (b) across the book arc (late > early). Feeds chapter-outline `purpose` guidance — if stakes rise within chapters as a stable pattern, the planner should encode that.",
  per_book: perBook,
  cross_book: {
    within_chapter_trends: withinChapterTrendsByBook,
    within_chapter_directional_stable: within_directional_stable,
    arc_directions: arcDirectionsByBook,
    arc_directional_stable: arc_directional_stable,
  },
  directional_assessment: `Within-chapter: ${withinChapterTrendsByBook.join(" / ")} (${within_directional_stable ? "STABLE" : "varies"}). Across-book arc: ${arcDirectionsByBook.join(" / ")} (${arc_directional_stable ? "STABLE" : "varies"}).`,
}

const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")
const path = `/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/structure-calibration/crystal_shard.${ts}.stake-escalation.json`
writeFileSync(path, JSON.stringify(out, null, 2))
console.log(`wrote ${path}`)

console.log("\n=== within-chapter trend per book ===")
for (const b of books) {
  console.log(`${b}: ${perBook[b].within_chapter_trend} | quintile counts: ${perBook[b].aggregate_quintile_counts.join(" / ")} | %-of-total: ${perBook[b].aggregate_quintile_pct_of_total.join(" / ")}`)
  console.log(`  rising-stakes chapters: ${perBook[b].chaptersStakesRising}/${perBook[b].n_chapters} (${perBook[b].chaptersStakesRisingPct}%)`)
}
console.log("\n=== across-book arc ===")
for (const b of books) {
  const a = perBook[b].across_book_arc
  console.log(`${b}: early=${a.early_third_stakes_per_chapter} mid=${a.mid_third_stakes_per_chapter} late=${a.late_third_stakes_per_chapter} → ${a.arc_direction}`)
}
console.log(`\nwithin-chapter directional stable: ${within_directional_stable}`)
console.log(`arc directional stable: ${arc_directional_stable}`)
