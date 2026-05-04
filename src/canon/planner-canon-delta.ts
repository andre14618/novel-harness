/**
 * Live planner Canon-delta audit.
 *
 * This audits the actual generated chapter outline surface: planner/state
 * mapper IDs, payoff links, and beat obligation source references. It is a
 * mechanical ID-graph audit, not a semantic truth audit.
 */

import type { ChapterOutline, BeatObligationsContract } from "../types"
import { ID_RE, enrichOutlineIds } from "../harness/ids"
import { validateBeatObligationCoverage } from "../harness/beat-obligations"

export type PlannerCanonDeltaKind = "fact" | "knowledge" | "state"

export interface PlannerCanonDeltaSourceItem {
  kind: PlannerCanonDeltaKind
  id: string
  validId: boolean
  chapterN: number
  text: string
  category?: string
  characterName?: string
  characterId?: string
  /**
   * Structured `state`-only payload preserved from the outline so the
   * downstream proposal carries machine-readable fields onto the committed
   * canon row. Per Codex round-1 review of Package A (HIGH 2): without
   * these the audit's `summarizeState` string was the only artifact left
   * after approval, which broke deterministic character-state
   * reconstruction from canon. Empty/absent on non-state items.
   */
  state?: {
    location?: string
    emotionalState?: string
    knows?: readonly string[]
    doesNotKnow?: readonly string[]
  }
}

export interface PlannerCanonDeltaObligationRef {
  chapterN: number
  beatIndex: number
  beatId: string
  list: ObligationListKey
  obligationId?: string
  sourceId?: string
  sourceKind?: string
  characterId?: string
  text: string
}

export interface PlannerCanonDeltaPayoffLink {
  chapterN: number
  setupBeatIndex: number
  setupBeatId: string
  factId: string
  factExists: boolean
  payoffBeatIndex: number
  payoffBeatId?: string
  targetBeatExists: boolean
}

export interface PlannerCanonDeltaDuplicateId {
  id: string
  occurrences: Array<{
    kind: PlannerCanonDeltaKind
    chapterN: number
    text: string
  }>
}

export interface PlannerCanonDeltaChapterReport {
  chapterN: number
  title: string
  chapterId: string
  beatCount: number
  sourceItems: PlannerCanonDeltaSourceItem[]
  payoffLinks: PlannerCanonDeltaPayoffLink[]
  obligations: PlannerCanonDeltaObligationRef[]
  validation: {
    valid: boolean
    errors: string[]
    warnings: string[]
    missingSourceIds: string[]
    unknownObligations: Array<{ beatId: string; obligationKey: string; sourceId: string }>
    summary: {
      factCount: number
      knowledgeCount: number
      stateChangeCount: number
      orphanFacts: number
      orphanKnowledgeChanges: number
      orphanStateChanges: number
      overloadedBeats: number
      missingSourceIds: number
      unknownObligationSourceIds: number
      duplicateSourceIds: number
      sourceKindMismatches: number
      characterIdMismatches: number
    }
  }
}

export interface PlannerCanonDeltaReport {
  sourceName: string
  chapters: PlannerCanonDeltaChapterReport[]
  sourceItems: PlannerCanonDeltaSourceItem[]
  payoffLinks: PlannerCanonDeltaPayoffLink[]
  obligations: PlannerCanonDeltaObligationRef[]
  duplicateSourceIds: PlannerCanonDeltaDuplicateId[]
  invalidSourceItems: PlannerCanonDeltaSourceItem[]
  cumulativeByChapter: Array<{
    chapterN: number
    facts: number
    knowledge: number
    states: number
    totalSourceItems: number
  }>
  summary: {
    chapterCount: number
    beatCount: number
    factCount: number
    knowledgeCount: number
    stateCount: number
    sourceItemCount: number
    validSourceIdCount: number
    invalidSourceIdCount: number
    duplicateSourceIdCount: number
    payoffLinkCount: number
    invalidPayoffLinkCount: number
    obligationCount: number
    unknownObligationSourceIdCount: number
    missingSourceIdCoverageCount: number
    sourceKindMismatchCount: number
    characterIdMismatchCount: number
    overloadedBeatCount: number
    validationErrorCount: number
    artifactGateClear: boolean
    idGraphGateClear: boolean
    recommendation: PlannerCanonDeltaRecommendation
  }
}

export type PlannerCanonDeltaRecommendation =
  | "ready-for-semantic-labeling"
  | "fix-id-graph"
  | "insufficient-artifact"

type ObligationListKey = keyof Pick<
  BeatObligationsContract,
  | "mustEstablish"
  | "mustPayOff"
  | "mustTransferKnowledge"
  | "mustShowStateChange"
  | "mustNotReveal"
>

const OBLIGATION_LISTS: readonly ObligationListKey[] = [
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
  "mustNotReveal",
]

export function runPlannerCanonDeltaAudit(
  sourceName: string,
  outlines: readonly ChapterOutline[],
): PlannerCanonDeltaReport {
  const chapters = outlines
    .map(cloneOutline)
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
    .map(auditChapter)

  const sourceItems = chapters.flatMap((chapter) => chapter.sourceItems)
  const payoffLinks = chapters.flatMap((chapter) => chapter.payoffLinks)
  const obligations = chapters.flatMap((chapter) => chapter.obligations)
  const duplicateSourceIds = findDuplicateSourceIds(sourceItems)
  const invalidSourceItems = sourceItems.filter((item) => !item.validId)
  const validationErrorCount = chapters.reduce(
    (sum, chapter) => sum + chapter.validation.errors.length,
    0,
  )
  const missingSourceIdCoverageCount = chapters.reduce(
    (sum, chapter) => sum + chapter.validation.missingSourceIds.length,
    0,
  )
  const unknownObligationSourceIdCount = chapters.reduce(
    (sum, chapter) => sum + chapter.validation.unknownObligations.length,
    0,
  )
  const sourceKindMismatchCount = chapters.reduce(
    (sum, chapter) => sum + chapter.validation.summary.sourceKindMismatches,
    0,
  )
  const characterIdMismatchCount = chapters.reduce(
    (sum, chapter) => sum + chapter.validation.summary.characterIdMismatches,
    0,
  )
  const overloadedBeatCount = chapters.reduce(
    (sum, chapter) => sum + chapter.validation.summary.overloadedBeats,
    0,
  )
  const invalidPayoffLinkCount = payoffLinks.filter(
    (link) => !link.factExists || !link.targetBeatExists,
  ).length
  const artifactGateClear = chapters.length > 0 && sourceItems.length > 0
  const idGraphGateClear =
    artifactGateClear &&
    invalidSourceItems.length === 0 &&
    duplicateSourceIds.length === 0 &&
    validationErrorCount === 0 &&
    invalidPayoffLinkCount === 0
  const recommendation: PlannerCanonDeltaRecommendation = !artifactGateClear
    ? "insufficient-artifact"
    : idGraphGateClear
      ? "ready-for-semantic-labeling"
      : "fix-id-graph"

  return {
    sourceName,
    chapters,
    sourceItems,
    payoffLinks,
    obligations,
    duplicateSourceIds,
    invalidSourceItems,
    cumulativeByChapter: cumulativeByChapter(chapters),
    summary: {
      chapterCount: chapters.length,
      beatCount: chapters.reduce((sum, chapter) => sum + chapter.beatCount, 0),
      factCount: sourceItems.filter((item) => item.kind === "fact").length,
      knowledgeCount: sourceItems.filter((item) => item.kind === "knowledge").length,
      stateCount: sourceItems.filter((item) => item.kind === "state").length,
      sourceItemCount: sourceItems.length,
      validSourceIdCount: sourceItems.filter((item) => item.validId).length,
      invalidSourceIdCount: invalidSourceItems.length,
      duplicateSourceIdCount: duplicateSourceIds.length,
      payoffLinkCount: payoffLinks.length,
      invalidPayoffLinkCount,
      obligationCount: obligations.length,
      unknownObligationSourceIdCount,
      missingSourceIdCoverageCount,
      sourceKindMismatchCount,
      characterIdMismatchCount,
      overloadedBeatCount,
      validationErrorCount,
      artifactGateClear,
      idGraphGateClear,
      recommendation,
    },
  }
}

function auditChapter(outline: ChapterOutline): PlannerCanonDeltaChapterReport {
  enrichOutlineIds(outline)
  const validation = validateBeatObligationCoverage(outline)
  return {
    chapterN: outline.chapterNumber,
    title: outline.title,
    chapterId: outline.chapterId ?? "",
    beatCount: outline.scenes?.length ?? 0,
    sourceItems: sourceItemsFor(outline),
    payoffLinks: payoffLinksFor(outline),
    obligations: obligationsFor(outline),
    validation: {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      missingSourceIds: validation.missingSourceIds,
      unknownObligations: validation.unknownObligations,
      summary: { ...validation.summary },
    },
  }
}

function sourceItemsFor(outline: ChapterOutline): PlannerCanonDeltaSourceItem[] {
  const out: PlannerCanonDeltaSourceItem[] = []
  for (const fact of outline.establishedFacts ?? []) {
    const id = fact.id ?? ""
    out.push({
      kind: "fact",
      id,
      validId: ID_RE.test(id),
      chapterN: outline.chapterNumber,
      text: fact.fact,
      category: fact.category,
    })
  }
  for (const change of outline.knowledgeChanges ?? []) {
    const id = ((change as any).id ?? "") as string
    out.push({
      kind: "knowledge",
      id,
      validId: ID_RE.test(id),
      chapterN: outline.chapterNumber,
      text: change.knowledge,
      characterName: change.characterName,
      characterId: (change as any).characterId,
    })
  }
  for (const change of outline.characterStateChanges ?? []) {
    const id = ((change as any).id ?? "") as string
    out.push({
      kind: "state",
      id,
      validId: ID_RE.test(id),
      chapterN: outline.chapterNumber,
      text: summarizeState(change),
      characterName: change.name,
      characterId: (change as any).characterId,
      state: {
        ...(change.location ? { location: change.location } : {}),
        ...(change.emotionalState ? { emotionalState: change.emotionalState } : {}),
        ...(change.knows?.length ? { knows: [...change.knows] } : {}),
        ...(change.doesNotKnow?.length ? { doesNotKnow: [...change.doesNotKnow] } : {}),
      },
    })
  }
  return out
}

function payoffLinksFor(outline: ChapterOutline): PlannerCanonDeltaPayoffLink[] {
  const factIds = new Set((outline.establishedFacts ?? []).map((fact) => fact.id))
  const out: PlannerCanonDeltaPayoffLink[] = []
  for (let beatIndex = 0; beatIndex < (outline.scenes ?? []).length; beatIndex++) {
    const beat = outline.scenes[beatIndex]
    for (const link of beat.requiredPayoffs ?? []) {
      const payoffBeat = outline.scenes[link.payoff_beat]
      out.push({
        chapterN: outline.chapterNumber,
        setupBeatIndex: beatIndex,
        setupBeatId: beat.beatId ?? `beat-${beatIndex + 1}`,
        factId: link.fact_id,
        factExists: factIds.has(link.fact_id),
        payoffBeatIndex: link.payoff_beat,
        payoffBeatId: payoffBeat?.beatId,
        targetBeatExists: Boolean(payoffBeat),
      })
    }
  }
  return out
}

function obligationsFor(outline: ChapterOutline): PlannerCanonDeltaObligationRef[] {
  const out: PlannerCanonDeltaObligationRef[] = []
  for (let beatIndex = 0; beatIndex < (outline.scenes ?? []).length; beatIndex++) {
    const beat = outline.scenes[beatIndex]
    const obligations = beat.obligations
    if (!obligations) continue
    for (const list of OBLIGATION_LISTS) {
      for (const item of obligations[list] ?? []) {
        out.push({
          chapterN: outline.chapterNumber,
          beatIndex,
          beatId: beat.beatId ?? `beat-${beatIndex + 1}`,
          list,
          obligationId: (item as any).obligationId,
          sourceId: (item as any).sourceId,
          sourceKind: (item as any).sourceKind,
          characterId: (item as any).characterId,
          text: item.text ?? "",
        })
      }
    }
  }
  return out
}

function findDuplicateSourceIds(
  sourceItems: readonly PlannerCanonDeltaSourceItem[],
): PlannerCanonDeltaDuplicateId[] {
  const byId = new Map<string, PlannerCanonDeltaSourceItem[]>()
  for (const item of sourceItems) {
    if (!item.validId) continue
    const group = byId.get(item.id) ?? []
    group.push(item)
    byId.set(item.id, group)
  }
  return [...byId.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([id, items]) => ({
      id,
      occurrences: items.map((item) => ({
        kind: item.kind,
        chapterN: item.chapterN,
        text: item.text,
      })),
    }))
}

function cumulativeByChapter(
  chapters: readonly PlannerCanonDeltaChapterReport[],
): PlannerCanonDeltaReport["cumulativeByChapter"] {
  let facts = 0
  let knowledge = 0
  let states = 0
  return chapters.map((chapter) => {
    facts += chapter.sourceItems.filter((item) => item.kind === "fact").length
    knowledge += chapter.sourceItems.filter((item) => item.kind === "knowledge").length
    states += chapter.sourceItems.filter((item) => item.kind === "state").length
    return {
      chapterN: chapter.chapterN,
      facts,
      knowledge,
      states,
      totalSourceItems: facts + knowledge + states,
    }
  })
}

function summarizeState(change: ChapterOutline["characterStateChanges"][number]): string {
  const parts: string[] = []
  if (change.location) parts.push(`location=${change.location}`)
  if (change.emotionalState) parts.push(`emotion=${change.emotionalState}`)
  if (change.knows?.length) parts.push(`knows=${change.knows.join("; ")}`)
  if (change.doesNotKnow?.length) parts.push(`doesNotKnow=${change.doesNotKnow.join("; ")}`)
  return parts.join(" | ") || "state changed"
}

function cloneOutline(outline: ChapterOutline): ChapterOutline {
  return JSON.parse(JSON.stringify(outline)) as ChapterOutline
}
