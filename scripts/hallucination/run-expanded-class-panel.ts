#!/usr/bin/env bun
/**
 * Run the v3+NER halluc-ungrounded checker on the expanded synthetic fixture
 * panel (L12 — 6 FAIL classes × ~3 fixtures + 4+ PASS controls).
 *
 * Produces:
 *   - A timestamped per-row results JSONL
 *   - A per-class recall/precision/F1 matrix printed to stdout
 *   - Persistence to `phase_eval_runs` when `--persist` is set
 *
 * Usage:
 *   bun scripts/hallucination/run-expanded-class-panel.ts \
 *     --in scripts/hallucination/expanded-fail-classes-panel.jsonl \
 *     --out /tmp/expanded-class-panel-results \
 *     [--persist] [--exp-id N] [--note STR]
 *
 * Output filename: <out>.<YYYYMMDDTHHMMSS>.jsonl  (timestamped, never overwritten).
 *
 * Per feedback_no_overwrite_runs: every run writes a new file.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { callAgent } from "../../src/llm"
import {
  HALLUC_UNGROUNDED_SYSTEM,
  hallucUngroundedSchema,
  runNerPrepass,
} from "../../src/agents/halluc-ungrounded"
import { normalizeForGroundedMatch } from "../../src/lint/entity-candidates"

// ── Arg parsing ───────────────────────────────────────────────────────────────

interface Args {
  inPath: string
  outBase: string
  persist: boolean
  expId?: number
  note?: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let inPath = ""
  let outBase = ""
  let persist = false
  let expId: number | undefined
  let note: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") inPath = argv[++i]
    else if (argv[i] === "--out") outBase = argv[++i]
    else if (argv[i] === "--persist") persist = true
    else if (argv[i] === "--exp-id") expId = Number(argv[++i])
    else if (argv[i] === "--note") note = argv[++i]
  }
  if (!inPath || !outBase) {
    console.error("usage: --in <panel.jsonl> --out <base-path> [--persist [--exp-id N] [--note STR]]")
    process.exit(1)
  }
  return { inPath, outBase, persist, expId, note }
}

// ── NER grounded-surface builder ──────────────────────────────────────────────

/**
 * Build the NER grounded surface from the fixture's checker_request_meta,
 * mirroring the logic in `src/agents/halluc-ungrounded/index.ts`
 * `buildNerGroundedSet` but operating directly on the JSONL fixture shape.
 */
function buildGroundedSet(gs: any, beatChars: string[]): { lower: Set<string>; normalized: Set<string> } {
  const lower = new Set<string>()
  const normalized = new Set<string>()

  const allSources: string[] = [
    ...(gs.bible ?? []),
    ...(beatChars ?? []),
    ...(gs.from_brief ?? []),
    ...(gs.derived_outline_fact ?? []),
    ...(gs.derived_prior_beat ?? []),
    ...(gs.allowed_new_entities ?? []),
    ...(gs.planner_emitted ?? []),
  ]

  for (const raw of allSources) {
    if (typeof raw !== "string") continue
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const lo = trimmed.toLowerCase()
    lower.add(lo)
    const norm = normalizeForGroundedMatch(trimmed)
    if (norm.length > 0) normalized.add(norm)
    // Per-token shards
    const tokens = trimmed.split(/\s+/).filter(t => t.length > 0)
    for (const t of tokens) {
      const cleaned = t.replace(/[''](s|S)?$/, "").toLowerCase()
      if (cleaned.length > 0) lower.add(cleaned)
      const normT = normalizeForGroundedMatch(t)
      if (normT.length > 0) normalized.add(normT)
    }
  }

  return { lower, normalized }
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildPrompt(row: any): string {
  const meta = row.task.writer_request_meta ?? {}
  const gs = row.task.checker_request_meta?.groundedSources ?? {}
  const beatChars = (meta.beatCharacters ?? []) as string[]

  const briefLines = [
    `Summary: ${meta.beatDescription ?? ""}`,
    `Kind: action`,
    `POV: ${beatChars[0] ?? ""}`,
    `Characters: ${beatChars.join(", ")}`,
    `Setting: `,
  ]

  const bible: string[] = gs.bible ?? []
  const fromBrief: string[] = gs.from_brief ?? []
  const derivedFact: string[] = gs.derived_outline_fact ?? []
  const derivedPrior: string[] = gs.derived_prior_beat ?? []
  const allowedNew: string[] = gs.allowed_new_entities ?? []

  const worldBibleBlock = [
    "WORLD BIBLE (relevant, names only):",
    `  Locations: ${bible.join(", ") || "(none)"}`,
    `  Cultures:  (none)`,
    `  Systems:   (none)`,
    `  From-brief: ${fromBrief.join(", ") || "(none)"}`,
    `  Beat-entities: ${[...derivedFact, ...derivedPrior].join(", ") || "(none)"}`,
    `  Allowed-new-entities: ${allowedNew.join(", ") || "(none)"}`,
  ]

  const speakers = beatChars.map((n: string) => `${n}: `)

  return [
    "BEAT BRIEF:",
    ...briefLines.map(l => `  ${l}`),
    "",
    ...worldBibleBlock,
    "",
    "SPEAKERS:",
    ...(speakers.length > 0 ? speakers.map(s => `  ${s}`) : ["  (none)"]),
    "",
    "PROSE TO CHECK:",
    row.task.prose,
  ].join("\n")
}

// ── Per-class matrix ──────────────────────────────────────────────────────────

interface ClassCounts {
  TP: number; FP: number; FN: number; TN: number
}

function emptyClass(): ClassCounts { return { TP: 0, FP: 0, FN: 0, TN: 0 } }

function printMatrix(
  classCounts: Map<string, ClassCounts>,
  classExpected: Map<string, { fail: number; pass: number }>,
): void {
  const cols = ["class", "N_fail", "N_pass", "TP", "FP", "FN", "TN", "recall", "precision", "F1"]
  const rows: string[][] = []

  const totals: ClassCounts = emptyClass()

  for (const [cls, c] of classCounts) {
    const recall = c.TP / Math.max(1, c.TP + c.FN)
    const precision = c.TP / Math.max(1, c.TP + c.FP)
    const f1 = (2 * recall * precision) / Math.max(0.0001, recall + precision)
    const exp = classExpected.get(cls) ?? { fail: 0, pass: 0 }
    rows.push([
      cls,
      String(exp.fail),
      String(exp.pass),
      String(c.TP),
      String(c.FP),
      String(c.FN),
      String(c.TN),
      (recall * 100).toFixed(0) + "%",
      (precision * 100).toFixed(0) + "%",
      (f1 * 100).toFixed(0) + "%",
    ])
    totals.TP += c.TP; totals.FP += c.FP; totals.FN += c.FN; totals.TN += c.TN
  }

  // Totals row
  const tRecall = totals.TP / Math.max(1, totals.TP + totals.FN)
  const tPrecision = totals.TP / Math.max(1, totals.TP + totals.FP)
  const tF1 = (2 * tRecall * tPrecision) / Math.max(0.0001, tRecall + tPrecision)
  const totalFail = [...classExpected.values()].reduce((s, v) => s + v.fail, 0)
  const totalPass = [...classExpected.values()].reduce((s, v) => s + v.pass, 0)
  rows.push([
    "TOTAL",
    String(totalFail),
    String(totalPass),
    String(totals.TP),
    String(totals.FP),
    String(totals.FN),
    String(totals.TN),
    (tRecall * 100).toFixed(0) + "%",
    (tPrecision * 100).toFixed(0) + "%",
    (tF1 * 100).toFixed(0) + "%",
  ])

  // Compute column widths
  const widths = cols.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
  const sep = widths.map(w => "-".repeat(w + 2)).join("+")
  const header = "| " + cols.map((h, i) => h.padEnd(widths[i])).join(" | ") + " |"

  console.log("\n## Per-class recall/precision matrix")
  console.log(header)
  console.log("|-" + sep + "-|")
  for (const r of rows) {
    const isTotals = r[0] === "TOTAL"
    if (isTotals) console.log("|-" + sep + "-|")
    console.log("| " + r.map((v, i) => v.padEnd(widths[i])).join(" | ") + " |")
  }
  console.log()
}

function buildCalibrationMatrix(
  classCounts: Map<string, ClassCounts>,
  classExpected: Map<string, { fail: number; pass: number }>,
): any {
  const out: Record<string, any> = {}
  for (const [cls, c] of classCounts) {
    const recall = c.TP / Math.max(1, c.TP + c.FN)
    const precision = c.TP / Math.max(1, c.TP + c.FP)
    const f1 = (2 * recall * precision) / Math.max(0.0001, recall + precision)
    const exp = classExpected.get(cls) ?? { fail: 0, pass: 0 }
    out[cls] = {
      n_fail: exp.fail, n_pass: exp.pass,
      TP: c.TP, FP: c.FP, FN: c.FN, TN: c.TN,
      recall_pct: Math.round(recall * 1000) / 10,
      precision_pct: Math.round(precision * 1000) / 10,
      f1_pct: Math.round(f1 * 1000) / 10,
    }
  }
  return out
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()

  // Timestamped output filename
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "T").slice(0, 15)
  const outPath = resolve(`${args.outBase}.${ts}.jsonl`)

  const lines = readFileSync(resolve(args.inPath), "utf8").trim().split("\n")
  const rows = lines.map(l => JSON.parse(l))
  console.log(`Loaded ${rows.length} fixtures from ${args.inPath}`)
  console.log(`Writing results to ${outPath}\n`)

  const results: any[] = []
  const classCounts = new Map<string, ClassCounts>()
  const classExpected = new Map<string, { fail: number; pass: number }>()

  // Track per-class expected counts from the panel
  for (const row of rows) {
    const cls = row.fixture_class ?? "unknown"
    if (!classExpected.has(cls)) classExpected.set(cls, { fail: 0, pass: 0 })
    const exp = classExpected.get(cls)!
    if (row.gold.expected_pass === false) exp.fail++
    else exp.pass++
  }

  for (const row of rows) {
    const cls = row.fixture_class ?? "unknown"
    if (!classCounts.has(cls)) classCounts.set(cls, emptyClass())
    const counts = classCounts.get(cls)!

    // Build NER grounded surface
    const gs = row.task.checker_request_meta?.groundedSources ?? {}
    const beatChars: string[] = row.task.writer_request_meta?.beatCharacters ?? []
    const groundedSurface = buildGroundedSet(gs, beatChars)

    // Run NER prepass
    const nerUngrounded = runNerPrepass(row.task.prose, groundedSurface)
    const nerFires = nerUngrounded.length > 0

    // Build LLM prompt and call
    const userPrompt = buildPrompt(row)
    let llmOutput: any = null
    let llmError: string | null = null
    try {
      const result = await callAgent({
        agentName: "halluc-ungrounded" as const,
        systemPrompt: HALLUC_UNGROUNDED_SYSTEM,
        userPrompt,
        schema: hallucUngroundedSchema,
      })
      llmOutput = result.output
    } catch (err) {
      llmError = err instanceof Error ? err.message : String(err)
    }

    const llmPass = llmOutput?.pass ?? true  // default pass on error (conservative for FP analysis)
    const llmFires = !llmPass

    // AND-gate final decision (mirrors production logic)
    let finalPass: boolean
    let gateDecision: string
    if (nerFires && llmFires) {
      finalPass = false
      gateDecision = "NER+LLM-blocker"
    } else if (nerFires && !llmFires) {
      finalPass = false
      gateDecision = "NER-only-warning"
    } else if (!nerFires && llmFires) {
      finalPass = false
      gateDecision = "LLM-only-blocker"
    } else {
      finalPass = true
      gateDecision = "PASS"
    }

    const expectedPass = row.gold.expected_pass
    let calibStatus: string
    if (expectedPass === false && finalPass === false) { calibStatus = "TP"; counts.TP++ }
    else if (expectedPass === false && finalPass === true) { calibStatus = "FN"; counts.FN++ }
    else if (expectedPass === true && finalPass === false) { calibStatus = "FP"; counts.FP++ }
    else { calibStatus = "TN"; counts.TN++ }

    const rowResult = {
      fixture_id: row.case_id,
      fixture_class: cls,
      oracle_label: row.oracle_label,
      expected_pass: expectedPass,
      ner_fires: nerFires,
      ner_ungrounded: nerUngrounded.map(c => ({ phrase: c.phrase, class: c.class })),
      llm_pass: llmPass,
      llm_issues: llmOutput?.issues ?? [],
      llm_error: llmError,
      gate_decision: gateDecision,
      final_pass: finalPass,
      calibration_status: calibStatus,
    }
    results.push(rowResult)
    console.log(`  ${row.case_id.padEnd(40)} cls=${cls.padEnd(30)} ${calibStatus.padEnd(3)} gate=${gateDecision}`)
  }

  writeFileSync(outPath, results.map(r => JSON.stringify(r)).join("\n") + "\n")
  console.log(`\nWrote ${results.length} results to ${outPath}`)

  printMatrix(classCounts, classExpected)

  // Detailed FN/FP analysis
  const fns = results.filter(r => r.calibration_status === "FN")
  const fps = results.filter(r => r.calibration_status === "FP")
  if (fns.length > 0) {
    console.log("## False Negatives (missed hallucinations):")
    for (const r of fns) {
      console.log(`  [FN] ${r.fixture_id} (${r.fixture_class}) — NER:${r.ner_fires ? "fire" : "pass"}, LLM:${r.llm_pass ? "pass" : "fire"}`)
      if (r.ner_ungrounded.length > 0) {
        console.log(`       NER candidates: ${r.ner_ungrounded.map((c: any) => `"${c.phrase}" (${c.class})`).join(", ")}`)
      }
      if (r.llm_issues.length > 0) {
        console.log(`       LLM issues: ${r.llm_issues.map((i: any) => `"${i.entity}"`).join(", ")}`)
      }
    }
    console.log()
  }
  if (fps.length > 0) {
    console.log("## False Positives (wrongly flagged pass controls):")
    for (const r of fps) {
      console.log(`  [FP] ${r.fixture_id} (${r.fixture_class}) — NER:${r.ner_fires ? "fire" : "pass"}, LLM:${r.llm_pass ? "pass" : "fire"}`)
      if (r.ner_ungrounded.length > 0) {
        console.log(`       NER candidates: ${r.ner_ungrounded.map((c: any) => `"${c.phrase}" (${c.class})`).join(", ")}`)
      }
    }
    console.log()
  }

  if (args.persist) {
    const { persistPhaseEvalRun, currentGitCommit } = await import("../phase-eval/persist-run")
    const calibrationMatrix = buildCalibrationMatrix(classCounts, classExpected)

    const totalTP = [...classCounts.values()].reduce((s, c) => s + c.TP, 0)
    const totalFN = [...classCounts.values()].reduce((s, c) => s + c.FN, 0)
    const totalFP = [...classCounts.values()].reduce((s, c) => s + c.FP, 0)
    const totalTN = [...classCounts.values()].reduce((s, c) => s + c.TN, 0)
    const overallRecall = totalTP / Math.max(1, totalTP + totalFN)
    const overallPrecision = totalTP / Math.max(1, totalTP + totalFP)
    const overallF1 = (2 * overallRecall * overallPrecision) / Math.max(0.0001, overallRecall + overallPrecision)

    const summary = {
      panel_path: args.inPath,
      n_total: results.length,
      n_fail_class_rows: results.filter(r => !r.expected_pass).length,
      n_pass_control_rows: results.filter(r => r.expected_pass).length,
      overall_TP: totalTP, overall_FP: totalFP, overall_FN: totalFN, overall_TN: totalTN,
      overall_recall_pct: Math.round(overallRecall * 1000) / 10,
      overall_precision_pct: Math.round(overallPrecision * 1000) / 10,
      overall_f1_pct: Math.round(overallF1 * 1000) / 10,
      calibration_matrix: calibrationMatrix,
      per_row_results: results,
    }

    const verdict = `expanded-synthetic-halluc recall=${(overallRecall * 100).toFixed(0)}% precision=${(overallPrecision * 100).toFixed(0)}% F1=${(overallF1 * 100).toFixed(0)}%`
    const runId = await persistPhaseEvalRun({
      probeName: "expanded-synthetic-halluc-per-class-matrix",
      gitCommit: currentGitCommit(),
      experimentId: args.expId ?? null,
      seedsUsed: ["synthetic-L12"],
      variantLabels: ["v1+NER-prepass"],
      summaryJson: summary,
      verdict,
      notes: args.note ?? null,
    })
    console.log(`[persist] phase_eval_runs.id=${runId} probe=expanded-synthetic-halluc-per-class-matrix verdict=${verdict}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
