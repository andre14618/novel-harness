#!/usr/bin/env bun
/**
 * Halluc-ungrounded deterministic-NER vs LLM calibration probe.
 *
 * For each row in a labeled hallucination panel JSONL (same shape as the
 * one consumed by `ab-halluc-prompt.ts` and `convergence-eval.ts`):
 *
 *   1. Run `extractEntityCandidates(prose)` from `src/lint/entity-candidates.ts`
 *      (the L4 deterministic extractor — TELEMETRY-ONLY, see commit `0eeabf9`).
 *   2. Decide which candidates are grounded by case-insensitive substring
 *      match against the union of the row's `groundedSources.{bible,
 *      from_brief, derived_outline_fact, derived_prior_beat,
 *      allowed_new_entities}` plus `writer_request_meta.beatCharacters`.
 *   3. Declare NER FIRES iff at least one candidate is NOT grounded
 *      (i.e. survives the grounded-substring filter).
 *   4. Decide whether the LLM checker fired. Two sources, in order:
 *        a. If `--convergence <eval.jsonl>` is given, look up the row's
 *           `vote_count_fail` and use the threshold k=1 (any-vote fail) by
 *           default, configurable with `--llm-k`. This matches L1's
 *           "majority-vote LLM verdict" lens.
 *        b. Else fall back to `row.actual.output.pass` from the panel
 *           JSONL itself (the production single-call recorded verdict).
 *   5. Read the oracle pass from `gold` per the same logic as
 *      `getOracleLabel` in `convergence-eval.ts` and `ab-halluc-prompt.ts`.
 *   6. Emit one JSONL row per panel row capturing `{fixture_id,
 *      oracle_pass, ner_fires, ner_candidates_total,
 *      ner_candidates_ungrounded, llm_fires, agreement_class}`. Print two
 *      headline 2x2 tables: (oracle x NER) and (oracle x LLM), plus the
 *      key cross-tab "rows where NER fires but LLM passes" and vice versa.
 *
 * Pure deterministic. No LLM calls. Cost: zero per-row.
 *
 * Usage:
 *   bun scripts/hallucination/ner-vs-llm-calibration.ts \
 *     --in /tmp/halluc-current-panel-exp299-labeled.jsonl \
 *     [--convergence /tmp/halluc-convergence-N5-T01-<TS>.jsonl] \
 *     --out /tmp/halluc-ner-calibration-small-<TS>.jsonl \
 *     [--llm-k 1] \
 *     [--persist --exp-id N --variant-label LABEL --note STR]
 *
 * Conventions:
 *   - Output filename MUST be timestamped per `feedback_no_overwrite_runs`.
 *   - Rows where the panel does not provide a labelable oracle (e.g. big
 *     panel's 17 unlabeled natural rows) are still emitted into the JSONL
 *     with `oracle_pass=null` and counted under `NO-ORACLE` in matrices.
 *   - Synthetic pass-control rows whose prose is identical to a different
 *     row's prose are still scored — the calibration question is per-row.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import {
  extractEntityCandidates,
  normalizeForGroundedMatch,
  deriveInitials,
  type EntityCandidate,
} from "../../src/lint/entity-candidates"

interface Args {
  inPath: string
  outPath: string
  convergencePath?: string
  llmK: number
  persist: boolean
  expId?: number
  variantLabel: string
  note?: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let inPath = "", outPath = ""
  let convergencePath: string | undefined
  let llmK = 1
  let persist = false
  let expId: number | undefined
  let variantLabel = "ner-calibration"
  let note: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") inPath = argv[++i]!
    else if (argv[i] === "--out") outPath = argv[++i]!
    else if (argv[i] === "--convergence") convergencePath = argv[++i]
    else if (argv[i] === "--llm-k") llmK = Number(argv[++i])
    else if (argv[i] === "--persist") persist = true
    else if (argv[i] === "--exp-id") expId = Number(argv[++i])
    else if (argv[i] === "--variant-label") variantLabel = argv[++i]!
    else if (argv[i] === "--note") note = argv[++i]
  }
  if (!inPath || !outPath) {
    console.error(
      "usage: --in <panel.jsonl> --out <results-<TS>.jsonl> [--convergence <conv.jsonl>] [--llm-k 1] [--persist [--exp-id N] [--variant-label LABEL] [--note STR]]"
    )
    process.exit(1)
  }
  return { inPath, outPath, convergencePath, llmK, persist, expId, variantLabel, note }
}

interface OracleLabel {
  pass: boolean | null
  source: "oracle" | "synthetic_expected" | "unlabeled"
  expected_entities: string[]
}

/** Mirrors the oracle-derivation logic used by `convergence-eval.ts` and
 *  `ab-halluc-prompt.ts`. Kept inline so this script is self-contained. */
function getOracleLabel(row: any): OracleLabel {
  if (row.case_role === "synthetic_fixture") {
    const expected_pass = row.gold?.expected_pass
    if (expected_pass === true || expected_pass === false) {
      return {
        pass: expected_pass,
        source: "synthetic_expected",
        expected_entities: (row.gold?.issues ?? [])
          .map((i: any) => i.entity ?? i.expected_event ?? "")
          .filter(Boolean),
      }
    }
    return { pass: null, source: "unlabeled", expected_entities: [] }
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
    return {
      pass: trueHallucs.length === 0,
      source: "oracle",
      expected_entities: trueHallucs,
    }
  }
  return { pass: null, source: "unlabeled", expected_entities: [] }
}

/** Build the union of grounded entity surface for a row, lowercase-normalized.
 *
 *  Sources (in priority — all unioned, not ordered):
 *    - groundedSources.bible
 *    - groundedSources.from_brief
 *    - groundedSources.derived_outline_fact
 *    - groundedSources.derived_prior_beat
 *    - groundedSources.planner_emitted (rarely populated in current panels)
 *    - groundedSources.allowed_new_entities (post-L2; absent in older panels)
 *    - writer_request_meta.beatCharacters (e.g. "Maret", "Journeyman Theo")
 *
 *  Per-source string is lowercased. Multi-line entries (e.g. "Thornwall\nThe")
 *  are split on whitespace and each token kept too, so substring-match works
 *  on the cleaner pieces. The original full string is kept too, so multi-word
 *  entities stay matchable as a whole.
 *
 *  Returns the surface as two parallel Sets: `lower` is the legacy
 *  lowercase-only set (preserved for back-compat with existing callers /
 *  exact-match path), and `normalized` is the `normalizeForGroundedMatch`
 *  set used to collapse plural/singular/possessive/article variants. Both
 *  whole-entry forms and per-token shards are added to each.
 *
 *  L4-followup-2 added the normalized set to close the `Scribe's Guildhall`
 *  vs `The Scribes' Guildhall` FP class observed in exp #319.
 */
interface GroundedSurface {
  lower: Set<string>
  normalized: Set<string>
}

function buildGroundedSurface(row: any): GroundedSurface {
  const lower = new Set<string>()
  const normalized = new Set<string>()
  const gs = row.task?.checker_request_meta?.groundedSources ?? {}
  const meta = row.task?.writer_request_meta ?? {}
  const sourceArrays: string[][] = [
    gs.bible ?? [],
    gs.from_brief ?? [],
    gs.derived_outline_fact ?? [],
    gs.derived_prior_beat ?? [],
    gs.planner_emitted ?? [],
    gs.allowed_new_entities ?? [],
    gs.character_roster ?? [],
    gs.outline_entities ?? [],
    meta.beatCharacters ?? [],
  ]
  function addAll(s: string) {
    if (s.length > 0) {
      lower.add(s.toLowerCase())
      const norm = normalizeForGroundedMatch(s)
      if (norm.length > 0) normalized.add(norm)
    }
  }
  for (const arr of sourceArrays) {
    for (const raw of arr) {
      if (typeof raw !== "string") continue
      const trimmed = raw.trim()
      if (trimmed.length === 0) continue
      addAll(trimmed)
      // Split on whitespace + apostrophe-s to handle entries like
      // "Thornwall\nThe" or "Cassel\nCassel’s" — each whitespace-separated
      // token also becomes a grounded surface, so a candidate substring
      // match can hit the clean piece without fighting the embedded newline.
      const tokens = trimmed.split(/\s+/).filter(t => t.length > 0)
      for (const t of tokens) {
        const cleaned = t.replace(/[‘’](s|S)?$/, "").toLowerCase()
        if (cleaned.length > 0) {
          lower.add(cleaned)
          const norm = normalizeForGroundedMatch(t)
          if (norm.length > 0) normalized.add(norm)
        }
      }
    }
  }
  // L23a: add derived initials from character roster + beatCharacters.
  const rosterEntries = [
    ...(gs.character_roster ?? []),
    ...(meta.beatCharacters ?? []),
  ]
  for (const name of rosterEntries) {
    if (typeof name !== "string") continue
    for (const init of deriveInitials(name.trim())) {
      lower.add(init.toLowerCase())
    }
  }
  return { lower, normalized }
}

/**
 * Build a set of lowercase first-word tokens from bible names only.
 * Used to gate the `capitalized-first-only` class in the calibration loop —
 * same logic as `buildNerGroundedSet` + `bibleTokens` in index.ts (L23a).
 * Only the first word of each bible name is added (e.g. "Aether" from
 * "Aether System") — not all tokens — to avoid FPs from shared words.
 */
function buildBibleFirstWordTokens(row: any): Set<string> {
  const bibleNames: string[] = row.task?.checker_request_meta?.groundedSources?.bible ?? []
  const tokens = new Set<string>()
  for (const name of bibleNames) {
    if (typeof name !== "string") continue
    const first = name.trim().split(/\s+/)[0] ?? ""
    if (first.length > 0) tokens.add(first.toLowerCase())
  }
  return tokens
}

/** Common function words that follow a proper noun in normal prose but are
 *  NOT domain-term second words. Mirrors CAP_FIRST_ONLY_STOP_WORDS in index.ts. */
const CAP_FIRST_ONLY_STOP_WORDS = new Set([
  "before", "after", "since", "while", "above", "below", "under", "until",
  "where", "which", "whose", "when", "what", "whom", "that", "this", "then",
  "than", "thus", "also", "even", "only", "back", "down", "away", "into",
  "onto", "upon", "over", "from", "with", "through", "along", "among",
  "between", "during", "against", "toward", "within", "without", "across",
  "behind", "beside", "beyond", "inside", "outside", "around", "about",
  "near", "next", "like", "just", "both", "each", "many", "some", "more",
  "most", "much", "very", "been", "were", "have", "will", "would", "could",
  "should", "might", "must", "shall", "said", "told", "knew", "made", "gave",
  "took", "came", "went", "kept", "left", "sent", "held", "knew", "came",
])

/** Decide whether a NER candidate is grounded.
 *
 *  Match logic (case-insensitive throughout):
 *    1. Exact match: candidate.lowercase() ∈ surface.lower ⇒ grounded.
 *    2. Substring fall-back: any lowercase grounded surface entry contains
 *       the candidate as a substring ⇒ grounded.
 *    3. Normalized exact match: normalizeForGroundedMatch(candidate) ∈
 *       surface.normalized ⇒ grounded. This collapses article + possessive
 *       + plural variants so `Scribe's Guildhall` (prose) matches
 *       `The Scribes' Guildhall` (bible). Added in L4-followup-2.
 *    4. Normalized substring fall-back: any normalized surface entry
 *       contains the normalized candidate ⇒ grounded.
 *    5. Per-token fall-back: every token in the candidate appears as a
 *       standalone grounded entry ⇒ grounded. This catches "Arbiter
 *       Cassel" being grounded because both "Arbiter" and "Cassel" appear
 *       in derived_outline_fact.
 *
 *  We deliberately use #1–#4 first then fall back to #5. Direction #5 can
 *  over-ground (claim "Master Orin" is grounded if both "Master" and
 *  "Orin" leak into the surface separately); the L4 telemetry purpose is
 *  to find candidates that DON'T have either an exact or whole-phrase
 *  grounded match, so the per-token check is only used when the stricter
 *  checks already failed.
 *
 *  Returns true if grounded (i.e. NER should NOT fire), false if NER should
 *  fire on this candidate.
 */
function isGrounded(candidatePhrase: string, surface: GroundedSurface): boolean {
  const c = candidatePhrase.toLowerCase().trim()
  if (c.length === 0) return true
  // 1. exact lowercase
  if (surface.lower.has(c)) return true
  // 2. lowercase substring (surface entry contains the candidate)
  for (const s of surface.lower) {
    if (s.length >= c.length && s.includes(c)) return true
  }
  // 3. normalized exact (closes plural/singular/article/possessive variants)
  const normCandidate = normalizeForGroundedMatch(candidatePhrase)
  if (normCandidate.length > 0 && surface.normalized.has(normCandidate)) return true
  // 4. normalized substring
  if (normCandidate.length > 0) {
    for (const s of surface.normalized) {
      if (s.length >= normCandidate.length && s.includes(normCandidate)) return true
    }
  }
  // 5. per-token: every token in candidate is itself in the surface.
  const tokens = c.split(/\s+/).filter(t => t.length > 0)
  if (tokens.length === 0) return false
  const allIn = tokens.every(t => {
    const cleaned = t.replace(/[’'](s|S)?$/, "")
    return surface.lower.has(cleaned)
  })
  return allIn
}

interface CandidateClassification {
  candidate: EntityCandidate
  grounded: boolean
}

interface ConvergenceMap {
  [fixture_id: string]: { vote_count_fail: number; n_calls: number }
}

function loadConvergenceMap(path: string): ConvergenceMap {
  const lines = readFileSync(path, "utf8").trim().split("\n")
  const out: ConvergenceMap = {}
  for (const line of lines) {
    if (!line.trim()) continue
    const r = JSON.parse(line)
    out[r.fixture_id] = {
      vote_count_fail: r.vote_count_fail ?? 0,
      n_calls: r.n_calls ?? 1,
    }
  }
  return out
}

interface RowOut {
  fixture_id: string
  case_role: string
  oracle_pass: boolean | null
  oracle_source: string
  oracle_expected_entities: string[]
  ner_candidates_total: number
  ner_candidates_ungrounded: number
  ner_fires: boolean
  ner_ungrounded_phrases: string[]
  llm_pass: boolean | null
  llm_fires: boolean | null
  llm_source: "convergence-vote" | "panel.actual" | "missing"
  llm_vote_count_fail?: number
  llm_n_calls?: number
  agreement_class: string
}

function classifyAgreement(
  oracle_pass: boolean | null,
  ner_fires: boolean,
  llm_fires: boolean | null,
): string {
  // Cross-tab cell. NER and LLM each have a binary fire signal; oracle
  // has pass/fail/null. Format: "<oracle>-<ner>-<llm>" where N=null.
  const o = oracle_pass === null ? "N" : oracle_pass ? "P" : "F"
  const n = ner_fires ? "F" : "P"
  const l = llm_fires === null ? "N" : llm_fires ? "F" : "P"
  return `O${o}-NER${n}-LLM${l}`
}

async function main() {
  const args = parseArgs()
  const lines = readFileSync(resolve(args.inPath), "utf8").trim().split("\n")
  const allRows = lines.map(l => JSON.parse(l))
  const rows = allRows.filter(r => r.checker === "halluc-ungrounded")

  let convergence: ConvergenceMap | null = null
  if (args.convergencePath) {
    if (!existsSync(args.convergencePath)) {
      console.error(`convergence file not found: ${args.convergencePath}`)
      process.exit(1)
    }
    convergence = loadConvergenceMap(args.convergencePath)
    console.log(
      `Loaded convergence map from ${args.convergencePath} (${Object.keys(convergence).length} rows). Using llm-k=${args.llmK} threshold (LLM fires iff vote_count_fail >= ${args.llmK}).`
    )
  } else {
    console.log("No --convergence given; falling back to panel.actual.output.pass for LLM signal.")
  }

  console.log(
    `ner-vs-llm-calibration: panel=${args.inPath} rows=${rows.length}`
  )

  const out: RowOut[] = []
  for (const row of rows) {
    const prose: string = row.task?.prose ?? ""
    const candidates = extractEntityCandidates(prose)
    const surface = buildGroundedSurface(row)
    // L23a: build bible-first-word token set for cap-first-only gate.
    const bibleFirstWords = buildBibleFirstWordTokens(row)
    const classifications: CandidateClassification[] = candidates.map(c => {
      if (isGrounded(c.phrase, surface)) return { candidate: c, grounded: true }
      // L23a cap-first-only gate (mirrors runNerPrepass logic in index.ts).
      if (c.class === "capitalized-first-only") {
        if (bibleFirstWords.size === 0) return { candidate: c, grounded: true }
        const words = c.phrase.split(/\s+/)
        const firstWord = (words[0] ?? "").toLowerCase()
        const secondWord = (words[1] ?? "").toLowerCase()
        // Gate 1: first word must be a bible-entry first-word token.
        if (!bibleFirstWords.has(firstWord)) return { candidate: c, grounded: true }
        // Gate 2: second word must not be a common function word.
        if (CAP_FIRST_ONLY_STOP_WORDS.has(secondWord)) return { candidate: c, grounded: true }
      }
      return { candidate: c, grounded: false }
    })
    const ungrounded = classifications.filter(c => !c.grounded)
    const ner_fires = ungrounded.length > 0

    let llm_pass: boolean | null = null
    let llm_source: RowOut["llm_source"] = "missing"
    let vote_count_fail: number | undefined
    let n_calls: number | undefined
    if (convergence && convergence[row.fixture_id]) {
      const v = convergence[row.fixture_id]
      vote_count_fail = v.vote_count_fail
      n_calls = v.n_calls
      llm_pass = v.vote_count_fail < args.llmK ? true : false
      llm_source = "convergence-vote"
    } else if (row.actual?.output?.pass !== undefined) {
      llm_pass = row.actual.output.pass
      llm_source = "panel.actual"
    }
    const llm_fires = llm_pass === null ? null : !llm_pass

    const oracle = getOracleLabel(row)
    const rowOut: RowOut = {
      fixture_id: row.fixture_id,
      case_role: row.case_role,
      oracle_pass: oracle.pass,
      oracle_source: oracle.source,
      oracle_expected_entities: oracle.expected_entities,
      ner_candidates_total: candidates.length,
      ner_candidates_ungrounded: ungrounded.length,
      ner_fires,
      ner_ungrounded_phrases: ungrounded.map(u => u.candidate.phrase),
      llm_pass,
      llm_fires,
      llm_source,
      ...(vote_count_fail !== undefined ? { llm_vote_count_fail: vote_count_fail } : {}),
      ...(n_calls !== undefined ? { llm_n_calls: n_calls } : {}),
      agreement_class: classifyAgreement(oracle.pass, ner_fires, llm_fires),
    }
    out.push(rowOut)
  }

  writeFileSync(
    resolve(args.outPath),
    out.map(r => JSON.stringify(r)).join("\n") + "\n"
  )
  console.log(`Wrote ${out.length} rows to ${args.outPath}`)

  // ── 2x2 matrices ──────────────────────────────────────────────────────
  // Per-row classification helpers
  const oracleLabeled = out.filter(r => r.oracle_pass !== null)
  const llmAvailable = out.filter(r => r.llm_fires !== null)

  // Matrix 1: oracle x NER (over labeled rows)
  type Matrix2 = { TP: number; FP: number; FN: number; TN: number }
  function build2x2(rows: RowOut[], fires: (r: RowOut) => boolean | null): Matrix2 {
    const m: Matrix2 = { TP: 0, FP: 0, FN: 0, TN: 0 }
    for (const r of rows) {
      const f = fires(r)
      if (f === null) continue
      if (r.oracle_pass === null) continue
      const oracleFail = r.oracle_pass === false
      if (oracleFail && f) m.TP++
      else if (oracleFail && !f) m.FN++
      else if (!oracleFail && f) m.FP++
      else m.TN++
    }
    return m
  }
  function f1Of(m: Matrix2): { recall: number | null; precision: number | null; f1: number | null } {
    const recall = m.TP + m.FN > 0 ? m.TP / (m.TP + m.FN) : null
    const precision = m.TP + m.FP > 0 ? m.TP / (m.TP + m.FP) : null
    const f1 = recall !== null && precision !== null && (recall + precision) > 0
      ? 2 * recall * precision / (recall + precision)
      : null
    return { recall, precision, f1 }
  }
  function fmtMatrix(m: Matrix2): string {
    const { recall, precision, f1 } = f1Of(m)
    return `TP=${m.TP} FP=${m.FP} FN=${m.FN} TN=${m.TN} | recall=${recall === null ? "n/a" : recall.toFixed(3)} precision=${precision === null ? "n/a" : precision.toFixed(3)} F1=${f1 === null ? "n/a" : f1.toFixed(3)}`
  }

  const nerMatrix = build2x2(oracleLabeled, r => r.ner_fires)
  const llmMatrix = build2x2(oracleLabeled, r => r.llm_fires)

  console.log(`\n=== 2x2: oracle x signal (over n=${oracleLabeled.length} labeled rows) ===`)
  console.log(`  NER  : ${fmtMatrix(nerMatrix)}`)
  console.log(`  LLM  : ${fmtMatrix(llmMatrix)}`)

  // Matrix 2: NER x LLM cross-tab on labeled rows
  type Cross = { both: number; ner_only: number; llm_only: number; neither: number }
  function buildCross(rows: RowOut[]): Cross {
    const c: Cross = { both: 0, ner_only: 0, llm_only: 0, neither: 0 }
    for (const r of rows) {
      if (r.llm_fires === null) continue
      if (r.ner_fires && r.llm_fires) c.both++
      else if (r.ner_fires && !r.llm_fires) c.ner_only++
      else if (!r.ner_fires && r.llm_fires) c.llm_only++
      else c.neither++
    }
    return c
  }
  // Labeled-only — narrows to where oracle exists
  const crossLabeled = buildCross(oracleLabeled.filter(r => r.llm_fires !== null))
  // Labeled FAIL only — the FN-floor question
  const crossLabeledFail = buildCross(
    oracleLabeled.filter(r => r.llm_fires !== null && r.oracle_pass === false)
  )
  // Labeled PASS only — the FP-cost question
  const crossLabeledPass = buildCross(
    oracleLabeled.filter(r => r.llm_fires !== null && r.oracle_pass === true)
  )

  console.log(`\n=== NER x LLM cross-tab (over n=${oracleLabeled.filter(r => r.llm_fires !== null).length} labeled rows w/ LLM signal) ===`)
  console.log(`  both fire        : ${crossLabeled.both}`)
  console.log(`  NER fires, LLM passes  : ${crossLabeled.ner_only}   <-- candidates NER catches that LLM misses`)
  console.log(`  LLM fires, NER passes  : ${crossLabeled.llm_only}   <-- candidates LLM catches that NER misses`)
  console.log(`  both pass        : ${crossLabeled.neither}`)

  console.log(`\n=== Same cross-tab restricted to oracle FAIL rows (the FN-floor question) ===`)
  console.log(`  both fire (correctly)       : ${crossLabeledFail.both}`)
  console.log(`  NER catches, LLM misses (WIN): ${crossLabeledFail.ner_only}`)
  console.log(`  LLM catches, NER misses    : ${crossLabeledFail.llm_only}`)
  console.log(`  both miss (residual FN floor): ${crossLabeledFail.neither}`)

  console.log(`\n=== Same cross-tab restricted to oracle PASS rows (the FP-cost question) ===`)
  console.log(`  both fire (BAD: both wrong) : ${crossLabeledPass.both}`)
  console.log(`  NER fires only (NER FP)    : ${crossLabeledPass.ner_only}`)
  console.log(`  LLM fires only (LLM FP)    : ${crossLabeledPass.llm_only}`)
  console.log(`  both pass (correct)         : ${crossLabeledPass.neither}`)

  // Per-case-role breakdown (labeled rows only)
  console.log(`\n=== Per-case_role breakdown (labeled rows only) ===`)
  const roles = Array.from(new Set(out.map(r => r.case_role)))
  for (const role of roles) {
    const sub = oracleLabeled.filter(r => r.case_role === role)
    if (sub.length === 0) continue
    const nerM = build2x2(sub, r => r.ner_fires)
    const llmM = build2x2(sub.filter(r => r.llm_fires !== null), r => r.llm_fires)
    console.log(`  ${role} (n=${sub.length}):`)
    console.log(`    NER: ${fmtMatrix(nerM)}`)
    console.log(`    LLM: ${fmtMatrix(llmM)}`)
  }

  // Disagreement-row preview — print the fixture_ids + first ungrounded
  // phrase for the "NER catches, LLM misses on FAIL row" cell, and for
  // the "LLM catches, NER misses on FAIL row" cell.
  console.log(`\n=== Disagreement rows on oracle FAIL (FN-floor candidates) ===`)
  for (const r of oracleLabeled) {
    if (r.oracle_pass !== false) continue
    if (r.llm_fires === null) continue
    if (r.ner_fires && !r.llm_fires) {
      console.log(`  NER-WIN  ${r.fixture_id}: NER=[${r.ner_ungrounded_phrases.slice(0, 3).join(", ")}] expected=[${r.oracle_expected_entities.join(", ")}]`)
    } else if (!r.ner_fires && r.llm_fires) {
      console.log(`  LLM-WIN  ${r.fixture_id}: LLM-vote-fail=${r.llm_vote_count_fail}/${r.llm_n_calls} expected=[${r.oracle_expected_entities.join(", ")}]`)
    } else if (!r.ner_fires && !r.llm_fires) {
      console.log(`  BOTH-MISS ${r.fixture_id}: expected=[${r.oracle_expected_entities.join(", ")}]   <-- FN floor neither side cracks`)
    }
  }

  console.log(`\n=== Disagreement rows on oracle PASS (FP-cost candidates) ===`)
  for (const r of oracleLabeled) {
    if (r.oracle_pass !== true) continue
    if (r.llm_fires === null) continue
    if (r.ner_fires && !r.llm_fires) {
      console.log(`  NER-FP   ${r.fixture_id}: NER=[${r.ner_ungrounded_phrases.slice(0, 3).join(", ")}]`)
    } else if (!r.ner_fires && r.llm_fires) {
      console.log(`  LLM-FP   ${r.fixture_id}: LLM-vote-fail=${r.llm_vote_count_fail}/${r.llm_n_calls}`)
    }
  }

  // Persist to phase_eval_runs
  if (args.persist) {
    const summary = {
      panel_path: args.inPath,
      convergence_path: args.convergencePath ?? null,
      llm_k_threshold: args.llmK,
      n_total_halluc_rows: out.length,
      n_oracle_labeled: oracleLabeled.length,
      n_llm_signal_available: llmAvailable.length,
      ner_2x2_oracle_labeled: nerMatrix,
      llm_2x2_oracle_labeled: llmMatrix,
      ner_metrics: f1Of(nerMatrix),
      llm_metrics: f1Of(llmMatrix),
      cross_tab_labeled_all: crossLabeled,
      cross_tab_labeled_fail: crossLabeledFail,
      cross_tab_labeled_pass: crossLabeledPass,
      per_case_role: roles.reduce<Record<string, any>>((acc, role) => {
        const sub = oracleLabeled.filter(r => r.case_role === role)
        if (sub.length === 0) return acc
        const nerM = build2x2(sub, r => r.ner_fires)
        const llmM = build2x2(sub.filter(r => r.llm_fires !== null), r => r.llm_fires)
        acc[role] = {
          n: sub.length,
          ner_2x2: nerM,
          ner_metrics: f1Of(nerM),
          llm_2x2: llmM,
          llm_metrics: f1Of(llmM),
        }
        return acc
      }, {}),
    }
    const fail = crossLabeledFail
    const verdict =
      fail.ner_only > 0
        ? `NER-CATCHES-${fail.ner_only}-OF-${fail.ner_only + fail.both + fail.neither}-ORACLE-FAIL`
        : `NER-DOES-NOT-LIFT-FLOOR-N${fail.both + fail.neither}`

    const { persistPhaseEvalRun, currentGitCommit } = await import("../phase-eval/persist-run")
    const runId = await persistPhaseEvalRun({
      probeName: "halluc-ungrounded-ner-calibration",
      gitCommit: currentGitCommit(),
      experimentId: args.expId ?? null,
      seedsUsed: ["fantasy-system-heretic"],
      variantLabels: [args.variantLabel],
      summaryJson: summary,
      verdict,
      notes: args.note ?? null,
    })
    console.log(`\n[persist] phase_eval_runs.id=${runId} probe=halluc-ungrounded-ner-calibration verdict=${verdict}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
