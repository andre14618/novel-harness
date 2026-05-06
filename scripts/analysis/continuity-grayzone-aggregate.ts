#!/usr/bin/env bun
/**
 * Aggregate labeled continuity gray-zone findings into per-stratum and
 * per-subcategory TP/FP/AMB rates. Reads the original panel JSONL emitted by
 * `continuity-grayzone-extract.ts` plus one or more label JSON files (one per
 * subagent batch) and emits a markdown summary plus a JSON breakdown.
 *
 * Read-only — no DB writes, no runtime behavior change.
 */

export type AdjudicationLabel = "TP" | "FP" | "AMB"
export type FindingPolarity = "negative" | "positive" | "ambiguous"
export type Subcategory =
  | "object_emphasis"
  | "emotional_readiness_state"
  | "invented_entity"
  | "changed_core_action"
  | "other"

export interface PanelFindingRecord {
  findingId: string
  agent: "continuity-facts" | "continuity-state"
  severity: "blocker" | "warning" | "nit"
  novelId: string | null
  chapter: number | null
  attempt: number | null
  subject: string
  evidence: string
  reasoning: string
  polarity?: FindingPolarity
  stateType: string | null
  proseExcerpt: string
  stratum: { agent: string; severity: string }
}

export interface FindingLabel {
  findingId: string
  label: AdjudicationLabel
  subcategory: Subcategory | string
  rationale: string
}

export interface AggregatedFinding extends PanelFindingRecord {
  label: AdjudicationLabel | null
  subcategory: Subcategory | string | null
  rationale: string | null
}

export interface RateBreakdown {
  total: number
  tp: number
  fp: number
  amb: number
  unlabeled: number
  tpRate: number
  fpRate: number
  ambRate: number
}

export interface StratumAggregate {
  agent: string
  severity: string
  rates: RateBreakdown
  findings: AggregatedFinding[]
}

export interface SubcategoryAggregate {
  subcategory: string
  rates: RateBreakdown
  findings: AggregatedFinding[]
}

export interface PolarityAggregate {
  polarity: string
  rates: RateBreakdown
  findings: AggregatedFinding[]
}

export interface SupportEchoReadinessThresholds {
  minLabeledCandidates: number
  minFpRate: number
  maxTpRate: number
  maxAmbRate: number
}

export interface SupportEchoReadiness {
  verdict: "ready" | "hold" | "insufficient-evidence"
  candidateFilter: string
  thresholds: SupportEchoReadinessThresholds
  candidateCount: number
  labeledCandidateCount: number
  rates: RateBreakdown
  reason: string
}

export interface PanelAggregate {
  generatedAt: string
  total: RateBreakdown
  strata: StratumAggregate[]
  polarities: PolarityAggregate[]
  subcategories: SubcategoryAggregate[]
  supportEchoReadiness: SupportEchoReadiness
}

const ALL_LABELS: AdjudicationLabel[] = ["TP", "FP", "AMB"]
const DEFAULT_SUPPORT_ECHO_THRESHOLDS: SupportEchoReadinessThresholds = {
  minLabeledCandidates: 20,
  minFpRate: 0.8,
  maxTpRate: 0.05,
  maxAmbRate: 0.2,
}

export function parsePanelJsonl(text: string): PanelFindingRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PanelFindingRecord)
}

export function parseLabelsJson(text: string): FindingLabel[] {
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error("labels file must be a JSON array")
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("malformed label entry")
    const r = entry as Record<string, unknown>
    if (typeof r.findingId !== "string") throw new Error("label missing findingId")
    if (r.label !== "TP" && r.label !== "FP" && r.label !== "AMB") {
      throw new Error(`label must be TP|FP|AMB, got ${r.label}`)
    }
    const subcategory = typeof r.subcategory === "string" ? r.subcategory : "other"
    const rationale = typeof r.rationale === "string" ? r.rationale : ""
    return {
      findingId: r.findingId,
      label: r.label,
      subcategory,
      rationale,
    }
  })
}

export interface JoinLabelsResult {
  findings: AggregatedFinding[]
  /**
   * Same `findingId` appearing in more than one label file. Multiple
   * adjudicators can disagree, and silently overwriting their labels would
   * hide that. Caller decides whether to warn, error, or aggregate. The last
   * label wins in the returned `findings`, matching prior behavior.
   */
  duplicateLabels: { findingId: string; labels: FindingLabel[] }[]
}

export function joinLabels(
  panel: PanelFindingRecord[],
  labels: FindingLabel[],
): JoinLabelsResult {
  const byId = new Map<string, FindingLabel>()
  const duplicates = new Map<string, FindingLabel[]>()
  for (const label of labels) {
    if (byId.has(label.findingId)) {
      const existing = duplicates.get(label.findingId) ?? [byId.get(label.findingId)!]
      existing.push(label)
      duplicates.set(label.findingId, existing)
    }
    byId.set(label.findingId, label)
  }
  const findings = panel.map((finding) => {
    const label = byId.get(finding.findingId)
    return {
      ...finding,
      label: label?.label ?? null,
      subcategory: label?.subcategory ?? null,
      rationale: label?.rationale ?? null,
    }
  })
  return {
    findings,
    duplicateLabels: [...duplicates.entries()].map(([findingId, labels]) => ({ findingId, labels })),
  }
}

export function buildAggregate(
  findings: AggregatedFinding[],
  generatedAt: string = new Date().toISOString(),
  supportEchoThresholds: SupportEchoReadinessThresholds = DEFAULT_SUPPORT_ECHO_THRESHOLDS,
): PanelAggregate {
  const total = computeRates(findings)

  const strata = groupBy(findings, (f) => `${f.stratum.agent}/${f.stratum.severity}`).map(
    (group): StratumAggregate => {
      const sample = group.items[0]!
      return {
        agent: sample.stratum.agent,
        severity: sample.stratum.severity,
        rates: computeRates(group.items),
        findings: group.items,
      }
    },
  )

  const subcategories = groupBy(findings, (f) => f.subcategory ?? "unlabeled").map(
    (group): SubcategoryAggregate => ({
      subcategory: group.key,
      rates: computeRates(group.items),
      findings: group.items,
    }),
  )

  const polarities = groupBy(findings, (f) => f.polarity ?? "unknown").map(
    (group): PolarityAggregate => ({
      polarity: group.key,
      rates: computeRates(group.items),
      findings: group.items,
    }),
  )

  return {
    generatedAt,
    total,
    strata,
    polarities,
    subcategories,
    supportEchoReadiness: assessSupportEchoReadiness(findings, supportEchoThresholds),
  }
}

export function assessSupportEchoReadiness(
  findings: AggregatedFinding[],
  thresholds: SupportEchoReadinessThresholds = DEFAULT_SUPPORT_ECHO_THRESHOLDS,
): SupportEchoReadiness {
  const candidates = findings.filter(finding => finding.polarity === "positive")
  const labeledCandidates = candidates.filter(finding => finding.label !== null)
  const rates = computeRates(labeledCandidates)
  const base = {
    candidateFilter: "polarity=positive",
    thresholds,
    candidateCount: candidates.length,
    labeledCandidateCount: labeledCandidates.length,
    rates,
  }

  if (labeledCandidates.length < thresholds.minLabeledCandidates) {
    return {
      ...base,
      verdict: "insufficient-evidence",
      reason: `needs at least ${thresholds.minLabeledCandidates} labeled positive-polarity findings`,
    }
  }
  if (rates.tpRate > thresholds.maxTpRate) {
    return {
      ...base,
      verdict: "hold",
      reason: `TP rate ${(rates.tpRate * 100).toFixed(0)}% exceeds max ${(thresholds.maxTpRate * 100).toFixed(0)}%`,
    }
  }
  if (rates.ambRate > thresholds.maxAmbRate) {
    return {
      ...base,
      verdict: "hold",
      reason: `AMB rate ${(rates.ambRate * 100).toFixed(0)}% exceeds max ${(thresholds.maxAmbRate * 100).toFixed(0)}%`,
    }
  }
  if (rates.fpRate < thresholds.minFpRate) {
    return {
      ...base,
      verdict: "hold",
      reason: `FP rate ${(rates.fpRate * 100).toFixed(0)}% is below min ${(thresholds.minFpRate * 100).toFixed(0)}%`,
    }
  }
  return {
    ...base,
    verdict: "ready",
    reason: "positive-polarity labeled sample meets deterministic support-echo filter thresholds",
  }
}

export function renderMarkdown(aggregate: PanelAggregate): string {
  const lines: string[] = []
  lines.push("# Continuity Gray-Zone Panel Results")
  lines.push("")
  lines.push(`Generated ${aggregate.generatedAt}.`)
  lines.push("")
  lines.push(`Sample size: ${aggregate.total.total} findings.`)
  lines.push("")
  lines.push("## Overall rates")
  lines.push("")
  lines.push("| TP | FP | AMB | unlabeled |")
  lines.push("|---|---|---|---|")
  lines.push(
    `| ${formatRate(aggregate.total.tp, aggregate.total.total)} | ` +
      `${formatRate(aggregate.total.fp, aggregate.total.total)} | ` +
      `${formatRate(aggregate.total.amb, aggregate.total.total)} | ` +
      `${aggregate.total.unlabeled} |`,
  )
  lines.push("")

  lines.push("## Per-stratum rates")
  lines.push("")
  lines.push("| stratum | total | TP | FP | AMB |")
  lines.push("|---|---|---|---|---|")
  for (const stratum of aggregate.strata) {
    lines.push(
      `| \`${stratum.agent}/${stratum.severity}\` | ${stratum.rates.total} | ` +
        `${formatRate(stratum.rates.tp, stratum.rates.total)} | ` +
        `${formatRate(stratum.rates.fp, stratum.rates.total)} | ` +
        `${formatRate(stratum.rates.amb, stratum.rates.total)} |`,
    )
  }
  lines.push("")

  lines.push("## Per-polarity rates")
  lines.push("")
  lines.push("| polarity | total | TP | FP | AMB |")
  lines.push("|---|---|---|---|---|")
  for (const polarity of aggregate.polarities) {
    lines.push(
      `| \`${polarity.polarity}\` | ${polarity.rates.total} | ` +
        `${formatRate(polarity.rates.tp, polarity.rates.total)} | ` +
        `${formatRate(polarity.rates.fp, polarity.rates.total)} | ` +
        `${formatRate(polarity.rates.amb, polarity.rates.total)} |`,
    )
  }
  lines.push("")

  lines.push("## Per-subcategory rates")
  lines.push("")
  lines.push("| subcategory | total | TP | FP | AMB |")
  lines.push("|---|---|---|---|---|")
  for (const sub of aggregate.subcategories) {
    lines.push(
      `| \`${sub.subcategory}\` | ${sub.rates.total} | ` +
        `${formatRate(sub.rates.tp, sub.rates.total)} | ` +
        `${formatRate(sub.rates.fp, sub.rates.total)} | ` +
        `${formatRate(sub.rates.amb, sub.rates.total)} |`,
    )
  }
  lines.push("")

  lines.push("## Support-echo readiness")
  lines.push("")
  const readiness = aggregate.supportEchoReadiness
  lines.push(`Verdict: \`${readiness.verdict}\`.`)
  lines.push(`Reason: ${readiness.reason}.`)
  lines.push(
    `Candidate filter: \`${readiness.candidateFilter}\`; ` +
      `labeled=${readiness.labeledCandidateCount}/${readiness.candidateCount}; ` +
      `FP=${formatRate(readiness.rates.fp, readiness.rates.total)}; ` +
      `TP=${formatRate(readiness.rates.tp, readiness.rates.total)}; ` +
      `AMB=${formatRate(readiness.rates.amb, readiness.rates.total)}.`,
  )
  lines.push(
    `Thresholds: min labeled ${readiness.thresholds.minLabeledCandidates}, ` +
      `min FP ${(readiness.thresholds.minFpRate * 100).toFixed(0)}%, ` +
      `max TP ${(readiness.thresholds.maxTpRate * 100).toFixed(0)}%, ` +
      `max AMB ${(readiness.thresholds.maxAmbRate * 100).toFixed(0)}%.`,
  )
  lines.push("")

  return lines.join("\n")
}

function formatRate(count: number, total: number): string {
  if (total === 0) return "0 (n/a)"
  const pct = ((count / total) * 100).toFixed(0)
  return `${count} (${pct}%)`
}

function computeRates(findings: AggregatedFinding[]): RateBreakdown {
  const total = findings.length
  let tp = 0
  let fp = 0
  let amb = 0
  let unlabeled = 0
  for (const f of findings) {
    if (f.label === "TP") tp++
    else if (f.label === "FP") fp++
    else if (f.label === "AMB") amb++
    else unlabeled++
  }
  return {
    total,
    tp,
    fp,
    amb,
    unlabeled,
    tpRate: total > 0 ? tp / total : 0,
    fpRate: total > 0 ? fp / total : 0,
    ambRate: total > 0 ? amb / total : 0,
  }
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }))
}

interface CliArgs {
  panelPath: string
  labelPaths: string[]
  outDir: string
}

function parseArgs(argv: string[]): CliArgs {
  let panelPath: string | null = null
  const labelPaths: string[] = []
  let outDir = "output/continuity-grayzone"
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--panel") {
      const value = argv[++i]
      if (!value) throw new Error("--panel requires a value")
      panelPath = value
    } else if (arg === "--labels") {
      const value = argv[++i]
      if (!value) throw new Error("--labels requires a value")
      labelPaths.push(value)
    } else if (arg === "--out") {
      const value = argv[++i]
      if (!value) throw new Error("--out requires a value")
      outDir = value
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  if (!panelPath) throw new Error("--panel is required")
  if (labelPaths.length === 0) throw new Error("at least one --labels is required")
  return { panelPath, labelPaths, outDir }
}

async function main(argv: string[]): Promise<number> {
  let args: CliArgs
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(
      "usage: bun scripts/analysis/continuity-grayzone-aggregate.ts " +
        "--panel <jsonl> --labels <json> [--labels <json> ...] [--out <dir>]",
    )
    return 2
  }

  const fs = await import("node:fs/promises")
  const path = await import("node:path")

  const panelText = await fs.readFile(args.panelPath, "utf8")
  const panel = parsePanelJsonl(panelText)

  const labels: FindingLabel[] = []
  for (const labelPath of args.labelPaths) {
    const text = await fs.readFile(labelPath, "utf8")
    labels.push(...parseLabelsJson(text))
  }

  const joined = joinLabels(panel, labels)
  if (joined.duplicateLabels.length > 0) {
    console.warn(
      `WARNING: ${joined.duplicateLabels.length} finding(s) labeled by more than one adjudicator (last-write-wins applied):`,
    )
    for (const dup of joined.duplicateLabels) {
      const summary = dup.labels.map((l) => l.label).join(", ")
      console.warn(`  ${dup.findingId}: [${summary}]`)
    }
  }
  const aggregate = buildAggregate(joined.findings)
  const md = renderMarkdown(aggregate)

  await fs.mkdir(args.outDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace(/Z$/, "")
  const mdPath = path.join(args.outDir, `continuity-grayzone-results-${ts}.md`)
  const jsonPath = path.join(args.outDir, `continuity-grayzone-results-${ts}.json`)
  await fs.writeFile(mdPath, md)
  await fs.writeFile(jsonPath, JSON.stringify(aggregate, null, 2))

  console.log(md)
  console.log(`\nWrote ${mdPath}`)
  console.log(`Wrote ${jsonPath}`)
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
