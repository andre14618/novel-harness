import type { BeatObligationsContract, ChapterOutline, SceneBeat } from "../types"
import {
  enrichOutlineIds,
  characterIdFromName,
  knowledgeIdFromContent,
  stateIdFromContent,
  obligationIdGen,
  ID_RE,
  type SourceKind,
} from "./ids"
import type { PlanningStateRepairOutput, PlanningStateRepairOperation, RepairObligationList } from "../agents/planning-state-repair/schema"

export type BeatObligationKind =
  | "establish"
  | "payoff"
  | "knowledge"
  | "state"
  | "avoid"

export type BeatObligationConfidence = "explicit" | "inferred"

export interface BeatObligationItem {
  kind: BeatObligationKind
  text: string
  confidence: BeatObligationConfidence
  source: string
  factId?: string
  sourceId?: string
  sourceKind?: SourceKind | "avoid"
  obligationId?: string
  characterName?: string
  characterId?: string
  seededAtBeat?: number
}

export interface BeatObligations {
  mustEstablish: BeatObligationItem[]
  mustPayOff: BeatObligationItem[]
  mustTransferKnowledge: BeatObligationItem[]
  mustShowStateChange: BeatObligationItem[]
  mustNotReveal: BeatObligationItem[]
  allowedNewEntities: string[]
}

export interface BeatObligationShadowPlanSummary {
  factCount: number
  knowledgeCount: number
  stateChangeCount: number
  orphanFacts: number
  orphanKnowledgeChanges: number
  orphanStateChanges: number
  overloadedBeats: number
  // Stable-ID metrics (Phase 5).
  missingSourceIds: number
  unknownObligationSourceIds: number
  duplicateSourceIds: number
  sourceKindMismatches: number
  characterIdMismatches: number
}

export interface BeatObligationShadowPlan {
  beats: BeatObligations[]
  warnings: string[]
  summary: BeatObligationShadowPlanSummary
}

export interface BeatObligationCoverageValidation {
  valid: boolean
  errors: string[]
  warnings: string[]
  summary: BeatObligationShadowPlanSummary
  /** Names of source IDs that have no covering obligation. */
  missingSourceIds: string[]
  /** Obligation entries whose `sourceId` does not match any source registry. */
  unknownObligations: Array<{ beatId: string; obligationKey: string; sourceId: string }>
}

export interface BeatObligationRepairPatchResult {
  outline: ChapterOutline
  applied: string[]
  rejected: string[]
  validation: BeatObligationCoverageValidation
}

const EMPTY_OBLIGATIONS = (): BeatObligations => ({
  mustEstablish: [],
  mustPayOff: [],
  mustTransferKnowledge: [],
  mustShowStateChange: [],
  mustNotReveal: [],
  allowedNewEntities: [],
})

const PROPER_NOUN_STOPWORDS = new Set(["A", "An", "The"])
const OVERLOADED_BEAT_OBLIGATION_LIMIT = 5

// ── deriveBeatObligations ────────────────────────────────────────────────
// Builds a per-beat snapshot of authored obligations + payoff-link
// derivations. Pure passthrough of authored items — no inference from beat
// text into obligations (that would defeat the exact-ID contract).

export function deriveBeatObligations(outline: ChapterOutline): BeatObligationShadowPlan {
  enrichOutlineIds(outline)

  const beats = outline.scenes.map(() => EMPTY_OBLIGATIONS())
  const warnings: string[] = []
  const factById = new Map((outline.establishedFacts ?? [])
    .filter(f => f.id?.trim())
    .map(f => [f.id.trim(), f.fact]))

  for (let beatIndex = 0; beatIndex < outline.scenes.length; beatIndex++) {
    const beat = outline.scenes[beatIndex]
    const authored = normalizeAuthoredObligations(beat.obligations)
    addAuthoredObligations(beats[beatIndex], authored)
    beats[beatIndex].allowedNewEntities = mergeUnique([
      ...authored.allowedNewEntities,
      ...deriveAllowedNewEntities(beat, outline),
    ])

    for (const link of beat.requiredPayoffs ?? []) {
      const factId = link.fact_id?.trim()
      const fact = factId ? factById.get(factId) : null
      if (!factId || !fact) {
        warnings.push(`Chapter ${outline.chapterNumber} beat ${beatIndex + 1}: payoff link cannot become an obligation because fact_id "${factId ?? ""}" is missing`)
        continue
      }

      addObligation(beats[beatIndex].mustEstablish, {
        kind: "establish",
        text: fact,
        confidence: "explicit",
        source: "requiredPayoffs.seed",
        factId,
        sourceId: factId,
        sourceKind: "fact",
      })

      if (Number.isInteger(link.payoff_beat) && link.payoff_beat >= 0 && link.payoff_beat < beats.length) {
        addObligation(beats[link.payoff_beat].mustPayOff, {
          kind: "payoff",
          text: fact,
          confidence: "explicit",
          source: "requiredPayoffs.payoff",
          factId,
          sourceId: factId,
          sourceKind: "payoff",
          seededAtBeat: beatIndex,
        })
      } else {
        warnings.push(`Chapter ${outline.chapterNumber} beat ${beatIndex + 1}: payoff link for "${factId}" points outside the chapter and cannot become a payoff obligation`)
      }
    }
  }

  // ── Coverage analysis (exact-ID) ──────────────────────────────────────
  const validation = computeCoverage(outline)
  const summary: BeatObligationShadowPlanSummary = {
    factCount: outline.establishedFacts?.length ?? 0,
    knowledgeCount: outline.knowledgeChanges?.length ?? 0,
    stateChangeCount: outline.characterStateChanges?.length ?? 0,
    orphanFacts: validation.orphanFacts,
    orphanKnowledgeChanges: validation.orphanKnowledge,
    orphanStateChanges: validation.orphanState,
    overloadedBeats: 0,
    missingSourceIds: validation.missingSourceIds.length,
    unknownObligationSourceIds: validation.unknownObligations.length,
    duplicateSourceIds: validation.duplicateSourceIds,
    sourceKindMismatches: validation.sourceKindMismatches,
    characterIdMismatches: validation.characterIdMismatches,
  }

  for (const id of validation.missingSourceIds) {
    warnings.push(`Chapter ${outline.chapterNumber}: source id "${id}" is not covered by any beat obligation`)
  }
  for (const obl of validation.unknownObligations) {
    warnings.push(`Chapter ${outline.chapterNumber}: obligation on ${obl.beatId} (${obl.obligationKey}) references unknown sourceId "${obl.sourceId}"`)
  }
  for (const issue of validation.characterIssues) {
    warnings.push(`Chapter ${outline.chapterNumber}: ${issue}`)
  }

  // Overloaded-beat warning (by hard-obligation count, count includes
  // payoff-derived obligations).
  let overloadedBeats = 0
  for (let i = 0; i < beats.length; i++) {
    const hardCount = countHardObligations(beats[i])
    if (hardCount > OVERLOADED_BEAT_OBLIGATION_LIMIT) {
      overloadedBeats++
      warnings.push(`Chapter ${outline.chapterNumber} beat ${i + 1}: ${hardCount} obligations may overload the writer`)
    }
  }
  summary.overloadedBeats = overloadedBeats

  return { beats, warnings, summary }
}

interface InternalCoverage {
  orphanFacts: number
  orphanKnowledge: number
  orphanState: number
  missingSourceIds: string[]
  unknownObligations: Array<{ beatId: string; obligationKey: string; sourceId: string }>
  duplicateSourceIds: number
  sourceKindMismatches: number
  characterIdMismatches: number
  characterIssues: string[]
}

function computeCoverage(outline: ChapterOutline): InternalCoverage {
  const out: InternalCoverage = {
    orphanFacts: 0,
    orphanKnowledge: 0,
    orphanState: 0,
    missingSourceIds: [],
    unknownObligations: [],
    duplicateSourceIds: 0,
    sourceKindMismatches: 0,
    characterIdMismatches: 0,
    characterIssues: [],
  }

  // Build registries with duplicate detection across all source kinds.
  const allSourceIds = new Set<string>()
  const addSourceId = (id: string) => {
    if (allSourceIds.has(id)) out.duplicateSourceIds++
    allSourceIds.add(id)
  }

  const factRegistry = new Map<string, { fact: string }>()
  for (const fact of outline.establishedFacts ?? []) {
    const id = (fact.id ?? "").trim()
    if (!id) continue
    addSourceId(id)
    factRegistry.set(id, { fact: fact.fact })
  }

  const knowRegistry = new Map<string, { characterId: string; characterName: string; knowledge: string }>()
  for (const change of outline.knowledgeChanges ?? []) {
    const id = ((change as any).id ?? "").trim()
    if (!id) continue
    addSourceId(id)
    knowRegistry.set(id, {
      characterId: (change as any).characterId ?? characterIdFromName(change.characterName),
      characterName: change.characterName,
      knowledge: change.knowledge,
    })
  }

  const stateRegistry = new Map<string, { characterId: string; name: string }>()
  for (const change of outline.characterStateChanges ?? []) {
    const id = ((change as any).id ?? "").trim()
    if (!id) continue
    addSourceId(id)
    stateRegistry.set(id, {
      characterId: (change as any).characterId ?? characterIdFromName(change.name),
      name: change.name,
    })
  }

  // Collect all obligations with their context.
  const coveredFactIds = new Set<string>()
  const coveredKnowIds = new Set<string>()
  const coveredStateIds = new Set<string>()

  for (const beat of outline.scenes ?? []) {
    const beatId = beat.beatId ?? `beat-${(outline.scenes ?? []).indexOf(beat) + 1}`
    const obligations = beat.obligations
    if (!obligations) continue

    for (const item of obligations.mustEstablish ?? []) {
      const sId = (item as any).sourceId
      if (sId && factRegistry.has(sId)) coveredFactIds.add(sId)
      else if (sId) out.unknownObligations.push({ beatId, obligationKey: "mustEstablish", sourceId: sId })
      if (sId && !sourceKindMatches(item, ["fact"])) out.sourceKindMismatches++
    }
    for (const item of obligations.mustPayOff ?? []) {
      const sId = (item as any).sourceId
      if (sId && factRegistry.has(sId)) coveredFactIds.add(sId)
      else if (sId) out.unknownObligations.push({ beatId, obligationKey: "mustPayOff", sourceId: sId })
      if (sId && !sourceKindMatches(item, ["fact", "payoff"])) out.sourceKindMismatches++
    }
    for (const item of obligations.mustTransferKnowledge ?? []) {
      const sId = (item as any).sourceId
      if (sId && knowRegistry.has(sId)) {
        if (!sourceKindMatches(item, ["knowledge"])) out.sourceKindMismatches++
        coveredKnowIds.add(sId)
        const reg = knowRegistry.get(sId)!
        const itemCharId = (item as any).characterId
        if (itemCharId && itemCharId !== reg.characterId) {
          out.characterIdMismatches++
          out.characterIssues.push(`obligation ${(item as any).obligationId ?? "(unnamed)"} on ${beatId} characterId "${itemCharId}" ≠ source "${reg.characterId}"`)
        }
      } else if (sId) {
        out.unknownObligations.push({ beatId, obligationKey: "mustTransferKnowledge", sourceId: sId })
        if (!sourceKindMatches(item, ["knowledge"])) out.sourceKindMismatches++
      }
    }
    for (const item of obligations.mustShowStateChange ?? []) {
      const sId = (item as any).sourceId
      if (sId && stateRegistry.has(sId)) {
        if (!sourceKindMatches(item, ["state"])) out.sourceKindMismatches++
        coveredStateIds.add(sId)
        const reg = stateRegistry.get(sId)!
        const itemCharId = (item as any).characterId
        if (itemCharId && itemCharId !== reg.characterId) {
          out.characterIdMismatches++
          out.characterIssues.push(`obligation ${(item as any).obligationId ?? "(unnamed)"} on ${beatId} characterId "${itemCharId}" ≠ source "${reg.characterId}"`)
        }
      } else if (sId) {
        out.unknownObligations.push({ beatId, obligationKey: "mustShowStateChange", sourceId: sId })
        if (!sourceKindMatches(item, ["state"])) out.sourceKindMismatches++
      }
    }
  }

  // Also: a fact can be "covered" if a requiredPayoffs link points at a
  // valid in-chapter beat (the link itself implies a future obligation
  // contract that the planning loop will materialize on the seeding+payoff
  // beats).
  const beatCount = (outline.scenes ?? []).length
  for (const beat of outline.scenes ?? []) {
    for (const link of beat.requiredPayoffs ?? []) {
      const factId = link.fact_id?.trim()
      if (!factId || !factRegistry.has(factId)) continue
      if (Number.isInteger(link.payoff_beat) && link.payoff_beat >= 0 && link.payoff_beat < beatCount) {
        coveredFactIds.add(factId)
      }
    }
  }

  // Orphans: source IDs without coverage.
  for (const id of factRegistry.keys()) {
    if (!coveredFactIds.has(id)) {
      out.orphanFacts++
      out.missingSourceIds.push(id)
    }
  }
  for (const id of knowRegistry.keys()) {
    if (!coveredKnowIds.has(id)) {
      out.orphanKnowledge++
      out.missingSourceIds.push(id)
    }
  }
  for (const id of stateRegistry.keys()) {
    if (!coveredStateIds.has(id)) {
      out.orphanState++
      out.missingSourceIds.push(id)
    }
  }

  // Facts/knowledge/state items missing IDs entirely.
  const missingIdFacts = (outline.establishedFacts ?? []).filter(f => !((f.id ?? "").trim())).length
  const missingIdKnow = (outline.knowledgeChanges ?? []).filter(c => !(((c as any).id ?? "").trim())).length
  const missingIdState = (outline.characterStateChanges ?? []).filter(c => !(((c as any).id ?? "").trim())).length
  out.orphanFacts += missingIdFacts
  out.orphanKnowledge += missingIdKnow
  out.orphanState += missingIdState

  return out
}

function sourceKindMatches(item: unknown, allowed: SourceKind[]): boolean {
  const sourceKind = (item as any)?.sourceKind
  return typeof sourceKind === "string" && allowed.includes(sourceKind as SourceKind)
}

export function validateBeatObligationCoverage(outline: ChapterOutline): BeatObligationCoverageValidation {
  enrichOutlineIds(outline)
  const plan = deriveBeatObligations(outline)
  const errors: string[] = []
  const s = plan.summary

  if (s.orphanFacts > 0) {
    errors.push(`Chapter ${outline.chapterNumber}: ${s.orphanFacts}/${s.factCount} established fact(s) have no beat obligation referencing their sourceId`)
  }
  if (s.orphanKnowledgeChanges > 0) {
    errors.push(`Chapter ${outline.chapterNumber}: ${s.orphanKnowledgeChanges}/${s.knowledgeCount} knowledge change(s) have no beat obligation referencing their sourceId`)
  }
  if (s.orphanStateChanges > 0) {
    errors.push(`Chapter ${outline.chapterNumber}: ${s.orphanStateChanges}/${s.stateChangeCount} character state change(s) have no beat obligation referencing their sourceId`)
  }
  if (s.unknownObligationSourceIds > 0) {
    errors.push(`Chapter ${outline.chapterNumber}: ${s.unknownObligationSourceIds} obligation(s) reference unknown source IDs`)
  }
  if (s.duplicateSourceIds > 0) {
    errors.push(`Chapter ${outline.chapterNumber}: ${s.duplicateSourceIds} duplicate source ID(s) declared at chapter level`)
  }
  if (s.sourceKindMismatches > 0) {
    errors.push(`Chapter ${outline.chapterNumber}: ${s.sourceKindMismatches} obligation(s) have missing or mismatched sourceKind`)
  }
  if (s.characterIdMismatches > 0) {
    errors.push(`Chapter ${outline.chapterNumber}: ${s.characterIdMismatches} obligation(s) have characterId not matching the source item`)
  }

  const cov = computeCoverage(outline)
  return {
    valid: errors.length === 0,
    errors,
    warnings: plan.warnings,
    summary: plan.summary,
    missingSourceIds: cov.missingSourceIds,
    unknownObligations: cov.unknownObligations,
  }
}

export function formatObligationCoverageRetryFeedback(
  outline: ChapterOutline,
  validation: BeatObligationCoverageValidation,
): string {
  const lines = [
    `Chapter ${outline.chapterNumber} (${outline.chapterId ?? "(missing-chapterId)"}) failed exact-ID obligation coverage. Re-emit the state mapping with every chapter-level item covered by a beat obligation whose sourceId references it.`,
    "",
    "Hard requirements (validation is strict; text overlap does not count):",
    "- Every establishedFacts[].id must appear as the sourceId of at least one mustEstablish or mustPayOff obligation, or as the fact_id of a valid in-chapter requiredPayoffs link.",
    "- Every knowledgeChanges[].id must appear as the sourceId of exactly one mustTransferKnowledge obligation; characterId must match.",
    "- Every characterStateChanges[].id must appear as the sourceId of at least one mustShowStateChange obligation; characterId must match.",
    "- Obligation sourceId must reference a real chapter-level item; sourceKind must match the registry.",
    "- Preserve every existing id and beatId verbatim. Do not delete valid state to make coverage pass.",
    "",
    "Coverage errors:",
    ...validation.errors.map(error => `- ${error}`),
  ]

  if (validation.missingSourceIds.length > 0) {
    lines.push("", "Missing source IDs (add obligations with these as sourceId):")
    for (const id of validation.missingSourceIds) {
      lines.push(`- ${id}`)
    }
  }

  if (validation.unknownObligations.length > 0) {
    lines.push("", "Unknown obligation source IDs (rename to a real chapter-level item id, or remove):")
    for (const obl of validation.unknownObligations) {
      lines.push(`- ${obl.beatId} ${obl.obligationKey} → ${obl.sourceId}`)
    }
  }

  if ((outline.establishedFacts ?? []).length > 0) {
    lines.push("", "Established facts (preserve all ids):")
    for (const fact of outline.establishedFacts ?? []) {
      lines.push(`- id=${fact.id || "(missing-id)"}: ${fact.fact}`)
    }
  }

  if ((outline.knowledgeChanges ?? []).length > 0) {
    lines.push("", "Knowledge changes (preserve all ids and characterIds):")
    for (const change of outline.knowledgeChanges ?? []) {
      const id = (change as any).id ?? "(missing-id)"
      const cid = (change as any).characterId ?? "(missing-characterId)"
      lines.push(`- id=${id} characterId=${cid} ${change.characterName}: ${change.knowledge}`)
    }
  }

  if ((outline.characterStateChanges ?? []).length > 0) {
    lines.push("", "Character state changes (preserve all ids and characterIds):")
    for (const change of outline.characterStateChanges ?? []) {
      const id = (change as any).id ?? "(missing-id)"
      const cid = (change as any).characterId ?? "(missing-characterId)"
      lines.push(`- id=${id} characterId=${cid} ${change.name}: ${summarizeStateChange(change) || "state changed"}`)
    }
  }

  return lines.join("\n")
}

export function applyBeatObligationRepairPatch(
  outline: ChapterOutline,
  patch: PlanningStateRepairOutput,
): BeatObligationRepairPatchResult {
  const repaired = JSON.parse(JSON.stringify(outline)) as ChapterOutline
  enrichOutlineIds(repaired)
  const applied: string[] = []
  const rejected: string[] = []

  for (const operation of patch.operations ?? []) {
    const result = applyRepairOperation(repaired, operation)
    if (result.ok) applied.push(result.message)
    else rejected.push(result.message)
  }

  return {
    outline: repaired,
    applied,
    rejected,
    validation: validateBeatObligationCoverage(repaired),
  }
}

function applyRepairOperation(
  outline: ChapterOutline,
  operation: PlanningStateRepairOperation,
): { ok: boolean; message: string } {
  const beat = (outline.scenes ?? []).find(scene => scene.beatId === operation.beatId)
  if (!beat) return { ok: false, message: `${operation.op}: unknown beatId ${operation.beatId}` }
  if (operation.op === "removeObligation") return removeRepairObligation(beat, operation.list, operation.obligationId)
  return addRepairObligation(outline, beat, operation)
}

function removeRepairObligation(beat: SceneBeat, list: RepairObligationList, obligationId: string): { ok: boolean; message: string } {
  const obligations = normalizeAuthoredObligations(beat.obligations)
  beat.obligations = obligations
  const items = obligations[list] as any[]
  const index = items.findIndex(item => item.obligationId === obligationId)
  if (index < 0) return { ok: false, message: `removeObligation: obligationId ${obligationId} not found on ${beat.beatId} ${list}` }
  items.splice(index, 1)
  return { ok: true, message: `removeObligation: ${beat.beatId} ${list} ${obligationId}` }
}

function addRepairObligation(
  outline: ChapterOutline,
  beat: SceneBeat,
  operation: Extract<PlanningStateRepairOperation, { op: "addObligation" }>,
): { ok: boolean; message: string } {
  const text = operation.text.trim()
  if (!text) return { ok: false, message: `addObligation: empty text for sourceId ${operation.sourceId}` }
  const source = sourceInfoFor(outline, operation.sourceId)
  if (!source) return { ok: false, message: `addObligation: unknown sourceId ${operation.sourceId}` }
  if (!listAcceptsSource(operation.list, operation.sourceKind, source.kind)) {
    return { ok: false, message: `addObligation: ${operation.list} cannot reference sourceKind ${operation.sourceKind} for ${operation.sourceId}` }
  }
  if ((source.kind === "knowledge" || source.kind === "state") && operation.characterId !== source.characterId) {
    return { ok: false, message: `addObligation: characterId ${operation.characterId ?? "(missing)"} does not match ${source.characterId} for ${operation.sourceId}` }
  }

  const obligations = normalizeAuthoredObligations(beat.obligations)
  beat.obligations = obligations
  const items = obligations[operation.list] as any[]
  const ordinal = items.length
  const kindTail = operation.sourceKind === "knowledge" ? "know" : operation.sourceKind
  const item: any = {
    obligationId: obligationIdGen(beat.beatId ?? "unknown-beat", kindTail, operation.sourceId, ordinal),
    sourceId: operation.sourceId,
    sourceKind: operation.sourceKind,
    text,
  }
  if (source.characterId) item.characterId = source.characterId
  if (source.characterName) item.characterName = source.characterName
  items.push(item)
  return { ok: true, message: `addObligation: ${beat.beatId} ${operation.list} ${operation.sourceId}` }
}

function sourceInfoFor(
  outline: ChapterOutline,
  sourceId: string,
): { kind: "fact"; text: string } | { kind: "knowledge" | "state"; text: string; characterId: string; characterName: string } | null {
  const fact = (outline.establishedFacts ?? []).find(item => item.id === sourceId)
  if (fact) return { kind: "fact", text: fact.fact }
  const knowledge = (outline.knowledgeChanges ?? []).find(item => (item as any).id === sourceId)
  if (knowledge) {
    return {
      kind: "knowledge",
      text: knowledge.knowledge,
      characterId: (knowledge as any).characterId ?? characterIdFromName(knowledge.characterName),
      characterName: knowledge.characterName,
    }
  }
  const state = (outline.characterStateChanges ?? []).find(item => (item as any).id === sourceId)
  if (state) {
    return {
      kind: "state",
      text: summarizeStateChange(state) || "state changed",
      characterId: (state as any).characterId ?? characterIdFromName(state.name),
      characterName: state.name,
    }
  }
  return null
}

function listAcceptsSource(list: RepairObligationList, sourceKind: SourceKind, registryKind: "fact" | "knowledge" | "state"): boolean {
  if (list === "mustEstablish") return sourceKind === "fact" && registryKind === "fact"
  if (list === "mustPayOff") return (sourceKind === "fact" || sourceKind === "payoff") && registryKind === "fact"
  if (list === "mustTransferKnowledge") return sourceKind === "knowledge" && registryKind === "knowledge"
  if (list === "mustShowStateChange") return sourceKind === "state" && registryKind === "state"
  return false
}

function normalizeAuthoredObligations(obligations: BeatObligationsContract | undefined): BeatObligationsContract {
  return {
    mustEstablish: cleanAuthoredItems(obligations?.mustEstablish),
    mustPayOff: cleanAuthoredItems(obligations?.mustPayOff),
    mustTransferKnowledge: cleanAuthoredItems(obligations?.mustTransferKnowledge),
    mustShowStateChange: cleanAuthoredItems(obligations?.mustShowStateChange),
    mustNotReveal: cleanAuthoredItems(obligations?.mustNotReveal),
    allowedNewEntities: obligations?.allowedNewEntities ?? [],
  }
}

function cleanAuthoredItems<T extends { text: string }>(items: T[] | undefined): T[] {
  return (items ?? []).filter(item => item.text.trim().length > 0)
}

function addAuthoredObligations(target: BeatObligations, authored: BeatObligationsContract): void {
  for (const item of authored.mustEstablish) {
    addObligation(target.mustEstablish, {
      kind: "establish",
      text: item.text,
      confidence: "explicit",
      source: "scene.obligations.mustEstablish",
      factId: (item as any).factId ?? (item as any).id,
      sourceId: (item as any).sourceId ?? (item as any).factId ?? (item as any).id,
      sourceKind: ((item as any).sourceKind as SourceKind) ?? "fact",
      obligationId: (item as any).obligationId,
      characterName: (item as any).characterName,
      characterId: (item as any).characterId,
    })
  }
  for (const item of authored.mustPayOff) {
    addObligation(target.mustPayOff, {
      kind: "payoff",
      text: item.text,
      confidence: "explicit",
      source: "scene.obligations.mustPayOff",
      factId: (item as any).factId ?? (item as any).id,
      sourceId: (item as any).sourceId ?? (item as any).factId ?? (item as any).id,
      sourceKind: ((item as any).sourceKind as SourceKind) ?? "payoff",
      obligationId: (item as any).obligationId,
      characterName: (item as any).characterName,
      characterId: (item as any).characterId,
      seededAtBeat: (item as any).seededAtBeat,
    })
  }
  for (const item of authored.mustTransferKnowledge) {
    addObligation(target.mustTransferKnowledge, {
      kind: "knowledge",
      text: item.text,
      confidence: "explicit",
      source: "scene.obligations.mustTransferKnowledge",
      sourceId: (item as any).sourceId,
      sourceKind: "knowledge",
      obligationId: (item as any).obligationId,
      characterName: (item as any).characterName,
      characterId: (item as any).characterId,
    })
  }
  for (const item of authored.mustShowStateChange) {
    addObligation(target.mustShowStateChange, {
      kind: "state",
      text: item.text,
      confidence: "explicit",
      source: "scene.obligations.mustShowStateChange",
      sourceId: (item as any).sourceId,
      sourceKind: "state",
      obligationId: (item as any).obligationId,
      characterName: (item as any).characterName,
      characterId: (item as any).characterId,
    })
  }
  for (const item of authored.mustNotReveal) {
    addObligation(target.mustNotReveal, {
      kind: "avoid",
      text: item.text,
      confidence: "explicit",
      source: "scene.obligations.mustNotReveal",
      sourceKind: "avoid",
      obligationId: (item as any).obligationId,
      characterName: (item as any).characterName,
      characterId: (item as any).characterId,
    })
  }
}

// ── Rendering (writer-context) ───────────────────────────────────────────

export function renderBeatObligations(obligations: BeatObligations): string {
  const sections: string[] = []
  pushSection(sections, "Must establish", obligations.mustEstablish)
  pushSection(sections, "Must pay off", obligations.mustPayOff)
  pushSection(sections, "Must transfer knowledge", obligations.mustTransferKnowledge)
  pushSection(sections, "Must show state change", obligations.mustShowStateChange)
  pushSection(sections, "Must not reveal", obligations.mustNotReveal)
  if (obligations.allowedNewEntities.length > 0) {
    sections.push(`Allowed new named entities:\n${obligations.allowedNewEntities.map(e => `- ${e}`).join("\n")}`)
  }
  if (sections.length === 0) return ""
  return `BEAT OBLIGATIONS:\n${sections.join("\n\n")}`
}

function pushSection(sections: string[], title: string, items: BeatObligationItem[]): void {
  if (items.length === 0) return
  sections.push(`${title}:\n${items.map(item => `- ${item.text}`).join("\n")}`)
}

function addObligation(items: BeatObligationItem[], item: BeatObligationItem): void {
  if (items.some(existing =>
    existing.kind === item.kind
    && existing.text === item.text
    && existing.characterName === item.characterName
    && existing.sourceId === item.sourceId,
  )) return
  items.push(item)
}

function beatIncludesCharacter(beat: SceneBeat, characterName: string): boolean {
  return beat.characters.some(name => sameCharacterName(name, characterName))
}

function sameCharacterName(a: string, b: string): boolean {
  const aAliases = nameAliases(a)
  const bAliases = nameAliases(b)
  for (const alias of aAliases) if (bAliases.has(alias)) return true
  return false
}

function nameAliases(name: string): Set<string> {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const aliases = new Set<string>()
  if (!normalized) return aliases
  aliases.add(normalized)
  const parts = normalized.split(/\s+/).filter(p => p.length >= 3)
  if (parts[0]) aliases.add(parts[0])
  if (parts.length > 1) aliases.add(parts[parts.length - 1])
  return aliases
}

function summarizeStateChange(change: { location?: string; emotionalState?: string; knows?: string[] }): string {
  const parts: string[] = []
  if (change.location) parts.push(`location: ${change.location}`)
  if (change.emotionalState) parts.push(`state: ${change.emotionalState}`)
  if (change.knows?.length) parts.push(`knows: ${change.knows.join("; ")}`)
  return parts.join("; ")
}

function countHardObligations(obligations: BeatObligations): number {
  return obligations.mustEstablish.length
    + obligations.mustPayOff.length
    + obligations.mustTransferKnowledge.length
    + obligations.mustShowStateChange.length
}

function deriveAllowedNewEntities(beat: SceneBeat, outline: ChapterOutline): string[] {
  const known = new Set([
    ...beat.characters,
    ...(outline.charactersPresent ?? []),
    outline.povCharacter,
    outline.setting,
  ].filter(Boolean).map(v => v.toLowerCase()))
  const entities = extractProperNouns(beat.description)
  return entities.filter(entity => !known.has(entity.toLowerCase()))
}

function extractProperNouns(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of text.matchAll(/\b[A-Z][A-Za-z'’-]*(?:\s+(?:of|the|and|de|la|le|du|von|'s|[A-Z][A-Za-z'’-]*))*\b/g)) {
    const value = match[0].trim()
    if (PROPER_NOUN_STOPWORDS.has(value)) continue
    if (value.length < 3 || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function mergeUnique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

// Re-export ID helpers for consumers who want the same surface.
export { ID_RE }
