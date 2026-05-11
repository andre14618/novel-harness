#!/usr/bin/env bun
/**
 * Convert deterministic planning-context audit pressure into Plan
 * Readiness-compatible groups. This is advisory/manual: it creates review
 * candidates for overloaded chapter scene load and does not mutate plans unless
 * the operator explicitly passes --import-readiness.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import {
  loadPlanningToDraftingContextReport,
  type ChapterSceneLoad,
  type DramaticSceneContractGap,
  type FutureEventAnchorFinding,
  type PlanFactContradictionFinding,
  type PlanningToDraftingContextReport,
  type ReferenceContextAttemptSummary,
  type SceneLoadSignal,
} from "./planning-drafting-context-report"

type Severity = "high" | "medium" | "low" | "info"
type PlanningContextSourceAgent = "planning-context-readiness"
type PlanningContextDimension =
  | "sceneLoad"
  | "futureEventAnchor"
  | "sceneContract"
  | "factContinuity"
  | "referenceContext"
type PlanningContextFixIntent =
  | "rebalance_scene_load"
  | "preserve_future_event_anchor"
  | "complete_scene_contract"
  | "preserve_immutable_fact"
  | "resolve_reference_context"

export interface PlanningContextReadinessArgs {
  novelId: string | null
  reportPath: string | null
  outputPath: string | null
  jsonPath: string | null
  includeDense: boolean
  importReadiness: boolean
  importedByRef: string | null
}

interface PlanningContextReadinessFinding {
  findingId: string
  sourceReport: string
  promptMode: "deterministic-planning-context"
  dimension: PlanningContextDimension
  label:
    | "SCENE-LOAD-OVERLOADED"
    | "SCENE-LOAD-DENSE"
    | "FUTURE-EVENT-ANCHOR-MISSING"
    | "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE"
    | "SCENE-CONTRACT-FULL-SHAPE-INCOMPLETE"
    | "PLAN-FACT-STATUS-CONTRADICTION"
    | "REFERENCE-CONTEXT-UNRESOLVED"
  severity: Severity
  fixIntent: PlanningContextFixIntent
  rationale: string
  missingForNextLevel: string
  evidence: Record<string, string>
}

interface PlanningContextReadinessSourceIds {
  obligationIds: string[]
  characterIds: string[]
  worldFactIds: string[]
  sceneTurnIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  sourceIds: string[]
}

interface PlanningContextReadinessGroup {
  groupId: string
  fixtureId: string
  armId: string
  methodPackEnabled: false
  unitType: "chapter" | "scene"
  chapterId: string
  sceneId: string
  sourceIds: PlanningContextReadinessSourceIds
  highestSeverity: Severity
  fixIntents: PlanningContextFixIntent[]
  dimensions: PlanningContextDimension[]
  findings: PlanningContextReadinessFinding[]
  rewritePacket: {
    targetSummary: string
    rewriteGoals: string[]
    preserveIds: PlanningContextReadinessSourceIds
    proposalCandidate: {
      action: "scene_select" | "field_replace" | "beat_replace"
      target: {
        kind: "chapter_outline" | "scene_plan"
        ref: string
        fieldPath: "scenes" | "description" | "temporalAnchor" | "self"
      }
      requiresProposedValue: true
      proposedValueStatus: "operator_required"
      safeToAutoApply: false
      sourceAgent: PlanningContextSourceAgent
    }
  }
  excerpt: string
}

export interface PlanningContextReadinessAggregate {
  generatedAt: string
  sourceReports: string[]
  labels: string[]
  maxOrdinal: 1
  findingCount: number
  groupCount: number
  groups: PlanningContextReadinessGroup[]
}

export function parseArgs(argv = process.argv.slice(2)): PlanningContextReadinessArgs {
  let novelId: string | null = null
  let reportPath: string | null = null
  let outputPath: string | null = null
  let jsonPath: string | null = null
  let includeDense = false
  let importReadiness = false
  let importedByRef: string | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      novelId = requireValue(argv[++i], "--novel")
    } else if (arg === "--report") {
      reportPath = requireValue(argv[++i], "--report")
    } else if (arg === "--output") {
      outputPath = requireValue(argv[++i], "--output")
    } else if (arg === "--json") {
      jsonPath = requireValue(argv[++i], "--json")
    } else if (arg === "--include-dense") {
      includeDense = true
    } else if (arg === "--import-readiness") {
      importReadiness = true
    } else if (arg === "--imported-by-ref") {
      importedByRef = requireValue(argv[++i], "--imported-by-ref")
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }

  if (!novelId && !reportPath) throw new Error("--novel or --report is required")
  return { novelId, reportPath, outputPath, jsonPath, includeDense, importReadiness, importedByRef }
}

export function loadPlanningContextReportArtifact(path: string): PlanningToDraftingContextReport {
  const abs = resolve(path)
  if (!existsSync(abs)) throw new Error(`planning context report not found: ${abs}`)
  return JSON.parse(readFileSync(abs, "utf8")) as PlanningToDraftingContextReport
}

export function buildPlanningContextReadinessAggregate(input: {
  report: PlanningToDraftingContextReport
  sourceReport?: string
  includeDense?: boolean
  generatedAt?: string
}): PlanningContextReadinessAggregate {
  const sceneLoadGroups = input.report.upstream.sceneLoad.chapters
    .filter(chapter => shouldIncludeChapter(chapter, input.includeDense === true))
    .map((chapter, index) => groupForChapter({
      report: input.report,
      chapter,
      sourceReport: input.sourceReport ?? `planning-drafting-context:${input.report.novelId ?? "unknown"}`,
      groupIndex: index,
    }))
  const futureEventGroups = (input.report.upstream.planContinuity?.futureEventAnchors ?? [])
    .map((finding, index) => groupForFutureEventAnchor({
      report: input.report,
      finding,
      sourceReport: input.sourceReport ?? `planning-drafting-context:${input.report.novelId ?? "unknown"}`,
      groupIndex: sceneLoadGroups.length + index,
    }))
  const factContradictionGroups = (input.report.upstream.planContinuity?.factContradictions ?? [])
    .map((finding, index) => groupForFactContradiction({
      report: input.report,
      finding,
      sourceReport: input.sourceReport ?? `planning-drafting-context:${input.report.novelId ?? "unknown"}`,
      groupIndex: sceneLoadGroups.length + futureEventGroups.length + index,
    }))
  const sceneContractGroups = prioritizedSceneContractGaps(input.report)
    .map((gap, index) => groupForSceneContractGap({
      report: input.report,
      gap,
      sourceReport: input.sourceReport ?? `planning-drafting-context:${input.report.novelId ?? "unknown"}`,
      groupIndex: sceneLoadGroups.length + futureEventGroups.length + factContradictionGroups.length + index,
    }))
  const referenceContextGroups = (input.report.referenceContextAttempts ?? [])
    .map((attempt, index) => groupForReferenceContextAttempt({
      report: input.report,
      attempt,
      sourceReport: input.sourceReport ?? `planning-drafting-context:${input.report.novelId ?? "unknown"}`,
      groupIndex: sceneLoadGroups.length + futureEventGroups.length + factContradictionGroups.length + sceneContractGroups.length + index,
    }))
  const groups = [...sceneLoadGroups, ...futureEventGroups, ...factContradictionGroups, ...sceneContractGroups, ...referenceContextGroups]

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceReports: [input.sourceReport ?? `planning-drafting-context:${input.report.novelId ?? "unknown"}`],
    labels: [],
    maxOrdinal: 1,
    findingCount: groups.length,
    groupCount: groups.length,
    groups,
  }
}

export function renderPlanningContextReadinessAggregate(report: PlanningContextReadinessAggregate): string {
  const lines: string[] = []
  lines.push("# Planning Context Readiness Candidates")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Groups: ${report.groupCount}`)
  lines.push(`Findings: ${report.findingCount}`)
  lines.push("")
  lines.push("These are manual Plan Readiness candidates from deterministic planning-context telemetry. They do not auto-mutate the plan.")
  lines.push("")
  for (const group of report.groups) {
    const finding = group.findings[0]!
    const target = group.rewritePacket.proposalCandidate.target
    lines.push(`## ${group.groupId} ${group.highestSeverity.toUpperCase()} ${group.chapterId}`)
    lines.push("")
    lines.push(`Target: ${target.kind}:${target.ref}:${target.fieldPath}`)
    lines.push(`Label: ${finding.label}`)
    if (finding.dimension === "futureEventAnchor") {
      lines.push(`Evidence: ${finding.evidence.sourceRef} -> ${finding.evidence.targetSceneRef}`)
    } else if (finding.dimension === "factContinuity") {
      lines.push(`Evidence: ${finding.evidence.sourceRef} -> ${finding.evidence.targetSceneRef}`)
    } else if (finding.dimension === "sceneContract") {
      lines.push(`Evidence: ${finding.evidence.sceneRef}; missing=${finding.evidence.missingFields}`)
    } else if (finding.dimension === "referenceContext") {
      lines.push(`Evidence: ${finding.evidence.sceneRef}; events=${finding.evidence.eventIds}; lookups=${finding.evidence.referenceLookups}`)
    } else {
      lines.push(`Scene load: ${finding.evidence.sceneCount} scenes, ${finding.evidence.targetWordsPerScene} target words/scene`)
    }
    lines.push("")
    lines.push("Operator question:")
    if (finding.dimension === "futureEventAnchor") {
      lines.push("- Should this scene contract carry the scheduled temporal anchor, or should the prior schedule be revised?")
    } else if (finding.dimension === "factContinuity") {
      lines.push("- Should this scene plan preserve the established fact, or should the prior fact be explicitly revised?")
    } else if (finding.dimension === "sceneContract") {
      lines.push("- Should this scene plan be replaced with a complete dramatic contract before drafting?")
    } else if (finding.dimension === "referenceContext") {
      lines.push("- Should this scene description name the referenced prior context directly, add an explicit source ref, or remove the implicit reference?")
    } else {
      lines.push("- Should this chapter be split, scene-count reduced, or scene purposes combined before drafting?")
    }
    lines.push("")
    lines.push("Rewrite goals if accepted:")
    for (const goal of group.rewritePacket.rewriteGoals) lines.push(`- ${goal}`)
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function prioritizedSceneContractGaps(report: PlanningToDraftingContextReport): DramaticSceneContractGap[] {
  const shape = report.upstream.sceneContractShape
  const choiceGaps = shape?.missingChoiceShape ?? []
  const choiceRefs = new Set(choiceGaps.map(gap => gap.sceneRef))
  const fullOnlyGaps = (shape?.missingFullDramaticShape ?? [])
    .filter(gap => !choiceRefs.has(gap.sceneRef))
  return [...choiceGaps, ...fullOnlyGaps]
}

function shouldIncludeChapter(chapter: ChapterSceneLoad, includeDense: boolean): boolean {
  return chapter.signal === "overloaded" || (includeDense && chapter.signal === "dense")
}

function groupForChapter(args: {
  report: PlanningToDraftingContextReport
  chapter: ChapterSceneLoad
  sourceReport: string
  groupIndex: number
}): PlanningContextReadinessGroup {
  const sourceIds = emptySourceIds()
  const label = labelFor(args.chapter.signal)
  const chapterId = chapterRef(args.chapter)
  const finding: PlanningContextReadinessFinding = {
    findingId: `${String(args.groupIndex + 1).padStart(3, "0")}.1`,
    sourceReport: args.sourceReport,
    promptMode: "deterministic-planning-context",
    dimension: "sceneLoad",
    label,
    severity: severityFor(args.chapter.signal),
    fixIntent: "rebalance_scene_load",
    rationale: sceneLoadRationale(args.chapter),
    missingForNextLevel: "Rebalance the upstream chapter plan so each scene has enough room for a clear scene turn, temporal/place anchor, endpoint consequence, and character materiality.",
    evidence: {
      chapterNumber: String(args.chapter.chapterNumber),
      chapterId,
      sceneCount: String(args.chapter.sceneCount),
      sceneRefs: chapterSceneRefs(args.chapter).join(","),
      targetWords: args.chapter.targetWords === null ? "n/a" : String(args.chapter.targetWords),
      targetWordsPerScene: formatNullableNumber(args.chapter.targetWordsPerScene),
      signal: args.chapter.signal,
      maxScenesPerChapter: String(args.report.upstream.sceneLoad.maxScenesPerChapter),
      minTargetWordsPerScene: formatNullableNumber(args.report.upstream.sceneLoad.minTargetWordsPerScene),
    },
  }
  return {
    groupId: `${String(args.groupIndex + 1).padStart(3, "0")}`,
    fixtureId: args.report.novelId ?? "unknown",
    armId: "planning-context-readiness",
    methodPackEnabled: false,
    unitType: "chapter",
    chapterId,
    sceneId: "",
    sourceIds,
    highestSeverity: finding.severity,
    fixIntents: ["rebalance_scene_load"],
    dimensions: ["sceneLoad"],
    findings: [finding],
    rewritePacket: {
      targetSummary: `chapter ${args.chapter.chapterNumber} ${chapterId}`,
      rewriteGoals: [
        finding.missingForNextLevel,
        "Prefer upstream chapter split, scene merge, or scene purpose consolidation over deterministic prose compaction.",
        "Preserve traceability IDs for any scene/obligation/thread/payoff that remains in the plan.",
      ],
      preserveIds: sourceIds,
      proposalCandidate: {
        action: "scene_select",
        target: {
          kind: "chapter_outline",
          ref: chapterId,
          fieldPath: "scenes",
        },
        requiresProposedValue: true,
        proposedValueStatus: "operator_required",
        safeToAutoApply: false,
        sourceAgent: "planning-context-readiness",
      },
    },
    excerpt: sceneLoadRationale(args.chapter),
  }
}

function groupForFutureEventAnchor(args: {
  report: PlanningToDraftingContextReport
  finding: FutureEventAnchorFinding
  sourceReport: string
  groupIndex: number
}): PlanningContextReadinessGroup {
  const sourceIds = emptySourceIds()
  sourceIds.sourceIds = [args.finding.sourceRef].filter(Boolean)
  const readinessFinding: PlanningContextReadinessFinding = {
    findingId: `${String(args.groupIndex + 1).padStart(3, "0")}.1`,
    sourceReport: args.sourceReport,
    promptMode: "deterministic-planning-context",
    dimension: "futureEventAnchor",
    label: "FUTURE-EVENT-ANCHOR-MISSING",
    severity: args.finding.severity,
    fixIntent: "preserve_future_event_anchor",
    rationale: `A future event was scheduled upstream but the later scene executes or invokes it without carrying the temporal anchor: ${args.finding.sourceText}`,
    missingForNextLevel: args.finding.requiredTemporalCue,
    evidence: {
      sourceChapterNumber: String(args.finding.sourceChapterNumber),
      sourceChapterId: args.finding.sourceChapterId,
      targetChapterNumber: String(args.finding.targetChapterNumber),
      targetChapterId: args.finding.targetChapterId,
      sourceRef: args.finding.sourceRef,
      targetSceneRef: args.finding.targetSceneRef,
      sourceText: args.finding.sourceText,
      targetTextExcerpt: args.finding.targetTextExcerpt,
      eventTokens: args.finding.eventTokens.join(","),
    },
  }
  return {
    groupId: `${String(args.groupIndex + 1).padStart(3, "0")}`,
    fixtureId: args.report.novelId ?? "unknown",
    armId: "planning-context-readiness",
    methodPackEnabled: false,
    unitType: "scene",
    chapterId: args.finding.targetChapterId,
    sceneId: args.finding.targetSceneRef,
    sourceIds,
    highestSeverity: readinessFinding.severity,
    fixIntents: ["preserve_future_event_anchor"],
    dimensions: ["futureEventAnchor"],
    findings: [readinessFinding],
    rewritePacket: {
      targetSummary: `scene ${args.finding.targetSceneRef}`,
      rewriteGoals: [
        args.finding.requiredTemporalCue,
        "Prefer an explicit scene-plan timing/location anchor over relying on the writer to infer continuity from the prior chapter.",
        "Preserve the scene endpoint and traceability IDs while clarifying when/where the scheduled event lands.",
      ],
      preserveIds: sourceIds,
      proposalCandidate: {
        action: "field_replace",
        target: {
          kind: "scene_plan",
          ref: args.finding.targetSceneRef,
          fieldPath: "temporalAnchor",
        },
        requiresProposedValue: true,
        proposedValueStatus: "operator_required",
        safeToAutoApply: false,
        sourceAgent: "planning-context-readiness",
      },
    },
    excerpt: `${args.finding.sourceText}\n${args.finding.targetTextExcerpt}`,
  }
}

function groupForFactContradiction(args: {
  report: PlanningToDraftingContextReport
  finding: PlanFactContradictionFinding
  sourceReport: string
  groupIndex: number
}): PlanningContextReadinessGroup {
  const sourceIds = emptySourceIds()
  sourceIds.sourceIds = [args.finding.sourceRef].filter(Boolean)
  sourceIds.sceneTurnIds = [args.finding.targetSceneRef].filter(Boolean)
  const readinessFinding: PlanningContextReadinessFinding = {
    findingId: `${String(args.groupIndex + 1).padStart(3, "0")}.1`,
    sourceReport: args.sourceReport,
    promptMode: "deterministic-planning-context",
    dimension: "factContinuity",
    label: "PLAN-FACT-STATUS-CONTRADICTION",
    severity: args.finding.severity,
    fixIntent: "preserve_immutable_fact",
    rationale: `A later scene appears to reverse an established fact status for ${args.finding.sharedAnchors.join(", ")}.`,
    missingForNextLevel: args.finding.requiredFactStatus,
    evidence: {
      sourceChapterNumber: String(args.finding.sourceChapterNumber),
      sourceChapterId: args.finding.sourceChapterId,
      targetChapterNumber: String(args.finding.targetChapterNumber),
      targetChapterId: args.finding.targetChapterId,
      sourceRef: args.finding.sourceRef,
      targetSceneRef: args.finding.targetSceneRef,
      sourceText: args.finding.sourceText,
      targetTextExcerpt: args.finding.targetTextExcerpt,
      sharedAnchors: args.finding.sharedAnchors.join(","),
      conflictTokens: args.finding.conflictTokens.join(","),
    },
  }
  return {
    groupId: `${String(args.groupIndex + 1).padStart(3, "0")}`,
    fixtureId: args.report.novelId ?? "unknown",
    armId: "planning-context-readiness",
    methodPackEnabled: false,
    unitType: "scene",
    chapterId: args.finding.targetChapterId,
    sceneId: args.finding.targetSceneRef,
    sourceIds,
    highestSeverity: readinessFinding.severity,
    fixIntents: ["preserve_immutable_fact"],
    dimensions: ["factContinuity"],
    findings: [readinessFinding],
    rewritePacket: {
      targetSummary: `scene ${args.finding.targetSceneRef}`,
      rewriteGoals: [
        args.finding.requiredFactStatus,
        "Replace or revise the later scene plan so it does not silently reclassify an established entity/role status.",
        "If the later status is intentional, create an explicit upstream fact revision instead of relying on an implicit contradiction.",
      ],
      preserveIds: sourceIds,
      proposalCandidate: {
        action: "beat_replace",
        target: {
          kind: "scene_plan",
          ref: args.finding.targetSceneRef,
          fieldPath: "self",
        },
        requiresProposedValue: true,
        proposedValueStatus: "operator_required",
        safeToAutoApply: false,
        sourceAgent: "planning-context-readiness",
      },
    },
    excerpt: `${args.finding.sourceText}\n${args.finding.targetTextExcerpt}`,
  }
}

function groupForSceneContractGap(args: {
  report: PlanningToDraftingContextReport
  gap: DramaticSceneContractGap
  sourceReport: string
  groupIndex: number
}): PlanningContextReadinessGroup {
  const sourceIds = sourceIdsFromSceneContractGap(args.gap)
  const readinessFinding: PlanningContextReadinessFinding = {
    findingId: `${String(args.groupIndex + 1).padStart(3, "0")}.1`,
    sourceReport: args.sourceReport,
    promptMode: "deterministic-planning-context",
    dimension: "sceneContract",
    label: args.gap.label === "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE"
      ? "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE"
      : "SCENE-CONTRACT-FULL-SHAPE-INCOMPLETE",
    severity: args.gap.severity,
    fixIntent: "complete_scene_contract",
    rationale: `Scene ${args.gap.sceneRef} has a partial scene contract: missing ${args.gap.missingFields.join(", ")}.`,
    missingForNextLevel: sceneContractMissingForNextLevel(args.gap),
    evidence: {
      chapterNumber: String(args.gap.chapterNumber),
      chapterId: args.gap.chapterId,
      sceneRef: args.gap.sceneRef,
      descriptionExcerpt: args.gap.descriptionExcerpt,
      missingFields: args.gap.missingFields.join(","),
      hasChoiceShape: String(args.gap.hasChoiceShape),
      hasEndpointShape: String(args.gap.hasEndpointShape),
      hasFullDramaticShape: String(args.gap.hasFullDramaticShape),
      obligationIds: args.gap.obligationIds.join(","),
      sourceIds: args.gap.sourceIds.join(","),
    },
  }
  return {
    groupId: `${String(args.groupIndex + 1).padStart(3, "0")}`,
    fixtureId: args.report.novelId ?? "unknown",
    armId: "planning-context-readiness",
    methodPackEnabled: false,
    unitType: "scene",
    chapterId: args.gap.chapterId,
    sceneId: args.gap.sceneRef,
    sourceIds,
    highestSeverity: readinessFinding.severity,
    fixIntents: ["complete_scene_contract"],
    dimensions: ["sceneContract"],
    findings: [readinessFinding],
    rewritePacket: {
      targetSummary: `scene ${args.gap.sceneRef}`,
      rewriteGoals: [
        readinessFinding.missingForNextLevel,
        "Prefer a full scene-plan replacement that preserves the existing sceneId, obligations, source refs, endpoint intent, and character/world pressure.",
        "Do not add a crisis choice to a true transit/establishment scene unless the scene is meant to carry a dramatic turn.",
      ],
      preserveIds: sourceIds,
      proposalCandidate: {
        action: "beat_replace",
        target: {
          kind: "scene_plan",
          ref: args.gap.sceneRef,
          fieldPath: "self",
        },
        requiresProposedValue: true,
        proposedValueStatus: "operator_required",
        safeToAutoApply: false,
        sourceAgent: "planning-context-readiness",
      },
    },
    excerpt: `${args.gap.descriptionExcerpt}\nMissing: ${args.gap.missingFields.join(", ")}`,
  }
}

function sceneContractMissingForNextLevel(gap: DramaticSceneContractGap): string {
  if (gap.label === "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE") {
    return "Add a real crisisChoice with at least two concrete choiceAlternatives, or explicitly simplify the scene so it no longer pretends to carry a dramatic decision."
  }
  return "Complete the scene contract with goal, opposition, turningPoint, crisisChoice, two choiceAlternatives, outcome, consequence, povPersonalStake, valueIn, and valueOut where the scene is meant to carry a dramatic turn."
}

function sourceIdsFromSceneContractGap(gap: DramaticSceneContractGap): PlanningContextReadinessSourceIds {
  return {
    obligationIds: gap.obligationIds,
    characterIds: gap.characterIds,
    worldFactIds: [],
    sceneTurnIds: [gap.sceneRef],
    threadIds: gap.threadIds,
    promiseIds: gap.promiseIds,
    payoffIds: gap.payoffIds,
    sourceIds: gap.sourceIds,
  }
}

function groupForReferenceContextAttempt(args: {
  report: PlanningToDraftingContextReport
  attempt: ReferenceContextAttemptSummary
  sourceReport: string
  groupIndex: number
}): PlanningContextReadinessGroup {
  const sceneRef = args.attempt.sceneRef ?? `chapter:${args.attempt.chapter ?? "unknown"}:beat:${args.attempt.beatIndex ?? "unknown"}`
  const chapterId = args.attempt.chapter === null ? "unknown" : `chapter:${args.attempt.chapter}`
  const sourceIds = emptySourceIds()
  sourceIds.sceneTurnIds = [sceneRef]
  const eventIds = args.attempt.eventIds.map(String)
  const readinessFinding: PlanningContextReadinessFinding = {
    findingId: `${String(args.groupIndex + 1).padStart(3, "0")}.1`,
    sourceReport: args.sourceReport,
    promptMode: "deterministic-planning-context",
    dimension: "referenceContext",
    label: "REFERENCE-CONTEXT-UNRESOLVED",
    severity: "low",
    fixIntent: "resolve_reference_context",
    rationale: `Scene ${sceneRef} triggered implicit-reference resolution, but no resolved reference context reached the writer prompt.`,
    missingForNextLevel: "Make the referenced prior event/entity/fact explicit in the scene description or source refs, or revise the scene so it does not depend on an unresolved implicit reference.",
    evidence: {
      eventIds: eventIds.join(","),
      eventCount: String(args.attempt.eventCount),
      stages: args.attempt.stages.join(","),
      sceneRef,
      chapter: args.attempt.chapter === null ? "n/a" : String(args.attempt.chapter),
      beatIndex: args.attempt.beatIndex === null ? "n/a" : String(args.attempt.beatIndex),
      referenceLookups: String(args.attempt.referenceLookups),
      referenceLlmCalls: String(args.attempt.referenceLlmCalls),
      canonSourceRefs: String(args.attempt.canonSourceRefs),
      storyRefIds: String(args.attempt.storyRefIds),
      readerInfoStateChars: String(args.attempt.readerInfoStateChars),
      missingCharacterIds: String(args.attempt.missingCharacterIds),
      descriptionExcerpt: args.attempt.descriptionExcerpt ?? "",
    },
  }
  return {
    groupId: `${String(args.groupIndex + 1).padStart(3, "0")}`,
    fixtureId: args.report.novelId ?? "unknown",
    armId: "planning-context-readiness",
    methodPackEnabled: false,
    unitType: "scene",
    chapterId,
    sceneId: sceneRef,
    sourceIds,
    highestSeverity: readinessFinding.severity,
    fixIntents: ["resolve_reference_context"],
    dimensions: ["referenceContext"],
    findings: [readinessFinding],
    rewritePacket: {
      targetSummary: `scene ${sceneRef}`,
      rewriteGoals: [
        readinessFinding.missingForNextLevel,
        "Prefer clarifying the upstream scene plan or source refs over relying on resolver guesses inside the writer prompt.",
        "Do not add a dedicated tag unless the referenced context is actually needed for endpoint, character materiality, or world pressure.",
      ],
      preserveIds: sourceIds,
      proposalCandidate: {
        action: "field_replace",
        target: {
          kind: "scene_plan",
          ref: sceneRef,
          fieldPath: "description",
        },
        requiresProposedValue: true,
        proposedValueStatus: "operator_required",
        safeToAutoApply: false,
        sourceAgent: "planning-context-readiness",
      },
    },
    excerpt: args.attempt.descriptionExcerpt ?? `Unresolved reference context for ${sceneRef}`,
  }
}

function chapterRef(chapter: ChapterSceneLoad): string {
  const ref = (chapter as ChapterSceneLoad & { chapterId?: string }).chapterId
  return ref && ref.trim().length > 0 ? ref : `chapter:${chapter.chapterNumber}`
}

function chapterSceneRefs(chapter: ChapterSceneLoad): string[] {
  const refs = (chapter as ChapterSceneLoad & { sceneRefs?: unknown }).sceneRefs
  if (!Array.isArray(refs)) return []
  return refs.filter((ref): ref is string => typeof ref === "string" && ref.length > 0)
}

function labelFor(signal: SceneLoadSignal): PlanningContextReadinessFinding["label"] {
  return signal === "dense" ? "SCENE-LOAD-DENSE" : "SCENE-LOAD-OVERLOADED"
}

function severityFor(signal: SceneLoadSignal): Severity {
  if (signal === "overloaded") return "high"
  if (signal === "dense") return "medium"
  return "info"
}

function sceneLoadRationale(chapter: ChapterSceneLoad): string {
  return `Chapter ${chapter.chapterNumber} has ${chapter.sceneCount} planned scenes for ${chapter.targetWords ?? "unknown"} target words (${formatNullableNumber(chapter.targetWordsPerScene)} target words/scene), classified as ${chapter.signal}.`
}

function emptySourceIds(): PlanningContextReadinessSourceIds {
  return {
    obligationIds: [],
    characterIds: [],
    worldFactIds: [],
    sceneTurnIds: [],
    threadIds: [],
    promiseIds: [],
    payoffIds: [],
    sourceIds: [],
  }
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function writeOutput(path: string, content: string): void {
  const abs = resolve(path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

async function closeDb(): Promise<void> {
  const { default: db } = await import("../../src/db/connection")
  await db.end().catch(() => {})
}

async function main(): Promise<number> {
  let args: PlanningContextReadinessArgs
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/planning-context-readiness.ts (--novel <novelId> | --report <context-report.json>) [--output <report.md>] [--json <aggregate.json>] [--include-dense] [--import-readiness]")
    return 2
  }

  try {
    const report = args.reportPath
      ? loadPlanningContextReportArtifact(args.reportPath)
      : await loadPlanningToDraftingContextReport(args.novelId!)
    const sourceReport = args.reportPath ? resolve(args.reportPath) : `planning-drafting-context:${args.novelId}`
    const aggregate = buildPlanningContextReadinessAggregate({
      report,
      sourceReport,
      includeDense: args.includeDense,
    })
    const rendered = renderPlanningContextReadinessAggregate(aggregate)
    if (args.outputPath) writeOutput(args.outputPath, rendered)
    if (args.jsonPath) writeOutput(args.jsonPath, `${JSON.stringify(aggregate, null, 2)}\n`)
    console.log(rendered)
    if (args.importReadiness) {
      const novelId = args.novelId ?? report.novelId
      if (!novelId) throw new Error("--novel is required when importing a report without novelId")
      const { importPlanReadinessAggregateForNovel } = await import("../../src/harness/plan-readiness-import")
      const imported = await importPlanReadinessAggregateForNovel({
        novelId,
        aggregate,
        importedByKind: "script",
        importedByRef: args.importedByRef ?? "planning-context-readiness",
        refreshStaleness: true,
      })
      console.log(`imported ${imported.inserted} readiness items, updated ${imported.updated}, skipped ${imported.skipped.length}`)
    }
    return 0
  } catch (err) {
    console.error(err instanceof Error ? err.stack : String(err))
    return 1
  } finally {
    await closeDb()
  }
}

if (import.meta.main) {
  process.exit(await main())
}
