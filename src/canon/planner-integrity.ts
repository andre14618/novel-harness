/**
 * Planner-output Bible-Input Integrity harness.
 *
 * Charter: docs/charters/world-bible-architecture.md Step 2
 * Lane:    docs/sessions/2026-05-03-step-2a-planner-canon-integrity.md
 *
 * This module is deterministic: static source items + static manual Canon
 * reference in, TP/FP/FN metrics out. No LLM calls, no embeddings, no fuzzy
 * semantic matching.
 */

import type { CanonFact, StoryPromise } from "./api"
import type { CanonFixture } from "./recall-validation"

// Integrity item model

export type PlannerIntegrityCategory =
  | "established_fact"
  | "knowledge_change"
  | "character_state"
  | "promise"
  | "payoff"
  | "story_promise"

export interface PlannerIntegrityItem {
  /** Stable namespaced ID. Usually `fact:<id>` or `promise:<id>`. */
  id: string
  category: PlannerIntegrityCategory
  chapterN: number
  text: string
  /** Source field or derivation path, for debugging FP/FN clusters. */
  source: string
}

export interface PlannerIntegrityInput {
  sourceName: string
  /**
   * `live-planner-output` is the only evidence kind that can justify direct
   * canon writes. The Salvatore planned-origin proxy is useful diagnostics, but
   * not a production planner sample.
   */
  evidenceKind?: PlannerIntegrityEvidenceKind
  emitted: readonly PlannerIntegrityItem[]
  reference: readonly PlannerIntegrityItem[]
}

export interface PlannerIntegrityBucketMetrics {
  category: PlannerIntegrityCategory | "overall"
  truePositives: PlannerIntegrityItem[]
  falsePositives: PlannerIntegrityItem[]
  falseNegatives: PlannerIntegrityItem[]
  precision: number
  recall: number
  f1: number
  emittedCount: number
  referenceCount: number
  gradedItemCount: number
  distinctChapterCount: number
}

export interface PlannerIntegrityReport {
  sourceName: string
  overall: PlannerIntegrityBucketMetrics
  byCategory: Record<PlannerIntegrityCategory, PlannerIntegrityBucketMetrics>
  thresholds: {
    minGradedItems: number
    minDistinctChapters: number
    precisionFloor: number
    recallFloor: number
    f1Floor: number
    evidenceKind: PlannerIntegrityEvidenceKind
    sourceEvidenceGateClear: boolean
    sampleGateClear: boolean
    precisionGateClear: boolean
    recallGateClear: boolean
    f1GateClear: boolean
    allGatesClear: boolean
    recommendation: PlannerIntegrityRecommendation
  }
}

export type PlannerIntegrityRecommendation =
  | "direct-canon-writes-ok"
  | "human-review-required"
  | "insufficient-sample"

export type PlannerIntegrityEvidenceKind =
  | "live-planner-output"
  | "planned-origin-proxy"

export const PLANNER_INTEGRITY_MIN_GRADED_ITEMS = 30
export const PLANNER_INTEGRITY_MIN_DISTINCT_CHAPTERS = 3
export const PLANNER_INTEGRITY_PRECISION_FLOOR = 0.8
export const PLANNER_INTEGRITY_RECALL_FLOOR = 0.6
export const PLANNER_INTEGRITY_F1_FLOOR = 0.7

const CATEGORIES: readonly PlannerIntegrityCategory[] = [
  "established_fact",
  "knowledge_change",
  "character_state",
  "promise",
  "payoff",
  "story_promise",
]

// Fixture builders

export function canonReferenceItems(
  canon: CanonFixture,
  opts: { chapters?: readonly number[] } = {},
): PlannerIntegrityItem[] {
  const chapters = opts.chapters ? new Set(opts.chapters) : undefined
  const out: PlannerIntegrityItem[] = []

  for (const fact of canon.facts) {
    if (chapters && !chapters.has(fact.provenance.chapter)) continue
    const category = categoryFromFact(fact)
    if (!category) continue
    out.push({
      id: `fact:${fact.id}`,
      category,
      chapterN: fact.provenance.chapter,
      text: fact.text,
      source: `canon.facts.${fact.kind}`,
    })
  }

  for (const promise of canon.promises) {
    if (chapters && !chapters.has(promise.setupChapter)) continue
    out.push(itemFromStoryPromise(promise))
  }

  return sortItems(dedupeItems(out))
}

/**
 * Planned-origin proxy for Step 2A when no live planner output fixture exists.
 *
 * The Salvatore manual Canon was authored after the fact, but each CanonFact
 * carries `provenance.origin`. Treating origin="planned" as source-emitted is
 * useful for a bounded coverage audit: it asks how much complete manual Canon
 * would have been covered by ideal planner-declared claims. This is NOT a
 * direct-write promotion verdict for the production planner.
 */
export function plannedOriginProxyItems(
  canon: CanonFixture,
  opts: { chapters?: readonly number[] } = {},
): PlannerIntegrityItem[] {
  const chapters = opts.chapters ? new Set(opts.chapters) : undefined
  const out: PlannerIntegrityItem[] = []

  for (const fact of canon.facts) {
    if (fact.provenance.origin !== "planned") continue
    if (chapters && !chapters.has(fact.provenance.chapter)) continue
    const category = categoryFromFact(fact)
    if (!category) continue
    out.push({
      id: `fact:${fact.id}`,
      category,
      chapterN: fact.provenance.chapter,
      text: fact.text,
      source: "salvatore.manual-canon.origin=planned",
    })
  }

  // StoryPromise is the structured promise table; for the Salvatore proxy we
  // treat all promise rows as planner-like because promises are explicitly
  // story-structure claims rather than prose-observed surface facts.
  for (const promise of canon.promises) {
    if (chapters && !chapters.has(promise.setupChapter)) continue
    out.push({
      ...itemFromStoryPromise(promise),
      source: "salvatore.manual-canon.promises",
    })
  }

  return sortItems(dedupeItems(out))
}

function categoryFromFact(fact: CanonFact): PlannerIntegrityCategory | null {
  switch (fact.kind) {
    case "established_fact":
      return "established_fact"
    case "knowledge_change":
      return "knowledge_change"
    case "character_state":
      return "character_state"
    case "promise":
      return "promise"
    case "payoff":
      return "payoff"
    default:
      return null
  }
}

function itemFromStoryPromise(promise: StoryPromise): PlannerIntegrityItem {
  return {
    id: `promise:${promise.id}`,
    category: "story_promise",
    chapterN: promise.setupChapter,
    text: `${promise.status} promise ${promise.id} setup at chapter ${promise.setupChapter}`,
    source: "canon.promises",
  }
}

// Metrics

export function runPlannerIntegrity(
  input: PlannerIntegrityInput,
): PlannerIntegrityReport {
  const evidenceKind = input.evidenceKind ?? "live-planner-output"
  const emitted = sortItems(dedupeItems(input.emitted))
  const reference = sortItems(dedupeItems(input.reference))

  const overall = metricsForBucket("overall", emitted, reference)
  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      metricsForBucket(
        category,
        emitted.filter((i) => i.category === category),
        reference.filter((i) => i.category === category),
      ),
    ]),
  ) as Record<PlannerIntegrityCategory, PlannerIntegrityBucketMetrics>

  const sourceEvidenceGateClear = evidenceKind === "live-planner-output"
  const sampleGateClear =
    overall.gradedItemCount >= PLANNER_INTEGRITY_MIN_GRADED_ITEMS &&
    overall.distinctChapterCount >= PLANNER_INTEGRITY_MIN_DISTINCT_CHAPTERS
  const precisionGateClear = overall.precision >= PLANNER_INTEGRITY_PRECISION_FLOOR
  const recallGateClear = overall.recall >= PLANNER_INTEGRITY_RECALL_FLOOR
  const f1GateClear = overall.f1 >= PLANNER_INTEGRITY_F1_FLOOR
  const allGatesClear =
    sourceEvidenceGateClear &&
    sampleGateClear &&
    precisionGateClear &&
    recallGateClear &&
    f1GateClear
  const recommendation: PlannerIntegrityRecommendation =
    !sourceEvidenceGateClear || !sampleGateClear
      ? "insufficient-sample"
      : allGatesClear
        ? "direct-canon-writes-ok"
        : "human-review-required"

  return {
    sourceName: input.sourceName,
    overall,
    byCategory,
    thresholds: {
      minGradedItems: PLANNER_INTEGRITY_MIN_GRADED_ITEMS,
      minDistinctChapters: PLANNER_INTEGRITY_MIN_DISTINCT_CHAPTERS,
      precisionFloor: PLANNER_INTEGRITY_PRECISION_FLOOR,
      recallFloor: PLANNER_INTEGRITY_RECALL_FLOOR,
      f1Floor: PLANNER_INTEGRITY_F1_FLOOR,
      evidenceKind,
      sourceEvidenceGateClear,
      sampleGateClear,
      precisionGateClear,
      recallGateClear,
      f1GateClear,
      allGatesClear,
      recommendation,
    },
  }
}

function metricsForBucket(
  category: PlannerIntegrityCategory | "overall",
  emitted: readonly PlannerIntegrityItem[],
  reference: readonly PlannerIntegrityItem[],
): PlannerIntegrityBucketMetrics {
  const emittedById = new Map(emitted.map((i) => [i.id, i]))
  const referenceById = new Map(reference.map((i) => [i.id, i]))

  const truePositives = emitted.filter((i) => referenceById.has(i.id))
  const falsePositives = emitted.filter((i) => !referenceById.has(i.id))
  const falseNegatives = reference.filter((i) => !emittedById.has(i.id))

  const precision = ratio(truePositives.length, emitted.length)
  const recall = ratio(truePositives.length, reference.length)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const distinctChapterCount = new Set([
    ...emitted.map((i) => i.chapterN),
    ...reference.map((i) => i.chapterN),
  ]).size

  return {
    category,
    truePositives: sortItems(truePositives),
    falsePositives: sortItems(falsePositives),
    falseNegatives: sortItems(falseNegatives),
    precision,
    recall,
    f1,
    emittedCount: emitted.length,
    referenceCount: reference.length,
    gradedItemCount: truePositives.length + falsePositives.length + falseNegatives.length,
    distinctChapterCount,
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function dedupeItems(items: readonly PlannerIntegrityItem[]): PlannerIntegrityItem[] {
  const map = new Map<string, PlannerIntegrityItem>()
  for (const item of items) map.set(item.id, item)
  return [...map.values()]
}

function sortItems(items: readonly PlannerIntegrityItem[]): PlannerIntegrityItem[] {
  return [...items].sort((a, b) => {
    if (a.chapterN !== b.chapterN) return a.chapterN - b.chapterN
    if (a.category !== b.category) return a.category < b.category ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
