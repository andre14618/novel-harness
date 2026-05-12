/**
 * phase-eval results browser.
 *
 * Default mode: per-probe-family rollup. Groups rows by
 * (probe_name, test_variant, git_commit, seed) and shows aggregate
 * columns: N, PASS, FAIL, consecutive-PASS streak, facts_median range,
 * know_median range, total_scenes range, parse_fails total.
 *
 * Family key format: "<probe>:<variant>:<commit8>:<seed>"
 *
 * Usage:
 *   bun scripts/phase-eval/list-runs.ts
 *     [--family <probe>:<variant>:<commit>:<seed>]  drill into one family
 *     [--probe <name>]        filter rollup by probe_name
 *     [--variant <name>]      filter rollup by test_variant membership
 *     [--limit <n>]           max families to show in rollup (default 20)
 *     [--rows]                legacy per-row table (original behavior)
 *     [--full]                legacy: print full JSON per row
 *
 * Designed per docs/todo.md §9 backlog — see docs/decisions.md L13 entry.
 */

import db from "../../src/db/connection"

// ── Types ────────────────────────────────────────────────────────────────

interface Args {
  family?: string
  probe?: string
  variant?: string
  limit: number
  rows: boolean
  full: boolean
}

interface RawRow {
  id: number
  probe_name: string
  git_commit: string
  experiment_id: number | null
  seeds_used: string[]
  variant_labels: string[]
  verdict: string
  ran_at: Date
  notes: string | null
  g_metrics: Record<string, any> | null
  recall_pct: number | null
  precision_pct: number | null
  f1: number | null
  calibration_matrix: { TP?: number; FP?: number; FN?: number; TN?: number } | null
  // Checker-calibration shapes (top-level summary_json keys persisted by
  // scripts/hallucination/run-synthetic-checkers.ts and
  // scripts/hallucination/probe-obligation-aware-adherence.ts).
  halluc_calibration: { TP?: number; FP?: number; FN?: number; TN?: number } | null
  adherence_calibration: { TP?: number; FP?: number; FN?: number; TN?: number } | null
  halluc_recall_pct: number | null
  adherence_recall_pct: number | null
  binary_calibration: { TP?: number; FP?: number; FN?: number; TN?: number } | null
  binary_match_pct: number | null
  per_event_recall_pct: number | null
  per_event_precision_pct: number | null
  // Extended family-key dimensions (L53). Top-level summary_json keys
  // persisted by print-screen-verdict.ts (--persist) augmented summary.
  // Older rows lack these and degrade to the legacy 4-part family key.
  metric_set: string | null
  expected_chapters: number | null
  model_route: string | null
  prompt_hash: string | null
}

interface FamilyKey {
  probe_name: string
  test_variant: string
  git_commit: string
  seed: string
  // Extended dimensions (L53). All optional for backward compat: when every
  // extended field is "—" or absent, familyKeyStr emits the legacy 4-part
  // form so older rows continue to group identically and existing --family
  // lookups keep working.
  metric_set?: string
  chapter_count?: string
  prompt_hash?: string
  model_route?: string
}

const EXTENDED_DIM_DEFAULT = "—"

interface FamilyStats {
  key: FamilyKey
  keyStr: string
  rows: RawRow[]
  n: number
  passCount: number
  failCount: number
  streak: number        // consecutive PASS from latest backwards; negative = consecutive FAIL
  factsRange: [number, number] | null
  knowRange: [number, number] | null
  scenesRange: [number, number] | null
  parseFails: number
  latestRanAt: Date
}

// ── Arg parsing ───────────────────────────────────────────────────────────

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const map: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const m = arg.match(/^--([^=]+)=(.*)$/)
    if (m) {
      map[m[1]!] = m[2]!
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2)
      // next arg is value if it doesn't start with "--"
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith("--")) {
        map[key] = next
        i++
      } else {
        map[key] = true
      }
    }
  }

  const limitRaw = map["limit"]
  const limit = limitRaw && typeof limitRaw === "string" ? Number(limitRaw) : 20
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(`--limit must be a positive integer, got: ${limitRaw}`)
    process.exit(2)
  }

  return {
    family: typeof map["family"] === "string" ? map["family"] : undefined,
    probe: typeof map["probe"] === "string" ? map["probe"] : undefined,
    variant: typeof map["variant"] === "string" ? map["variant"] : undefined,
    limit,
    rows: map["rows"] === true || map["rows"] === "true",
    full: map["full"] === true || map["full"] === "true",
  }
}

// ── Checker-probe classification ──────────────────────────────────────────

/**
 * Probes that persist checker-calibration summaries (top-level halluc/
 * adherence calibration matrices + recall/precision percentages) instead
 * of the planning-shape g_metrics block. Listed exhaustively so the
 * rollup can pick the right columns and skip SCREEN-PASS/FAIL counting,
 * which doesn't apply to these verdicts.
 */
const CHECKER_PROBE_NAMES = new Set([
  "halluc-synthetic-fire-rate",
  "adherence-per-event-prototype",
])

export function isCheckerProbe(probeName: string): boolean {
  return CHECKER_PROBE_NAMES.has(probeName)
}

export type CheckerShape = "halluc-synthetic" | "adherence-per-event"

export interface CheckerSummary {
  shape: CheckerShape
  hallucCalibration: { TP: number; FP: number; FN: number; TN: number } | null
  adherenceCalibration: { TP: number; FP: number; FN: number; TN: number } | null
  hallucRecallPct: number | null
  adherenceRecallPct: number | null
  binaryCalibration: { TP: number; FP: number; FN: number; TN: number } | null
  binaryMatchPct: number | null
  perEventRecallPct: number | null
  perEventPrecisionPct: number | null
}

function calibrationOrNull(m: any): { TP: number; FP: number; FN: number; TN: number } | null {
  if (!m || typeof m !== "object") return null
  return {
    TP: typeof m.TP === "number" ? m.TP : 0,
    FP: typeof m.FP === "number" ? m.FP : 0,
    FN: typeof m.FN === "number" ? m.FN : 0,
    TN: typeof m.TN === "number" ? m.TN : 0,
  }
}

function numberOrNull(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

export function extractCheckerSummary(row: RawRow): CheckerSummary | null {
  if (!isCheckerProbe(row.probe_name)) return null
  if (row.probe_name === "halluc-synthetic-fire-rate") {
    return {
      shape: "halluc-synthetic",
      hallucCalibration: calibrationOrNull(row.halluc_calibration),
      adherenceCalibration: calibrationOrNull(row.adherence_calibration),
      hallucRecallPct: numberOrNull(row.halluc_recall_pct),
      adherenceRecallPct: numberOrNull(row.adherence_recall_pct),
      binaryCalibration: null,
      binaryMatchPct: null,
      perEventRecallPct: null,
      perEventPrecisionPct: null,
    }
  }
  // adherence-per-event-prototype
  return {
    shape: "adherence-per-event",
    hallucCalibration: null,
    adherenceCalibration: null,
    hallucRecallPct: null,
    adherenceRecallPct: null,
    binaryCalibration: calibrationOrNull(row.binary_calibration),
    binaryMatchPct: numberOrNull(row.binary_match_pct),
    perEventRecallPct: numberOrNull(row.per_event_recall_pct),
    perEventPrecisionPct: numberOrNull(row.per_event_precision_pct),
  }
}

// ── Verdict classification ────────────────────────────────────────────────

/**
 * Returns true for any pass-class verdict:
 * - "SCREEN-PASS" (legacy bare form)
 * - "SCREEN-PASS-SUGGESTIVE ..."
 * - "PROMOTION-PASS ..."
 */
export function isPassVerdict(verdict: string): boolean {
  const v = verdict.trim()
  return v.startsWith("SCREEN-PASS") || v.startsWith("PROMOTION-PASS")
}

/**
 * Returns a short verdict label for display (first token before the first " — ").
 */
export function shortVerdict(verdict: string): string {
  return verdict.split(" — ")[0]!.trim()
}

// ── Metric extraction from summary_json g_metrics ────────────────────────

/**
 * Defensively extract a number from g_metrics.
 * Keys vary between probe shapes:
 *   planning-scenes: test_facts_median, test_know_median, test_total_scenes
 *   state-mapper: same keys (prefixed test_)
 * Returns null when key absent or non-numeric.
 */
export function extractMetric(gMetrics: Record<string, any> | null, key: string): number | null {
  if (!gMetrics) return null
  const v = gMetrics[key]
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function extractSceneMetric(gMetrics: Record<string, any> | null): number | null {
  return extractMetric(gMetrics, "test_total_scenes") ?? extractMetric(gMetrics, "test_total_beats")
}

/**
 * Count parse failures from a g_metrics block.
 * The block doesn't store parse_failures directly — a SCREEN-FAIL (broken)
 * verdict indicates parse failure. Returns 1 if the row's verdict is
 * SCREEN-FAIL (broken), 0 otherwise.
 */
export function countParseFails(row: RawRow): number {
  return row.verdict.includes("SCREEN-FAIL (broken)") ? 1 : 0
}

/**
 * Extract the prompt_hash from summary_json if available.
 * Stored as g_metrics.prompt_hash or top-level in summary_json (varies).
 * Returns "—" if not found.
 */
export function extractPromptHash(gMetrics: Record<string, any> | null): string {
  if (!gMetrics) return "—"
  const h = gMetrics["prompt_hash"] ?? gMetrics["promptHash"]
  if (typeof h === "string" && h.length > 0) return h.slice(0, 8)
  return "—"
}

// ── Family key computation ────────────────────────────────────────────────

/**
 * Derive the probe-family key from a raw row.
 *
 * probe_name: the probe_name column.
 * test_variant: the non-"default" entry in variant_labels, if any; otherwise
 *   variant_labels[1] if present, else variant_labels[0]. This heuristic
 *   mirrors how print-screen-verdict.ts stores variants — [control, test].
 * git_commit: the git_commit column.
 * seed: seeds_used[0] for single-seed probes (the standard probe shape).
 *
 * For multi-seed rows (multiple seeds_used), seed is joined as
 * "seed1+seed2+..." so they form their own family.
 *
 * Extended dimensions (L53) are derived from summary_json top-level keys
 * persisted by print-screen-verdict.ts:
 * - metric_set: "planning-scenes" | "state-mapper" (charter §G branch)
 * - chapter_count: expected_chapters (5 by default; varies per seed)
 * - prompt_hash: g_metrics.prompt_hash or summary_json.prompt_hash, if any
 * - model_route: g_metrics.model_route or summary_json.model_route, if any
 *
 * Older rows that predate the producer-side persistence of these fields
 * resolve to EXTENDED_DIM_DEFAULT and the family key collapses to the
 * legacy 4-part form via familyKeyStr.
 */
export function familyKeyFor(row: RawRow): FamilyKey {
  const variants = row.variant_labels as string[]
  // The "test" variant is the non-default entry. For a [control, test] pair,
  // pick the last entry that isn't "default". If all are "default" (e.g. a
  // multi-seed default-arm probe), fall back to joining them all.
  let testVariant: string
  const nonDefault = variants.filter(v => v !== "default")
  if (nonDefault.length > 0) {
    testVariant = nonDefault[nonDefault.length - 1]!
  } else if (variants.length > 0) {
    testVariant = variants.join("+")
  } else {
    testVariant = "unknown"
  }

  const seeds = row.seeds_used as string[]
  const seed = seeds.length === 1 ? seeds[0]! : seeds.join("+")

  return {
    probe_name: row.probe_name,
    test_variant: testVariant,
    git_commit: row.git_commit,
    seed,
    metric_set: extractExtendedDim(row, "metric_set"),
    chapter_count: extractChapterCount(row),
    prompt_hash: extractExtendedDim(row, "prompt_hash"),
    model_route: extractExtendedDim(row, "model_route"),
  }
}

/**
 * Read an extended dim from a row's top-level column first, then fall back
 * to the matching g_metrics key. Defaults to EXTENDED_DIM_DEFAULT when
 * absent so legacy rows still group as a single family.
 */
function extractExtendedDim(row: RawRow, key: "metric_set" | "prompt_hash" | "model_route"): string {
  const direct = (row as any)[key]
  if (typeof direct === "string" && direct.length > 0) {
    // For prompt_hash: short to 8 chars for stable, comparable display.
    return key === "prompt_hash" ? direct.slice(0, 8) : direct
  }
  const fromG = row.g_metrics?.[key] ?? row.g_metrics?.[camelCase(key)]
  if (typeof fromG === "string" && fromG.length > 0) {
    return key === "prompt_hash" ? fromG.slice(0, 8) : fromG
  }
  return EXTENDED_DIM_DEFAULT
}

function extractChapterCount(row: RawRow): string {
  if (typeof row.expected_chapters === "number" && Number.isFinite(row.expected_chapters)) {
    return String(row.expected_chapters)
  }
  const fromG = row.g_metrics?.["expected_chapters"] ?? row.g_metrics?.["expectedChapters"]
  if (typeof fromG === "number" && Number.isFinite(fromG)) return String(fromG)
  return EXTENDED_DIM_DEFAULT
}

function camelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())
}

/**
 * True iff the key has any non-default extended dim (i.e. came from a row
 * with the L53-augmented summary_json).
 */
function hasExtendedDims(key: FamilyKey): boolean {
  return [key.metric_set, key.chapter_count, key.prompt_hash, key.model_route]
    .some(v => v !== undefined && v !== EXTENDED_DIM_DEFAULT)
}

export function familyKeyStr(key: FamilyKey): string {
  const base = `${key.probe_name}:${key.test_variant}:${key.git_commit.slice(0, 8)}:${key.seed}`
  if (!hasExtendedDims(key)) return base
  // Extended form. Brackets isolate extended dims so commit/seed parsing
  // of the legacy 4-part prefix is unambiguous, and each dim defaults to
  // EXTENDED_DIM_DEFAULT when absent so the suffix is fixed-width.
  const ext = [
    key.metric_set ?? EXTENDED_DIM_DEFAULT,
    key.chapter_count ?? EXTENDED_DIM_DEFAULT,
    key.prompt_hash ?? EXTENDED_DIM_DEFAULT,
    key.model_route ?? EXTENDED_DIM_DEFAULT,
  ].join("|")
  return `${base}[${ext}]`
}

/**
 * Parse a --family <key> string back into components.
 * Legacy format: "<probe>:<variant>:<commit8>:<seed>"
 * Extended form (L53): "<probe>:<variant>:<commit8>:<seed>[<metric>|<chapters>|<prompt8>|<route>]"
 * probe and variant may contain colons (seed never does; commit8 is hex).
 */
export function parseFamilyKey(keyStr: string): Partial<FamilyKey> {
  // Strip and capture optional extended suffix "[a|b|c|d]" first so the
  // legacy parser sees a clean 4-part base.
  let base = keyStr
  let extended: { metric_set?: string; chapter_count?: string; prompt_hash?: string; model_route?: string } = {}
  const extMatch = keyStr.match(/^(.*)\[([^\]]*)\]$/)
  if (extMatch) {
    base = extMatch[1]!
    const parts = extMatch[2]!.split("|")
    if (parts.length === 4) {
      const [metric_set, chapter_count, prompt_hash, model_route] = parts as [string, string, string, string]
      extended = {
        metric_set: metric_set === EXTENDED_DIM_DEFAULT ? undefined : metric_set,
        chapter_count: chapter_count === EXTENDED_DIM_DEFAULT ? undefined : chapter_count,
        prompt_hash: prompt_hash === EXTENDED_DIM_DEFAULT ? undefined : prompt_hash,
        model_route: model_route === EXTENDED_DIM_DEFAULT ? undefined : model_route,
      }
    }
  }

  const parts = base.split(":")
  if (parts.length < 4) return {}
  const seed = parts[parts.length - 1]!
  const commit8 = parts[parts.length - 2]!
  const remaining = parts.slice(0, parts.length - 2).join(":")
  const sepIdx = remaining.indexOf(":")
  if (sepIdx === -1) return {}
  const probe_name = remaining.slice(0, sepIdx)
  const test_variant = remaining.slice(sepIdx + 1)
  return { probe_name, test_variant, git_commit: commit8, seed, ...extended }
}

// ── Consecutive-streak calculation ───────────────────────────────────────

/**
 * Compute the current consecutive-PASS streak starting from the most recent
 * row (index 0 = most recent). Positive = N consecutive passes. If the
 * latest verdict is a FAIL, returns -(number of consecutive fails).
 * Returns 0 for an empty list.
 *
 * Examples:
 *   [PASS, PASS, FAIL] → 2
 *   [FAIL, PASS, PASS] → -1
 *   [PASS, FAIL, PASS, PASS] → 1
 *   [FAIL, FAIL, PASS] → -2
 *   [] → 0
 */
export function consecutiveStreak(verdicts: string[]): number {
  if (verdicts.length === 0) return 0
  const firstIsPass = isPassVerdict(verdicts[0]!)
  let count = 0
  for (const v of verdicts) {
    if (isPassVerdict(v) === firstIsPass) {
      count++
    } else {
      break
    }
  }
  return firstIsPass ? count : -count
}

function formatStreak(streak: number): string {
  if (streak === 0) return "0"
  if (streak > 0) return `${streak}-PASS`
  return `${-streak}-FAIL`
}

// ── Range utilities ───────────────────────────────────────────────────────

export function computeRange(values: (number | null)[]): [number, number] | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (nums.length === 0) return null
  return [Math.min(...nums), Math.max(...nums)]
}

function formatRange(range: [number, number] | null): string {
  if (!range) return "—"
  if (range[0] === range[1]) return String(range[0])
  // Round to 1 decimal if fractional
  const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1)
  return `${fmt(range[0])}-${fmt(range[1])}`
}

// ── Family grouping ───────────────────────────────────────────────────────

export function groupIntoFamilies(rows: RawRow[]): Map<string, FamilyStats> {
  const families = new Map<string, FamilyStats>()

  for (const row of rows) {
    const key = familyKeyFor(row)
    const ks = familyKeyStr(key)
    if (!families.has(ks)) {
      families.set(ks, {
        key,
        keyStr: ks,
        rows: [],
        n: 0,
        passCount: 0,
        failCount: 0,
        streak: 0,
        factsRange: null,
        knowRange: null,
        scenesRange: null,
        parseFails: 0,
        latestRanAt: new Date(0),
      })
    }
    families.get(ks)!.rows.push(row)
  }

  for (const stats of families.values()) {
    // Sort by ran_at desc (most recent first) for streak calculation
    stats.rows.sort((a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime())

    stats.n = stats.rows.length
    stats.passCount = stats.rows.filter(r => isPassVerdict(r.verdict)).length
    stats.failCount = stats.n - stats.passCount
    stats.streak = consecutiveStreak(stats.rows.map(r => r.verdict))
    stats.parseFails = stats.rows.reduce((acc, r) => acc + countParseFails(r), 0)
    stats.latestRanAt = stats.rows[0] ? new Date(stats.rows[0].ran_at) : new Date(0)

    const factsVals = stats.rows.map(r => extractMetric(r.g_metrics, "test_facts_median"))
    const knowVals = stats.rows.map(r => extractMetric(r.g_metrics, "test_know_median"))
    const sceneVals = stats.rows.map(r => extractSceneMetric(r.g_metrics))

    stats.factsRange = computeRange(factsVals)
    stats.knowRange = computeRange(knowVals)
    stats.scenesRange = computeRange(sceneVals)
  }

  return families
}

// ── Rollup display ────────────────────────────────────────────────────────

function printFamilyRollup(families: FamilyStats[], limit: number): void {
  const rows = families
    .sort((a, b) => b.latestRanAt.getTime() - a.latestRanAt.getTime())
    .slice(0, limit)

  if (rows.length === 0) {
    console.log("No phase_eval_runs rows match the filter. Use `print-screen-verdict.ts --persist` to populate.")
    return
  }

  // Column widths (dynamic based on content)
  const COL_KEY = Math.max(12, Math.max(...rows.map(r => r.keyStr.length)))
  const w = (s: string, n: number) => s.padEnd(n)
  const wn = (s: string, n: number) => s.padStart(n)

  const header = [
    w("PROBE_FAMILY", COL_KEY),
    wn("N", 3),
    wn("PASS", 5),
    wn("FAIL", 5),
    wn("STREAK", 8),
    wn("FACTS_MED", 12),
    wn("KNOW_MED", 12),
    wn("SCENES", 12),
    wn("PARSE_FAILS", 11),
  ].join("  ")

  console.log(header)
  console.log("-".repeat(header.length))

  for (const fam of rows) {
    const line = [
      w(fam.keyStr, COL_KEY),
      wn(String(fam.n), 3),
      wn(String(fam.passCount), 5),
      wn(String(fam.failCount), 5),
      wn(formatStreak(fam.streak), 8),
      wn(formatRange(fam.factsRange), 12),
      wn(formatRange(fam.knowRange), 12),
      wn(formatRange(fam.scenesRange), 12),
      wn(String(fam.parseFails), 11),
    ].join("  ")
    console.log(line)
  }

  console.log()
  console.log(`Showing ${rows.length} of ${families.length} probe families (most recent first).`)
  console.log("STREAK = consecutive PASS/FAIL count from latest run backwards.")
  console.log("Use --family <key> to drill into a single family's run history.")
  console.log("Use --rows to see the full per-row table (legacy mode).")
}

// ── Checker-shape rollup display ──────────────────────────────────────────

function fmtPct(n: number | null): string {
  return n === null ? "—" : `${n.toFixed(1)}%`
}

function fmtMatrix(m: { TP?: number; FP?: number; FN?: number; TN?: number } | null): string {
  if (!m) return "—"
  return `TP=${m.TP ?? 0}/FP=${m.FP ?? 0}/FN=${m.FN ?? 0}/TN=${m.TN ?? 0}`
}

function partitionFamiliesByShape(families: FamilyStats[]): {
  hallucSynthetic: FamilyStats[]
  adherencePerEvent: FamilyStats[]
  legacy: FamilyStats[]
} {
  const hallucSynthetic: FamilyStats[] = []
  const adherencePerEvent: FamilyStats[] = []
  const legacy: FamilyStats[] = []
  for (const fam of families) {
    if (fam.key.probe_name === "halluc-synthetic-fire-rate") hallucSynthetic.push(fam)
    else if (fam.key.probe_name === "adherence-per-event-prototype") adherencePerEvent.push(fam)
    else legacy.push(fam)
  }
  return { hallucSynthetic, adherencePerEvent, legacy }
}

function printHallucSyntheticRollup(families: FamilyStats[], limit: number): void {
  const sorted = families
    .sort((a, b) => b.latestRanAt.getTime() - a.latestRanAt.getTime())
    .slice(0, limit)
  if (sorted.length === 0) return

  const COL_KEY = Math.max(12, Math.max(...sorted.map(f => f.keyStr.length)))
  const w = (s: string, n: number) => s.padEnd(n)
  const wn = (s: string, n: number) => s.padStart(n)

  const header = [
    w("HALLUC_SYNTHETIC_FAMILY", COL_KEY),
    wn("N", 3),
    wn("H_RECALL", 9),
    wn("A_RECALL", 9),
    w("HALLUC_MATRIX", 28),
    w("ADHERENCE_MATRIX", 28),
    w("LATEST", 21),
  ].join("  ")

  console.log(header)
  console.log("-".repeat(header.length))

  for (const fam of sorted) {
    const latest = fam.rows[0] as RawRow | undefined
    const summary = latest ? extractCheckerSummary(latest) : null
    const line = [
      w(fam.keyStr, COL_KEY),
      wn(String(fam.n), 3),
      wn(fmtPct(summary?.hallucRecallPct ?? null), 9),
      wn(fmtPct(summary?.adherenceRecallPct ?? null), 9),
      w(fmtMatrix(summary?.hallucCalibration ?? null), 28),
      w(fmtMatrix(summary?.adherenceCalibration ?? null), 28),
      w(fam.latestRanAt.toISOString().slice(0, 19) + "Z", 21),
    ].join("  ")
    console.log(line)
  }
  console.log()
  console.log(`Showing ${sorted.length} of ${families.length} halluc-synthetic-fire-rate families.`)
  console.log("Metrics shown reflect the most recent run in each family. Use --family <key> to see full history.")
}

function printAdherencePerEventRollup(families: FamilyStats[], limit: number): void {
  const sorted = families
    .sort((a, b) => b.latestRanAt.getTime() - a.latestRanAt.getTime())
    .slice(0, limit)
  if (sorted.length === 0) return

  const COL_KEY = Math.max(12, Math.max(...sorted.map(f => f.keyStr.length)))
  const w = (s: string, n: number) => s.padEnd(n)
  const wn = (s: string, n: number) => s.padStart(n)

  const header = [
    w("ADHERENCE_PER_EVENT_FAMILY", COL_KEY),
    wn("N", 3),
    wn("BIN_MATCH", 10),
    wn("PE_RECALL", 10),
    wn("PE_PREC", 9),
    w("BINARY_MATRIX", 28),
    w("LATEST", 21),
  ].join("  ")

  console.log(header)
  console.log("-".repeat(header.length))

  for (const fam of sorted) {
    const latest = fam.rows[0] as RawRow | undefined
    const summary = latest ? extractCheckerSummary(latest) : null
    const line = [
      w(fam.keyStr, COL_KEY),
      wn(String(fam.n), 3),
      wn(fmtPct(summary?.binaryMatchPct ?? null), 10),
      wn(fmtPct(summary?.perEventRecallPct ?? null), 10),
      wn(fmtPct(summary?.perEventPrecisionPct ?? null), 9),
      w(fmtMatrix(summary?.binaryCalibration ?? null), 28),
      w(fam.latestRanAt.toISOString().slice(0, 19) + "Z", 21),
    ].join("  ")
    console.log(line)
  }
  console.log()
  console.log(`Showing ${sorted.length} of ${families.length} adherence-per-event-prototype families.`)
  console.log("Metrics shown reflect the most recent run in each family. Use --family <key> to see full history.")
}

// ── Family drill-down display ─────────────────────────────────────────────

function printFamilyDrillDown(fam: FamilyStats): void {
  console.log(`Family: ${fam.keyStr}`)
  console.log(`  probe=${fam.key.probe_name}  variant=${fam.key.test_variant}`)
  console.log(`  commit=${fam.key.git_commit}  seed=${fam.key.seed}`)
  console.log(`  N=${fam.n}  PASS=${fam.passCount}  FAIL=${fam.failCount}  streak=${formatStreak(fam.streak)}`)
  console.log()

  const header = [
    "RUN_ID".padEnd(7),
    "RAN_AT".padEnd(22),
    "VERDICT".padEnd(28),
    "FACTS_MED".padStart(10),
    "KNOW_MED".padStart(9),
    "SCENES".padStart(7),
    "PARSE_FAIL".padStart(11),
    "PROMPT_HASH".padEnd(12),
  ].join("  ")

  console.log(header)
  console.log("-".repeat(header.length))

  for (const row of fam.rows) {
    const gm = row.g_metrics
    const facts = extractMetric(gm, "test_facts_median")
    const know = extractMetric(gm, "test_know_median")
    const scenes = extractSceneMetric(gm)
    const fmt1 = (v: number | null) => v !== null ? v.toFixed(1) : "—"
    const fmtI = (v: number | null) => v !== null ? String(Math.round(v)) : "—"
    const parseFail = countParseFails(row)
    const hash = extractPromptHash(gm)

    const line = [
      String(row.id).padEnd(7),
      new Date(row.ran_at).toISOString().slice(0, 19) + "Z".padEnd(3),
      shortVerdict(row.verdict).slice(0, 27).padEnd(28),
      fmt1(facts).padStart(10),
      fmt1(know).padStart(9),
      fmtI(scenes).padStart(7),
      String(parseFail).padStart(11),
      hash.padEnd(12),
    ].join("  ")
    console.log(line)
  }

  console.log()
  console.log(`Gate note: 3 consecutive PASS on this tuple = promotion-eligible (per exp #323/L10).`)
}

// ── Legacy per-row table ──────────────────────────────────────────────────

function printRowsTable(rows: RawRow[], full: boolean): void {
  if (full) {
    for (const r of rows) {
      console.log(JSON.stringify(r, null, 2))
      console.log("---")
    }
    return
  }

  console.table(rows.map((r: any) => {
    const matrix = r.calibration_matrix as { TP?: number; FP?: number; FN?: number; TN?: number } | null
    const matrixStr = matrix
      ? `TP=${matrix.TP ?? 0}/FP=${matrix.FP ?? 0}/FN=${matrix.FN ?? 0}/TN=${matrix.TN ?? 0}`
      : "—"
    const rpf = (r.recall_pct !== null && r.precision_pct !== null)
      ? `${r.recall_pct}/${r.precision_pct}/${r.f1 ?? "—"}`
      : "—"
    return {
      id: r.id,
      probe: r.probe_name,
      ran_at: new Date(r.ran_at).toISOString(),
      seeds: (r.seeds_used as string[]).join(","),
      variants: (r.variant_labels as string[]).join(","),
      git: (r.git_commit as string).slice(0, 8),
      exp: r.experiment_id ?? "—",
      verdict: (r.verdict as string).split(" — ")[0],
      "R/P/F1": rpf,
      matrix: matrixStr,
    }
  }))
}

// ── Main ─────────────────────────────────────────────────────────────────

async function fetchRows(args: Args): Promise<RawRow[]> {
  const base = `
    SELECT id, probe_name, git_commit, experiment_id,
           seeds_used, variant_labels, verdict, ran_at, notes,
           summary_json -> 'g_metrics' AS g_metrics,
           summary_json -> 'recall_pct' AS recall_pct,
           summary_json -> 'precision_pct' AS precision_pct,
           summary_json -> 'f1' AS f1,
           summary_json -> 'calibration_matrix' AS calibration_matrix
    FROM phase_eval_runs
  `

  if (args.probe) {
    return db`
      SELECT id, probe_name, git_commit, experiment_id,
             seeds_used, variant_labels, verdict, ran_at, notes,
             summary_json -> 'g_metrics' AS g_metrics,
             summary_json -> 'recall_pct' AS recall_pct,
             summary_json -> 'precision_pct' AS precision_pct,
             summary_json -> 'f1' AS f1,
             summary_json -> 'calibration_matrix' AS calibration_matrix,
             summary_json -> 'halluc_calibration' AS halluc_calibration,
             summary_json -> 'adherence_calibration' AS adherence_calibration,
             summary_json -> 'halluc_recall_pct' AS halluc_recall_pct,
             summary_json -> 'adherence_recall_pct' AS adherence_recall_pct,
             summary_json -> 'binary_calibration' AS binary_calibration,
             summary_json -> 'binary_match_pct' AS binary_match_pct,
             summary_json -> 'per_event_recall_pct' AS per_event_recall_pct,
             summary_json -> 'per_event_precision_pct' AS per_event_precision_pct,
             summary_json ->> 'metric_set' AS metric_set,
             (summary_json ->> 'expected_chapters')::int AS expected_chapters,
             summary_json ->> 'model_route' AS model_route,
             summary_json ->> 'prompt_hash' AS prompt_hash
      FROM phase_eval_runs
      WHERE probe_name = ${args.probe}
      ORDER BY ran_at DESC
      LIMIT ${args.limit * 20}
    ` as Promise<RawRow[]>
  }

  return db`
    SELECT id, probe_name, git_commit, experiment_id,
           seeds_used, variant_labels, verdict, ran_at, notes,
           summary_json -> 'g_metrics' AS g_metrics,
           summary_json -> 'recall_pct' AS recall_pct,
           summary_json -> 'precision_pct' AS precision_pct,
           summary_json -> 'f1' AS f1,
           summary_json -> 'calibration_matrix' AS calibration_matrix,
           summary_json -> 'halluc_calibration' AS halluc_calibration,
           summary_json -> 'adherence_calibration' AS adherence_calibration,
           summary_json -> 'halluc_recall_pct' AS halluc_recall_pct,
           summary_json -> 'adherence_recall_pct' AS adherence_recall_pct,
           summary_json -> 'binary_calibration' AS binary_calibration,
           summary_json -> 'binary_match_pct' AS binary_match_pct,
           summary_json -> 'per_event_recall_pct' AS per_event_recall_pct,
           summary_json -> 'per_event_precision_pct' AS per_event_precision_pct,
           summary_json ->> 'metric_set' AS metric_set,
           (summary_json ->> 'expected_chapters')::int AS expected_chapters,
           summary_json ->> 'model_route' AS model_route,
           summary_json ->> 'prompt_hash' AS prompt_hash
    FROM phase_eval_runs
    ORDER BY ran_at DESC
    LIMIT ${args.limit * 20}
  ` as Promise<RawRow[]>
}

async function main(): Promise<void> {
  const args = parseArgs()

  // --rows / --full: legacy per-row mode
  if (args.rows || args.full) {
    const rows = await fetchRows(args) as RawRow[]
    if (rows.length === 0) {
      console.log(args.probe
        ? `No phase_eval_runs rows for probe='${args.probe}'.`
        : "No phase_eval_runs rows yet. Use `print-screen-verdict.ts --persist` to populate.")
      process.exit(0)
    }
    printRowsTable(rows.slice(0, args.limit), args.full)
    process.exit(0)
  }

  const allRows = await fetchRows(args) as RawRow[]

  if (allRows.length === 0) {
    console.log(args.probe
      ? `No phase_eval_runs rows for probe='${args.probe}'.`
      : "No phase_eval_runs rows yet. Use `print-screen-verdict.ts --persist` to populate.")
    process.exit(0)
  }

  // Apply --variant filter (post-fetch): keep rows where the variant is in variant_labels
  const filteredRows = args.variant
    ? allRows.filter(r => (r.variant_labels as string[]).includes(args.variant!))
    : allRows

  const families = groupIntoFamilies(filteredRows)

  // --family drill-down mode
  if (args.family) {
    const parsed = parseFamilyKey(args.family)
    // Match families where keyStr starts with the supplied key (allow commit prefix match)
    let match: FamilyStats | undefined
    for (const [ks, fam] of families.entries()) {
      if (ks === args.family) { match = fam; break }
      // Also try prefix match on commit (user may supply 8-char prefix of longer)
      if (parsed.probe_name && fam.key.probe_name === parsed.probe_name
        && fam.key.test_variant === parsed.test_variant
        && fam.key.seed === parsed.seed
        && (fam.key.git_commit.startsWith(parsed.git_commit ?? "") || (parsed.git_commit ?? "").startsWith(fam.key.git_commit.slice(0, 8)))) {
        match = fam
        break
      }
    }
    if (!match) {
      console.error(`No family found matching --family="${args.family}"`)
      console.error(`Available keys:`)
      for (const ks of families.keys()) {
        console.error(`  ${ks}`)
      }
      process.exit(1)
    }
    printFamilyDrillDown(match)
    process.exit(0)
  }

  // Default: family rollup. Partition by checker vs legacy shape so
  // each block uses the columns appropriate to its summary_json schema.
  const all = Array.from(families.values())
  const { hallucSynthetic, adherencePerEvent, legacy } = partitionFamiliesByShape(all)

  if (legacy.length > 0) {
    printFamilyRollup(legacy, args.limit)
  }

  if (hallucSynthetic.length > 0) {
    if (legacy.length > 0) console.log()
    printHallucSyntheticRollup(hallucSynthetic, args.limit)
  }

  if (adherencePerEvent.length > 0) {
    if (legacy.length > 0 || hallucSynthetic.length > 0) console.log()
    printAdherencePerEventRollup(adherencePerEvent, args.limit)
  }
}

if (import.meta.main) {
  main().catch(err => {
    console.error("[list-runs] fatal:", err)
    process.exit(1)
  })
}
