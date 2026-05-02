#!/usr/bin/env bun
/**
 * Smoke-stop classifier for LXC smoke runs.
 *
 * Reads an operator-summary --json snapshot and classifies the run into one of:
 *   - clean_pass        novel completed without unresolved gates / failures
 *   - new_blocker       at least one PENDING plan-assist gate of unknown design class
 *   - regression        novel phase=failed/aborted with no pending gate to explain
 *   - infra_failure     LLM call failure rate exceeds threshold
 *   - human_needed      ambiguous; refuse to classify automatically
 *
 * The classifier is conservative: when signals conflict it reports
 * human_needed instead of guessing. This protects stop-gate (c) of the L56
 * lane: "ambiguous evidence is over-classified instead of human-needed".
 *
 * USAGE
 *
 *   # Pipe operator-summary JSON in:
 *   bun scripts/operator-summary.ts --json <novel-id> | \
 *       bun scripts/agent/smoke-stop-classifier.ts
 *
 *   # Or pass a saved JSON file:
 *   bun scripts/agent/smoke-stop-classifier.ts --input run.json
 *
 *   # Treat specific gate kinds as already-known (count as clean if only these
 *   # are pending):
 *   bun scripts/agent/smoke-stop-classifier.ts --known-kinds halluc-ungrounded,continuity-state
 */

import { readFileSync } from "node:fs"

export type StopClassification =
  | "clean_pass"
  | "new_blocker"
  | "regression"
  | "infra_failure"
  | "human_needed"

export interface ClassifierNovel {
  phase: string
  current_chapter: number
  total_chapters: number
}

export interface ClassifierAgentCost {
  agent?: string
  calls: number
  failed_calls: number
}

export interface ClassifierExhaustion {
  id?: number
  chapter?: number
  attempt?: number
  kind: string
  decision: string | null
}

export interface ClassifierFailedCall {
  agent?: string
  count: number
  error_text?: string | null
}

export interface ClassifierInput {
  novel: ClassifierNovel
  agentCosts: ClassifierAgentCost[]
  exhaustions: ClassifierExhaustion[]
  failedCalls: ClassifierFailedCall[]
}

export interface ClassifierOptions {
  /** Plan-assist gate kinds already known to the operator. Pending gates
   *  whose kind is in this set are treated as on-policy "expected" stops
   *  rather than new design-class blockers. */
  knownBlockerKinds?: Set<string>
  /** Fraction of total LLM calls that may fail before the run is called
   *  infra_failure. Defaults to 0.30. */
  maxFailedRatio?: number
  /** Absolute count of failed calls treated as infra_failure regardless of
   *  ratio. Defaults to 10. */
  maxFailedAbsolute?: number
  /** Minimum LLM call count below which the run is considered too thin to
   *  classify automatically. Defaults to 3. */
  minCallsForSignal?: number
}

export interface ClassifierResult {
  classification: StopClassification
  reason: string
  evidence: string[]
}

const DEFAULT_OPTIONS: Required<Omit<ClassifierOptions, "knownBlockerKinds">> = {
  maxFailedRatio: 0.30,
  maxFailedAbsolute: 10,
  minCallsForSignal: 3,
}

/**
 * Classify a smoke run from operator-summary JSON.
 *
 * Order of checks matters: infra failure is checked first because a broken
 * provider will produce misleading downstream signals. Regression vs new
 * blocker is decided by phase and pending-gate state. Clean pass requires
 * the strict combo of phase=complete, full chapter coverage, and no
 * pending/denied gates.
 */
export function classifySmokeStop(
  input: ClassifierInput,
  options: ClassifierOptions = {},
): ClassifierResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const evidence: string[] = []

  const totalCalls = input.agentCosts.reduce((s, a) => s + (a.calls ?? 0), 0)
  const totalFailed = input.agentCosts.reduce((s, a) => s + (a.failed_calls ?? 0), 0)
  const failedFromTopErrors = input.failedCalls.reduce((s, r) => s + (r.count ?? 0), 0)
  const reportedFailed = Math.max(totalFailed, failedFromTopErrors)
  const failedRatio = totalCalls > 0 ? reportedFailed / totalCalls : 0

  evidence.push(`calls=${totalCalls} failed=${reportedFailed} ratio=${failedRatio.toFixed(2)}`)
  evidence.push(`phase=${input.novel.phase} chapters=${input.novel.current_chapter}/${input.novel.total_chapters}`)
  evidence.push(`gates_total=${input.exhaustions.length}`)

  // (d) Infra failure — check first; failed providers poison downstream signals.
  if (totalCalls === 0 && input.novel.phase !== "complete") {
    return {
      classification: "human_needed",
      reason: "no LLM calls recorded; cannot classify",
      evidence,
    }
  }
  if (totalCalls < opts.minCallsForSignal && input.novel.phase !== "complete") {
    return {
      classification: "human_needed",
      reason: `only ${totalCalls} LLM calls; below signal threshold ${opts.minCallsForSignal}`,
      evidence,
    }
  }
  if (
    reportedFailed >= opts.maxFailedAbsolute ||
    (totalCalls > 0 && failedRatio >= opts.maxFailedRatio)
  ) {
    return {
      classification: "infra_failure",
      reason: `${reportedFailed}/${totalCalls} LLM calls failed (${(failedRatio * 100).toFixed(0)}%)`,
      evidence,
    }
  }

  const pendingGates = input.exhaustions.filter(g => g.decision === null)
  const deniedGates = input.exhaustions.filter(g => (g.decision ?? "").toLowerCase() === "denied")
  const knownPending = opts.knownBlockerKinds
    ? pendingGates.filter(g => opts.knownBlockerKinds!.has(g.kind))
    : []
  const novelPendingKinds = pendingGates
    .map(g => g.kind)
    .filter(k => !(opts.knownBlockerKinds?.has(k) ?? false))

  // (c) Regression — novel ended in a failed/aborted phase.
  if (input.novel.phase === "failed" || input.novel.phase === "aborted") {
    if (pendingGates.length > 0) {
      // Phase failed but a plan-assist gate is still pending. The cause
      // could be either an infra blip mid-resolution or the gate itself.
      // Refuse to guess.
      return {
        classification: "human_needed",
        reason: `phase=${input.novel.phase} with ${pendingGates.length} pending gate(s); cause ambiguous`,
        evidence,
      }
    }
    return {
      classification: "regression",
      reason: `novel phase=${input.novel.phase} with no pending gate to explain it`,
      evidence,
    }
  }

  // (b) New blocker — pending or denied plan-assist gate of unknown class.
  if (novelPendingKinds.length > 0) {
    return {
      classification: "new_blocker",
      reason: `${novelPendingKinds.length} pending gate(s) of new kind: ${[...new Set(novelPendingKinds)].join(", ")}`,
      evidence,
    }
  }
  if (deniedGates.length > 0) {
    return {
      classification: "new_blocker",
      reason: `${deniedGates.length} denied gate(s): ${[...new Set(deniedGates.map(g => g.kind))].join(", ")}`,
      evidence,
    }
  }

  // Pending gates are all of known design class — treat as on-policy stop,
  // not a new blocker. The run still isn't a clean pass unless complete.
  if (pendingGates.length > 0 && input.novel.phase !== "complete") {
    return {
      classification: "human_needed",
      reason: `${knownPending.length} known-class gate(s) pending; awaiting operator resolution`,
      evidence,
    }
  }

  // (a) Clean pass — completed novel, full chapter coverage, no unresolved gates.
  if (
    input.novel.phase === "complete" &&
    input.novel.current_chapter >= input.novel.total_chapters &&
    pendingGates.length === 0 &&
    deniedGates.length === 0
  ) {
    return {
      classification: "clean_pass",
      reason: `completed ${input.novel.current_chapter}/${input.novel.total_chapters} with no unresolved gates`,
      evidence,
    }
  }

  return {
    classification: "human_needed",
    reason: `phase=${input.novel.phase}, ${pendingGates.length} pending / ${deniedGates.length} denied gate(s); not a decisive signal`,
    evidence,
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

interface CliArgs {
  inputPath: string | null
  knownKinds: Set<string> | undefined
  json: boolean
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { inputPath: null, knownKinds: undefined, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--input") {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        throw new Error("--input requires a path")
      }
      out.inputPath = next
      i++
    } else if (a === "--known-kinds") {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        throw new Error("--known-kinds requires a comma-separated list")
      }
      out.knownKinds = new Set(next.split(",").map(s => s.trim()).filter(Boolean))
      i++
    } else if (a === "--json") {
      out.json = true
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: bun scripts/agent/smoke-stop-classifier.ts [--input <path>] [--known-kinds k1,k2] [--json]\n" +
          "  Reads operator-summary --json from stdin (or --input file).\n",
      )
      process.exit(0)
    }
  }
  return out
}

function readStdinSync(): string {
  // Bun supports Bun.stdin.stream(); for synchronous-feel CLI use, slurp.
  // node:fs read of fd=0 works on Bun and Node alike.
  try {
    return readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

function normalizeInput(raw: unknown): ClassifierInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("input is not a JSON object")
  }
  const r = raw as Record<string, unknown>
  const novel = r.novel as Record<string, unknown> | undefined
  if (!novel) throw new Error("input missing 'novel'")
  return {
    novel: {
      phase: String(novel.phase ?? ""),
      current_chapter: Number(novel.current_chapter ?? 0),
      total_chapters: Number(novel.total_chapters ?? 0),
    },
    agentCosts: Array.isArray(r.agentCosts) ? (r.agentCosts as ClassifierAgentCost[]) : [],
    exhaustions: Array.isArray(r.exhaustions) ? (r.exhaustions as ClassifierExhaustion[]) : [],
    failedCalls: Array.isArray(r.failedCalls) ? (r.failedCalls as ClassifierFailedCall[]) : [],
  }
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv)
  const text = args.inputPath ? readFileSync(args.inputPath, "utf8") : readStdinSync()
  if (!text.trim()) {
    console.error("[smoke-stop-classifier] error: no input on stdin and no --input path")
    return 2
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    console.error(`[smoke-stop-classifier] error: input is not valid JSON: ${(e as Error).message}`)
    return 2
  }
  const input = normalizeInput(parsed)
  const result = classifySmokeStop(input, { knownBlockerKinds: args.knownKinds })
  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`classification: ${result.classification}`)
    console.log(`reason:         ${result.reason}`)
    console.log("evidence:")
    for (const e of result.evidence) console.log(`  - ${e}`)
  }
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      console.error("[smoke-stop-classifier] fatal:", err)
      process.exit(1)
    })
}
