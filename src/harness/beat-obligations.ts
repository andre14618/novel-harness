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
  characterIdMismatches: number
  // Diagnostic only — fuzzy beat-text matches that COULD have covered an
  // orphan source if obligations had been authored. NEVER affects coverage.
  implicitTextMatches: number
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

export interface BeatObligationCoverageRepair {
  outline: ChapterOutline
  repairs: string[]
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
const STOPWORDS = new Set([
  "about", "after", "again", "against", "being", "before", "chapter", "could",
  "every", "from", "have", "into", "must", "only", "over", "that", "their",
  "there", "they", "this", "through", "under", "when", "where", "while", "with",
  "would",
])

// ── deriveBeatObligations ────────────────────────────────────────────────
// Builds a per-beat snapshot of authored obligations + payoff-link
// derivations. Pure passthrough of authored items — no inference from beat
// text into obligations (that would defeat the exact-ID contract). Fuzzy
// beat-text matches are reported via `summary.implicitTextMatches` for
// diagnostics only.

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
    characterIdMismatches: validation.characterIdMismatches,
    implicitTextMatches: validation.implicitTextMatches,
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
  characterIdMismatches: number
  characterIssues: string[]
  implicitTextMatches: number
}

function computeCoverage(outline: ChapterOutline): InternalCoverage {
  const out: InternalCoverage = {
    orphanFacts: 0,
    orphanKnowledge: 0,
    orphanState: 0,
    missingSourceIds: [],
    unknownObligations: [],
    duplicateSourceIds: 0,
    characterIdMismatches: 0,
    characterIssues: [],
    implicitTextMatches: 0,
  }

  // Build registries with duplicate detection.
  const factRegistry = new Map<string, { fact: string }>()
  for (const fact of outline.establishedFacts ?? []) {
    const id = (fact.id ?? "").trim()
    if (!id) continue
    if (factRegistry.has(id)) out.duplicateSourceIds++
    factRegistry.set(id, { fact: fact.fact })
  }

  const knowRegistry = new Map<string, { characterId: string; characterName: string; knowledge: string }>()
  for (const change of outline.knowledgeChanges ?? []) {
    const id = ((change as any).id ?? "").trim()
    if (!id) continue
    if (knowRegistry.has(id)) out.duplicateSourceIds++
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
    if (stateRegistry.has(id)) out.duplicateSourceIds++
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
    }
    for (const item of obligations.mustPayOff ?? []) {
      const sId = (item as any).sourceId
      if (sId && factRegistry.has(sId)) coveredFactIds.add(sId)
      else if (sId) out.unknownObligations.push({ beatId, obligationKey: "mustPayOff", sourceId: sId })
    }
    for (const item of obligations.mustTransferKnowledge ?? []) {
      const sId = (item as any).sourceId
      if (sId && knowRegistry.has(sId)) {
        coveredKnowIds.add(sId)
        const reg = knowRegistry.get(sId)!
        const itemCharId = (item as any).characterId
        if (itemCharId && itemCharId !== reg.characterId) {
          out.characterIdMismatches++
          out.characterIssues.push(`obligation ${(item as any).obligationId ?? "(unnamed)"} on ${beatId} characterId "${itemCharId}" ≠ source "${reg.characterId}"`)
        }
      } else if (sId) out.unknownObligations.push({ beatId, obligationKey: "mustTransferKnowledge", sourceId: sId })
    }
    for (const item of obligations.mustShowStateChange ?? []) {
      const sId = (item as any).sourceId
      if (sId && stateRegistry.has(sId)) {
        coveredStateIds.add(sId)
        const reg = stateRegistry.get(sId)!
        const itemCharId = (item as any).characterId
        if (itemCharId && itemCharId !== reg.characterId) {
          out.characterIdMismatches++
          out.characterIssues.push(`obligation ${(item as any).obligationId ?? "(unnamed)"} on ${beatId} characterId "${itemCharId}" ≠ source "${reg.characterId}"`)
        }
      } else if (sId) out.unknownObligations.push({ beatId, obligationKey: "mustShowStateChange", sourceId: sId })
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

  // Diagnostic: count fuzzy beat-text matches that *could* have covered an
  // orphan if obligations had been authored. Never affects coverage; useful
  // for retry feedback to suggest placement.
  for (const sourceId of out.missingSourceIds) {
    const text = factRegistry.get(sourceId)?.fact
      ?? knowRegistry.get(sourceId)?.knowledge
      ?? null
    if (!text) continue
    if (bestBeatMatch(outline.scenes ?? [], text, { minScore: 2, minCoverage: 0.25 })) {
      out.implicitTextMatches++
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

// ── Auto-repair (Phase 6) ────────────────────────────────────────────────
// Rebuilds missing obligations for every uncovered source ID. Repair only
// chooses placement; it never invents new source items, and the obligations
// it inserts always carry an exact sourceId/sourceKind reference.

export function repairBeatObligationCoverage(outline: ChapterOutline): BeatObligationCoverageRepair {
  enrichOutlineIds(outline)
  const repairs: string[] = []

  const ordinalByBeatKind = new Map<string, number>()
  function nextOrdinal(beatId: string, key: string): number {
    const k = `${beatId}:${key}`
    const n = ordinalByBeatKind.get(k) ?? countExisting(outline, beatId, key)
    ordinalByBeatKind.set(k, n + 1)
    return n
  }

  const cov = computeCoverage(outline)

  for (const sourceId of cov.missingSourceIds) {
    const placement = chooseRepairBeat(outline, sourceId)
    if (!placement) continue
    const { beat, kind, sourceItem } = placement
    const obligations = ensureAuthoredObligations(beat)
    const beatId = beat.beatId ?? "unknown-beat"
    const ord = nextOrdinal(beatId, kind)

    if (kind === "mustEstablish") {
      obligations.mustEstablish.push({
        obligationId: obligationIdGen(beatId, "fact", sourceId, ord),
        sourceId,
        sourceKind: "fact",
        text: (sourceItem as any).fact ?? "",
      } as any)
      repairs.push(`Chapter ${outline.chapterNumber} ${beatId}: added mustEstablish referencing ${sourceId}`)
    } else if (kind === "mustTransferKnowledge") {
      const k = sourceItem as { characterId: string; characterName: string; knowledge: string }
      obligations.mustTransferKnowledge.push({
        obligationId: obligationIdGen(beatId, "know", sourceId, ord),
        sourceId,
        sourceKind: "knowledge",
        characterId: k.characterId,
        characterName: k.characterName,
        text: k.knowledge,
      } as any)
      repairs.push(`Chapter ${outline.chapterNumber} ${beatId}: added mustTransferKnowledge referencing ${sourceId} (${k.characterId})`)
    } else if (kind === "mustShowStateChange") {
      const s = sourceItem as { characterId: string; name: string; summary: string }
      obligations.mustShowStateChange.push({
        obligationId: obligationIdGen(beatId, "state", sourceId, ord),
        sourceId,
        sourceKind: "state",
        characterId: s.characterId,
        characterName: s.name,
        text: s.summary,
      } as any)
      repairs.push(`Chapter ${outline.chapterNumber} ${beatId}: added mustShowStateChange referencing ${sourceId} (${s.characterId})`)
    }
  }

  return { outline, repairs, validation: validateBeatObligationCoverage(outline) }
}

function countExisting(outline: ChapterOutline, beatId: string, key: string): number {
  for (const beat of outline.scenes ?? []) {
    if (beat.beatId !== beatId) continue
    return ((beat.obligations as any)?.[key] ?? []).length
  }
  return 0
}

interface RepairPlacement {
  beat: SceneBeat
  kind: "mustEstablish" | "mustTransferKnowledge" | "mustShowStateChange"
  sourceItem: { fact?: string; characterId?: string; characterName?: string; knowledge?: string; name?: string; summary?: string }
}

function chooseRepairBeat(outline: ChapterOutline, sourceId: string): RepairPlacement | null {
  const scenes = outline.scenes ?? []
  if (scenes.length === 0) return null

  // Identify which registry the source belongs to.
  const fact = (outline.establishedFacts ?? []).find(f => f.id === sourceId)
  if (fact) {
    const beatIndex = chooseBeatForText(scenes, fact.fact)
    if (beatIndex === null) return null
    return { beat: scenes[beatIndex], kind: "mustEstablish", sourceItem: { fact: fact.fact } }
  }

  const know = (outline.knowledgeChanges ?? []).find(c => (c as any).id === sourceId)
  if (know) {
    const beatIndex = chooseBeatForText(scenes, know.knowledge, know.characterName)
    if (beatIndex === null) return null
    return {
      beat: scenes[beatIndex],
      kind: "mustTransferKnowledge",
      sourceItem: {
        characterId: (know as any).characterId ?? characterIdFromName(know.characterName),
        characterName: know.characterName,
        knowledge: know.knowledge,
      },
    }
  }

  const state = (outline.characterStateChanges ?? []).find(c => (c as any).id === sourceId)
  if (state) {
    const summary = summarizeStateChange(state) || "state changed"
    const beatIndex = chooseBeatForText(scenes, stateChangeSearchText(state) || summary, state.name)
    if (beatIndex === null) return null
    return {
      beat: scenes[beatIndex],
      kind: "mustShowStateChange",
      sourceItem: {
        characterId: (state as any).characterId ?? characterIdFromName(state.name),
        name: state.name,
        summary,
      },
    }
  }

  return null
}

function ensureAuthoredObligations(beat: SceneBeat): BeatObligationsContract {
  const obligations = normalizeAuthoredObligations(beat.obligations)
  beat.obligations = obligations
  return obligations
}

function chooseBeatForText(scenes: SceneBeat[], text: string, characterName?: string): number | null {
  if (scenes.length === 0) return null
  const match = bestBeatMatch(scenes, text, { characterName, minScore: 1, minCoverage: 0 })
  if (match) return match.beatIndex
  if (characterName) {
    for (let i = scenes.length - 1; i >= 0; i--) {
      if (beatIncludesCharacter(scenes[i], characterName)) return i
    }
  }
  return scenes.length - 1
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

// ── Beat-text matching (DIAGNOSTIC ONLY — never affects coverage) ────────

function bestBeatMatch(
  scenes: SceneBeat[],
  targetText: string,
  opts: { characterName?: string; minScore: number; minCoverage: number },
): { beatIndex: number; score: number; coverage: number } | null {
  const targetTokens = meaningfulTokens(targetText)
  if (targetTokens.length === 0) return null

  let best: { beatIndex: number; score: number; coverage: number } | null = null
  for (let i = 0; i < scenes.length; i++) {
    const beat = scenes[i]
    if (opts.characterName && !beatIncludesCharacter(beat, opts.characterName)) continue
    const beatTokens = new Set(meaningfulTokens(`${beat.description} ${beat.characters.join(" ")}`))
    let score = 0
    for (const token of targetTokens) if (beatTokens.has(token)) score++
    const coverage = score / targetTokens.length
    if (score < opts.minScore || coverage < opts.minCoverage) continue
    if (!best || score > best.score || (score === best.score && coverage > best.coverage)) {
      best = { beatIndex: i, score, coverage }
    }
  }
  return best
}

function meaningfulTokens(text: string): string[] {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? []) {
    const token = raw.replace(/[’']/g, "")
    if (token.length < 4 || STOPWORDS.has(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
  }
  return tokens
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

function stateChangeSearchText(change: { location?: string; emotionalState?: string; knows?: string[] }): string {
  return [
    change.location,
    change.emotionalState,
    ...(change.knows ?? []),
  ].filter(Boolean).join(" ")
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
