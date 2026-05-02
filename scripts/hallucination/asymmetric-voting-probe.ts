#!/usr/bin/env bun
/**
 * L19 Asymmetric Voting Policy Probe
 *
 * Compares 4 voting policies for halluc-ungrounded on two panels:
 *  1. Labeled natural-mixed panel (22 halluc rows)
 *  2. Expanded synthetic panel (27 rows, 6 classes)
 *
 * For each row:
 *  - NER: deterministic (free, always runs)
 *  - 5 LLM calls at T=0.5 (for policies A + B)
 *  - 1 LLM call at T=0.1 (for policies AND-gate-v1 + C, mirrors current production)
 *
 * Policies:
 *  AND-gate-v1 (current): NER∩LLM-T01=blocker; NER-only=warning(fail); LLM-only=blocker; T=0.1 single call
 *  Asym-A: NER alone blocks; LLM T=0.5 ≥3-of-5=blocker; 1-2-of-5=warning(fail); 0-of-5=pass-LLM
 *  Asym-B: NER alone blocks; LLM T=0.5 ≥2-of-5=blocker; 1-of-5=warning(fail); 0-of-5=pass-LLM
 *  Asym-C: NER alone blocks; LLM T=0.1 single=blocker; same LLM call count as AND-gate-v1
 *
 * "NER alone blocks" means: if NER fires, declare fail (regardless of LLM).
 * "LLM alone blocks" means: if LLM fires at the given threshold, declare fail.
 * "warning(fail)" means: pass=false but labeled as warning severity.
 *
 * All policies produce a final declared_pass (boolean). We compare that
 * against oracle to compute TP/FP/FN/TN/F1.
 *
 * Usage:
 *   bun scripts/hallucination/asymmetric-voting-probe.ts \
 *     --labeled /tmp/halluc-current-panel-exp299-labeled.jsonl \
 *     --expanded scripts/hallucination/expanded-fail-classes-panel.jsonl \
 *     --out /tmp/asym-voting-probe-<TIMESTAMP>.jsonl \
 *     --exp-id <N>
 *
 * Per feedback_no_overwrite_runs: --out MUST be timestamped.
 * Per feedback_db_over_docs: persist matrix to phase_eval_runs.summary_json.
 * Per feedback_query_llm_calls_for_costs: budget from llm_calls.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { callAgent } from "../../src/llm"
import { hallucUngroundedSchema, HALLUC_UNGROUNDED_SYSTEM } from "../../src/agents/halluc-ungrounded"
import {
  extractEntityCandidates,
  normalizeForGroundedMatch,
} from "../../src/lint/entity-candidates"

const PARALLELISM = 5 // rows in flight at once

interface Args {
  labeledPath: string
  expandedPath: string
  outPath: string
  expId?: number
  n: number
  skipLlm: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let labeledPath = ""
  let expandedPath = ""
  let outPath = ""
  let expId: number | undefined
  let n = 5
  let skipLlm = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--labeled") labeledPath = argv[++i]!
    else if (argv[i] === "--expanded") expandedPath = argv[++i]!
    else if (argv[i] === "--out") outPath = argv[++i]!
    else if (argv[i] === "--exp-id") expId = Number(argv[++i])
    else if (argv[i] === "--n") n = Number(argv[++i])
    else if (argv[i] === "--skip-llm") skipLlm = true
  }
  if (!labeledPath || !expandedPath || !outPath) {
    console.error(
      "usage: --labeled <panel.jsonl> --expanded <expanded.jsonl> --out <out-<TS>.jsonl> [--exp-id N] [--n 5] [--skip-llm]"
    )
    process.exit(1)
  }
  return { labeledPath, expandedPath, outPath, expId, n, skipLlm }
}

// ── Oracle label helpers ──────────────────────────────────────────────────

interface OracleLabel {
  pass: boolean | null
  source: string
  expected_entities: string[]
}

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
  // For labeled panel rows with expected_pass in gold (adjudicated natural)
  if (row.gold?.expected_pass !== undefined) {
    return {
      pass: row.gold.expected_pass,
      source: "labeled",
      expected_entities: [],
    }
  }
  return { pass: null, source: "unlabeled", expected_entities: [] }
}

// ── NER helpers ──────────────────────────────────────────────────────────

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
      const tokens = trimmed.split(/\s+/).filter(t => t.length > 0)
      for (const t of tokens) {
        const cleaned = t.replace(/[''](s|S)?$/, "").toLowerCase()
        if (cleaned.length > 0) {
          lower.add(cleaned)
          const norm = normalizeForGroundedMatch(t)
          if (norm.length > 0) normalized.add(norm)
        }
      }
    }
  }
  return { lower, normalized }
}

function isGrounded(phrase: string, surface: GroundedSurface): boolean {
  const c = phrase.toLowerCase().trim()
  if (c.length === 0) return true
  if (surface.lower.has(c)) return true
  for (const s of surface.lower) {
    if (s.length >= c.length && s.includes(c)) return true
  }
  const normC = normalizeForGroundedMatch(phrase)
  if (normC.length > 0 && surface.normalized.has(normC)) return true
  if (normC.length > 0) {
    for (const s of surface.normalized) {
      if (s.length >= normC.length && s.includes(normC)) return true
    }
  }
  const tokens = c.split(/\s+/).filter(t => t.length > 0)
  if (tokens.length === 0) return false
  return tokens.every(t => {
    const cleaned = t.replace(/[''](s|S)?$/, "")
    return surface.lower.has(cleaned)
  })
}

function runNER(row: any): { fires: boolean; phrases: string[] } {
  const prose: string = row.task?.prose ?? ""
  const surface = buildGroundedSurface(row)
  const candidates = extractEntityCandidates(prose)
  const ungrounded = candidates.filter(c => !isGrounded(c.phrase, surface))
  return { fires: ungrounded.length > 0, phrases: ungrounded.map(c => c.phrase) }
}

// ── LLM call helpers ──────────────────────────────────────────────────────

function buildUserPrompt(row: any): string {
  const meta = row.task?.writer_request_meta ?? {}
  const gs = row.task?.checker_request_meta?.groundedSources ?? {}
  const bible = gs.bible ?? []
  const fromBrief = gs.from_brief ?? []
  const derivedFact = gs.derived_outline_fact ?? []
  const derivedPrior = gs.derived_prior_beat ?? []
  const beatChars = (meta.beatCharacters ?? []) as string[]

  return [
    "BEAT BRIEF:",
    `  Summary: ${meta.beatDescription ?? ""}`,
    `  Kind: action`,
    `  POV: ${beatChars[0] ?? ""}`,
    `  Characters: ${beatChars.join(", ")}`,
    `  Setting: `,
    "",
    "WORLD BIBLE (relevant, names only):",
    `  Locations: ${bible.join(", ") || "(none)"}`,
    `  Cultures:  (none)`,
    `  Systems:   (none)`,
    `  From-brief: ${fromBrief.join(", ") || "(none)"}`,
    `  Beat-entities: ${[...derivedFact, ...derivedPrior].join(", ") || "(none)"}`,
    "",
    "SPEAKERS:",
    ...(beatChars.length > 0 ? beatChars.map(n => `  ${n}: `) : ["  (none)"]),
    "",
    "PROSE TO CHECK:",
    row.task?.prose ?? "",
  ].join("\n")
}

async function runOneLLMCall(
  userPrompt: string,
  temperature: number,
): Promise<{ pass: boolean | null; failed: boolean }> {
  try {
    const result = await callAgent({
      agentName: "halluc-ungrounded" as const,
      systemPrompt: HALLUC_UNGROUNDED_SYSTEM,
      userPrompt,
      schema: hallucUngroundedSchema,
      temperature,
    })
    return { pass: result.output.pass, failed: false }
  } catch (err) {
    return { pass: null, failed: true }
  }
}

// ── Policy evaluation ─────────────────────────────────────────────────────

interface PolicyResult {
  declared_pass: boolean
  mode: "blocker" | "warning" | "pass"
}

/**
 * AND-gate-v1 (current production):
 *  - NER∩LLM(T=0.1) → blocker
 *  - NER-only → warning (fail)
 *  - LLM-only → blocker (fail)
 *  - neither → pass
 */
function evaluateAndGateV1(nerFires: boolean, llmT01Fires: boolean): PolicyResult {
  if (nerFires && llmT01Fires) return { declared_pass: false, mode: "blocker" }
  if (nerFires && !llmT01Fires) return { declared_pass: false, mode: "warning" }
  if (!nerFires && llmT01Fires) return { declared_pass: false, mode: "blocker" }
  return { declared_pass: true, mode: "pass" }
}

/**
 * Asym-A (high-precision):
 *  - NER fires → ALWAYS block (regardless of LLM)
 *  - LLM T=0.5 ≥3-of-5 → blocker
 *  - LLM T=0.5 1-2-of-5 → warning (fail)
 *  - LLM T=0.5 0-of-5 → pass (LLM)
 */
function evaluateAsymA(nerFires: boolean, llmVoteFail: number, n: number): PolicyResult {
  if (nerFires) return { declared_pass: false, mode: "blocker" }
  if (llmVoteFail >= 3) return { declared_pass: false, mode: "blocker" }
  if (llmVoteFail >= 1) return { declared_pass: false, mode: "warning" }
  return { declared_pass: true, mode: "pass" }
}

/**
 * Asym-B (high-recall):
 *  - NER fires → ALWAYS block
 *  - LLM T=0.5 ≥2-of-5 → blocker
 *  - LLM T=0.5 1-of-5 → warning (fail)
 *  - LLM T=0.5 0-of-5 → pass (LLM)
 */
function evaluateAsymB(nerFires: boolean, llmVoteFail: number, n: number): PolicyResult {
  if (nerFires) return { declared_pass: false, mode: "blocker" }
  if (llmVoteFail >= 2) return { declared_pass: false, mode: "blocker" }
  if (llmVoteFail >= 1) return { declared_pass: false, mode: "warning" }
  return { declared_pass: true, mode: "pass" }
}

/**
 * Asym-C (NER + single call T=0.1):
 *  - NER fires → ALWAYS block (NER alone is sufficient given F1=1.0)
 *  - LLM T=0.1 fires → blocker
 *  - neither → pass
 *  Same call count as AND-gate-v1 (1 LLM call).
 */
function evaluateAsymC(nerFires: boolean, llmT01Fires: boolean): PolicyResult {
  if (nerFires) return { declared_pass: false, mode: "blocker" }
  if (llmT01Fires) return { declared_pass: false, mode: "blocker" }
  return { declared_pass: true, mode: "pass" }
}

// ── Per-row result ─────────────────────────────────────────────────────────

interface RowResult {
  fixture_id: string
  panel: "labeled" | "expanded"
  case_role: string
  fixture_class?: string
  oracle_pass: boolean | null
  oracle_source: string
  // NER
  ner_fires: boolean
  ner_phrases: string[]
  // LLM T=0.1 single call
  llm_t01_pass: boolean | null
  llm_t01_fires: boolean | null
  llm_t01_failed: boolean
  // LLM T=0.5 5-call votes
  llm_t05_votes: Array<boolean | null>
  llm_t05_vote_count_fail: number
  llm_t05_failed_calls: number
  // Policy verdicts
  policy_and_gate_v1: PolicyResult
  policy_asym_a: PolicyResult
  policy_asym_b: PolicyResult
  policy_asym_c: PolicyResult
}

function calibrate(
  declared_pass: boolean,
  oracle_pass: boolean | null,
): "TP" | "FP" | "FN" | "TN" | "NO-ORACLE" {
  if (oracle_pass === null) return "NO-ORACLE"
  if (!oracle_pass && !declared_pass) return "TP"
  if (!oracle_pass && declared_pass) return "FN"
  if (oracle_pass && !declared_pass) return "FP"
  return "TN"
}

interface Metrics {
  TP: number
  FP: number
  FN: number
  TN: number
  recall: number | null
  precision: number | null
  f1: number | null
}

function computeMetrics(rows: RowResult[], policy: keyof Pick<RowResult, "policy_and_gate_v1" | "policy_asym_a" | "policy_asym_b" | "policy_asym_c">): Metrics {
  let TP = 0, FP = 0, FN = 0, TN = 0
  for (const r of rows) {
    const verdict = r[policy] as PolicyResult
    const cal = calibrate(verdict.declared_pass, r.oracle_pass)
    if (cal === "TP") TP++
    else if (cal === "FP") FP++
    else if (cal === "FN") FN++
    else if (cal === "TN") TN++
  }
  const recall = TP + FN > 0 ? TP / (TP + FN) : null
  const precision = TP + FP > 0 ? TP / (TP + FP) : null
  const f1 = recall !== null && precision !== null && (recall + precision) > 0
    ? 2 * recall * precision / (recall + precision)
    : null
  return { TP, FP, FN, TN, recall, precision, f1 }
}

function fmt(m: Metrics): string {
  const r = m.recall === null ? "n/a" : m.recall.toFixed(3)
  const p = m.precision === null ? "n/a" : m.precision.toFixed(3)
  const f = m.f1 === null ? "n/a" : m.f1.toFixed(3)
  return `TP=${m.TP} FP=${m.FP} FN=${m.FN} TN=${m.TN} | R=${r} P=${p} F1=${f}`
}

// ── Concurrency helper ────────────────────────────────────────────────────

async function withConcurrency<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIdx = 0
  async function runner() {
    while (true) {
      const i = nextIdx++
      if (i >= items.length) return
      results[i] = await worker(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runner()))
  return results
}

// ── Main ──────────────────────────────────────────────────────────────────

async function processRow(
  row: any,
  panel: "labeled" | "expanded",
  n: number,
  skipLlm: boolean,
): Promise<RowResult> {
  const oracle = getOracleLabel(row)
  const ner = runNER(row)
  const userPrompt = buildUserPrompt(row)

  let llm_t01_pass: boolean | null = null
  let llm_t01_fires: boolean | null = null
  let llm_t01_failed = false
  let llm_t05_votes: Array<boolean | null> = []
  let llm_t05_vote_count_fail = 0
  let llm_t05_failed_calls = 0

  if (!skipLlm) {
    // Run T=0.1 single call + T=0.5 N calls in parallel
    const [t01Result, ...t05Results] = await Promise.all([
      runOneLLMCall(userPrompt, 0.1),
      ...Array.from({ length: n }, () => runOneLLMCall(userPrompt, 0.5)),
    ])
    llm_t01_pass = t01Result.pass
    llm_t01_fires = t01Result.pass === false ? true : t01Result.pass === true ? false : null
    llm_t01_failed = t01Result.failed
    llm_t05_votes = t05Results.map(r => r.pass)
    llm_t05_vote_count_fail = t05Results.filter(r => r.pass === false).length
    llm_t05_failed_calls = t05Results.filter(r => r.failed).length
  }

  const llmT01Fires = llm_t01_fires === true
  const policy_and_gate_v1 = evaluateAndGateV1(ner.fires, llmT01Fires)
  const policy_asym_a = evaluateAsymA(ner.fires, llm_t05_vote_count_fail, n)
  const policy_asym_b = evaluateAsymB(ner.fires, llm_t05_vote_count_fail, n)
  const policy_asym_c = evaluateAsymC(ner.fires, llmT01Fires)

  const fixtureId = row.fixture_id ?? row.case_id ?? "unknown"

  return {
    fixture_id: fixtureId,
    panel,
    case_role: row.case_role ?? "unknown",
    fixture_class: row.fixture_class ?? undefined,
    oracle_pass: oracle.pass,
    oracle_source: oracle.source,
    ner_fires: ner.fires,
    ner_phrases: ner.phrases,
    llm_t01_pass,
    llm_t01_fires,
    llm_t01_failed,
    llm_t05_votes,
    llm_t05_vote_count_fail,
    llm_t05_failed_calls,
    policy_and_gate_v1,
    policy_asym_a,
    policy_asym_b,
    policy_asym_c,
  }
}

async function main() {
  const args = parseArgs()

  // Create experiment
  let expId = args.expId
  if (!expId) {
    const { createTuningExperiment } = await import("../../src/harness/experiments")
    expId = await createTuningExperiment(
      "ticket",
      "L19 asymmetric voting policy probe (NER F1=1.0 unlocks)",
      {
        policies: ["AND-gate-v1", "asym-A", "asym-B", "asym-C"],
        parent_exps: [316, 322, 327, 330],
        n_llm_calls: args.n,
        labeled_panel: args.labeledPath,
        expanded_panel: args.expandedPath,
      },
    )
    console.log(`[exp] Created tuning_experiments.id=${expId}`)
  } else {
    console.log(`[exp] Using existing experiment_id=${expId}`)
  }

  // Init experiment run for cost tracking
  if (expId) {
    const { initExperimentRun } = await import("../../src/logger")
    const runId = await initExperimentRun(
      expId,
      "halluc-ungrounded-asym-voting-probe",
      `T05-N${args.n}+T01-N1`,
      "L19-asym-voting-probe",
    )
    console.log(`[runs] initialized run id=${runId}`)
  }

  // Load panels
  const labeledRows = readFileSync(resolve(args.labeledPath), "utf8")
    .trim().split("\n")
    .map(l => JSON.parse(l))
    .filter(r => r.checker === "halluc-ungrounded")
  const expandedRows = readFileSync(resolve(args.expandedPath), "utf8")
    .trim().split("\n")
    .map(l => JSON.parse(l))

  // Assign fixture_id if missing in expanded panel
  for (const r of expandedRows) {
    if (!r.fixture_id) r.fixture_id = r.case_id
  }

  console.log(`Loaded: labeled=${labeledRows.length} rows, expanded=${expandedRows.length} rows`)
  console.log(`N=${args.n} LLM calls at T=0.5 + 1 at T=0.1 per row`)
  console.log(`skipLlm=${args.skipLlm}`)

  const allRows: Array<[any, "labeled" | "expanded"]> = [
    ...labeledRows.map(r => [r, "labeled"] as [any, "labeled"]),
    ...expandedRows.map(r => [r, "expanded"] as [any, "expanded"]),
  ]

  const startMs = Date.now()
  const results = await withConcurrency(
    allRows,
    async ([row, panel], idx) => {
      const r = await processRow(row, panel, args.n, args.skipLlm)
      const oStr = r.oracle_pass === null ? "?" : r.oracle_pass ? "PASS" : "FAIL"
      console.log(
        `  [${idx + 1}/${allRows.length}] ${r.fixture_id.slice(0, 60)} | oracle=${oStr} NER=${r.ner_fires ? "FIRE" : "pass"} T05votes=${r.llm_t05_vote_count_fail}/${args.n} T01=${r.llm_t01_fires === true ? "FIRE" : r.llm_t01_fires === false ? "pass" : "n/a"}`
      )
      return r
    },
    PARALLELISM,
  )
  const elapsed = Math.round((Date.now() - startMs) / 1000)
  console.log(`\nElapsed: ${elapsed}s`)

  // Write per-row JSONL
  writeFileSync(
    resolve(args.outPath),
    results.map(r => JSON.stringify(r)).join("\n") + "\n",
  )
  console.log(`Wrote ${results.length} rows to ${args.outPath}`)

  // ── Compute metrics ──────────────────────────────────────────────────────

  const labeled = results.filter(r => r.panel === "labeled" && r.oracle_pass !== null)
  const expanded = results.filter(r => r.panel === "expanded" && r.oracle_pass !== null)
  const combined = results.filter(r => r.oracle_pass !== null)

  const policies = [
    "policy_and_gate_v1",
    "policy_asym_a",
    "policy_asym_b",
    "policy_asym_c",
  ] as const

  const policyNames = {
    policy_and_gate_v1: "AND-gate-v1 (current)",
    policy_asym_a: "Asym-A (NER-block + LLM≥3-of-5)",
    policy_asym_b: "Asym-B (NER-block + LLM≥2-of-5)",
    policy_asym_c: "Asym-C (NER-block + T=0.1-single)",
  }

  console.log("\n=== Policy comparison matrix ===")
  console.log("\n--- Labeled panel (natural-mixed, n=" + labeled.length + " oracle-labeled) ---")
  for (const p of policies) {
    const m = computeMetrics(labeled, p)
    console.log(`  ${policyNames[p]}: ${fmt(m)}`)
  }

  console.log("\n--- Expanded synthetic panel (n=" + expanded.length + " oracle-labeled) ---")
  for (const p of policies) {
    const m = computeMetrics(expanded, p)
    console.log(`  ${policyNames[p]}: ${fmt(m)}`)
  }

  console.log("\n--- Combined (n=" + combined.length + " oracle-labeled) ---")
  for (const p of policies) {
    const m = computeMetrics(combined, p)
    console.log(`  ${policyNames[p]}: ${fmt(m)}`)
  }

  // ── Per-class breakdown (expanded panel) ──────────────────────────────────

  const classes = Array.from(new Set(expanded.map(r => r.fixture_class).filter(Boolean)))
  console.log("\n=== Per-class breakdown (expanded panel) ===")
  for (const cls of classes) {
    const sub = expanded.filter(r => r.fixture_class === cls)
    console.log(`  ${cls} (n=${sub.length}):`)
    for (const p of policies) {
      const m = computeMetrics(sub, p)
      console.log(`    ${policyNames[p]}: ${fmt(m)}`)
    }
  }

  // ── Cost per policy ───────────────────────────────────────────────────────

  const totalRows = allRows.length
  console.log("\n=== Cost per policy (LLM calls per beat) ===")
  console.log(`  AND-gate-v1:  1 LLM call @ T=0.1 per beat`)
  console.log(`  Asym-A:       ${args.n} LLM calls @ T=0.5 per beat`)
  console.log(`  Asym-B:       ${args.n} LLM calls @ T=0.5 per beat`)
  console.log(`  Asym-C:       1 LLM call @ T=0.1 per beat`)
  console.log(`  (Probe total: 1 T=0.1 call + ${args.n} T=0.5 calls per row × ${totalRows} rows = ${totalRows * (1 + args.n)} calls)`)

  // ── Build summary for persistence ────────────────────────────────────────

  function metricsForPanel(panelRows: RowResult[]) {
    const out: Record<string, any> = {}
    for (const p of policies) {
      out[p] = computeMetrics(panelRows, p)
    }
    return out
  }

  function perClassMetrics() {
    const out: Record<string, Record<string, Metrics>> = {}
    for (const cls of classes) {
      const sub = expanded.filter(r => r.fixture_class === cls)
      out[cls as string] = {} as Record<string, Metrics>
      for (const p of policies) {
        out[cls as string]![p] = computeMetrics(sub, p)
      }
    }
    return out
  }

  const summaryJson = {
    loop: "L19",
    experiment_id: expId,
    n_llm_calls: args.n,
    panels: {
      labeled_n: labeled.length,
      expanded_n: expanded.length,
      combined_n: combined.length,
    },
    labeled_metrics: metricsForPanel(labeled),
    expanded_metrics: metricsForPanel(expanded),
    combined_metrics: metricsForPanel(combined),
    per_class_expanded: perClassMetrics(),
    cost_per_policy: {
      and_gate_v1: { llm_calls_per_beat: 1, temperature: 0.1 },
      asym_a: { llm_calls_per_beat: args.n, temperature: 0.5 },
      asym_b: { llm_calls_per_beat: args.n, temperature: 0.5 },
      asym_c: { llm_calls_per_beat: 1, temperature: 0.1 },
    },
    duration_seconds: elapsed,
  }

  // ── Persist to phase_eval_runs ────────────────────────────────────────────

  const { persistPhaseEvalRun, currentGitCommit } = await import("../phase-eval/persist-run")

  // Determine recommendation verdict
  const andM = computeMetrics(combined, "policy_and_gate_v1")
  const aM = computeMetrics(combined, "policy_asym_a")
  const bM = computeMetrics(combined, "policy_asym_b")
  const cM = computeMetrics(combined, "policy_asym_c")

  const andF1 = andM.f1 ?? 0
  const aF1 = aM.f1 ?? 0
  const bF1 = bM.f1 ?? 0
  const cF1 = cM.f1 ?? 0

  const andFP = andM.FP
  const aFP = aM.FP
  const bFP = bM.FP
  const cFP = cM.FP

  let verdict = "NO-PROMOTION"
  if (aF1 > andF1 + 0.05 && aFP <= andFP) verdict = "PROMOTE-ASYM-A"
  else if (bF1 > andF1 + 0.05 && bFP <= andFP) verdict = "PROMOTE-ASYM-B"
  else if (cF1 > andF1 + 0.05 && cFP <= andFP) verdict = "PROMOTE-ASYM-C"
  else if (Math.max(aF1, bF1, cF1) <= andF1) verdict = "KEEP-AND-GATE-V1"
  else verdict = "MARGINAL-IMPROVEMENT-INSUFFICIENT"

  const runId = await persistPhaseEvalRun({
    probeName: "asymmetric-voting-policy-probe",
    gitCommit: currentGitCommit(),
    experimentId: expId ?? null,
    seedsUsed: ["fantasy-system-heretic"],
    variantLabels: ["L19", "asym-A", "asym-B", "asym-C", "AND-gate-v1"],
    summaryJson,
    verdict,
    notes: `L19: 4-policy asymmetric voting probe. NER F1=1.000 pre-condition satisfied (exp #330). Combined panel n=${combined.length}.`,
  })
  console.log(`\n[persist] phase_eval_runs.id=${runId} probe=asymmetric-voting-policy-probe verdict=${verdict}`)
  console.log(`[exp] Experiment id=${expId}`)

  // Print verdict
  console.log(`\nVERDICT: ${verdict}`)
  if (verdict === "PROMOTE-ASYM-A") {
    console.log("Asym-A beats AND-gate-v1 by >5% F1 with no FP regression → recommend L20: promote Asym-A to runtime")
  } else if (verdict === "PROMOTE-ASYM-B") {
    console.log("Asym-B beats AND-gate-v1 by >5% F1 with no FP regression → recommend L20: promote Asym-B to runtime")
  } else if (verdict === "PROMOTE-ASYM-C") {
    console.log("Asym-C beats AND-gate-v1 by >5% F1 with no FP regression → recommend L20: promote Asym-C to runtime")
  } else if (verdict === "KEEP-AND-GATE-V1") {
    console.log("None of the asymmetric policies beats AND-gate-v1 — keep current production")
  } else {
    console.log("Marginal improvement: present findings and defer runtime change")
  }

  return { expId, runId, verdict, andM, aM, bM, cM, summaryJson }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
