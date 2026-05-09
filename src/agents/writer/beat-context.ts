/**
 * Beat-level context assembly — deterministic DB lookups driven by beat spec.
 *
 * Each beat gets ~500-1,000 tokens of context instead of ~8,500.
 * Only includes what the beat actually references:
 *   1. Beat spec (description, characters, POV, setting)
 *   2. Transition bridge (last 2-3 sentences of previous beat)
 *   3. Landing target (first sentence of next beat's description)
 *   4. Character snapshot (speech pattern, behavioral drivers, current state, relationship to POV)
 *   5. Setting (location sensory details, only if beat 0 or location changes)
 *
 * emotionalShift is deliberately excluded — naming emotions biases toward telling.
 * The beat description encodes emotional trajectory through action.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * D1 (2026-04-28): split into a typed-slot data layer + a pure renderer.
 *
 * - `buildBeatContextSlots` owns ALL async/data selection: conditioning
 *   resolution, compact-vs-full async branching, relationship/state lookups,
 *   reference resolution, exampleLines preset selection, location-change
 *   heuristic, setting visibility decision.
 *
 * - `renderBeatContext` (in `./beat-context-render.ts`) is pure deterministic
 *   string assembly. No async, no DB, no I/O. Takes a fully-prepared
 *   `BeatContext` and emits the user prompt; the `compact` flag drives
 *   per-character formatting (collapsed vs full snapshot blocks) and the
 *   setting block (compact strips the title+description, keeping only the
 *   "Sensory: …" line).
 *
 * - `buildBeatContext` is preserved as a thin composer. Existing call sites
 *   in drafting.ts:282, 605, 917 keep working without changes; the public
 *   surface (BeatContextInput, BeatContextResult, pickExampleLineSubset)
 *   is unchanged.
 *
 * Byte-parity is enforced by `tests/beat-context-parity.test.ts` against
 * `tests/beat-context-fixtures/legacy-snapshot.ts`. The legacy snapshot
 * stays in the suite long-term as a regression check (Codex round-3 Q2).
 */

import { getRelationshipBetween } from "../../db"
import { resolveReferences, type ResolvedReferences } from "./reference-resolver"
import { renderBeatContext } from "./beat-context-render"
import { selectReaderInfoStateForBeat } from "./enriched-context"
import { buildBeatCharacterContextCapsules, type WriterCharacterContextCapsules } from "./character-context"
import type { WriterContextMode } from "./context-mode"
import type { BeatObligationsContract, ChapterOutline, CharacterProfile, Fact, SceneBeat } from "../../types"

// ── exampleLines conditioning presets ────────────────────────────────────
// Implementation lives in `./example-line-subset.ts`; re-exported here so
// existing call sites (drafting.ts, scripts/evals/*) keep importing from
// `./beat-context` unchanged. The split exists so beat-context.test.ts can
// import the function from a path that the drafting tests' process-global
// module mocks do not cover. See exp #246-style mock-pollution discussion.
import { pickExampleLineSubset } from "./example-line-subset"
export { pickExampleLineSubset }

// ── Public input/output (unchanged) ──────────────────────────────────────

export interface BeatContextInput {
  novelId: string
  chapterNumber: number
  beatIndex: number
  previousBeatProse?: string
  outline: ChapterOutline
  characters: CharacterProfile[]
  characterStates: any[]
  worldBible: any
  /** Pre-resolved references for this beat. When provided, skips the internal
   *  resolveReferences call — used by the drafting loop to pre-fetch all beats
   *  in parallel before the serial writing loop starts. */
  preResolvedRefs?: ResolvedReferences
  /** Legacy compact rendering for offline eval scripts. Runtime drafting does
   *  not set this. When true: character snapshots
   *  collapse to one line per character (Voice + Drives only), runtime
   *  state fields (State/With/Tension/Doesn't-know) are omitted, and
   *  duplicate SETTING block is skipped. */
  compactMode?: boolean
  /** Seed genre string — used to resolve the writer pack's conditioning mode
   *  for exampleLines subset selection. When omitted, falls back to "fixed". */
  genre?: string
  /** L38-A: facts established in chapters 1..chapterNumber-1, surfaced as
   *  the READER-INFO STATE section so the writer sees what the reader
   *  already knows before drafting chapter N. Caller is expected to pass
   *  `getFactsUpToChapter(novelId, chapterNumber - 1)` for chapters > 1
   *  and to omit this field (or pass []) for chapter 1. The slot builder
   *  also gates on `chapterNumber > 1`, so passing facts for chapter 1
   *  has no effect (they belong to chapter 1's plan, not prior state). */
  priorChapterFacts?: Fact[]
  /** Optional production context upgrade. Omitted means legacy prompt shape,
   *  preserving byte-parity tests and offline eval callers. */
  writerContextMode?: WriterContextMode
}

export interface BeatContextResult {
  userPrompt: string
  targetWords: number
}

// ── Typed slots (D1) ─────────────────────────────────────────────────────
// These types describe what `buildBeatContextSlots` produces and what
// `renderBeatContext` consumes. They are the integration surface for future
// context levers (voice-shaping, characterStateChanges wiring, etc.) — each
// such lever becomes a `BeatContext → BeatContext` transform behind a flag.

export interface SeedLink {
  /** Pre-resolved fact text (factById lookup already applied by builder). */
  fact: string
  /** 0-based beat index where the seeded payoff lands. */
  landsAtBeat: number
}

export interface PayoffDue {
  /** Pre-resolved fact text. */
  fact: string
  /** 0-based beat index that originally seeded this payoff. */
  seededAtBeat: number
}

export interface BeatSpec {
  beatNumber: number
  totalBeats: number
  pov: string
  setting: string
  kind: string
  description: string
  charactersPresent: string[]
  /** requiredPayoffs of THIS beat (this beat must set them up). */
  seeds: SeedLink[]
  /** requiredPayoffs of EARLIER beats whose payoff_beat === this index. */
  payoffsDue: PayoffDue[]
  /** Planner-authored compact obligations for this beat. */
  obligations: BeatObligationsContract
}

export interface CharacterSnapshot {
  /** Required. */
  name: string
  /** Required. Empty array if the character has no exampleLines. Already
   *  passed through pickExampleLineSubset so the renderer just emits as-is. */
  exampleLines: string[]
  voice?: string
  drives?: string
  avoids?: string
  conflict?: string
  state?: string
  withPov?: { trustLevel: string; dynamic: string; tension?: string }
  doesNotKnow?: string[]
  /** POV character's display name as used in the legacy "With X: …" line.
   *  This is the canonical name from CharacterProfile (povChar.name), NOT
   *  the raw `outline.povCharacter` string — casing matches the character
   *  profile lookup. Only populated when `withPov` is also populated.
   *  Internal-use field for the renderer; downstream consumers reading
   *  typed slot data can ignore it.
   */
  povDisplayName?: string
}

export interface SettingBlock {
  name: string
  description?: string
  sensoryDetails?: string
}

export interface BeatContext {
  beatSpec: BeatSpec
  /** Last N sentences of the previous beat's prose, ready to render. Null
   *  when there is no previous beat or extraction yielded nothing. */
  transitionBridge: string | null
  /** First sentence of the NEXT beat's description. Null when no next beat
   *  exists or the description is empty. */
  landingTarget: string | null
  characterSnapshots: CharacterSnapshot[]
  /** ResolvedReferences.context, or null when empty. */
  resolvedReferencesText: string | null
  /** L38-A reader-state block: prior-chapter establishedFacts + per-present-
   *  character `doesNotKnow` lines, pre-rendered as a `READER-INFO STATE:
   *  …` section. Null when chapterNumber === 1 (nothing prior), when no
   *  prior facts were passed, or when the renderer found no signal. */
  readerInfoState: string | null
  characterContextCapsules?: WriterCharacterContextCapsules | null
  /** Setting payload — null when section is suppressed (not beat 0 AND no
   *  location-change heuristic fire) OR no matching world-bible location. */
  setting: SettingBlock | null
}

// ── Slot builder (D1) ────────────────────────────────────────────────────

export async function buildBeatContextSlots(input: BeatContextInput): Promise<BeatContext> {
  const { novelId, chapterNumber, beatIndex, previousBeatProse, outline, characters, characterStates, worldBible } = input

  const conditioning = resolveConditioningOverride()
  const beat = outline.scenes[beatIndex]
  const povCharName = outline.povCharacter
  const povChar = characters.find(c => c.name.toLowerCase() === povCharName?.toLowerCase())

  // Beat spec slot ────────────────────────────────────────────────────────
  const facts = outline.establishedFacts ?? []
  const factById = new Map(facts.filter(f => f.id).map(f => [f.id, f.fact]))

  const seeds: SeedLink[] = (beat.requiredPayoffs ?? []).map(p => ({
    fact: factById.get(p.fact_id) ?? `[fact_id=${p.fact_id}]`,
    landsAtBeat: p.payoff_beat,
  }))

  const payoffsDue: PayoffDue[] = []
  for (let i = 0; i < beatIndex; i++) {
    for (const link of outline.scenes[i]?.requiredPayoffs ?? []) {
      if (link.payoff_beat === beatIndex) {
        payoffsDue.push({
          fact: factById.get(link.fact_id) ?? `[fact_id=${link.fact_id}]`,
          seededAtBeat: i,
        })
      }
    }
  }

  const beatSpec: BeatSpec = {
    beatNumber: beatIndex + 1,
    totalBeats: outline.scenes.length,
    pov: outline.povCharacter,
    setting: outline.setting,
    kind: beat.kind ?? "action",
    description: beat.description,
    charactersPresent: beat.characters,
    seeds,
    payoffsDue,
    obligations: normalizeBeatObligations(beat.obligations),
  }

  // Transition bridge slot ────────────────────────────────────────────────
  let transitionBridge: string | null = null
  if (previousBeatProse) {
    transitionBridge = extractLastSentences(previousBeatProse, 3)
  }

  // Landing target slot ───────────────────────────────────────────────────
  let landingTarget: string | null = null
  const nextBeat = outline.scenes[beatIndex + 1]
  if (nextBeat) {
    const firstSentence = nextBeat.description.split(/[.!?]/)[0]?.trim()
    if (firstSentence) landingTarget = firstSentence
  }

  // Character snapshot slot ───────────────────────────────────────────────
  // Compact mode AVOIDS the async Promise.all/getRelationshipBetween calls
  // (data-selection concern, NOT a rendering concern). Full mode does the
  // relationship + state lookups so the renderer has the data to emit.
  const beatCharNames = beat.characters.map(n => n.toLowerCase())
  const beatChars = characters.filter(c => beatCharNames.includes(c.name.toLowerCase()))

  let characterSnapshots: CharacterSnapshot[] = []
  if (beatChars.length > 0) {
    if (input.compactMode) {
      // Legacy compact path: synchronous, no DB. Kept for offline eval scripts;
      // live drafting uses the full runtime state surface.
      characterSnapshots = beatChars.map(c => buildSnapshotCompact(c, chapterNumber, beatIndex, conditioning))
    } else {
      // Full path: async per-character, includes relationship lookup.
      characterSnapshots = await Promise.all(beatChars.map(c =>
        buildSnapshotFull(novelId, c, povChar, chapterNumber, beatIndex, characterStates, conditioning),
      ))
    }
  }

  // Resolved references slot ──────────────────────────────────────────────
  const refs = input.preResolvedRefs ?? await resolveReferences(beat, outline, novelId, chapterNumber, characters)
  const resolvedReferencesText = refs.context ? refs.context : null

  // Setting slot ──────────────────────────────────────────────────────────
  // Section visibility heuristic lives in the slot builder — null means
  // "not rendered." Beat 0 always shows; later beats only show when
  // beatHasLocationChange detects a transition.
  let setting: SettingBlock | null = null
  if (beatIndex === 0 || beatHasLocationChange(beat, outline)) {
    setting = lookupSetting(worldBible, outline.setting)
  }

  // Reader-info state slot (L38-A) ────────────────────────────────────────
  // Gating + rendering live in `selectReaderInfoStateForBeat` so the slot
  // logic stays unit-testable without colliding with drafting-suite mocks
  // on this module. Returns null for chapter 1 (no prior to surface) and
  // when the renderer finds no signal.
  const readerInfoState = selectReaderInfoStateForBeat(
    chapterNumber, input.priorChapterFacts, outline, beat, characters, characterStates,
  )
  const characterContextCapsules = input.writerContextMode === "thread-character-context-v1"
    ? buildBeatCharacterContextCapsules({ outline, beat, beatIndex, characters, characterStates })
    : null

  return {
    beatSpec,
    transitionBridge,
    landingTarget,
    characterSnapshots,
    resolvedReferencesText,
    readerInfoState,
    characterContextCapsules,
    setting,
  }
}

function resolveConditioningOverride(): "fixed" | "rotation" | undefined {
  const raw = process.env.WRITER_CONDITIONING
  return raw === "fixed" || raw === "rotation" ? raw : undefined
}

// ── Public composer (preserved interface) ────────────────────────────────

export async function buildBeatContext(input: BeatContextInput): Promise<BeatContextResult> {
  const ctx = await buildBeatContextSlots(input)
  const targetWords = Math.round(input.outline.targetWords / Math.max(input.outline.scenes.length, 1))
  return {
    userPrompt: renderBeatContext(ctx, { compact: !!input.compactMode }),
    targetWords,
  }
}

function normalizeBeatObligations(obligations: BeatObligationsContract | undefined): BeatObligationsContract {
  return {
    mustEstablish: cleanObligationItems(obligations?.mustEstablish),
    mustPayOff: cleanObligationItems(obligations?.mustPayOff),
    mustTransferKnowledge: cleanObligationItems(obligations?.mustTransferKnowledge),
    mustShowStateChange: cleanObligationItems(obligations?.mustShowStateChange),
    mustNotReveal: cleanObligationItems(obligations?.mustNotReveal),
    allowedNewEntities: obligations?.allowedNewEntities ?? [],
  }
}

function cleanObligationItems<T extends { text: string }>(items: T[] | undefined): T[] {
  return (items ?? []).filter(item => item.text.trim().length > 0)
}

// ── Snapshot builders (slot-side, async-or-sync per compactMode) ─────────

function buildSnapshotCompact(
  char: CharacterProfile,
  chapterNumber: number,
  beatIndex: number,
  conditioning: "fixed" | "rotation" | undefined,
): CharacterSnapshot {
  const exampleLines = char.exampleLines && char.exampleLines.length > 0
    ? pickExampleLineSubset(char.exampleLines, chapterNumber, beatIndex, conditioning)
    : []
  const snap: CharacterSnapshot = {
    name: char.name,
    exampleLines,
  }
  if (char.speechPattern) snap.voice = char.speechPattern
  if (char.goals) snap.drives = char.goals
  if (char.avoids) snap.avoids = char.avoids
  if (char.internalConflict) snap.conflict = char.internalConflict
  return snap
}

async function buildSnapshotFull(
  novelId: string,
  char: CharacterProfile,
  povChar: CharacterProfile | undefined,
  chapterNumber: number,
  beatIndex: number,
  characterStates: any[],
  conditioning: "fixed" | "rotation" | undefined,
): Promise<CharacterSnapshot> {
  const exampleLines = char.exampleLines && char.exampleLines.length > 0
    ? pickExampleLineSubset(char.exampleLines, chapterNumber, beatIndex, conditioning)
    : []
  const snap: CharacterSnapshot = {
    name: char.name,
    exampleLines,
  }
  if (char.speechPattern) snap.voice = char.speechPattern
  if (char.goals) snap.drives = char.goals
  if (char.avoids) snap.avoids = char.avoids
  if (char.internalConflict) snap.conflict = char.internalConflict

  const state = characterStates.find(
    cs => cs.characterId === char.id || cs.characterId?.toLowerCase() === char.name.toLowerCase(),
  )
  if (state?.emotionalState) snap.state = state.emotionalState

  if (povChar && char.id !== povChar.id) {
    try {
      const rel = await getRelationshipBetween(novelId, povChar.id, char.id, chapterNumber)
      if (rel) {
        const withPov: { trustLevel: string; dynamic: string; tension?: string } = {
          trustLevel: rel.trustLevel,
          dynamic: rel.dynamic,
        }
        if (rel.tension) withPov.tension = rel.tension
        snap.withPov = withPov
        // Stash the canonical POV display name so the pure renderer can
        // emit "With ${povName}: …" without having to look up the
        // character profile. Matches the legacy line which uses
        // povChar.name from the CharacterProfile lookup.
        snap.povDisplayName = povChar.name
      }
    } catch { /* no relationship data yet */ }
  }

  if (state?.doesNotKnow?.length > 0) {
    snap.doesNotKnow = state.doesNotKnow.slice(0, 2)
  }

  return snap
}

// ── Helpers (slot-side data selection only) ──────────────────────────────

function lookupSetting(worldBible: any, settingName: string): SettingBlock | null {
  const locations = worldBible?.locations ?? []
  const match = locations.find(
    (l: any) => l.name.toLowerCase().includes(settingName.toLowerCase()) ||
         settingName.toLowerCase().includes(l.name.toLowerCase()),
  )
  if (!match) return null

  const block: SettingBlock = { name: match.name }
  if (match.description) block.description = match.description
  if (match.sensoryDetails) block.sensoryDetails = match.sensoryDetails
  return block
}

function extractLastSentences(prose: string, count: number): string | null {
  // Split on sentence boundaries, take last N
  const sentences = prose.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0)
  if (sentences.length === 0) return null
  return sentences.slice(-count).join(" ")
}

function beatHasLocationChange(beat: SceneBeat, outline: ChapterOutline): boolean {
  // Simple heuristic: if beat description mentions a place that differs from chapter setting
  const desc = beat.description.toLowerCase()
  const setting = outline.setting.toLowerCase()
  const locationWords = ["enters", "arrives at", "walks to", "goes to", "reaches", "steps into", "moves to"]
  return locationWords.some(w => desc.includes(w)) && !desc.includes(setting)
}
