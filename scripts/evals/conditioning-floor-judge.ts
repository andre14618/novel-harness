#!/usr/bin/env bun

/**
 * conditioning-floor-judge.ts
 *
 * Pairwise voice-distinctness judge for the conditioning-floor-slim-live-v1 eval.
 *
 * Reads a JSONL of matched arm pairs produced by the replay runner, calls
 * gpt-5.4 via `codex exec` for each pair, unshuffles the verdict back to the
 * original arm labels, and persists results to public.eval_results.
 *
 * Usage:
 *   bun scripts/evals/conditioning-floor-judge.ts \
 *     --pairs <path.jsonl> \
 *     --experiment-id <n> \
 *     [--out <path>] \
 *     [--seed <string>] \
 *     [--set-name <string>]
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import path from "node:path"
import db from "../../src/db/connection"

// ── Types ─────────────────────────────────────────────────────────────────────

/** One row from the replay-runner pair JSONL. */
export type PairRow = {
  pair_id: string
  pov_character: string
  characters_present: string[]
  beat_description: string
  arm_a_prose: string
  arm_b_prose: string
  /** Original arm label for the text placed in the A slot before shuffling. */
  arm_a_label: string
  /** Original arm label for the text placed in the B slot before shuffling. */
  arm_b_label: string
  // ── Loss-encoding fields (from the replay runner, charter §7) ────────────
  //
  // loss_a / loss_b are the canonical names. loss_fixed / loss_rotation are
  // backward-compat aliases written by old runner versions; the judge reads
  // both. Callers should prefer loss_a / loss_b going forward.
  //
  // If either loss flag is true, or error_text is set, the pair is
  // short-circuited: the judge call is skipped and an automatic verdict is
  // recorded. Added 2026-04-20 after Codex round-5 blocker #3.
  /** true if arm_a produced fewer than minWords */
  loss_a?: boolean
  /** true if arm_b produced fewer than minWords */
  loss_b?: boolean
  /** @deprecated Use loss_a. Read for backward compat with old runner output. */
  loss_fixed?: boolean
  /** @deprecated Use loss_b. Read for backward compat with old runner output. */
  loss_rotation?: boolean
  error_text?: string
  words_a?: number
  words_b?: number
  /** @deprecated Use words_a */
  words_fixed?: number
  /** @deprecated Use words_b */
  words_rotation?: number
  /** Number of HTTP attempts made by the runner for arm_a (defense-in-depth) */
  http_attempts_a?: number
  /** Number of HTTP attempts made by the runner for arm_b (defense-in-depth) */
  http_attempts_b?: number
}

/**
 * Machine-enforced short-circuit resolution for pairs with encoded losses.
 *
 * Reads loss_a / loss_b canonically; falls back to loss_fixed / loss_rotation
 * for backward compat with old runner output. Reason strings use the actual
 * arm_a_label / arm_b_label values from the pair (not hardcoded "fixed" /
 * "rotation") so the reason is accurate across all three pair sets.
 *
 * Returns null if the pair is eligible for judge evaluation; otherwise
 * returns the resolved winner_arm_label + a reason string. Both arms
 * failing (mutual loss OR error) scores as an error row, not a tie, so it
 * doesn't accidentally count toward the tally.
 */
export function resolveLossShortCircuit(pair: PairRow): {
  winner_arm_label: string
  reason: string
} | null {
  // Resolve effective loss flags — prefer new names, fall back to old names
  const lossA = pair.loss_a ?? pair.loss_fixed ?? false
  const lossB = pair.loss_b ?? pair.loss_rotation ?? false

  // Resolve word counts for use in reason strings
  const wordsA = pair.words_a ?? pair.words_fixed ?? 0
  const wordsB = pair.words_b ?? pair.words_rotation ?? 0

  const labelA = pair.arm_a_label
  const labelB = pair.arm_b_label

  const hasError = !!pair.error_text

  if (hasError && !lossA && !lossB) {
    // Error without a loss flag — treat as a mutual failure.
    return { winner_arm_label: "error", reason: `runner error: ${pair.error_text}` }
  }
  if (lossA && lossB) {
    return {
      winner_arm_label: "error",
      reason: `both arms below min-words (${labelA}=${wordsA}w, ${labelB}=${wordsB}w)${hasError ? `; runner error: ${pair.error_text}` : ""}`,
    }
  }
  if (lossA) {
    return {
      winner_arm_label: labelB,
      reason: `automatic ${labelB} win — ${labelA} arm below min-words (${labelA}=${wordsA}w)`,
    }
  }
  if (lossB) {
    return {
      winner_arm_label: labelA,
      reason: `automatic ${labelA} win — ${labelB} arm below min-words (${labelB}=${wordsB}w)`,
    }
  }
  if (hasError) {
    return { winner_arm_label: "error", reason: `runner error: ${pair.error_text}` }
  }
  return null
}

/** Judge response shape. */
export type JudgeVerdict = {
  winner: "A" | "B" | "tie"
  reasoning: string
}

/** Full judgment record written to DB and output file. */
export type JudgmentRecord = {
  pair_id: string
  /** The arm label in position A after shuffling (what the judge saw as "VERSION A"). */
  shuffled_a_label: string
  /** The arm label in position B after shuffling (what the judge saw as "VERSION B"). */
  shuffled_b_label: string
  judge_winner_position: "A" | "B" | "tie"
  /** Resolved arm label that won, after unshuffling. "tie" if judge said tie. */
  winner_arm_label: string
  reasoning: string
  latency_ms: number
  error?: string
}

type ParsedArgs = {
  pairsPath: string
  experimentId: number
  out: string
  seed: string
  setName: string
  concurrency: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SET_NAME = "conditioning-floor-slim-live-v1-replay"
const ADAPTER_URI = "salvatore-1988-v4"
const DEFAULT_OUT = "output/evals/conditioning-floor-judgments.json"
const DEFAULT_SEED = "conditioning-floor-v1"
const MAX_RETRIES = 3

const SYSTEM_PROMPT = `You are scoring a blind pairwise voice-distinctness eval on fantasy prose. Two versions of the SAME scene were drafted with the same beat description, the same POV character, the same supporting characters, and the same underlying plan. The only difference is which example-line subset was shown to the writer.

Your job: decide which version has more distinct character voices — where distinct means that each speaking character sounds clearly different from the others in cadence, diction, syntax, and register.

Respond with ONLY valid JSON:
{"winner": "A" | "B" | "tie", "reasoning": "<1-2 sentences citing specific lines>"}`

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag)
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "usage: bun scripts/evals/conditioning-floor-judge.ts \\\n" +
      "  --pairs <path.jsonl> \\\n" +
      "  --experiment-id <n> \\\n" +
      "  [--out <path>] \\\n" +
      "  [--seed <string>] \\\n" +
      "  [--set-name <string>]"
    )
    process.exit(0)
  }

  const pairsPath = get("--pairs")
  const experimentIdRaw = get("--experiment-id")
  const out = get("--out") ?? DEFAULT_OUT
  const seed = get("--seed") ?? DEFAULT_SEED
  const setName = get("--set-name") ?? DEFAULT_SET_NAME
  const concurrencyRaw = get("--concurrency")
  const concurrency = concurrencyRaw ? Number.parseInt(concurrencyRaw, 10) : 1

  if (!pairsPath) {
    console.error("error: --pairs is required")
    process.exit(1)
  }
  if (!experimentIdRaw) {
    console.error("error: --experiment-id is required")
    process.exit(1)
  }

  const experimentId = Number.parseInt(experimentIdRaw, 10)
  if (!Number.isInteger(experimentId) || experimentId < 1) {
    console.error(`error: --experiment-id must be a positive integer, got ${experimentIdRaw}`)
    process.exit(1)
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
    console.error(`error: --concurrency must be a positive integer 1-20, got ${concurrencyRaw}`)
    process.exit(1)
  }

  return { pairsPath: path.resolve(pairsPath), experimentId, out: path.resolve(out), seed, setName, concurrency }
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8")
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

// ── Shuffle / unshuffle ───────────────────────────────────────────────────────

/**
 * Deterministically decide which arm label goes into position A and which into B.
 *
 * Uses sha256(seed + pair_id) → first uint32. Even → original A stays in A.
 * Odd → swap A and B.
 *
 * Both the shuffled prose AND the label mapping are returned so the caller can
 * show the right prose to the judge and later unshuffle the verdict.
 */
export function shufflePair(
  pair: PairRow,
  seed: string
): {
  prose_a: string
  prose_b: string
  shuffled_a_label: string
  shuffled_b_label: string
} {
  const digest = createHash("sha256")
    .update(`${seed}:${pair.pair_id}`)
    .digest()
  const pick = digest.readUInt32BE(0)
  const swap = pick % 2 !== 0

  return swap
    ? {
        prose_a: pair.arm_b_prose,
        prose_b: pair.arm_a_prose,
        shuffled_a_label: pair.arm_b_label,
        shuffled_b_label: pair.arm_a_label
      }
    : {
        prose_a: pair.arm_a_prose,
        prose_b: pair.arm_b_prose,
        shuffled_a_label: pair.arm_a_label,
        shuffled_b_label: pair.arm_b_label
      }
}

/**
 * Map a judge's positional verdict ("A" | "B" | "tie") to an arm label.
 *
 * If the judge said "A" and shuffled_a_label is "rotation", winner is "rotation".
 */
export function unshuffleVerdict(
  judgeWinner: "A" | "B" | "tie",
  shuffledALabel: string,
  shuffledBLabel: string
): string {
  if (judgeWinner === "tie") return "tie"
  if (judgeWinner === "A") return shuffledALabel
  return shuffledBLabel
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildUserPrompt(pair: PairRow, proseA: string, proseB: string): string {
  return [
    "SCENE:",
    `- POV: ${pair.pov_character}`,
    `- Characters speaking: ${pair.characters_present.join(" + ")}`,
    `- Beat: ${pair.beat_description}`,
    "",
    "VERSION A:",
    proseA,
    "",
    "VERSION B:",
    proseB
  ].join("\n")
}

// ── Codex invocation ──────────────────────────────────────────────────────────

/**
 * Call gpt-5.4 via `codex exec` with the frozen judge prompt.
 * Returns the raw stdout from codex.
 */
async function runCodexExec(fullPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // We pass the full prompt (system + user) as stdin so there are no shell
    // quoting issues with long prose. codex exec reads stdin when `-` is used
    // or when stdin is piped and no prompt argument is given.
    const proc = spawn(
      "codex",
      [
        "exec",
        "--model", "gpt-5.4",
        "-c", "model_reasoning_effort=high",
        "--ephemeral",
        "--",
        fullPrompt
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env }
      }
    )

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    proc.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk))
    proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk))

    proc.on("close", (code) => {
      if (code !== 0) {
        const errText = Buffer.concat(stderr).toString("utf8")
        reject(new Error(`codex exec exited ${code}: ${errText.slice(0, 500)}`))
        return
      }
      resolve(Buffer.concat(stdout).toString("utf8"))
    })

    proc.on("error", (err) => reject(err))
  })
}

/**
 * Extract the JSON verdict from codex output.
 *
 * codex exec prints conversation-style output; we scan for the last JSON
 * object that has a "winner" field.
 */
function extractVerdictJSON(raw: string): JudgeVerdict {
  // Try to find JSON blocks in the output (the model may wrap in markdown fences)
  const jsonCandidates: string[] = []

  // Match bare {...} blocks
  const bareMatches = raw.match(/\{[^{}]*"winner"[^{}]*\}/gs)
  if (bareMatches) jsonCandidates.push(...bareMatches)

  // Match ```json ... ``` fences
  const fencedMatches = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)
  if (fencedMatches) {
    for (const block of fencedMatches) {
      const inner = block.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
      jsonCandidates.push(inner)
    }
  }

  // Try each candidate from the end (prefer the last one, which is the final answer)
  for (const candidate of [...jsonCandidates].reverse()) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      if (
        (parsed.winner === "A" || parsed.winner === "B" || parsed.winner === "tie") &&
        typeof parsed.reasoning === "string"
      ) {
        return { winner: parsed.winner as "A" | "B" | "tie", reasoning: parsed.reasoning }
      }
    } catch {
      // skip malformed candidates
    }
  }

  throw new Error(`No valid verdict JSON found in codex output. Raw (truncated):\n${raw.slice(0, 800)}`)
}

// ── Judge loop with retry ─────────────────────────────────────────────────────

async function judgeWithRetry(
  pair: PairRow,
  proseA: string,
  proseB: string
): Promise<{ verdict: JudgeVerdict; latencyMs: number }> {
  const userPrompt = buildUserPrompt(pair, proseA, proseB)
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = 2 ** attempt * 1000
      await new Promise((r) => setTimeout(r, backoffMs))
      console.warn(`  retry ${attempt}/${MAX_RETRIES - 1} for pair ${pair.pair_id}`)
    }

    const t0 = Date.now()
    try {
      const raw = await runCodexExec(fullPrompt)
      const verdict = extractVerdictJSON(raw)
      return { verdict, latencyMs: Date.now() - t0 }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`  judge call failed (attempt ${attempt + 1}): ${lastError.message}`)
    }
  }

  throw lastError ?? new Error(`judgeWithRetry exhausted ${MAX_RETRIES} attempts`)
}

// ── DB persistence ────────────────────────────────────────────────────────────

async function persistJudgment(
  record: JudgmentRecord,
  experimentId: number,
  setName: string
): Promise<void> {
  const actualLabelJson = {
    winner: record.judge_winner_position,
    reasoning: record.reasoning,
    shuffled_a_label: record.shuffled_a_label,
    shuffled_b_label: record.shuffled_b_label
  }

  await db`
    INSERT INTO eval_results (
      experiment_id,
      set_name,
      beat_id,
      adapter_uri,
      cell_label,
      actual_label_json,
      latency_ms,
      error_text
    ) VALUES (
      ${experimentId},
      ${setName},
      ${record.pair_id},
      ${ADAPTER_URI},
      ${record.winner_arm_label},
      ${JSON.stringify(actualLabelJson)},
      ${record.latency_ms},
      ${record.error ?? null}
    )
  `
}

// ── Summary stats ─────────────────────────────────────────────────────────────

function computeSummary(records: JudgmentRecord[]): Record<string, number | string> {
  const total = records.length
  const errors = records.filter((r) => r.error).length
  const judged = total - errors

  const counts: Record<string, number> = {}
  for (const r of records) {
    if (!r.error) {
      counts[r.winner_arm_label] = (counts[r.winner_arm_label] ?? 0) + 1
    }
  }

  const pcts: Record<string, string> = {}
  for (const [label, n] of Object.entries(counts)) {
    pcts[`${label}_pct`] = judged > 0 ? `${((n / judged) * 100).toFixed(1)}%` : "n/a"
  }

  return { total, judged, errors, ...counts, ...pcts }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs()

  console.log(`Reading pairs from ${args.pairsPath}`)
  console.log(`Set name: ${args.setName}`)
  const pairs = await readJsonLines<PairRow>(args.pairsPath)
  console.log(`Loaded ${pairs.length} pairs`)

  // Judge one pair — used by both sequential and concurrent paths.
  async function judgeOne(pair: PairRow): Promise<JudgmentRecord> {
    // Short-circuit resolution for loss/error rows — enforces charter §7 at
    // score time before any Codex call. Closes Codex round-5 blocker #3.
    const shortCircuit = resolveLossShortCircuit(pair)
    if (shortCircuit !== null) {
      const { winner_arm_label, reason } = shortCircuit
      console.log(`Short-circuit ${pair.pair_id}: ${winner_arm_label} — ${reason}`)
      return {
        pair_id: pair.pair_id,
        shuffled_a_label: pair.arm_a_label,
        shuffled_b_label: pair.arm_b_label,
        judge_winner_position: "tie",
        winner_arm_label,
        reasoning: reason,
        latency_ms: 0,
      }
    }

    console.log(`Judging pair ${pair.pair_id} …`)
    const { prose_a, prose_b, shuffled_a_label, shuffled_b_label } = shufflePair(pair, args.seed)

    try {
      const { verdict, latencyMs } = await judgeWithRetry(pair, prose_a, prose_b)
      const winner = unshuffleVerdict(verdict.winner, shuffled_a_label, shuffled_b_label)
      console.log(`  → ${pair.pair_id}: winner=${winner} (judge said ${verdict.winner}) — ${verdict.reasoning.slice(0, 80)}`)
      return {
        pair_id: pair.pair_id,
        shuffled_a_label,
        shuffled_b_label,
        judge_winner_position: verdict.winner,
        winner_arm_label: winner,
        reasoning: verdict.reasoning,
        latency_ms: latencyMs,
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      console.error(`  error on pair ${pair.pair_id}: ${errorText}`)
      return {
        pair_id: pair.pair_id,
        shuffled_a_label,
        shuffled_b_label,
        judge_winner_position: "tie",
        winner_arm_label: "error",
        reasoning: "",
        latency_ms: 0,
        error: errorText,
      }
    }
  }

  // Concurrency-limited worker pool. Each worker takes the next available
  // pair index from a shared counter and processes it. Safe because pairs
  // don't share state. Persistence happens per-pair (independent INSERTs).
  // Added to shorten wall clock: high-effort gpt-5.4 judge calls are ~5min
  // each, so a sequential 20-pair run is ~1.5 hrs. At concurrency=5 it's ~20 min.
  const records: JudgmentRecord[] = new Array(pairs.length)
  let nextIdx = 0
  console.log(`[judge] concurrency=${args.concurrency}, pairs=${pairs.length}`)
  const worker = async (): Promise<void> => {
    while (true) {
      const myIdx = nextIdx++
      if (myIdx >= pairs.length) return
      const pair = pairs[myIdx]
      const record = await judgeOne(pair)
      records[myIdx] = record
      await persistJudgment(record, args.experimentId, args.setName)
    }
  }
  await Promise.all(Array.from({ length: args.concurrency }, () => worker()))

  const summary = computeSummary(records)

  console.log("\n── Summary ──────────────────────────────────────────")
  for (const [key, val] of Object.entries(summary)) {
    console.log(`  ${key}: ${val}`)
  }

  const output = {
    set_name: args.setName,
    experiment_id: args.experimentId,
    seed: args.seed,
    generated_at: new Date().toISOString(),
    pairs_path: args.pairsPath,
    summary,
    judgments: records
  }

  await mkdir(path.dirname(args.out), { recursive: true })
  await writeFile(args.out, JSON.stringify(output, null, 2) + "\n", "utf8")
  console.log(`\nWrote ${args.out}`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
