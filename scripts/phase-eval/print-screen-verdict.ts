/**
 * Phase-eval screen verdict — print G1-G4 metrics across variants.
 *
 * Reads the summary.json produced by `probe-planning-beats.ts` and the
 * per-variant `outlines.json` files, computes the four directional gates
 * defined in `docs/designs/phase-variant-comparison.md` (R5):
 *
 *   G1: chapter-level establishedFacts median (volume of named facts)
 *   G2: knowledgeChanges count (volume of information transfers)
 *   G3: scenes (beat) count (planner volume)
 *   G4: characterStateChanges count (volume of state-change rows)
 *
 * Charter R5 framing: this is a directional movement signal between the
 * control variant and each test variant — NOT a compliance gate. With
 * N=5-chapters per variant the moves are coarse (integer-chapter-count
 * space). The verdict is printed for human review, not used as a hard
 * SHIP/KILL boundary.
 *
 * Usage:
 *   bun scripts/phase-eval/print-screen-verdict.ts --summary=<path-to-summary.json>
 */

import { readFileSync, existsSync } from "node:fs"
import { dirname, basename, join, isAbsolute } from "node:path"

interface ChapterOutline {
  scenes?: Array<unknown>
  establishedFacts?: Array<unknown>
  characterStateChanges?: Array<unknown>
  knowledgeChanges?: Array<unknown>
}

interface VariantBlock {
  id: string
  promptFile: string
  novelId?: string
  outlinesPath: string
}

interface Summary {
  seed: string
  runTag: string
  conceptSnapshotId: string
  variantDir: string
  variants: VariantBlock[]
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function metricsForVariant(outlinesPath: string): {
  chapters: number
  factsPerChapter: number[]
  knowledgePerChapter: number[]
  beatsPerChapter: number[]
  stateChangesPerChapter: number[]
} {
  const blob = JSON.parse(readFileSync(outlinesPath, "utf-8"))
  const outlines = (blob.outlines ?? []) as ChapterOutline[]
  return {
    chapters: outlines.length,
    factsPerChapter: outlines.map(o => (o.establishedFacts ?? []).length),
    knowledgePerChapter: outlines.map(o => (o.knowledgeChanges ?? []).length),
    beatsPerChapter: outlines.map(o => (o.scenes ?? []).length),
    stateChangesPerChapter: outlines.map(o => (o.characterStateChanges ?? []).length),
  }
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length)
}
function fmt(n: number, places = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(places)
}

function main() {
  const summaryArg = process.argv.find(a => a.startsWith("--summary="))
  if (!summaryArg) {
    console.error("usage: bun print-screen-verdict.ts --summary=<path-to-summary.json>")
    process.exit(2)
  }
  const summaryPath = summaryArg.split("=", 2)[1]!
  const summary = JSON.parse(readFileSync(summaryPath, "utf-8")) as Summary
  // Path portability: outlinesPath in summary.json may be absolute (LXC
  // path) when the probe ran on the executor and we rsync'd the output
  // tree to local. If the absolute path doesn't exist, fall back to
  // resolving the per-variant outlines.json relative to the summary file.
  const summaryDir = dirname(summaryPath)
  const resolveOutlinesPath = (v: VariantBlock): string => {
    if (isAbsolute(v.outlinesPath)) {
      if (existsSync(v.outlinesPath)) return v.outlinesPath
      // Legacy: summary.json from cross-machine run carried absolute LXC path.
      // Fall back to summaryDir + variant subdir + outlines.json.
      const local = join(summaryDir, v.id, basename(v.outlinesPath))
      if (existsSync(local)) return local
      throw new Error(`outlines not found for variant ${v.id}: tried ${v.outlinesPath} and ${local}`)
    }
    const local = join(summaryDir, v.outlinesPath)
    if (existsSync(local)) return local
    throw new Error(`outlines not found for variant ${v.id}: ${local}`)
  }

  console.log(`Phase-eval screen verdict — seed=${summary.seed} run=${summary.runTag}`)
  console.log(`Concept snapshot: ${summary.conceptSnapshotId}`)
  console.log(`Variants: ${summary.variants.map(v => v.id).join(", ")}\n`)

  const perVariant: Record<string, ReturnType<typeof metricsForVariant>> = {}
  for (const v of summary.variants) {
    perVariant[v.id] = metricsForVariant(resolveOutlinesPath(v))
  }

  const headers = ["variant", "chapters", "G3 beats/ch (mean)", "G1 facts/ch (median)", "G2 know/ch (mean)", "G4 state/ch (mean)"]
  const widths = [12, 10, 22, 24, 20, 22]
  const headerLine = headers.map((h, i) => pad(h, widths[i]!)).join("")
  console.log(headerLine)
  console.log("-".repeat(headerLine.length))
  for (const v of summary.variants) {
    const m = perVariant[v.id]!
    const cols = [
      v.id,
      String(m.chapters),
      fmt(mean(m.beatsPerChapter)),
      fmt(median(m.factsPerChapter)),
      fmt(mean(m.knowledgePerChapter)),
      fmt(mean(m.stateChangesPerChapter)),
    ]
    console.log(cols.map((c, i) => pad(c, widths[i]!)).join(""))
  }

  // Pairwise deltas — control = first variant in --variants list.
  const control = summary.variants[0]
  if (!control || summary.variants.length < 2) {
    console.log("\n(no test variants — only control supplied; nothing to compare)")
    return
  }
  const c = perVariant[control.id]!
  console.log(`\nDirectional movement (test - control), control=${control.id}:`)
  for (const v of summary.variants.slice(1)) {
    const m = perVariant[v.id]!
    const dG1 = median(m.factsPerChapter) - median(c.factsPerChapter)
    const dG2 = mean(m.knowledgePerChapter) - mean(c.knowledgePerChapter)
    const dG3 = mean(m.beatsPerChapter) - mean(c.beatsPerChapter)
    const dG4 = mean(m.stateChangesPerChapter) - mean(c.stateChangesPerChapter)
    console.log(`  ${v.id}: ΔG1=${fmt(dG1)}  ΔG2=${fmt(dG2)}  ΔG3=${fmt(dG3)}  ΔG4=${fmt(dG4)}`)
  }
  console.log(`\nReminder (charter R5 §G): N=5 chapters per variant — these are directional, not compliance.`)
}

main()
