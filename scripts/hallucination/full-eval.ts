/**
 * Full val eval for hallucination-checker-v1:v1 on the held-out 160-beat set.
 *
 * Persists per-beat rows to eval_results (new checker columns from sql/026)
 * and links to a tuning_experiment. Target from docs/todo.md: ≥90% precision
 * on the FAIL class vs Sonnet ground truth.
 *
 * Usage (on LXC):
 *   bun scripts/hallucination/full-eval.ts
 *   EXPERIMENT_ID=223 bun scripts/hallucination/full-eval.ts   # reuse existing
 */

import fs from "node:fs"
import readline from "node:readline"
import db from "../../src/db/connection"
import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"

const ADAPTER = process.env.HALLUC_ADAPTER ?? "wandb-artifact:///andre14618-/novel-harness/hallucination-checker-v1:v1"
const VAL_PATH = process.env.HALLUC_VAL_PATH ?? "finetune-data/halluc-checker-v1-val.jsonl"
const SET_NAME = process.env.HALLUC_SET_NAME ?? "hallucination-val-v1"
const CELL_LABEL = process.env.HALLUC_CELL_LABEL ?? "hallucination-checker-v1-v1"
const CONCURRENCY = 6

const key = process.env.WANDB_API_KEY
if (!key) throw new Error("WANDB_API_KEY missing")

interface Msg { role: string; content: string }
interface Row { messages: Msg[] }

async function loadVal(): Promise<Row[]> {
  const rows: Row[] = []
  const rl = readline.createInterface({ input: fs.createReadStream(VAL_PATH) })
  for await (const line of rl) {
    if (!line.trim()) continue
    rows.push(JSON.parse(line))
  }
  return rows
}

async function upsertBriefs(rows: Row[]) {
  // Idempotent — unique(set_name, beat_id). Store system/user/expected in brief_json
  // so future reruns of the same set are reproducible.
  let inserted = 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const beatId = `halluc_val_${String(i).padStart(3, "0")}`
    const system = r.messages.find(m => m.role === "system")!.content
    const user = r.messages.find(m => m.role === "user")!.content
    const expected = JSON.parse(r.messages.find(m => m.role === "assistant")!.content)
    const brief = { system, user, expected }
    const res = await db`
      INSERT INTO eval_briefs (set_name, beat_id, brief_json, notes)
      VALUES (${SET_NAME}, ${beatId}, ${brief as any}, ${"hallucination-checker-v1 held-out val (80/20 split, Sonnet-labeled)"})
      ON CONFLICT (set_name, beat_id) DO NOTHING
      RETURNING id
    `
    if ((res as any[]).length > 0) inserted++
  }
  return inserted
}

async function callAdapter(system: string, user: string): Promise<{ raw: string; ms: number; err?: string }> {
  const t0 = performance.now()
  try {
    const res = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ADAPTER,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0,
        max_tokens: 800,
      }),
    })
    const ms = performance.now() - t0
    if (!res.ok) return { raw: "", ms, err: `${res.status}: ${(await res.text()).slice(0, 300)}` }
    const json: any = await res.json()
    return { raw: json.choices?.[0]?.message?.content ?? "", ms }
  } catch (e: any) {
    return { raw: "", ms: performance.now() - t0, err: e.message ?? String(e) }
  }
}

function tryParse(s: string): { pass: boolean; issues: any[] } | null {
  if (!s) return null
  const start = s.indexOf("{")
  const end = s.lastIndexOf("}")
  if (start < 0 || end < 0) return null
  try {
    const j = JSON.parse(s.slice(start, end + 1))
    if (typeof j?.pass === "boolean" && Array.isArray(j?.issues)) return j
    return null
  } catch { return null }
}

interface Result {
  beatId: string
  expected: any
  actual: any | null
  raw: string
  ms: number
  err?: string
}

async function evalOne(row: Row, idx: number): Promise<Result> {
  const beatId = `halluc_val_${String(idx).padStart(3, "0")}`
  const system = row.messages.find(m => m.role === "system")!.content
  const user = row.messages.find(m => m.role === "user")!.content
  const expected = JSON.parse(row.messages.find(m => m.role === "assistant")!.content)
  const { raw, ms, err } = await callAdapter(system, user)
  const actual = tryParse(raw)
  return { beatId, expected, actual, raw, ms, err }
}

async function writeResult(experimentId: number, r: Result) {
  const expFail = !r.expected.pass
  const actFail = r.actual ? !r.actual.pass : null
  const correct = r.actual ? (expFail === actFail) : null
  await db`
    INSERT INTO eval_results (
      experiment_id, set_name, beat_id, adapter_uri, cell_label,
      expected_label_json, actual_label_json, correct, latency_ms, error_text
    ) VALUES (
      ${experimentId}, ${SET_NAME}, ${r.beatId}, ${ADAPTER}, ${CELL_LABEL},
      ${r.expected as any}, ${(r.actual ?? null) as any}, ${correct}, ${Math.round(r.ms)},
      ${r.err ?? (r.actual ? null : `parse_fail: ${r.raw.slice(0, 200)}`)}
    )
  `
}

async function main() {
  const rows = await loadVal()
  console.log(`Loaded ${rows.length} val examples`)

  const briefsAdded = await upsertBriefs(rows)
  console.log(`Upserted eval_briefs: ${briefsAdded} new / ${rows.length} total in set ${SET_NAME}`)

  const existingExpId = process.env.EXPERIMENT_ID ? Number(process.env.EXPERIMENT_ID) : null
  const experimentId = existingExpId ?? await createTuningExperiment(
    "checker_eval",
    `Hallucination checker v1:v1 — full val eval on 160-beat held-out set`,
    {
      adapter_uri: ADAPTER,
      set_name: SET_NAME,
      val_size: rows.length,
      target_precision: 0.90,
      val_file: VAL_PATH,
    },
    { target: "hallucination-checker-v1", dimension: "accuracy" },
  )
  console.log(`Experiment id=${experimentId}\n`)

  // Concurrent fan-out
  const results: Result[] = new Array(rows.length)
  let done = 0
  async function worker(start: number) {
    for (let i = start; i < rows.length; i += CONCURRENCY) {
      results[i] = await evalOne(rows[i], i)
      done++
      if (done % 10 === 0) process.stdout.write(`.`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, w) => worker(w)))
  console.log()

  // Persist sequentially (cheap compared to LLM calls)
  for (const r of results) await writeResult(experimentId, r)

  // Score
  let tp = 0, fp = 0, tn = 0, fn = 0, parseErr = 0, callErr = 0
  const latencies: number[] = []
  const fpRows: Result[] = [], fnRows: Result[] = []
  for (const r of results) {
    if (r.err) { callErr++; continue }
    if (!r.actual) { parseErr++; continue }
    latencies.push(r.ms)
    const expFail = !r.expected.pass
    const actFail = !r.actual.pass
    if (expFail && actFail) tp++
    else if (!expFail && actFail) { fp++; fpRows.push(r) }
    else if (!expFail && !actFail) tn++
    else { fn++; fnRows.push(r) }
  }
  const total = tp + fp + tn + fn
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  const acc = total > 0 ? (tp + tn) / total : 0
  const avgMs = latencies.length ? latencies.reduce((s, x) => s + x, 0) / latencies.length : 0
  const p95 = latencies.length ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] : 0

  console.log(`\n── summary ──`)
  console.log(`scored: ${total}/${rows.length}   parse_errors: ${parseErr}   call_errors: ${callErr}`)
  console.log(`TP=${tp}  FP=${fp}  TN=${tn}  FN=${fn}`)
  console.log(`precision(FAIL): ${(precision * 100).toFixed(1)}%   recall(FAIL): ${(recall * 100).toFixed(1)}%   F1: ${(f1 * 100).toFixed(1)}%   accuracy: ${(acc * 100).toFixed(1)}%`)
  console.log(`latency: avg ${Math.round(avgMs)}ms  p95 ${Math.round(p95)}ms`)
  if (fpRows.length) {
    console.log(`\nFalse positives (${fpRows.length}) — flagged entities:`)
    for (const r of fpRows.slice(0, 10)) console.log(`  ${r.beatId}: ${r.actual.issues.map((x: any) => x.entity).join(", ")}`)
  }
  if (fnRows.length) {
    console.log(`\nFalse negatives (${fnRows.length}) — missed entities:`)
    for (const r of fnRows.slice(0, 10)) console.log(`  ${r.beatId}: expected ${r.expected.issues.map((x: any) => x.entity).join(", ")}`)
  }

  const summary = `precision=${(precision * 100).toFixed(1)}% recall=${(recall * 100).toFixed(1)}% F1=${(f1 * 100).toFixed(1)}% acc=${(acc * 100).toFixed(1)}% (n=${total}, TP=${tp} FP=${fp} TN=${tn} FN=${fn}, parse_err=${parseErr}, call_err=${callErr}, avg_ms=${Math.round(avgMs)})`
  await concludeExperiment(experimentId, summary)
  console.log(`\nWrote eval_results rows. Experiment ${experimentId} concluded:\n  ${summary}`)
  process.exit(0)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
