#!/usr/bin/env bun
/**
 * Adherence-events N-call convergence eval.
 *
 * Same methodology as scripts/hallucination/convergence-eval.ts but
 * targets the binary `adherence-events` checker (events_present yes/no)
 * from src/agents/writer/adherence-checker.ts.
 *
 * For each adherence row in a labeled current-surface panel, runs the
 * binary `EVENTS_SYSTEM` prompt N times in parallel and records every
 * call's events_present + reasoning. Then for each threshold k in 1..N
 * computes the verdict "fail iff at least k of N calls voted fail"
 * (events_present=false) and the resulting precision/recall/F1 vs the
 * oracle/synthetic-expected label.
 *
 * Independent of L5 two-stage wiring — this measures the binary-stage-1
 * call only. If L5 lands, the binary stage stays unchanged so this
 * convergence finding is still valid.
 *
 * Usage:
 *   bun scripts/hallucination/adherence-convergence-eval.ts \
 *     --in /tmp/halluc-current-panel-exp299-labeled.jsonl \
 *     --out /tmp/adherence-convergence-N5-T05-<ts>.jsonl \
 *     --n 5 --temperature 0.5 \
 *     [--persist --exp-id NNN --variant-label tempX-nY --note "..."]
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import { callAgent } from "../../src/llm"

const PARALLELISM = 5

const eventsSchema = z.object({
  events_present: z.boolean(),
  evidence: z.string().optional().default(""),
  reasoning: z.string().optional().default(""),
})

// Mirrors EVENTS_SYSTEM from src/agents/writer/adherence-checker.ts.
// Kept as a const here to make the script self-contained and prevent
// accidental drift if the checker source moves; if the production
// prompt changes, update this string explicitly.
const EVENTS_SYSTEM = `You verify whether the prose ENACTS the scene beat on-page.

Read the beat description carefully. Identify every distinct action or event it specifies — there may be one or several. Then check whether EACH is dramatized in the prose.

Rules:
- "Enacted" means the action happens IN SCENE during this prose — characters performing the action, dialogue, or narration of the action as it occurs. Paraphrase, dialogue rewording, and atmospheric expansion are fine.
- A reference to the action as having happened earlier (off-page, past-tense, summarized as backstory) does NOT count as enacted.
- Characters being merely present is NOT enough — the beat's specific actions must occur.
- If the beat specifies multiple actions, ALL must appear in the prose. A partially enacted beat is not fully enacted.
- Each action must be performed by the character the beat assigns it to. If the beat says Character A does something but the prose has Character B do it, the action is NOT correctly enacted.
- If ANY key action from the beat is missing, return events_present=false. Do NOT default to true.

Respond with ONLY valid JSON in this exact shape:
{
  "events_present": true | false,
  "evidence": "<short quoted passage from the prose, ~1-3 sentences>",
  "reasoning": "<one sentence>"
}`

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
  let n = 5, temperature = 0.1
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
    console.error("usage: --in <panel.jsonl> --out <results-<TS>.jsonl> [--n 5] [--temperature 0.1] [--persist [--exp-id N] [--variant-label LABEL] [--note STR]]")
    process.exit(1)
  }
  return { inPath, outPath, n, temperature, persist, expId, variantLabel, note }
}

function buildAdherenceUserPrompt(row: any): string {
  const meta = row.task.writer_request_meta ?? {}
  const beatDesc = meta.beatDescription ?? ""
  const charsLine = (meta.beatCharacters ?? []).join(", ")
  const proseTrimmed = (row.task.prose ?? "").slice(0, 2000)
  return `BEAT: ${beatDesc}
CHARACTERS EXPECTED: ${charsLine}

PROSE:
---
${proseTrimmed}
---`
}

interface OracleLabel {
  pass: boolean | null
}

function getOracleLabel(row: any): OracleLabel {
  if (row.case_role === "synthetic_fixture") {
    return { pass: row.gold.expected_pass }
  }
  const goldStatus = row.gold?.calibration_status
  if (goldStatus === "TN") return { pass: true }
  if (goldStatus === "TP") return { pass: false }
  if (goldStatus === "FN") return { pass: false }
  if (goldStatus === "FP") return { pass: true }
  if (goldStatus === "MIXED") {
    // For adherence, MIXED is rare; default to looking at events_present
    // in gold, fallback to null to skip from oracle metrics.
    return { pass: row.gold?.events_present ?? null }
  }
  return { pass: null }
}

interface CallResult {
  events_present: boolean | null
  failed: boolean
  error_text?: string
}

async function runOneCall(userPrompt: string, temperature: number): Promise<CallResult> {
  try {
    const result = await callAgent({
      agentName: "adherence-events" as const,
      systemPrompt: EVENTS_SYSTEM,
      userPrompt,
      schema: eventsSchema,
      temperature,
    })
    return { events_present: result.output.events_present, failed: false }
  } catch (err) {
    return {
      events_present: null,
      failed: true,
      error_text: err instanceof Error ? err.message : String(err),
    }
  }
}

interface RowResult {
  fixture_id: string
  case_role: string
  oracle_pass: boolean | null
  n_calls: number
  individual_calls: CallResult[]
  vote_count_fail: number
  vote_count_pass: number
  vote_count_error: number
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
  const userPrompt = buildAdherenceUserPrompt(row)
  const calls = await Promise.all(
    Array.from({ length: n }, () => runOneCall(userPrompt, temperature))
  )
  // events_present=false ⇒ adherence FAIL ⇒ vote_count_fail++
  const vote_count_fail = calls.filter(c => c.events_present === false).length
  const vote_count_pass = calls.filter(c => c.events_present === true).length
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
  async function runner() {
    while (true) {
      const i = nextIdx++
      if (i >= items.length) return
      const r = await worker(items[i]!)
      results[i] = r
      if (onComplete) onComplete(r, i, items.length)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runner()))
  return results
}

async function main() {
  const args = parseArgs()

  // Cost-tracking: see convergence-eval.ts comment — callAgent only writes
  // llm_calls when novelId or an experiment run is set. Without this,
  // convergence runs are invisible in the cost ledger.
  if (args.expId !== undefined) {
    const { initExperimentRun } = await import("../../src/logger")
    const runId = await initExperimentRun(
      args.expId,
      "adherence-events-convergence",
      `T${args.temperature}-N${args.n}`,
      args.variantLabel,
    )
    console.log(`[runs] initialized run id=${runId} for experiment_id=${args.expId} (llm_calls will persist)`)
  } else {
    console.warn(`[warn] --exp-id not passed; llm_calls will NOT persist (cost untracked)`)
  }

  const lines = readFileSync(resolve(args.inPath), "utf8").trim().split("\n")
  const rows = lines.map(l => JSON.parse(l)).filter(r => r.checker === "adherence-events")
  console.log(
    `adherence-convergence: n=${args.n} temp=${args.temperature} rows=${rows.length} parallelism=${PARALLELISM}`
  )

  const startMs = Date.now()
  const results = await processWithConcurrency(
    rows,
    row => processRow(row, args.n, args.temperature),
    PARALLELISM,
    (r, i, total) => {
      const oracleStr = r.oracle_pass === null ? "?" : r.oracle_pass ? "PASS" : "FAIL"
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

  type Counts = Record<string, number>
  const perThreshold: Array<{ threshold: number; counts: Counts; recall?: number; precision?: number; f1?: number }> = []
  console.log("\nPer-threshold matrices (TP/FP/FN/TN/ERROR/NO-ORACLE), then recall/precision/F1:")
  for (let k = 1; k <= args.n; k++) {
    const counts: Counts = { TP: 0, FP: 0, FN: 0, TN: 0, ERROR: 0, "NO-ORACLE": 0 }
    for (const r of results) {
      const v = r.threshold_verdicts.find(v => v.threshold === k)
      if (v) counts[v.calibration] = (counts[v.calibration] ?? 0) + 1
    }
    const tp = counts.TP ?? 0, fp = counts.FP ?? 0, fn = counts.FN ?? 0, tn = counts.TN ?? 0
    const recall = tp + fn > 0 ? tp / (tp + fn) : NaN
    const precision = tp + fp > 0 ? tp / (tp + fp) : NaN
    const f1 = !isNaN(recall) && !isNaN(precision) && recall + precision > 0
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
      `  k>=${k}: TP=${tp} FP=${fp} FN=${fn} TN=${tn}  recall=${isNaN(recall) ? "n/a" : recall.toFixed(3)}  precision=${isNaN(precision) ? "n/a" : precision.toFixed(3)}  F1=${isNaN(f1) ? "n/a" : f1.toFixed(3)}`
    )
  }

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
      probeName: "adherence-events-convergence",
      gitCommit: currentGitCommit(),
      experimentId: args.expId ?? null,
      seedsUsed: ["fantasy-system-heretic"],
      variantLabels: [args.variantLabel],
      summaryJson: summary,
      verdict,
      notes: args.note ?? null,
    })
    console.log(`\n[persist] phase_eval_runs.id=${runId} probe=adherence-events-convergence verdict=${verdict}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
