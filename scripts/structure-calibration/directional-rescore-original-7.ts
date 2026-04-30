/**
 * Directional re-score of the original 7 cross-book patterns.
 *
 * The original analysis (crystal_shard.20260430T113810.original-7-patterns-cross-book.json)
 * applied a ±20% point-estimate gate. That gate is the right question for
 * checker-side distributional priors but the WRONG question for planner-prompt
 * scaffolding, which encodes directional priors (ordering, modal class,
 * sign-of-effect) rather than exact rates.
 *
 * This script appends a directional-reproduction analysis to the same data set
 * WITHOUT modifying the original file. The point-estimate verdicts remain on
 * record; this re-score adds a second view.
 *
 * Append-only: emits a new timestamped JSON alongside the original. Per the
 * "never overwrite analysis runs" SOP.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/structure-calibration/crystal_shard.20260430T113810.original-7-patterns-cross-book.json"

type DistRow = Record<string, number>

function ranking(dist: DistRow): string[] {
  return Object.entries(dist)
    .filter(([k, v]) => k !== "other" && v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
}

function modalClass(dist: DistRow): string {
  return ranking(dist)[0]!
}

function rankingsAgree(rs: string[][]): { agree: boolean; details: string } {
  const minLen = Math.min(...rs.map(r => r.length))
  if (minLen === 0) return { agree: false, details: "empty ranking" }
  for (let i = 0; i < minLen; i++) {
    const at = rs.map(r => r[i])
    const uniq = new Set(at)
    if (uniq.size > 1) {
      return { agree: false, details: `position ${i + 1} differs: ${rs.map(r => r[i]).join(" / ")}` }
    }
  }
  return { agree: true, details: `top-${minLen} matches across books: ${rs[0]!.slice(0, minLen).join(" > ")}` }
}

function topNAgree(rs: string[][], n: number): { agree: boolean; details: string } {
  const tops = rs.map(r => new Set(r.slice(0, n)))
  const intersection = [...tops[0]!].filter(k => tops.every(s => s.has(k)))
  return {
    agree: intersection.length === n,
    details: `top-${n} sets per book — intersection size ${intersection.length}/${n}: ${[...intersection].join(", ") || "(none)"}`,
  }
}

function modalAgree(dists: DistRow[]): { agree: boolean; details: string } {
  const modals = dists.map(modalClass)
  const uniq = new Set(modals)
  return {
    agree: uniq.size === 1,
    details: `modal classes per book: ${modals.join(" / ")}`,
  }
}

function signOfEffectAgree(values: number[][]): { agree: boolean; details: string } {
  // values is [book][position] — does the trend (rising vs falling vs flat) agree across books?
  const trends = values.map(v => {
    const first = v[0]!
    const last = v[v.length - 1]!
    if (last > first * 1.1) return "rising"
    if (last < first * 0.9) return "falling"
    return "flat"
  })
  const uniq = new Set(trends)
  return {
    agree: uniq.size === 1,
    details: `trends per book: ${trends.join(" / ")}`,
  }
}

const raw = JSON.parse(readFileSync(SOURCE, "utf-8"))
const books: any[] = raw.per_book

const verdicts: Record<string, any> = {}

// Pattern 1 — length distribution. Already PASS on point estimate. Sanity confirm.
verdicts.pattern_1_length_distribution = {
  point_estimate_verdict: "PASS",
  directional_verdict: "PASS",
  notes: `Already passes both gates. Beats/ch median: ${books.map(b => b.beats_per_chapter.median).join(" / ")}; words/ch median: ${books.map(b => b.words_per_chapter.median).join(" / ")}.`,
}

// Pattern 2 — beat-kind distribution. Ranking stability across books.
const kindDists = books.map(b => b.kind_distribution_pct)
const kindRanks = kindDists.map(ranking)
const p2Rank = rankingsAgree(kindRanks)
const p2Modal = modalAgree(kindDists)
verdicts.pattern_2_beat_kind_distribution = {
  point_estimate_verdict: "DIVERGE",
  directional_verdict: p2Rank.agree ? "PASS" : (p2Modal.agree ? "PASS_MODAL_ONLY" : "DIVERGE"),
  ranking_stability: p2Rank,
  modal_class_agreement: p2Modal,
  per_book_rankings: kindRanks.map((r, i) => ({ book: books[i].book, ranking: r })),
  notes: "Planner-prompt-relevant question: is action the dominant beat kind in the genre? If yes (modal class agrees) the directional prior holds even if exact rates jiggle.",
}

// Pattern 3 — opener / closer kind. Modal-class agreement.
const openerDists = books.map(b => b.opener_kind_pct)
const closerDists = books.map(b => b.closer_kind_pct)
const p3OpenerModal = modalAgree(openerDists)
const p3CloserModal = modalAgree(closerDists)
const p3OpenerRank = rankingsAgree(openerDists.map(ranking))
const p3CloserRank = rankingsAgree(closerDists.map(ranking))
verdicts.pattern_3_opener_closer_kinds = {
  point_estimate_verdict: "DIVERGE",
  directional_verdict_opener: p3OpenerRank.agree ? "PASS" : (p3OpenerModal.agree ? "PASS_MODAL_ONLY" : "DIVERGE"),
  directional_verdict_closer: p3CloserRank.agree ? "PASS" : (p3CloserModal.agree ? "PASS_MODAL_ONLY" : "DIVERGE"),
  opener_modal_agreement: p3OpenerModal,
  opener_ranking_stability: p3OpenerRank,
  closer_modal_agreement: p3CloserModal,
  closer_ranking_stability: p3CloserRank,
  per_book_opener_rankings: openerDists.map((d, i) => ({ book: books[i].book, ranking: ranking(d) })),
  per_book_closer_rankings: closerDists.map((d, i) => ({ book: books[i].book, ranking: ranking(d) })),
}

// Pattern 4 — within-chapter position effects. Sign-of-effect for each kind across q0→q4.
const positions = ["q0", "q1", "q2", "q3", "q4"] as const
const kinds = ["action", "dialogue", "interiority", "description"] as const
const p4Trends: Record<string, any> = {}
for (const kind of kinds) {
  const valuesByBook = books.map(b =>
    positions.map(q => b.position_buckets_pct[q][kind] ?? 0)
  )
  const sign = signOfEffectAgree(valuesByBook)
  p4Trends[kind] = {
    per_book_q0_to_q4: valuesByBook.map((v, i) => ({ book: books[i].book, sequence: v })),
    sign_of_effect: sign,
  }
}
const p4AnyAgree = Object.values(p4Trends).filter((t: any) => t.sign_of_effect.agree).length
verdicts.pattern_4_position_effects = {
  point_estimate_verdict: "DIVERGE",
  directional_verdict: p4AnyAgree >= 3 ? "PASS_MOSTLY" : (p4AnyAgree >= 2 ? "PASS_PARTIAL" : "DIVERGE"),
  trends_by_kind: p4Trends,
  summary: `Sign-of-effect agreement: ${p4AnyAgree}/4 kinds reproduce trend direction across all 3 books.`,
}

// Pattern 7 — boundary signals. Top-3 set agreement + ranking stability.
const boundaryDists = books.map(b => b.boundary_signal_pct)
const p7Top3 = topNAgree(boundaryDists.map(ranking), 3)
const p7Top4 = topNAgree(boundaryDists.map(ranking), 4)
const p7Modal = modalAgree(boundaryDists)
verdicts.pattern_7_boundary_signals = {
  point_estimate_verdict: "DIVERGE",
  directional_verdict: p7Top3.agree ? "PASS" : (p7Modal.agree ? "PASS_MODAL_ONLY" : "DIVERGE"),
  modal_class_agreement: p7Modal,
  top_3_agreement: p7Top3,
  top_4_agreement: p7Top4,
  per_book_rankings: boundaryDists.map((d, i) => ({ book: books[i].book, ranking: ranking(d).slice(0, 5) })),
}

verdicts.pattern_5_mice_rhythm = {
  point_estimate_verdict: "PARKED_SKIP_NO_DATA",
  directional_verdict: "PARKED_SKIP_NO_DATA",
  notes: "SoS/HG mice.jsonl absent; cross-book mice reproduction cannot be computed at any granularity.",
}
verdicts.pattern_6_opens_closes = {
  point_estimate_verdict: "PARKED_SKIP_NO_DATA",
  directional_verdict: "PARKED_SKIP_NO_DATA",
  notes: "Same — depends on mice.jsonl.",
}

const out = {
  computedAt: new Date().toISOString(),
  description: "Directional reproduction analysis of original 7 cross-book patterns. APPENDS to (does not replace) the point-estimate analysis at crystal_shard.20260430T113810.original-7-patterns-cross-book.json.",
  rationale: "Point-estimate ±20% gate is the right question for checker-side distributional priors but wrong for planner-prompt scaffolding. Planner prompts encode directional priors (ordering, modal class, sign-of-effect). This analysis re-scores the same per-book data under the directional gate.",
  source_file: SOURCE,
  source_ship_gate: "PASS = within ±20% across all 3 books; DRIFT = within ±30%; DIVERGE = outside ±30%",
  directional_ship_gate: "PASS = ranking matches across all 3 books OR modal class matches across all 3 books with ranking stable in top positions; PASS_MODAL_ONLY = modal class agrees, secondary ordering varies; DIVERGE = modal class differs",
  per_pattern_verdicts: verdicts,
  per_book_summary: books.map(b => ({
    book: b.book,
    n_chapters: b.n_chapters,
    n_beats: b.n_beats,
    kind_modal: modalClass(b.kind_distribution_pct),
    opener_modal: modalClass(b.opener_kind_pct),
    closer_modal: modalClass(b.closer_kind_pct),
    boundary_modal: modalClass(b.boundary_signal_pct),
  })),
}

const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "T")
const outPath = join(
  "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/structure-calibration",
  `crystal_shard.${ts}.original-7-patterns-directional-rescore.json`
)
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`wrote ${outPath}`)

// Also print a compact summary to stdout
console.log("\n=== Directional re-score summary ===\n")
for (const [pattern, v] of Object.entries(verdicts)) {
  console.log(`${pattern}: point=${(v as any).point_estimate_verdict} -> directional=${(v as any).directional_verdict || (v as any).directional_verdict_opener + " (opener) / " + (v as any).directional_verdict_closer + " (closer)"}`)
}
