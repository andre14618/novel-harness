#!/usr/bin/env bun
/**
 * Aggregate read-only drafting-run comparison artifacts into cohort evidence.
 *
 * This consumes `diagnostics:drafting-run-compare` JSON reports. It does not call
 * an LLM, mutate plans, import readiness rows, or gate drafting.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import type { Dimension } from "../evals/planner-discernment-calibration"
import type { DraftingRunComparison, DraftingRunComparisonReport } from "./drafting-run-compare"

type CohortSignal = DraftingRunComparison["signal"] | "insufficient"
type QualityMovement = "improved" | "regressed" | "mixed" | "unchanged" | "incomplete"
type ContextLoadMovement = "expanded" | "contracted" | "mixed" | "unchanged" | "unknown"
type ContextQualityAlignment =
  | "leaner-or-stable-quality-gain"
  | "quality-gain-with-load-change"
  | "context-expanded-without-clear-quality-gain"
  | "leaner-without-quality-loss"
  | "context-contracted-with-quality-regression"
  | "quality-regression-review"
  | "mixed-quality-review"
  | "stable-no-clear-change"
  | "needs-semantic-evidence"
type ChangedSemanticRow = DraftingRunComparison["sceneSemantic"]["changedRows"][number]

interface Args {
  comparisons: string[]
  output: string | null
  json: string | null
}

export interface DraftingRunCohortReportRef {
  path: string
  report: DraftingRunComparisonReport
}

export interface DraftingRunCohortPair {
  reportPath: string
  source: string
  baselineArm: string
  candidateArm: string
  cleanSource: boolean
  signal: DraftingRunComparison["signal"]
  qualityMovement: QualityMovement
  contextLoadMovement: ContextLoadMovement
  contextQualityAlignment: ContextQualityAlignment
  totalWordsDelta: number
  meanRatioDelta: number
  proseLowDelta: number | null
  sceneLowDelta: number | null
  contextGapDelta: number | null
  readinessFindingDelta: number | null
  planAssistReadinessDelta: number | null
  checkerReadinessDelta: number | null
  checkerBlockerDelta: number | null
  checkerWarningDelta: number | null
  checkerNegativeDelta: number | null
  checkerPositiveDelta: number | null
  checkerAmbiguousDelta: number | null
  checkerLowConfidenceDelta: number | null
  canonSourceRefsDelta: number | null
  storyRefIdsDelta: number | null
  readerInfoStateDelta: number | null
  readerInfoStateCharsDelta: number | null
  missingCharacterIdsDelta: number | null
  referenceAttemptSceneDelta: number | null
  referenceAttemptEventDelta: number | null
}

export interface DraftingRunCohortDimensionSummary {
  dimension: Dimension
  comparisons: number
  meanDeltaSum: number
  lowDeltaSum: number
  resolvedLowRows: number
  regressedLowRows: number
  improvedRows: number
  worsenedRows: number
}

export interface DraftingRunCohortSemanticRowExample {
  reportPath: string
  source: string
  baselineArm: string
  candidateArm: string
  dimension: Dimension
  chapterNumber: number
  sceneId: string
  baselineLabel: string
  candidateLabel: string
  ordinalDelta: number
  status: ChangedSemanticRow["status"]
  traceIds: ChangedSemanticRow["traceIds"]
  candidateMissingForNextLevel: string
}

export interface DraftingRunCohortReport {
  generatedAt: string
  sourceReports: string[]
  comparisonCount: number
  cleanComparisonCount: number
  evidenceComparisonCount: number
  signal: CohortSignal
  signalCounts: Record<string, number>
  cleanSignalCounts: Record<string, number>
  alignment: {
    qualityMovementCounts: Record<string, number>
    contextLoadMovementCounts: Record<string, number>
    contextQualityAlignmentCounts: Record<string, number>
    contextExpandedWithoutClearQualityGain: number
    leanerWithoutQualityLoss: number
    contextContractedWithQualityRegression: number
    missingSemanticEvidence: number
  }
  aggregate: {
    meanWordsDelta: number | null
    meanRatioDelta: number | null
    proseLowDeltaSum: number
    sceneLowDeltaSum: number
    contextGapDeltaSum: number
    readinessFindingDeltaSum: number
    planAssistReadinessDeltaSum: number
    checkerReadinessDeltaSum: number
    checkerBlockerDeltaSum: number
    checkerWarningDeltaSum: number
    checkerNegativeDeltaSum: number
    checkerPositiveDeltaSum: number
    checkerAmbiguousDeltaSum: number
    checkerLowConfidenceDeltaSum: number
    contextDeltas: {
      characterContext: number | null
      worldContext: number | null
      canonFactContext: number | null
      factContinuityAnchors: number | null
      canonSourceRefs: number | null
      storyContext: number | null
      storyRefIds: number | null
      readerInfoState: number | null
      readerInfoStateChars: number | null
      resolvedReferences: number | null
      referenceAttemptScenes: number | null
      referenceAttemptEvents: number | null
      missingCharacterIds: number | null
    }
  }
  dimensions: DraftingRunCohortDimensionSummary[]
  semanticRowExamples: {
    regressions: DraftingRunCohortSemanticRowExample[]
    resolutions: DraftingRunCohortSemanticRowExample[]
  }
  pairs: DraftingRunCohortPair[]
}

export function buildDraftingRunCohortReport(input: {
  refs: readonly DraftingRunCohortReportRef[]
  generatedAt?: string
}): DraftingRunCohortReport {
  const pairs = input.refs.flatMap(ref => pairRowsForReport(ref))
  const cleanPairs = pairs.filter(pair => pair.cleanSource)
  const evidencePairs = cleanPairs.filter(pair => isEvidenceComparablePair(pair))
  const dimensionMap = new Map<Dimension, DraftingRunCohortDimensionSummary>()
  for (const ref of input.refs) {
    for (const comparison of ref.report.comparisons) {
      if (!isEvidenceComparableComparison(ref.report, comparison)) continue
      for (const dim of comparison.sceneSemantic.dimensions) {
        const current = dimensionMap.get(dim.dimension) ?? {
          dimension: dim.dimension,
          comparisons: 0,
          meanDeltaSum: 0,
          lowDeltaSum: 0,
          resolvedLowRows: 0,
          regressedLowRows: 0,
          improvedRows: 0,
          worsenedRows: 0,
        }
        current.comparisons += 1
        current.meanDeltaSum += numberOrZero(dim.meanDelta)
        current.lowDeltaSum += numberOrZero(dim.lowDelta)
        current.resolvedLowRows += numberOrZero(dim.resolvedLowRows)
        current.regressedLowRows += numberOrZero(dim.regressedLowRows)
        current.improvedRows += numberOrZero(dim.improvedRows)
        current.worsenedRows += numberOrZero(dim.worsenedRows)
        dimensionMap.set(dim.dimension, current)
      }
    }
  }
  const signalCounts = countBy(pairs, pair => pair.signal)
  const cleanSignalCounts = countBy(cleanPairs, pair => pair.signal)
  const evidenceSignalCounts = countBy(evidencePairs, pair => pair.signal)
  const contextQualityAlignmentCounts = countBy(evidencePairs, pair => pair.contextQualityAlignment)
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceReports: input.refs.map(ref => ref.path),
    comparisonCount: pairs.length,
    cleanComparisonCount: cleanPairs.length,
    evidenceComparisonCount: evidencePairs.length,
    signal: evidencePairs.length > 0
      ? cohortSignal(evidenceSignalCounts, evidencePairs.length)
      : cohortSignal(cleanSignalCounts, cleanPairs.length),
    signalCounts,
    cleanSignalCounts,
    alignment: {
      qualityMovementCounts: countBy(evidencePairs, pair => pair.qualityMovement),
      contextLoadMovementCounts: countBy(evidencePairs, pair => pair.contextLoadMovement),
      contextQualityAlignmentCounts,
      contextExpandedWithoutClearQualityGain: contextQualityAlignmentCounts["context-expanded-without-clear-quality-gain"] ?? 0,
      leanerWithoutQualityLoss:
        (contextQualityAlignmentCounts["leaner-without-quality-loss"] ?? 0) +
        (contextQualityAlignmentCounts["leaner-or-stable-quality-gain"] ?? 0),
      contextContractedWithQualityRegression: contextQualityAlignmentCounts["context-contracted-with-quality-regression"] ?? 0,
      missingSemanticEvidence: contextQualityAlignmentCounts["needs-semantic-evidence"] ?? 0,
    },
    aggregate: {
      meanWordsDelta: mean(evidencePairs.map(pair => pair.totalWordsDelta)),
      meanRatioDelta: mean(evidencePairs.map(pair => pair.meanRatioDelta)),
      proseLowDeltaSum: sumNullable(evidencePairs.map(pair => pair.proseLowDelta)),
      sceneLowDeltaSum: sumNullable(evidencePairs.map(pair => pair.sceneLowDelta)),
      contextGapDeltaSum: sumNullable(evidencePairs.map(pair => pair.contextGapDelta)),
      readinessFindingDeltaSum: sumNullable(evidencePairs.map(pair => pair.readinessFindingDelta)),
      planAssistReadinessDeltaSum: sumNullable(evidencePairs.map(pair => pair.planAssistReadinessDelta)),
      checkerReadinessDeltaSum: sumNullable(evidencePairs.map(pair => pair.checkerReadinessDelta)),
      checkerBlockerDeltaSum: sumNullable(evidencePairs.map(pair => pair.checkerBlockerDelta)),
      checkerWarningDeltaSum: sumNullable(evidencePairs.map(pair => pair.checkerWarningDelta)),
      checkerNegativeDeltaSum: sumNullable(evidencePairs.map(pair => pair.checkerNegativeDelta)),
      checkerPositiveDeltaSum: sumNullable(evidencePairs.map(pair => pair.checkerPositiveDelta)),
      checkerAmbiguousDeltaSum: sumNullable(evidencePairs.map(pair => pair.checkerAmbiguousDelta)),
      checkerLowConfidenceDeltaSum: sumNullable(evidencePairs.map(pair => pair.checkerLowConfidenceDelta)),
      contextDeltas: {
        characterContext: sumComparisonDelta(input.refs, "characterContextDelta", isEvidenceComparableComparison),
        worldContext: sumComparisonDelta(input.refs, "worldContextDelta", isEvidenceComparableComparison),
        canonFactContext: sumComparisonDelta(input.refs, "canonFactContextDelta", isEvidenceComparableComparison),
        factContinuityAnchors: sumComparisonDelta(input.refs, "factContinuityAnchorDelta", isEvidenceComparableComparison),
        canonSourceRefs: sumComparisonDelta(input.refs, "canonSourceRefsDelta", isEvidenceComparableComparison),
        storyContext: sumComparisonDelta(input.refs, "storyContextDelta", isEvidenceComparableComparison),
        storyRefIds: sumComparisonDelta(input.refs, "storyRefIdsDelta", isEvidenceComparableComparison),
        readerInfoState: sumComparisonDelta(input.refs, "readerInfoStateDelta", isEvidenceComparableComparison),
        readerInfoStateChars: sumComparisonDelta(input.refs, "readerInfoStateCharsDelta", isEvidenceComparableComparison),
        resolvedReferences: sumComparisonDelta(input.refs, "resolvedReferencesDelta", isEvidenceComparableComparison),
        referenceAttemptScenes: sumComparisonDelta(input.refs, "referenceAttemptSceneDelta", isEvidenceComparableComparison),
        referenceAttemptEvents: sumComparisonDelta(input.refs, "referenceAttemptEventDelta", isEvidenceComparableComparison),
        missingCharacterIds: sumComparisonDelta(input.refs, "missingCharacterIdsDelta", isEvidenceComparableComparison),
      },
    },
    dimensions: [...dimensionMap.values()].sort((a, b) => a.dimension.localeCompare(b.dimension)),
    semanticRowExamples: {
      regressions: semanticRowExamples(input.refs, ["regressed_low", "worsened"], 12),
      resolutions: semanticRowExamples(input.refs, ["resolved_low", "improved"], 12),
    },
    pairs,
  }
}

export function renderDraftingRunCohortReport(report: DraftingRunCohortReport): string {
  const lines: string[] = []
  lines.push("# Drafting Run Cohort")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Reports: ${report.sourceReports.length}`)
  lines.push(`Comparisons: ${report.comparisonCount} (${report.cleanComparisonCount} clean-source, ${report.evidenceComparisonCount} evidence-comparable)`)
  lines.push(`Signal: ${report.signal}`)
  lines.push(`Signals: ${formatCounts(report.cleanSignalCounts)}`)
  lines.push("")
  lines.push("## Context-Quality Alignment")
  lines.push("")
  lines.push(`- quality movement: ${formatCounts(report.alignment.qualityMovementCounts)}`)
  lines.push(`- context load movement: ${formatCounts(report.alignment.contextLoadMovementCounts)}`)
  lines.push(`- alignment: ${formatCounts(report.alignment.contextQualityAlignmentCounts)}`)
  lines.push(`- context expanded without clear quality gain: ${report.alignment.contextExpandedWithoutClearQualityGain}`)
  lines.push(`- leaner without quality loss: ${report.alignment.leanerWithoutQualityLoss}`)
  lines.push(`- context contracted with quality regression: ${report.alignment.contextContractedWithQualityRegression}`)
  lines.push(`- missing semantic evidence: ${report.alignment.missingSemanticEvidence}`)
  lines.push("")
  lines.push("## Aggregate")
  lines.push("")
  lines.push(`- mean words delta: ${formatNullableNumber(report.aggregate.meanWordsDelta, 1)}`)
  lines.push(`- mean ratio delta: ${formatNullableNumber(report.aggregate.meanRatioDelta, 3)}`)
  lines.push(`- prose low delta sum: ${formatSigned(report.aggregate.proseLowDeltaSum)}`)
  lines.push(`- scene low delta sum: ${formatSigned(report.aggregate.sceneLowDeltaSum)}`)
  lines.push(`- context gap delta sum: ${formatSigned(report.aggregate.contextGapDeltaSum)}`)
  lines.push(`- readiness finding delta sum: ${formatSigned(report.aggregate.readinessFindingDeltaSum)}`)
  lines.push(
    `- manual readiness deltas: planAssist=${formatSigned(report.aggregate.planAssistReadinessDeltaSum)}, ` +
      `checker=${formatSigned(report.aggregate.checkerReadinessDeltaSum)}, ` +
      `checkerBlockers=${formatSigned(report.aggregate.checkerBlockerDeltaSum)}, ` +
      `checkerWarnings=${formatSigned(report.aggregate.checkerWarningDeltaSum)}, ` +
      `checkerNegative=${formatSigned(report.aggregate.checkerNegativeDeltaSum)}, ` +
      `checkerPositive=${formatSigned(report.aggregate.checkerPositiveDeltaSum)}, ` +
      `checkerAmbiguous=${formatSigned(report.aggregate.checkerAmbiguousDeltaSum)}, ` +
      `checkerLowConfidence=${formatSigned(report.aggregate.checkerLowConfidenceDeltaSum)}`,
  )
  lines.push(
    `- context deltas: canonSourceRefs=${formatDelta(report.aggregate.contextDeltas.canonSourceRefs)}, ` +
      `factAnchors=${formatDelta(report.aggregate.contextDeltas.factContinuityAnchors)}, ` +
      `storyRefs=${formatDelta(report.aggregate.contextDeltas.storyRefIds)}, ` +
      `reader=${formatDelta(report.aggregate.contextDeltas.readerInfoState)}, ` +
      `readerChars=${formatDelta(report.aggregate.contextDeltas.readerInfoStateChars)}, ` +
      `resolvedRefs=${formatDelta(report.aggregate.contextDeltas.resolvedReferences)}, ` +
      `refAttemptScenes=${formatDelta(report.aggregate.contextDeltas.referenceAttemptScenes)}, ` +
      `refAttemptEvents=${formatDelta(report.aggregate.contextDeltas.referenceAttemptEvents)}, ` +
      `missingChars=${formatDelta(report.aggregate.contextDeltas.missingCharacterIds)}`,
  )
  lines.push("")
  lines.push("## Semantic Dimensions")
  lines.push("")
  lines.push("| Dimension | Comparisons | Mean Delta Sum | Low Delta Sum | Resolved | Regressed | Improved | Worsened |")
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
  for (const dim of report.dimensions) {
    lines.push(
      `| ${dim.dimension} | ${dim.comparisons} | ${formatSignedNumber(dim.meanDeltaSum, 2)} | ` +
        `${formatSigned(dim.lowDeltaSum)} | ${dim.resolvedLowRows} | ${dim.regressedLowRows} | ` +
        `${dim.improvedRows} | ${dim.worsenedRows} |`,
    )
  }
  lines.push("")
  lines.push("## Semantic Row Examples")
  lines.push("")
  lines.push("- Advisory examples for manual review; do not treat repeated IDs as automatic tag requirements.")
  lines.push("")
  renderSemanticRowExamples(lines, "Regressions", report.semanticRowExamples.regressions)
  lines.push("")
  renderSemanticRowExamples(lines, "Resolutions", report.semanticRowExamples.resolutions)
  lines.push("")
  lines.push("## Comparisons")
  lines.push("")
  lines.push("| Source | Baseline | Candidate | Clean | Signal | Quality | Context Load | Alignment | Words | Scene Lows | Checker Blockers | Canon Refs | Story Refs | Reader | Reader Chars | Ref Attempt Scenes | Ref Attempt Events | Missing Chars |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
  for (const pair of report.pairs) {
    lines.push(
      `| ${pair.source} | ${pair.baselineArm} | ${pair.candidateArm} | ${pair.cleanSource ? "yes" : "no"} | ` +
        `${pair.signal} | ${pair.qualityMovement} | ${pair.contextLoadMovement} | ${pair.contextQualityAlignment} | ` +
        `${formatEvidenceSigned(pair.totalWordsDelta, pair)} | ${formatEvidenceDelta(pair.sceneLowDelta, pair)} | ` +
        `${formatEvidenceDelta(pair.checkerBlockerDelta, pair)} | ` +
        `${formatDelta(pair.canonSourceRefsDelta)} | ${formatDelta(pair.storyRefIdsDelta)} | ` +
        `${formatDelta(pair.readerInfoStateDelta)} | ${formatDelta(pair.readerInfoStateCharsDelta)} | ` +
        `${formatDelta(pair.referenceAttemptSceneDelta)} | ${formatDelta(pair.referenceAttemptEventDelta)} | ` +
        `${formatDelta(pair.missingCharacterIdsDelta)} |`,
    )
  }
  lines.push("")
  lines.push("## Interpretation Boundary")
  lines.push("")
  lines.push("- This is advisory cohort evidence over existing production-path comparison artifacts.")
  lines.push("- Treat source-sensitive mixed/regressed rows as review prompts, not as automatic prompt or tag changes.")
  return `${lines.join("\n")}\n`
}

export function loadDraftingRunComparisonReportRef(path: string): DraftingRunCohortReportRef {
  const abs = resolve(path)
  if (!existsSync(abs)) throw new Error(`drafting-run comparison report not found: ${abs}`)
  return {
    path: abs,
    report: JSON.parse(readFileSync(abs, "utf8")) as DraftingRunComparisonReport,
  }
}

function pairRowsForReport(ref: DraftingRunCohortReportRef): DraftingRunCohortPair[] {
  return ref.report.comparisons.map(comparison => {
    const qualityMovement = classifyQualityMovement(comparison)
    const contextLoadMovement = classifyContextLoadMovement(comparison)
    const manualReadiness = comparison.manualReadiness
    return {
      reportPath: ref.path,
      source: comparison.candidate.source,
      baselineArm: ref.report.baseline.arm,
      candidateArm: comparison.candidate.arm,
      cleanSource: isCleanComparison(ref.report, comparison),
      signal: comparison.signal,
      qualityMovement,
      contextLoadMovement,
      contextQualityAlignment: classifyContextQualityAlignment(qualityMovement, contextLoadMovement),
      totalWordsDelta: comparison.length.totalWordsDelta,
      meanRatioDelta: comparison.length.meanRatioDelta,
      proseLowDelta: comparison.proseSemantic.lowRowsDelta,
      sceneLowDelta: comparison.sceneSemantic.lowRowsDelta,
      contextGapDelta: comparison.planningContext.gapDelta,
      readinessFindingDelta: comparison.planningContext.readinessFindingDelta,
      planAssistReadinessDelta: manualReadiness?.planAssistFindingDelta ?? null,
      checkerReadinessDelta: manualReadiness?.checkerFindingDelta ?? null,
      checkerBlockerDelta: manualReadiness?.checkerBlockerDelta ?? null,
      checkerWarningDelta: manualReadiness?.checkerWarningDelta ?? null,
      checkerNegativeDelta: manualReadiness?.checkerNegativeDelta ?? null,
      checkerPositiveDelta: manualReadiness?.checkerPositiveDelta ?? null,
      checkerAmbiguousDelta: manualReadiness?.checkerAmbiguousDelta ?? null,
      checkerLowConfidenceDelta: manualReadiness?.checkerLowConfidenceDelta ?? null,
      canonSourceRefsDelta: comparison.planningContext.canonSourceRefsDelta ?? null,
      storyRefIdsDelta: comparison.planningContext.storyRefIdsDelta ?? null,
      readerInfoStateDelta: comparison.planningContext.readerInfoStateDelta ?? null,
      readerInfoStateCharsDelta: comparison.planningContext.readerInfoStateCharsDelta ?? null,
      missingCharacterIdsDelta: comparison.planningContext.missingCharacterIdsDelta ?? null,
      referenceAttemptSceneDelta: comparison.planningContext.referenceAttemptSceneDelta ?? null,
      referenceAttemptEventDelta: comparison.planningContext.referenceAttemptEventDelta ?? null,
    }
  })
}

function semanticRowExamples(
  refs: readonly DraftingRunCohortReportRef[],
  statuses: readonly ChangedSemanticRow["status"][],
  limit: number,
): DraftingRunCohortSemanticRowExample[] {
  const allowed = new Set(statuses)
  const examples: DraftingRunCohortSemanticRowExample[] = []
  for (const ref of refs) {
    for (const comparison of ref.report.comparisons) {
      if (!isEvidenceComparableComparison(ref.report, comparison)) continue
      for (const row of comparison.sceneSemantic.changedRows) {
        if (!allowed.has(row.status)) continue
        examples.push({
          reportPath: ref.path,
          source: comparison.candidate.source,
          baselineArm: ref.report.baseline.arm,
          candidateArm: comparison.candidate.arm,
          dimension: row.dimension,
          chapterNumber: row.chapterNumber,
          sceneId: row.sceneId,
          baselineLabel: row.baselineLabel,
          candidateLabel: row.candidateLabel,
          ordinalDelta: row.ordinalDelta,
          status: row.status,
          traceIds: normalizeTraceIds(row.traceIds),
          candidateMissingForNextLevel: row.candidateMissingForNextLevel ?? "",
        })
      }
    }
  }
  return examples.sort(semanticRowExampleSort).slice(0, limit)
}

function semanticRowExampleSort(
  a: DraftingRunCohortSemanticRowExample,
  b: DraftingRunCohortSemanticRowExample,
): number {
  return semanticRowStatusPriority(a.status) - semanticRowStatusPriority(b.status) ||
    Math.abs(b.ordinalDelta) - Math.abs(a.ordinalDelta) ||
    a.dimension.localeCompare(b.dimension) ||
    a.source.localeCompare(b.source) ||
    a.sceneId.localeCompare(b.sceneId)
}

function semanticRowStatusPriority(status: ChangedSemanticRow["status"]): number {
  switch (status) {
    case "regressed_low": return 0
    case "resolved_low": return 1
    case "worsened": return 2
    case "improved": return 3
    case "unchanged": return 4
  }
}

function renderSemanticRowExamples(
  lines: string[],
  title: string,
  examples: readonly DraftingRunCohortSemanticRowExample[],
): void {
  lines.push(`### ${title}`)
  lines.push("")
  if (examples.length === 0) {
    lines.push("- none")
    return
  }
  for (const example of examples) {
    const trace = formatTraceIds(example.traceIds)
    const next = truncateForMarkdown(example.candidateMissingForNextLevel)
    lines.push(
      `- ${example.source} ch${example.chapterNumber} ${example.sceneId} ${example.dimension}: ` +
        `${example.baselineLabel} -> ${example.candidateLabel} ` +
        `(${formatSigned(example.ordinalDelta)}; ${example.status})` +
        `${trace ? `; ids=${trace}` : ""}` +
        `${next ? `; next=${next}` : ""}`,
    )
  }
}

function classifyQualityMovement(comparison: DraftingRunComparison): QualityMovement {
  if (comparison.signal === "incomplete" || comparison.sceneSemantic.comparisonVerdict === "incomplete") return "incomplete"
  if (
    positiveDelta(comparison.sceneSemantic.lowRowsDelta) ||
    positiveDelta(comparison.proseSemantic.lowRowsDelta) ||
    comparison.sceneSemantic.comparisonVerdict === "regressed"
  ) return "regressed"
  if (
    negativeDelta(comparison.sceneSemantic.lowRowsDelta) ||
    negativeDelta(comparison.proseSemantic.lowRowsDelta) ||
    comparison.sceneSemantic.comparisonVerdict === "improved"
  ) return "improved"
  if (comparison.sceneSemantic.comparisonVerdict === "mixed" || comparison.signal === "mixed") return "mixed"
  return "unchanged"
}

function classifyContextLoadMovement(comparison: DraftingRunComparison): ContextLoadMovement {
  const deltas = [
    comparison.prompt.avgSelectedPromptCharsDelta,
    comparison.prompt.totalCharsDeltaDelta,
    comparison.planningContext.characterContextDelta,
    comparison.planningContext.worldContextDelta,
    comparison.planningContext.canonFactContextDelta,
    comparison.planningContext.factContinuityAnchorDelta,
    comparison.planningContext.canonSourceRefsDelta,
    comparison.planningContext.storyContextDelta,
    comparison.planningContext.storyRefIdsDelta,
    comparison.planningContext.readerInfoStateDelta,
    comparison.planningContext.readerInfoStateCharsDelta,
    comparison.planningContext.resolvedReferencesDelta,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (deltas.length === 0) return "unknown"
  const nonZero = deltas.filter(value => value !== 0)
  if (nonZero.length === 0) return "unchanged"
  const expanded = nonZero.some(value => value > 0)
  const contracted = nonZero.some(value => value < 0)
  if (expanded && contracted) return "mixed"
  return expanded ? "expanded" : "contracted"
}

function classifyContextQualityAlignment(
  quality: QualityMovement,
  contextLoad: ContextLoadMovement,
): ContextQualityAlignment {
  if (quality === "incomplete" || contextLoad === "unknown") return "needs-semantic-evidence"
  if (quality === "improved") {
    return contextLoad === "expanded" || contextLoad === "mixed"
      ? "quality-gain-with-load-change"
      : "leaner-or-stable-quality-gain"
  }
  if (quality === "regressed") {
    return contextLoad === "contracted"
      ? "context-contracted-with-quality-regression"
      : "quality-regression-review"
  }
  if ((quality === "unchanged" || quality === "mixed") && contextLoad === "expanded") {
    return "context-expanded-without-clear-quality-gain"
  }
  if (quality === "unchanged" && contextLoad === "contracted") return "leaner-without-quality-loss"
  if (quality === "mixed") return "mixed-quality-review"
  return "stable-no-clear-change"
}

function isCleanComparison(report: DraftingRunComparisonReport, comparison: DraftingRunComparison): boolean {
  return report.baseline.cleanSource === true && comparison.candidate.cleanSource === true
}

function isEvidenceComparablePair(pair: DraftingRunCohortPair): boolean {
  return pair.cleanSource && pair.signal !== "incomplete"
}

function isEvidenceComparableComparison(report: DraftingRunComparisonReport, comparison: DraftingRunComparison): boolean {
  return isCleanComparison(report, comparison) && comparison.signal !== "incomplete"
}

function sumComparisonDelta(
  refs: readonly DraftingRunCohortReportRef[],
  key: keyof DraftingRunComparison["planningContext"],
  includeComparison: (report: DraftingRunComparisonReport, comparison: DraftingRunComparison) => boolean,
): number | null {
  let sum = 0
  let count = 0
  for (const ref of refs) {
    for (const comparison of ref.report.comparisons) {
      if (!includeComparison(ref.report, comparison)) continue
      const value = comparison.planningContext[key]
      if (typeof value === "number" && Number.isFinite(value)) {
        sum += value
        count += 1
      }
    }
  }
  return count > 0 ? sum : null
}

function cohortSignal(counts: Record<string, number>, cleanCount: number): CohortSignal {
  if (cleanCount === 0) return "insufficient"
  if ((counts.regressed ?? 0) > 0) return "regressed"
  if ((counts.incomplete ?? 0) > 0) return "incomplete"
  if ((counts.mixed ?? 0) > 0) return "mixed"
  if ((counts.promising ?? 0) > 0) return "promising"
  if ((counts.unchanged ?? 0) > 0) return "unchanged"
  return "insufficient"
}

function countBy<T>(items: readonly T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = keyFn(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

function sumNullable(values: readonly Array<number | null>): number {
  return values.reduce((sum, value) => sum + (value ?? 0), 0)
}

function positiveDelta(value: number | null): boolean {
  return value !== null && value > 0
}

function negativeDelta(value: number | null): boolean {
  return value !== null && value < 0
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  return entries.length === 0 ? "(none)" : entries.map(([key, count]) => `${key}: ${count}`).join(", ")
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function formatSignedNumber(value: number, digits: number): string {
  const rendered = value.toFixed(digits)
  return value > 0 ? `+${rendered}` : rendered
}

function formatNullableNumber(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits)
}

function formatDelta(value: number | null): string {
  return value === null ? "n/a" : formatSigned(value)
}

function formatEvidenceSigned(value: number, pair: DraftingRunCohortPair): string {
  return isEvidenceComparablePair(pair) ? formatSigned(value) : "n/a"
}

function formatEvidenceDelta(value: number | null, pair: DraftingRunCohortPair): string {
  return isEvidenceComparablePair(pair) ? formatDelta(value) : "n/a"
}

function normalizeTraceIds(value: unknown): ChangedSemanticRow["traceIds"] {
  const row = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
  return {
    obligationIds: cleanStrings(row.obligationIds),
    relevantCharacterIds: cleanStrings(row.relevantCharacterIds),
    relevantWorldFactIds: cleanStrings(row.relevantWorldFactIds),
    sceneTurnIds: cleanStrings(row.sceneTurnIds),
    threadIds: cleanStrings(row.threadIds),
    promiseIds: cleanStrings(row.promiseIds),
    payoffIds: cleanStrings(row.payoffIds),
    sourceIds: cleanStrings(row.sourceIds),
  }
}

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map(item => typeof item === "string" ? item.trim() : "")
    .filter(item => item.length > 0 && item !== "null" && item !== "undefined"))]
    .sort()
}

function formatTraceIds(traceIds: ChangedSemanticRow["traceIds"]): string {
  const groups = [
    ["obligations", traceIds.obligationIds],
    ["characters", traceIds.relevantCharacterIds],
    ["worldFacts", traceIds.relevantWorldFactIds],
    ["sceneTurns", traceIds.sceneTurnIds],
    ["threads", traceIds.threadIds],
    ["promises", traceIds.promiseIds],
    ["payoffs", traceIds.payoffIds],
    ["sources", traceIds.sourceIds],
  ] as const
  return groups
    .filter(([, ids]) => ids.length > 0)
    .map(([label, ids]) => `${label}:${ids.slice(0, 4).join(",")}${ids.length > 4 ? `+${ids.length - 4}` : ""}`)
    .join("; ")
}

function truncateForMarkdown(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim()
  if (!clean) return ""
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const comparisons: string[] = []
  let output: string | null = null
  let json: string | null = null
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const next = (): string => {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }
    if (arg === "--comparison") { comparisons.push(next()); continue }
    if (arg === "--output") { output = next(); continue }
    if (arg === "--json") { json = next(); continue }
    if (arg.startsWith("-")) throw new Error(`unknown arg: ${arg}`)
    positional.push(arg)
  }
  comparisons.push(...positional)
  if (comparisons.length === 0) throw new Error("at least one --comparison or positional comparison JSON path is required")
  return { comparisons, output, json }
}

function writeOutput(path: string, content: string): void {
  const abs = resolve(path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

async function main(): Promise<number> {
  let args: Args
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/drafting-run-cohort.ts --comparison <drafting-run-compare.json> [--comparison ...] [--output report.md] [--json report.json]")
    return 2
  }

  const report = buildDraftingRunCohortReport({
    refs: args.comparisons.map(loadDraftingRunComparisonReportRef),
  })
  if (args.output) writeOutput(args.output, renderDraftingRunCohortReport(report))
  if (args.json) writeOutput(args.json, `${JSON.stringify(report, null, 2)}\n`)
  console.log(renderDraftingRunCohortReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main())
}
