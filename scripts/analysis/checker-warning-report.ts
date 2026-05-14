#!/usr/bin/env bun

export interface FunctionalEventRow {
  id: number
  runId?: number | null
  chapter: number | null
  payload: unknown
  attempt?: number | null
  timestamp?: string | Date | null
}

export interface ContinuityCallRow {
  id: number
  runId?: number | null
  agent: string
  chapter: number | null
  attempt: number | null
  response_content: string | null
  timestamp?: string | Date | null
}

export interface CheckerFinalAttempt {
  attempt: number
  runId?: number | null
}

export interface CheckerWarningItem {
  source: "functional-check" | "continuity-facts" | "continuity-state"
  severity: "blocker" | "warning" | "nit" | "unknown"
  description: string
  polarity: CheckerWarningPolarity
  calibration: CheckerWarningCalibration
  telemetryWeight: CheckerTelemetryWeight
  telemetryWeightReason: string
  chapter: number | null
  beatIndex?: number | null
  beatId?: string
  plannedItemId?: string
  rowId: number
  attempt?: number | null
}

export type CheckerWarningPolarity = "negative" | "positive" | "ambiguous"
export type CheckerWarningCalibration = "standard" | "low-confidence"
export type CheckerTelemetryWeight = "weight-bearing" | "advisory" | "noise"

export interface CheckerWarningChapter {
  chapter: number | null
  items: CheckerWarningItem[]
}

export interface CheckerWarningReport {
  novelId: string | null
  totalItems: number
  bySeverity: Record<string, number>
  byPolarity: Record<CheckerWarningPolarity, number>
  byCalibration: Record<CheckerWarningCalibration, number>
  byTelemetryWeight: Record<CheckerTelemetryWeight, number>
  chapters: CheckerWarningChapter[]
}

interface Args {
  novelId: string | null
  json: boolean
}

export function buildCheckerWarningReport(
  input: {
    functionalEvents?: FunctionalEventRow[]
    continuityRows?: ContinuityCallRow[]
  },
  novelId: string | null = null,
): CheckerWarningReport {
  const items = [
    ...(input.functionalEvents ?? []).flatMap(functionalEventToItems),
    ...(input.continuityRows ?? []).flatMap(continuityRowToItems),
  ].sort((a, b) =>
    compareNullableNumber(a.chapter, b.chapter) ||
    severityOrder(a.severity) - severityOrder(b.severity) ||
    a.source.localeCompare(b.source) ||
    a.rowId - b.rowId
  )

  const byChapter = new Map<string, CheckerWarningItem[]>()
  for (const item of items) {
    const key = item.chapter === null ? "null" : String(item.chapter)
    const list = byChapter.get(key) ?? []
    list.push(item)
    byChapter.set(key, list)
  }

  const bySeverity: Record<string, number> = {}
  for (const item of items) bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1
  const byPolarity: Record<CheckerWarningPolarity, number> = {
    negative: 0,
    positive: 0,
    ambiguous: 0,
  }
  for (const item of items) byPolarity[item.polarity]++
  const byCalibration: Record<CheckerWarningCalibration, number> = {
    standard: 0,
    "low-confidence": 0,
  }
  for (const item of items) byCalibration[item.calibration]++
  const byTelemetryWeight: Record<CheckerTelemetryWeight, number> = {
    "weight-bearing": 0,
    advisory: 0,
    noise: 0,
  }
  for (const item of items) byTelemetryWeight[item.telemetryWeight]++

  return {
    novelId,
    totalItems: items.length,
    bySeverity,
    byPolarity,
    byCalibration,
    byTelemetryWeight,
    chapters: [...byChapter.values()].map(chapterItems => ({
      chapter: chapterItems[0]?.chapter ?? null,
      items: chapterItems,
    })),
  }
}

export function renderCheckerWarningReport(report: CheckerWarningReport): string {
  const lines: string[] = []
  lines.push(`Checker warning report${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(`Items: ${report.totalItems} total${Object.keys(report.bySeverity).length ? ` (${formatSeverityCounts(report.bySeverity)})` : ""}`)
  if (report.totalItems > 0) {
    lines.push(`Polarity: ${formatPolarityCounts(report.byPolarity)}`)
    lines.push(`Calibration: ${formatCalibrationCounts(report.byCalibration)}`)
    lines.push(`Telemetry weight: ${formatTelemetryWeightCounts(report.byTelemetryWeight)}`)
  }
  if (report.chapters.length === 0) {
    lines.push("No functional or continuity warning items found.")
    return lines.join("\n")
  }

  for (const chapter of report.chapters) {
    const label = chapter.chapter === null ? "chapter ?" : `chapter ${chapter.chapter}`
    lines.push("")
    lines.push(`${label}: ${chapter.items.length} item(s)`)
    for (const item of chapter.items) {
      const beat = item.beatIndex === undefined
        ? ""
        : item.beatIndex === null
          ? " chapter-level"
          : ` beat ${item.beatIndex + 1}`
      const ref = item.beatId ? ` [${item.beatId}]` : ""
      const planned = item.plannedItemId ? ` planned=${item.plannedItemId}` : ""
      const attempt = item.attempt == null ? "" : ` attempt=${item.attempt}`
      const polarity = item.polarity === "negative" ? "" : ` polarity=${item.polarity}`
      const calibration = item.calibration === "standard" ? "" : ` calibration=${item.calibration}`
      const weight = item.telemetryWeight === "weight-bearing" ? "" : ` weight=${item.telemetryWeight}:${item.telemetryWeightReason}`
      lines.push(`  - [${item.severity}] ${item.source}${beat}${ref}${planned}${attempt}${polarity}${calibration}${weight}: ${item.description}`)
    }
  }
  return lines.join("\n")
}

type CheckerWarningItemBase = Omit<CheckerWarningItem, "telemetryWeight" | "telemetryWeightReason">

function functionalEventToItems(row: FunctionalEventRow): CheckerWarningItem[] {
  const payload = asRecord(row.payload)
  const warnings = asArray(payload.warnings)
  const blockers = asArray(payload.blockers)
  const out: CheckerWarningItem[] = []
  for (const raw of warnings) {
    const item = asRecord(raw)
    out.push(withTelemetryWeight({
      source: "functional-check",
      severity: "warning",
      description: itemDescription(item, raw),
      polarity: classifyFindingPolarity(itemDescription(item, raw)),
      calibration: "standard",
      chapter: row.chapter,
      beatIndex: numberOrNull(item.beat_index),
      beatId: stringField(item.beatId),
      plannedItemId: stringField(item.plannedItemId),
      rowId: row.id,
      attempt: row.attempt,
    }))
  }
  for (const raw of blockers) {
    const item = asRecord(raw)
    out.push(withTelemetryWeight({
      source: "functional-check",
      severity: "blocker",
      description: itemDescription(item, raw),
      polarity: classifyFindingPolarity(itemDescription(item, raw)),
      calibration: "standard",
      chapter: row.chapter,
      beatIndex: numberOrNull(item.beat_index),
      beatId: stringField(item.beatId),
      plannedItemId: stringField(item.plannedItemId),
      rowId: row.id,
      attempt: row.attempt,
    }))
  }
  return out
}

function continuityRowToItems(row: ContinuityCallRow): CheckerWarningItem[] {
  if (!row.response_content) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(row.response_content)
  } catch {
    return []
  }
  const payload = asRecord(parsed)
  if (row.agent === "continuity-facts") {
    return asArray(payload.contradictions).flatMap(raw => {
      const item = asRecord(raw)
      if (isNonActionableContinuityClassification(stringField(item.classification))) return []
      const description = stringField(item.reasoning) ?? stringField(item.evidence) ?? JSON.stringify(raw)
      return [withTelemetryWeight({
        source: "continuity-facts",
        severity: severityField(item.severity),
        description,
        polarity: classifyFindingPolarity(description),
        calibration: "standard",
        chapter: row.chapter,
        rowId: row.id,
        attempt: row.attempt,
      })]
    })
  }
  if (row.agent === "continuity-state") {
    return asArray(payload.violations).map(raw => {
      const item = asRecord(raw)
      const violationType = stringField(item.type)
      const description = `${stringField(item.character) ?? "unknown"} ${violationType ?? "state"} violation: ${stringField(item.reasoning) ?? stringField(item.evidence) ?? JSON.stringify(raw)}`
      const severity = normalizeContinuityStateSeverity(severityField(item.severity), violationType)
      return withTelemetryWeight({
        source: "continuity-state",
        severity,
        description,
        polarity: classifyFindingPolarity(description),
        calibration: continuityStateCalibration(severity),
        chapter: row.chapter,
        rowId: row.id,
        attempt: row.attempt,
      })
    })
  }
  return []
}

function withTelemetryWeight(item: CheckerWarningItemBase): CheckerWarningItem {
  const classification = classifyTelemetryWeight(item)
  return {
    ...item,
    telemetryWeight: classification.telemetryWeight,
    telemetryWeightReason: classification.telemetryWeightReason,
  }
}

export function classifyTelemetryWeight(
  item: Pick<CheckerWarningItem, "severity" | "description" | "polarity" | "calibration" | "source">,
): Pick<CheckerWarningItem, "telemetryWeight" | "telemetryWeightReason"> {
  if (isExplicitnessOnlyGap(item.description)) {
    return { telemetryWeight: "noise", telemetryWeightReason: "explicitness-only-gap" }
  }
  if (item.polarity === "positive") {
    return { telemetryWeight: "noise", telemetryWeightReason: "positive-or-supportive-finding" }
  }
  if (item.calibration === "low-confidence") {
    return { telemetryWeight: "noise", telemetryWeightReason: "low-confidence-calibration" }
  }
  if (item.polarity === "ambiguous") {
    return { telemetryWeight: "advisory", telemetryWeightReason: "ambiguous-polarity" }
  }
  if (item.severity === "blocker") {
    return { telemetryWeight: "weight-bearing", telemetryWeightReason: "negative-standard-blocker" }
  }
  return { telemetryWeight: "advisory", telemetryWeightReason: "negative-nonblocking-finding" }
}

function continuityStateCalibration(severity: CheckerWarningItem["severity"]): CheckerWarningCalibration {
  // L83: N=50 continuity-state/warning panel found 0% true positives. Keep the
  // finding visible, but do not let raw warning counts masquerade as calibrated
  // semantic-gate evidence.
  return severity === "warning" ? "low-confidence" : "standard"
}

function isNonActionableContinuityClassification(classification: string | undefined): boolean {
  return classification === "contextual_narrowing" ||
    classification === "omission" ||
    classification === "uncertain"
}

function normalizeContinuityStateSeverity(
  severity: CheckerWarningItem["severity"],
  violationType: string | undefined,
): CheckerWarningItem["severity"] {
  if (violationType === "location" && severity === "blocker") return "warning"
  return severity
}

export function classifyFindingPolarity(description: string): CheckerWarningPolarity {
  const text = description.toLowerCase()
  const explicitNonContradiction = /\b(does not contradict|not a contradiction|no contradiction)\b/.test(text)
  const positive = explicitNonContradiction ||
    /\b(consistent with|matching the|matches the|confirms?|acknowledges?|supports?|supported|supporting|likely knows?|mentions?|demonstrates?|witnesses?|observes?|reports?|simply not referenced|not referenced)\b/.test(text)
  const negative = !explicitNonContradiction &&
    /\b(contradicts?|contradicting|contradiction|inconsistent|conflicts?|violates?|violation|violations|missing|omits?|does not mention|states .+ but|requires .+ but|but the fact (?:says|states))\b/.test(text)
  if (positive && isExplicitnessOnlyGap(description)) return "ambiguous"
  if (positive && negative) return "ambiguous"
  if (positive) return "positive"
  return negative ? "negative" : "ambiguous"
}

function isExplicitnessOnlyGap(description: string): boolean {
  const text = description.toLowerCase()
  const explicitnessOnly =
    /\bdoes not explicitly (?:state|show|say|name|articulate)\b/.test(text) ||
    /\bnot explicitly (?:stated|shown|said|named|articulated)\b/.test(text) ||
    /\bnever explicitly (?:states|shows|says|names|articulates)\b/.test(text) ||
    /\bnot articulated as (?:a |an )?(?:discovery|knowledge|state change)\b/.test(text) ||
    /\bdoes not show (?:him|her|them|[a-z]+) (?:explicitly )?know(?:ing)?\b/.test(text)
  if (!explicitnessOnly) return false
  const concreteMismatch =
    /\bcontradicts?|contradiction|inconsistent|conflicts?|violates?|violation|omits?|does not mention|not present|not shown|not described\b/.test(text)
  return !concreteMismatch
}

export function filterCheckerInputsToFinalAttempts(
  input: {
    functionalEvents: FunctionalEventRow[]
    continuityRows: ContinuityCallRow[]
  },
  finalAttemptByChapter: ReadonlyMap<number, CheckerFinalAttempt>,
): {
  functionalEvents: FunctionalEventRow[]
  continuityRows: ContinuityCallRow[]
} {
  return {
    functionalEvents: input.functionalEvents.filter(row => rowMatchesFinalAttempt(row.chapter, row.attempt, row.runId, finalAttemptByChapter)),
    continuityRows: input.continuityRows.filter(row => rowMatchesFinalAttempt(row.chapter, row.attempt, row.runId, finalAttemptByChapter)),
  }
}

function rowMatchesFinalAttempt(
  chapter: number | null,
  attempt: number | null | undefined,
  runId: number | null | undefined,
  finalAttemptByChapter: ReadonlyMap<number, CheckerFinalAttempt>,
): boolean {
  if (chapter === null) return true
  const final = finalAttemptByChapter.get(chapter)
  if (final === undefined) return true
  if (final.runId !== null && final.runId !== undefined && runId !== null && runId !== undefined && runId !== final.runId) return false
  if (attempt === null || attempt === undefined) return true
  return attempt === final.attempt
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function severityField(value: unknown): CheckerWarningItem["severity"] {
  return value === "blocker" || value === "warning" || value === "nit" ? value : "unknown"
}

function severityOrder(severity: CheckerWarningItem["severity"]): number {
  return severity === "blocker" ? 0 : severity === "warning" ? 1 : severity === "nit" ? 2 : 3
}

function itemDescription(item: Record<string, unknown>, raw: unknown): string {
  return stringField(item.description) ?? JSON.stringify(raw)
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function formatSeverityCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => severityOrder(severityField(a)) - severityOrder(severityField(b)))
    .map(([severity, count]) => `${severity}: ${count}`)
    .join(", ")
}

function formatPolarityCounts(counts: Record<CheckerWarningPolarity, number>): string {
  return (["negative", "positive", "ambiguous"] as const)
    .map(polarity => `${polarity}: ${counts[polarity]}`)
    .join(", ")
}

function formatCalibrationCounts(counts: Record<CheckerWarningCalibration, number>): string {
  return (["standard", "low-confidence"] as const)
    .map(calibration => `${calibration}: ${counts[calibration]}`)
    .join(", ")
}

function formatTelemetryWeightCounts(counts: Record<CheckerTelemetryWeight, number>): string {
  return (["weight-bearing", "advisory", "noise"] as const)
    .map(weight => `${weight}: ${counts[weight]}`)
    .join(", ")
}

function parseArgs(argv: string[]): Args {
  let novelId: string | null = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      const value = argv[++i]
      if (!value) throw new Error("--novel requires a value")
      novelId = value
    } else if (arg === "--json") {
      json = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return { novelId, json }
}

export async function loadCheckerWarningInputs(novelId: string): Promise<{
  functionalEvents: FunctionalEventRow[]
  continuityRows: ContinuityCallRow[]
}> {
  const { default: db } = await import("../../src/db/connection")
  const functionalEventRows = await db`
    SELECT id, run_id AS "runId", chapter, payload, timestamp
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND event_type = 'functional-check'
    ORDER BY chapter, id
  ` as FunctionalEventRow[]
  const functionalEvents = functionalEventRows.map(row => ({
    ...row,
    attempt: numberOrNull(asRecord(row.payload).attempt),
  }))
  const continuityRows = await db`
    SELECT id, run_id AS "runId", agent, chapter, attempt, response_content, timestamp
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent IN ('continuity-facts', 'continuity-state')
    ORDER BY chapter, attempt NULLS LAST, agent, id
  ` as ContinuityCallRow[]
  const finalChapterRows = await db`
    SELECT DISTINCT ON (chapter)
      chapter,
      run_id AS "runId",
      (payload->>'attempts')::int AS attempt
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND event_type = 'chapter-complete'
      AND chapter IS NOT NULL
      AND payload->>'approved' = 'true'
      AND (payload->>'attempts') IS NOT NULL
    ORDER BY chapter, timestamp DESC, id DESC
  ` as Array<{ chapter: number; runId: number | null; attempt: number | null }>
  const finalRows = await db`
    SELECT chapter_number, MAX(version)::int AS attempt
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
      AND status = 'approved'
    GROUP BY chapter_number
  ` as Array<{ chapter_number: number; attempt: number }>
  const finalAttemptByChapter = new Map<number, CheckerFinalAttempt>()
  for (const row of finalChapterRows) {
    if (typeof row.attempt === "number") {
      finalAttemptByChapter.set(row.chapter, { attempt: row.attempt, runId: row.runId })
    }
  }
  for (const row of finalRows) {
    if (!finalAttemptByChapter.has(row.chapter_number)) {
      finalAttemptByChapter.set(row.chapter_number, { attempt: row.attempt, runId: null })
    }
  }
  return filterCheckerInputsToFinalAttempts({ functionalEvents, continuityRows }, finalAttemptByChapter)
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/checker-warning-report.ts --novel <novelId> [--json]")
    return 2
  }

  if (!args.novelId) {
    console.error("usage: bun scripts/analysis/checker-warning-report.ts --novel <novelId> [--json]")
    return 2
  }

  const report = buildCheckerWarningReport(await loadCheckerWarningInputs(args.novelId), args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderCheckerWarningReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
