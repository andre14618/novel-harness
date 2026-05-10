/**
 * Stable-ID generation + outline enrichment.
 *
 * Names and prose text are display fields. IDs are identity. Every semantic
 * artifact in a chapter outline (chapter, beat, fact, knowledgeChange,
 * stateChange, payoff, obligation) gets a deterministic kebab-case ID that
 * downstream surfaces (mapper, writer context, llm_calls metadata, checker
 * findings) reference instead of fuzzy text matching.
 *
 * IDs are produced by code, not the LLM. The LLM is allowed to emit ID
 * fields, and existing IDs are preserved when present and well-formed; but
 * no contract requires the LLM to invent stable artifact IDs. `enrichOutlineIds()`
 * fills missing artifact IDs and obligation IDs. It never infers obligation
 * `sourceId`s from text; coverage validation is source-ID-only.
 *
 * Coverage validation downstream is then ID-based: an obligation passes
 * coverage only if its `sourceId` matches a registered source item.
 */

import type { ChapterOutline, SceneBeat, BeatObligationsContract } from "../types"

export const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

const STOP_SLUG_TOKENS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for",
  "with", "from", "by", "is", "was", "are", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "into", "out", "as",
])

const SLUG_DESC_TOKEN_LIMIT = 6

export function slugify(input: string, opts: { maxTokens?: number } = {}): string {
  if (!input) return ""
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  if (!cleaned) return ""
  const tokens = cleaned.split(/\s+/).filter(t => t && !STOP_SLUG_TOKENS.has(t))
  const usable = tokens.length > 0 ? tokens : cleaned.split(/\s+/)
  const max = opts.maxTokens ?? SLUG_DESC_TOKEN_LIMIT
  return usable.slice(0, max).join("-").replace(/^-+|-+$/g, "")
}

function uniqueWithinScope(seen: Set<string>, base: string): string {
  if (!base) return ""
  if (!seen.has(base)) {
    seen.add(base)
    return base
  }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!seen.has(candidate)) {
      seen.add(candidate)
      return candidate
    }
  }
  // Pathological fallback — collision storm, append epoch.
  const fallback = `${base}-${Date.now().toString(36)}`
  seen.add(fallback)
  return fallback
}

function pad3(n: number): string { return String(n).padStart(3, "0") }

export function chapterId(chapterNumber: number, title: string): string {
  const slug = slugify(title, { maxTokens: 5 }) || "chapter"
  return `ch-${pad3(chapterNumber)}-${slug}`
}

export function beatId(chapter: string, beatIndex: number, description: string): string {
  const slug = slugify(description, { maxTokens: 5 }) || "beat"
  return `${chapter}-beat-${pad3(beatIndex + 1)}-${slug}`
}

export function characterIdFromName(name: string): string {
  return `char-${slugify(name, { maxTokens: 4 }) || "unnamed"}`
}

export function knowledgeIdFromContent(characterName: string, knowledge: string): string {
  return `know-${slugify(characterName, { maxTokens: 2 }) || "unnamed"}-${slugify(knowledge, { maxTokens: 5 }) || "knows"}`
}

export function stateIdFromContent(characterName: string, summary: string): string {
  return `state-${slugify(characterName, { maxTokens: 2 }) || "unnamed"}-${slugify(summary, { maxTokens: 5 }) || "changed"}`
}

export function obligationIdGen(beat: string, kind: string, sourceIdSuffix: string, ordinal: number): string {
  const tail = sourceIdSuffix
    ? sourceIdSuffix.replace(/^(fact|know|state|payoff|char)-/, "")
    : `n${ordinal + 1}`
  return `obl-${beat.replace(/^ch-/, "")}-${kind}-${pad3(ordinal + 1)}-${tail}`
}

// ── Source kinds ────────────────────────────────────────────────────────

export type SourceKind = "fact" | "knowledge" | "state" | "payoff"

const KIND_TO_OBLIGATION_KEYS: Record<SourceKind, ("mustEstablish" | "mustPayOff" | "mustTransferKnowledge" | "mustShowStateChange")[]> = {
  fact: ["mustEstablish", "mustPayOff"],
  knowledge: ["mustTransferKnowledge"],
  state: ["mustShowStateChange"],
  payoff: ["mustPayOff"],
}

// ── Outline enrichment ──────────────────────────────────────────────────

export interface EnrichmentReport {
  chapterId: string
  beatIds: string[]
  obligationLinkFailures: Array<{
    beatId: string
    obligationKey: string
    obligationIndex: number
    text: string
    reason: string
  }>
}

/**
 * Mutating in-place: assigns chapterId, beatIds, knowledge/state IDs,
 * character IDs, and obligation IDs. It reports unlinked obligations but does
 * not resolve source IDs from text.
 *
 * Idempotent: existing well-formed IDs are preserved.
 */
export function enrichOutlineIds(outline: ChapterOutline): EnrichmentReport {
  const cId = outline.chapterId && ID_RE.test(outline.chapterId)
    ? outline.chapterId
    : chapterId(outline.chapterNumber, outline.title)
  outline.chapterId = cId

  // ── Beat IDs ──────────────────────────────────────────────────────────
  const beatIdScope = new Set<string>()
  const beatIds: string[] = []
  for (let i = 0; i < (outline.scenes ?? []).length; i++) {
    const beat = outline.scenes[i]
    const existing = beat.beatId
    let assigned = existing && ID_RE.test(existing) ? existing : beatId(cId, i, beat.description)
    assigned = uniqueWithinScope(beatIdScope, assigned)
    beat.beatId = assigned
    beatIds.push(assigned)
  }

  // ── Fact IDs (prefer existing `id`, leave alone if missing — validation
  //    surfaces missing IDs as errors). ────────────────────────────────
  const factIds = new Set<string>()
  for (const fact of outline.establishedFacts ?? []) {
    if (fact.id && ID_RE.test(fact.id)) {
      factIds.add(fact.id)
    }
  }

  // ── Knowledge IDs + characterIds ─────────────────────────────────────
  const knowScope = new Set<string>(factIds) // avoid collisions across kinds
  for (const change of outline.knowledgeChanges ?? []) {
    const charId = ensureCharacterId(change as any, change.characterName)
    const existingId = ((change as any).id ?? "").trim()
    const id = existingId && ID_RE.test(existingId)
      ? existingId
      : uniqueWithinScope(knowScope, knowledgeIdFromContent(change.characterName, change.knowledge))
    knowScope.add(id)
    ;(change as any).id = id
    ;(change as any).characterId = charId
  }

  // ── State change IDs + characterIds ──────────────────────────────────
  const stateScope = new Set<string>([...factIds, ...knowScope])
  for (const change of outline.characterStateChanges ?? []) {
    const charId = ensureCharacterId(change as any, change.name)
    const summary = stateChangeSummary(change)
    const existingId = ((change as any).id ?? "").trim()
    const id = existingId && ID_RE.test(existingId)
      ? existingId
      : uniqueWithinScope(stateScope, stateIdFromContent(change.name, summary))
    stateScope.add(id)
    ;(change as any).id = id
    ;(change as any).characterId = charId
  }

  // ── Obligation IDs only; sourceId must be explicit upstream. ─────────
  const failures: EnrichmentReport["obligationLinkFailures"] = []
  for (let beatIndex = 0; beatIndex < (outline.scenes ?? []).length; beatIndex++) {
    const beat = outline.scenes[beatIndex]
    const bId = beatIds[beatIndex]
    if (!beat.obligations) continue

    enrichObligationList(beat, bId, "mustEstablish", "fact", failures)
    enrichObligationList(beat, bId, "mustPayOff", "payoff", failures)
    enrichObligationList(beat, bId, "mustTransferKnowledge", "knowledge", failures)
    enrichObligationList(beat, bId, "mustShowStateChange", "state", failures)
    // mustNotReveal has no upstream source registry — assign obligationId only.
    if (beat.obligations.mustNotReveal) {
      for (let i = 0; i < beat.obligations.mustNotReveal.length; i++) {
        const item = beat.obligations.mustNotReveal[i] as any
        if (!item.obligationId || !ID_RE.test(item.obligationId)) {
          item.obligationId = obligationIdGen(bId, "avoid", "", i)
        }
      }
    }
  }

  return { chapterId: cId, beatIds, obligationLinkFailures: failures }
}

// L096 Slice 1.5: payoff stages that require a unique child event id.
const PAYOFF_DEBT_STAGES_REQUIRING_EVENT_ID = new Set(["partial_payoff", "final_payoff"])

function enrichObligationList(
  beat: SceneBeat,
  bId: string,
  key: "mustEstablish" | "mustPayOff" | "mustTransferKnowledge" | "mustShowStateChange",
  kind: SourceKind,
  failures: EnrichmentReport["obligationLinkFailures"],
): void {
  const obligations = beat.obligations as any
  const items = obligations[key] as any[] | undefined
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item.text || typeof item.text !== "string") continue

    let sourceId: string | undefined =
      (item.sourceId && ID_RE.test(item.sourceId)) ? item.sourceId : undefined

    if (sourceId) {
      item.sourceId = sourceId
    } else {
      failures.push({
        beatId: bId,
        obligationKey: key,
        obligationIndex: i,
        text: item.text,
        reason: `missing explicit sourceId for ${kind} obligation`,
      })
    }

    // Always assign an obligationId.
    if (!item.obligationId || !ID_RE.test(item.obligationId)) {
      item.obligationId = obligationIdGen(bId, kindShort(kind), sourceId ?? "", i)
    }

    // L096 Slice 1.5: deterministic payoffEventId mint when an obligation
    // declares a payoff stage and a parent payoffId but the LLM didn't emit
    // a unique child event id. Mints `evt-<obligationId-tail>` so the
    // generated event id is deterministic, unique within the obligation
    // scope, and round-trips stably across reruns. Keeps the ID-as-code
    // invariant (`harness/ids.ts` header: "IDs are produced by code, not
    // the LLM") rather than relying on prompt-fidelity for a structural
    // ref. Skips when the obligation is not on a payoff stage or has no
    // parent payoffId — those cases are validator errors, not mint cases.
    const stage = typeof item.storyDebtStage === "string" ? item.storyDebtStage : undefined
    const payoffId = typeof item.payoffId === "string" && item.payoffId.trim().length > 0
      ? item.payoffId.trim()
      : undefined
    const existingEventId = typeof item.payoffEventId === "string" && ID_RE.test(item.payoffEventId)
      ? item.payoffEventId
      : undefined
    if (
      stage
      && PAYOFF_DEBT_STAGES_REQUIRING_EVENT_ID.has(stage)
      && payoffId
      && !existingEventId
    ) {
      item.payoffEventId = `evt-${item.obligationId.replace(/^obl-/, "")}`
    }
  }
}

function kindShort(kind: SourceKind): string {
  return kind === "knowledge" ? "know" : kind === "state" ? "state" : kind === "payoff" ? "payoff" : "fact"
}

function ensureCharacterId(target: any, name: string): string {
  if (target.characterId && ID_RE.test(target.characterId)) return target.characterId
  return characterIdFromName(name)
}

function stateChangeSummary(change: { location?: string; emotionalState?: string; knows?: string[] }): string {
  const parts: string[] = []
  if (change.location) parts.push(change.location)
  if (change.emotionalState) parts.push(change.emotionalState)
  if (change.knows?.length) parts.push(change.knows.join(" "))
  return parts.join(" ") || "state-changed"
}

// Re-export an obligationKindFromKey mapping for harness consumers that
// need to translate between obligation list keys and source kinds.
export const OBLIGATION_KEY_TO_KIND: Record<string, SourceKind | "avoid"> = {
  mustEstablish: "fact",
  mustPayOff: "payoff",
  mustTransferKnowledge: "knowledge",
  mustShowStateChange: "state",
  mustNotReveal: "avoid",
}
export { KIND_TO_OBLIGATION_KEYS }
