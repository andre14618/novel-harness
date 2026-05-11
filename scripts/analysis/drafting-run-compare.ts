#!/usr/bin/env bun
/**
 * Compare production drafting-isolated run reports.
 *
 * Diagnostic-only. This reads existing `drafting-isolated-report.json`
 * artifacts, joins optional scene-semantic review sidecars, and explains
 * whether a candidate changed length, prompt load, context/readiness telemetry,
 * and semantic lows. It does not call an LLM, mutate plans, import readiness
 * items, or gate drafting.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import type { Dimension } from "../evals/planner-discernment-calibration"
import {
  buildSceneSemanticComparisonReport,
  type RowDelta,
  type SceneSemanticComparison,
  type SceneSemanticReportRef,
} from "../evals/scene-semantic-compare"
import type { SceneSemanticReplayReport } from "../evals/scene-semantic-review"

type EvidenceSignal = "promising" | "regressed" | "mixed" | "unchanged" | "incomplete"

interface Args {
  baseline: string | null
  candidates: string[]
  baselineArm: string | null
  candidateArm: string | null
  output: string | null
  json: string | null
  maxChangedRows: number
}

interface DraftingIsolatedRunReportArtifact {
  v?: string
  generatedAt?: string
  source?: string
  targetPrefix?: string
  sourceAssessment?: {
    clean?: boolean
    issue?: string | null
  }
  results?: DraftingArmArtifact[]
}

interface DraftingArmArtifact {
  arm?: string
  novelId?: string
  totalWords?: number
  totalTarget?: number
  meanRatio?: number
  error?: string
  draftingBrief?: {
    events?: number
    enabledEvents?: number
    modes?: Record<string, number>
    avgCharsRatio?: number | null
    avgSelectedPromptChars?: number | null
    avgFullContextPromptChars?: number | null
    totalCharsDelta?: number
  }
  planningContext?: {
    outputDir?: string
    surfaceCount?: number
    gapCount?: number
    readiness?: {
      groupCount?: number
      findingCount?: number
      labels?: Record<string, number>
    }
    gaps?: Array<{
      surface?: string
      status?: string
      upstreamCount?: number
      downstreamCount?: number
    }>
  }
  proseSemantic?: {
    outputDir?: string
    resultCount?: number
    lowRows?: number
    errorRows?: number
    lengthSignal?: string
    qualityRisk?: string
  }
  sceneSemantic?: {
    outputDir?: string
    taskCount?: number
    skipCount?: number
    lowRows?: number
    errorRows?: number
    dimensions?: Array<{
      dimension?: Dimension
      count?: number
      meanOrdinal?: number
      lowCount?: number
      labelCounts?: Record<string, number>
    }>
  }
}

interface PlanningContextDetail {
  sceneLoad: {
    maxScenesPerChapter: number | null
    minTargetWordsPerScene: number | null
    denseChapterCount: number | null
    overloadedChapterCount: number | null
  } | null
  downstream: {
    events: number | null
    missingCharacterIds: number | null
    withResolvedReferences: number | null
    referenceLookups: number | null
  } | null
}

export interface DraftingRunRef {
  reportPath: string
  reportDir: string
  report: DraftingIsolatedRunReportArtifact
  arm: DraftingArmArtifact
  summary: DraftingRunSummary
}

export interface DraftingRunSummary {
  reportPath: string
  source: string
  targetPrefix: string
  arm: string
  novelId: string
  cleanSource: boolean | null
  sourceIssue: string | null
  totalWords: number
  totalTarget: number
  meanRatio: number
  error: string | null
  draftingBrief: {
    events: number
    enabledEvents: number
    modes: Record<string, number>
    avgCharsRatio: number | null
    avgSelectedPromptChars: number | null
    avgFullContextPromptChars: number | null
    totalCharsDelta: number
  } | null
  planningContext: {
    outputDir: string | null
    gapCount: number | null
    readinessFindingCount: number | null
    readinessLabels: Record<string, number>
    sceneLoad: PlanningContextDetail["sceneLoad"]
    downstream: PlanningContextDetail["downstream"]
  } | null
  proseSemantic: {
    outputDir: string | null
    resultCount: number | null
    lowRows: number | null
    errorRows: number | null
    lengthSignal: string | null
    qualityRisk: string | null
  } | null
  sceneSemantic: {
    outputDir: string | null
    taskCount: number | null
    skipCount: number | null
    lowRows: number | null
    errorRows: number | null
    dimensions: Array<{
      dimension: Dimension
      count: number
      meanOrdinal: number
      lowCount: number
      labelCounts: Record<string, number>
    }>
  } | null
}

export interface DraftingRunComparisonReport {
  generatedAt: string
  baseline: DraftingRunSummary
  comparisons: DraftingRunComparison[]
}

export interface DraftingRunComparison {
  candidate: DraftingRunSummary
  signal: EvidenceSignal
  reasons: string[]
  length: {
    totalWordsDelta: number
    meanRatioDelta: number
    targetWordsDelta: number
  }
  prompt: {
    avgCharsRatioDelta: number | null
    avgSelectedPromptCharsDelta: number | null
    totalCharsDeltaDelta: number | null
  }
  planningContext: {
    gapDelta: number | null
    readinessFindingDelta: number | null
    missingCharacterIdsDelta: number | null
    overloadedChapterDelta: number | null
    minTargetWordsPerSceneDelta: number | null
  }
  proseSemantic: {
    lowRowsDelta: number | null
    errorRowsDelta: number | null
  }
  sceneSemantic: {
    lowRowsDelta: number | null
    errorRowsDelta: number | null
    comparisonVerdict: SceneSemanticComparison["verdict"] | null
    comparedRows: number | null
    missingInCandidate: number | null
    missingInBaseline: number | null
    dimensions: SceneSemanticComparison["dimensions"]
    changedRows: RowDelta[]
  }
}

export function buildDraftingRunComparisonReport(input: {
  baseline: DraftingRunRef
  candidates: DraftingRunRef[]
  maxChangedRows?: number
  generatedAt?: string
}): DraftingRunComparisonReport {
  const maxChangedRows = input.maxChangedRows ?? 12
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    baseline: input.baseline.summary,
    comparisons: input.candidates.map(candidate =>
      compareCandidate(input.baseline, candidate, maxChangedRows)
    ),
  }
}

export function renderDraftingRunComparisonReport(report: DraftingRunComparisonReport): string {
  const lines: string[] = []
  lines.push("# Drafting Run Comparison")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Baseline: ${summaryLabel(report.baseline)}`)
  lines.push(`Candidates: ${report.comparisons.length}`)
  lines.push("")
  for (const comparison of report.comparisons) {
    const candidate = comparison.candidate
    lines.push(`## ${summaryLabel(candidate)}`)
    lines.push("")
    lines.push(`Signal: ${comparison.signal}`)
    lines.push(
      `Words: ${candidate.totalWords}/${candidate.totalTarget} (${candidate.meanRatio.toFixed(3)}) ` +
        `vs ${report.baseline.totalWords}/${report.baseline.totalTarget} (${report.baseline.meanRatio.toFixed(3)}); ` +
        `delta=${formatSigned(comparison.length.totalWordsDelta)} words, ratio=${formatSignedNumber(comparison.length.meanRatioDelta, 3)}`,
    )
    lines.push(
      `Telemetry: proseLows=${formatDelta(comparison.proseSemantic.lowRowsDelta)}, ` +
        `sceneLows=${formatDelta(comparison.sceneSemantic.lowRowsDelta)}, ` +
        `contextGaps=${formatDelta(comparison.planningContext.gapDelta)}, ` +
        `readiness=${formatDelta(comparison.planningContext.readinessFindingDelta)}, ` +
        `promptRatio=${formatNullableDelta(comparison.prompt.avgCharsRatioDelta, 3)}`,
    )
    const baselineLoad = report.baseline.planningContext?.sceneLoad
    const candidateLoad = candidate.planningContext?.sceneLoad
    if (baselineLoad || candidateLoad) {
      lines.push(
        `Scene load: maxScenes=${formatNullableNumber(baselineLoad?.maxScenesPerChapter ?? null)} -> ` +
          `${formatNullableNumber(candidateLoad?.maxScenesPerChapter ?? null)}, ` +
          `minWordsPerScene=${formatNullableNumber(baselineLoad?.minTargetWordsPerScene ?? null)} -> ` +
          `${formatNullableNumber(candidateLoad?.minTargetWordsPerScene ?? null)}, ` +
          `overloaded=${formatNullableNumber(baselineLoad?.overloadedChapterCount ?? null)} -> ` +
          `${formatNullableNumber(candidateLoad?.overloadedChapterCount ?? null)}`,
      )
    }
    if (comparison.sceneSemantic.comparisonVerdict) {
      lines.push(
        `Scene semantic rows: verdict=${comparison.sceneSemantic.comparisonVerdict}, ` +
          `compared=${comparison.sceneSemantic.comparedRows}, ` +
          `missingCandidate=${comparison.sceneSemantic.missingInCandidate}, ` +
          `missingBaseline=${comparison.sceneSemantic.missingInBaseline}`,
      )
      lines.push("")
      lines.push("| Dimension | Mean Delta | Low Delta | Resolved | Regressed | Improved | Worsened |")
      lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
      for (const dim of comparison.sceneSemantic.dimensions) {
        lines.push(
          `| ${dim.dimension} | ${formatNullableNumber(dim.meanDelta, 2)} | ` +
            `${formatSigned(dim.lowDelta)} | ${dim.resolvedLowRows} | ${dim.regressedLowRows} | ` +
            `${dim.improvedRows} | ${dim.worsenedRows} |`,
        )
      }
    }
    lines.push("")
    lines.push("### Reasons")
    for (const reason of comparison.reasons) lines.push(`- ${reason}`)
    lines.push("")
    lines.push("### Changed Semantic Rows")
    if (comparison.sceneSemantic.changedRows.length === 0) {
      lines.push("- none")
    } else {
      for (const row of comparison.sceneSemantic.changedRows) {
        const ids = formatTraceIds(row.traceIds)
        const next = truncateForMarkdown(row.candidateMissingForNextLevel)
        lines.push(
          `- ch${row.chapterNumber} ${row.sceneId} ${row.dimension}: ` +
            `${row.baselineLabel} -> ${row.candidateLabel} ` +
            `(${formatSigned(row.ordinalDelta)}; ${row.status})` +
            `${ids ? `; ids=${ids}` : ""}` +
            `${next ? `; next=${next}` : ""}`,
        )
      }
    }
    lines.push("")
  }
  lines.push("## Interpretation Boundary")
  lines.push("")
  lines.push("- This is advisory production-path evidence, not a drafting gate or default-flip decision.")
  lines.push("- A shorter candidate is not promising if scene/prose semantic lows or readiness findings regress.")
  lines.push("- Trace IDs are evidence handles for manual Plan Readiness review; they are not proof that a tag must be added.")
  return `${lines.join("\n")}\n`
}

export function readDraftingRunRef(path: string, preferredArm: string | null = null): DraftingRunRef {
  const reportPath = resolve(path)
  if (!existsSync(reportPath)) throw new Error(`drafting-isolated report not found: ${path}`)
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as DraftingIsolatedRunReportArtifact
  const arm = chooseArm(report, preferredArm)
  const reportDir = dirname(reportPath)
  return {
    reportPath,
    reportDir,
    report,
    arm,
    summary: summarizeRun(reportPath, reportDir, report, arm),
  }
}

function compareCandidate(
  baseline: DraftingRunRef,
  candidate: DraftingRunRef,
  maxChangedRows: number,
): DraftingRunComparison {
  const sceneComparison = compareSceneSemanticReports(baseline, candidate)
  const changedRows = sceneComparison
    ? sceneComparison.rowChanges
      .filter(row => row.status !== "unchanged")
      .sort(rowChangeSort)
      .slice(0, maxChangedRows)
    : []
  const comparison: DraftingRunComparison = {
    candidate: candidate.summary,
    signal: "unchanged",
    reasons: [],
    length: {
      totalWordsDelta: candidate.summary.totalWords - baseline.summary.totalWords,
      meanRatioDelta: candidate.summary.meanRatio - baseline.summary.meanRatio,
      targetWordsDelta: candidate.summary.totalTarget - baseline.summary.totalTarget,
    },
    prompt: {
      avgCharsRatioDelta: nullableDelta(
        baseline.summary.draftingBrief?.avgCharsRatio ?? null,
        candidate.summary.draftingBrief?.avgCharsRatio ?? null,
      ),
      avgSelectedPromptCharsDelta: nullableDelta(
        baseline.summary.draftingBrief?.avgSelectedPromptChars ?? null,
        candidate.summary.draftingBrief?.avgSelectedPromptChars ?? null,
      ),
      totalCharsDeltaDelta: nullableDelta(
        baseline.summary.draftingBrief?.totalCharsDelta ?? null,
        candidate.summary.draftingBrief?.totalCharsDelta ?? null,
      ),
    },
    planningContext: {
      gapDelta: nullableDelta(
        baseline.summary.planningContext?.gapCount ?? null,
        candidate.summary.planningContext?.gapCount ?? null,
      ),
      readinessFindingDelta: nullableDelta(
        baseline.summary.planningContext?.readinessFindingCount ?? null,
        candidate.summary.planningContext?.readinessFindingCount ?? null,
      ),
      missingCharacterIdsDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.missingCharacterIds ?? null,
        candidate.summary.planningContext?.downstream?.missingCharacterIds ?? null,
      ),
      overloadedChapterDelta: nullableDelta(
        baseline.summary.planningContext?.sceneLoad?.overloadedChapterCount ?? null,
        candidate.summary.planningContext?.sceneLoad?.overloadedChapterCount ?? null,
      ),
      minTargetWordsPerSceneDelta: nullableDelta(
        baseline.summary.planningContext?.sceneLoad?.minTargetWordsPerScene ?? null,
        candidate.summary.planningContext?.sceneLoad?.minTargetWordsPerScene ?? null,
      ),
    },
    proseSemantic: {
      lowRowsDelta: nullableDelta(
        baseline.summary.proseSemantic?.lowRows ?? null,
        candidate.summary.proseSemantic?.lowRows ?? null,
      ),
      errorRowsDelta: nullableDelta(
        baseline.summary.proseSemantic?.errorRows ?? null,
        candidate.summary.proseSemantic?.errorRows ?? null,
      ),
    },
    sceneSemantic: {
      lowRowsDelta: nullableDelta(
        baseline.summary.sceneSemantic?.lowRows ?? null,
        candidate.summary.sceneSemantic?.lowRows ?? null,
      ),
      errorRowsDelta: nullableDelta(
        baseline.summary.sceneSemantic?.errorRows ?? null,
        candidate.summary.sceneSemantic?.errorRows ?? null,
      ),
      comparisonVerdict: sceneComparison?.verdict ?? null,
      comparedRows: sceneComparison?.comparedRows ?? null,
      missingInCandidate: sceneComparison?.missingInCandidate.length ?? null,
      missingInBaseline: sceneComparison?.missingInBaseline.length ?? null,
      dimensions: sceneComparison?.dimensions ?? [],
      changedRows,
    },
  }
  comparison.reasons = evidenceReasons(baseline.summary, candidate.summary, comparison)
  comparison.signal = evidenceSignal(baseline.summary, comparison)
  return comparison
}

function chooseArm(report: DraftingIsolatedRunReportArtifact, preferredArm: string | null): DraftingArmArtifact {
  const results = report.results ?? []
  if (results.length === 0) throw new Error("drafting-isolated report has no results")
  if (preferredArm) {
    const found = results.find(result => result.arm === preferredArm)
    if (!found) throw new Error(`arm ${preferredArm} not found in report`)
    return found
  }
  const completed = results.filter(result => !result.error)
  if (completed.length === 1) return completed[0]!
  const baseline = completed.find(result => result.arm === "baseline")
  if (baseline) return baseline
  return completed[0] ?? results[0]!
}

function summarizeRun(
  reportPath: string,
  reportDir: string,
  report: DraftingIsolatedRunReportArtifact,
  arm: DraftingArmArtifact,
): DraftingRunSummary {
  const contextDetail = loadPlanningContextDetail(reportDir, arm.planningContext?.outputDir ?? null)
  return {
    reportPath,
    source: report.source ?? "unknown",
    targetPrefix: report.targetPrefix ?? "unknown",
    arm: arm.arm ?? "unknown",
    novelId: arm.novelId ?? "unknown",
    cleanSource: typeof report.sourceAssessment?.clean === "boolean" ? report.sourceAssessment.clean : null,
    sourceIssue: report.sourceAssessment?.issue ?? null,
    totalWords: numberOrZero(arm.totalWords),
    totalTarget: numberOrZero(arm.totalTarget),
    meanRatio: numberOrZero(arm.meanRatio),
    error: arm.error ?? null,
    draftingBrief: arm.draftingBrief ? {
      events: numberOrZero(arm.draftingBrief.events),
      enabledEvents: numberOrZero(arm.draftingBrief.enabledEvents),
      modes: arm.draftingBrief.modes ?? {},
      avgCharsRatio: finiteOrNull(arm.draftingBrief.avgCharsRatio),
      avgSelectedPromptChars: finiteOrNull(arm.draftingBrief.avgSelectedPromptChars),
      avgFullContextPromptChars: finiteOrNull(arm.draftingBrief.avgFullContextPromptChars),
      totalCharsDelta: numberOrZero(arm.draftingBrief.totalCharsDelta),
    } : null,
    planningContext: arm.planningContext ? {
      outputDir: arm.planningContext.outputDir ?? null,
      gapCount: finiteOrNull(arm.planningContext.gapCount),
      readinessFindingCount: finiteOrNull(arm.planningContext.readiness?.findingCount),
      readinessLabels: arm.planningContext.readiness?.labels ?? {},
      sceneLoad: contextDetail?.sceneLoad ?? null,
      downstream: contextDetail?.downstream ?? null,
    } : null,
    proseSemantic: arm.proseSemantic ? {
      outputDir: arm.proseSemantic.outputDir ?? null,
      resultCount: finiteOrNull(arm.proseSemantic.resultCount),
      lowRows: finiteOrNull(arm.proseSemantic.lowRows),
      errorRows: finiteOrNull(arm.proseSemantic.errorRows),
      lengthSignal: arm.proseSemantic.lengthSignal ?? null,
      qualityRisk: arm.proseSemantic.qualityRisk ?? null,
    } : null,
    sceneSemantic: arm.sceneSemantic ? {
      outputDir: arm.sceneSemantic.outputDir ?? null,
      taskCount: finiteOrNull(arm.sceneSemantic.taskCount),
      skipCount: finiteOrNull(arm.sceneSemantic.skipCount),
      lowRows: finiteOrNull(arm.sceneSemantic.lowRows),
      errorRows: finiteOrNull(arm.sceneSemantic.errorRows),
      dimensions: (arm.sceneSemantic.dimensions ?? []).flatMap(row => {
        if (!row.dimension) return []
        return [{
          dimension: row.dimension,
          count: numberOrZero(row.count),
          meanOrdinal: numberOrZero(row.meanOrdinal),
          lowCount: numberOrZero(row.lowCount),
          labelCounts: row.labelCounts ?? {},
        }]
      }),
    } : null,
  }
}

function loadPlanningContextDetail(reportDir: string, outputDir: string | null): PlanningContextDetail | null {
  if (!outputDir) return null
  const path = resolveArtifactPath(reportDir, join(outputDir, "planning-drafting-context-report.json"))
  if (!path) return null
  try {
    const report = JSON.parse(readFileSync(path, "utf8")) as {
      upstream?: {
        sceneLoad?: PlanningContextDetail["sceneLoad"]
      }
      downstream?: PlanningContextDetail["downstream"]
    }
    const sceneLoad = report.upstream?.sceneLoad ?? null
    const downstream = report.downstream ?? null
    return {
      sceneLoad: sceneLoad ? {
        maxScenesPerChapter: finiteOrNull(sceneLoad.maxScenesPerChapter),
        minTargetWordsPerScene: finiteOrNull(sceneLoad.minTargetWordsPerScene),
        denseChapterCount: finiteOrNull(sceneLoad.denseChapterCount),
        overloadedChapterCount: finiteOrNull(sceneLoad.overloadedChapterCount),
      } : null,
      downstream: downstream ? {
        events: finiteOrNull(downstream.events),
        missingCharacterIds: finiteOrNull(downstream.missingCharacterIds),
        withResolvedReferences: finiteOrNull(downstream.withResolvedReferences),
        referenceLookups: finiteOrNull(downstream.referenceLookups),
      } : null,
    }
  } catch {
    return null
  }
}

function compareSceneSemanticReports(
  baseline: DraftingRunRef,
  candidate: DraftingRunRef,
): SceneSemanticComparison | null {
  const baselineRef = sceneSemanticReportRefForArm(baseline)
  const candidateRef = sceneSemanticReportRefForArm(candidate)
  if (!baselineRef || !candidateRef) return null
  return buildSceneSemanticComparisonReport({
    baseline: baselineRef,
    candidates: [candidateRef],
  }).comparisons[0] ?? null
}

function sceneSemanticReportRefForArm(run: DraftingRunRef): SceneSemanticReportRef | null {
  const outputDir = run.arm.sceneSemantic?.outputDir
  if (!outputDir) return null
  const path = resolveArtifactPath(run.reportDir, join(outputDir, "scene-semantic-review.json"))
  if (!path) return null
  try {
    return {
      path,
      report: JSON.parse(readFileSync(path, "utf8")) as SceneSemanticReplayReport,
    }
  } catch {
    return null
  }
}

function evidenceReasons(
  baseline: DraftingRunSummary,
  candidate: DraftingRunSummary,
  comparison: DraftingRunComparison,
): string[] {
  const reasons: string[] = []
  if (baseline.error) reasons.push(`Baseline arm has error: ${baseline.error}`)
  if (candidate.error) reasons.push(`Candidate arm has error: ${candidate.error}`)
  if (baseline.cleanSource === false || candidate.cleanSource === false) {
    reasons.push("At least one report is not marked as a clean drafting source.")
  }
  if (candidate.source !== baseline.source) {
    reasons.push(`Reports use different source ids: ${baseline.source} -> ${candidate.source}.`)
  }
  if (comparison.length.meanRatioDelta <= -0.05) {
    reasons.push(`Candidate is shorter by ${Math.abs(comparison.length.totalWordsDelta)} words and ${Math.abs(comparison.length.meanRatioDelta).toFixed(3)} ratio points.`)
  } else if (comparison.length.meanRatioDelta >= 0.05) {
    reasons.push(`Candidate is longer by ${comparison.length.totalWordsDelta} words and ${comparison.length.meanRatioDelta.toFixed(3)} ratio points.`)
  }
  if (positiveDelta(comparison.sceneSemantic.lowRowsDelta)) {
    reasons.push(`Scene-semantic lows worsened by ${comparison.sceneSemantic.lowRowsDelta}.`)
  } else if (negativeDelta(comparison.sceneSemantic.lowRowsDelta)) {
    reasons.push(`Scene-semantic lows improved by ${Math.abs(comparison.sceneSemantic.lowRowsDelta!)}.`)
  }
  if (positiveDelta(comparison.proseSemantic.lowRowsDelta)) {
    reasons.push(`Prose-semantic lows worsened by ${comparison.proseSemantic.lowRowsDelta}.`)
  } else if (negativeDelta(comparison.proseSemantic.lowRowsDelta)) {
    reasons.push(`Prose-semantic lows improved by ${Math.abs(comparison.proseSemantic.lowRowsDelta!)}.`)
  }
  if (comparison.sceneSemantic.comparisonVerdict) {
    reasons.push(`Aligned scene-semantic comparison verdict is ${comparison.sceneSemantic.comparisonVerdict}.`)
  } else {
    reasons.push("Aligned scene-semantic comparison was unavailable; inspect scene-semantic sidecars before drawing quality conclusions.")
  }
  if (positiveDelta(comparison.planningContext.readinessFindingDelta)) {
    reasons.push(`Planning-context readiness findings increased by ${comparison.planningContext.readinessFindingDelta}.`)
  }
  if (positiveDelta(comparison.planningContext.gapDelta)) {
    reasons.push(`Planning-to-drafting context gaps increased by ${comparison.planningContext.gapDelta}.`)
  }
  if (positiveDelta(comparison.planningContext.missingCharacterIdsDelta)) {
    reasons.push(`Writer-context missing character ids increased by ${comparison.planningContext.missingCharacterIdsDelta}.`)
  }
  if (comparison.length.meanRatioDelta < 0 && (
    positiveDelta(comparison.sceneSemantic.lowRowsDelta) ||
    positiveDelta(comparison.proseSemantic.lowRowsDelta) ||
    comparison.sceneSemantic.comparisonVerdict === "regressed"
  )) {
    reasons.push("Length improved while semantic evidence regressed; treat the candidate as source-sensitive rather than a default candidate.")
  }
  if (reasons.length === 0) reasons.push("No material telemetry difference was detected.")
  return reasons
}

function evidenceSignal(baseline: DraftingRunSummary, comparison: DraftingRunComparison): EvidenceSignal {
  if (baseline.error || comparison.candidate.error) return "incomplete"
  if (!comparison.sceneSemantic.comparisonVerdict) return "incomplete"
  if (comparison.sceneSemantic.comparisonVerdict === "incomplete") return "incomplete"
  if (
    positiveDelta(comparison.sceneSemantic.errorRowsDelta) ||
    positiveDelta(comparison.proseSemantic.errorRowsDelta)
  ) return "incomplete"
  if (
    positiveDelta(comparison.sceneSemantic.lowRowsDelta) ||
    positiveDelta(comparison.proseSemantic.lowRowsDelta) ||
    comparison.sceneSemantic.comparisonVerdict === "regressed"
  ) return "regressed"
  if (
    comparison.sceneSemantic.comparisonVerdict === "mixed" ||
    positiveDelta(comparison.planningContext.gapDelta) ||
    positiveDelta(comparison.planningContext.readinessFindingDelta)
  ) return "mixed"
  if (
    comparison.length.meanRatioDelta <= -0.05 &&
    !positiveDelta(comparison.sceneSemantic.lowRowsDelta) &&
    !positiveDelta(comparison.proseSemantic.lowRowsDelta)
  ) return "promising"
  if (comparison.sceneSemantic.comparisonVerdict === "improved") return "promising"
  return "unchanged"
}

function rowChangeSort(a: RowDelta, b: RowDelta): number {
  const statusDelta = rowStatusPriority(a.status) - rowStatusPriority(b.status)
  if (statusDelta !== 0) return statusDelta
  const magnitudeDelta = Math.abs(b.ordinalDelta) - Math.abs(a.ordinalDelta)
  if (magnitudeDelta !== 0) return magnitudeDelta
  return a.key.localeCompare(b.key)
}

function rowStatusPriority(status: RowDelta["status"]): number {
  switch (status) {
    case "regressed_low": return 0
    case "resolved_low": return 1
    case "worsened": return 2
    case "improved": return 3
    case "unchanged": return 4
  }
}

function resolveArtifactPath(reportDir: string, path: string): string | null {
  const cwdPath = resolve(path)
  if (existsSync(cwdPath)) return cwdPath
  const reportRelative = resolve(reportDir, path)
  if (existsSync(reportRelative)) return reportRelative
  return null
}

function nullableDelta(baseline: number | null, candidate: number | null): number | null {
  return baseline === null || candidate === null ? null : candidate - baseline
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

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function summaryLabel(summary: DraftingRunSummary): string {
  return `${summary.targetPrefix}/${summary.arm} (${summary.novelId})`
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function formatSignedNumber(value: number, digits: number): string {
  const rendered = value.toFixed(digits)
  return value > 0 ? `+${rendered}` : rendered
}

function formatDelta(value: number | null): string {
  return value === null ? "n/a" : formatSigned(value)
}

function formatNullableDelta(value: number | null, digits: number): string {
  return value === null ? "n/a" : formatSignedNumber(value, digits)
}

function formatNullableNumber(value: number | null | undefined, digits = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "n/a"
}

function formatTraceIds(traceIds: RowDelta["traceIds"]): string {
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

function parseArgs(argv: string[]): Args {
  let baseline: string | null = null
  const candidates: string[] = []
  let baselineArm: string | null = null
  let candidateArm: string | null = null
  let output: string | null = null
  let json: string | null = null
  let maxChangedRows = 12
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const next = (): string => {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }
    if (arg === "--baseline") { baseline = next(); continue }
    if (arg === "--candidate") { candidates.push(next()); continue }
    if (arg === "--baseline-arm") { baselineArm = next(); continue }
    if (arg === "--candidate-arm") { candidateArm = next(); continue }
    if (arg === "--output") { output = next(); continue }
    if (arg === "--json") { json = next(); continue }
    if (arg === "--max-changed-rows") {
      maxChangedRows = positiveInteger(next(), arg)
      continue
    }
    if (arg.startsWith("--")) throw new Error(`unknown arg: ${arg}`)
    positional.push(arg)
  }
  if (!baseline && positional.length > 0) baseline = positional.shift() ?? null
  candidates.push(...positional)
  return { baseline, candidates, baselineArm, candidateArm, output, json, maxChangedRows }
}

function positiveInteger(raw: string, label: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} requires a positive integer`)
  return value
}

function writeText(path: string, text: string): void {
  const resolved = resolve(path)
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, text)
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
    if (!args.baseline || args.candidates.length === 0) {
      throw new Error("baseline and at least one candidate are required")
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/drafting-run-compare.ts --baseline <drafting-isolated-report.json> --candidate <drafting-isolated-report.json> [--candidate ...] [--baseline-arm <arm>] [--candidate-arm <arm>] [--max-changed-rows <n>] [--output report.md] [--json report.json]")
    return 2
  }

  const report = buildDraftingRunComparisonReport({
    baseline: readDraftingRunRef(args.baseline, args.baselineArm),
    candidates: args.candidates.map(candidate => readDraftingRunRef(candidate, args.candidateArm)),
    maxChangedRows: args.maxChangedRows,
  })
  const rendered = renderDraftingRunComparisonReport(report)
  if (args.output) writeText(args.output, rendered)
  if (args.json) writeText(args.json, `${JSON.stringify(report, null, 2)}\n`)
  console.log(args.json && !args.output ? JSON.stringify(report, null, 2) : rendered)
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
