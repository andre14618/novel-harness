/**
 * Smoke test for hallucination-checker-v1:v1.
 *
 * Runs the first N val examples through the W&B adapter and prints
 * expected vs actual, plus a running pass/fail confusion count. Not a
 * scored eval — that comes next once the shape is confirmed clean.
 *
 * Usage (on LXC):
 *   bun scripts/hallucination/smoke-eval.ts [N]
 */

import fs from "node:fs"
import readline from "node:readline"

const ADAPTER = "wandb-artifact:///andre14618-/novel-harness/hallucination-checker-v1:v1"
const VAL_PATH = "finetune-data/halluc-checker-v1-val.jsonl"
const N = Number(process.argv[2] ?? 20)

const key = process.env.WANDB_API_KEY
if (!key) throw new Error("WANDB_API_KEY missing")

interface Msg { role: string; content: string }
interface Row { messages: Msg[] }

async function callAdapter(system: string, user: string): Promise<{ raw: string; ms: number }> {
  const t0 = performance.now()
  const res = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ADAPTER,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 800,
    }),
  })
  const ms = performance.now() - t0
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  const json: any = await res.json()
  return { raw: json.choices?.[0]?.message?.content ?? "", ms }
}

function tryParse(s: string): { pass: boolean; issues: any[] } | null {
  try {
    const j = JSON.parse(s)
    if (typeof j?.pass === "boolean" && Array.isArray(j?.issues)) return j
    return null
  } catch {
    return null
  }
}

async function main() {
  const rows: Row[] = []
  const rl = readline.createInterface({ input: fs.createReadStream(VAL_PATH) })
  for await (const line of rl) {
    if (!line.trim()) continue
    rows.push(JSON.parse(line))
    if (rows.length >= N) break
  }
  console.log(`Adapter: ${ADAPTER}`)
  console.log(`Val file: ${VAL_PATH}, running ${rows.length} examples\n`)

  let tp = 0, fp = 0, tn = 0, fn = 0, parseErr = 0
  const latencies: number[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const system = r.messages.find(m => m.role === "system")!.content
    const user = r.messages.find(m => m.role === "user")!.content
    const expected = JSON.parse(r.messages.find(m => m.role === "assistant")!.content)

    let actual: { pass: boolean; issues: any[] } | null = null
    let raw = "", ms = 0
    try {
      const out = await callAdapter(system, user)
      raw = out.raw
      ms = out.ms
      latencies.push(ms)
      actual = tryParse(raw)
    } catch (e: any) {
      console.log(`[${i + 1}/${rows.length}] ERROR: ${e.message}`)
      continue
    }
    if (!actual) {
      parseErr++
      console.log(`[${i + 1}/${rows.length}] PARSE FAIL (${Math.round(ms)}ms). Raw: ${raw.slice(0, 200)}`)
      continue
    }

    // Pass = no issues. Positive class = FAIL (has issues).
    const expFail = !expected.pass
    const actFail = !actual.pass
    if (expFail && actFail) tp++
    else if (!expFail && actFail) fp++
    else if (!expFail && !actFail) tn++
    else fn++

    const marker = (expFail === actFail) ? "✓" : "✗"
    const expIssues = expected.issues.map((x: any) => x.entity).join(",") || "-"
    const actIssues = actual.issues.map((x: any) => x.entity).join(",") || "-"
    console.log(`[${i + 1}/${rows.length}] ${marker} exp=${expected.pass ? "pass" : "FAIL"}(${expIssues}) got=${actual.pass ? "pass" : "FAIL"}(${actIssues}) ${Math.round(ms)}ms`)
  }

  const total = tp + fp + tn + fn
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const acc = total > 0 ? (tp + tn) / total : 0
  const avgMs = latencies.length ? latencies.reduce((s, x) => s + x, 0) / latencies.length : 0

  console.log(`\n── summary ──`)
  console.log(`scored: ${total}/${rows.length}   parse_errors: ${parseErr}`)
  console.log(`TP=${tp}  FP=${fp}  TN=${tn}  FN=${fn}`)
  console.log(`precision(fail): ${(precision * 100).toFixed(1)}%   recall(fail): ${(recall * 100).toFixed(1)}%   accuracy: ${(acc * 100).toFixed(1)}%`)
  console.log(`avg latency: ${Math.round(avgMs)}ms`)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
