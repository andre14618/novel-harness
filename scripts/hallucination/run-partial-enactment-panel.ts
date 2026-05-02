#!/usr/bin/env bun
/**
 * Partial-enactment adherence panel runner (L18).
 *
 * Runs the live two-stage `checkBeatAdherence` (commit ae50e99) against
 * every row in the synthetic partial-enactment panel built in L18.
 *
 * Computes:
 *   1. Binary TP/FP/FN/TN at panel level
 *   2. Per-shape recall / precision / F1 matrix
 *   3. Per-event detail correctness: for each FAIL row where stage 2 fires,
 *      was the missing/substituted event correctly identified?
 *
 * Usage:
 *   bun scripts/hallucination/run-partial-enactment-panel.ts \
 *     [--in scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl] \
 *     [--persist] [--exp-id N]
 *
 * Outputs (timestamped, never overwritten):
 *   /tmp/partial-enactment-panel-results-<YYYYMMDDTHHMMSS>.jsonl
 *   /tmp/partial-enactment-panel-results-<YYYYMMDDTHHMMSS>.summary.json
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { checkBeatAdherence } from "../../src/agents/writer/adherence-checker"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../src/types"

// ── Arg parsing ──────────────────────────────────────────────────────────────

interface Args {
  inPath: string
  persist: boolean
  expId?: number
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let inPath = resolve("scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl")
  let persist = false
  let expId: number | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") inPath = argv[++i]
    else if (argv[i] === "--persist") persist = true
    else if (argv[i] === "--exp-id") expId = Number(argv[++i])
  }
  return { inPath, persist, expId }
}

// ── Timestamp ────────────────────────────────────────────────────────────────

function timestamp(): string {
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "T" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  )
}

// ── Panel row shape ──────────────────────────────────────────────────────────

interface PartialEnactRow {
  fixture_id: string
  checker: string
  case_role: string
  source: string
  description: string
  fixture_shape: string
  oracle_label: string
  task: {
    prose: string
    writer_request_meta: {
      beatDescription: string
      beatCharacters: string[]
    }
  }
  gold: {
    expected_pass: boolean
    oracle_label: string
    obligated_events: string[]
    missing_events: string[]
    notes: string
  }
}

// ── Minimal stubs ────────────────────────────────────────────────────────────

function makeBeat(row: PartialEnactRow): SceneBeat {
  const meta = row.task.writer_request_meta
  return {
    description: meta.beatDescription,
    characters: meta.beatCharacters ?? [],
    kind: "action",
    obligations: {
      mustEstablish: [],
      mustPayOff: [],
      mustTransferKnowledge: [],
      mustShowStateChange: [],
      mustNotReveal: [],
      allowedNewEntities: [],
    },
    requiredPayoffs: [],
  }
}

function makeOutline(row: PartialEnactRow): ChapterOutline {
  // POV character: use first beat character to suppress the deterministic
  // character-presence check for the primary actor (who is always present in
  // these controlled fixtures — we want to test the LLM event check only).
  const pov = row.task.writer_request_meta.beatCharacters[0] ?? "POV"
  return {
    chapterNumber: 1,
    title: "Partial-Enactment Panel",
    summary: "",
    beats: [],
    povCharacter: pov,
    themes: [],
    openingHook: "",
    closingMoment: "",
    setting: "Archive",
    purpose: "panel",
    scenes: [],
    targetWords: 500,
    charactersPresent: [],
    charactersPresentIds: [],
    establishedFacts: [],
    characterStateChanges: [],
    knowledgeChanges: [],
  } as unknown as ChapterOutline
}

// ── Per-row result ───────────────────────────────────────────────────────────

interface RowResult {
  fixture_id: string
  fixture_shape: string
  oracle_label: string
  oracle_pass: boolean
  oracle_missing: string[]
  // Two-stage output
  checker_pass: boolean
  checker_issues: string[]
  // Classification
  binary_correct: boolean
  disposition: "TP" | "FP" | "FN" | "TN"
  // Stage-2 detail
  stage2_fired: boolean
  stage2_detail_count: number
  stage2_details: string[]
  stage2_has_quote_in_prose: boolean
  // Per-event correctness: did stage 2 name the expected missing event?
  // We do a simple substring-match between oracle missing event text and
  // the stage-2 detail strings (case-insensitive, first 30 chars of event key).
  stage2_correctly_identified_missing: boolean
}

function checkStage2IdentifiedMissing(
  oracleMissing: string[],
  stage2Details: string[],
): boolean {
  if (oracleMissing.length === 0) return true  // PASS fixture, nothing to identify
  if (stage2Details.length === 0) return false
  // For each oracle-missing event, check if any stage-2 detail contains a
  // meaningful substring match against the event key (first 40 chars).
  // This is a liberal heuristic — the point is whether the checker pointed
  // at the right part of the beat, not whether it used identical wording.
  for (const missing of oracleMissing) {
    // Extract a key phrase: the action verb + object from the oracle string
    // (before any em-dash explanation). Max 40 chars of the first part.
    const key = missing.split("—")[0].trim().toLowerCase().slice(0, 40)
    if (!key) continue
    // Check if any stage-2 detail references the key actor/action from the beat.
    // We check both the raw key and individual content words (>4 chars) to handle
    // paraphrasing.
    const contentWords = key.split(/\s+/).filter(w => w.length > 4)
    for (const detail of stage2Details) {
      const detailLower = detail.toLowerCase()
      // Direct key match
      if (key.length > 8 && detailLower.includes(key.slice(0, 20))) return true
      // Content-word match: ≥2 matching content words in the detail
      const matchCount = contentWords.filter(w => detailLower.includes(w)).length
      if (matchCount >= Math.min(2, contentWords.length)) return true
    }
  }
  return false
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const ts = timestamp()

  // Read panel
  const lines = readFileSync(resolve(args.inPath), "utf8").trim().split("\n")
  const allRows: PartialEnactRow[] = lines
    .filter(l => l.trim())
    .map(l => JSON.parse(l))
    .filter((r: any) => r.checker === "adherence-events")

  if (allRows.length === 0) {
    console.error("No adherence-events rows found in panel. Check --in path.")
    process.exit(1)
  }
  console.log(`L18 Partial-Enactment Panel — ${allRows.length} rows from ${args.inPath}`)
  console.log()

  const results: RowResult[] = []
  let rowIdx = 0

  for (const row of allRows) {
    rowIdx++
    const beat = makeBeat(row)
    const outline = makeOutline(row)
    const characters: CharacterProfile[] = []

    const oraclePass = row.gold.expected_pass
    const oracleMissing = row.gold.missing_events ?? []

    let checkerResult: { pass: boolean; issues: string[] }
    try {
      checkerResult = await checkBeatAdherence(
        row.task.prose,
        beat,
        outline,
        characters,
        // No novelId/chapter/beat tags — offline eval
      )
    } catch (err) {
      console.error(`  [${rowIdx}/${allRows.length}] ${row.fixture_id}: CHECKER ERROR — ${err}`)
      checkerResult = { pass: false, issues: [`CHECKER_ERROR: ${err}`] }
    }

    // Classify
    const binaryCorrect = checkerResult.pass === oraclePass
    const disposition: RowResult["disposition"] =
      !checkerResult.pass && !oraclePass ? "TP" :
      !checkerResult.pass && oraclePass  ? "FP" :
      checkerResult.pass  && !oraclePass ? "FN" : "TN"

    const stage2Details = checkerResult.issues.filter(i => i.startsWith("Beat event missing:"))
    const stage2Fired = stage2Details.length > 0
    const proseLower = row.task.prose.toLowerCase()

    // Quote-in-prose check (verbatim or ellipsis-split)
    let stage2HasQuoteInProse = false
    for (const detail of stage2Details) {
      const quoteMatch = detail.match(/closest prose: "([^"]+)"/)
      if (quoteMatch) {
        const quote = quoteMatch[1].toLowerCase().trim()
        if (quote.length > 4 && proseLower.includes(quote)) {
          stage2HasQuoteInProse = true
          break
        }
        const parts = quote.split("...").map(p => p.trim()).filter(p => p.length > 10)
        if (parts.length > 0 && parts.some(p => proseLower.includes(p))) {
          stage2HasQuoteInProse = true
          break
        }
      }
    }

    const stage2CorrectlyIdentified = oraclePass
      ? true  // PASS rows: not applicable; treat as "correct" (no false alarm expected)
      : checkStage2IdentifiedMissing(oracleMissing, stage2Details)

    const rowResult: RowResult = {
      fixture_id: row.fixture_id,
      fixture_shape: row.fixture_shape,
      oracle_label: row.oracle_label,
      oracle_pass: oraclePass,
      oracle_missing: oracleMissing,
      checker_pass: checkerResult.pass,
      checker_issues: checkerResult.issues,
      binary_correct: binaryCorrect,
      disposition,
      stage2_fired: stage2Fired,
      stage2_detail_count: stage2Details.length,
      stage2_details: stage2Details,
      stage2_has_quote_in_prose: stage2HasQuoteInProse,
      stage2_correctly_identified_missing: stage2CorrectlyIdentified,
    }
    results.push(rowResult)

    const tag = binaryCorrect ? "✓" : "✗"
    const s2tag = stage2Fired ? ` stage2=${stage2Details.length}events${stage2HasQuoteInProse ? "+quote" : ""}${stage2CorrectlyIdentified ? "+match" : "+MISS"}` : ""
    console.log(`  [${rowIdx}/${allRows.length}] ${tag} ${disposition}${s2tag}  [${row.fixture_shape}] ${row.fixture_id}`)
    if (stage2Details.length > 0) {
      for (const d of stage2Details) {
        console.log(`      ${d}`)
      }
    }
    if (checkerResult.issues.some(i => i.includes("CHECKER_ERROR"))) {
      console.error(`  CHECKER CRASH on ${row.fixture_id} — stopping per stop-condition (b)`)
      process.exit(2)
    }
  }

  // ── Panel-level binary matrix ─────────────────────────────────────────────

  const tp = results.filter(r => r.disposition === "TP").length
  const fp = results.filter(r => r.disposition === "FP").length
  const fn = results.filter(r => r.disposition === "FN").length
  const tn = results.filter(r => r.disposition === "TN").length
  const total = results.length
  const correct = results.filter(r => r.binary_correct).length
  const precision = tp + fp === 0 ? null : tp / (tp + fp)
  const recall    = tp + fn === 0 ? null : tp / (tp + fn)
  const f1        = precision !== null && recall !== null && precision + recall > 0
    ? 2 * precision * recall / (precision + recall) : null

  // ── Per-shape matrix ──────────────────────────────────────────────────────

  const shapes = [...new Set(results.map(r => r.fixture_shape))]
  interface ShapeMetrics {
    shape: string
    nFail: number
    nPass: number
    tp: number; fp: number; fn: number; tn: number
    recall: number | null
    precision: number | null
    f1: number | null
    stage2DetailCorrectCount: number
    stage2DetailCorrectDenom: number
  }

  const shapeMetrics: ShapeMetrics[] = shapes.map(shape => {
    const rows = results.filter(r => r.fixture_shape === shape)
    const sFail = rows.filter(r => !r.oracle_pass)
    const sPass = rows.filter(r => r.oracle_pass)
    const sTP = rows.filter(r => r.disposition === "TP").length
    const sFP = rows.filter(r => r.disposition === "FP").length
    const sFN = rows.filter(r => r.disposition === "FN").length
    const sTN = rows.filter(r => r.disposition === "TN").length
    const sRecall    = sTP + sFN === 0 ? null : sTP / (sTP + sFN)
    const sPrecision = sTP + sFP === 0 ? null : sTP / (sTP + sFP)
    const sF1        = sPrecision !== null && sRecall !== null && sPrecision + sRecall > 0
      ? 2 * sPrecision * sRecall / (sPrecision + sRecall) : null
    // Per-event detail correctness: among FAIL rows where stage 2 fired, how many
    // correctly identified the missing event?
    const failRowsWithStage2 = sFail.filter(r => r.stage2_fired)
    const correctlyId = failRowsWithStage2.filter(r => r.stage2_correctly_identified_missing).length
    return {
      shape,
      nFail: sFail.length,
      nPass: sPass.length,
      tp: sTP, fp: sFP, fn: sFN, tn: sTN,
      recall: sRecall,
      precision: sPrecision,
      f1: sF1,
      stage2DetailCorrectCount: correctlyId,
      stage2DetailCorrectDenom: failRowsWithStage2.length,
    }
  })

  // Per-event detail stats (all FAIL rows)
  const failRows = results.filter(r => !r.oracle_pass)
  const failRowsWithStage2 = failRows.filter(r => r.stage2_fired)
  const failRowsWithQuote = failRows.filter(r => r.stage2_has_quote_in_prose)
  const failRowsIdentifiedCorrectly = failRows.filter(r => r.stage2_fired && r.stage2_correctly_identified_missing)

  // ── Console output ────────────────────────────────────────────────────────

  console.log()
  console.log("=== Panel-level binary matrix ===")
  console.log(`  TP=${tp}  FP=${fp}  FN=${fn}  TN=${tn}  (${correct}/${total} correct)`)
  if (precision !== null) console.log(`  Precision = ${(precision * 100).toFixed(1)}%`)
  if (recall    !== null) console.log(`  Recall    = ${(recall * 100).toFixed(1)}%`)
  if (f1        !== null) console.log(`  F1        = ${(f1 * 100).toFixed(1)}%`)

  console.log()
  console.log("=== Per-shape matrix ===")
  console.log(
    "  Shape".padEnd(30) +
    "N_fail".padEnd(9) + "N_pass".padEnd(9) +
    "TP".padEnd(5) + "FP".padEnd(5) + "FN".padEnd(5) + "TN".padEnd(5) +
    "Recall".padEnd(9) + "Prec".padEnd(9) + "F1".padEnd(9) +
    "Stage2 detail correct"
  )
  for (const m of shapeMetrics) {
    const pct = (v: number | null) => v === null ? "N/A" : `${(v * 100).toFixed(0)}%`
    console.log(
      `  ${m.shape}`.padEnd(30) +
      String(m.nFail).padEnd(9) + String(m.nPass).padEnd(9) +
      String(m.tp).padEnd(5) + String(m.fp).padEnd(5) +
      String(m.fn).padEnd(5) + String(m.tn).padEnd(5) +
      pct(m.recall).padEnd(9) + pct(m.precision).padEnd(9) + pct(m.f1).padEnd(9) +
      `${m.stage2DetailCorrectCount}/${m.stage2DetailCorrectDenom}`
    )
  }

  console.log()
  console.log("=== Per-event detail summary ===")
  console.log(`  FAIL rows: ${failRows.length}`)
  console.log(`  Stage 2 fired: ${failRowsWithStage2.length}/${failRows.length}`)
  console.log(`  Stage 2 with verbatim prose quote: ${failRowsWithQuote.length}/${failRows.length}`)
  console.log(`  Stage 2 correctly identified missing event: ${failRowsIdentifiedCorrectly.length}/${failRowsWithStage2.length}`)

  // Residual misses analysis
  const fnRows = results.filter(r => r.disposition === "FN")
  const fpRows = results.filter(r => r.disposition === "FP")
  if (fnRows.length > 0) {
    console.log()
    console.log("=== Residual FNs (checker missed a FAIL) ===")
    for (const r of fnRows) {
      console.log(`  [FN] ${r.fixture_id} [${r.fixture_shape}]`)
      console.log(`       oracle_missing: ${r.oracle_missing.join(" | ")}`)
    }
  }
  if (fpRows.length > 0) {
    console.log()
    console.log("=== Residual FPs (checker failed a PASS) ===")
    for (const r of fpRows) {
      console.log(`  [FP] ${r.fixture_id} [${r.fixture_shape}]`)
      for (const issue of r.checker_issues) console.log(`       issue: ${issue}`)
    }
  }

  // ── Write output files ────────────────────────────────────────────────────

  const outBase = `/tmp/partial-enactment-panel-results-${ts}`
  const jsonlPath = `${outBase}.jsonl`
  const summaryPath = `${outBase}.summary.json`

  writeFileSync(jsonlPath, results.map(r => JSON.stringify(r)).join("\n") + "\n")

  const summary = {
    timestamp: ts,
    panel_path: args.inPath,
    n_rows: total,
    binary_matrix: { TP: tp, FP: fp, FN: fn, TN: tn },
    binary_correct: correct,
    binary_precision_pct: precision === null ? null : Math.round(precision * 1000) / 10,
    binary_recall_pct: recall === null ? null : Math.round(recall * 1000) / 10,
    binary_f1_pct: f1 === null ? null : Math.round(f1 * 1000) / 10,
    fail_rows: failRows.length,
    stage2_fired_on_n_fail_rows: failRowsWithStage2.length,
    stage2_with_quote_on_n_fail_rows: failRowsWithQuote.length,
    stage2_correctly_identified_missing: failRowsIdentifiedCorrectly.length,
    per_shape: shapeMetrics.map(m => ({
      shape: m.shape,
      n_fail: m.nFail,
      n_pass: m.nPass,
      tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn,
      recall_pct: m.recall === null ? null : Math.round(m.recall * 1000) / 10,
      precision_pct: m.precision === null ? null : Math.round(m.precision * 1000) / 10,
      f1_pct: m.f1 === null ? null : Math.round(m.f1 * 1000) / 10,
      stage2_detail_correct: `${m.stage2DetailCorrectCount}/${m.stage2DetailCorrectDenom}`,
    })),
    per_row: results,
  }
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  console.log()
  console.log(`Wrote ${total} rows to ${jsonlPath}`)
  console.log(`Wrote summary to ${summaryPath}`)

  // ── Persist to DB ─────────────────────────────────────────────────────────

  if (args.persist) {
    const { persistPhaseEvalRun, currentGitCommit } = await import("../phase-eval/persist-run")
    const verdictLine = `TP=${tp} FP=${fp} FN=${fn} TN=${tn} recall=${recall !== null ? (recall * 100).toFixed(1) + "%" : "N/A"} precision=${precision !== null ? (precision * 100).toFixed(1) + "%" : "N/A"} F1=${f1 !== null ? (f1 * 100).toFixed(1) + "%" : "N/A"} stage2_correct=${failRowsIdentifiedCorrectly.length}/${failRowsWithStage2.length}`
    const runId = await persistPhaseEvalRun({
      probeName: "partial-enactment-per-shape-matrix",
      gitCommit: currentGitCommit(),
      experimentId: args.expId ?? null,
      seedsUsed: ["synthetic-L18"],
      variantLabels: ["two-stage", "partial-enactment"],
      summaryJson: summary,
      verdict: verdictLine,
      notes: `panel=synthetic-partial-enactment n=${total} shapes=two-of-three/reversed-order/substituted-actor/acceptable-embellishment`,
    })
    console.log(`[persist] phase_eval_runs.id=${runId}`)
    console.log(`[persist] probe=partial-enactment-per-shape-matrix verdict=${verdictLine}`)

    // Close DB pool
    const db = (await import("../../src/db/connection")).default
    await db.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
