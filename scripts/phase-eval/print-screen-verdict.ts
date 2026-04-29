/**
 * Phase-eval screen verdict — implements the G1-G4 screen from
 * `docs/designs/phase-variant-comparison.md` (R5).
 *
 * Reads the summary.json produced by `probe-planning-beats.ts` + the
 * per-variant `outlines.json` files, validates each outline against
 * `chapterBeatsSchema`, applies the charter's ordered predicate table,
 * emits a verdict, and exits 0 (SCREEN-PASS) or 1 (SCREEN-FAIL).
 *
 * Charter R5 gates (per docs/designs/phase-variant-comparison.md §G):
 *   G1 (rich-facts directional uptake):
 *       loud_facts_median ≥ 1.5 × default_facts_median  AND
 *       loud_facts_median ≥ 8
 *   G2 (knowledge-changes directional uptake):
 *       loud_know_median ≥ 1.5 × default_know_median  AND
 *       loud_know_median ≥ 3
 *   G3 (beat-floor directional uptake):
 *       loud_total_beats ≥ 1.10 × default_total_beats
 *   G4 (structural validity):
 *       loud variant's planning phase produced N chapter outlines, all
 *       parsing against chapterBeatsSchema. N defaults to the seed's
 *       chapterCount (charter spec is 5; flexible per seed).
 *
 * Verdict order (first match wins, exhaustive):
 *   1. NOT G4                 → SCREEN-FAIL (broken)
 *   2. NOT (G1 AND G2 AND G3) → SCREEN-FAIL (non-compliant)
 *   3. G1 AND G2 AND G3 AND G4 → SCREEN-PASS
 *
 * Exit code: 0 for SCREEN-PASS, 1 for any SCREEN-FAIL.
 *
 * Default-variant metrics are reported for context (the charter records
 * both for re-thresholding) but the verdict is purely "did loud meet its
 * own riders?"
 *
 * Usage:
 *   bun scripts/phase-eval/print-screen-verdict.ts \
 *     --summary=<path-to-summary.json>
 */

import { readFileSync, existsSync } from "node:fs"
import { dirname, join, isAbsolute, basename } from "node:path"
import { chapterBeatsSchema } from "../../src/agents/planning-beats/schema"

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

type ParsedOutline = ReturnType<typeof chapterBeatsSchema.parse>

interface VariantData {
  id: string
  ok: boolean
  reason?: string
  outlines: ParsedOutline[]
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

function fmt(n: number, places = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(places)
}

/** Resolve the per-variant outlines.json path. Path-portable across
 *  cross-machine probes — relative paths anchor on the summary file's
 *  directory; absolute paths are tried as-is then fall back to the
 *  summaryDir + variant subdir layout for legacy summaries. */
function resolveOutlinesPath(summaryDir: string, v: VariantBlock): string | null {
  if (isAbsolute(v.outlinesPath)) {
    if (existsSync(v.outlinesPath)) return v.outlinesPath
    const local = join(summaryDir, v.id, basename(v.outlinesPath))
    return existsSync(local) ? local : null
  }
  const local = join(summaryDir, v.outlinesPath)
  return existsSync(local) ? local : null
}

function loadVariantData(summaryDir: string, v: VariantBlock, expectedChapters: number): VariantData {
  const path = resolveOutlinesPath(summaryDir, v)
  if (!path) {
    return { id: v.id, ok: false, reason: `outlines.json not found (tried abs=${v.outlinesPath} and ${join(summaryDir, v.id, "outlines.json")})`, outlines: [] }
  }
  let blob: any
  try {
    blob = JSON.parse(readFileSync(path, "utf-8"))
  } catch (e: any) {
    return { id: v.id, ok: false, reason: `JSON parse error in ${path}: ${e?.message ?? e}`, outlines: [] }
  }
  const raw = (blob.outlines ?? []) as unknown[]
  if (raw.length !== expectedChapters) {
    return {
      id: v.id,
      ok: false,
      reason: `expected ${expectedChapters} chapter outlines, got ${raw.length}`,
      outlines: [],
    }
  }
  const parsed: ParsedOutline[] = []
  for (let i = 0; i < raw.length; i++) {
    const result = chapterBeatsSchema.safeParse(raw[i])
    if (!result.success) {
      return {
        id: v.id,
        ok: false,
        reason: `chapter ${i + 1} fails chapterBeatsSchema: ${result.error.issues.slice(0, 3).map(e => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
        outlines: [],
      }
    }
    parsed.push(result.data)
  }
  return { id: v.id, ok: true, outlines: parsed }
}

function readSeedChapterCount(seedName: string, charterDefault: number): number {
  // Anchor seed lookups on the project root; charter R5 specifies 5 chapters.
  const seedPath = join(import.meta.dir, "..", "..", "src", "seeds", `${seedName}.json`)
  if (!existsSync(seedPath)) {
    console.error(`[verdict] WARN: seed file not found at ${seedPath}; falling back to charter default ${charterDefault}`)
    return charterDefault
  }
  try {
    const seed = JSON.parse(readFileSync(seedPath, "utf-8"))
    const n = Number(seed?.chapterCount)
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`[verdict] WARN: seed.chapterCount missing or invalid; falling back to charter default ${charterDefault}`)
      return charterDefault
    }
    return n
  } catch (e: any) {
    console.error(`[verdict] WARN: could not parse seed file ${seedPath}: ${e?.message ?? e}; falling back to charter default ${charterDefault}`)
    return charterDefault
  }
}

function main(): void {
  const summaryArg = process.argv.find(a => a.startsWith("--summary="))
  if (!summaryArg) {
    console.error("usage: bun print-screen-verdict.ts --summary=<path-to-summary.json>")
    process.exit(2)
  }
  const summaryPath = summaryArg.split("=", 2)[1]!
  if (!existsSync(summaryPath)) {
    console.error(`summary not found: ${summaryPath}`)
    process.exit(2)
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf-8")) as Summary
  const summaryDir = dirname(summaryPath)

  const expectedChapters = readSeedChapterCount(summary.seed, 5)
  console.log(`Phase-eval screen — seed=${summary.seed} run=${summary.runTag}`)
  console.log(`Concept snapshot: ${summary.conceptSnapshotId}`)
  console.log(`Expected chapters per variant: ${expectedChapters} (from src/seeds/${summary.seed}.json)`)
  console.log(`Variants: ${summary.variants.map(v => v.id).join(", ")}`)
  console.log()

  // Charter assumes a "default" + "loud" pair. Locate them.
  const defaultV = summary.variants.find(v => v.id === "default")
  const loudV = summary.variants.find(v => v.id === "loud")
  if (!defaultV || !loudV) {
    console.error(`SCREEN-FAIL (broken): summary.json must contain variants id="default" and id="loud" (got ${summary.variants.map(v => v.id).join(", ")})`)
    process.exit(1)
  }

  const def = loadVariantData(summaryDir, defaultV, expectedChapters)
  const loud = loadVariantData(summaryDir, loudV, expectedChapters)

  // ── Compute metrics ─────────────────────────────────────────────────
  const def_facts = def.ok ? def.outlines.map(o => o.establishedFacts.length) : []
  const def_know = def.ok ? def.outlines.map(o => o.knowledgeChanges.length) : []
  const def_beats = def.ok ? def.outlines.map(o => o.scenes.length) : []
  const loud_facts = loud.ok ? loud.outlines.map(o => o.establishedFacts.length) : []
  const loud_know = loud.ok ? loud.outlines.map(o => o.knowledgeChanges.length) : []
  const loud_beats = loud.ok ? loud.outlines.map(o => o.scenes.length) : []

  const m = {
    default_facts_median: median(def_facts),
    loud_facts_median: median(loud_facts),
    default_know_median: median(def_know),
    loud_know_median: median(loud_know),
    default_total_beats: sum(def_beats),
    loud_total_beats: sum(loud_beats),
  }

  // ── Apply gates ─────────────────────────────────────────────────────
  // G4 first because it's the predicate-1 gate.
  const G4 = loud.ok
  // G1: loud_facts_median ≥ 1.5 × default AND loud_facts_median ≥ 8
  const G1 = m.loud_facts_median >= 1.5 * m.default_facts_median && m.loud_facts_median >= 8
  // G2: loud_know_median ≥ 1.5 × default AND loud_know_median ≥ 3
  const G2 = m.loud_know_median >= 1.5 * m.default_know_median && m.loud_know_median >= 3
  // G3: loud_total_beats ≥ 1.10 × default
  const G3 = m.loud_total_beats >= 1.10 * m.default_total_beats

  // ── Print metrics ───────────────────────────────────────────────────
  console.log("Metrics:")
  console.log(`  default: facts_median=${fmt(m.default_facts_median)}  know_median=${fmt(m.default_know_median)}  total_beats=${m.default_total_beats}  status=${def.ok ? "ok" : `BROKEN (${def.reason})`}`)
  console.log(`  loud:    facts_median=${fmt(m.loud_facts_median)}  know_median=${fmt(m.loud_know_median)}  total_beats=${m.loud_total_beats}  status=${loud.ok ? "ok" : `BROKEN (${loud.reason})`}`)
  console.log()
  console.log("Gate evaluation:")
  console.log(`  G1 rich-facts:        loud_facts_median (${fmt(m.loud_facts_median)}) ≥ 1.5 × default_facts_median (${fmt(1.5 * m.default_facts_median)}) AND ≥ 8       → ${G1 ? "PASS" : "FAIL"}`)
  console.log(`  G2 knowledge-changes: loud_know_median (${fmt(m.loud_know_median)}) ≥ 1.5 × default_know_median (${fmt(1.5 * m.default_know_median)}) AND ≥ 3        → ${G2 ? "PASS" : "FAIL"}`)
  console.log(`  G3 beat-floor:        loud_total_beats (${m.loud_total_beats}) ≥ 1.10 × default_total_beats (${fmt(1.10 * m.default_total_beats)})                                  → ${G3 ? "PASS" : "FAIL"}`)
  console.log(`  G4 structural:        loud planning complete + ${expectedChapters} outlines parse                                                                  → ${G4 ? "PASS" : "FAIL"}`)
  console.log()

  // ── Apply ordered predicate table (charter §G) ──────────────────────
  let verdict: string
  let exitCode: number
  if (!G4) {
    verdict = `SCREEN-FAIL (broken) — loud variant did not produce ${expectedChapters} parseable chapter outlines${loud.reason ? `: ${loud.reason}` : ""}`
    exitCode = 1
  } else if (!(G1 && G2 && G3)) {
    const failed = [!G1 && "G1", !G2 && "G2", !G3 && "G3"].filter(Boolean).join(", ")
    verdict = `SCREEN-FAIL (non-compliant) — loud variant ran but failed: ${failed}`
    exitCode = 1
  } else {
    verdict = "SCREEN-PASS — loud variant cleared G1, G2, G3, G4"
    exitCode = 0
  }

  console.log(`Verdict: ${verdict}`)
  console.log(`Exit: ${exitCode}`)
  process.exit(exitCode)
}

main()
