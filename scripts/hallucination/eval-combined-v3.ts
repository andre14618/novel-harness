/**
 * Combined eval: run BOTH v3 adapters (ungrounded + leak) on the natural val
 * set. A beat is FAIL if EITHER adapter fires. Aggregate results.
 *
 * Fair comparison to v1 (86.5%/78%) and v2 (77.8%/51%) — on the same
 * 160-beat natural val, which includes both ungrounded-entity hallucinations
 * and Salvatore corpus leaks.
 */
import { readFileSync } from "fs"

const UNGROUNDED = process.env.HALLUC_UNGROUNDED_URI ?? "wandb-artifact:///andre14618-/novel-harness/halluc-ungrounded-v2:v1"
const LEAK = process.env.HALLUC_LEAK_URI ?? "wandb-artifact:///andre14618-/novel-harness/halluc-leak-salvatore-v1:v1"
const VAL_PATH = "finetune-data/halluc-checker-v1-val.jsonl"
const KEY = process.env.WANDB_API_KEY
if (!KEY) throw new Error("WANDB_API_KEY missing")

const UNGROUNDED_SYSTEM = `You are a hallucination detector for generated fiction beats.

Given a beat's prose, brief, world bible excerpt, and speaker profiles, identify any NAMED ENTITY (character, place, faction, system) in the prose that does NOT appear in the supplied grounded context.

Grounded context includes: speakers, brief.characters, brief.setting, brief.pov, brief.summary, world_bible.locations, world_bible.cultures, world_bible.systems.

Pass (do not flag): sentence-initial common nouns, days/months, real-world references, generic titles ("the Captain"), cardinal coordinates, last-name aliases of grounded characters, title+grounded-surname aliases, lowercase generic race terms.

Edge rules: new character introduced only in dialogue → FAIL; plural ungrounded faction → FAIL.

Output ONLY valid JSON:
{"pass": bool, "issues": [{"entity": "...", "excerpt": "..."}]}

Empty issues array if pass. excerpt is a 10-30 word context span. Corpus-leakage detection is NOT in scope for this checker — a separate adapter handles Salvatore/Forgotten-Realms vocabulary matching.`

const LEAK_SYSTEM = `You are a corpus-leak detector for generated fiction beats.

Given prose, identify any token that belongs to R.A. Salvatore's Icewind Dale / Forgotten Realms vocabulary — character names, places, items, races, or distinctive naming patterns that should never appear in a non-Salvatore novel.

Examples of leak tokens (case-insensitive):
Characters: Drizzt, Bruenor, Wulfgar, Regis, Catti-brie, Entreri, Jarlaxle, Zaknafein, Guenhwyvar, Akar Kessell, Dendybar, Pasha Pook, Deudermont, Rumblebelly.
Places: Mithril Hall, Mithral Hall, Icewind Dale, Ten-Towns, Bryn Shander, Termalaine, Easthaven, Luskan, Silverymoon, Calimport, Maer Dualdon, Kelvin's Cairn, Cryshal-Tirith, Faerûn, Sword Coast, Forgotten Realms.
Items: Crystal Shard, Crenshinibon, Aegis-fang, Twinkle, Icingdeath, Taulmaril.
Races: drow, verbeeg, duergar, svirfneblin.
Naming patterns: Do'Urden suffix, Battlehammer surname.

Output ONLY valid JSON:
{"has_leak": bool, "leaks": ["token1", "token2", ...]}

Empty leaks array if has_leak is false. Grounded-context checks are NOT in scope for this checker — a separate adapter handles ungrounded-named-entity detection.`

const pairs = readFileSync(VAL_PATH, "utf8").trim().split("\n").map(l => JSON.parse(l))
console.log(`Combined eval: ${pairs.length} natural-val pairs\n`)

function extractProse(userContent: string): string {
  const m = userContent.match(/PROSE TO CHECK:\n([\s\S]+)$/)
  return m ? m[1]!.trim() : userContent
}

async function callAdapter(adapter: string, sys: string, user: string): Promise<{ raw: string; ms: number }> {
  const t0 = performance.now()
  const r = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: adapter,
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

let tp = 0, fp = 0, tn = 0, fn = 0, err = 0
const fnRows: any[] = [], fpRows: any[] = []
const CONC = 6
const results = new Array(pairs.length)

async function worker(startIdx: number) {
  for (let i = startIdx; i < pairs.length; i += CONC) {
    const p = pairs[i]
    const origUser = p.messages[1].content
    const exp = JSON.parse(p.messages[2].content)
    const prose = extractProse(origUser)

    try {
      // Run both adapters in parallel
      const [ungroundedCall, leakCall] = await Promise.all([
        callAdapter(UNGROUNDED, UNGROUNDED_SYSTEM, origUser),
        callAdapter(LEAK, LEAK_SYSTEM, `PROSE:\n${prose}`),
      ])
      const ungrounded = parseJson(ungroundedCall.raw)
      const leak = parseJson(leakCall.raw)
      if (!ungrounded || !leak) { results[i] = { err: "parse" }; continue }

      // OR logic: FAIL if either adapter flags
      const actFail = ungrounded.pass === false || leak.has_leak === true
      const expFail = !exp.pass
      results[i] = { actFail, expFail, ungrounded, leak, exp, prose: prose.slice(0, 120) }
    } catch (e: any) {
      results[i] = { err: e.message }
    }
  }
}

await Promise.all(Array.from({ length: CONC }, (_, w) => worker(w)))

for (let i = 0; i < results.length; i++) {
  const r = results[i]
  if (r.err) { err++; continue }
  if (r.expFail && r.actFail) tp++
  else if (!r.expFail && r.actFail) { fp++; fpRows.push({ idx: i, ungrounded: r.ungrounded.issues?.map((x:any)=>x.entity), leak: r.leak.leaks }) }
  else if (!r.expFail && !r.actFail) tn++
  else { fn++; fnRows.push({ idx: i, expIssues: r.exp.issues?.map((x:any)=>x.entity), prose: r.prose }) }
}

const tot = tp + fp + tn + fn
const prec = tp + fp > 0 ? tp / (tp + fp) : 0
const rec = tp + fn > 0 ? tp / (tp + fn) : 0
const f1 = prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0
const acc = tot > 0 ? (tp + tn) / tot : 0

console.log(`── Combined (ungrounded OR leak) on natural val ──`)
console.log(`TP=${tp}  FP=${fp}  TN=${tn}  FN=${fn}  parseErr=${err}`)
console.log(`precision=${(prec * 100).toFixed(1)}%  recall=${(rec * 100).toFixed(1)}%  F1=${(f1 * 100).toFixed(1)}%  accuracy=${(acc * 100).toFixed(1)}%`)
console.log(`\nBaseline: v1=86.5%/78% F1 82.1%  |  v2=77.8%/51.2% F1 61.8%`)
if (fpRows.length) console.log(`\nFPs (${fpRows.length}):`, fpRows.slice(0, 5))
if (fnRows.length) console.log(`\nFNs (${fnRows.length}):`, fnRows.slice(0, 5))
