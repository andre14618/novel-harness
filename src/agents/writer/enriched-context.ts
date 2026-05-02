/**
 * Enriched-context builder for the Arm B preflight.
 *
 * See `docs/charters/arm-b-detector-preflight.md` §6. This module produces
 * the `ENRICHED CONTEXT:` section that Arm B inserts into Arm A's recovered
 * `sections[]`. The Arm B preflight runner + parity harness are the
 * historical callers and remain unchanged.
 *
 * L38-A (2026-05-02): the READER-INFO STATE sub-block is also exported as
 * `renderReaderInfoStateBlock` and consumed by the production
 * `buildBeatContextSlots` for chapters > 1, so chapter-N writers see prior-
 * chapter establishedFacts and per-character `doesNotKnow` instead of
 * improvising fresh state. The other two sub-blocks (SPEAKER DIRECTIVES,
 * FOCUSED WORLD SLICE) remain Arm-B only.
 *
 * Three sub-blocks, all deterministic (no LLM calls):
 *
 *   1. SPEAKER DIRECTIVES — per-present-character cultural background
 *      and system-awareness lines. Additive to the existing CHARACTERS
 *      section (which carries Voice / Drives / Avoids / Conflict /
 *      example lines); cultural + system data is already in the
 *      character schema but not surfaced in compact-mode production.
 *
 *   2. READER-INFO STATE — the reader's knowledge slice at this beat.
 *      Aggregates establishedFacts from prior chapters as "Reader
 *      already knows", and surfaces per-character `doesNotKnow` as
 *      "Hidden from {char}" so the writer knows which reveals to
 *      avoid spoiling.
 *
 *   3. FOCUSED WORLD SLICE — expanded world-bible entries keyed to
 *      entity names matched in `beat.description` against
 *      `worldBible.{locations,cultures,systems}`. Production compact
 *      mode strips most of this; the enriched block re-adds it with
 *      full descriptions + rules/values/vocabulary.
 *
 * Output shape: a single section string starting with the literal
 * header `ENRICHED CONTEXT:` on the first line. Returned so the parity
 * harness can insert it into Arm A's recovered `sections[]` at the
 * setting-anchor position (immediately before the first section whose
 * header is `SETTING:` or `Sensory:`; else append at end).
 */

import type { SceneBeat } from "../../schemas/shared"
import type { CharacterProfile } from "./../character-agent/schema"
import type { WorldBible } from "./../world-builder/schema"
import type { ChapterOutline, CharacterState, Fact } from "../../types"

export interface EnrichedContextInput {
  /**
   * The beat currently being written. Its `description` is scanned
   * for FOCUSED WORLD SLICE entity matches; `characters` determines
   * which speakers get SPEAKER DIRECTIVES lines.
   */
  beat: SceneBeat
  /**
   * Full chapter outline, used to pull the current chapter's
   * `establishedFacts` and to cross-reference payoff/setup links.
   */
  outline: ChapterOutline
  /**
   * All character profiles for the novel. The builder filters to the
   * ones present in the beat before rendering SPEAKER DIRECTIVES.
   */
  characters: CharacterProfile[]
  /**
   * Character states as of this chapter. Used to pull `doesNotKnow`
   * lists for the READER-INFO STATE "Hidden from X" lines.
   */
  characterStates: CharacterState[]
  /**
   * World bible. Used to pull location / culture / system descriptions
   * keyed to entity names matched in `beat.description`.
   */
  worldBible: WorldBible
  /**
   * Facts established in prior chapters (chapters 1..chapterNumber-1).
   * Surfaced as "Reader already knows" in READER-INFO STATE.
   */
  priorChapterFacts: Fact[]
  /**
   * 1-indexed chapter number of the beat being written.
   */
  chapterNumber: number
}

export interface EnrichedContextResult {
  /** The full section text, ready to splice into `sections[]`. */
  block: string
  /** Byte sizes per sub-block, for telemetry + parity diagnostics. */
  subBlockBytes: {
    speakerDirectives: number
    readerInfoState: number
    focusedWorldSlice: number
  }
}

// ── Sub-block renderers ────────────────────────────────────────────────

function renderSpeakerDirectives(
  beat: SceneBeat,
  characters: CharacterProfile[],
): string {
  const beatCharNames = new Set(beat.characters.map(n => n.toLowerCase()))
  const present = characters.filter(c =>
    beatCharNames.has(c.name.toLowerCase()),
  )
  if (present.length === 0) return ""

  const lines: string[] = ["SPEAKER DIRECTIVES:"]
  for (const c of present) {
    const parts: string[] = [`${c.name}:`]

    // Cultural background — compact one-liner if any entries exist
    if (c.culturalBackground.length > 0) {
      const cbParts = c.culturalBackground.map(
        cb => `${cb.relationship} to ${cb.cultureName}`,
      )
      parts.push(`  Cultural stance: ${cbParts.join("; ")}`)
    }

    // System awareness — filter out "ignorant" (empty signal)
    const meaningfulSysAwareness = c.systemAwareness.filter(
      sa => sa.level !== "ignorant",
    )
    if (meaningfulSysAwareness.length > 0) {
      const saParts = meaningfulSysAwareness.map(sa => {
        const persp = sa.perspective ? ` (${sa.perspective})` : ""
        return `${sa.systemName} [${sa.level}]${persp}`
      })
      parts.push(`  System awareness: ${saParts.join("; ")}`)
    }

    // Fears — surfaced here because CHARACTERS in compact mode keeps
    // only Voice/Drives/Avoids/Conflict per beat-context.ts:179-182.
    // Fears are in the character schema but stripped in compact mode.
    if (c.fears) parts.push(`  Fears: ${c.fears}`)

    if (parts.length === 1) continue // character had no additive material
    lines.push(parts.join("\n"))
  }

  if (lines.length === 1) return "" // no character had additive data
  return lines.join("\n")
}

/**
 * Render the READER-INFO STATE sub-block (no surrounding ENRICHED CONTEXT
 * wrapper). Returns "" when neither prior-chapter facts nor per-present-
 * character `doesNotKnow` lines have any signal — caller can use the empty
 * string to skip section emission entirely.
 *
 * Exported for production use by `buildBeatContextSlots` (L38-A); also
 * still consumed internally by `buildEnrichedContext` for the Arm B
 * preflight.
 */
export function renderReaderInfoStateBlock(
  priorChapterFacts: Fact[],
  outline: ChapterOutline,
  beat: SceneBeat,
  characters: CharacterProfile[],
  characterStates: CharacterState[],
): string {
  return renderReaderInfoState(priorChapterFacts, outline, beat, characters, characterStates)
}

/**
 * L38-A slot selector: returns the rendered READER-INFO STATE block for a
 * specific beat, or null when the slot should be suppressed.
 *
 * Gating:
 *   - chapterNumber <= 1 → null (no prior chapter to surface).
 *   - else, render via `renderReaderInfoStateBlock` and return null when
 *     the renderer produced no signal (empty string).
 *
 * Lives in this module (not in beat-context.ts) so unit tests can exercise
 * it without colliding with the process-global `mock.module` shims that
 * the drafting suite installs on `../agents/writer/beat-context`.
 */
export function selectReaderInfoStateForBeat(
  chapterNumber: number,
  priorChapterFacts: Fact[] | undefined,
  outline: ChapterOutline,
  beat: SceneBeat,
  characters: CharacterProfile[],
  characterStates: CharacterState[],
): string | null {
  if (chapterNumber <= 1) return null
  const facts = priorChapterFacts ?? []
  const block = renderReaderInfoStateBlock(facts, outline, beat, characters, characterStates)
  return block.length > 0 ? block : null
}

function renderReaderInfoState(
  priorChapterFacts: Fact[],
  outline: ChapterOutline,
  beat: SceneBeat,
  characters: CharacterProfile[],
  characterStates: CharacterState[],
): string {
  const sections: string[] = []

  if (priorChapterFacts.length > 0) {
    const facts = priorChapterFacts
      .slice(0, 12) // cap — keep the block bounded
      .map(f => `- [ch${f.establishedInChapter}] ${f.fact}`)
    sections.push(`Reader already knows:\n${facts.join("\n")}`)
  }

  // Per-present-character "Hidden from X" lines. Pulled from
  // characterStates.doesNotKnow at the current chapter.
  const beatCharNames = new Set(beat.characters.map(n => n.toLowerCase()))
  const charById = new Map(characters.map(c => [c.id, c.name]))
  const hiddenLines: string[] = []
  for (const cs of characterStates) {
    const name = charById.get(cs.characterId)
    if (!name || !beatCharNames.has(name.toLowerCase())) continue
    if (!cs.doesNotKnow || cs.doesNotKnow.length === 0) continue
    const items = cs.doesNotKnow.slice(0, 4)
    for (const item of items) hiddenLines.push(`- Hidden from ${name}: ${item}`)
  }
  if (hiddenLines.length > 0) {
    sections.push(hiddenLines.join("\n"))
  }

  if (sections.length === 0) return ""
  return "READER-INFO STATE:\n" + sections.join("\n\n")
}

/**
 * Word-boundary-aware, case-insensitive entity matcher. Matches when
 * the entity name appears as a contiguous span in the beat description
 * with non-alphanumeric boundaries on both sides. Returns the set of
 * matched entity names, preserving their canonical casing from the
 * world bible.
 */
function findEntityMatches(
  text: string,
  entityNames: string[],
): Set<string> {
  const matches = new Set<string>()
  const lowerText = text.toLowerCase()
  for (const name of entityNames) {
    if (name.length < 4) continue // avoid noise on tiny names
    const lower = name.toLowerCase()
    const idx = lowerText.indexOf(lower)
    if (idx < 0) continue
    // Cheap word-boundary check: char before and after must be
    // non-alphanumeric (or string edge). Matches the pattern used by
    // regexLeakMatches().
    const before = idx > 0 ? lowerText[idx - 1] : ""
    const after =
      idx + lower.length < lowerText.length
        ? lowerText[idx + lower.length]
        : ""
    const isBoundary = (ch: string) => !/[a-z0-9]/i.test(ch)
    if (isBoundary(before) && isBoundary(after)) matches.add(name)
  }
  return matches
}

function renderFocusedWorldSlice(
  beat: SceneBeat,
  worldBible: WorldBible,
): string {
  const text = beat.description
  const locMatches = findEntityMatches(
    text,
    worldBible.locations.map(l => l.name),
  )
  const cultMatches = findEntityMatches(
    text,
    worldBible.cultures.map(c => c.name),
  )
  const sysMatches = findEntityMatches(
    text,
    worldBible.systems.map(s => s.name),
  )

  if (
    locMatches.size === 0 &&
    cultMatches.size === 0 &&
    sysMatches.size === 0
  ) {
    return ""
  }

  const parts: string[] = ["FOCUSED WORLD SLICE:"]

  for (const loc of worldBible.locations) {
    if (!locMatches.has(loc.name)) continue
    const lines = [`${loc.name} (location):`]
    if (loc.description) lines.push(`  ${loc.description}`)
    parts.push(lines.join("\n"))
  }

  for (const cult of worldBible.cultures) {
    if (!cultMatches.has(cult.name)) continue
    const lines = [`${cult.name} (culture):`]
    if (cult.description) lines.push(`  ${cult.description}`)
    if (cult.values.length > 0) {
      lines.push(`  Values: ${cult.values.slice(0, 4).join("; ")}`)
    }
    if (cult.taboos.length > 0) {
      lines.push(`  Taboos: ${cult.taboos.slice(0, 4).join("; ")}`)
    }
    parts.push(lines.join("\n"))
  }

  for (const sys of worldBible.systems) {
    if (!sysMatches.has(sys.name)) continue
    const lines = [`${sys.name} (system, ${sys.type}):`]
    if (sys.description) lines.push(`  ${sys.description}`)
    if (sys.rules.length > 0) {
      lines.push(`  Rules: ${sys.rules.slice(0, 3).join("; ")}`)
    }
    if (sys.vocabulary.length > 0) {
      lines.push(`  Vocabulary: ${sys.vocabulary.slice(0, 8).join(", ")}`)
    }
    parts.push(lines.join("\n"))
  }

  return parts.join("\n")
}

// ── Top-level builder ─────────────────────────────────────────────────

export function buildEnrichedContext(
  input: EnrichedContextInput,
): EnrichedContextResult {
  const speakerDirectives = renderSpeakerDirectives(
    input.beat,
    input.characters,
  )
  const readerInfoState = renderReaderInfoState(
    input.priorChapterFacts,
    input.outline,
    input.beat,
    input.characters,
    input.characterStates,
  )
  const focusedWorldSlice = renderFocusedWorldSlice(
    input.beat,
    input.worldBible,
  )

  const subBlocks = [speakerDirectives, readerInfoState, focusedWorldSlice]
    .filter(s => s.length > 0)

  // Always emit the section header even if all sub-blocks are empty —
  // an empty ENRICHED CONTEXT: section would mean the preflight's
  // stratification selected beats with insufficient signal, which is
  // useful telemetry. But return the block length zero via subBlockBytes
  // so the caller can decide whether to skip the beat.
  const block =
    subBlocks.length > 0
      ? "ENRICHED CONTEXT:\n\n" + subBlocks.join("\n\n")
      : "ENRICHED CONTEXT:\n(no additive signal for this beat)"

  return {
    block,
    subBlockBytes: {
      speakerDirectives: speakerDirectives.length,
      readerInfoState: readerInfoState.length,
      focusedWorldSlice: focusedWorldSlice.length,
    },
  }
}

// ── Insertion helper ──────────────────────────────────────────────────

/**
 * Insert the ENRICHED CONTEXT block into Arm A's recovered `sections[]`
 * at the setting-anchor position per charter §6:
 *
 *   if sections contains a section whose header starts with `SETTING:`
 *   or `Sensory:`: insert the new section immediately before it;
 *   else: append to the end of the array.
 *
 * Returns a new array; does NOT mutate the input.
 */
export function insertEnrichedSection(
  sections: string[],
  enrichedBlock: string,
): string[] {
  const settingIdx = sections.findIndex(
    s => s.startsWith("SETTING:") || s.startsWith("Sensory:"),
  )
  const copy = sections.slice()
  if (settingIdx >= 0) {
    copy.splice(settingIdx, 0, enrichedBlock)
  } else {
    copy.push(enrichedBlock)
  }
  return copy
}
