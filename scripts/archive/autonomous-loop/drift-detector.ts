/**
 * Calibration-substrate drift detector — Phase 0 prerequisite #2.
 *
 * Replays checker adapters over frozen eval_results baselines and opens
 * Sub-loop 3 when any adapter drops >5pt precision OR >3pt F1.
 *
 * USAGE
 *   bun scripts/autonomous-loop/drift-detector.ts
 *   bun scripts/autonomous-loop/drift-detector.ts \
 *     --adapters halluc-ungrounded-v2,halluc-leak-salvatore-v1
 *   bun scripts/autonomous-loop/drift-detector.ts \
 *     --adapters adherence-checker-v4 --frozen-run-id 161
 *
 * OPTIONS
 *   --adapters   Comma-separated short names (default: all three checker adapters)
 *   --frozen-run-id  experiment_id whose eval_results rows are the frozen baseline.
 *                    If omitted, the detector uses the most recent experiment_id per
 *                    adapter from eval_results.
 *   --dry-run    Print verdicts to stdout; do NOT write to drift_checks table.
 *   --json       Output a JSON array of verdict objects instead of prose.
 *
 * SKELETON STATUS (Phase 0, 2026-04-23)
 *   - DB reads (eval_results baseline, eval_briefs) — IMPLEMENTED
 *   - Delta math + gate logic — IMPLEMENTED
 *   - drift_checks write — IMPLEMENTED
 *   - Replay inference call (live adapter invocation) — STUBBED (TODO #1)
 *     Blocked on prereq #1 (env→DB config migration). The stub returns null
 *     for current metrics and populates error_text so the row is still written.
 *
 * TODO #1 — Live replay inference
 *   When prereq #1 ships, replace `replayAdapter()` below with:
 *     1. Load eval_briefs for the frozen set via `loadFrozenBriefs()`.
 *     2. For each brief, call the checker adapter via `src/transport.ts`
 *        (use `callAgent()` with the adapter's canonical agent name and the
 *        brief as input context). The adapter URI lives in adapter_registry.uri.
 *     3. Compare actual_label_json vs expected_label_json from eval_briefs
 *        (ground truth is stored per-brief in eval_results.expected_label_json
 *        from the frozen run).
 *     4. Compute TP/FP/FN/TN across all briefs → precision/recall/F1.
 *     5. Return `{ precision, recall, f1, briefCount }`.
 *   Cost note: ~$0.02 per full replay run (3 adapters × ~50 briefs each)
 *   based on adherence-checker-v4 call shape (~1.5K in / ~200 out tokens at
 *   $0.05/$0.22 per 1M via W&B Inference). Use `assertNotKilled()` between
 *   each brief to respect the kill-switch.
 *
 * TODO #2 — Sub-loop 3 trigger
 *   When the autonomous loop driver (`driver.ts`) is wired, replace the
 *   console.warn() in `emitVerdict()` with an actual Sub-loop 3 dispatch.
 *   Contract: the driver reads drift_checks WHERE trips_gate = TRUE AND
 *   ran_at > now() - interval '24h' at the start of each iteration.
 */

import db from "../../../src/db/connection"
import { assertNotKilled } from "./kill-switch"
import { randomUUID } from "node:crypto"

// ── Gate thresholds ────────────────────────────────────────────────────────

const PRECISION_GATE_DROP = 0.05   // >5pt precision regression trips the gate
const F1_GATE_DROP        = 0.03   // >3pt F1 regression trips the gate

// ── Default adapter set (Phase 0 checkers) ────────────────────────────────

const DEFAULT_ADAPTERS = [
  "halluc-ungrounded-v2",
  "halluc-leak-salvatore-v1",
  "adherence-checker-v4",
]

// ── Types ─────────────────────────────────────────────────────────────────

export interface AdapterMetrics {
  precision: number
  recall:    number
  f1:        number
  briefCount: number
}

export interface DriftVerdict {
  adapter:           string
  frozenRunId:       number | null
  frozenPrecision:   number | null
  frozenRecall:      number | null
  frozenF1:          number | null
  currentPrecision:  number | null
  currentRecall:     number | null
  currentF1:         number | null
  precisionDelta:    number | null
  recallDelta:       number | null
  f1Delta:           number | null
  tripsGate:         boolean
  gateReason:        string
  briefCount:        number | null
  errorText:         string | null
}

// ── DB helpers ────────────────────────────────────────────────────────────

/**
 * Load frozen baseline metrics for an adapter from eval_results.
 *
 * Uses aggregate TP/FP/FN counts derived from the `correct` column added in
 * sql/026_checker_eval_columns.sql. The frozen_run_id pins the experiment_id
 * whose rows are the baseline.
 *
 * If no rows exist for this adapter/experiment, returns null (will cause a
 * stub-only run with error_text populated).
 */
async function loadFrozenBaseline(
  adapterName: string,
  frozenRunId: number | null,
): Promise<{ precision: number; recall: number; f1: number; briefCount: number; experimentId: number } | null> {
  // Resolve adapter URI from adapter_registry by name
  const registryRows = await db`
    SELECT uri FROM adapter_registry WHERE name = ${adapterName} LIMIT 1
  ` as any[]

  if (!registryRows.length) {
    console.warn(`[drift-detector] adapter not in registry: ${adapterName}`)
    return null
  }
  const adapterUri = registryRows[0].uri

  // If no frozenRunId given, use the most recent experiment_id for this adapter
  let resolvedRunId = frozenRunId
  if (resolvedRunId === null) {
    const latestRows = await db`
      SELECT experiment_id
      FROM eval_results
      WHERE adapter_uri = ${adapterUri}
        AND correct IS NOT NULL
      ORDER BY experiment_id DESC
      LIMIT 1
    ` as any[]
    if (!latestRows.length) {
      console.warn(`[drift-detector] no eval_results with correct column for: ${adapterName}`)
      return null
    }
    resolvedRunId = latestRows[0].experiment_id as number
  }

  // Pull TP / FP / FN from the frozen rows.
  // correct=TRUE + expected pass → TP (checker correctly passes a good beat)
  // correct=FALSE + expected fail → FN (checker missed a bad beat)
  // correct=FALSE + expected pass → FP (checker fired on a good beat)
  // We derive expected outcome from expected_label_json->>'pass' === 'true'.
  const aggRows = await db`
    SELECT
      COUNT(*)                                                     AS total,
      COUNT(*) FILTER (
        WHERE correct = TRUE
          AND (expected_label_json->>'pass')::boolean = FALSE
      )                                                            AS tp,
      COUNT(*) FILTER (
        WHERE correct = FALSE
          AND (expected_label_json->>'pass')::boolean = FALSE
      )                                                            AS fn_count,
      COUNT(*) FILTER (
        WHERE correct = FALSE
          AND (expected_label_json->>'pass')::boolean = TRUE
      )                                                            AS fp
    FROM eval_results
    WHERE adapter_uri     = ${adapterUri}
      AND experiment_id   = ${resolvedRunId}
      AND correct IS NOT NULL
      AND expected_label_json IS NOT NULL
  ` as any[]

  const agg = aggRows[0]
  const tp  = Number(agg.tp)
  const fn_ = Number(agg.fn_count)
  const fp  = Number(agg.fp)
  const n   = Number(agg.total)

  if (n === 0) {
    console.warn(`[drift-detector] no labeled rows for ${adapterName} experiment_id=${resolvedRunId}`)
    return null
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall    = tp + fn_ > 0 ? tp / (tp + fn_) : 0
  const f1        = precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0

  return { precision, recall, f1, briefCount: n, experimentId: resolvedRunId }
}

/**
 * Load the eval_briefs rows for the frozen baseline's set_name.
 * Used by the live replay path (TODO #1).
 */
export async function loadFrozenBriefs(
  adapterName: string,
  frozenRunId: number,
): Promise<Array<{ beatId: string; briefJson: any; expectedLabelJson: any }>> {
  const registryRows = await db`
    SELECT uri FROM adapter_registry WHERE name = ${adapterName} LIMIT 1
  ` as any[]
  if (!registryRows.length) return []
  const adapterUri = registryRows[0].uri

  const rows = await db`
    SELECT
      er.beat_id,
      eb.brief_json,
      er.expected_label_json
    FROM eval_results er
    JOIN eval_briefs   eb ON eb.set_name = er.set_name AND eb.beat_id = er.beat_id
    WHERE er.adapter_uri   = ${adapterUri}
      AND er.experiment_id = ${frozenRunId}
      AND er.expected_label_json IS NOT NULL
  ` as any[]

  return rows.map((r: any) => ({
    beatId:            r.beat_id,
    briefJson:         typeof r.brief_json === "string" ? JSON.parse(r.brief_json) : r.brief_json,
    expectedLabelJson: typeof r.expected_label_json === "string"
      ? JSON.parse(r.expected_label_json)
      : r.expected_label_json,
  }))
}

// ── Replay stub ───────────────────────────────────────────────────────────

/**
 * Run live inference against frozen briefs and compute current metrics.
 *
 * STUB — returns null until prereq #1 (env→DB config migration) ships.
 * See TODO #1 in the file header for the full implementation contract.
 *
 * When implemented, this function:
 *   1. Calls each brief through the checker adapter via src/transport.ts
 *   2. Compares actual vs expected label
 *   3. Returns aggregate precision/recall/F1
 */
async function replayAdapter(
  _adapterName: string,
  _briefs: Array<{ beatId: string; briefJson: any; expectedLabelJson: any }>,
): Promise<AdapterMetrics | null> {
  // TODO #1: implement live replay once prereq #1 ships.
  // Stub: signal that current metrics are not yet available.
  return null
}

// ── Gate logic ────────────────────────────────────────────────────────────

function computeGate(
  frozenPrecision: number | null,
  frozenF1:        number | null,
  currentPrecision: number | null,
  currentF1:        number | null,
): { tripsGate: boolean; gateReason: string } {
  if (currentPrecision === null || currentF1 === null) {
    return { tripsGate: false, gateReason: "current metrics unavailable (replay stub active)" }
  }
  if (frozenPrecision === null || frozenF1 === null) {
    return { tripsGate: false, gateReason: "frozen baseline unavailable" }
  }

  const precisionDrop = frozenPrecision - currentPrecision
  const f1Drop        = frozenF1 - currentF1

  const reasons: string[] = []
  if (precisionDrop > PRECISION_GATE_DROP) {
    reasons.push(`precision dropped ${(precisionDrop * 100).toFixed(1)}pt (threshold: >${PRECISION_GATE_DROP * 100}pt)`)
  }
  if (f1Drop > F1_GATE_DROP) {
    reasons.push(`F1 dropped ${(f1Drop * 100).toFixed(1)}pt (threshold: >${F1_GATE_DROP * 100}pt)`)
  }

  if (reasons.length) {
    return { tripsGate: true, gateReason: reasons.join("; ") }
  }
  return { tripsGate: false, gateReason: "within threshold" }
}

// ── Write result to DB ────────────────────────────────────────────────────

async function writeVerdictToDB(
  runId: string,
  verdict: DriftVerdict,
): Promise<void> {
  await db`
    INSERT INTO drift_checks (
      run_id,
      adapter,
      frozen_run_id,
      frozen_precision,
      frozen_recall,
      frozen_f1,
      current_precision,
      current_recall,
      current_f1,
      precision_delta,
      recall_delta,
      f1_delta,
      trips_gate,
      gate_reason,
      brief_count,
      error_text
    ) VALUES (
      ${runId},
      ${verdict.adapter},
      ${verdict.frozenRunId},
      ${verdict.frozenPrecision},
      ${verdict.frozenRecall},
      ${verdict.frozenF1},
      ${verdict.currentPrecision},
      ${verdict.currentRecall},
      ${verdict.currentF1},
      ${verdict.precisionDelta},
      ${verdict.recallDelta},
      ${verdict.f1Delta},
      ${verdict.tripsGate},
      ${verdict.gateReason},
      ${verdict.briefCount},
      ${verdict.errorText}
    )
  `
}

// ── Per-adapter orchestration ─────────────────────────────────────────────

async function runAdapterCheck(
  adapterName: string,
  frozenRunId: number | null,
): Promise<DriftVerdict> {
  await assertNotKilled()

  let errorText: string | null = null

  // 1. Load frozen baseline
  const frozen = await loadFrozenBaseline(adapterName, frozenRunId).catch((err) => {
    errorText = `frozen-baseline error: ${err.message}`
    return null
  })

  // 2. Load briefs for replay
  const briefs = frozen
    ? await loadFrozenBriefs(adapterName, frozen.experimentId).catch((err) => {
        errorText = `briefs-load error: ${err.message}`
        return []
      })
    : []

  await assertNotKilled()

  // 3. Run live replay (stub returns null until prereq #1 ships)
  const current = briefs.length
    ? await replayAdapter(adapterName, briefs).catch((err) => {
        errorText = `replay error: ${err.message}`
        return null
      })
    : null

  // 4. Compute deltas
  const frozenPrecision  = frozen?.precision  ?? null
  const frozenRecall     = frozen?.recall     ?? null
  const frozenF1         = frozen?.f1         ?? null
  const currentPrecision = current?.precision ?? null
  const currentRecall    = current?.recall    ?? null
  const currentF1        = current?.f1        ?? null

  const precisionDelta =
    frozenPrecision !== null && currentPrecision !== null
      ? currentPrecision - frozenPrecision
      : null
  const recallDelta =
    frozenRecall !== null && currentRecall !== null
      ? currentRecall - frozenRecall
      : null
  const f1Delta =
    frozenF1 !== null && currentF1 !== null
      ? currentF1 - frozenF1
      : null

  // 5. Gate check
  const { tripsGate, gateReason } = computeGate(
    frozenPrecision, frozenF1, currentPrecision, currentF1,
  )

  return {
    adapter:          adapterName,
    frozenRunId:      frozen?.experimentId ?? null,
    frozenPrecision,
    frozenRecall,
    frozenF1,
    currentPrecision,
    currentRecall,
    currentF1,
    precisionDelta,
    recallDelta,
    f1Delta,
    tripsGate,
    gateReason,
    briefCount:  frozen?.briefCount ?? current?.briefCount ?? null,
    errorText,
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)

  // Parse --adapters
  const adaptersArg = args.find((a) => a.startsWith("--adapters="))
    ?? (args.includes("--adapters") ? `--adapters=${args[args.indexOf("--adapters") + 1]}` : null)
  const adapterNames: string[] = adaptersArg
    ? adaptersArg.replace("--adapters=", "").split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ADAPTERS

  // Parse --frozen-run-id
  const frozenArg = args.find((a) => a.startsWith("--frozen-run-id="))
    ?? (args.includes("--frozen-run-id") ? `--frozen-run-id=${args[args.indexOf("--frozen-run-id") + 1]}` : null)
  const frozenRunId: number | null = frozenArg
    ? parseInt(frozenArg.replace("--frozen-run-id=", ""), 10)
    : null

  const dryRun  = args.includes("--dry-run")
  const jsonOut = args.includes("--json")

  const runId = randomUUID()

  if (!jsonOut) {
    console.log(`[drift-detector] run_id=${runId}`)
    console.log(`[drift-detector] adapters=${adapterNames.join(", ")}`)
    console.log(`[drift-detector] frozen_run_id=${frozenRunId ?? "(auto-resolve per adapter)"}`)
    console.log(`[drift-detector] dry_run=${dryRun}`)
    console.log()
  }

  const verdicts: DriftVerdict[] = []

  for (const name of adapterNames) {
    if (!jsonOut) console.log(`[drift-detector] checking ${name}…`)

    const verdict = await runAdapterCheck(name, frozenRunId).catch((err) => {
      const errVerdict: DriftVerdict = {
        adapter:          name,
        frozenRunId:      null,
        frozenPrecision:  null,
        frozenRecall:     null,
        frozenF1:         null,
        currentPrecision: null,
        currentRecall:    null,
        currentF1:        null,
        precisionDelta:   null,
        recallDelta:      null,
        f1Delta:          null,
        tripsGate:        false,
        gateReason:       `uncaught error: ${err.message}`,
        briefCount:       null,
        errorText:        err.message,
      }
      return errVerdict
    })

    verdicts.push(verdict)

    if (!dryRun) {
      await writeVerdictToDB(runId, verdict).catch((err) => {
        console.error(`[drift-detector] DB write failed for ${name}: ${err.message}`)
      })
    }

    if (!jsonOut) {
      const p = (v: number | null) => v !== null ? (v * 100).toFixed(1) + "%" : "n/a"
      const d = (v: number | null) => v !== null ? (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "pt" : "n/a"
      console.log(`  adapter:           ${verdict.adapter}`)
      console.log(`  frozen_run_id:     ${verdict.frozenRunId ?? "n/a"}`)
      console.log(`  frozen  P/R/F1:    ${p(verdict.frozenPrecision)} / ${p(verdict.frozenRecall)} / ${p(verdict.frozenF1)}`)
      console.log(`  current P/R/F1:    ${p(verdict.currentPrecision)} / ${p(verdict.currentRecall)} / ${p(verdict.currentF1)}`)
      console.log(`  deltas  P/R/F1:    ${d(verdict.precisionDelta)} / ${d(verdict.recallDelta)} / ${d(verdict.f1Delta)}`)
      console.log(`  trips_gate:        ${verdict.tripsGate}`)
      console.log(`  gate_reason:       ${verdict.gateReason}`)
      if (verdict.errorText) console.log(`  error_text:        ${verdict.errorText}`)
      console.log()

      if (verdict.tripsGate) {
        // TODO #2: trigger Sub-loop 3 dispatch via driver.ts
        console.warn(`  ⚠  GATE TRIPPED for ${verdict.adapter} — Sub-loop 3 should be opened.`)
        console.warn(`     (Sub-loop 3 dispatch not yet wired; check drift_checks table manually.)`)
      }
    }
  }

  if (jsonOut) {
    process.stdout.write(JSON.stringify(verdicts, null, 2) + "\n")
  }

  const gateCount = verdicts.filter((v) => v.tripsGate).length
  if (!jsonOut) {
    console.log(`[drift-detector] complete. ${gateCount}/${verdicts.length} adapters tripped the gate.`)
    if (!dryRun) {
      console.log(`[drift-detector] results written to drift_checks (run_id=${runId}).`)
    }
  }

  // Exit non-zero if any gate tripped — useful for CI / autonomous loop driver
  if (gateCount > 0) process.exit(1)
}

main().catch((err) => {
  console.error("[drift-detector] fatal:", err)
  process.exit(2)
})
