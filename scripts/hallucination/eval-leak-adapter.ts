/**
 * Eval the leak adapter on its synth val set ({has_leak, leaks[]} schema).
 */
import { readFileSync } from "fs"

const ADAPTER = process.env.HALLUC_ADAPTER
  ?? "wandb-artifact:///andre14618-/novel-harness/halluc-leak-salvatore-v1:v1"
const VAL_PATH = process.env.HALLUC_VAL_PATH
  ?? "finetune-data/halluc-leak-salvatore-v1-val-synth.jsonl"
const KEY = process.env.WANDB_API_KEY
if (!KEY) throw new Error("WANDB_API_KEY missing")

const pairs = readFileSync(VAL_PATH, "utf8").trim().split("\n").map(l => JSON.parse(l))
console.log(`Eval ${pairs.length} pairs against ${ADAPTER}`)

async function call(sys: string, user: string): Promise<{ raw: string; ms: number }> {
  const t0 = performance.now()
  const r = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ADAPTER,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0, max_tokens: 300,
    }),
  })
  const ms = performance.now() - t0
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j: any = await r.json()
  return { raw: j.choices?.[0]?.message?.content ?? "", ms }
}

function parseLeak(s: string): { has_leak: boolean; leaks: string[] } | null {
  const st = s.indexOf("{"), en = s.lastIndexOf("}")
  if (st < 0 || en < 0) return null
  try {
    const j = JSON.parse(s.slice(st, en + 1))
    if (typeof j.has_leak !== "boolean") return null
    return j
  } catch { return null }
}

let tp = 0, fp = 0, tn = 0, fn = 0, err = 0
const lat: number[] = []
const fpRows: any[] = [], fnRows: any[] = []

for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i]
  const sys = p.messages[0].content
  const user = p.messages[1].content
  const exp = JSON.parse(p.messages[2].content)
  try {
    const { raw, ms } = await call(sys, user)
    const got = parseLeak(raw)
    if (!got) { err++; continue }
    lat.push(ms)
    const eFail = exp.has_leak, aFail = got.has_leak
    if (eFail && aFail) tp++
    else if (!eFail && aFail) { fp++; fpRows.push({ i, got: got.leaks, exp: exp.leaks }) }
    else if (!eFail && !aFail) tn++
    else { fn++; fnRows.push({ i, exp: exp.leaks, got: got.leaks }) }
  } catch (e: any) { err++; console.log(`err idx=${i}: ${e.message}`) }
}

const tot = tp + fp + tn + fn
const prec = tp + fp > 0 ? tp / (tp + fp) : 0
const rec = tp + fn > 0 ? tp / (tp + fn) : 0
const f1 = prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0
const acc = tot > 0 ? (tp + tn) / tot : 0
const avgMs = lat.length ? lat.reduce((s, x) => s + x, 0) / lat.length : 0

console.log(`\nTP=${tp} FP=${fp} TN=${tn} FN=${fn} parseErr=${err}`)
console.log(`precision=${(prec * 100).toFixed(1)}%  recall=${(rec * 100).toFixed(1)}%  F1=${(f1 * 100).toFixed(1)}%  accuracy=${(acc * 100).toFixed(1)}%  avg_ms=${Math.round(avgMs)}`)
if (fpRows.length) console.log(`FPs (${fpRows.length}):`, fpRows.slice(0, 5))
if (fnRows.length) console.log(`FNs (${fnRows.length}):`, fnRows.slice(0, 5))
