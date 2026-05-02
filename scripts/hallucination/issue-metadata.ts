/**
 * Pure helpers for enriching halluc-ungrounded A/B result rows with
 * structured per-issue metadata.
 *
 * The lane (L51) goal is that A/B output preserves enough metadata to inspect
 * a failure without rerunning the checker call. For each LLM-emitted issue we
 * record:
 *   - entity            — the phrase the LLM flagged
 *   - excerpt           — the prose excerpt the LLM tied to the entity
 *   - candidate_class   — the deterministic NER class that would tag the same
 *                         phrase ("title-pair", "suffix-class", etc.) when one
 *                         of the production NER regex passes covers the phrase;
 *                         null when the LLM-flagged entity does not match any
 *                         NER class (it was an LLM-only assertion).
 *   - ner_grounded      — whether the entity matches the row's grounded surface
 *                         under the same five-tier check production uses.
 *   - vote_count        — how many calls (out of `n_calls`) flagged this entity.
 *                         Defaults to 1 in the single-call A/B path; the field
 *                         exists so future convergence reporters can populate it.
 *
 * This module is pure (no I/O) and intentionally mirrors the grounded-surface
 * logic in `scripts/hallucination/ner-vs-llm-calibration.ts` and
 * `src/agents/halluc-ungrounded/index.ts` so the A/B reporter labels match
 * the calibration loop and runtime checker without exposing private agent
 * internals through the script boundary.
 */

import {
  extractEntityCandidates,
  normalizeForGroundedMatch,
  deriveInitials,
  TITLE_TOKENS,
  type EntityCandidate,
  type EntityCandidateClass,
} from "../../src/lint/entity-candidates"

const TITLE_TOKENS_LOWER: ReadonlySet<string> = new Set(
  TITLE_TOKENS.map(t => t.toLowerCase()),
)

export interface GroundedSurface {
  lower: Set<string>
  normalized: Set<string>
}

export interface PanelRowGroundedComponents {
  bible?: string[]
  fromBrief?: string[]
  derivedOutlineFact?: string[]
  derivedPriorBeat?: string[]
  plannerEmitted?: string[]
  allowedNewEntities?: string[]
  characterRoster?: string[]
  outlineEntities?: string[]
  beatCharacters?: string[]
}

/**
 * Pull the grounded-source arrays out of the panel row shape used by the A/B
 * reporter (`row.task.checker_request_meta.groundedSources` +
 * `row.task.writer_request_meta.beatCharacters`). Returns the components in a
 * single object so `buildGroundedSurface` can union them deterministically.
 */
export function readGroundedComponents(row: any): PanelRowGroundedComponents {
  const gs = row?.task?.checker_request_meta?.groundedSources ?? {}
  const meta = row?.task?.writer_request_meta ?? {}
  return {
    bible: gs.bible ?? [],
    fromBrief: gs.from_brief ?? [],
    derivedOutlineFact: gs.derived_outline_fact ?? [],
    derivedPriorBeat: gs.derived_prior_beat ?? [],
    plannerEmitted: gs.planner_emitted ?? [],
    allowedNewEntities: gs.allowed_new_entities ?? [],
    characterRoster: gs.character_roster ?? [],
    outlineEntities: gs.outline_entities ?? [],
    beatCharacters: meta.beatCharacters ?? [],
  }
}

/**
 * Build the lowercase-exact + normalized grounded surface from the row's
 * components. Mirrors `buildGroundedSurface` in `ner-vs-llm-calibration.ts`
 * and `buildNerGroundedSet` in the production agent so per-issue grounding
 * labels stay consistent across the A/B reporter, the calibration loop, and
 * the runtime checker.
 */
export function buildGroundedSurface(components: PanelRowGroundedComponents): GroundedSurface {
  const lower = new Set<string>()
  const normalized = new Set<string>()

  const allSources: string[][] = [
    components.bible ?? [],
    components.fromBrief ?? [],
    components.derivedOutlineFact ?? [],
    components.derivedPriorBeat ?? [],
    components.plannerEmitted ?? [],
    components.allowedNewEntities ?? [],
    components.characterRoster ?? [],
    components.outlineEntities ?? [],
    components.beatCharacters ?? [],
  ]

  for (const arr of allSources) {
    for (const raw of arr) {
      if (typeof raw !== "string") continue
      const trimmed = raw.trim()
      if (trimmed.length === 0) continue
      lower.add(trimmed.toLowerCase())
      const norm = normalizeForGroundedMatch(trimmed)
      if (norm.length > 0) normalized.add(norm)
      const tokens = trimmed.split(/\s+/).filter(t => t.length > 0)
      for (const t of tokens) {
        const cleaned = t.replace(/[''](s|S)?$/, "").toLowerCase()
        if (cleaned.length > 0) lower.add(cleaned)
        const normT = normalizeForGroundedMatch(t)
        if (normT.length > 0) normalized.add(normT)
      }
    }
  }

  // Derived initials from roster entries (parity with production checker).
  const rosterEntries = [
    ...(components.characterRoster ?? []),
    ...(components.beatCharacters ?? []),
  ]
  for (const name of rosterEntries) {
    if (typeof name !== "string") continue
    for (const init of deriveInitials(name.trim())) {
      lower.add(init.toLowerCase())
    }
  }

  return { lower, normalized }
}

/**
 * Five-tier grounding check (mirrors `isNerGrounded` in the production agent).
 * Tiers: exact lowercase, lowercase substring, normalized exact, normalized
 * substring, title-strip retry. Returns true when the candidate is grounded.
 */
export function isPhraseGrounded(candidatePhrase: string, surface: GroundedSurface): boolean {
  const c = candidatePhrase.toLowerCase().trim()
  if (c.length === 0) return true
  if (surface.lower.has(c)) return true
  for (const s of surface.lower) {
    if (s.length >= c.length && s.includes(c)) return true
  }
  const normC = normalizeForGroundedMatch(candidatePhrase)
  if (normC.length > 0 && surface.normalized.has(normC)) return true
  if (normC.length > 0) {
    for (const s of surface.normalized) {
      if (s.length >= normC.length && s.includes(normC)) return true
    }
  }
  const tokens = candidatePhrase.trim().split(/\s+/).filter(t => t.length > 0)
  if (tokens.length >= 2 && TITLE_TOKENS_LOWER.has(tokens[0]!.toLowerCase())) {
    const remainder = tokens.slice(1).join(" ")
    const remLower = remainder.toLowerCase()
    if (remLower.length > 0) {
      if (surface.lower.has(remLower)) return true
      for (const s of surface.lower) {
        if (s.length >= remLower.length && s.includes(remLower)) return true
      }
      const remNorm = normalizeForGroundedMatch(remainder)
      if (remNorm.length > 0) {
        if (surface.normalized.has(remNorm)) return true
        for (const s of surface.normalized) {
          if (s.length >= remNorm.length && s.includes(remNorm)) return true
        }
      }
    }
  }
  return false
}

export interface RawIssue {
  entity: string
  excerpt?: string
}

export interface EnrichedIssue {
  entity: string
  excerpt: string
  candidate_class: EntityCandidateClass | null
  ner_grounded: boolean
  vote_count: number
}

/**
 * Find the deterministic NER candidate class for an LLM-flagged phrase by
 * matching against the candidate list `extractEntityCandidates(prose)` would
 * have produced. Match priority is exact (lowercase) → normalized form. When
 * no candidate covers the phrase, returns `null` (the LLM flagged something
 * the regex passes do not cover; useful signal on its own).
 */
export function classifyEntityViaNer(
  entity: string,
  candidates: EntityCandidate[],
): EntityCandidateClass | null {
  const lo = entity.trim().toLowerCase()
  if (lo.length === 0) return null
  for (const c of candidates) {
    if (c.phrase.toLowerCase() === lo) return c.class
  }
  const normEntity = normalizeForGroundedMatch(entity)
  if (normEntity.length === 0) return null
  for (const c of candidates) {
    if (normalizeForGroundedMatch(c.phrase) === normEntity) return c.class
  }
  return null
}

export interface EnrichOptions {
  /**
   * How many LLM calls produced the `issues` list. Default 1. Used to label
   * `vote_count` per issue. The single-call A/B path always passes 1; future
   * multi-call convergence reporters can pass the actual call count and a
   * per-entity vote map (see `voteCounts`).
   */
  nCalls?: number
  /**
   * Optional map from entity-string-lowercase → number of calls that flagged
   * the entity. When supplied, `vote_count` for each issue uses this map;
   * unmapped entities default to 1.
   */
  voteCounts?: Map<string, number>
}

/**
 * Enrich a list of LLM-flagged issues with NER class + grounded-match status.
 * Pure: no I/O, no LLM. The caller passes the prose and a prebuilt grounded
 * surface so this can be reused inside test fixtures.
 */
export function enrichIssues(
  issues: RawIssue[],
  prose: string,
  surface: GroundedSurface,
  opts: EnrichOptions = {},
): EnrichedIssue[] {
  const candidates = extractEntityCandidates(prose ?? "")
  const nCalls = opts.nCalls ?? 1
  const out: EnrichedIssue[] = []
  for (const issue of issues ?? []) {
    const entity = (issue?.entity ?? "").toString()
    const excerpt = (issue?.excerpt ?? "").toString()
    const candidate_class = classifyEntityViaNer(entity, candidates)
    const ner_grounded = isPhraseGrounded(entity, surface)
    const voteKey = entity.trim().toLowerCase()
    const vote_count = opts.voteCounts?.get(voteKey) ?? (nCalls === 0 ? 0 : 1)
    out.push({ entity, excerpt, candidate_class, ner_grounded, vote_count })
  }
  return out
}

export interface NerFindingMeta {
  phrase: string
  class: EntityCandidateClass
  grounded: boolean
}

/**
 * For result-row inspection: emit ALL deterministic NER candidates extracted
 * from the prose (not just the ungrounded ones). Each carries its grounded
 * status so a reader can spot the case where NER and the LLM disagree.
 *
 * Note: this does not apply the `capitalized-first-only` bible-token gate
 * that production runs in `runNerPrepass`. The A/B reporter is metadata-only
 * — it surfaces every candidate the regex extractor produced and lets the
 * reader decide. Adding the gate is a separate lane.
 */
export function buildNerCandidateSummary(
  prose: string,
  surface: GroundedSurface,
): NerFindingMeta[] {
  const candidates = extractEntityCandidates(prose ?? "")
  // Dedupe by (phrase, offset). When the same span fires multiple regex
  // passes, keep the highest-priority class — i.e. the first one in the
  // sorted list (sort key: offset asc, then classOrder asc, set by
  // `extractEntityCandidates`). This matches `classifyEntityViaNer` so a
  // reader sees one row per occurrence rather than two with conflicting
  // class labels.
  const seen = new Set<string>()
  const out: NerFindingMeta[] = []
  for (const c of candidates) {
    const key = `${c.offsetStart}:${c.offsetEnd}:${c.phrase.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      phrase: c.phrase,
      class: c.class,
      grounded: isPhraseGrounded(c.phrase, surface),
    })
  }
  return out
}
