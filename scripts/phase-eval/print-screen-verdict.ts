/**
 * Phase-eval screen verdict — implements the G1-G4 screen from
 * `docs/designs/phase-variant-comparison.md` (R5) for a selected
 * control/test variant pair.
 *
 * Reads the summary.json produced by `probe-planning-beats.ts` + the
 * per-variant `outlines.json` files, validates each outline against
 * `chapterBeatsSchema`, applies the charter's ordered predicate table,
 * emits a verdict, and exits 0 (SCREEN-PASS) or 1 (SCREEN-FAIL).
 *
 * Charter R5 gates (per docs/designs/phase-variant-comparison.md §G):
 *   G1 (rich-facts directional uptake):
 *       test_facts_median ≥ 1.5 × control_facts_median  AND
 *       test_facts_median ≥ 8
 *   G2 (knowledge-changes directional uptake):
 *       test_know_median ≥ 1.5 × control_know_median  AND
 *       test_know_median ≥ 3
 *   G3 (beat-floor directional uptake):
 *       test_total_beats ≥ 1.10 × control_total_beats
 *   G4 (structural validity):
 *       test variant's planning phase produced N chapter outlines, all
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
 * Control-variant metrics are reported for context (the charter records
 * both for re-thresholding) but the verdict is purely "did test meet its
 * own riders?" Defaults remain control=default, test=loud for backward
 * compatibility with the original R5 probe.
 *
 * Usage:
 *   bun scripts/phase-eval/print-screen-verdict.ts \
 *     --summary=<path-to-summary.json> \
 *     [--control=<variant-id>]        default: default
 *     [--test=<variant-id>]           default: loud
 *     [--persist]                    persist a row to phase_eval_runs
 *     [--exp-id=<n>]                 link the row to a tuning_experiments id
 *     [--note='...']                 free-text operator note
 *
 * Persistence is OFF by default — without --persist this script behaves
 * exactly as before (stdout + exit code only). With --persist, after
 * computing the verdict, an append-only row is INSERTed into
 * phase_eval_runs (see sql/033_phase_eval_runs.sql). See
 * docs/designs/eval-testing-module-v1.md (R6).
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

interface Args {
  summaryPath: string
  controlId: string
  testId: string
  persist: boolean
  expId?: number
  note?: string
}

function valueAfter(arg: string, prefix: string): string | undefined {
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : undefined
}

function usage(): string {
  return "usage: bun print-screen-verdict.ts --summary=<path-to-summary.json> [--control=<variant-id>] [--test=<variant-id>] [--persist] [--exp-id=<n>] [--note='...']"
}

function parseArgs(argv: string[]): Args {
  const summaryPath = argv.map(a => valueAfter(a, "--summary=")).find((v): v is string => v !== undefined)
  if (!summaryPath) {
    console.error(usage())
    process.exit(2)
  }

  const controlId = argv.map(a => valueAfter(a, "--control=")).find((v): v is string => v !== undefined) ?? "default"
  const testId = argv.map(a => valueAfter(a, "--test=")).find((v): v is string => v !== undefined) ?? "loud"
  if (controlId === testId) {
    console.error(`--control and --test must differ, got: ${controlId}`)
    process.exit(2)
  }

  const expIdRaw = argv.map(a => valueAfter(a, "--exp-id=")).find((v): v is string => v !== undefined)
  const expId = expIdRaw === undefined ? undefined : Number(expIdRaw)
  if (expIdRaw !== undefined && !Number.isFinite(expId)) {
    console.error(`--exp-id must be an integer, got: ${expIdRaw}`)
    process.exit(2)
  }

  return {
    summaryPath,
    controlId,
    testId,
    persist: argv.includes("--persist"),
    expId,
    note: argv.map(a => valueAfter(a, "--note=")).find((v): v is string => v !== undefined),
  }
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const summaryPath = args.summaryPath
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
  console.log(`Comparison: control=${args.controlId} test=${args.testId}`)
  console.log()

  const controlV = summary.variants.find(v => v.id === args.controlId)
  const testV = summary.variants.find(v => v.id === args.testId)
  if (!controlV || !testV) {
    const missing = [!controlV && args.controlId, !testV && args.testId].filter(Boolean).join(", ")
    console.error(`SCREEN-FAIL (broken): summary.json missing selected variant(s): ${missing} (available: ${summary.variants.map(v => v.id).join(", ")})`)
    process.exit(1)
  }

  const control = loadVariantData(summaryDir, controlV, expectedChapters)
  const test = loadVariantData(summaryDir, testV, expectedChapters)

  // ── Compute metrics ─────────────────────────────────────────────────
  const controlFacts = control.ok ? control.outlines.map(o => o.establishedFacts.length) : []
  const controlKnow = control.ok ? control.outlines.map(o => o.knowledgeChanges.length) : []
  const controlBeats = control.ok ? control.outlines.map(o => o.scenes.length) : []
  const testFacts = test.ok ? test.outlines.map(o => o.establishedFacts.length) : []
  const testKnow = test.ok ? test.outlines.map(o => o.knowledgeChanges.length) : []
  const testBeats = test.ok ? test.outlines.map(o => o.scenes.length) : []

  const m = {
    control_facts_median: median(controlFacts),
    test_facts_median: median(testFacts),
    control_know_median: median(controlKnow),
    test_know_median: median(testKnow),
    control_total_beats: sum(controlBeats),
    test_total_beats: sum(testBeats),
  }

  // ── Apply gates ─────────────────────────────────────────────────────
  // G4 first because it's the predicate-1 gate.
  const G4 = test.ok
  // G1: test_facts_median ≥ 1.5 × control AND test_facts_median ≥ 8
  const G1 = m.test_facts_median >= 1.5 * m.control_facts_median && m.test_facts_median >= 8
  // G2: test_know_median ≥ 1.5 × control AND test_know_median ≥ 3
  const G2 = m.test_know_median >= 1.5 * m.control_know_median && m.test_know_median >= 3
  // G3: test_total_beats ≥ 1.10 × control
  const G3 = m.test_total_beats >= 1.10 * m.control_total_beats

  // ── Print metrics ───────────────────────────────────────────────────
  console.log("Metrics:")
  console.log(`  ${args.controlId}: facts_median=${fmt(m.control_facts_median)}  know_median=${fmt(m.control_know_median)}  total_beats=${m.control_total_beats}  status=${control.ok ? "ok" : `BROKEN (${control.reason})`}`)
  console.log(`  ${args.testId}: facts_median=${fmt(m.test_facts_median)}  know_median=${fmt(m.test_know_median)}  total_beats=${m.test_total_beats}  status=${test.ok ? "ok" : `BROKEN (${test.reason})`}`)
  console.log()
  console.log("Gate evaluation:")
  console.log(`  G1 rich-facts:        ${args.testId}_facts_median (${fmt(m.test_facts_median)}) ≥ 1.5 × ${args.controlId}_facts_median (${fmt(1.5 * m.control_facts_median)}) AND ≥ 8       → ${G1 ? "PASS" : "FAIL"}`)
  console.log(`  G2 knowledge-changes: ${args.testId}_know_median (${fmt(m.test_know_median)}) ≥ 1.5 × ${args.controlId}_know_median (${fmt(1.5 * m.control_know_median)}) AND ≥ 3        → ${G2 ? "PASS" : "FAIL"}`)
  console.log(`  G3 beat-floor:        ${args.testId}_total_beats (${m.test_total_beats}) ≥ 1.10 × ${args.controlId}_total_beats (${fmt(1.10 * m.control_total_beats)})                                  → ${G3 ? "PASS" : "FAIL"}`)
  console.log(`  G4 structural:        ${args.testId} planning complete + ${expectedChapters} outlines parse                                                                  → ${G4 ? "PASS" : "FAIL"}`)
  console.log()

  // ── Apply ordered predicate table (charter §G) ──────────────────────
  let verdict: string
  let exitCode: number
  if (!G4) {
    verdict = `SCREEN-FAIL (broken) — ${args.testId} variant did not produce ${expectedChapters} parseable chapter outlines${test.reason ? `: ${test.reason}` : ""}`
    exitCode = 1
  } else if (!(G1 && G2 && G3)) {
    const failed = [!G1 && "G1", !G2 && "G2", !G3 && "G3"].filter(Boolean).join(", ")
    verdict = `SCREEN-FAIL (non-compliant) — ${args.testId} variant ran but failed: ${failed}`
    exitCode = 1
  } else {
    verdict = `SCREEN-PASS — ${args.testId} variant cleared G1, G2, G3, G4`
    exitCode = 0
  }

  console.log(`Verdict: ${verdict}`)
  console.log(`Exit: ${exitCode}`)

  // R6 persistence (optional, OFF by default). After verdict + metrics
  // are computed and printed, INSERT a single row into phase_eval_runs
  // mirroring the augmented summary + verdict line. See
  // docs/designs/eval-testing-module-v1.md §5.
  if (args.persist) {
    const { persistPhaseEvalRun, currentGitCommit } = await import("./persist-run")
    const augmentedSummary = {
      ...summary,
      control_variant: args.controlId,
      test_variant: args.testId,
      g_metrics: m,
      gates: { G1, G2, G3, G4 },
      expected_chapters: expectedChapters,
    }
    try {
      const runId = await persistPhaseEvalRun({
        probeName: "phase-variant-comparison",
        gitCommit: currentGitCommit(),
        experimentId: args.expId ?? null,
        seedsUsed: [summary.seed],
        variantLabels: summary.variants.map(v => v.id),
        summaryJson: augmentedSummary,
        verdict,
        notes: args.note ?? null,
      })
      console.log(`Persisted as phase_eval_runs.id=${runId}`)
    } catch (err) {
      // Persistence failure must NOT mask the verdict. Print + exit
      // with the verdict's own exit code; the operator can re-persist
      // later with the same summary file if needed.
      console.error(`[verdict] WARN: --persist failed: ${(err as Error).message}`)
    }
  }

  process.exit(exitCode)
}

main().catch(err => {
  console.error("[verdict] fatal:", err)
  process.exit(1)
})
