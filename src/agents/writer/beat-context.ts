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
 * - `buildSceneContextSlots` owns ALL async/data selection: conditioning
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
 * - `buildSceneContext` is preserved as a thin composer. Existing call sites
 *   in drafting.ts:282, 605, 917 keep working without changes; the public
 *   surface (BeatContextInput, BeatContextResult, pickExampleLineSubset)
 *   is unchanged.
 *
 * Byte-parity is enforced by `tests/beat-context-parity.test.ts` against
 * `tests/beat-context-fixtures/legacy-snapshot.ts`. The legacy snapshot
 * stays in the suite long-term as a regression check (Codex round-3 Q2).
 */

import { getRelationshipBetween } from "../../db"
import {
  beatDescriptionHasImplicitReference,
  resolveReferences,
  type ResolvedReferences,
} from "./reference-resolver"
import { renderBeatContext } from "./beat-context-render"
import { selectReaderInfoStateForBeat } from "./enriched-context"
import {
  buildBeatCharacterContextCapsules,
  summarizeCharacterContextCapsules,
  type WriterCharacterContextCapsules,
  type WriterCharacterContextTrace,
} from "./character-context"
import { summarizeBeatContextSurface, type WriterContextSurfaceTrace } from "./context-surface"
import {
  selectWriterPromptForDraftingBrief,
  type WriterDraftingBriefMode,
  type WriterDraftingBriefTrace,
} from "./drafting-brief"
import type { WriterContextMode, WriterPromptIdRendering } from "./context-mode"
import type { BeatObligationsContract, ChapterOutline, CharacterProfile, Fact, SceneBeat } from "../../types"
import type { StorySpine } from "../../types"
import {
  buildAuthoringBiblePacket,
  selectAuthoringBibleSlice,
  type AuthoringBibleMode,
  type AuthoringBibleSlice,
} from "../../harness/authoring-bible"

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
  /** Optional story spine used by the authoring-bible compiler. */
  storySpine?: StorySpine | null
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
  /** L097 Slice 2: when true and the entry has scene-contract fields,
   *  surface them as a SCENE CONTRACT block in the writer prompt. Off
   *  preserves byte-parity. */
  sceneCallWriterV1?: boolean
  /** adjusted-B3 Arm B preparation: render the SCENE CONTRACT block
   *  when scene-contract fields are populated, without switching to
   *  scene-call writer mode. Default-off. Decouples the contract render
   *  from the architecture shift so adjusted-B3 can A/B them
   *  separately. Off preserves byte-parity for legacy outlines. */
  forceRenderSceneContractWhenAvailable?: boolean
  /** L099 / adjusted-B1: writer-prompt ID rendering ablation lever.
   *  Defaults to "raw" (legacy behaviour). When set to "suppress", the
   *  Cluster-1 raw-ID lines are omitted from the rendered prompt; trace
   *  metadata is unaffected. Pure render-time concern; the slot builder
   *  still populates every field, so swapping arms in an A/B does not
   *  require rebuilding context. */
  writerPromptIdRendering?: WriterPromptIdRendering
  /** L106 production-path integration: optional compact writer-facing brief
   *  rendered from the same BeatContext slots. Default "off" preserves the
   *  full existing prompt shape. */
  writerDraftingBriefMode?: WriterDraftingBriefMode
  /** Default-off authoring-bible context. When v1, the same production
   *  slots render compact story/character/relationship/voice rules with
   *  stable rule IDs for advisory post-draft review. */
  authoringBibleMode?: AuthoringBibleMode
}

export interface BeatContextResult {
  userPrompt: string
  targetWords: number
  characterContextTrace?: WriterCharacterContextTrace | null
  contextSurfaceTrace?: WriterContextSurfaceTrace
  draftingBriefTrace?: WriterDraftingBriefTrace
}

// ── Typed slots (D1) ─────────────────────────────────────────────────────
// These types describe what `buildSceneContextSlots` produces and what
// `renderBeatContext` consumes. They are the integration surface for future
// context levers (voice-shaping, characterStateChanges wiring, etc.) — each
// such lever becomes a `BeatContext → BeatContext` transform behind a flag.

export interface SeedLink {
  factId?: string
  /** Pre-resolved fact text (factById lookup already applied by builder). */
  fact: string
  /** 0-based beat index where the seeded payoff lands. */
  landsAtBeat: number
}

export interface PayoffDue {
  factId?: string
  /** Pre-resolved fact text. */
  fact: string
  /** 0-based beat index that originally seeded this payoff. */
  seededAtBeat: number
}

export interface BeatSpec {
  sceneId?: string
  beatId?: string
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
  /** Reference-resolution attempt metadata for writer-context telemetry. */
  referenceResolutionTrace?: WriterReferenceResolutionTrace | null
  /** L38-A reader-state block: prior-chapter establishedFacts + per-present-
   *  character `doesNotKnow` lines, pre-rendered as a `READER-INFO STATE:
   *  …` section. Null when chapterNumber === 1 (nothing prior), when no
   *  prior facts were passed, or when the renderer found no signal. */
  readerInfoState: string | null
  characterContextCapsules?: WriterCharacterContextCapsules | null
  /** Setting payload — null when section is suppressed (not beat 0 AND no
   *  location-change heuristic fire) OR no matching world-bible location. */
  setting: SettingBlock | null
  /** L097 Slice 2: scene-contract block populated when sceneCallWriterV1
   *  is on AND the entry has at least one scene-contract field. Null
   *  when the flag is off OR the planner emitted no scene-contract fields
   *  (legacy plans, off-flag plans, transit/establishment beats).
   *  Optional in the type so legacy test fixtures and offline callers
   *  don't have to thread the slot through; absence is rendered the same
   *  as null (no SCENE CONTRACT section). */
  sceneContract?: SceneContractBlock | null
  /** Compact story/character/relationship/voice rule slice. Default absent
   *  unless authoringBibleMode=v1, preserving legacy prompt shape. */
  authoringBible?: AuthoringBibleSlice | null
}

export interface WriterReferenceResolutionTrace {
  hasImplicitReference: boolean
  lookupCount: number
  llmUsed: boolean
  contextRendered: boolean
}

export interface SceneContractBlock {
  /** Explicit time frame for this scene, e.g. "dawn the next morning". */
  temporalAnchor?: string
  /** Explicit place/arena frame for this scene, e.g. "Iron Bridge". */
  placeAnchor?: string
  goal?: string
  opposition?: string
  turningPoint?: string
  crisisChoice?: string
  choiceAlternatives: string[]
  outcome?: string
  consequence?: string
  povPersonalStake?: string
  valueIn?: string
  valueOut?: string
  /** Per-entry word target advisory derived from the scene contract.
   *  Drafting expansion-retry uses this when present; falls back to
   *  `targetWords` (chapter total / entry count) otherwise. */
  targetWords?: number
}

// ── Slot builder (D1) ────────────────────────────────────────────────────

export async function buildSceneContextSlots(input: BeatContextInput): Promise<BeatContext> {
  const { novelId, chapterNumber, beatIndex, previousBeatProse, outline, characters, characterStates, worldBible } = input

  const conditioning = resolveConditioningOverride()
  const beat = outline.scenes[beatIndex]
  const povCharName = outline.povCharacter
  const povChar = characters.find(c => c.name.toLowerCase() === povCharName?.toLowerCase())

  // Beat spec slot ────────────────────────────────────────────────────────
  const facts = outline.establishedFacts ?? []
  const factById = new Map(facts.filter(f => f.id).map(f => [f.id, f.fact]))

  const seeds: SeedLink[] = (beat.requiredPayoffs ?? []).map(p => {
    const seed: SeedLink = {
      fact: factById.get(p.fact_id) ?? `[fact_id=${p.fact_id}]`,
      landsAtBeat: p.payoff_beat,
    }
    if (p.fact_id) seed.factId = p.fact_id
    return seed
  })

  const payoffsDue: PayoffDue[] = []
  for (let i = 0; i < beatIndex; i++) {
    for (const link of outline.scenes[i]?.requiredPayoffs ?? []) {
      if (link.payoff_beat === beatIndex) {
        const due: PayoffDue = {
          fact: factById.get(link.fact_id) ?? `[fact_id=${link.fact_id}]`,
          seededAtBeat: i,
        }
        if (link.fact_id) due.factId = link.fact_id
        payoffsDue.push(due)
      }
    }
  }

  const beatSpec: BeatSpec = {
    ...(beat.sceneId ? { sceneId: beat.sceneId } : {}),
    ...(beat.beatId ? { beatId: beat.beatId } : {}),
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
  const referenceResolutionTrace: WriterReferenceResolutionTrace = {
    hasImplicitReference: beatDescriptionHasImplicitReference(beat.description),
    lookupCount: refs.lookupCount,
    llmUsed: refs.llmUsed,
    contextRendered: Boolean(resolvedReferencesText),
  }

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

  // SCENE CONTRACT block emits when either:
  //   - sceneCallWriterV1 is on (L097 Slice 2 — full scene-call writer), or
  //   - forceRenderSceneContractWhenAvailable is on (adjusted-B3 Arm B —
  //     beat-shaped writer with the contract rendered).
  // buildSceneContractBlock returns null when no scene-contract field is
  // set on the entry, so off-flag plans (the production case while
  // scenePlanContractV1 stays default-off) emit no SCENE CONTRACT
  // section regardless.
  const renderSceneContractFlagOn =
    Boolean(input.sceneCallWriterV1)
    || Boolean(input.forceRenderSceneContractWhenAvailable)
    || (input.writerDraftingBriefMode !== undefined && input.writerDraftingBriefMode !== "off")
  const sceneContract = renderSceneContractFlagOn
    ? buildSceneContractBlock(beat)
    : null
  const authoringBible = input.authoringBibleMode === "v1"
    ? selectAuthoringBibleSlice({
        packet: buildAuthoringBiblePacket({
          genre: input.genre,
          worldBible,
          storySpine: input.storySpine,
          characters,
        }),
        outline,
        scene: beat,
        sceneIndex: beatIndex,
      })
    : null

  return {
    beatSpec,
    transitionBridge,
    landingTarget,
    characterSnapshots,
    resolvedReferencesText,
    referenceResolutionTrace,
    readerInfoState,
    characterContextCapsules,
    setting,
    sceneContract,
    authoringBible,
  }
}

// L097 Slice 2: extract scene-contract fields from the entry. Returns null
// when none of the scene-contract fields are populated — this preserves
// off-flag byte parity for legacy outlines that ride through with the flag
// on (no contract block rendered when the planner emitted no scene fields).
function buildSceneContractBlock(beat: SceneBeat): SceneContractBlock | null {
  const temporalAnchor = clean(beat.temporalAnchor)
  const placeAnchor = clean(beat.placeAnchor)
  const goal = clean(beat.goal)
  const opposition = clean(beat.opposition)
  const turningPoint = clean(beat.turningPoint)
  const crisisChoice = clean(beat.crisisChoice)
  const outcome = clean(beat.outcome)
  const consequence = clean(beat.consequence)
  const povPersonalStake = clean(beat.povPersonalStake)
  const valueIn = clean(beat.valueIn)
  const valueOut = clean(beat.valueOut)
  const choiceAlternatives = (beat.choiceAlternatives ?? [])
    .map(s => (typeof s === "string" ? s.trim() : ""))
    .filter(s => s.length > 0)
  const targetWords = typeof beat.targetWords === "number" && beat.targetWords > 0 ? beat.targetWords : undefined

  const hasAny = Boolean(
    temporalAnchor || placeAnchor
    || goal || opposition || turningPoint || crisisChoice || outcome || consequence
    || povPersonalStake || valueIn || valueOut || choiceAlternatives.length > 0,
  )
  if (!hasAny) return null

  const block: SceneContractBlock = { choiceAlternatives }
  if (temporalAnchor) block.temporalAnchor = temporalAnchor
  if (placeAnchor) block.placeAnchor = placeAnchor
  if (goal) block.goal = goal
  if (opposition) block.opposition = opposition
  if (turningPoint) block.turningPoint = turningPoint
  if (crisisChoice) block.crisisChoice = crisisChoice
  if (outcome) block.outcome = outcome
  if (consequence) block.consequence = consequence
  if (povPersonalStake) block.povPersonalStake = povPersonalStake
  if (valueIn) block.valueIn = valueIn
  if (valueOut) block.valueOut = valueOut
  if (targetWords !== undefined) block.targetWords = targetWords
  return block
}

function clean(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolveConditioningOverride(): "fixed" | "rotation" | undefined {
  const raw = process.env.WRITER_CONDITIONING
  return raw === "fixed" || raw === "rotation" ? raw : undefined
}

// ── Public composer (preserved interface) ────────────────────────────────

export async function buildSceneContext(input: BeatContextInput): Promise<BeatContextResult> {
  const ctx = await buildSceneContextSlots(input)
  // L097 Slice 2: prefer per-entry scene-contract targetWords when present;
  // falls back to the chapter-divided default. Off-flag (sceneContract === null)
  // the legacy chapter-divided behaviour is preserved.
  const targetWords = ctx.sceneContract?.targetWords
    ?? Math.round(input.outline.targetWords / Math.max(input.outline.scenes.length, 1))
  const fullContextPrompt = renderBeatContext(ctx, {
    compact: !!input.compactMode,
    idRendering: input.writerPromptIdRendering,
  })
  const { userPrompt, draftingBriefTrace } = selectWriterPromptForDraftingBrief({
    ctx,
    mode: input.writerDraftingBriefMode ?? "off",
    fullContextPrompt,
    targetWords,
    idRendering: input.writerPromptIdRendering,
  })
  return {
    userPrompt,
    targetWords,
    characterContextTrace: ctx.characterContextCapsules
      ? summarizeCharacterContextCapsules(ctx.characterContextCapsules)
      : null,
    contextSurfaceTrace: summarizeBeatContextSurface(ctx),
    draftingBriefTrace,
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
