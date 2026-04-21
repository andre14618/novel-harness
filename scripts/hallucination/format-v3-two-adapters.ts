/**
 * Stage 5 SFT formatter for the v3 two-adapter architecture.
 *
 * Builds TWO focused training sets from the combined pool (Cerebras synth +
 * DeepSeek synth + v1 natural), applying Sonnet-flipped labels where
 * available. Drops FAIL_CORPUS_LEAK and FAIL_FIRST_NEW_LAST from the
 * ungrounded-entity set (leak has its own adapter, drift is dropped
 * entirely per the v3 decision).
 *
 *   1. halluc-ungrounded-entity  — corpus-agnostic grounded-context check
 *   2. halluc-leak-salvatore     — per-writer leak-vocabulary check
 *
 * Output:
 *   finetune-data/halluc-ungrounded-v1-{train,val-synth}.jsonl
 *   finetune-data/halluc-leak-salvatore-v1-{train,val-synth}.jsonl
 *
 * Usage:
 *   bun scripts/hallucination/format-v3-two-adapters.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { regexLeakMatches, LEAK_TOKENS } from "../../src/agents/halluc-leak-salvatore/regex-leak"

// Case-insensitive lookup for matching Sonnet-issue entities to canonical
// leak tokens. We match on normalized form so "drizzt" / "Drizzt's" both
// resolve to the canonical "Drizzt" entry.
const LEAK_TOKEN_SET = new Set(LEAK_TOKENS.map(t => t.toLowerCase()))
function canonicalLeakToken(entity: string): string | null {
  const norm = entity.toLowerCase().replace(/[^a-z0-9' -]/g, "").trim()
  // Exact hit
  if (LEAK_TOKEN_SET.has(norm)) {
    return LEAK_TOKENS.find(t => t.toLowerCase() === norm) ?? null
  }
  // Possessive suffix strip ("drizzt's" → "drizzt")
  const stripped = norm.replace(/'s$/, "").replace(/s$/, "")
  if (LEAK_TOKEN_SET.has(stripped)) {
    return LEAK_TOKENS.find(t => t.toLowerCase() === stripped) ?? null
  }
  return null
}

const OUT_DIR = "finetune-data"

const CEREBRAS_RAW = "finetune-data/halluc-checker-v2-pairs-raw.jsonl"
const DS_RAW = "finetune-data/halluc-checker-v2-pairs-ds.jsonl"
const V1_NATURAL_TRAIN = "finetune-data/halluc-checker-v1-train.jsonl"

const CEREBRAS_SONNET = "/tmp/halluc-label/combined.jsonl"
const DS_SONNET_DIR = "/tmp/halluc-label-ds"

// ── System prompts (narrower than v2's kitchen-sink prompt) ───────────────

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

// ── Types ─────────────────────────────────────────────────────────────────

interface RawPair {
  messages: Array<{ role: string; content: string }>
  _meta: {
    scenario: string
    variant: string
    subcase: string | null
    pass: boolean
    picked: string | null
    genre: string
    split: "train" | "val"
    regen?: boolean
  }
}

interface SonnetResult {
  idx: number
  scenario: string
  variant: string
  subcase: string | null
  found: { pass: boolean; issues: Array<{ entity: string; excerpt: string }> }
  expected: { pass: boolean; issues: Array<{ entity: string; excerpt: string }> }
  match: boolean
  note: string | null
}

// ── Loaders ───────────────────────────────────────────────────────────────

function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return []
  const text = readFileSync(path, "utf8").trim()
  if (!text) return []
  return text.split("\n").map(l => JSON.parse(l) as T)
}

function loadSonnetResults(path: string): Map<string, SonnetResult> {
  const results = loadJsonl<SonnetResult>(path)
  const byKey = new Map<string, SonnetResult>()
  for (const r of results) byKey.set(`${r.scenario}:${r.variant}`, r)
  return byKey
}

// Merge per-batch DS Sonnet results into one combined JSONL
function combineDsBatches(dir: string, out: string): number {
  const { readdirSync } = require("fs")
  if (!existsSync(dir)) return 0
  const files = readdirSync(dir).filter((f: string) => f.startsWith("results_") && f.endsWith(".jsonl")).sort()
  const all: SonnetResult[] = []
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8").trim()
    if (!text) continue
    for (const line of text.split("\n")) all.push(JSON.parse(line))
  }
  writeFileSync(out, all.map(r => JSON.stringify(r)).join("\n") + "\n")
  return all.length
}

// ── Label application ────────────────────────────────────────────────────

function applyLabel(p: RawPair, sonnet: Map<string, SonnetResult>): RawPair {
  const key = `${p._meta.scenario}:${p._meta.variant}`
  const s = sonnet.get(key)
  if (!s || s.match) return p
  // Flip to Sonnet's verdict
  const newAssistant = JSON.stringify({ pass: s.found.pass, issues: s.found.issues })
  return {
    ...p,
    messages: p.messages.map(m => m.role === "assistant" ? { ...m, content: newAssistant } : m),
    _meta: { ...p._meta, pass: s.found.pass },
  }
}

// ── Per-adapter transformers ─────────────────────────────────────────────

/**
 * Ungrounded-entity adapter: drop FAIL_CORPUS_LEAK + FAIL_FIRST_NEW_LAST
 * variants. Replace system prompt. Keep message shape otherwise.
 */
function toUngroundedPair(p: RawPair): RawPair | null {
  const v = p._meta.variant
  if (v === "FAIL_CORPUS_LEAK" || v === "FAIL_FIRST_NEW_LAST") return null
  return {
    ...p,
    messages: p.messages.map(m =>
      m.role === "system" ? { ...m, content: UNGROUNDED_SYSTEM } : m,
    ),
  }
}

/**
 * Leak adapter: binary has_leak. Labels are derived from the prose itself
 * (Sonnet-corrected assistant payload + canonical LEAK_TOKENS regex) —
 * NOT from `_meta.variant`. Prior behavior trusted the original generator
 * variant tag, which meant Sonnet-flipped examples were silently poisoned:
 * a FAIL_CORPUS_LEAK variant that Sonnet re-graded as pass-no-issue still
 * got stamped has_leak=true, training the adapter on clean prose labeled
 * as leak-positive.
 *
 * New derivation (variant-agnostic, post-Sonnet):
 *   1. Parse the current (possibly Sonnet-flipped) assistant payload.
 *   2. Intersect the payload's issue entities with LEAK_TOKENS via
 *      `canonicalLeakToken` (case-insensitive, possessive-tolerant).
 *   3. Union with `regexLeakMatches(prose)` so leak tokens Sonnet didn't
 *      explicitly cite still get labeled.
 *   4. has_leak = leaks.length > 0.
 *
 * Prose-only user prompt (strips brief/world_bible/speakers).
 */
function toLeakPair(p: RawPair): RawPair {
  // Extract prose from the original user content
  const userContent = p.messages.find(m => m.role === "user")!.content
  const proseMatch = userContent.match(/PROSE TO CHECK:\n([\s\S]+)$/)
  const prose = proseMatch ? proseMatch[1]!.trim() : userContent

  // Source 1 — canonical leak tokens that actually appear in the prose.
  const regexHits = regexLeakMatches(prose)

  // Source 2 — Sonnet-corrected issue entities (if any).
  const assistantContent = p.messages.find(m => m.role === "assistant")?.content ?? ""
  let issueEntities: string[] = []
  try {
    const payload = JSON.parse(assistantContent) as { pass?: boolean; issues?: Array<{ entity?: string }> }
    issueEntities = (payload.issues ?? [])
      .map(i => i?.entity ?? "")
      .filter(e => e.length > 0)
  } catch {
    // Malformed assistant — fall back to regex-only.
  }
  const issueLeakTokens = issueEntities
    .map(e => canonicalLeakToken(e))
    .filter((t): t is string => t !== null)

  // Dedup-preserving union (regex first so canonical casing wins).
  const seen = new Set<string>()
  const leaks: string[] = []
  for (const t of [...regexHits, ...issueLeakTokens]) {
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    leaks.push(t)
  }
  const hasLeak = leaks.length > 0

  return {
    messages: [
      { role: "system", content: LEAK_SYSTEM },
      { role: "user", content: `PROSE:\n${prose}` },
      { role: "assistant", content: JSON.stringify({ has_leak: hasLeak, leaks }) },
    ],
    _meta: { ...p._meta, pass: !hasLeak /* overload for balance tracking */ },
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("Combining DS Sonnet results...")
  const dsCombinedPath = join(DS_SONNET_DIR, "combined.jsonl")
  const dsCount = combineDsBatches(DS_SONNET_DIR, dsCombinedPath)
  console.log(`  DS Sonnet labels: ${dsCount}`)

  const cerebrasSonnet = loadSonnetResults(CEREBRAS_SONNET)
  const dsSonnet = loadSonnetResults(dsCombinedPath)
  console.log(`Cerebras Sonnet: ${cerebrasSonnet.size} labels; DS Sonnet: ${dsSonnet.size} labels`)

  const cerebrasPairs = loadJsonl<RawPair>(CEREBRAS_RAW)
  const dsPairs = loadJsonl<RawPair>(DS_RAW)
  console.log(`Raw pairs: Cerebras=${cerebrasPairs.length}, DS=${dsPairs.length}`)

  // Apply Sonnet flipping
  let flippedC = 0, flippedD = 0
  const cerebrasFinal = cerebrasPairs.map(p => {
    const key = `${p._meta.scenario}:${p._meta.variant}`
    const s = cerebrasSonnet.get(key)
    if (s && !s.match) flippedC++
    return applyLabel(p, cerebrasSonnet)
  })
  const dsFinal = dsPairs.map(p => {
    const key = `${p._meta.scenario}:${p._meta.variant}`
    const s = dsSonnet.get(key)
    if (s && !s.match) flippedD++
    return applyLabel(p, dsSonnet)
  })
  console.log(`  Flipped: Cerebras=${flippedC}, DS=${flippedD}`)

  // ── Load v1 natural train (distribution bridge) ──
  const v1Natural: RawPair[] = loadJsonl<RawPair>(V1_NATURAL_TRAIN)
    .map(p => ({
      ...p,
      _meta: {
        ...(p._meta ?? {}),
        scenario: "v1_natural",
        variant: "NATURAL",
        subcase: null,
        pass: JSON.parse(p.messages.find(m => m.role === "assistant")!.content).pass,
        picked: null,
        genre: "mixed",
        split: "train" as const,
      },
    }))
  console.log(`V1 natural train: ${v1Natural.length} pairs (merged into ungrounded)`)

  // ── Adapter 1: halluc-ungrounded-entity ──
  console.log("\n── halluc-ungrounded-entity ──")
  const ungroundedAll = [...cerebrasFinal, ...dsFinal, ...v1Natural]
    .map(toUngroundedPair)
    .filter((p): p is RawPair => p !== null)
  const unTrain = ungroundedAll.filter(p => p._meta.split === "train")
  const unVal = ungroundedAll.filter(p => p._meta.split === "val")
  console.log(`  train=${unTrain.length}  val=${unVal.length}`)
  const unClass = (arr: RawPair[]) => ({
    pass: arr.filter(p => p._meta.pass).length,
    fail: arr.filter(p => !p._meta.pass).length,
  })
  console.log(`  train class: ${JSON.stringify(unClass(unTrain))}`)
  console.log(`  val class:   ${JSON.stringify(unClass(unVal))}`)

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(
    join(OUT_DIR, "halluc-ungrounded-v1-train.jsonl"),
    unTrain.map(p => JSON.stringify(p)).join("\n") + "\n",
  )
  writeFileSync(
    join(OUT_DIR, "halluc-ungrounded-v1-val-synth.jsonl"),
    unVal.map(p => JSON.stringify(p)).join("\n") + "\n",
  )

  // ── Adapter 2: halluc-leak-salvatore ──
  console.log("\n── halluc-leak-salvatore ──")
  const leakAll = [...cerebrasFinal, ...dsFinal].map(toLeakPair)
  const leakTrain = leakAll.filter(p => p._meta.split === "train")
  const leakVal = leakAll.filter(p => p._meta.split === "val")

  // Class balance — leak positives are rare (~10% of total). Subsample negatives
  // to roughly match positive count for balance.
  const tPos = leakTrain.filter(p => !p._meta.pass)   // pass=false means has_leak
  const tNeg = leakTrain.filter(p => p._meta.pass)
  const rng = (() => { let s = 42; return () => (s = (s * 9301 + 49297) % 233280) / 233280 })()
  const shuffled = tNeg.slice().sort(() => rng() - 0.5)
  const leakTrainBalanced = [...tPos, ...shuffled.slice(0, tPos.length * 2)]   // 1:2 positive:negative
  console.log(`  train: ${tPos.length} positive + ${tPos.length * 2} negative (sampled from ${tNeg.length}) = ${leakTrainBalanced.length} total`)

  const vPos = leakVal.filter(p => !p._meta.pass)
  const vNeg = leakVal.filter(p => p._meta.pass).slice(0, vPos.length * 2)
  const leakValBalanced = [...vPos, ...vNeg]
  console.log(`  val: ${vPos.length} positive + ${vNeg.length} negative = ${leakValBalanced.length} total`)

  writeFileSync(
    join(OUT_DIR, "halluc-leak-salvatore-v1-train.jsonl"),
    leakTrainBalanced.map(p => JSON.stringify(p)).join("\n") + "\n",
  )
  writeFileSync(
    join(OUT_DIR, "halluc-leak-salvatore-v1-val-synth.jsonl"),
    leakValBalanced.map(p => JSON.stringify(p)).join("\n") + "\n",
  )

  console.log("\nDone. Output files:")
  console.log(`  ${OUT_DIR}/halluc-ungrounded-v1-{train,val-synth}.jsonl`)
  console.log(`  ${OUT_DIR}/halluc-leak-salvatore-v1-{train,val-synth}.jsonl`)
  console.log("\nNext: submit both to W&B SFT (parallel).")
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
