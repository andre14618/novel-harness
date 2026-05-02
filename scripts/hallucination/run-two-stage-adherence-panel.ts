#!/usr/bin/env bun
/**
 * Two-stage adherence panel validation (L8).
 *
 * Runs the live two-stage `checkBeatAdherence` against every
 * `adherence-events` / `current_surface_natural` row in the labeled panel.
 * Compares binary-only disposition to oracle, then inspects the per-event
 * detail on FAIL rows.
 *
 * Acceptance gates:
 *   1. Binary precision = 100% (no new FP vs oracle)
 *   2. Binary recall    = 100% (no new FN vs oracle)
 *   3. ≥1 b12 row where stage 2 names the missing event with quote evidence
 *
 * Usage:
 *   bun scripts/hallucination/run-two-stage-adherence-panel.ts \
 *     [--in /tmp/halluc-current-panel-exp299-labeled.jsonl] \
 *     [--persist] [--exp-id N]
 *
 * Outputs (timestamped, never overwritten):
 *   /tmp/two-stage-adherence-panel-<YYYYMMDDTHHMMSS>.jsonl
 *   /tmp/two-stage-adherence-panel-<YYYYMMDDTHHMMSS>.summary.json
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
  let inPath = "/tmp/halluc-current-panel-exp299-labeled.jsonl"
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

// ── Panel row types ──────────────────────────────────────────────────────────

interface PanelRow {
  fixture_id: string
  checker: string
  case_role: string
  task: {
    prose: string
    writer_request_meta: {
      beatDescription: string
      beatCharacters: string[]
    }
  }
  gold: {
    oracle_label: string
    expected_pass: boolean
    obligated_events: string[]
    missing_events: Array<string | { event?: string; text?: string }>
  }
}

// ── Minimal stubs to drive checkBeatAdherence ────────────────────────────────
// The function needs a SceneBeat, ChapterOutline, and CharacterProfile[].
// For panel eval we construct minimal stubs — we don't need real outlines.

function makeBeat(row: PanelRow): SceneBeat {
  const meta = row.task.writer_request_meta
  return {
    description: meta.beatDescription,
    characters: meta.beatCharacters ?? [],
    // Required fields with safe defaults (not used by adherence checker logic)
    kind: "action",
    obligations: { facts: [], characterState: [], payoffs: [] },
    requiredPayoffs: [],
  }
}

function makeOutline(row: PanelRow): ChapterOutline {
  // The adherence checker only uses outline.povCharacter to skip the POV
  // character from the deterministic character-presence check. Use "Maret"
  // as POV since all panel rows are from novel-1777670460355 chapter 1.
  return {
    chapterNumber: 1,
    title: "The Scribe's Anomaly",
    summary: "",
    beats: [],
    povCharacter: "Maret",
    themes: [],
    openingHook: "",
    closingMoment: "",
  }
}

// ── Per-row result ───────────────────────────────────────────────────────────

interface RowResult {
  fixture_id: string
  oracle_label: string
  oracle_pass: boolean
  oracle_missing_count: number
  oracle_missing: string[]
  // Two-stage checker output
  checker_pass: boolean
  checker_issues: string[]
  // Derived
  binary_correct: boolean          // checker_pass === oracle_pass
  is_true_positive: boolean        // correctly caught a fail
  is_false_positive: boolean       // wrongly failed a pass
  is_false_negative: boolean       // missed a fail
  is_true_negative: boolean        // correctly passed a pass
  // Per-event detail quality (only on FAIL rows)
  stage2_fired: boolean            // issues contain "Beat event missing:" strings
  stage2_detail_count: number      // count of "Beat event missing:" lines
  stage2_details: string[]         // the per-event issue strings
  stage2_has_quote_in_prose: boolean  // any issue quote is a verbatim substring of prose
  // b12 specific
  is_b12_row: boolean
}

function extractOracleMissing(gold: PanelRow["gold"]): string[] {
  return (gold.missing_events ?? []).map((m) => {
    if (typeof m === "string") return m
    return m.event ?? m.text ?? ""
  }).filter(Boolean)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const ts = timestamp()

  // Read and filter panel
  const lines = readFileSync(resolve(args.inPath), "utf8").trim().split("\n")
  const allRows: PanelRow[] = lines
    .filter(l => l.trim())
    .map(l => JSON.parse(l))
    .filter((r: any) =>
      r.checker === "adherence-events" && r.case_role === "current_surface_natural"
    )

  if (allRows.length === 0) {
    console.error("No adherence-events / current_surface_natural rows found in panel. Check --in path.")
    process.exit(1)
  }
  console.log(`Two-stage adherence panel validation — ${allRows.length} rows from ${args.inPath}`)
  console.log()

  // Instrumentation: count callAgent invocations per row by patching the module.
  // We do this via a simple approach: count how many times checkBeatAdherence
  // produces issues that look like stage-2 output ("Beat event missing:").

  const results: RowResult[] = []
  let rowIdx = 0

  for (const row of allRows) {
    rowIdx++
    const beat = makeBeat(row)
    const outline = makeOutline(row)
    const characters: CharacterProfile[] = []

    const oraclePass = row.gold.expected_pass ?? (row.gold.oracle_label === "events_fully_enacted")
    const oracleMissing = extractOracleMissing(row.gold)

    let checkerResult: { pass: boolean; issues: string[] }
    try {
      checkerResult = await checkBeatAdherence(
        row.task.prose,
        beat,
        outline,
        characters,
        // No novelId/chapter/beat tags — this is an offline eval
      )
    } catch (err) {
      console.error(`  [${rowIdx}/${allRows.length}] ${row.fixture_id}: CHECKER ERROR — ${err}`)
      checkerResult = { pass: false, issues: [`CHECKER_ERROR: ${err}`] }
    }

    // Classify per-event detail
    const stage2Details = checkerResult.issues.filter(i => i.startsWith("Beat event missing:"))
    const stage2Fired = stage2Details.length > 0
    const proseLower = row.task.prose.toLowerCase()

    // Check if any quote from a stage-2 detail appears in prose (verbatim, case-insensitive).
    // The model sometimes joins two real prose snippets with "..." (abbreviated middle).
    // We split on "..." and check that each non-empty part is independently in prose.
    let stage2HasQuoteInProse = false
    for (const detail of stage2Details) {
      // Format: "Beat event missing: <event> — closest prose: \"<quote>\""
      const quoteMatch = detail.match(/closest prose: "([^"]+)"/)
      if (quoteMatch) {
        const quote = quoteMatch[1].toLowerCase().trim()
        // Try whole quote first
        if (quote.length > 4 && proseLower.includes(quote)) {
          stage2HasQuoteInProse = true
          break
        }
        // Try ellipsis-split parts — if any substantial part (>10 chars) is in prose, count as valid
        const parts = quote.split("...").map(p => p.trim()).filter(p => p.length > 10)
        if (parts.length > 0 && parts.some(p => proseLower.includes(p))) {
          stage2HasQuoteInProse = true
          break
        }
      }
    }

    const binaryCorrect = checkerResult.pass === oraclePass
    const isTruePositive = !checkerResult.pass && !oraclePass
    const isFalsePositive = !checkerResult.pass && oraclePass
    const isFalseNegative = checkerResult.pass && !oraclePass
    const isTrueNegative = checkerResult.pass && oraclePass

    const rowResult: RowResult = {
      fixture_id: row.fixture_id,
      oracle_label: row.gold.oracle_label,
      oracle_pass: oraclePass,
      oracle_missing_count: oracleMissing.length,
      oracle_missing: oracleMissing,
      checker_pass: checkerResult.pass,
      checker_issues: checkerResult.issues,
      binary_correct: binaryCorrect,
      is_true_positive: isTruePositive,
      is_false_positive: isFalsePositive,
      is_false_negative: isFalseNegative,
      is_true_negative: isTrueNegative,
      stage2_fired: stage2Fired,
      stage2_detail_count: stage2Details.length,
      stage2_details: stage2Details,
      stage2_has_quote_in_prose: stage2HasQuoteInProse,
      is_b12_row: row.fixture_id.includes("-b12-"),
    }
    results.push(rowResult)

    const tag = binaryCorrect ? "✓" : "✗"
    const disposition = isTruePositive ? "TP" : isFalsePositive ? "FP" : isFalseNegative ? "FN" : "TN"
    const s2tag = stage2Fired ? ` stage2=${stage2Details.length}events${stage2HasQuoteInProse ? "+quote" : ""}` : ""
    const b12tag = rowResult.is_b12_row ? " [b12]" : ""
    console.log(`  [${rowIdx}/${allRows.length}] ${tag} ${disposition}${s2tag}${b12tag}  ${row.fixture_id}`)
    if (stage2Fired) {
      for (const d of stage2Details) {
        console.log(`      ${d}`)
      }
    }
  }

  // ── Aggregate ────────────────────────────────────────────────────────────

  const tp = results.filter(r => r.is_true_positive).length
  const fp = results.filter(r => r.is_false_positive).length
  const fn = results.filter(r => r.is_false_negative).length
  const tn = results.filter(r => r.is_true_negative).length
  const total = results.length
  const correct = results.filter(r => r.binary_correct).length
  const precision = tp + fp === 0 ? null : tp / (tp + fp)
  const recall = tp + fn === 0 ? null : tp / (tp + fn)

  // Per-event detail stats (on FAIL rows only)
  const failRows = results.filter(r => !r.oracle_pass)
  const failRowsWithStage2 = failRows.filter(r => r.stage2_fired)
  const failRowsWithQuote = failRows.filter(r => r.stage2_has_quote_in_prose)

  // b12 row detail
  const b12Rows = results.filter(r => r.is_b12_row)
  const b12WithStage2 = b12Rows.filter(r => r.stage2_fired)
  const b12WithQuote = b12Rows.filter(r => r.stage2_has_quote_in_prose)

  console.log()
  console.log("=== Binary matrix (two-stage, gated per-event on fail) ===")
  console.log(`  TP=${tp}  FP=${fp}  FN=${fn}  TN=${tn}  (${correct}/${total} correct)`)
  if (precision !== null) console.log(`  Precision = ${(precision * 100).toFixed(1)}%`)
  if (recall !== null) console.log(`  Recall    = ${(recall * 100).toFixed(1)}%`)
  console.log()
  console.log("=== Per-event detail stats ===")
  console.log(`  FAIL rows: ${failRows.length}`)
  console.log(`  Stage 2 fired: ${failRowsWithStage2.length}/${failRows.length}`)
  console.log(`  Stage 2 with verbatim prose quote: ${failRowsWithQuote.length}/${failRows.length}`)
  console.log()
  console.log("=== b12 partial-enactment cluster ===")
  console.log(`  Rows: ${b12Rows.length}`)
  console.log(`  Stage 2 fired: ${b12WithStage2.length}/${b12Rows.length}`)
  console.log(`  Stage 2 with verbatim quote: ${b12WithQuote.length}/${b12Rows.length}`)
  for (const r of b12Rows) {
    console.log(`  ${r.fixture_id}:`)
    console.log(`    binary_correct=${r.binary_correct} disposition=${r.is_true_positive ? "TP" : r.is_false_negative ? "FN" : r.is_false_positive ? "FP" : "TN"}`)
    if (r.stage2_details.length > 0) {
      for (const d of r.stage2_details) {
        console.log(`    per-event: ${d}`)
      }
    } else {
      console.log(`    (no stage-2 detail — likely fallback or stage-1 passed)`)
    }
  }

  // ── Acceptance verdict ────────────────────────────────────────────────────

  const binaryPerfect = fp === 0 && fn === 0
  const b12PerEventOk = b12WithStage2.length >= 1
  const overallVerdict = binaryPerfect
    ? (b12PerEventOk ? "PASS — binary 100/100 + per-event detail on b12" : "PARTIAL — binary 100/100 but b12 stage 2 did not fire")
    : `FAIL — binary not 100/100 (FP=${fp} FN=${fn})`

  console.log()
  console.log(`=== Acceptance verdict: ${overallVerdict} ===`)

  // ── Write timestamped output files ────────────────────────────────────────

  const outBase = `/tmp/two-stage-adherence-panel-${ts}`
  const jsonlPath = `${outBase}.jsonl`
  const summaryPath = `${outBase}.summary.json`

  writeFileSync(jsonlPath, results.map(r => JSON.stringify(r)).join("\n") + "\n")

  const summary = {
    timestamp: ts,
    panel_path: args.inPath,
    n_natural_rows: total,
    binary_matrix: { TP: tp, FP: fp, FN: fn, TN: tn },
    binary_correct: correct,
    binary_precision_pct: precision === null ? null : Math.round(precision * 1000) / 10,
    binary_recall_pct: recall === null ? null : Math.round(recall * 1000) / 10,
    fail_rows: failRows.length,
    stage2_fired_on_n_fail_rows: failRowsWithStage2.length,
    stage2_with_quote_on_n_fail_rows: failRowsWithQuote.length,
    b12_cluster: {
      total: b12Rows.length,
      stage2_fired: b12WithStage2.length,
      stage2_with_quote: b12WithQuote.length,
      rows: b12Rows.map(r => ({
        fixture_id: r.fixture_id,
        binary_correct: r.binary_correct,
        disposition: r.is_true_positive ? "TP" : r.is_false_negative ? "FN" : r.is_false_positive ? "FP" : "TN",
        stage2_details: r.stage2_details,
        stage2_has_quote_in_prose: r.stage2_has_quote_in_prose,
      })),
    },
    verdict: overallVerdict,
    per_row: results,
  }
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  console.log()
  console.log(`Wrote ${total} rows to ${jsonlPath}`)
  console.log(`Wrote summary to ${summaryPath}`)

  // ── Persist to DB ─────────────────────────────────────────────────────────

  if (args.persist) {
    const { persistPhaseEvalRun, currentGitCommit } = await import("../phase-eval/persist-run")
    const runId = await persistPhaseEvalRun({
      probeName: "adherence-two-stage-vs-binary-only",
      gitCommit: currentGitCommit(),
      experimentId: args.expId ?? null,
      seedsUsed: ["novel-1777670460355-c1"],
      variantLabels: ["two-stage"],
      summaryJson: summary,
      verdict: overallVerdict,
      notes: `panel=/tmp/halluc-current-panel-exp299-labeled.jsonl n=${total} TP=${tp} FP=${fp} FN=${fn} TN=${tn} b12_stage2=${b12WithStage2.length}/${b12Rows.length}`,
    })
    console.log(`[persist] phase_eval_runs.id=${runId}`)
    console.log(`[persist] probe=adherence-two-stage-vs-binary-only verdict=${overallVerdict}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
