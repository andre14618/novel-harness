#!/usr/bin/env bun
/**
 * Artifact-only production diagnostic for residual drafting length.
 *
 * Joins drafting-isolated reports with their planning-context,
 * prose-semantic, scene-semantic, and checker-warning sidecars. The report is
 * advisory: it does not call an LLM, mutate plans, compact prose, or gate
 * drafting.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

type AttributionCause =
  | "planner_scope_load"
  | "writer_expansion_or_budget_control"
  | "mixed_scope_load_and_budget_control"
  | "semantics_clean_overrun"
  | "inconclusive"

interface Args {
  reports: string[]
  writerContexts: Record<string, string>
  arm: string | null
  outputDir: string | null
  json: string | null
}

interface DraftingRunReport {
  source?: string
  targetPrefix?: string
  results?: DraftingArm[]
}

interface DraftingArm {
  arm?: string
  novelId?: string
  totalWords?: number
  totalTarget?: number
  meanRatio?: number
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
  }
  checkerReadiness?: {
    outputDir?: string
    checkerItems?: number
    warningItems?: number
    negativeItems?: number
    ambiguousItems?: number
  }
  proseSemantic?: {
    outputDir?: string
    lowRows?: number
    errorRows?: number
    lengthSignal?: string
    qualityRisk?: string
  }
  sceneSemantic?: {
    outputDir?: string
    lowRows?: number
    errorRows?: number
  }
}

interface ProseSemanticReport {
  telemetry?: {
    wordShape?: {
      meanWordRatio?: number | null
      overTargetChapters?: number
      severeOverTargetChapters?: number
    }
    dimensionMeans?: Record<string, number>
    chapterSummaries?: ProseChapterSummary[]
    harnessGuidance?: {
      lengthSignal?: string
      qualityRisk?: string
    }
  }
}

interface ProseChapterSummary {
  chapterNumber: number
  targetWords: number | null
  proseWords: number | null
  wordRatio: number | null
  labels?: Record<string, string>
  ordinals?: Record<string, number>
  lowDimensions?: string[]
  errorDimensions?: string[]
}

interface PlanningContextReport {
  upstream?: {
    characterCount?: number
    plannedSceneCount?: number
    scenesWithObligations?: number
    obligationIds?: number
    obligationSourceRefs?: number
    activeStoryRefIds?: number
    sceneLoad?: {
      chapters?: PlanningSceneLoadChapter[]
      denseChapterCount?: number
      overloadedChapterCount?: number
      minTargetWordsPerScene?: number | null
      maxScenesPerChapter?: number
    }
  }
  downstream?: {
    withWorldContext?: number
    withStoryContext?: number
    withReaderInfoState?: number
    readerInfoStateChars?: number
    sceneCoverage?: {
      withWorldContext?: number
      withStoryContext?: number
      withReaderInfoState?: number
      readerInfoStateChars?: number
      canonSourceRefs?: number
      storyRefIds?: number
      missingCharacterIds?: number
    }
  }
}

interface PlanningSceneLoadChapter {
  chapterNumber: number
  sceneCount: number
  targetWords: number | null
  targetWordsPerScene: number | null
  signal: string
}

interface SceneSemanticReport {
  results?: SceneSemanticResult[]
  summaries?: Array<{
    dimension?: string
    meanOrdinal?: number
    lowCount?: number
    count?: number
  }>
  taskCount?: number
  skipCount?: number
}

interface SceneSemanticResult {
  chapterNumber?: number
  sceneIndex?: number
  sceneId?: string
  dimension?: string
  label?: string
  ordinal?: number
  confidence?: number
  excerpt?: string
  obligationIds?: string[]
  relevantCharacterIds?: string[]
  relevantWorldFactIds?: string[]
  sourceIds?: string[]
  threadIds?: string[]
  promiseIds?: string[]
  payoffIds?: string[]
}

interface CheckerWarningReport {
  totalItems?: number
  byPolarity?: Record<string, number>
  bySeverity?: Record<string, number>
  byCalibration?: Record<string, number>
  chapters?: Array<{
    chapter?: number
    items?: CheckerWarningItem[]
  }>
}

interface CheckerWarningItem {
  chapter?: number
  beatIndex?: number
  severity?: string
  polarity?: string
  calibration?: string
  source?: string
  description?: string
}

interface WriterContextReport {
  events?: WriterContextEvent[]
}

interface WriterContextEvent {
  chapter?: number | null
  beatIndex?: number | null
  targetWords?: number | null
  draftingBrief?: {
    selectedPromptChars?: number
    fullContextPromptChars?: number
    charsRatio?: number
    charsDelta?: number
    counts?: {
      obligations?: number
      canonSourceRefs?: number
      storyRefIds?: number
      characters?: number
      readerInfoStateChars?: number
      sceneContractFields?: number
      sceneContractDramaticFields?: number
      choiceAlternatives?: number
    }
  } | null
}

export interface DraftingLengthAttributionReport {
  v: "drafting-length-attribution-v1"
  generatedAt: string
  sourceReports: string[]
  armCount: number
  aggregate: {
    meanRatio: number | null
    overTargetArms: number
    causeCounts: Record<AttributionCause, number>
    dominantCause: AttributionCause | "mixed" | "none"
    recommendations: string[]
  }
  runs: DraftingLengthRun[]
}

interface DraftingLengthRun {
  reportPath: string
  source: string | null
  targetPrefix: string | null
  arms: DraftingLengthArm[]
}

interface DraftingLengthArm {
  arm: string
  novelId: string | null
  totalWords: number | null
  totalTarget: number | null
  meanRatio: number | null
  evidence: {
    planningContext: boolean
    proseSemantic: boolean
    sceneSemantic: boolean
    checkerWarnings: boolean
    writerContext: boolean
  }
  chapterRows: ChapterAttributionRow[]
  sceneRows: SceneAttributionRow[]
  telemetry: {
    chapterCount: number
    sceneCount: number
    meanSceneWordRatio: number | null
    medianSceneWordRatio: number | null
    overTargetSceneCount: number
    highOverTargetSceneCount: number
    meanObligationsPerScene: number | null
    meanSourceRefsPerScene: number | null
    meanSceneLoadIndex: number | null
    loadPressureSceneCount: number
    lowLoadOverTargetSceneCount: number
    sceneWordCoverageDelta: number | null
    cleanSceneSemantics: boolean
    cleanProseSemantics: boolean
    lengthSignal: string | null
    proseEarnedLengthMean: number | null
    sceneSemanticMean: number | null
    checkerWarningCount: number
  prompt: {
      avgSelectedPromptChars: number | null
      avgFullContextPromptChars: number | null
      avgCharsRatio: number | null
      totalCharsDelta: number | null
    }
    correlations: {
      sceneRatioToLoadIndex: number | null
      sceneRatioToObligations: number | null
      sceneRatioToSourceRefs: number | null
      sceneRatioToCheckerWarnings: number | null
      sceneRatioToPromptChars: number | null
    }
  }
  attribution: {
    primaryCause: AttributionCause
    confidence: "low" | "medium" | "high"
    reasons: string[]
    missingEvidence: string[]
    nextEvidence: string[]
  }
}

interface ChapterAttributionRow {
  chapterNumber: number
  targetWords: number | null
  proseWords: number | null
  wordRatio: number | null
  sceneCount: number | null
  targetWordsPerScene: number | null
  sceneLoadSignal: string | null
  semanticLabels: Record<string, string>
  semanticOrdinals: Record<string, number>
  checkerWarnings: number
}

interface SceneAttributionRow {
  chapterNumber: number
  sceneIndex: number
  sceneId: string
  targetWords: number | null
  proseWords: number | null
  wordRatio: number | null
  loadIndex: number
  obligationCount: number
  sourceRefCount: number
  relevantCharacterCount: number
  relevantWorldFactCount: number
  threadRefCount: number
  checkerWarnings: number
  promptSelectedChars: number | null
  promptFullContextChars: number | null
  promptCharsRatio: number | null
  dimensions: Record<string, { label: string; ordinal: number; confidence: number | null }>
  semanticLowCount: number
}

interface LoadedSidecars {
  prose: ProseSemanticReport | null
  planning: PlanningContextReport | null
  scene: SceneSemanticReport | null
  checker: CheckerWarningReport | null
  writerContext: WriterContextReport | null
}

export function buildDraftingLengthAttributionReport(input: {
  refs: Array<{ path: string; report: DraftingRunReport }>
  arm?: string | null
  writerContexts?: Record<string, WriterContextReport>
  generatedAt?: string
}): DraftingLengthAttributionReport {
  const runs: DraftingLengthRun[] = []
  for (const ref of input.refs) {
    const arms = (ref.report.results ?? [])
      .filter(arm => !input.arm || arm.arm === input.arm)
      .map(arm => buildArm(ref.path, arm, input.writerContexts ?? {}))
    runs.push({
      reportPath: ref.path,
      source: stringOrNull(ref.report.source),
      targetPrefix: stringOrNull(ref.report.targetPrefix),
      arms,
    })
  }

  const allArms = runs.flatMap(run => run.arms)
  const ratios = allArms.flatMap(arm => arm.meanRatio === null ? [] : [arm.meanRatio])
  const causeCounts = countBy(allArms, arm => arm.attribution.primaryCause)
  return {
    v: "drafting-length-attribution-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceReports: input.refs.map(ref => ref.path),
    armCount: allArms.length,
    aggregate: {
      meanRatio: meanOrNull(ratios),
      overTargetArms: allArms.filter(arm => (arm.meanRatio ?? 0) > 1.1).length,
      causeCounts,
      dominantCause: dominantCause(causeCounts),
      recommendations: aggregateRecommendations(allArms),
    },
    runs,
  }
}

export function renderDraftingLengthAttributionReport(report: DraftingLengthAttributionReport): string {
  const lines: string[] = []
  lines.push("# Drafting Length Attribution")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Reports: ${report.sourceReports.length}`)
  lines.push(`Arms: ${report.armCount}`)
  lines.push("")
  lines.push("## Aggregate")
  lines.push("")
  lines.push(`- meanRatio: ${formatNullable(report.aggregate.meanRatio, 3)}`)
  lines.push(`- overTargetArms: ${report.aggregate.overTargetArms}`)
  lines.push(`- dominantCause: ${report.aggregate.dominantCause}`)
  lines.push(`- causeCounts: ${formatRecord(report.aggregate.causeCounts)}`)
  for (const recommendation of report.aggregate.recommendations) {
    lines.push(`- recommendation: ${recommendation}`)
  }

  for (const run of report.runs) {
    lines.push("")
    lines.push(`## ${run.targetPrefix ?? run.reportPath}`)
    lines.push("")
    for (const arm of run.arms) {
      lines.push(`### ${arm.arm}`)
      lines.push("")
      lines.push(
        `- words: ${arm.totalWords ?? "?"}/${arm.totalTarget ?? "?"}` +
          ` ratio=${formatNullable(arm.meanRatio, 3)} cause=${arm.attribution.primaryCause}` +
          ` confidence=${arm.attribution.confidence}`,
      )
      lines.push(
        `- scenes: count=${arm.telemetry.sceneCount}, meanRatio=${formatNullable(arm.telemetry.meanSceneWordRatio, 3)}, ` +
          `highOverTarget=${arm.telemetry.highOverTargetSceneCount}, loadPressure=${arm.telemetry.loadPressureSceneCount}, ` +
          `lowLoadOverTarget=${arm.telemetry.lowLoadOverTargetSceneCount}`,
      )
      lines.push(
        `- load: obligations/scene=${formatNullable(arm.telemetry.meanObligationsPerScene, 2)}, ` +
          `sourceRefs/scene=${formatNullable(arm.telemetry.meanSourceRefsPerScene, 2)}, ` +
          `loadIndex=${formatNullable(arm.telemetry.meanSceneLoadIndex, 2)}`,
      )
      lines.push(
        `- semantic: cleanScene=${arm.telemetry.cleanSceneSemantics ? "yes" : "no"}, ` +
          `cleanProse=${arm.telemetry.cleanProseSemantics ? "yes" : "no"}, ` +
          `lengthSignal=${arm.telemetry.lengthSignal ?? "?"}, earnedLengthMean=${formatNullable(arm.telemetry.proseEarnedLengthMean, 2)}, ` +
          `sceneMean=${formatNullable(arm.telemetry.sceneSemanticMean, 2)}`,
      )
      lines.push(
        `- prompt: avgSelected=${formatNullable(arm.telemetry.prompt.avgSelectedPromptChars, 0)}, ` +
          `avgFull=${formatNullable(arm.telemetry.prompt.avgFullContextPromptChars, 0)}, ` +
          `ratio=${formatNullable(arm.telemetry.prompt.avgCharsRatio, 3)}`,
      )
      lines.push(
        `- correlations: ratio~load=${formatNullable(arm.telemetry.correlations.sceneRatioToLoadIndex, 2)}, ` +
          `ratio~obligations=${formatNullable(arm.telemetry.correlations.sceneRatioToObligations, 2)}, ` +
          `ratio~sourceRefs=${formatNullable(arm.telemetry.correlations.sceneRatioToSourceRefs, 2)}, ` +
          `ratio~checkerWarnings=${formatNullable(arm.telemetry.correlations.sceneRatioToCheckerWarnings, 2)}, ` +
          `ratio~promptChars=${formatNullable(arm.telemetry.correlations.sceneRatioToPromptChars, 2)}`,
      )
      for (const reason of arm.attribution.reasons) lines.push(`- reason: ${reason}`)
      if (arm.attribution.missingEvidence.length > 0) {
        lines.push(`- missingEvidence: ${arm.attribution.missingEvidence.join("; ")}`)
      }
      if (arm.attribution.nextEvidence.length > 0) {
        lines.push(`- nextEvidence: ${arm.attribution.nextEvidence.join("; ")}`)
      }

      lines.push("")
      lines.push("| Chapter | Words | Scenes | W/Scene | Load | Checker | Semantics |")
      lines.push("| ---: | ---: | ---: | ---: | --- | ---: | --- |")
      for (const row of arm.chapterRows) {
        const labels = Object.entries(row.semanticLabels)
          .map(([dimension, label]) => `${dimension}:${label}`)
          .join(" ") || "none"
        lines.push(
          `| ${row.chapterNumber} | ${row.proseWords ?? "?"}/${row.targetWords ?? "?"} (${formatNullable(row.wordRatio, 2)}) | ` +
            `${row.sceneCount ?? "?"} | ${formatNullable(row.targetWordsPerScene, 0)} | ${row.sceneLoadSignal ?? "?"} | ` +
            `${row.checkerWarnings} | ${labels} |`,
        )
      }

      lines.push("")
      lines.push("| Scene | Words | Load | IDs | Checker | Prompt | Semantics |")
      lines.push("| --- | ---: | ---: | --- | ---: | ---: | --- |")
      for (const row of arm.sceneRows) {
        const labels = Object.entries(row.dimensions)
          .map(([dimension, value]) => `${dimension}:${value.label}`)
          .join(" ") || "none"
        lines.push(
          `| ch${row.chapterNumber}s${row.sceneIndex + 1} ${row.sceneId} | ` +
            `${row.proseWords ?? "?"}/${formatNullable(row.targetWords, 0)} (${formatNullable(row.wordRatio, 2)}) | ` +
            `${row.loadIndex.toFixed(1)} | obl=${row.obligationCount} src=${row.sourceRefCount} char=${row.relevantCharacterCount} world=${row.relevantWorldFactCount} thread=${row.threadRefCount} | ` +
            `${row.checkerWarnings} | ${formatNullable(row.promptSelectedChars, 0)} | ${labels} |`,
        )
      }
    }
  }

  lines.push("")
  lines.push("## Guardrails")
  lines.push("")
  lines.push("- Diagnostic only: no LLM calls, no prose compaction, no plan mutation, no promotion gate.")
  lines.push("- Scene word counts use captured scene writer-call prose when available; chapter rows remain authoritative for final approved chapter word counts.")
  lines.push("- Correlations are descriptive only and weak on small N.")
  return `${lines.join("\n")}\n`
}

function buildArm(reportPath: string, arm: DraftingArm, writerContexts: Record<string, WriterContextReport>): DraftingLengthArm {
  const sidecars = loadSidecars(reportPath, arm, writerContexts)
  const chapterRows = buildChapterRows(sidecars)
  const sceneRows = buildSceneRows(sidecars, chapterRows)
  const telemetry = buildTelemetry(arm, sidecars, chapterRows, sceneRows)
  const attribution = classifyArm(arm, sidecars, chapterRows, sceneRows, telemetry)
  return {
    arm: arm.arm ?? "unknown",
    novelId: stringOrNull(arm.novelId),
    totalWords: numberOrNull(arm.totalWords),
    totalTarget: numberOrNull(arm.totalTarget),
    meanRatio: numberOrNull(arm.meanRatio),
    evidence: {
      planningContext: sidecars.planning !== null,
      proseSemantic: sidecars.prose !== null,
      sceneSemantic: sidecars.scene !== null,
      checkerWarnings: sidecars.checker !== null,
      writerContext: sidecars.writerContext !== null,
    },
    chapterRows,
    sceneRows,
    telemetry,
    attribution,
  }
}

function loadSidecars(reportPath: string, arm: DraftingArm, writerContexts: Record<string, WriterContextReport>): LoadedSidecars {
  const baseDir = dirname(resolve(reportPath))
  const planningDir = stringOrNull(arm.planningContext?.outputDir)
  const proseDir = stringOrNull(arm.proseSemantic?.outputDir)
  const sceneDir = stringOrNull(arm.sceneSemantic?.outputDir)
  const checkerDir = stringOrNull(arm.checkerReadiness?.outputDir)
  return {
    planning: planningDir
      ? readJsonIfExists<PlanningContextReport>(resolveArtifactPath(baseDir, join(planningDir, "planning-drafting-context-report.json")))
      : null,
    prose: proseDir
      ? readJsonIfExists<ProseSemanticReport>(resolveArtifactPath(baseDir, join(proseDir, "prose-semantic-report.json")))
      : null,
    scene: sceneDir
      ? readJsonIfExists<SceneSemanticReport>(resolveArtifactPath(baseDir, join(sceneDir, "scene-semantic-review.json")))
      : null,
    checker: checkerDir
      ? readJsonIfExists<CheckerWarningReport>(resolveArtifactPath(baseDir, join(checkerDir, "checker-warning-report.json")))
      : null,
    writerContext: stringOrNull(arm.novelId) ? writerContexts[stringOrNull(arm.novelId)!] ?? null : null,
  }
}

function buildChapterRows(sidecars: LoadedSidecars): ChapterAttributionRow[] {
  const proseRows = sidecars.prose?.telemetry?.chapterSummaries ?? []
  const sceneLoadByChapter = new Map<number, PlanningSceneLoadChapter>()
  for (const row of sidecars.planning?.upstream?.sceneLoad?.chapters ?? []) {
    if (typeof row.chapterNumber === "number") sceneLoadByChapter.set(row.chapterNumber, row)
  }
  const checkerByChapter = checkerWarningsByChapter(sidecars.checker)
  const chapterNumbers = new Set<number>([
    ...proseRows.map(row => row.chapterNumber),
    ...[...sceneLoadByChapter.keys()],
    ...[...checkerByChapter.keys()],
  ])

  return [...chapterNumbers].sort((a, b) => a - b).map(chapterNumber => {
    const prose = proseRows.find(row => row.chapterNumber === chapterNumber)
    const sceneLoad = sceneLoadByChapter.get(chapterNumber)
    return {
      chapterNumber,
      targetWords: numberOrNull(prose?.targetWords) ?? numberOrNull(sceneLoad?.targetWords),
      proseWords: numberOrNull(prose?.proseWords),
      wordRatio: numberOrNull(prose?.wordRatio),
      sceneCount: numberOrNull(sceneLoad?.sceneCount),
      targetWordsPerScene: numberOrNull(sceneLoad?.targetWordsPerScene),
      sceneLoadSignal: stringOrNull(sceneLoad?.signal),
      semanticLabels: readStringRecord(prose?.labels),
      semanticOrdinals: readNumberRecord(prose?.ordinals),
      checkerWarnings: checkerByChapter.get(chapterNumber)?.length ?? 0,
    }
  })
}

function buildSceneRows(sidecars: LoadedSidecars, chapterRows: ChapterAttributionRow[]): SceneAttributionRow[] {
  const scenes = new Map<string, {
    chapterNumber: number
    sceneIndex: number
    sceneId: string
    proseText: string | null
    obligationIds: Set<string>
    sourceIds: Set<string>
    relevantCharacterIds: Set<string>
    relevantWorldFactIds: Set<string>
    threadRefs: Set<string>
    dimensions: Record<string, { label: string; ordinal: number; confidence: number | null }>
  }>()

  for (const result of sidecars.scene?.results ?? []) {
    const chapterNumber = numberOrNull(result.chapterNumber)
    const sceneIndex = numberOrNull(result.sceneIndex)
    if (chapterNumber === null || sceneIndex === null) continue
    const sceneId = stringOrNull(result.sceneId) ?? `ch${chapterNumber}-scene${sceneIndex + 1}`
    const key = `${chapterNumber}:${sceneIndex}:${sceneId}`
    const current = scenes.get(key) ?? {
      chapterNumber,
      sceneIndex,
      sceneId,
      proseText: extractSceneProse(stringOrNull(result.excerpt)),
      obligationIds: new Set<string>(),
      sourceIds: new Set<string>(),
      relevantCharacterIds: new Set<string>(),
      relevantWorldFactIds: new Set<string>(),
      threadRefs: new Set<string>(),
      dimensions: {},
    }
    current.proseText ??= extractSceneProse(stringOrNull(result.excerpt))
    addStrings(current.obligationIds, result.obligationIds)
    addStrings(current.sourceIds, result.sourceIds)
    addStrings(current.relevantCharacterIds, result.relevantCharacterIds)
    addStrings(current.relevantWorldFactIds, result.relevantWorldFactIds)
    addStrings(current.threadRefs, result.threadIds)
    addStrings(current.threadRefs, result.promiseIds)
    addStrings(current.threadRefs, result.payoffIds)
    const dimension = stringOrNull(result.dimension)
    const label = stringOrNull(result.label)
    const ordinal = numberOrNull(result.ordinal)
    if (dimension && label && ordinal !== null) {
      current.dimensions[dimension] = {
        label,
        ordinal,
        confidence: numberOrNull(result.confidence),
      }
    }
    scenes.set(key, current)
  }

  const checkerByScene = checkerWarningsByScene(sidecars.checker)
  const writerContextByScene = writerContextEventsByScene(sidecars.writerContext)
  return [...scenes.values()]
    .sort((a, b) => a.chapterNumber - b.chapterNumber || a.sceneIndex - b.sceneIndex || a.sceneId.localeCompare(b.sceneId))
    .map(scene => {
      const chapter = chapterRows.find(row => row.chapterNumber === scene.chapterNumber)
      const writerContext = writerContextByScene.get(`${scene.chapterNumber}:${scene.sceneIndex}`)
      const sceneTargetWords = numberOrNull(writerContext?.targetWords) ?? numberOrNull(chapter?.targetWordsPerScene)
      const proseWords = scene.proseText ? countWords(scene.proseText) : null
      const checkerWarnings = checkerByScene.get(`${scene.chapterNumber}:${scene.sceneIndex}`)?.length ?? 0
      const obligationCount = scene.obligationIds.size
      const sourceRefCount = scene.sourceIds.size
      const relevantCharacterCount = scene.relevantCharacterIds.size
      const relevantWorldFactCount = scene.relevantWorldFactIds.size
      const threadRefCount = scene.threadRefs.size
      const loadIndex = obligationCount +
        sourceRefCount * 0.35 +
        relevantCharacterCount * 0.5 +
        relevantWorldFactCount * 0.5 +
        threadRefCount * 0.75 +
        checkerWarnings * 0.5
      return {
        chapterNumber: scene.chapterNumber,
        sceneIndex: scene.sceneIndex,
        sceneId: scene.sceneId,
        targetWords: sceneTargetWords,
        proseWords,
        wordRatio: proseWords !== null && sceneTargetWords !== null && sceneTargetWords > 0 ? proseWords / sceneTargetWords : null,
        loadIndex,
        obligationCount,
        sourceRefCount,
        relevantCharacterCount,
        relevantWorldFactCount,
        threadRefCount,
        checkerWarnings,
        promptSelectedChars: numberOrNull(writerContext?.draftingBrief?.selectedPromptChars),
        promptFullContextChars: numberOrNull(writerContext?.draftingBrief?.fullContextPromptChars),
        promptCharsRatio: numberOrNull(writerContext?.draftingBrief?.charsRatio),
        dimensions: scene.dimensions,
        semanticLowCount: Object.values(scene.dimensions).filter(value => value.ordinal <= 1).length,
      }
    })
}

function buildTelemetry(
  arm: DraftingArm,
  sidecars: LoadedSidecars,
  chapterRows: ChapterAttributionRow[],
  sceneRows: SceneAttributionRow[],
): DraftingLengthArm["telemetry"] {
  const sceneRatios = sceneRows.flatMap(row => row.wordRatio === null ? [] : [row.wordRatio])
  const loadIndexes = sceneRows.map(row => row.loadIndex)
  const obligationCounts = sceneRows.map(row => row.obligationCount)
  const sourceRefCounts = sceneRows.map(row => row.sourceRefCount)
  const scenePromptSelected = sceneRows.flatMap(row => row.promptSelectedChars === null ? [] : [row.promptSelectedChars])
  const scenePromptFull = sceneRows.flatMap(row => row.promptFullContextChars === null ? [] : [row.promptFullContextChars])
  const scenePromptRatio = sceneRows.flatMap(row => row.promptCharsRatio === null ? [] : [row.promptCharsRatio])
  const chapterWords = chapterRows.reduce((sum, row) => sum + (row.proseWords ?? 0), 0)
  const sceneWords = sceneRows.reduce((sum, row) => sum + (row.proseWords ?? 0), 0)
  const sceneSemanticOrdinals = sceneRows.flatMap(row => Object.values(row.dimensions).map(value => value.ordinal))
  const sceneSemanticErrorRows = numberOrNull(arm.sceneSemantic?.errorRows) ?? 0
  const sceneSemanticLowRows = numberOrNull(arm.sceneSemantic?.lowRows) ?? sceneRows.reduce((sum, row) => sum + row.semanticLowCount, 0)
  const proseSemanticErrorRows = numberOrNull(arm.proseSemantic?.errorRows) ?? 0
  const proseSemanticLowRows = numberOrNull(arm.proseSemantic?.lowRows) ?? 0

  return {
    chapterCount: chapterRows.length,
    sceneCount: sceneRows.length,
    meanSceneWordRatio: meanOrNull(sceneRatios),
    medianSceneWordRatio: medianOrNull(sceneRatios),
    overTargetSceneCount: sceneRatios.filter(value => value > 1.1).length,
    highOverTargetSceneCount: sceneRatios.filter(value => value > 1.25).length,
    meanObligationsPerScene: meanOrNull(obligationCounts),
    meanSourceRefsPerScene: meanOrNull(sourceRefCounts),
    meanSceneLoadIndex: meanOrNull(loadIndexes),
    loadPressureSceneCount: sceneRows.filter(row => row.loadIndex >= 3).length,
    lowLoadOverTargetSceneCount: sceneRows.filter(row => row.loadIndex < 2 && (row.wordRatio ?? 0) > 1.25).length,
    sceneWordCoverageDelta: chapterWords > 0 && sceneWords > 0 ? sceneWords - chapterWords : null,
    cleanSceneSemantics: sceneSemanticLowRows === 0 && sceneSemanticErrorRows === 0 && sceneRows.length > 0,
    cleanProseSemantics: proseSemanticLowRows === 0 && proseSemanticErrorRows === 0,
    lengthSignal: stringOrNull(arm.proseSemantic?.lengthSignal) ?? stringOrNull(sidecars.prose?.telemetry?.harnessGuidance?.lengthSignal),
    proseEarnedLengthMean: numberOrNull(sidecars.prose?.telemetry?.dimensionMeans?.earnedLength),
    sceneSemanticMean: meanOrNull(sceneSemanticOrdinals),
    checkerWarningCount: numberOrNull(arm.checkerReadiness?.warningItems) ?? numberOrNull(sidecars.checker?.totalItems) ?? 0,
    prompt: {
      avgSelectedPromptChars: meanOrNull(scenePromptSelected) ?? numberOrNull(arm.draftingBrief?.avgSelectedPromptChars),
      avgFullContextPromptChars: meanOrNull(scenePromptFull) ?? numberOrNull(arm.draftingBrief?.avgFullContextPromptChars),
      avgCharsRatio: meanOrNull(scenePromptRatio) ?? numberOrNull(arm.draftingBrief?.avgCharsRatio),
      totalCharsDelta: numberOrNull(arm.draftingBrief?.totalCharsDelta),
    },
    correlations: {
      sceneRatioToLoadIndex: correlateSceneRows(sceneRows, row => row.wordRatio, row => row.loadIndex),
      sceneRatioToObligations: correlateSceneRows(sceneRows, row => row.wordRatio, row => row.obligationCount),
      sceneRatioToSourceRefs: correlateSceneRows(sceneRows, row => row.wordRatio, row => row.sourceRefCount),
      sceneRatioToCheckerWarnings: correlateSceneRows(sceneRows, row => row.wordRatio, row => row.checkerWarnings),
      sceneRatioToPromptChars: correlateSceneRows(sceneRows, row => row.wordRatio, row => row.promptSelectedChars),
    },
  }
}

function classifyArm(
  arm: DraftingArm,
  sidecars: LoadedSidecars,
  chapterRows: ChapterAttributionRow[],
  sceneRows: SceneAttributionRow[],
  telemetry: DraftingLengthArm["telemetry"],
): DraftingLengthArm["attribution"] {
  const reasons: string[] = []
  const missingEvidence: string[] = []
  const nextEvidence: string[] = []
  if (!sidecars.prose) missingEvidence.push("prose-semantic sidecar")
  if (!sidecars.scene) missingEvidence.push("scene-semantic sidecar")
  if (!sidecars.planning) missingEvidence.push("planning-context sidecar")
  if (!sidecars.writerContext) missingEvidence.push("per-scene writer-context sidecar")
  if (sceneRows.length === 0) missingEvidence.push("captured scene writer-call prose")
  if ((arm.meanRatio ?? 0) <= 1.1) {
    return {
      primaryCause: "inconclusive",
      confidence: "low",
      reasons: ["Run is not meaningfully over target, so residual length attribution is not applicable."],
      missingEvidence,
      nextEvidence,
    }
  }

  const denseChapters = chapterRows.filter(row => row.sceneLoadSignal === "dense" || row.sceneLoadSignal === "overloaded").length
  const balancedChapters = chapterRows.filter(row => row.sceneLoadSignal === "balanced").length
  const scopeScore = [
    denseChapters > 0,
    (telemetry.meanSourceRefsPerScene ?? 0) >= 2,
    (telemetry.meanObligationsPerScene ?? 0) >= 1.5,
    telemetry.loadPressureSceneCount >= Math.ceil(Math.max(1, sceneRows.length) * 0.35),
    (sidecars.planning?.upstream?.scenesWithObligations ?? 0) >= Math.ceil(Math.max(1, sceneRows.length) * 0.7),
  ].filter(Boolean).length
  const budgetScore = [
    balancedChapters === chapterRows.length && chapterRows.length > 0,
    telemetry.highOverTargetSceneCount >= Math.ceil(Math.max(1, sceneRows.length) * 0.35),
    telemetry.lowLoadOverTargetSceneCount >= 1,
    (telemetry.meanSceneWordRatio ?? 0) > 1.2,
  ].filter(Boolean).length
  const semanticCleanScore = [
    telemetry.cleanSceneSemantics,
    telemetry.cleanProseSemantics,
    telemetry.lengthSignal === "not_falsified_as_padding",
    (telemetry.proseEarnedLengthMean ?? 0) >= 2,
    (telemetry.sceneSemanticMean ?? 0) >= 2,
  ].filter(Boolean).length

  if (denseChapters > 0) reasons.push(`${denseChapters} chapter(s) are flagged dense/overloaded by planning-context scene load.`)
  if ((telemetry.meanSourceRefsPerScene ?? 0) >= 2) reasons.push(`Mean source refs per scene is high at ${telemetry.meanSourceRefsPerScene!.toFixed(2)}.`)
  if ((telemetry.meanObligationsPerScene ?? 0) >= 1.5) reasons.push(`Mean obligations per scene is high at ${telemetry.meanObligationsPerScene!.toFixed(2)}.`)
  if (telemetry.loadPressureSceneCount > 0) reasons.push(`${telemetry.loadPressureSceneCount}/${sceneRows.length} scenes have loadIndex >= 3.`)
  if (balancedChapters === chapterRows.length && chapterRows.length > 0) reasons.push("Planning scene-load labels are balanced, so residual overrun is not explained by scene count alone.")
  if (telemetry.highOverTargetSceneCount > 0) reasons.push(`${telemetry.highOverTargetSceneCount}/${sceneRows.length} scenes exceed 1.25x their per-scene target estimate.`)
  if (telemetry.lowLoadOverTargetSceneCount > 0) reasons.push(`${telemetry.lowLoadOverTargetSceneCount} low-load scene(s) still exceed 1.25x, pointing at writer expansion or budget-control weakness.`)
  if (telemetry.cleanSceneSemantics && telemetry.cleanProseSemantics && telemetry.lengthSignal === "not_falsified_as_padding") {
    reasons.push("Prose and scene semantic telemetry are clean and length is not falsified as padding.")
  } else if (semanticCleanScore >= 4) {
    reasons.push("Run-level semantic means remain non-low, but low/error rows require inspection before treating length as earned.")
  }
  if (telemetry.checkerWarningCount > 0) reasons.push(`${telemetry.checkerWarningCount} checker warning(s) remain; inspect whether warnings reward explicit support-echo.`)
  if (telemetry.prompt.avgSelectedPromptChars !== null) reasons.push(`Average selected writer prompt is ${Math.round(telemetry.prompt.avgSelectedPromptChars)} chars.`)

  let primaryCause: AttributionCause = "inconclusive"
  if (scopeScore >= 2 && budgetScore >= 2) primaryCause = "mixed_scope_load_and_budget_control"
  else if (scopeScore >= 2) primaryCause = "planner_scope_load"
  else if (budgetScore >= 2) primaryCause = "writer_expansion_or_budget_control"
  else if (
    telemetry.cleanSceneSemantics &&
    telemetry.cleanProseSemantics &&
    telemetry.lengthSignal === "not_falsified_as_padding" &&
    semanticCleanScore >= 4
  ) primaryCause = "semantics_clean_overrun"

  if (primaryCause === "mixed_scope_load_and_budget_control") {
    nextEvidence.push("Use same-plan writer-arm or budget-elasticity repeats before reducing story load, because both load and budget-control signals are present.")
  } else if (primaryCause === "planner_scope_load") {
    nextEvidence.push("Test a reviewed planning_edit that splits/defers loaded obligations while preserving endpoint semantics.")
  } else if (primaryCause === "writer_expansion_or_budget_control") {
    nextEvidence.push("Run a same-plan budget-elasticity comparison to separate useful expansion from weak budget obedience.")
  } else if (primaryCause === "semantics_clean_overrun") {
    nextEvidence.push("Run a compression-opportunity or pairwise quality judge before treating the extra words as removable.")
  } else {
    nextEvidence.push("Collect missing sidecars and rerun with scene-semantic replay.")
  }

  const confidence = missingEvidence.length > 0 || sceneRows.length < 4
    ? "low"
    : primaryCause === "inconclusive"
      ? "low"
      : scopeScore >= 3 || budgetScore >= 3 || semanticCleanScore >= 4
        ? "medium"
        : "low"

  return { primaryCause, confidence, reasons, missingEvidence, nextEvidence }
}

export function loadDraftingRunReportRef(path: string): { path: string; report: DraftingRunReport } {
  const resolved = resolve(process.cwd(), path)
  return {
    path: resolved,
    report: readJson<DraftingRunReport>(resolved),
  }
}

function resolveArtifactPath(baseDir: string, path: string): string {
  if (path.startsWith("/")) return path
  const direct = resolve(process.cwd(), path)
  if (existsSync(direct)) return direct
  return resolve(baseDir, path)
}

function readJsonIfExists<T>(path: string): T | null {
  return existsSync(path) ? readJson<T>(path) : null
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function checkerWarningsByChapter(report: CheckerWarningReport | null): Map<number, CheckerWarningItem[]> {
  const out = new Map<number, CheckerWarningItem[]>()
  for (const chapter of report?.chapters ?? []) {
    const chapterNumber = numberOrNull(chapter.chapter)
    if (chapterNumber === null) continue
    out.set(chapterNumber, chapter.items ?? [])
  }
  return out
}

function checkerWarningsByScene(report: CheckerWarningReport | null): Map<string, CheckerWarningItem[]> {
  const out = new Map<string, CheckerWarningItem[]>()
  for (const chapter of report?.chapters ?? []) {
    const chapterNumber = numberOrNull(chapter.chapter)
    if (chapterNumber === null) continue
    for (const item of chapter.items ?? []) {
      const beatIndex = numberOrNull(item.beatIndex)
      if (beatIndex === null) continue
      const key = `${chapterNumber}:${beatIndex}`
      const current = out.get(key) ?? []
      current.push(item)
      out.set(key, current)
    }
  }
  return out
}

function writerContextEventsByScene(report: WriterContextReport | null): Map<string, WriterContextEvent> {
  const out = new Map<string, WriterContextEvent>()
  for (const event of report?.events ?? []) {
    const chapterNumber = numberOrNull(event.chapter)
    const beatIndex = numberOrNull(event.beatIndex)
    if (chapterNumber === null || beatIndex === null) continue
    const key = `${chapterNumber}:${beatIndex}`
    const current = out.get(key)
    if (!current || event.draftingBrief) out.set(key, event)
  }
  return out
}

function extractSceneProse(excerpt: string | null): string | null {
  if (!excerpt) return null
  const marker = "SCENE PROSE"
  const markerIndex = excerpt.indexOf(marker)
  if (markerIndex < 0) return null
  const afterMarker = excerpt.slice(markerIndex)
  const firstNewline = afterMarker.indexOf("\n")
  if (firstNewline < 0) return null
  const prose = afterMarker.slice(firstNewline + 1).trim()
  return prose.length > 0 ? prose : null
}

function countWords(text: string): number {
  const matches = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/gu)
  return matches?.length ?? 0
}

function pearson(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null
  const pairs = x.map((value, index) => [value, y[index]!] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
  if (pairs.length < 3) return null
  const meanX = meanOrNull(pairs.map(([value]) => value))
  const meanY = meanOrNull(pairs.map(([, value]) => value))
  if (meanX === null || meanY === null) return null
  let numerator = 0
  let denomX = 0
  let denomY = 0
  for (const [a, b] of pairs) {
    const dx = a - meanX
    const dy = b - meanY
    numerator += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }
  const denominator = Math.sqrt(denomX * denomY)
  return denominator > 0 ? numerator / denominator : null
}

function correlateSceneRows(
  rows: readonly SceneAttributionRow[],
  xFn: (row: SceneAttributionRow) => number | null,
  yFn: (row: SceneAttributionRow) => number | null,
): number | null {
  const pairs = rows
    .map(row => [xFn(row), yFn(row)] as const)
    .filter((pair): pair is readonly [number, number] =>
      typeof pair[0] === "number" && Number.isFinite(pair[0]) &&
      typeof pair[1] === "number" && Number.isFinite(pair[1]))
  return pearson(pairs.map(([x]) => x), pairs.map(([, y]) => y))
}

function meanOrNull(values: readonly number[]): number | null {
  const clean = values.filter(value => Number.isFinite(value))
  if (clean.length === 0) return null
  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

function medianOrNull(values: readonly number[]): number | null {
  const clean = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 === 1 ? clean[mid]! : (clean[mid - 1]! + clean[mid]!) / 2
}

function dominantCause(counts: Record<AttributionCause, number>): AttributionCause | "mixed" | "none" {
  const entries = Object.entries(counts) as Array<[AttributionCause, number]>
  if (entries.length === 0) return "none"
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (entries.length > 1 && entries[0]![1] === entries[1]![1]) return "mixed"
  return entries[0]![0]
}

function aggregateRecommendations(arms: readonly DraftingLengthArm[]): string[] {
  if (arms.length === 0) return ["No arms loaded; provide at least one drafting-isolated report."]
  const causes = new Set(arms.map(arm => arm.attribution.primaryCause))
  const out: string[] = []
  if (causes.has("mixed_scope_load_and_budget_control")) {
    out.push("Prioritize budget-elasticity and same-plan arm evidence before deleting story payload; current evidence mixes load and control signals.")
  }
  if (causes.has("planner_scope_load")) {
    out.push("Use reviewed planning_edit reductions or splits for high-load scenes, then replay with the same semantic sidecars.")
  }
  if (causes.has("writer_expansion_or_budget_control")) {
    out.push("Run same-plan budget variants to test whether the writer responds to tighter per-scene budgets without semantic loss.")
  }
  if (causes.has("semantics_clean_overrun")) {
    out.push("Treat length as a quality/shape tradeoff until a compression-opportunity judge finds removable prose.")
  }
  return out.length > 0 ? out : ["Collect missing sidecars before choosing a tuning surface."]
}

function countBy<T>(items: readonly T[], keyFn: (item: T) => string): Record<AttributionCause, number> {
  const out: Partial<Record<AttributionCause, number>> = {}
  for (const item of items) {
    const key = keyFn(item) as AttributionCause
    out[key] = (out[key] ?? 0) + 1
  }
  return out as Record<AttributionCause, number>
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
  )
}

function addStrings(target: Set<string>, values: unknown): void {
  if (!Array.isArray(values)) return
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) target.add(value.trim())
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function formatNullable(value: number | null, digits: number): string {
  return value === null ? "?" : value.toFixed(digits)
}

function formatRecord(record: Record<string, number>): string {
  const entries = Object.entries(record)
  return entries.length > 0 ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none"
}

function parseArgs(argv: string[]): Args {
  const reports: string[] = []
  const writerContexts: Record<string, string> = {}
  let arm: string | null = null
  let outputDir: string | null = null
  let json: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eat = (): string => {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }
    if (arg === "--report") { reports.push(eat()); continue }
    if (arg === "--writer-context") {
      const value = eat()
      const split = value.indexOf("=")
      if (split <= 0 || split === value.length - 1) throw new Error("--writer-context expects <novelId>=<writer-context-report.json>")
      writerContexts[value.slice(0, split)] = value.slice(split + 1)
      continue
    }
    if (arg === "--arm") { arm = eat(); continue }
    if (arg === "--output-dir") { outputDir = eat(); continue }
    if (arg === "--json") { json = eat(); continue }
    if (!arg.startsWith("--")) { reports.push(arg); continue }
    throw new Error(`unknown arg: ${arg}`)
  }
  return { reports, writerContexts, arm, outputDir, json }
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/drafting-length-attribution.ts --report <drafting-isolated-report.json> [--report ...] [--writer-context <novelId=writer-context-report.json>] [--arm <arm>] [--output-dir <dir>] [--json <path>]")
    return 2
  }
  if (args.reports.length === 0) {
    console.error("usage: bun scripts/analysis/drafting-length-attribution.ts --report <drafting-isolated-report.json> [--report ...] [--writer-context <novelId=writer-context-report.json>] [--arm <arm>] [--output-dir <dir>] [--json <path>]")
    return 2
  }

  const refs = args.reports.map(loadDraftingRunReportRef)
  const writerContexts = Object.fromEntries(
    Object.entries(args.writerContexts).map(([novelId, path]) => [novelId, readJson<WriterContextReport>(resolve(process.cwd(), path))]),
  )
  const report = buildDraftingLengthAttributionReport({ refs, arm: args.arm, writerContexts })
  const outputDir = args.outputDir ?? join("output", "drafting-length-attribution", String(Date.now()))
  mkdirSync(outputDir, { recursive: true })
  const jsonPath = args.json ?? join(outputDir, "drafting-length-attribution.json")
  const mdPath = join(outputDir, "drafting-length-attribution.md")
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(mdPath, renderDraftingLengthAttributionReport(report))
  console.log(renderDraftingLengthAttributionReport(report))
  console.log(`wrote ${jsonPath}`)
  console.log(`wrote ${mdPath}`)
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
