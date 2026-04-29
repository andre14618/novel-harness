#!/usr/bin/env bun
/**
 * Compute per-(book, dimension) precision/recall/F1 + per-field
 * disagreement + adjudicator self-disagreement + confidence calibration.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §1 + §7.
 *
 * Inputs (per dimension):
 *   - structure-gold/<book>/<dim>-gold.jsonl  (human labels)
 *   - structure-gold/<book>/<dim>-key.jsonl   (LLM predictions)
 *
 * Outputs:
 *   - structure-calibration/<book>.json with per-dim metrics + verdict.
 *
 * value-charge metrics (per-scene):
 *   - F1 over polarity match (binary: agree on polarity exactly)
 *   - per-field disagreement: valueIn, valueOut, lifeValue, polarity
 *   - confidence-vs-correctness curve (P at conf ≥ 0.9, ≥ 0.7, etc.)
 *
 * promise metrics (per-promise row, R6 §2 matching policy):
 *   - chapter-window join: |predicted.opened_chapter_index − gold.opened_chapter_index| ≤ 1
 *   - text similarity: Jaccard ≥ 0.5 OR Levenshtein ratio ≥ 0.6
 *   - tertiary entity check (R6 §2 condition 3) DEFERRED here — it
 *     requires a NER pass. The smoke's calibration uses only the
 *     chapter-window + text-similarity gate; the NER condition is
 *     implemented when the second-rater follow-on opens. Documented
 *     so the deferred condition isn't silently lost.
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { callAgent } from "../../src/llm"

const REPO_ROOT = new URL("../..", import.meta.url).pathname

interface Args {
  novel: string
  book: string
  dim: "value-charge" | "promise" | "mice" | "mckee-gap" | "character-arcs" | "all"
  matcher: "llm" | "tokens"
  /** Suffix for the key (extractor output) file, e.g. "pro" → <dim>-key.pro.jsonl.
   *  Null means no suffix (default extractor Flash output). */
  keySuffix: string | null
  /** Suffix for the gold (judge output) file, e.g. "flash" → <dim>-gold.flash.jsonl.
   *  Null means no suffix (default Pro judge output). */
  goldSuffix: string | null
  /** Full custom path for the key file (overrides suffix logic). Useful for
   *  promise Pro-extractor cells where the key is promises.pro.json (not in
   *  structure-gold/). */
  keyFile: string | null
}

function parseArgs(): Args {
  const map: Record<string, string> = {}
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (m) map[m[1]!] = m[2]!
  }
  const novel = map["novel"]
  const book = map["book"]
  const dim = (map["dim"] ?? "all") as Args["dim"]
  const matcherRaw = map["matcher"] ?? "llm"
  const matcher = matcherRaw === "tokens" ? "tokens" : "llm"
  if (!novel || !book) {
    console.error("Usage: bun scripts/corpus/compute-calibration.ts --novel=<key> --book=<book> [--dim=value-charge|promise|mice|mckee-gap|character-arcs|all] [--matcher=llm|tokens] [--key-suffix=<str>] [--gold-suffix=<str>] [--key-file=<path>]")
    process.exit(2)
  }
  return {
    novel, book, dim, matcher,
    keySuffix: map["key-suffix"] ?? null,
    goldSuffix: map["gold-suffix"] ?? null,
    keyFile: map["key-file"] ?? null,
  }
}

/** Build the file path for a key or gold file given an optional suffix.
 *  When suffix is null, uses the canonical name (no suffix).
 *  When suffix is "pro", returns e.g. "value-charge-key.pro.jsonl". */
function suffixedPath(dir: string, stem: string, suffix: string | null): string {
  if (suffix === null) return join(dir, `${stem}.jsonl`)
  return join(dir, `${stem}.${suffix}.jsonl`)
}

/** Build the output calibration file name from the suffix pair.
 *  When both suffixes null: "<book>.json"
 *  When suffixes present: "<book>.<keySuffix-or-default>x<goldSuffix-or-default>.json" */
function calibrationOutputName(book: string, keySuffix: string | null, goldSuffix: string | null): string {
  if (keySuffix === null && goldSuffix === null) return `${book}.json`
  const k = keySuffix ?? "flash"
  const g = goldSuffix ?? "pro"
  return `${book}.${k}x${g}.json`
}

async function readJsonl<T>(path: string): Promise<T[]> {
  if (!existsSync(path)) return []
  const text = await Bun.file(path).text()
  return text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T)
}

interface ValueChargeGold {
  sample_id: string
  scene_id: string
  /** Gold label — same shape as the LLM's ValueChargeOutput. Optional
   *  because llm-judge.ts emits {sample_id, scene_id, error} rows when
   *  the V4 Pro call fails (timeout, schema reject, etc.). Filter
   *  before metric compute. */
  output?: {
    valueIn: string
    valueOut: string
    lifeValue: string
    polarity: string
    confidence?: number
    abstain_reason?: string | null
  }
  error?: string
}

interface ValueChargeKey {
  sample_id: string
  scene_id: string
  llm_output: {
    valueIn: string
    valueOut: string
    lifeValue: string
    polarity: string
    confidence: number
    abstain_reason: string | null
  }
  is_retest_of_prior_sample?: boolean
}

interface ValueChargeMetrics {
  n: number
  precision: number
  recall: number
  f1: number
  polarityAgreement: number
  perField: Record<"valueIn" | "valueOut" | "lifeValue" | "polarity", { agree: number; n: number; rate: number }>
  retestSelfDisagreement: { n: number; disagree: number; rate: number } | null
  confidenceCurve: Array<{ threshold: number; n: number; precision: number }>
}

function computeValueChargeMetrics(gold: ValueChargeGold[], key: ValueChargeKey[]): ValueChargeMetrics & { judgeFailures: number } {
  // Drop judge-failure rows (timeout / schema reject / etc.) — keep the
  // count for telemetry. A high failure rate means the judge config
  // (timeout, maxTokens, prompt) needs adjustment, not that the
  // extractor is bad.
  const judgeFailures = gold.filter(g => !g.output).length
  const goldOk = gold.filter((g): g is ValueChargeGold & { output: NonNullable<ValueChargeGold["output"]> } => !!g.output)
  const keyById = new Map(key.map(k => [k.sample_id, k]))
  const matched: Array<{ g: typeof goldOk[number]; k: ValueChargeKey }> = []
  for (const g of goldOk) {
    const k = keyById.get(g.sample_id)
    if (k) matched.push({ g, k })
  }

  // Polarity agreement (R6 §1: lead metric for value-charge is precision
  // on polarity tag).
  const polarityAgree = matched.filter(({ g, k }) => g.output.polarity === k.llm_output.polarity).length
  const polarityAgreement = matched.length === 0 ? 0 : polarityAgree / matched.length

  // Treat polarity as binary: predicted is positive if non-zero polarity,
  // gold is positive if non-zero polarity. Then P/R/F1 over the "non-flat
  // scene" call.
  let tp = 0, fp = 0, fn = 0
  for (const { g, k } of matched) {
    const goldPos = g.output.polarity !== "0"
    const predPos = k.llm_output.polarity !== "0"
    if (predPos && goldPos) tp++
    else if (predPos && !goldPos) fp++
    else if (!predPos && goldPos) fn++
  }
  const precision = (tp + fp) === 0 ? 0 : tp / (tp + fp)
  const recall = (tp + fn) === 0 ? 0 : tp / (tp + fn)
  const f1 = (precision + recall) === 0 ? 0 : 2 * precision * recall / (precision + recall)

  // Per-field disagreement
  const fields: Array<keyof ValueChargeGold["output"]> = ["valueIn", "valueOut", "lifeValue", "polarity"]
  const perField = {} as ValueChargeMetrics["perField"]
  for (const f of fields) {
    const ag = matched.filter(({ g, k }) => (g.output as any)[f] === (k.llm_output as any)[f]).length
    perField[f as "valueIn" | "valueOut" | "lifeValue" | "polarity"] = {
      agree: ag,
      n: matched.length,
      rate: matched.length === 0 ? 0 : ag / matched.length,
    }
  }

  // Adjudicator self-disagreement (R6 §2 — silent retest).
  const goldByScene = new Map<string, ValueChargeGold[]>()
  for (const g of gold) {
    const arr = goldByScene.get(g.scene_id) ?? []
    arr.push(g)
    goldByScene.set(g.scene_id, arr)
  }
  let retestN = 0, retestDisagree = 0
  for (const [, golds] of goldByScene) {
    if (golds.length < 2) continue
    // Pairwise: count any disagreement on polarity within retests of the same scene.
    for (let i = 0; i < golds.length; i++) {
      for (let j = i + 1; j < golds.length; j++) {
        retestN++
        if (golds[i]!.output.polarity !== golds[j]!.output.polarity) retestDisagree++
      }
    }
  }
  const retestSelfDisagreement = retestN === 0 ? null : { n: retestN, disagree: retestDisagree, rate: retestDisagree / retestN }

  // Confidence-vs-correctness curve.
  const thresholds = [0.5, 0.7, 0.8, 0.9]
  const confidenceCurve = thresholds.map(t => {
    const filt = matched.filter(({ k }) => k.llm_output.confidence >= t)
    const correct = filt.filter(({ g, k }) => g.output.polarity === k.llm_output.polarity).length
    return {
      threshold: t,
      n: filt.length,
      precision: filt.length === 0 ? 0 : correct / filt.length,
    }
  })

  return {
    n: matched.length,
    precision, recall, f1,
    polarityAgreement,
    perField,
    retestSelfDisagreement,
    confidenceCurve,
    judgeFailures,
  }
}

interface PromiseGoldRow {
  sample_id: string
  promise_text: string
  opened_chapter_label: string
  opened_chapter_index: number
  closed_chapter_label?: string | null
  closed_chapter_index?: number | null
}

interface PromiseKeyRow {
  promise_id: string
  promise_text: string
  opened_chapter_label: string
  opened_chapter_index: number
  closed_chapter_label: string | null
  closed_chapter_index: number | null
  payoff_quality: string
  confidence: number
}

interface PromiseMatch {
  gold_id: string
  predicted_id: string
  /** "llm" → V4 Pro semantic match; "tokens" → Jaccard/Lev fallback. */
  matcher: "llm" | "tokens"
  /** Score: Jaccard/Lev max for "tokens"; LLM confidence for "llm". */
  score: number
  /** LLM-only: terse rationale from the matcher. */
  reason?: string
}

interface PromiseMetrics {
  goldN: number
  predN: number
  matchedN: number
  precision: number
  recall: number
  f1: number
  matcher: "llm" | "tokens"
  matched: PromiseMatch[]
  unmatchedGold: PromiseGoldRow[]
  unmatchedPredicted: PromiseKeyRow[]
}

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(t => t.length > 1))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

function levenshteinRatio(a: string, b: string): number {
  // Compact O(min(a,b)) implementation; ratio per the standard
  // 1 - dist/maxlen formula.
  const aa = a.toLowerCase(), bb = b.toLowerCase()
  const m = aa.length, n = bb.length
  if (m === 0 && n === 0) return 1
  if (m === 0 || n === 0) return 0
  const dp = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!
      dp[j] = aa[i - 1] === bb[j - 1] ? prev : Math.min(prev, dp[j]!, dp[j - 1]!) + 1
      prev = tmp
    }
  }
  const dist = dp[n]!
  const maxlen = Math.max(m, n)
  return 1 - dist / maxlen
}

const PROMISE_MATCH_SYSTEM = `You are an editorial analyst comparing two lists of \
narrative promises extracted from the same novel by two different readers (an \
AI extractor and a stronger AI judge). A "promise" is a question, threat, goal, \
or stake that the prose introduces and that the reader expects the story to \
resolve later.

You will receive:
  • PREDICTED — promises identified by the extractor, each with id, text, opened \
chapter index, and closed chapter index.
  • GOLD — promises identified by the judge, in the same shape.

Your job is to identify which (predicted_id, gold_id) PAIRS refer to the SAME \
underlying narrative promise, even when the wording differs. Use these rules:

1. Same promise = same narrative subject + same expected resolution. \
"Errtu will pursue the crystal shard" and "Errtu, a powerful demon, seeks the \
relic Crenshinibon" are the SAME promise — same subject (Errtu), same goal \
(obtain the artifact), even though they share few words.

2. The opened_chapter_index of matched pairs MUST be within ±1 of each other. \
A predicted promise opened in chapter 3 and a gold promise opened in chapter 8 \
cannot match — that is a different beat in the story.

3. A predicted promise matches AT MOST ONE gold promise (and vice versa). If \
two predictions look like they could match the same gold, pick the closer \
match and leave the other unmatched.

4. Different specificity levels can still match if the narrative subject is \
the same. "The party must reach Bryn Shander" matches "Drizzt and Wulfgar will \
escort Regis to Bryn Shander to warn the town" — same goal, different framing.

5. When in doubt, DO NOT match. False positives corrupt the calibration metric \
more than false negatives.

For each match, emit:
  • predicted_id and gold_id
  • confidence in [0, 1] — how sure you are these are the same promise
  • reason — one short sentence explaining why they refer to the same promise.

Only return matches you are confident about. Unmatched predictions and unmatched \
gold rows are tracked separately by the caller. `

const promiseMatchSchema = z.object({
  matches: z.array(z.object({
    predicted_id: z.string(),
    gold_id: z.string(),
    confidence: z.number().min(0).max(1),
    reason: z.string(),
  })),
})

async function llmMatchPromises(gold: PromiseGoldRow[], pred: PromiseKeyRow[]): Promise<PromiseMatch[]> {
  // Single batched call: dump both lists, ask V4 Pro to emit pairs.
  // Pre-filter the candidate pool with the chapter-window gate so the
  // matcher's prompt stays focused (the model still re-checks the
  // constraint per rule 2 in the system prompt).
  const predRows = pred.map(p => ({
    id: p.promise_id,
    text: p.promise_text,
    opened_chapter: p.opened_chapter_label,
    opened_index: p.opened_chapter_index,
    closed_chapter: p.closed_chapter_label,
    closed_index: p.closed_chapter_index,
  }))
  const goldRows = gold.map(g => ({
    id: g.sample_id,
    text: g.promise_text,
    opened_chapter: g.opened_chapter_label,
    opened_index: g.opened_chapter_index,
    closed_chapter: g.closed_chapter_label ?? null,
    closed_index: g.closed_chapter_index ?? null,
  }))

  const userPrompt = `PREDICTED (${predRows.length} promises):
${JSON.stringify(predRows, null, 2)}

GOLD (${goldRows.length} promises):
${JSON.stringify(goldRows, null, 2)}

Identify matched (predicted_id, gold_id) pairs per the system rules. Return only matches you are confident about. Emit a JSON object matching the schema { "matches": [ { predicted_id, gold_id, confidence, reason } ] }.`

  console.log(`  [match] V4 Pro pair-matching: ${predRows.length} predicted × ${goldRows.length} gold`)
  const result = await callAgent({
    agentName: "structure-promise-match" as any,
    systemPrompt: PROMISE_MATCH_SYSTEM,
    userPrompt,
    schema: promiseMatchSchema,
  })
  const matches = result.output.matches
  console.log(`  [match] V4 Pro returned ${matches.length} pair(s)`)

  // Validate: enforce 1:1 (model is told to do this, but we belt-and-brace).
  // If the model emits duplicates, keep the highest-confidence one.
  const byPred = new Map<string, typeof matches[number]>()
  const byGold = new Map<string, typeof matches[number]>()
  // First pass: pred-side dedupe (pick best confidence per predicted_id).
  for (const m of matches) {
    const cur = byPred.get(m.predicted_id)
    if (!cur || m.confidence > cur.confidence) byPred.set(m.predicted_id, m)
  }
  // Second pass: gold-side dedupe over the pred-deduped set.
  for (const m of byPred.values()) {
    const cur = byGold.get(m.gold_id)
    if (!cur || m.confidence > cur.confidence) byGold.set(m.gold_id, m)
  }
  const finalMatches = [...byGold.values()]
  if (finalMatches.length !== matches.length) {
    console.log(`  [match] dedupe collapsed ${matches.length} → ${finalMatches.length}`)
  }

  // Reject pairs the model emitted with chapter-distance > 1 (rule 2).
  const predById = new Map(pred.map(p => [p.promise_id, p]))
  const goldById = new Map(gold.map(g => [g.sample_id, g]))
  const checked: PromiseMatch[] = []
  for (const m of finalMatches) {
    const p = predById.get(m.predicted_id)
    const g = goldById.get(m.gold_id)
    if (!p || !g) {
      console.log(`  [match] skip unknown id pair pred=${m.predicted_id} gold=${m.gold_id}`)
      continue
    }
    if (Math.abs(p.opened_chapter_index - g.opened_chapter_index) > 1) {
      console.log(`  [match] reject chapter-window violation: pred ch${p.opened_chapter_index} vs gold ch${g.opened_chapter_index} — ${p.promise_text.slice(0, 60)}…`)
      continue
    }
    checked.push({
      gold_id: m.gold_id,
      predicted_id: m.predicted_id,
      matcher: "llm",
      score: m.confidence,
      reason: m.reason,
    })
  }
  return checked
}

function tokenMatchPromises(gold: PromiseGoldRow[], pred: PromiseKeyRow[]): PromiseMatch[] {
  // Legacy Jaccard/Levenshtein matcher — kept for opt-in fallback via
  // --matcher=tokens. Use only for sanity checks; the LLM matcher is
  // the production path.
  const matched: PromiseMatch[] = []
  const usedPredIds = new Set<string>()
  for (const g of gold) {
    let bestPredIdx = -1
    let bestScore = 0
    for (let i = 0; i < pred.length; i++) {
      const p = pred[i]!
      if (usedPredIds.has(p.promise_id)) continue
      if (Math.abs(p.opened_chapter_index - g.opened_chapter_index) > 1) continue
      const j = jaccard(tokenize(p.promise_text), tokenize(g.promise_text))
      const lev = levenshteinRatio(p.promise_text, g.promise_text)
      if (j < 0.5 && lev < 0.6) continue
      const combined = Math.max(j, lev)
      if (combined > bestScore) { bestScore = combined; bestPredIdx = i }
    }
    if (bestPredIdx >= 0) {
      const p = pred[bestPredIdx]!
      usedPredIds.add(p.promise_id)
      matched.push({ gold_id: g.sample_id, predicted_id: p.promise_id, matcher: "tokens", score: bestScore })
    }
  }
  return matched
}

async function computePromiseMetrics(gold: PromiseGoldRow[], pred: PromiseKeyRow[], matcher: "llm" | "tokens"): Promise<PromiseMetrics> {
  const matched = matcher === "llm"
    ? await llmMatchPromises(gold, pred)
    : tokenMatchPromises(gold, pred)
  const matchedGoldIds = new Set(matched.map(m => m.gold_id))
  const matchedPredIds = new Set(matched.map(m => m.predicted_id))
  const unmatchedGold = gold.filter(g => !matchedGoldIds.has(g.sample_id))
  const unmatchedPredicted = pred.filter(p => !matchedPredIds.has(p.promise_id))
  const tp = matched.length
  const fp = unmatchedPredicted.length
  const fn = unmatchedGold.length
  const precision = (tp + fp) === 0 ? 0 : tp / (tp + fp)
  const recall = (tp + fn) === 0 ? 0 : tp / (tp + fn)
  const f1 = (precision + recall) === 0 ? 0 : 2 * precision * recall / (precision + recall)
  return {
    goldN: gold.length, predN: pred.length, matchedN: tp,
    precision, recall, f1, matcher,
    matched, unmatchedGold, unmatchedPredicted,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MICE (per-scene MICE-thread calibration)
// ─────────────────────────────────────────────────────────────────────────────

interface MiceKeyRow {
  sample_id: string
  scene_id: string
  llm_output: {
    primary_thread: "M" | "I" | "C" | "E"
    secondary_thread: "M" | "I" | "C" | "E" | null
    opens_thread: boolean
    closes_thread: boolean
    thread_descriptor: string
    confidence: number
    evidence_quote: string
    abstain_reason: string | null
  }
  is_retest_of_prior_sample?: boolean
}

interface MiceGoldRow {
  sample_id: string
  scene_id: string
  output?: {
    primary_thread: "M" | "I" | "C" | "E"
    secondary_thread: "M" | "I" | "C" | "E" | null
    opens_thread: boolean
    closes_thread: boolean
    thread_descriptor: string
    confidence?: number
    abstain_reason?: string | null
  }
  error?: string
}

interface MiceMetrics {
  n: number
  judgeFailures: number
  precision: number
  recall: number
  f1: number
  /** Lead metric — primary_thread exact-match rate. Named primaryThreadAgreement
   *  (not polarityAgreement) so callers can distinguish MICE from value-charge. */
  primaryThreadAgreement: number
  perField: {
    primary_thread: { agree: number; n: number; rate: number }
    secondary_thread: { agree: number; n: number; rate: number }
    opens_thread: { agree: number; n: number; rate: number }
    closes_thread: { agree: number; n: number; rate: number }
  }
  retestSelfDisagreement: { n: number; disagree: number; rate: number } | null
}

function computeMiceMetrics(gold: MiceGoldRow[], key: MiceKeyRow[]): MiceMetrics {
  const judgeFailures = gold.filter(g => !g.output).length
  const goldOk = gold.filter((g): g is MiceGoldRow & { output: NonNullable<MiceGoldRow["output"]> } => !!g.output)
  const keyById = new Map(key.map(k => [k.sample_id, k]))
  const matched: Array<{ g: typeof goldOk[number]; k: MiceKeyRow }> = []
  for (const g of goldOk) {
    const k = keyById.get(g.sample_id)
    if (k) matched.push({ g, k })
  }

  // Lead metric: primary_thread exact-match rate.
  const primaryAgree = matched.filter(({ g, k }) => g.output.primary_thread === k.llm_output.primary_thread).length
  const primaryThreadAgreement = matched.length === 0 ? 0 : primaryAgree / matched.length

  // Binary "thread fired" call: thread fired if opens_thread OR closes_thread.
  // TP: both gold and pred fired; FP: pred fired, gold did not; FN: gold fired, pred did not.
  let tp = 0, fp = 0, fn = 0
  for (const { g, k } of matched) {
    const goldFired = g.output.opens_thread || g.output.closes_thread
    const predFired = k.llm_output.opens_thread || k.llm_output.closes_thread
    if (predFired && goldFired) tp++
    else if (predFired && !goldFired) fp++
    else if (!predFired && goldFired) fn++
  }
  const precision = (tp + fp) === 0 ? 0 : tp / (tp + fp)
  const recall = (tp + fn) === 0 ? 0 : tp / (tp + fn)
  const f1 = (precision + recall) === 0 ? 0 : 2 * precision * recall / (precision + recall)

  // Per-field agreement rates.
  const perField: MiceMetrics["perField"] = {
    primary_thread: { agree: 0, n: matched.length, rate: 0 },
    secondary_thread: { agree: 0, n: matched.length, rate: 0 },
    opens_thread: { agree: 0, n: matched.length, rate: 0 },
    closes_thread: { agree: 0, n: matched.length, rate: 0 },
  }
  for (const { g, k } of matched) {
    if (g.output.primary_thread === k.llm_output.primary_thread) perField.primary_thread.agree++
    if (g.output.secondary_thread === k.llm_output.secondary_thread) perField.secondary_thread.agree++
    if (g.output.opens_thread === k.llm_output.opens_thread) perField.opens_thread.agree++
    if (g.output.closes_thread === k.llm_output.closes_thread) perField.closes_thread.agree++
  }
  for (const f of Object.keys(perField) as Array<keyof typeof perField>) {
    perField[f].rate = matched.length === 0 ? 0 : perField[f].agree / matched.length
  }

  // Adjudicator self-disagreement on primary_thread (same scene_id, multiple gold rows).
  const goldByScene = new Map<string, MiceGoldRow[]>()
  for (const g of gold) {
    const arr = goldByScene.get(g.scene_id) ?? []
    arr.push(g)
    goldByScene.set(g.scene_id, arr)
  }
  let retestN = 0, retestDisagree = 0
  for (const [, golds] of goldByScene) {
    if (golds.length < 2) continue
    for (let i = 0; i < golds.length; i++) {
      for (let j = i + 1; j < golds.length; j++) {
        retestN++
        if (golds[i]!.output?.primary_thread !== golds[j]!.output?.primary_thread) retestDisagree++
      }
    }
  }
  const retestSelfDisagreement = retestN === 0 ? null : { n: retestN, disagree: retestDisagree, rate: retestDisagree / retestN }

  return { n: matched.length, judgeFailures, precision, recall, f1, primaryThreadAgreement, perField, retestSelfDisagreement }
}

// ─────────────────────────────────────────────────────────────────────────────
// McKee Gap (per-beat gap calibration)
// ─────────────────────────────────────────────────────────────────────────────

interface McKeeGapKeyRow {
  sample_id: string
  scene_id: string
  beat_idx: number
  llm_output: {
    povExpectation: string
    actualOutcome: string
    gap_size: "none" | "small" | "medium" | "large"
    gap_type: "none" | "reversal" | "escalation" | "revelation" | "undermining" | "other"
    confidence: number
    evidence_quote: string
    abstain_reason: string | null
  }
  is_retest_of_prior_sample?: boolean
}

interface McKeeGapGoldRow {
  sample_id: string
  scene_id: string
  beat_idx: number
  output?: {
    povExpectation: string
    actualOutcome: string
    gap_size: "none" | "small" | "medium" | "large"
    gap_type: "none" | "reversal" | "escalation" | "revelation" | "undermining" | "other"
    confidence?: number
    abstain_reason?: string | null
  }
  error?: string
}

interface McKeeGapMetrics {
  n: number
  judgeFailures: number
  precision: number
  recall: number
  f1: number
  /** Lead metric — gap_size exact-match rate. */
  gapSizeAgreement: number
  perField: {
    gap_size: { agree: number; n: number; rate: number }
    gap_type: { agree: number; n: number; rate: number }
  }
  retestSelfDisagreement: { n: number; disagree: number; rate: number } | null
}

function computeMckeeGapMetrics(gold: McKeeGapGoldRow[], key: McKeeGapKeyRow[]): McKeeGapMetrics {
  const judgeFailures = gold.filter(g => !g.output).length
  const goldOk = gold.filter((g): g is McKeeGapGoldRow & { output: NonNullable<McKeeGapGoldRow["output"]> } => !!g.output)
  // Join via (scene_id, beat_idx) tuple.
  const keyByTuple = new Map(key.map(k => [`${k.scene_id}::${k.beat_idx}`, k]))
  const matched: Array<{ g: typeof goldOk[number]; k: McKeeGapKeyRow }> = []
  for (const g of goldOk) {
    const k = keyByTuple.get(`${g.scene_id}::${g.beat_idx}`)
    if (k) matched.push({ g, k })
  }

  // Lead metric: gap_size exact-match rate.
  const sizeAgree = matched.filter(({ g, k }) => g.output.gap_size === k.llm_output.gap_size).length
  const gapSizeAgreement = matched.length === 0 ? 0 : sizeAgree / matched.length

  // Binary "gap fired" call: gap fired if gap_size != "none".
  let tp = 0, fp = 0, fn = 0
  for (const { g, k } of matched) {
    const goldFired = g.output.gap_size !== "none"
    const predFired = k.llm_output.gap_size !== "none"
    if (predFired && goldFired) tp++
    else if (predFired && !goldFired) fp++
    else if (!predFired && goldFired) fn++
  }
  const precision = (tp + fp) === 0 ? 0 : tp / (tp + fp)
  const recall = (tp + fn) === 0 ? 0 : tp / (tp + fn)
  const f1 = (precision + recall) === 0 ? 0 : 2 * precision * recall / (precision + recall)

  // Per-field agreement.
  const perField: McKeeGapMetrics["perField"] = {
    gap_size: { agree: 0, n: matched.length, rate: 0 },
    gap_type: { agree: 0, n: matched.length, rate: 0 },
  }
  for (const { g, k } of matched) {
    if (g.output.gap_size === k.llm_output.gap_size) perField.gap_size.agree++
    if (g.output.gap_type === k.llm_output.gap_type) perField.gap_type.agree++
  }
  for (const f of Object.keys(perField) as Array<keyof typeof perField>) {
    perField[f].rate = matched.length === 0 ? 0 : perField[f].agree / matched.length
  }

  // Adjudicator self-disagreement on gap_size (same (scene_id, beat_idx) tuple, multiple gold rows).
  const goldByTuple = new Map<string, McKeeGapGoldRow[]>()
  for (const g of gold) {
    const key = `${g.scene_id}::${g.beat_idx}`
    const arr = goldByTuple.get(key) ?? []
    arr.push(g)
    goldByTuple.set(key, arr)
  }
  let retestN = 0, retestDisagree = 0
  for (const [, golds] of goldByTuple) {
    if (golds.length < 2) continue
    for (let i = 0; i < golds.length; i++) {
      for (let j = i + 1; j < golds.length; j++) {
        retestN++
        if (golds[i]!.output?.gap_size !== golds[j]!.output?.gap_size) retestDisagree++
      }
    }
  }
  const retestSelfDisagreement = retestN === 0 ? null : { n: retestN, disagree: retestDisagree, rate: retestDisagree / retestN }

  return { n: matched.length, judgeFailures, precision, recall, f1, gapSizeAgreement, perField, retestSelfDisagreement }
}

// ─────────────────────────────────────────────────────────────────────────────
// Character Arcs (per-book, LLM character-name matcher)
// ─────────────────────────────────────────────────────────────────────────────

interface CharacterArc {
  character_name: string
  lie: string
  truth: string
  want: string
  need: string
  arc_resolution: "fulfilled" | "partial" | "unresolved" | "tragic_inversion"
  evidence_quote_lie: string
  evidence_quote_truth: string | null
  confidence: number
}

interface CharacterArcsKeyRow {
  sample_id: string
  predicted_character_arcs: CharacterArc[]
}

interface CharacterArcsGoldRow {
  sample_id: string
  gold_character_arcs?: CharacterArc[]
  error?: string
}

interface CharacterArcMatch {
  pred_name: string
  gold_name: string
  confidence: number
  reason: string
}

interface CharacterArcsMetrics {
  charactersInPred: number
  charactersInGold: number
  charactersMatched: number
  precision: number
  recall: number
  f1: number
  /** Exact arc_resolution enum agreement over matched character pairs. */
  arcResolutionAgreementRate: number
  /** LTWN (Lie/Truth/Want/Need) field presence agreement rate.
   *
   * NOTE: This is a DEGENERATE baseline — a field is counted as "agreed" if
   * BOTH pred and gold have a non-empty value for it. True semantic agreement
   * (whether the lie/truth/want/need are the same) requires per-field LLM
   * judging and is deferred to a follow-on calibration pass. Track this
   * limitation explicitly when interpreting the metric. */
  ltwnPresenceAgreementRate: number
  matched: CharacterArcMatch[]
}

const CHARACTER_MATCH_SYSTEM = `You are an editorial analyst comparing two lists of \
character arcs extracted from the same novel by two different readers (an AI \
extractor and a stronger AI judge). A "character arc" is a record of one \
character's internal Lie/Truth/Want/Need journey across the book.

You will receive:
  • PREDICTED — arcs identified by the extractor, each with character_name plus arc fields.
  • GOLD — arcs identified by the judge, in the same shape.

Your job is to identify which (pred_name, gold_name) PAIRS refer to the SAME \
character, even when the names differ. Use these rules:

1. Same character = same fictional individual. "Drizzt" matches "Drizzt Do'Urden" \
matches "the dark elf hero" — all refer to the same person.

2. Different characters with similar roles do NOT match. If both lists have a \
"mentor figure" but they are different people in the story, do not match them.

3. A predicted arc matches AT MOST ONE gold arc (and vice versa). If two \
predictions could match the same gold character, pick the closer match and \
leave the other unmatched.

4. When in doubt, DO NOT match. False positives corrupt calibration more than \
false negatives.

For each match, emit:
  • pred_name and gold_name (exact strings from the input)
  • confidence in [0, 1] — how sure you are these refer to the same character
  • reason — one short sentence explaining why they are the same person.

Only return matches you are confident about. Unmatched names are tracked separately.`

const characterMatchSchema = z.object({
  matches: z.array(z.object({
    pred_name: z.string(),
    gold_name: z.string(),
    confidence: z.number().min(0).max(1),
    reason: z.string(),
  })),
})

async function llmMatchCharacters(pred: CharacterArc[], gold: CharacterArc[]): Promise<CharacterArcMatch[]> {
  const predRows = pred.map(p => ({ name: p.character_name, arc_resolution: p.arc_resolution }))
  const goldRows = gold.map(g => ({ name: g.character_name, arc_resolution: g.arc_resolution }))

  const userPrompt = `PREDICTED (${predRows.length} character arcs):
${JSON.stringify(predRows, null, 2)}

GOLD (${goldRows.length} character arcs):
${JSON.stringify(goldRows, null, 2)}

Identify matched (pred_name, gold_name) pairs per the system rules. Return only matches you are confident about. Emit a JSON object matching the schema { "matches": [ { pred_name, gold_name, confidence, reason } ] }.`

  console.log(`  [match] V4 Pro character-matching: ${predRows.length} predicted × ${goldRows.length} gold`)
  const result = await callAgent({
    agentName: "structure-character-match" as any,
    systemPrompt: CHARACTER_MATCH_SYSTEM,
    userPrompt,
    schema: characterMatchSchema,
  })
  const matches = result.output.matches
  console.log(`  [match] V4 Pro returned ${matches.length} character pair(s)`)

  // Enforce 1:1 — keep highest-confidence match per pred_name, then per gold_name.
  const byPred = new Map<string, typeof matches[number]>()
  const byGold = new Map<string, typeof matches[number]>()
  for (const m of matches) {
    const cur = byPred.get(m.pred_name)
    if (!cur || m.confidence > cur.confidence) byPred.set(m.pred_name, m)
  }
  for (const m of byPred.values()) {
    const cur = byGold.get(m.gold_name)
    if (!cur || m.confidence > cur.confidence) byGold.set(m.gold_name, m)
  }
  const finalMatches = [...byGold.values()]
  if (finalMatches.length !== matches.length) {
    console.log(`  [match] dedupe collapsed ${matches.length} → ${finalMatches.length}`)
  }

  // Validate that all returned names exist in the input lists.
  const predNames = new Set(pred.map(p => p.character_name))
  const goldNames = new Set(gold.map(g => g.character_name))
  const checked: CharacterArcMatch[] = []
  for (const m of finalMatches) {
    if (!predNames.has(m.pred_name)) {
      console.log(`  [match] skip unknown pred_name: ${m.pred_name}`)
      continue
    }
    if (!goldNames.has(m.gold_name)) {
      console.log(`  [match] skip unknown gold_name: ${m.gold_name}`)
      continue
    }
    checked.push({ pred_name: m.pred_name, gold_name: m.gold_name, confidence: m.confidence, reason: m.reason })
  }
  return checked
}

async function computeCharacterArcsMetrics(goldRow: CharacterArcsGoldRow, keyRow: CharacterArcsKeyRow): Promise<CharacterArcsMetrics> {
  const pred = keyRow.predicted_character_arcs
  const gold = goldRow.gold_character_arcs ?? []

  const matched = await llmMatchCharacters(pred, gold)

  const tp = matched.length
  const fp = pred.length - tp
  const fn = gold.length - tp
  const precision = (tp + fp) === 0 ? 0 : tp / (tp + fp)
  const recall = (tp + fn) === 0 ? 0 : tp / (tp + fn)
  const f1 = (precision + recall) === 0 ? 0 : 2 * precision * recall / (precision + recall)

  // Build lookup maps for matched pairs.
  const predByName = new Map(pred.map(p => [p.character_name, p]))
  const goldByName = new Map(gold.map(g => [g.character_name, g]))

  let arcResolutionAgree = 0
  // LTWN presence agreement: degenerate baseline — count a field as "agreed"
  // if both pred and gold have a non-empty value. True semantic comparison
  // (whether lie/truth/want/need descriptions are equivalent) requires
  // per-field LLM judging and is deferred to a follow-on calibration pass.
  let ltwnPresenceAgree = 0
  let ltwnTotal = 0
  const ltwnFields: Array<keyof CharacterArc & ("lie" | "truth" | "want" | "need")> = ["lie", "truth", "want", "need"]
  for (const m of matched) {
    const p = predByName.get(m.pred_name)
    const g = goldByName.get(m.gold_name)
    if (!p || !g) continue
    if (p.arc_resolution === g.arc_resolution) arcResolutionAgree++
    for (const f of ltwnFields) {
      ltwnTotal++
      if (p[f] && g[f]) ltwnPresenceAgree++
    }
  }
  const arcResolutionAgreementRate = matched.length === 0 ? 0 : arcResolutionAgree / matched.length
  const ltwnPresenceAgreementRate = ltwnTotal === 0 ? 0 : ltwnPresenceAgree / ltwnTotal

  return {
    charactersInPred: pred.length,
    charactersInGold: gold.length,
    charactersMatched: tp,
    precision, recall, f1,
    arcResolutionAgreementRate,
    ltwnPresenceAgreementRate,
    matched,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Verdict gates
// ─────────────────────────────────────────────────────────────────────────────

interface CellVerdict {
  verdict: "CELL PASS" | "CELL MARGINAL" | "CELL FAIL" | "NULL-GOLD"
  reason: string
}

function valueChargeVerdict(m: ValueChargeMetrics): CellVerdict {
  if (m.retestSelfDisagreement && m.retestSelfDisagreement.rate > 0.15) {
    return { verdict: "NULL-GOLD", reason: `adjudicator self-disagreement ${(m.retestSelfDisagreement.rate * 100).toFixed(1)}% > 15%` }
  }
  // Lead = precision (cost-function precision-first per R6 §1).
  if (m.precision >= 0.78 && m.recall >= 0.65 && m.f1 >= 0.71) {
    return { verdict: "CELL PASS", reason: `P=${m.precision.toFixed(3)} R=${m.recall.toFixed(3)} F1=${m.f1.toFixed(3)} ≥ thresholds` }
  }
  if (m.f1 < 0.60 || m.precision < 0.65) {
    return { verdict: "CELL FAIL", reason: `F1=${m.f1.toFixed(3)} P=${m.precision.toFixed(3)} below floor` }
  }
  if (m.precision >= 0.65 && m.precision < 0.78 && m.f1 >= 0.60) {
    return { verdict: "CELL MARGINAL", reason: `P=${m.precision.toFixed(3)} F1=${m.f1.toFixed(3)} in marginal band` }
  }
  return { verdict: "CELL FAIL", reason: `P=${m.precision.toFixed(3)} F1=${m.f1.toFixed(3)} fails all bands` }
}

function promiseVerdict(m: PromiseMetrics): CellVerdict {
  // Lead = recall (cost-function recall-first per R6 §1).
  if (m.recall >= 0.80 && m.precision >= 0.65 && m.f1 >= 0.71) {
    return { verdict: "CELL PASS", reason: `R=${m.recall.toFixed(3)} P=${m.precision.toFixed(3)} F1=${m.f1.toFixed(3)} ≥ thresholds` }
  }
  if (m.f1 < 0.60 || m.recall < 0.70) {
    return { verdict: "CELL FAIL", reason: `F1=${m.f1.toFixed(3)} R=${m.recall.toFixed(3)} below floor` }
  }
  if (m.recall >= 0.70 && m.recall < 0.80 && m.f1 >= 0.60) {
    return { verdict: "CELL MARGINAL", reason: `R=${m.recall.toFixed(3)} F1=${m.f1.toFixed(3)} in marginal band` }
  }
  return { verdict: "CELL FAIL", reason: `R=${m.recall.toFixed(3)} F1=${m.f1.toFixed(3)} fails all bands` }
}

function miceVerdict(m: MiceMetrics): CellVerdict {
  // NULL-GOLD gate: adjudicator self-disagreement > 15% AND retest pool ≥ 20.
  // The n-floor prevents a tiny retest pool (e.g. 3 retests) from invalidating
  // an otherwise usable gold set.
  if (m.retestSelfDisagreement && m.retestSelfDisagreement.rate > 0.15 && m.retestSelfDisagreement.n >= 20) {
    return { verdict: "NULL-GOLD", reason: `adjudicator self-disagreement ${(m.retestSelfDisagreement.rate * 100).toFixed(1)}% > 15% (n=${m.retestSelfDisagreement.n})` }
  }
  // Precision-first gates (same shape as value-charge).
  if (m.precision >= 0.78 && m.recall >= 0.65 && m.f1 >= 0.71) {
    return { verdict: "CELL PASS", reason: `P=${m.precision.toFixed(3)} R=${m.recall.toFixed(3)} F1=${m.f1.toFixed(3)} ≥ thresholds` }
  }
  if (m.f1 < 0.60 || m.precision < 0.65) {
    return { verdict: "CELL FAIL", reason: `F1=${m.f1.toFixed(3)} P=${m.precision.toFixed(3)} below floor` }
  }
  if (m.precision >= 0.65 && m.precision < 0.78 && m.f1 >= 0.60) {
    return { verdict: "CELL MARGINAL", reason: `P=${m.precision.toFixed(3)} F1=${m.f1.toFixed(3)} in marginal band` }
  }
  return { verdict: "CELL FAIL", reason: `P=${m.precision.toFixed(3)} F1=${m.f1.toFixed(3)} fails all bands` }
}

function mckeeGapVerdict(m: McKeeGapMetrics): CellVerdict {
  // NULL-GOLD gate: same shape as MICE (n-floor of 20).
  if (m.retestSelfDisagreement && m.retestSelfDisagreement.rate > 0.15 && m.retestSelfDisagreement.n >= 20) {
    return { verdict: "NULL-GOLD", reason: `adjudicator self-disagreement ${(m.retestSelfDisagreement.rate * 100).toFixed(1)}% > 15% (n=${m.retestSelfDisagreement.n})` }
  }
  // Precision-first gates (same shape as value-charge).
  if (m.precision >= 0.78 && m.recall >= 0.65 && m.f1 >= 0.71) {
    return { verdict: "CELL PASS", reason: `P=${m.precision.toFixed(3)} R=${m.recall.toFixed(3)} F1=${m.f1.toFixed(3)} ≥ thresholds` }
  }
  if (m.f1 < 0.60 || m.precision < 0.65) {
    return { verdict: "CELL FAIL", reason: `F1=${m.f1.toFixed(3)} P=${m.precision.toFixed(3)} below floor` }
  }
  if (m.precision >= 0.65 && m.precision < 0.78 && m.f1 >= 0.60) {
    return { verdict: "CELL MARGINAL", reason: `P=${m.precision.toFixed(3)} F1=${m.f1.toFixed(3)} in marginal band` }
  }
  return { verdict: "CELL FAIL", reason: `P=${m.precision.toFixed(3)} F1=${m.f1.toFixed(3)} fails all bands` }
}

function characterArcsVerdict(m: CharacterArcsMetrics): CellVerdict {
  // No NULL-GOLD path — single emission per book, no retest pool.
  if (m.f1 >= 0.80 && m.arcResolutionAgreementRate >= 0.65) {
    return { verdict: "CELL PASS", reason: `F1=${m.f1.toFixed(3)} arcResolution=${m.arcResolutionAgreementRate.toFixed(3)} ≥ thresholds` }
  }
  if (m.f1 >= 0.60 && m.arcResolutionAgreementRate >= 0.50) {
    return { verdict: "CELL MARGINAL", reason: `F1=${m.f1.toFixed(3)} arcResolution=${m.arcResolutionAgreementRate.toFixed(3)} in marginal band` }
  }
  return { verdict: "CELL FAIL", reason: `F1=${m.f1.toFixed(3)} arcResolution=${m.arcResolutionAgreementRate.toFixed(3)} below floor` }
}

function aggregateVerdict(cells: CellVerdict[]): "SCOPED PASS" | "PARTIAL" | "FAIL" | "NULL-GOLD-ONLY" {
  const nonNull = cells.filter(c => c.verdict !== "NULL-GOLD")
  if (nonNull.length === 0) return "NULL-GOLD-ONLY"
  if (nonNull.some(c => c.verdict === "CELL PASS")) return "SCOPED PASS"
  if (nonNull.some(c => c.verdict === "CELL MARGINAL")) return "PARTIAL"
  return "FAIL"
}

async function main() {
  const args = parseArgs()
  const suffixDesc = [
    args.keySuffix ? `key-suffix=${args.keySuffix}` : null,
    args.goldSuffix ? `gold-suffix=${args.goldSuffix}` : null,
    args.keyFile ? `key-file=<custom>` : null,
  ].filter(Boolean).join(" ")
  console.log(`[calibration] novel=${args.novel} book=${args.book} dim=${args.dim}${suffixDesc ? " " + suffixDesc : ""}`)
  const goldDir = join(REPO_ROOT, "novels", args.novel, "structure-gold", args.book)

  const out: Record<string, any> = {
    novel: args.novel,
    book: args.book,
    keySuffix: args.keySuffix,
    goldSuffix: args.goldSuffix,
    computedAt: new Date().toISOString(),
    cells: {},
  }

  let cellVerdicts: { dim: string; verdict: CellVerdict }[] = []

  if (args.dim === "value-charge" || args.dim === "all") {
    const goldPath = suffixedPath(goldDir, "value-charge-gold", args.goldSuffix)
    const keyPath = args.keyFile ?? suffixedPath(goldDir, "value-charge-key", args.keySuffix)
    if (existsSync(goldPath) && existsSync(keyPath)) {
      const gold = await readJsonl<ValueChargeGold>(goldPath)
      const key = await readJsonl<ValueChargeKey>(keyPath)
      const metrics = computeValueChargeMetrics(gold, key)
      const verdict = valueChargeVerdict(metrics)
      out.cells["value-charge"] = { metrics, verdict }
      cellVerdicts.push({ dim: "value-charge", verdict })
      console.log(`[calibration] value-charge: ${verdict.verdict} — ${verdict.reason}`)
    } else {
      console.log(`[calibration] value-charge: gold=${goldPath} key=${keyPath}; one or both missing, skipping`)
    }
  }

  if (args.dim === "promise" || args.dim === "all") {
    const goldPath = suffixedPath(goldDir, "promise-gold", args.goldSuffix)
    // For promise, the key file is promises.json (not in structure-gold/) unless
    // --key-file is specified. The key file is NOT a .jsonl but a full JSON object;
    // we read it specially and reshape to PromiseKeyRow[].
    const keyPath = args.keyFile ?? suffixedPath(goldDir, "promise-key", args.keySuffix)
    if (existsSync(goldPath) && existsSync(keyPath)) {
      const gold = await readJsonl<PromiseGoldRow>(goldPath)
      // Promise key file shape varies by source:
      //   - structure-gold/<book>/promise-key.jsonl  → JSONL (standard sampler output)
      //   - structure/<book>/promises.json           → wrapped { novel, book, promises:[] }
      //   - structure/<book>/promises.pro.json       → wrapped (Pro extractor output)
      // Distinguish by extension rather than content sniffing — the .json
      // suffix means a single wrapped object, .jsonl means line-delimited.
      let key: PromiseKeyRow[]
      if (keyPath.endsWith(".json")) {
        const parsed = JSON.parse(await Bun.file(keyPath).text()) as
          | { promises?: PromiseKeyRow[] }
          | PromiseKeyRow[]
        key = Array.isArray(parsed) ? parsed : (parsed.promises ?? [])
      } else {
        // .jsonl (or no extension) — line-delimited
        key = await readJsonl<PromiseKeyRow>(keyPath)
      }
      const metrics = await computePromiseMetrics(gold, key, args.matcher)
      const verdict = promiseVerdict(metrics)
      out.cells["promise"] = { metrics, verdict }
      cellVerdicts.push({ dim: "promise", verdict })
      console.log(`[calibration] promise (matcher=${args.matcher}): ${verdict.verdict} — ${verdict.reason}`)
    } else {
      console.log(`[calibration] promise: gold=${goldPath} key=${keyPath}; one or both missing, skipping`)
    }
  }

  if (args.dim === "mice" || args.dim === "all") {
    const goldPath = suffixedPath(goldDir, "mice-gold", args.goldSuffix)
    const keyPath = args.keyFile ?? suffixedPath(goldDir, "mice-key", args.keySuffix)
    if (existsSync(goldPath) && existsSync(keyPath)) {
      const gold = await readJsonl<MiceGoldRow>(goldPath)
      const key = await readJsonl<MiceKeyRow>(keyPath)
      const metrics = computeMiceMetrics(gold, key)
      const verdict = miceVerdict(metrics)
      out.cells["mice"] = { metrics, verdict }
      cellVerdicts.push({ dim: "mice", verdict })
      console.log(`[calibration] mice: ${verdict.verdict} — ${verdict.reason}`)
    } else {
      console.log(`[calibration] mice: gold=${goldPath} key=${keyPath}; one or both missing, skipping`)
    }
  }

  if (args.dim === "mckee-gap" || args.dim === "all") {
    const goldPath = suffixedPath(goldDir, "mckee-gap-gold", args.goldSuffix)
    const keyPath = args.keyFile ?? suffixedPath(goldDir, "mckee-gap-key", args.keySuffix)
    if (existsSync(goldPath) && existsSync(keyPath)) {
      const gold = await readJsonl<McKeeGapGoldRow>(goldPath)
      const key = await readJsonl<McKeeGapKeyRow>(keyPath)
      const metrics = computeMckeeGapMetrics(gold, key)
      const verdict = mckeeGapVerdict(metrics)
      out.cells["mckee-gap"] = { metrics, verdict }
      cellVerdicts.push({ dim: "mckee-gap", verdict })
      console.log(`[calibration] mckee-gap: ${verdict.verdict} — ${verdict.reason}`)
    } else {
      console.log(`[calibration] mckee-gap: gold=${goldPath} key=${keyPath}; one or both missing, skipping`)
    }
  }

  if (args.dim === "character-arcs" || args.dim === "all") {
    const goldPath = suffixedPath(goldDir, "character-arcs-gold", args.goldSuffix)
    const keyPath = args.keyFile ?? suffixedPath(goldDir, "character-arcs-key", args.keySuffix)
    if (existsSync(goldPath) && existsSync(keyPath)) {
      const goldRows = await readJsonl<CharacterArcsGoldRow>(goldPath)
      const keyRows = await readJsonl<CharacterArcsKeyRow>(keyPath)
      // character-arcs emits ONE row per book — take the first valid pair.
      const goldRow = goldRows.find(g => !g.error && g.gold_character_arcs)
      const keyRow = keyRows[0]
      if (goldRow && keyRow) {
        const metrics = await computeCharacterArcsMetrics(goldRow, keyRow)
        const verdict = characterArcsVerdict(metrics)
        out.cells["character-arcs"] = { metrics, verdict }
        cellVerdicts.push({ dim: "character-arcs", verdict })
        console.log(`[calibration] character-arcs: ${verdict.verdict} — ${verdict.reason}`)
      } else {
        console.log(`[calibration] character-arcs: gold file present but no valid row (error or missing gold_character_arcs); skipping`)
      }
    } else {
      console.log(`[calibration] character-arcs: gold=${goldPath} key=${keyPath}; one or both missing, skipping`)
    }
  }

  if (cellVerdicts.length === 0) {
    console.log(`[calibration] no gold present yet — adjudicate first via sample-for-adjudication.ts then re-run.`)
    process.exit(0)
  }

  const aggregated = aggregateVerdict(cellVerdicts.map(c => c.verdict))
  out.aggregatedVerdict = aggregated
  out.cellVerdicts = cellVerdicts
  console.log(`[calibration] AGGREGATED VERDICT: ${aggregated}`)

  const outDir = join(REPO_ROOT, "novels", args.novel, "structure-calibration")
  mkdirSync(outDir, { recursive: true })
  const outFilename = calibrationOutputName(args.book, args.keySuffix, args.goldSuffix)
  const outPath = join(outDir, outFilename)
  await Bun.write(outPath, JSON.stringify(out, null, 2))
  console.log(`[calibration] wrote → ${outPath}`)
}

main().catch(err => {
  console.error(`[calibration] fatal:`, err)
  process.exit(1)
})
