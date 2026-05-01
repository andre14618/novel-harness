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
 * no contract requires the LLM to invent stable IDs. `enrichOutlineIds()`
 * fills any missing IDs and resolves obligation source links by exact text
 * match against the registries built from facts/knowledgeChanges/
 * characterStateChanges/requiredPayoffs.
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

export function payoffIdFromContent(factId: string, payoffBeatId: string): string {
  return `payoff-${factId.replace(/^fact-/, "")}-at-${payoffBeatId.replace(/^ch-/, "")}`
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
 * character IDs, obligation IDs, and resolves obligation sourceId links by
 * exact-text match against fact/knowledge/state registries when the LLM
 * did not emit a sourceId. Returns a report of any unlinked obligations.
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
  //    surfaces missing IDs as errors). Build registry text → id. ──────
  const factTextToId = new Map<string, string>()
  const factIds = new Set<string>()
  for (const fact of outline.establishedFacts ?? []) {
    if (fact.id && ID_RE.test(fact.id)) {
      factIds.add(fact.id)
      factTextToId.set(normalizeText(fact.fact), fact.id)
    }
  }

  // ── Knowledge IDs + characterIds ─────────────────────────────────────
  const knowScope = new Set<string>(factIds) // avoid collisions across kinds
  const knowKeyToItem = new Map<string, { id: string; characterId: string; characterName: string; knowledge: string }>()
  for (const change of outline.knowledgeChanges ?? []) {
    const charId = ensureCharacterId(change as any, change.characterName)
    const baseId = (change as any).id && ID_RE.test((change as any).id)
      ? (change as any).id
      : knowledgeIdFromContent(change.characterName, change.knowledge)
    const id = uniqueWithinScope(knowScope, baseId)
    ;(change as any).id = id
    ;(change as any).characterId = charId
    knowKeyToItem.set(`${charId}|${normalizeText(change.knowledge)}`, {
      id,
      characterId: charId,
      characterName: change.characterName,
      knowledge: change.knowledge,
    })
  }

  // ── State change IDs + characterIds ──────────────────────────────────
  const stateScope = new Set<string>([...factIds, ...knowScope])
  const stateKeyToItem = new Map<string, { id: string; characterId: string; name: string; summary: string }>()
  for (const change of outline.characterStateChanges ?? []) {
    const charId = ensureCharacterId(change as any, change.name)
    const summary = stateChangeSummary(change)
    const baseId = (change as any).id && ID_RE.test((change as any).id)
      ? (change as any).id
      : stateIdFromContent(change.name, summary)
    const id = uniqueWithinScope(stateScope, baseId)
    ;(change as any).id = id
    ;(change as any).characterId = charId
    stateKeyToItem.set(`${charId}|${normalizeText(summary)}`, {
      id,
      characterId: charId,
      name: change.name,
      summary,
    })
  }

  // ── Payoff IDs ───────────────────────────────────────────────────────
  // Payoff items are derived from beat.requiredPayoffs links. Each link
  // becomes a virtual payoff source whose ID = payoff-<factTail>-at-<beat>.
  const payoffIds = new Set<string>()
  const payoffByFactAndBeat = new Map<string, string>()
  for (let i = 0; i < (outline.scenes ?? []).length; i++) {
    const beat = outline.scenes[i]
    for (const link of beat.requiredPayoffs ?? []) {
      const factId = link.fact_id?.trim()
      if (!factId || !Number.isInteger(link.payoff_beat)) continue
      if (link.payoff_beat < 0 || link.payoff_beat >= beatIds.length) continue
      const targetBeatId = beatIds[link.payoff_beat]
      const id = payoffIdFromContent(factId, targetBeatId)
      payoffIds.add(id)
      payoffByFactAndBeat.set(`${factId}|${link.payoff_beat}`, id)
    }
  }

  // ── Obligation IDs + sourceId resolution ─────────────────────────────
  const failures: EnrichmentReport["obligationLinkFailures"] = []
  for (let beatIndex = 0; beatIndex < (outline.scenes ?? []).length; beatIndex++) {
    const beat = outline.scenes[beatIndex]
    const bId = beatIds[beatIndex]
    if (!beat.obligations) continue

    enrichObligationList(beat, bId, beatIndex, "mustEstablish", "fact", {
      factTextToId, knowKeyToItem, stateKeyToItem, payoffByFactAndBeat,
    }, failures)
    enrichObligationList(beat, bId, beatIndex, "mustPayOff", "payoff", {
      factTextToId, knowKeyToItem, stateKeyToItem, payoffByFactAndBeat,
    }, failures)
    enrichObligationList(beat, bId, beatIndex, "mustTransferKnowledge", "knowledge", {
      factTextToId, knowKeyToItem, stateKeyToItem, payoffByFactAndBeat,
    }, failures)
    enrichObligationList(beat, bId, beatIndex, "mustShowStateChange", "state", {
      factTextToId, knowKeyToItem, stateKeyToItem, payoffByFactAndBeat,
    }, failures)
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

interface Registries {
  factTextToId: Map<string, string>
  knowKeyToItem: Map<string, { id: string; characterId: string; characterName: string; knowledge: string }>
  stateKeyToItem: Map<string, { id: string; characterId: string; name: string; summary: string }>
  payoffByFactAndBeat: Map<string, string>
}

function enrichObligationList(
  beat: SceneBeat,
  bId: string,
  beatIndex: number,
  key: "mustEstablish" | "mustPayOff" | "mustTransferKnowledge" | "mustShowStateChange",
  kind: SourceKind,
  reg: Registries,
  failures: EnrichmentReport["obligationLinkFailures"],
): void {
  const obligations = beat.obligations as any
  const items = obligations[key] as any[] | undefined
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item.text || typeof item.text !== "string") continue

    // Resolve sourceId.
    let sourceId: string | undefined =
      (item.sourceId && ID_RE.test(item.sourceId)) ? item.sourceId : undefined

    if (!sourceId) {
      // Legacy hints: mustEstablish/mustPayOff carry `id` or `factId` from
      // the LLM that point at fact ids.
      if (kind === "fact" || kind === "payoff") {
        const hint = (item.factId && ID_RE.test(item.factId)) ? item.factId
          : (item.id && ID_RE.test(item.id)) ? item.id
          : undefined
        if (hint) sourceId = hint
      }
    }

    if (!sourceId) {
      sourceId = lookupSourceIdByText(kind, item, reg)
    }

    item.sourceKind = kind
    if (sourceId) {
      item.sourceId = sourceId
      // Set characterId for knowledge/state if not present.
      if (kind === "knowledge") {
        const found = [...reg.knowKeyToItem.values()].find(v => v.id === sourceId)
        if (found && !item.characterId) item.characterId = found.characterId
        if (found && !item.characterName) item.characterName = found.characterName
      } else if (kind === "state") {
        const found = [...reg.stateKeyToItem.values()].find(v => v.id === sourceId)
        if (found && !item.characterId) item.characterId = found.characterId
        if (found && !item.characterName) item.characterName = found.name
      }
    } else {
      failures.push({
        beatId: bId,
        obligationKey: key,
        obligationIndex: i,
        text: item.text,
        reason: `no source ${kind} item matches obligation text`,
      })
    }

    // Always assign an obligationId.
    if (!item.obligationId || !ID_RE.test(item.obligationId)) {
      item.obligationId = obligationIdGen(bId, kindShort(kind), sourceId ?? "", i)
    }
  }
}

function kindShort(kind: SourceKind): string {
  return kind === "knowledge" ? "know" : kind === "state" ? "state" : kind === "payoff" ? "payoff" : "fact"
}

function lookupSourceIdByText(
  kind: SourceKind,
  item: any,
  reg: Registries,
): string | undefined {
  const text = normalizeText(item.text ?? "")
  if (!text) return undefined
  if (kind === "fact") {
    if (reg.factTextToId.has(text)) return reg.factTextToId.get(text)
    // Try substring containment in either direction.
    for (const [key, id] of reg.factTextToId) {
      if (key.includes(text) || text.includes(key)) return id
    }
  } else if (kind === "payoff") {
    if (reg.factTextToId.has(text)) {
      const factId = reg.factTextToId.get(text)!
      // Pick first payoff entry matching this fact (prefer exact beat if known).
      for (const [key, payoffId] of reg.payoffByFactAndBeat) {
        if (key.startsWith(`${factId}|`)) return payoffId
      }
      return factId
    }
    for (const [key, id] of reg.factTextToId) {
      if (key.includes(text) || text.includes(key)) {
        for (const [pkey, payoffId] of reg.payoffByFactAndBeat) {
          if (pkey.startsWith(`${id}|`)) return payoffId
        }
        return id
      }
    }
  } else if (kind === "knowledge") {
    const charId = item.characterId && ID_RE.test(item.characterId)
      ? item.characterId
      : item.characterName ? characterIdFromName(item.characterName) : undefined
    for (const [key, val] of reg.knowKeyToItem) {
      const [keyChar, keyText] = key.split("|")
      if (charId && keyChar !== charId) continue
      if (textsMatchForLink(keyText, text)) return val.id
    }
  } else if (kind === "state") {
    const charId = item.characterId && ID_RE.test(item.characterId)
      ? item.characterId
      : item.characterName ? characterIdFromName(item.characterName) : undefined
    // For state, character match alone is a strong signal — there is
    // typically only one state change per character per chapter. Prefer
    // text-overlap match if available, otherwise fall back to characterId.
    let charOnlyFallback: string | undefined
    for (const [key, val] of reg.stateKeyToItem) {
      const [keyChar, keyText] = key.split("|")
      if (charId && keyChar !== charId) continue
      if (textsMatchForLink(keyText, text)) return val.id
      if (charId && keyChar === charId) charOnlyFallback = val.id
    }
    return charOnlyFallback
  }
  return undefined
}

function textsMatchForLink(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b || a.includes(b) || b.includes(a)) return true
  // Token-overlap fallback: at least 30% of tokens of the shorter string
  // appear in the longer one.
  const at = new Set(a.split(/\s+/).filter(t => t.length >= 4))
  const bt = new Set(b.split(/\s+/).filter(t => t.length >= 4))
  if (at.size === 0 || bt.size === 0) return false
  const small = at.size <= bt.size ? at : bt
  const big = at.size <= bt.size ? bt : at
  let hits = 0
  for (const tok of small) if (big.has(tok)) hits++
  return hits / small.size >= 0.3
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

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
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
