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
  sourcePairId: string | null
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
  planAssistReadiness?: {
    outputDir?: string
    groupCount?: number
    findingCount?: number
    exhaustionRows?: number
    pendingRows?: number
    error?: string
  }
  checkerReadiness?: {
    outputDir?: string
    groupCount?: number
    findingCount?: number
    checkerItems?: number
    blockerItems?: number
    warningItems?: number
    negativeItems?: number
    positiveItems?: number
    ambiguousItems?: number
    lowConfidenceItems?: number
    error?: string
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
    withCharacterContext: number | null
    withWorldContext: number | null
    withCanonFactContext: number | null
    withFactContinuityAnchors: number | null
    canonSourceRefs: number | null
    canonSourceRefCounts: Record<string, number>
    withStoryContext: number | null
    storyRefIds: number | null
    activeThreadIdCounts: Record<string, number>
    activePromiseIdCounts: Record<string, number>
    activePayoffIdCounts: Record<string, number>
    withReaderInfoState: number | null
    readerInfoStateChars: number | null
    missingCharacterIds: number | null
    missingCharacterIdCounts: Record<string, number>
    withResolvedReferences: number | null
    referenceLookups: number | null
    sceneCoverage: PlanningContextSceneCoverage | null
  } | null
  referenceContextAttempts: {
    sceneCount: number | null
    eventCount: number | null
    sceneRefs: string[]
  } | null
}

interface PlanningContextSceneCoverage {
  beatScenes: number | null
  withCharacterContext: number | null
  withWorldContext: number | null
  withCanonFactContext: number | null
  canonSourceRefs: number | null
  canonSourceRefCounts: Record<string, number>
  withStoryContext: number | null
  storyRefIds: number | null
  activeThreadIdCounts: Record<string, number>
  activePromiseIdCounts: Record<string, number>
  activePayoffIdCounts: Record<string, number>
  withReaderInfoState: number | null
  readerInfoStateChars: number | null
  withResolvedReferences: number | null
  referenceLookups: number | null
  referenceLlmCalls: number | null
  missingCharacterIds: number | null
  missingCharacterIdCounts: Record<string, number>
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
    referenceContextAttempts: PlanningContextDetail["referenceContextAttempts"]
  } | null
  manualReadiness: {
    planAssistFindingCount: number | null
    planAssistExhaustionRows: number | null
    planAssistPendingRows: number | null
    checkerFindingCount: number | null
    checkerItems: number | null
    checkerBlockerItems: number | null
    checkerWarningItems: number | null
    checkerNegativeItems: number | null
    checkerPositiveItems: number | null
    checkerAmbiguousItems: number | null
    checkerLowConfidenceItems: number | null
  }
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
  sourcePairId: string | null
  baseline: DraftingRunSummary
  comparisons: DraftingRunComparison[]
}

export interface DraftingRunComparison {
  candidate: DraftingRunSummary
  sourceComparison: {
    mode: "same-source" | "paired-source" | "different-source"
    sourcePairId: string | null
  }
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
    characterContextDelta: number | null
    worldContextDelta: number | null
    canonFactContextDelta: number | null
    factContinuityAnchorDelta: number | null
    canonSourceRefsDelta: number | null
    storyContextDelta: number | null
    storyRefIdsDelta: number | null
    readerInfoStateDelta: number | null
    readerInfoStateCharsDelta: number | null
    missingCharacterIdsDelta: number | null
    resolvedReferencesDelta: number | null
    referenceAttemptSceneDelta: number | null
    referenceAttemptEventDelta: number | null
    overloadedChapterDelta: number | null
    minTargetWordsPerSceneDelta: number | null
    idDeltas: {
      canonSourceRefs: Record<string, number>
      activeThreadIds: Record<string, number>
      activePromiseIds: Record<string, number>
      activePayoffIds: Record<string, number>
      missingCharacterIds: Record<string, number>
    }
    sceneCoverage: {
      beatScenesDelta: number | null
      characterContextDelta: number | null
      worldContextDelta: number | null
      canonFactContextDelta: number | null
      canonSourceRefsDelta: number | null
      storyContextDelta: number | null
      storyRefIdsDelta: number | null
      readerInfoStateDelta: number | null
      readerInfoStateCharsDelta: number | null
      resolvedReferencesDelta: number | null
      referenceLookupsDelta: number | null
      missingCharacterIdsDelta: number | null
      idDeltas: {
        canonSourceRefs: Record<string, number>
        activeThreadIds: Record<string, number>
        activePromiseIds: Record<string, number>
        activePayoffIds: Record<string, number>
        missingCharacterIds: Record<string, number>
      }
    }
  }
  manualReadiness: {
    planAssistFindingDelta: number | null
    planAssistExhaustionRowsDelta: number | null
    planAssistPendingRowsDelta: number | null
    checkerFindingDelta: number | null
    checkerItemDelta: number | null
    checkerBlockerDelta: number | null
    checkerWarningDelta: number | null
    checkerNegativeDelta: number | null
    checkerPositiveDelta: number | null
    checkerAmbiguousDelta: number | null
    checkerLowConfidenceDelta: number | null
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
  sourcePairId?: string | null
  maxChangedRows?: number
  generatedAt?: string
}): DraftingRunComparisonReport {
  const maxChangedRows = input.maxChangedRows ?? 12
  const sourcePairId = cleanOptionalString(input.sourcePairId)
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourcePairId,
    baseline: input.baseline.summary,
    comparisons: input.candidates.map(candidate =>
      compareCandidate(input.baseline, candidate, maxChangedRows, sourcePairId)
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
    const failedArm = hasFailedArm(report.baseline, candidate)
    lines.push(`## ${summaryLabel(candidate)}`)
    lines.push("")
    lines.push(`Signal: ${comparison.signal}`)
    if (comparison.sourceComparison.mode !== "same-source") {
      lines.push(
        `Source lineage: ${comparison.sourceComparison.mode}` +
          `${comparison.sourceComparison.sourcePairId ? ` (${comparison.sourceComparison.sourcePairId})` : ""}; ` +
          `${report.baseline.source} -> ${candidate.source}`,
      )
    }
    if (failedArm) {
      lines.push(
        `Words: ${candidate.totalWords}/${candidate.totalTarget} (${candidate.meanRatio.toFixed(3)}) ` +
          `vs ${report.baseline.totalWords}/${report.baseline.totalTarget} (${report.baseline.meanRatio.toFixed(3)}); ` +
          "delta=n/a (failed arm; reported totals may be partial)",
      )
    } else {
      lines.push(
        `Words: ${candidate.totalWords}/${candidate.totalTarget} (${candidate.meanRatio.toFixed(3)}) ` +
          `vs ${report.baseline.totalWords}/${report.baseline.totalTarget} (${report.baseline.meanRatio.toFixed(3)}); ` +
          `delta=${formatSigned(comparison.length.totalWordsDelta)} words, ratio=${formatSignedNumber(comparison.length.meanRatioDelta, 3)}`,
      )
    }
    lines.push(
      `Telemetry: proseLows=${failedArm ? "n/a" : formatDelta(comparison.proseSemantic.lowRowsDelta)}, ` +
        `sceneLows=${failedArm ? "n/a" : formatDelta(comparison.sceneSemantic.lowRowsDelta)}, ` +
        `contextGaps=${formatDelta(comparison.planningContext.gapDelta)}, ` +
        `readiness=${formatDelta(comparison.planningContext.readinessFindingDelta)}, ` +
        `promptRatio=${formatNullableDelta(comparison.prompt.avgCharsRatioDelta, 3)}`,
    )
    if (hasManualReadinessSignal(report.baseline.manualReadiness) || hasManualReadinessSignal(candidate.manualReadiness)) {
      const baseManual = report.baseline.manualReadiness
      const candidateManual = candidate.manualReadiness
      lines.push(
        `Manual readiness: planAssist=${formatTransition(baseManual.planAssistFindingCount, candidateManual.planAssistFindingCount)} ` +
          `(pending=${formatTransition(baseManual.planAssistPendingRows, candidateManual.planAssistPendingRows)}), ` +
          `checker=${formatTransition(baseManual.checkerFindingCount, candidateManual.checkerFindingCount)} ` +
          `(items=${formatTransition(baseManual.checkerItems, candidateManual.checkerItems)}, ` +
          `blockers=${formatTransition(baseManual.checkerBlockerItems, candidateManual.checkerBlockerItems)}, ` +
          `warnings=${formatTransition(baseManual.checkerWarningItems, candidateManual.checkerWarningItems)}, ` +
          `negative=${formatTransition(baseManual.checkerNegativeItems, candidateManual.checkerNegativeItems)}, ` +
          `positive=${formatTransition(baseManual.checkerPositiveItems, candidateManual.checkerPositiveItems)}, ` +
          `ambiguous=${formatTransition(baseManual.checkerAmbiguousItems, candidateManual.checkerAmbiguousItems)}, ` +
          `lowConfidence=${formatTransition(baseManual.checkerLowConfidenceItems, candidateManual.checkerLowConfidenceItems)})`,
      )
    }
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
    const baselineContext = report.baseline.planningContext?.downstream
    const candidateContext = candidate.planningContext?.downstream
    if (baselineContext || candidateContext) {
      lines.push(
        `Context coverage: character=${formatTransition(baselineContext?.withCharacterContext, candidateContext?.withCharacterContext)}, ` +
          `world=${formatTransition(baselineContext?.withWorldContext, candidateContext?.withWorldContext)}, ` +
          `canon=${formatTransition(baselineContext?.withCanonFactContext, candidateContext?.withCanonFactContext)} ` +
          `(sourceRefs=${formatTransition(baselineContext?.canonSourceRefs, candidateContext?.canonSourceRefs)}, ` +
          `factAnchors=${formatTransition(baselineContext?.withFactContinuityAnchors, candidateContext?.withFactContinuityAnchors)}), ` +
          `story=${formatTransition(baselineContext?.withStoryContext, candidateContext?.withStoryContext)} ` +
          `(storyRefs=${formatTransition(baselineContext?.storyRefIds, candidateContext?.storyRefIds)}), ` +
          `reader=${formatTransition(baselineContext?.withReaderInfoState, candidateContext?.withReaderInfoState)} ` +
          `(chars=${formatTransition(baselineContext?.readerInfoStateChars, candidateContext?.readerInfoStateChars)}), ` +
          `refs=${formatTransition(baselineContext?.withResolvedReferences, candidateContext?.withResolvedReferences)} ` +
          `(lookups=${formatTransition(baselineContext?.referenceLookups, candidateContext?.referenceLookups)})`,
      )
      const contextIdDeltas = formatContextIdDeltas(comparison.planningContext.idDeltas)
      if (contextIdDeltas) lines.push(`Context ID deltas: ${contextIdDeltas}`)
      const baselineSceneCoverage = baselineContext?.sceneCoverage ?? null
      const candidateSceneCoverage = candidateContext?.sceneCoverage ?? null
      if (baselineSceneCoverage || candidateSceneCoverage) {
        lines.push(
          `Scene-normalized context: scenes=${formatTransition(baselineSceneCoverage?.beatScenes, candidateSceneCoverage?.beatScenes)}, ` +
            `character=${formatTransition(baselineSceneCoverage?.withCharacterContext, candidateSceneCoverage?.withCharacterContext)}, ` +
            `world=${formatTransition(baselineSceneCoverage?.withWorldContext, candidateSceneCoverage?.withWorldContext)}, ` +
            `canon=${formatTransition(baselineSceneCoverage?.withCanonFactContext, candidateSceneCoverage?.withCanonFactContext)} ` +
            `(sourceRefs=${formatTransition(baselineSceneCoverage?.canonSourceRefs, candidateSceneCoverage?.canonSourceRefs)}), ` +
            `story=${formatTransition(baselineSceneCoverage?.withStoryContext, candidateSceneCoverage?.withStoryContext)} ` +
            `(storyRefs=${formatTransition(baselineSceneCoverage?.storyRefIds, candidateSceneCoverage?.storyRefIds)}), ` +
            `reader=${formatTransition(baselineSceneCoverage?.withReaderInfoState, candidateSceneCoverage?.withReaderInfoState)} ` +
            `(chars=${formatTransition(baselineSceneCoverage?.readerInfoStateChars, candidateSceneCoverage?.readerInfoStateChars)}), ` +
            `refs=${formatTransition(baselineSceneCoverage?.withResolvedReferences, candidateSceneCoverage?.withResolvedReferences)} ` +
            `(lookups=${formatTransition(baselineSceneCoverage?.referenceLookups, candidateSceneCoverage?.referenceLookups)}), ` +
            `missingChars=${formatTransition(baselineSceneCoverage?.missingCharacterIds, candidateSceneCoverage?.missingCharacterIds)}`,
        )
        const sceneContextIdDeltas = formatContextIdDeltas(comparison.planningContext.sceneCoverage.idDeltas)
        if (sceneContextIdDeltas) lines.push(`Scene-normalized ID deltas: ${sceneContextIdDeltas}`)
      }
    }
    const baselineReferenceAttempts = report.baseline.planningContext?.referenceContextAttempts
    const candidateReferenceAttempts = candidate.planningContext?.referenceContextAttempts
    if (hasReferenceAttemptSignal(baselineReferenceAttempts) || hasReferenceAttemptSignal(candidateReferenceAttempts)) {
      lines.push(
        `Reference attempts: scenes=${formatTransition(baselineReferenceAttempts?.sceneCount, candidateReferenceAttempts?.sceneCount)}, ` +
          `events=${formatTransition(baselineReferenceAttempts?.eventCount, candidateReferenceAttempts?.eventCount)}`,
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
  sourcePairId: string | null,
): DraftingRunComparison {
  const sceneComparison = compareSceneSemanticReports(baseline, candidate)
  const sourceComparison = sourceComparisonFor(baseline.summary.source, candidate.summary.source, sourcePairId)
  const aggregateSceneComparison =
    sourceComparison.mode === "paired-source" && sceneComparison?.verdict === "incomplete"
      ? aggregateSceneSemanticComparison(baseline.summary, candidate.summary)
      : null
  const effectiveSceneComparison = aggregateSceneComparison ?? sceneComparison
  const changedRows = sceneComparison
    ? sceneComparison.rowChanges
      .filter(row => row.status !== "unchanged")
      .sort(rowChangeSort)
      .slice(0, maxChangedRows)
    : []
  const comparison: DraftingRunComparison = {
    candidate: candidate.summary,
    sourceComparison,
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
      characterContextDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.withCharacterContext ?? null,
        candidate.summary.planningContext?.downstream?.withCharacterContext ?? null,
      ),
      worldContextDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.withWorldContext ?? null,
        candidate.summary.planningContext?.downstream?.withWorldContext ?? null,
      ),
      canonFactContextDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.withCanonFactContext ?? null,
        candidate.summary.planningContext?.downstream?.withCanonFactContext ?? null,
      ),
      factContinuityAnchorDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.withFactContinuityAnchors ?? null,
        candidate.summary.planningContext?.downstream?.withFactContinuityAnchors ?? null,
      ),
      canonSourceRefsDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.canonSourceRefs ?? null,
        candidate.summary.planningContext?.downstream?.canonSourceRefs ?? null,
      ),
      storyContextDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.withStoryContext ?? null,
        candidate.summary.planningContext?.downstream?.withStoryContext ?? null,
      ),
      storyRefIdsDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.storyRefIds ?? null,
        candidate.summary.planningContext?.downstream?.storyRefIds ?? null,
      ),
      readerInfoStateDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.withReaderInfoState ?? null,
        candidate.summary.planningContext?.downstream?.withReaderInfoState ?? null,
      ),
      readerInfoStateCharsDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.readerInfoStateChars ?? null,
        candidate.summary.planningContext?.downstream?.readerInfoStateChars ?? null,
      ),
      missingCharacterIdsDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.missingCharacterIds ?? null,
        candidate.summary.planningContext?.downstream?.missingCharacterIds ?? null,
      ),
      resolvedReferencesDelta: nullableDelta(
        baseline.summary.planningContext?.downstream?.withResolvedReferences ?? null,
        candidate.summary.planningContext?.downstream?.withResolvedReferences ?? null,
      ),
      referenceAttemptSceneDelta: nullableDelta(
        baseline.summary.planningContext?.referenceContextAttempts?.sceneCount ?? null,
        candidate.summary.planningContext?.referenceContextAttempts?.sceneCount ?? null,
      ),
      referenceAttemptEventDelta: nullableDelta(
        baseline.summary.planningContext?.referenceContextAttempts?.eventCount ?? null,
        candidate.summary.planningContext?.referenceContextAttempts?.eventCount ?? null,
      ),
      overloadedChapterDelta: nullableDelta(
        baseline.summary.planningContext?.sceneLoad?.overloadedChapterCount ?? null,
        candidate.summary.planningContext?.sceneLoad?.overloadedChapterCount ?? null,
      ),
      minTargetWordsPerSceneDelta: nullableDelta(
        baseline.summary.planningContext?.sceneLoad?.minTargetWordsPerScene ?? null,
        candidate.summary.planningContext?.sceneLoad?.minTargetWordsPerScene ?? null,
      ),
      idDeltas: {
        canonSourceRefs: recordDelta(
          baseline.summary.planningContext?.downstream?.canonSourceRefCounts,
          candidate.summary.planningContext?.downstream?.canonSourceRefCounts,
        ),
        activeThreadIds: recordDelta(
          baseline.summary.planningContext?.downstream?.activeThreadIdCounts,
          candidate.summary.planningContext?.downstream?.activeThreadIdCounts,
        ),
        activePromiseIds: recordDelta(
          baseline.summary.planningContext?.downstream?.activePromiseIdCounts,
          candidate.summary.planningContext?.downstream?.activePromiseIdCounts,
        ),
        activePayoffIds: recordDelta(
          baseline.summary.planningContext?.downstream?.activePayoffIdCounts,
          candidate.summary.planningContext?.downstream?.activePayoffIdCounts,
        ),
        missingCharacterIds: recordDelta(
          baseline.summary.planningContext?.downstream?.missingCharacterIdCounts,
          candidate.summary.planningContext?.downstream?.missingCharacterIdCounts,
        ),
      },
      sceneCoverage: compareSceneCoverage(
        baseline.summary.planningContext?.downstream?.sceneCoverage ?? null,
        candidate.summary.planningContext?.downstream?.sceneCoverage ?? null,
      ),
    },
    manualReadiness: {
      planAssistFindingDelta: nullableDelta(
        baseline.summary.manualReadiness.planAssistFindingCount,
        candidate.summary.manualReadiness.planAssistFindingCount,
      ),
      planAssistExhaustionRowsDelta: nullableDelta(
        baseline.summary.manualReadiness.planAssistExhaustionRows,
        candidate.summary.manualReadiness.planAssistExhaustionRows,
      ),
      planAssistPendingRowsDelta: nullableDelta(
        baseline.summary.manualReadiness.planAssistPendingRows,
        candidate.summary.manualReadiness.planAssistPendingRows,
      ),
      checkerFindingDelta: nullableDelta(
        baseline.summary.manualReadiness.checkerFindingCount,
        candidate.summary.manualReadiness.checkerFindingCount,
      ),
      checkerItemDelta: nullableDelta(
        baseline.summary.manualReadiness.checkerItems,
        candidate.summary.manualReadiness.checkerItems,
      ),
      checkerBlockerDelta: nullableDelta(
        baseline.summary.manualReadiness.checkerBlockerItems,
        candidate.summary.manualReadiness.checkerBlockerItems,
      ),
      checkerWarningDelta: nullableDelta(
        baseline.summary.manualReadiness.checkerWarningItems,
        candidate.summary.manualReadiness.checkerWarningItems,
      ),
      checkerNegativeDelta: nullableDelta(
        baseline.summary.manualReadiness.checkerNegativeItems,
        candidate.summary.manualReadiness.checkerNegativeItems,
      ),
      checkerPositiveDelta: nullableDelta(
        baseline.summary.manualReadiness.checkerPositiveItems,
        candidate.summary.manualReadiness.checkerPositiveItems,
      ),
      checkerAmbiguousDelta: nullableDelta(
        baseline.summary.manualReadiness.checkerAmbiguousItems,
        candidate.summary.manualReadiness.checkerAmbiguousItems,
      ),
      checkerLowConfidenceDelta: nullableDelta(
        baseline.summary.manualReadiness.checkerLowConfidenceItems,
        candidate.summary.manualReadiness.checkerLowConfidenceItems,
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
      comparisonVerdict: effectiveSceneComparison?.verdict ?? null,
      comparedRows: sceneComparison?.comparedRows ?? null,
      missingInCandidate: sceneComparison?.missingInCandidate.length ?? null,
      missingInBaseline: sceneComparison?.missingInBaseline.length ?? null,
      dimensions: effectiveSceneComparison?.dimensions ?? [],
      changedRows,
    },
  }
  comparison.reasons = evidenceReasons(baseline.summary, candidate.summary, comparison, Boolean(aggregateSceneComparison))
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
  const manualReadiness = loadManualReadinessSummary(reportDir, report.targetPrefix ?? "unknown", arm.arm ?? "unknown", arm)
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
      referenceContextAttempts: contextDetail?.referenceContextAttempts ?? null,
    } : null,
    manualReadiness,
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

function loadManualReadinessSummary(
  reportDir: string,
  targetPrefix: string,
  armName: string,
  arm: DraftingArmArtifact,
): DraftingRunSummary["manualReadiness"] {
  const planAssist = loadPlanAssistReadinessSummary(reportDir, targetPrefix, armName, arm)
  const checker = loadCheckerReadinessSummary(reportDir, targetPrefix, armName, arm)
  return {
    planAssistFindingCount: planAssist.findingCount,
    planAssistExhaustionRows: planAssist.exhaustionRows,
    planAssistPendingRows: planAssist.pendingRows,
    checkerFindingCount: checker.findingCount,
    checkerItems: checker.checkerItems,
    checkerBlockerItems: checker.blockerItems,
    checkerWarningItems: checker.warningItems,
    checkerNegativeItems: checker.negativeItems,
    checkerPositiveItems: checker.positiveItems,
    checkerAmbiguousItems: checker.ambiguousItems,
    checkerLowConfidenceItems: checker.lowConfidenceItems,
  }
}

function loadPlanAssistReadinessSummary(
  reportDir: string,
  targetPrefix: string,
  armName: string,
  arm: DraftingArmArtifact,
): {
  findingCount: number | null
  exhaustionRows: number | null
  pendingRows: number | null
} {
  if (arm.planAssistReadiness) {
    return {
      findingCount: finiteOrNull(arm.planAssistReadiness.findingCount),
      exhaustionRows: finiteOrNull(arm.planAssistReadiness.exhaustionRows),
      pendingRows: finiteOrNull(arm.planAssistReadiness.pendingRows),
    }
  }
  const path = resolveArtifactPath(
    reportDir,
    join("output/plan-assist-readiness", targetPrefix, armName, "plan-assist-readiness.json"),
  )
  if (!path) return { findingCount: null, exhaustionRows: null, pendingRows: null }
  try {
    const aggregate = JSON.parse(readFileSync(path, "utf8")) as {
      findingCount?: unknown
      exhaustionRows?: unknown
      pendingRows?: unknown
    }
    return {
      findingCount: finiteOrNull(aggregate.findingCount),
      exhaustionRows: finiteOrNull(aggregate.exhaustionRows),
      pendingRows: finiteOrNull(aggregate.pendingRows),
    }
  } catch {
    return { findingCount: null, exhaustionRows: null, pendingRows: null }
  }
}

function loadCheckerReadinessSummary(
  reportDir: string,
  targetPrefix: string,
  armName: string,
  arm: DraftingArmArtifact,
): {
  findingCount: number | null
  checkerItems: number | null
  blockerItems: number | null
  warningItems: number | null
  negativeItems: number | null
  positiveItems: number | null
  ambiguousItems: number | null
  lowConfidenceItems: number | null
} {
  const sidecar = loadCheckerReadinessSidecarSummary(reportDir, targetPrefix, armName)
  if (arm.checkerReadiness) {
    return {
      findingCount: finiteOrNull(arm.checkerReadiness.findingCount) ?? sidecar.findingCount,
      checkerItems: finiteOrNull(arm.checkerReadiness.checkerItems) ?? sidecar.checkerItems,
      blockerItems: finiteOrNull(arm.checkerReadiness.blockerItems) ?? sidecar.blockerItems,
      warningItems: finiteOrNull(arm.checkerReadiness.warningItems) ?? sidecar.warningItems,
      negativeItems: finiteOrNull(arm.checkerReadiness.negativeItems) ?? sidecar.negativeItems,
      positiveItems: finiteOrNull(arm.checkerReadiness.positiveItems) ?? sidecar.positiveItems,
      ambiguousItems: finiteOrNull(arm.checkerReadiness.ambiguousItems) ?? sidecar.ambiguousItems,
      lowConfidenceItems: finiteOrNull(arm.checkerReadiness.lowConfidenceItems) ?? sidecar.lowConfidenceItems,
    }
  }
  return sidecar
}

function loadCheckerReadinessSidecarSummary(
  reportDir: string,
  targetPrefix: string,
  armName: string,
): {
  findingCount: number | null
  checkerItems: number | null
  blockerItems: number | null
  warningItems: number | null
  negativeItems: number | null
  positiveItems: number | null
  ambiguousItems: number | null
  lowConfidenceItems: number | null
} {
  const dir = join("output/checker-readiness", targetPrefix, armName)
  const readinessPath = resolveArtifactPath(reportDir, join(dir, "checker-readiness.json"))
  const warningPath = resolveArtifactPath(reportDir, join(dir, "checker-warning-report.json"))
  let findingCount: number | null = null
  let checkerItems: number | null = null
  let blockerItems: number | null = null
  let warningItems: number | null = null
  let negativeItems: number | null = null
  let positiveItems: number | null = null
  let ambiguousItems: number | null = null
  let lowConfidenceItems: number | null = null
  if (readinessPath) {
    try {
      const aggregate = JSON.parse(readFileSync(readinessPath, "utf8")) as { findingCount?: unknown }
      findingCount = finiteOrNull(aggregate.findingCount)
    } catch {
      findingCount = null
    }
  }
  if (warningPath) {
    try {
      const warning = JSON.parse(readFileSync(warningPath, "utf8")) as {
        totalItems?: unknown
        bySeverity?: Record<string, unknown>
        byPolarity?: Record<string, unknown>
        byCalibration?: Record<string, unknown>
      }
      checkerItems = finiteOrNull(warning.totalItems)
      blockerItems = finiteOrNull(warning.bySeverity?.blocker)
      warningItems = finiteOrNull(warning.bySeverity?.warning)
      negativeItems = finiteOrNull(warning.byPolarity?.negative)
      positiveItems = finiteOrNull(warning.byPolarity?.positive)
      ambiguousItems = finiteOrNull(warning.byPolarity?.ambiguous)
      lowConfidenceItems = finiteOrNull(warning.byCalibration?.["low-confidence"])
    } catch {
      checkerItems = null
      blockerItems = null
      warningItems = null
      negativeItems = null
      positiveItems = null
      ambiguousItems = null
      lowConfidenceItems = null
    }
  }
  return {
    findingCount,
    checkerItems,
    blockerItems,
    warningItems,
    negativeItems,
    positiveItems,
    ambiguousItems,
    lowConfidenceItems,
  }
}

function hasManualReadinessSignal(readiness: DraftingRunSummary["manualReadiness"] | undefined | null): boolean {
  if (!readiness) return false
  return [
    readiness.planAssistFindingCount,
    readiness.planAssistExhaustionRows,
    readiness.planAssistPendingRows,
    readiness.checkerFindingCount,
    readiness.checkerItems,
    readiness.checkerBlockerItems,
    readiness.checkerWarningItems,
    readiness.checkerNegativeItems,
    readiness.checkerPositiveItems,
    readiness.checkerAmbiguousItems,
    readiness.checkerLowConfidenceItems,
  ].some(value => typeof value === "number" && Number.isFinite(value) && value !== 0)
}

function hasReferenceAttemptSignal(
  attempts: PlanningContextDetail["referenceContextAttempts"] | undefined | null,
): boolean {
  return (attempts?.sceneCount ?? 0) > 0 || (attempts?.eventCount ?? 0) > 0
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
      referenceContextAttempts?: Array<{
        eventCount?: unknown
        eventIds?: unknown
        sceneRef?: unknown
      }>
    }
    const sceneLoad = report.upstream?.sceneLoad ?? null
    const downstream = report.downstream ?? null
    const referenceContextAttempts = Array.isArray(report.referenceContextAttempts)
      ? report.referenceContextAttempts
      : []
    return {
      sceneLoad: sceneLoad ? {
        maxScenesPerChapter: finiteOrNull(sceneLoad.maxScenesPerChapter),
        minTargetWordsPerScene: finiteOrNull(sceneLoad.minTargetWordsPerScene),
        denseChapterCount: finiteOrNull(sceneLoad.denseChapterCount),
        overloadedChapterCount: finiteOrNull(sceneLoad.overloadedChapterCount),
      } : null,
      downstream: downstream ? {
        events: finiteOrNull(downstream.events),
        withCharacterContext: finiteOrNull(downstream.withCharacterContext),
        withWorldContext: finiteOrNull(downstream.withWorldContext),
        withCanonFactContext: finiteOrNull(downstream.withCanonFactContext),
        withFactContinuityAnchors: finiteOrNull(downstream.withFactContinuityAnchors),
        canonSourceRefs: finiteOrNull(downstream.canonSourceRefs),
        canonSourceRefCounts: numberRecord(downstream.canonSourceRefCounts),
        withStoryContext: finiteOrNull(downstream.withStoryContext),
        storyRefIds: finiteOrNull(downstream.storyRefIds),
        activeThreadIdCounts: numberRecord(downstream.activeThreadIdCounts),
        activePromiseIdCounts: numberRecord(downstream.activePromiseIdCounts),
        activePayoffIdCounts: numberRecord(downstream.activePayoffIdCounts),
        withReaderInfoState: finiteOrNull(downstream.withReaderInfoState),
        readerInfoStateChars: finiteOrNull(downstream.readerInfoStateChars),
        missingCharacterIds: finiteOrNull(downstream.missingCharacterIds),
        missingCharacterIdCounts: numberRecord(downstream.missingCharacterIdCounts),
        withResolvedReferences: finiteOrNull(downstream.withResolvedReferences),
        referenceLookups: finiteOrNull(downstream.referenceLookups),
        sceneCoverage: readSceneCoverage(downstream.sceneCoverage),
      } : null,
      referenceContextAttempts: {
        sceneCount: referenceContextAttempts.length,
        eventCount: referenceContextAttempts.reduce((sum, attempt) => {
          const eventCount = finiteOrNull(attempt.eventCount)
          if (eventCount !== null) return sum + eventCount
          return Array.isArray(attempt.eventIds) ? sum + attempt.eventIds.length : sum
        }, 0),
        sceneRefs: referenceContextAttempts
          .map(attempt => typeof attempt.sceneRef === "string" ? attempt.sceneRef : null)
          .filter((ref): ref is string => ref !== null),
      },
    }
  } catch {
    return null
  }
}

function readSceneCoverage(value: unknown): PlanningContextSceneCoverage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  return {
    beatScenes: finiteOrNull(row.beatScenes),
    withCharacterContext: finiteOrNull(row.withCharacterContext),
    withWorldContext: finiteOrNull(row.withWorldContext),
    withCanonFactContext: finiteOrNull(row.withCanonFactContext),
    canonSourceRefs: finiteOrNull(row.canonSourceRefs),
    canonSourceRefCounts: numberRecord(row.canonSourceRefCounts),
    withStoryContext: finiteOrNull(row.withStoryContext),
    storyRefIds: finiteOrNull(row.storyRefIds),
    activeThreadIdCounts: numberRecord(row.activeThreadIdCounts),
    activePromiseIdCounts: numberRecord(row.activePromiseIdCounts),
    activePayoffIdCounts: numberRecord(row.activePayoffIdCounts),
    withReaderInfoState: finiteOrNull(row.withReaderInfoState),
    readerInfoStateChars: finiteOrNull(row.readerInfoStateChars),
    withResolvedReferences: finiteOrNull(row.withResolvedReferences),
    referenceLookups: finiteOrNull(row.referenceLookups),
    referenceLlmCalls: finiteOrNull(row.referenceLlmCalls),
    missingCharacterIds: finiteOrNull(row.missingCharacterIds),
    missingCharacterIdCounts: numberRecord(row.missingCharacterIdCounts),
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

function sourceComparisonFor(
  baselineSource: string,
  candidateSource: string,
  sourcePairId: string | null,
): DraftingRunComparison["sourceComparison"] {
  if (candidateSource === baselineSource) {
    return { mode: "same-source", sourcePairId: null }
  }
  if (sourcePairId) {
    return { mode: "paired-source", sourcePairId }
  }
  return { mode: "different-source", sourcePairId: null }
}

function aggregateSceneSemanticComparison(
  baseline: DraftingRunSummary,
  candidate: DraftingRunSummary,
): Pick<SceneSemanticComparison, "verdict" | "dimensions"> | null {
  const dimensions = aggregateSceneSemanticDimensions(baseline.sceneSemantic?.dimensions ?? [], candidate.sceneSemantic?.dimensions ?? [])
  if (dimensions.length === 0) return null
  return {
    verdict: aggregateSceneSemanticVerdict(dimensions),
    dimensions,
  }
}

function aggregateSceneSemanticDimensions(
  baseline: NonNullable<DraftingRunSummary["sceneSemantic"]>["dimensions"],
  candidate: NonNullable<DraftingRunSummary["sceneSemantic"]>["dimensions"],
): SceneSemanticComparison["dimensions"] {
  const baselineByDimension = new Map(baseline.map(row => [row.dimension, row]))
  const candidateByDimension = new Map(candidate.map(row => [row.dimension, row]))
  const dimensions = [...new Set([...baselineByDimension.keys(), ...candidateByDimension.keys()])]
    .sort((a, b) => a.localeCompare(b))
  return dimensions.map(dimension => {
    const baselineRow = baselineByDimension.get(dimension)
    const candidateRow = candidateByDimension.get(dimension)
    const baselineMean = baselineRow?.meanOrdinal ?? null
    const candidateMean = candidateRow?.meanOrdinal ?? null
    const baselineLowRows = baselineRow?.lowCount ?? 0
    const candidateLowRows = candidateRow?.lowCount ?? 0
    return {
      dimension,
      comparedRows: Math.min(baselineRow?.count ?? 0, candidateRow?.count ?? 0),
      baselineMean,
      candidateMean,
      meanDelta: baselineMean === null || candidateMean === null ? null : candidateMean - baselineMean,
      baselineLowRows,
      candidateLowRows,
      lowDelta: candidateLowRows - baselineLowRows,
      resolvedLowRows: 0,
      regressedLowRows: 0,
      improvedRows: 0,
      worsenedRows: 0,
    }
  })
}

function aggregateSceneSemanticVerdict(
  dimensions: SceneSemanticComparison["dimensions"],
): SceneSemanticComparison["verdict"] {
  const lowDeltas = dimensions.map(dim => dim.lowDelta).filter(value => value !== 0)
  const meanDeltas = dimensions
    .map(dim => dim.meanDelta)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value !== 0)
  const improvedLow = lowDeltas.some(value => value < 0)
  const regressedLow = lowDeltas.some(value => value > 0)
  if (improvedLow && regressedLow) return "mixed"
  if (regressedLow) return "regressed"
  if (improvedLow) return "improved"
  const improvedMean = meanDeltas.some(value => value > 0)
  const regressedMean = meanDeltas.some(value => value < 0)
  if (improvedMean && regressedMean) return "mixed"
  if (regressedMean) return "regressed"
  if (improvedMean) return "improved"
  return "unchanged"
}

function evidenceReasons(
  baseline: DraftingRunSummary,
  candidate: DraftingRunSummary,
  comparison: DraftingRunComparison,
  usedAggregateSceneSemantic: boolean,
): string[] {
  const reasons: string[] = []
  if (baseline.error) reasons.push(`Baseline arm has error: ${baseline.error}`)
  if (candidate.error) reasons.push(`Candidate arm has error: ${candidate.error}`)
  const failedArm = hasFailedArm(baseline, candidate)
  if (failedArm) {
    reasons.push("Length and semantic deltas are non-comparable because at least one arm failed before producing complete evidence.")
  }
  if (baseline.cleanSource === false || candidate.cleanSource === false) {
    reasons.push("At least one report is not marked as a clean drafting source.")
  }
  if (comparison.sourceComparison.mode === "paired-source") {
    reasons.push(
      `Reports use paired-source lineage ${comparison.sourceComparison.sourcePairId}: ` +
        `${baseline.source} -> ${candidate.source}.`,
    )
  } else if (candidate.source !== baseline.source) {
    reasons.push(`Reports use different source ids: ${baseline.source} -> ${candidate.source}.`)
  }
  if (!failedArm && comparison.length.meanRatioDelta <= -0.05) {
    reasons.push(`Candidate is shorter by ${Math.abs(comparison.length.totalWordsDelta)} words and ${Math.abs(comparison.length.meanRatioDelta).toFixed(3)} ratio points.`)
  } else if (!failedArm && comparison.length.meanRatioDelta >= 0.05) {
    reasons.push(`Candidate is longer by ${comparison.length.totalWordsDelta} words and ${comparison.length.meanRatioDelta.toFixed(3)} ratio points.`)
  }
  if (!failedArm && positiveDelta(comparison.sceneSemantic.lowRowsDelta)) {
    reasons.push(`Scene-semantic lows worsened by ${comparison.sceneSemantic.lowRowsDelta}.`)
  } else if (!failedArm && negativeDelta(comparison.sceneSemantic.lowRowsDelta)) {
    reasons.push(`Scene-semantic lows improved by ${Math.abs(comparison.sceneSemantic.lowRowsDelta!)}.`)
  }
  if (!failedArm && positiveDelta(comparison.proseSemantic.lowRowsDelta)) {
    reasons.push(`Prose-semantic lows worsened by ${comparison.proseSemantic.lowRowsDelta}.`)
  } else if (!failedArm && negativeDelta(comparison.proseSemantic.lowRowsDelta)) {
    reasons.push(`Prose-semantic lows improved by ${Math.abs(comparison.proseSemantic.lowRowsDelta!)}.`)
  }
  if (usedAggregateSceneSemantic && comparison.sceneSemantic.comparisonVerdict) {
    reasons.push(`Paired-source aggregate scene-semantic verdict is ${comparison.sceneSemantic.comparisonVerdict}.`)
    reasons.push("Exact scene-semantic rows did not fully align; signal uses paired-source aggregate dimension telemetry.")
  } else if (comparison.sceneSemantic.comparisonVerdict) {
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
  if (rawContextChangedButSceneCoverageStable(comparison)) {
    reasons.push("Aggregate context deltas changed with writer event volume; scene-normalized context coverage was stable.")
  }
  if (positiveDelta(comparison.manualReadiness.planAssistFindingDelta)) {
    reasons.push(`Plan-Assist readiness findings increased by ${comparison.manualReadiness.planAssistFindingDelta}.`)
  }
  if (positiveDelta(comparison.manualReadiness.checkerBlockerDelta)) {
    reasons.push(`Checker blocker items increased by ${comparison.manualReadiness.checkerBlockerDelta}.`)
  }
  if (positiveDelta(comparison.manualReadiness.checkerNegativeDelta)) {
    reasons.push(`Checker negative-polarity items increased by ${comparison.manualReadiness.checkerNegativeDelta}.`)
  }
  if (positiveDelta(comparison.manualReadiness.checkerFindingDelta)) {
    reasons.push(`Checker readiness findings increased by ${comparison.manualReadiness.checkerFindingDelta}.`)
  }
  if (!failedArm && comparison.length.meanRatioDelta < 0 && (
    positiveDelta(comparison.sceneSemantic.lowRowsDelta) ||
    positiveDelta(comparison.proseSemantic.lowRowsDelta) ||
    comparison.sceneSemantic.comparisonVerdict === "regressed"
  )) {
    reasons.push("Length improved while semantic evidence regressed; treat the candidate as source-sensitive rather than a default candidate.")
  }
  if (reasons.length === 0) reasons.push("No material telemetry difference was detected.")
  return reasons
}

function rawContextChangedButSceneCoverageStable(comparison: DraftingRunComparison): boolean {
  const rawDeltas = [
    comparison.planningContext.canonSourceRefsDelta,
    comparison.planningContext.storyRefIdsDelta,
    comparison.planningContext.readerInfoStateDelta,
    comparison.planningContext.readerInfoStateCharsDelta,
    comparison.planningContext.missingCharacterIdsDelta,
    comparison.planningContext.referenceAttemptEventDelta,
  ]
  const normalizedDeltas = [
    comparison.planningContext.sceneCoverage.beatScenesDelta,
    comparison.planningContext.sceneCoverage.canonSourceRefsDelta,
    comparison.planningContext.sceneCoverage.storyRefIdsDelta,
    comparison.planningContext.sceneCoverage.readerInfoStateDelta,
    comparison.planningContext.sceneCoverage.readerInfoStateCharsDelta,
    comparison.planningContext.sceneCoverage.missingCharacterIdsDelta,
    comparison.planningContext.sceneCoverage.referenceLookupsDelta,
  ]
  return rawDeltas.some(value => typeof value === "number" && value !== 0) &&
    normalizedDeltas.some(value => value !== null) &&
    normalizedDeltas.every(value => value === null || value === 0)
}

function evidenceSignal(baseline: DraftingRunSummary, comparison: DraftingRunComparison): EvidenceSignal {
  if (baseline.error || comparison.candidate.error) return "incomplete"
  if (comparison.sourceComparison.mode === "different-source") return "incomplete"
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

function hasFailedArm(baseline: DraftingRunSummary, candidate: DraftingRunSummary): boolean {
  return Boolean(baseline.error || candidate.error)
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

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw === 0) continue
    const cleanKey = key.trim()
    if (!cleanKey || cleanKey === "null" || cleanKey === "undefined") continue
    out[cleanKey] = raw
  }
  return out
}

function cleanOptionalString(value: string | null | undefined): string | null {
  const clean = typeof value === "string" ? value.trim() : ""
  return clean.length > 0 ? clean : null
}

function recordDelta(
  baseline: Record<string, number> | undefined | null,
  candidate: Record<string, number> | undefined | null,
): Record<string, number> {
  const keys = new Set([
    ...Object.keys(baseline ?? {}),
    ...Object.keys(candidate ?? {}),
  ])
  const out: Record<string, number> = {}
  for (const key of keys) {
    const delta = (candidate?.[key] ?? 0) - (baseline?.[key] ?? 0)
    if (delta !== 0) out[key] = delta
  }
  return out
}

function compareSceneCoverage(
  baseline: PlanningContextSceneCoverage | null,
  candidate: PlanningContextSceneCoverage | null,
): DraftingRunComparison["planningContext"]["sceneCoverage"] {
  return {
    beatScenesDelta: nullableDelta(baseline?.beatScenes ?? null, candidate?.beatScenes ?? null),
    characterContextDelta: nullableDelta(baseline?.withCharacterContext ?? null, candidate?.withCharacterContext ?? null),
    worldContextDelta: nullableDelta(baseline?.withWorldContext ?? null, candidate?.withWorldContext ?? null),
    canonFactContextDelta: nullableDelta(baseline?.withCanonFactContext ?? null, candidate?.withCanonFactContext ?? null),
    canonSourceRefsDelta: nullableDelta(baseline?.canonSourceRefs ?? null, candidate?.canonSourceRefs ?? null),
    storyContextDelta: nullableDelta(baseline?.withStoryContext ?? null, candidate?.withStoryContext ?? null),
    storyRefIdsDelta: nullableDelta(baseline?.storyRefIds ?? null, candidate?.storyRefIds ?? null),
    readerInfoStateDelta: nullableDelta(baseline?.withReaderInfoState ?? null, candidate?.withReaderInfoState ?? null),
    readerInfoStateCharsDelta: nullableDelta(baseline?.readerInfoStateChars ?? null, candidate?.readerInfoStateChars ?? null),
    resolvedReferencesDelta: nullableDelta(baseline?.withResolvedReferences ?? null, candidate?.withResolvedReferences ?? null),
    referenceLookupsDelta: nullableDelta(baseline?.referenceLookups ?? null, candidate?.referenceLookups ?? null),
    missingCharacterIdsDelta: nullableDelta(baseline?.missingCharacterIds ?? null, candidate?.missingCharacterIds ?? null),
    idDeltas: {
      canonSourceRefs: recordDelta(baseline?.canonSourceRefCounts, candidate?.canonSourceRefCounts),
      activeThreadIds: recordDelta(baseline?.activeThreadIdCounts, candidate?.activeThreadIdCounts),
      activePromiseIds: recordDelta(baseline?.activePromiseIdCounts, candidate?.activePromiseIdCounts),
      activePayoffIds: recordDelta(baseline?.activePayoffIdCounts, candidate?.activePayoffIdCounts),
      missingCharacterIds: recordDelta(baseline?.missingCharacterIdCounts, candidate?.missingCharacterIdCounts),
    },
  }
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

function formatTransition(baseline: number | null | undefined, candidate: number | null | undefined): string {
  return `${formatNullableNumber(baseline ?? null)} -> ${formatNullableNumber(candidate ?? null)}`
}

function formatContextIdDeltas(deltas: DraftingRunComparison["planningContext"]["idDeltas"]): string {
  const parts = [
    contextIdDeltaPart("canon", deltas.canonSourceRefs),
    contextIdDeltaPart("threads", deltas.activeThreadIds),
    contextIdDeltaPart("promises", deltas.activePromiseIds),
    contextIdDeltaPart("payoffs", deltas.activePayoffIds),
    contextIdDeltaPart("missingChars", deltas.missingCharacterIds),
  ].filter((part): part is string => part !== null)
  return parts.join("; ")
}

function contextIdDeltaPart(label: string, record: Record<string, number>): string | null {
  const entries = Object.entries(record)
    .filter(([, value]) => value !== 0)
    .sort(([aKey, aValue], [bKey, bValue]) => Math.abs(bValue) - Math.abs(aValue) || aKey.localeCompare(bKey))
    .slice(0, 8)
  if (entries.length === 0) return null
  const extra = Object.keys(record).length - entries.length
  const rendered = entries.map(([key, value]) => `${key}=${formatSigned(value)}`).join(", ")
  return `${label}=${rendered}${extra > 0 ? ` (+${extra} more)` : ""}`
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
  let sourcePairId: string | null = null
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
    if (arg === "--source-pair-id") { sourcePairId = next(); continue }
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
  return { baseline, candidates, baselineArm, candidateArm, sourcePairId, output, json, maxChangedRows }
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
    console.error("usage: bun scripts/analysis/drafting-run-compare.ts --baseline <drafting-isolated-report.json> --candidate <drafting-isolated-report.json> [--candidate ...] [--baseline-arm <arm>] [--candidate-arm <arm>] [--source-pair-id <id>] [--max-changed-rows <n>] [--output report.md] [--json report.json]")
    return 2
  }

  const report = buildDraftingRunComparisonReport({
    baseline: readDraftingRunRef(args.baseline, args.baselineArm),
    candidates: args.candidates.map(candidate => readDraftingRunRef(candidate, args.candidateArm)),
    sourcePairId: args.sourcePairId,
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
