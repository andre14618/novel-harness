/**
 * Aggregate the 20 Sonnet labeling batches into a single results JSONL and
 * print the overall match rate + per-variant breakdown. Decides which pairs
 * are acceptable for v2 training (match=true) vs which need flipping or
 * dropping (match=false).
 *
 * Usage:
 *   bun scripts/hallucination/aggregate-label-results.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs"
import { join } from "path"

const DIR = "/tmp/halluc-label"
const OUT = join(DIR, "combined.jsonl")

if (!existsSync(DIR)) {
  console.error(`${DIR} does not exist`)
  process.exit(1)
}

const files = readdirSync(DIR).filter(f => f.startsWith("results_") && f.endsWith(".jsonl")).sort()
console.log(`Found ${files.length} result files`)

interface LabelResult {
  idx: number
  scenario: string
  variant: string
  subcase: string | null
  found: { pass: boolean; issues: any[] }
  expected: { pass: boolean; issues: any[] }
  match: boolean
  note: string | null
}

const all: LabelResult[] = []
const missingFiles: string[] = []
for (const f of files) {
  const text = readFileSync(join(DIR, f), "utf8").trim()
  if (!text) { missingFiles.push(f); continue }
  for (const l of text.split("\n")) all.push(JSON.parse(l))
}

writeFileSync(OUT, all.map(r => JSON.stringify(r)).join("\n") + "\n")

const total = all.length
const match = all.filter(r => r.match).length
const mismatch = all.filter(r => !r.match).length
const passClass = all.filter(r => r.expected.pass).length
const failClass = all.filter(r => !r.expected.pass).length

console.log(`\n── OVERALL ──`)
console.log(`total: ${total}   match: ${match} (${(match/total*100).toFixed(1)}%)   mismatch: ${mismatch}`)
console.log(`class balance: ${passClass} expected PASS / ${failClass} expected FAIL`)

// Per-variant breakdown
const byVariant: Record<string, { total: number; match: number }> = {}
for (const r of all) {
  const v = r.variant
  byVariant[v] ??= { total: 0, match: 0 }
  byVariant[v].total++
  if (r.match) byVariant[v].match++
}

console.log(`\n── PER VARIANT ──`)
for (const [v, s] of Object.entries(byVariant).sort()) {
  const pct = (s.match / s.total * 100).toFixed(1)
  const bar = "█".repeat(Math.round(s.match / s.total * 20))
  console.log(`  ${v.padEnd(28)} ${s.match}/${s.total} (${pct}%) ${bar}`)
}

// Per-scenario mismatch count
const scenarioMismatch: Record<string, number> = {}
for (const r of all) if (!r.match) scenarioMismatch[r.scenario] = (scenarioMismatch[r.scenario] ?? 0) + 1
const sortedScenarioMismatch = Object.entries(scenarioMismatch).sort((a, b) => b[1] - a[1])

console.log(`\n── SCENARIOS WITH MISMATCHES ──`)
for (const [scen, n] of sortedScenarioMismatch) {
  console.log(`  ${scen}: ${n}`)
}

// List mismatches with notes
console.log(`\n── MISMATCH DETAILS ──`)
for (const r of all.filter(x => !x.match).sort((a, b) => a.idx - b.idx)) {
  console.log(`  idx=${r.idx} ${r.scenario}/${r.variant}${r.subcase ? `(${r.subcase})` : ""}  exp=${r.expected.pass ? "PASS" : "FAIL"} got=${r.found.pass ? "PASS" : "FAIL"}`)
  if (r.note) console.log(`    ${r.note}`)
}

// Decision classes
console.log(`\n── DECISION CLASSES ──`)
const bySonnet = all.filter(r => r.found.pass).length
const bySonnetFail = all.filter(r => !r.found.pass).length
console.log(`Sonnet says PASS: ${bySonnet}   Sonnet says FAIL: ${bySonnetFail}`)
console.log(`\nCombined output: ${OUT}`)
if (missingFiles.length) console.log(`Empty result files: ${missingFiles.join(", ")}`)
