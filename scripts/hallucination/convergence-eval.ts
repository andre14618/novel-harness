#!/usr/bin/env bun
/**
 * Halluc-ungrounded N-call convergence eval.
 *
 * For each row in a labeled current-surface panel, runs the checker N
 * times in parallel and records every call's pass/issues. Then for each
 * threshold k in 1..N computes the verdict "fail iff at least k of N
 * calls voted fail" and the resulting precision/recall/F1 against the
 * oracle/synthetic-expected label.
 *
 * The per-row JSONL output is the raw evidence; the stdout summary is
 * the headline matrix per threshold.
 *
 * Usage:
 *   bun scripts/hallucination/convergence-eval.ts \
 *     --in /tmp/halluc-current-panel-labeled.jsonl \
 *     --out /tmp/halluc-convergence-2026-05-01T03-00-00.jsonl \
 *     --n 5 \
 *     --temperature 0.1 \
 *     [--persist --exp-id NNN --variant-label tempX-nY --note "..."]
 *
 * Conventions:
 *  - Output filename MUST be timestamped per feedback_no_overwrite_runs.
 *  - Defaults: n=5, temperature=0.1 (production setting). Run with
 *    higher temperature (e.g. 0.5) in a follow-up to compare divergence.
 *  - Concurrency: PARALLELISM rows in flight at once, with N parallel
 *    calls per row (so up to PARALLELISM*N inflight calls). Tuned to
 *    stay polite to DeepSeek.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { callAgent } from "../../src/llm"
import { hallucUngroundedSchema, HALLUC_UNGROUNDED_SYSTEM } from "../../src/agents/halluc-ungrounded"

const PARALLELISM = 5  // rows in flight; N parallel calls per row inside

interface Args {
  inPath: string
  outPath: string
  n: number
  temperature: number
  persist: boolean
  expId?: number
  variantLabel: string
  note?: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let inPath = "", outPath = ""
  let n = 5
  let temperature = 0.1
  let persist = false
  let expId: number | undefined
  let variantLabel = "convergence"
  let note: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") inPath = argv[++i]!
    else if (argv[i] === "--out") outPath = argv[++i]!
    else if (argv[i] === "--n") n = Number(argv[++i])
    else if (argv[i] === "--temperature") temperature = Number(argv[++i])
    else if (argv[i] === "--persist") persist = true
    else if (argv[i] === "--exp-id") expId = Number(argv[++i])
    else if (argv[i] === "--variant-label") variantLabel = argv[++i]!
    else if (argv[i] === "--note") note = argv[++i]
  }
  if (!inPath || !outPath) {
    console.error(
      "usage: --in <panel.jsonl> --out <results-<TS>.jsonl> [--n 5] [--temperature 0.1] [--persist [--exp-id N] [--variant-label LABEL] [--note STR]]"
    )
    process.exit(1)
  }
  return { inPath, outPath, n, temperature, persist, expId, variantLabel, note }
}

function buildHallucUserPrompt(row: any): string {
  // Identical to ab-halluc-prompt.ts buildHallucUserPrompt — kept inline
  // so this script is self-contained and can be diffed against the A/B
  // counterpart for any drift.
  const meta = row.task.writer_request_meta ?? {}
  const gs = row.task.checker_request_meta?.groundedSources ?? {}
  const bible = gs.bible ?? []
  const fromBrief = gs.from_brief ?? []
  const derivedFact = gs.derived_outline_fact ?? []
  const derivedPrior = gs.derived_prior_beat ?? []
  const beatChars = (meta.beatCharacters ?? []) as string[]

  const briefLines = [
    `Summary: ${meta.beatDescription ?? ""}`,
    `Kind: action`,
    `POV: ${beatChars[0] ?? ""}`,
    `Characters: ${beatChars.join(", ")}`,
    `Setting: `,
  ]

  const worldBibleBlock = [
    "WORLD BIBLE (relevant, names only):",
    `  Locations: ${bible.join(", ") || "(none)"}`,
    `  Cultures:  (none)`,
    `  Systems:   (none)`,
    `  From-brief: ${fromBrief.join(", ") || "(none)"}`,
    `  Beat-entities: ${[...derivedFact, ...derivedPrior].join(", ") || "(none)"}`,
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

interface OracleLabel {
  pass: boolean | null
  source: "oracle" | "synthetic_expected"
  expected_entities: string[]
}

function getOracleLabel(row: any): OracleLabel {
  if (row.case_role === "synthetic_fixture") {
    return {
      pass: row.gold.expected_pass,
      source: "synthetic_expected",
      expected_entities: (row.gold.issues ?? [])
        .map((i: any) => i.entity ?? i.expected_event ?? "")
        .filter(Boolean),
    }
  }
  const goldStatus = row.gold?.calibration_status
  if (goldStatus === "TN") return { pass: true, source: "oracle", expected_entities: [] }
  if (goldStatus === "FN") {
    const missed = (row.gold.missed_entities ?? []).map((m: any) => m.entity).filter(Boolean)
    return { pass: false, source: "oracle", expected_entities: missed }
  }
  if (goldStatus === "TP") return { pass: false, source: "oracle", expected_entities: [] }
  if (goldStatus === "MIXED") {
    const trueHallucs = (row.gold.issue_judgments ?? [])
      .filter((j: any) => j.rubric_label === "true_hallucination")
      .map((j: any) => j.entity_from_checker)
    return { pass: trueHallucs.length === 0, source: "oracle", expected_entities: trueHallucs }
  }
  return { pass: null, source: "oracle", expected_entities: [] }
}

interface CallResult {
  pass: boolean | null
  entities: string[]
  failed: boolean
  error_text?: string
}

async function runOneCall(userPrompt: string, temperature: number): Promise<CallResult> {
  try {
    const result = await callAgent({
      agentName: "halluc-ungrounded" as const,
      systemPrompt: HALLUC_UNGROUNDED_SYSTEM,
      userPrompt,
      schema: hallucUngroundedSchema,
      temperature,
    })
    return {
      pass: result.output.pass,
      entities: (result.output.issues ?? []).map((i: any) => i.entity ?? "").filter(Boolean),
      failed: false,
    }
  } catch (err) {
    return {
      pass: null,
      entities: [],
      failed: true,
      error_text: err instanceof Error ? err.message : String(err),
    }
  }
}

interface RowResult {
  fixture_id: string
  case_role: string
  oracle_pass: boolean | null
  oracle_expected_entities: string[]
  n_calls: number
  individual_calls: CallResult[]
  vote_count_fail: number  // how many of N calls returned pass=false
  vote_count_pass: number  // how many returned pass=true
  vote_count_error: number // how many threw
  // per-threshold verdicts: index k means "fail iff vote_count_fail >= k+1"
  threshold_verdicts: Array<{ threshold: number; declared_pass: boolean; calibration: string }>
}

function calibrate(declared_pass: boolean, oracle_pass: boolean | null): string {
  if (oracle_pass === null) return "NO-ORACLE"
  if (oracle_pass === true && declared_pass === true) return "TN"
  if (oracle_pass === true && declared_pass === false) return "FP"
  if (oracle_pass === false && declared_pass === false) return "TP"
  return "FN"
}

async function processRow(row: any, n: number, temperature: number): Promise<RowResult> {
  const userPrompt = buildHallucUserPrompt(row)
  const calls = await Promise.all(
    Array.from({ length: n }, () => runOneCall(userPrompt, temperature))
  )
  const vote_count_fail = calls.filter(c => c.pass === false).length
  const vote_count_pass = calls.filter(c => c.pass === true).length
  const vote_count_error = calls.filter(c => c.failed).length
  const oracle = getOracleLabel(row)

  const threshold_verdicts: RowResult["threshold_verdicts"] = []
  for (let k = 1; k <= n; k++) {
    const declared_pass = vote_count_fail < k
    threshold_verdicts.push({
      threshold: k,
      declared_pass,
      calibration: calibrate(declared_pass, oracle.pass),
    })
  }

  return {
    fixture_id: row.fixture_id,
    case_role: row.case_role,
    oracle_pass: oracle.pass,
    oracle_expected_entities: oracle.expected_entities,
    n_calls: n,
    individual_calls: calls,
    vote_count_fail,
    vote_count_pass,
    vote_count_error,
    threshold_verdicts,
  }
}

async function processWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
  onComplete?: (result: R, idx: number, total: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIdx = 0
  const total = items.length
  async function runner() {
    while (true) {
      const i = nextIdx++
      if (i >= items.length) return
      const r = await worker(items[i]!)
      results[i] = r
      if (onComplete) onComplete(r, i, total)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runner()))
  return results
}

async function main() {
  const args = parseArgs()

  // Cost-tracking: callAgent only writes to llm_calls when novelId is set
  // OR an experiment run is active (src/llm.ts ~line 350). We pass no
  // novelId, so without initExperimentRun the convergence calls are
  // invisible in the cost ledger. Closes the cost-attribution gap
  // surfaced after L1 ($0.20 spent but unrecorded). Requires --exp-id.
  if (args.expId !== undefined) {
    const { initExperimentRun } = await import("../../src/logger")
    const runId = await initExperimentRun(
      args.expId,
      "halluc-ungrounded-convergence",
      `T${args.temperature}-N${args.n}`,
      args.variantLabel,
    )
    console.log(`[runs] initialized run id=${runId} for experiment_id=${args.expId} (llm_calls will persist)`)
  } else {
    console.warn(`[warn] --exp-id not passed; llm_calls will NOT persist (cost untracked)`)
  }

  const lines = readFileSync(resolve(args.inPath), "utf8").trim().split("\n")
  const rows = lines.map(l => JSON.parse(l)).filter(r => r.checker === "halluc-ungrounded")
  console.log(
    `convergence-eval: n=${args.n} temp=${args.temperature} rows=${rows.length} parallelism=${PARALLELISM}`
  )

  const startMs = Date.now()
  const results = await processWithConcurrency(
    rows,
    row => processRow(row, args.n, args.temperature),
    PARALLELISM,
    (r, i, total) => {
      const oracleStr =
        r.oracle_pass === null ? "?" : r.oracle_pass ? "PASS" : "FAIL"
      console.log(
        `  [${i + 1}/${total}] ${r.fixture_id}: oracle=${oracleStr} fail-votes=${r.vote_count_fail}/${r.n_calls} errors=${r.vote_count_error}`
      )
    }
  )
  const durationS = Math.round((Date.now() - startMs) / 1000)
  console.log(`\nElapsed: ${durationS}s`)

  writeFileSync(
    resolve(args.outPath),
    results.map(r => JSON.stringify(r)).join("\n") + "\n"
  )
  console.log(`Wrote ${results.length} rows to ${args.outPath}`)

  // Per-threshold matrix
  console.log("\nPer-threshold matrices (cols: TP/FP/FN/TN/ERROR/NO-ORACLE), then recall/precision/F1:")
  type Counts = Record<string, number>
  const perThreshold: Array<{ threshold: number; counts: Counts; recall?: number; precision?: number; f1?: number }> = []
  for (let k = 1; k <= args.n; k++) {
    const counts: Counts = { TP: 0, FP: 0, FN: 0, TN: 0, ERROR: 0, "NO-ORACLE": 0 }
    for (const r of results) {
      const v = r.threshold_verdicts.find(v => v.threshold === k)
      if (!v) continue
      counts[v.calibration] = (counts[v.calibration] ?? 0) + 1
    }
    const tp = counts.TP ?? 0, fp = counts.FP ?? 0, fn = counts.FN ?? 0, tn = counts.TN ?? 0
    const recall = tp + fn > 0 ? tp / (tp + fn) : NaN
    const precision = tp + fp > 0 ? tp / (tp + fp) : NaN
    const f1 = !isNaN(recall) && !isNaN(precision) && (recall + precision) > 0
      ? 2 * recall * precision / (recall + precision)
      : NaN
    perThreshold.push({
      threshold: k,
      counts,
      recall: isNaN(recall) ? undefined : Number(recall.toFixed(3)),
      precision: isNaN(precision) ? undefined : Number(precision.toFixed(3)),
      f1: isNaN(f1) ? undefined : Number(f1.toFixed(3)),
    })
    console.log(
      `  k>=${k}-of-${args.n} fail:  TP=${tp} FP=${fp} FN=${fn} TN=${tn}  recall=${isNaN(recall) ? "n/a" : recall.toFixed(3)}  precision=${isNaN(precision) ? "n/a" : precision.toFixed(3)}  F1=${isNaN(f1) ? "n/a" : f1.toFixed(3)}`
    )
  }

  // Per-class breakdown (case_role)
  console.log("\nPer-case_role breakdown at each threshold:")
  for (const role of ["current_surface_natural", "synthetic_fixture"]) {
    const sub = results.filter(r => r.case_role === role)
    if (sub.length === 0) continue
    console.log(`  ${role} (n=${sub.length}):`)
    for (let k = 1; k <= args.n; k++) {
      const counts: Counts = { TP: 0, FP: 0, FN: 0, TN: 0, ERROR: 0, "NO-ORACLE": 0 }
      for (const r of sub) {
        const v = r.threshold_verdicts.find(v => v.threshold === k)
        if (v) counts[v.calibration] = (counts[v.calibration] ?? 0) + 1
      }
      const tp = counts.TP ?? 0, fp = counts.FP ?? 0, fn = counts.FN ?? 0, tn = counts.TN ?? 0
      console.log(
        `    k>=${k}: TP=${tp} FP=${fp} FN=${fn} TN=${tn} ERROR=${counts.ERROR ?? 0}`
      )
    }
  }

  // Agreement matrix at N=args.n
  console.log("\nAgreement matrix (vote_count_fail histogram):")
  const histogram: Record<number, number> = {}
  for (const r of results) {
    histogram[r.vote_count_fail] = (histogram[r.vote_count_fail] ?? 0) + 1
  }
  for (let k = 0; k <= args.n; k++) {
    const c = histogram[k] ?? 0
    console.log(`  ${c} rows had ${k}/${args.n} fail votes`)
  }

  if (args.persist) {
    const { persistPhaseEvalRun, currentGitCommit } = await import("../phase-eval/persist-run")
    const summary = {
      panel_path: args.inPath,
      n_calls_per_row: args.n,
      temperature: args.temperature,
      n_rows: results.length,
      n_natural: results.filter(r => r.case_role === "current_surface_natural").length,
      n_synthetic: results.filter(r => r.case_role === "synthetic_fixture").length,
      per_threshold: perThreshold,
      agreement_histogram: histogram,
      duration_seconds: durationS,
    }
    const verdict = `CONVERGENCE-N${args.n}-T${args.temperature}`
    const runId = await persistPhaseEvalRun({
      probeName: "halluc-ungrounded-convergence",
      gitCommit: currentGitCommit(),
      experimentId: args.expId ?? null,
      seedsUsed: ["fantasy-system-heretic"],
      variantLabels: [args.variantLabel],
      summaryJson: summary,
      verdict,
      notes: args.note ?? null,
    })
    console.log(`\n[persist] phase_eval_runs.id=${runId} probe=halluc-ungrounded-convergence verdict=${verdict}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
