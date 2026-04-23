/**
 * Isolated eval of an ungrounded-check adapter on the natural val set.
 * Usage: HALLUC_ADAPTER=... bun scripts/hallucination/eval-ungrounded-isolated.ts
 */
import { readFileSync } from "fs"

const ADAPTER = process.env.HALLUC_ADAPTER
  ?? "wandb-artifact:///andre14618-/novel-harness/halluc-ungrounded-v3:v1"
const VAL_PATH = process.env.HALLUC_VAL_PATH
  ?? "finetune-data/halluc-checker-v1-val.jsonl"
const KEY = process.env.WANDB_API_KEY
if (!KEY) throw new Error("WANDB_API_KEY missing")

const SYSTEM = `You are a hallucination detector for generated fiction beats.

Given a beat's prose, brief, world bible excerpt, and speaker profiles, identify any NAMED ENTITY (character, place, faction, system) in the prose that does NOT appear in the supplied grounded context.

Grounded context includes: speakers, brief.characters, brief.setting, brief.pov, brief.summary, world_bible.locations, world_bible.cultures, world_bible.systems.

Pass (do not flag): sentence-initial common nouns, days/months, real-world references, generic titles ("the Captain"), cardinal coordinates, last-name aliases of grounded characters, title+grounded-surname aliases, lowercase generic race terms.

Edge rules: new character introduced only in dialogue → FAIL; plural ungrounded faction → FAIL.

Output ONLY valid JSON:
{"pass": bool, "issues": [{"entity": "...", "excerpt": "..."}]}

Empty issues array if pass. excerpt is a 10-30 word context span. Corpus-leakage detection is NOT in scope for this checker — a separate adapter handles Salvatore/Forgotten-Realms vocabulary matching.`

const pairs = readFileSync(VAL_PATH, "utf8").trim().split("\n").map(l => JSON.parse(l))
console.log(`Isolated eval ${pairs.length} pairs against ${ADAPTER}\n`)

async function call(sys: string, user: string): Promise<{ raw: string; ms: number }> {
  const t0 = performance.now()
  const r = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ADAPTER,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0, max_tokens: 600,
    }),
  })
  const ms = performance.now() - t0
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j: any = await r.json()
  return { raw: j.choices?.[0]?.message?.content ?? "", ms }
}

function parseJson(s: string): any | null {
  const st = s.indexOf("{"), en = s.lastIndexOf("}")
  if (st < 0 || en < 0) return null
  try { return JSON.parse(s.slice(st, en + 1)) } catch { return null }
}

const CONC = 6
const results = new Array(pairs.length)

async function worker(startIdx: number) {
  for (let i = startIdx; i < pairs.length; i += CONC) {
    const p = pairs[i]
    const user = p.messages[1].content
    const exp = JSON.parse(p.messages[2].content)
    try {
      const { raw, ms } = await call(SYSTEM, user)
      const got = parseJson(raw)
      if (!got || typeof got.pass !== "boolean") { results[i] = { err: "parse" }; continue }
      results[i] = { expFail: !exp.pass, actFail: !got.pass, got, exp, ms }
    } catch (e: any) {
      results[i] = { err: e.message }
    }
  }
}

await Promise.all(Array.from({ length: CONC }, (_, w) => worker(w)))

let tp = 0, fp = 0, tn = 0, fn = 0, err = 0
const lat: number[] = []
for (const r of results) {
  if (!r || r.err) { err++; continue }
  lat.push(r.ms)
  if (r.expFail && r.actFail) tp++
  else if (!r.expFail && r.actFail) fp++
  else if (!r.expFail && !r.actFail) tn++
  else fn++
}

const tot = tp + fp + tn + fn
const prec = tp + fp > 0 ? tp / (tp + fp) : 0
const rec = tp + fn > 0 ? tp / (tp + fn) : 0
const f1 = prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0
const acc = tot > 0 ? (tp + tn) / tot : 0
const avgMs = lat.length ? lat.reduce((s, x) => s + x, 0) / lat.length : 0

console.log(`── Ungrounded isolated on ${VAL_PATH} ──`)
console.log(`TP=${tp}  FP=${fp}  TN=${tn}  FN=${fn}  parseErr=${err}`)
console.log(`precision=${(prec * 100).toFixed(1)}%  recall=${(rec * 100).toFixed(1)}%  F1=${(f1 * 100).toFixed(1)}%  accuracy=${(acc * 100).toFixed(1)}%  avg_ms=${Math.round(avgMs)}`)
console.log(`\nBaseline v2 isolated: precision=90.3% recall=68.3%`)
