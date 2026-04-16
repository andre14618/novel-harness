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
 */

import { getRelationshipBetween, getCharacterStatesAtChapter } from "../../db"
import { resolveReferences, type ResolvedReferences } from "./reference-resolver"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"

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
  /** Strip non-load-bearing fields for voice-LoRA writers. See
   *  docs/beat-writer-architecture.md. When true: character snapshots
   *  collapse to one line per character (Voice + Drives only), runtime
   *  state fields (State/With/Tension/Doesn't-know) are omitted, and
   *  duplicate SETTING block is skipped. */
  compactMode?: boolean
}

export interface BeatContextResult {
  userPrompt: string
  targetWords: number
}

export async function buildBeatContext(input: BeatContextInput): Promise<BeatContextResult> {
  const { novelId, chapterNumber, beatIndex, previousBeatProse, outline, characters, characterStates, worldBible } = input
  const beat = outline.scenes[beatIndex]
  const povCharName = outline.povCharacter
  const povChar = characters.find(c => c.name.toLowerCase() === povCharName?.toLowerCase())
  const targetWords = Math.round(outline.targetWords / Math.max(outline.scenes.length, 1))

  const sections: string[] = []

  // ── 1. Beat spec ──────────────────────────────────────────────────────
  sections.push(formatBeatSpec(beat, outline, beatIndex))

  // ── 2. Transition bridge ──────────────────────────────────────────────
  if (previousBeatProse) {
    const bridge = extractLastSentences(previousBeatProse, 3)
    if (bridge) sections.push(`TRANSITION BRIDGE (continue from here):\n${bridge}`)
  }

  // ── 3. Landing target ─────────────────────────────────────────────────
  const nextBeat = outline.scenes[beatIndex + 1]
  if (nextBeat) {
    const firstSentence = nextBeat.description.split(/[.!?]/)[0]?.trim()
    if (firstSentence) {
      sections.push(`LANDING TARGET (end connecting toward this):\nNext beat: ${firstSentence}`)
    }
  }

  // ── 4. Character snapshot ─────────────────────────────────────────────
  const beatCharNames = beat.characters.map(n => n.toLowerCase())
  const beatChars = characters.filter(c => beatCharNames.includes(c.name.toLowerCase()))

  if (beatChars.length > 0) {
    if (input.compactMode) {
      // Compact (revised after exp #200 regression):
      //   Keep Voice + Drives + Avoids + Conflict on the character sheet —
      //   these are planner side-channels for per-chapter requirements
      //   ("Senna avoids mirrors" lives in Avoids and must reach the writer).
      //   Strip only genuinely-runtime fields (State, With, Tension,
      //   Doesn't-know) which are sparse and rarely load-bearing on any
      //   given beat. See docs/beat-writer-architecture.md §6 for the
      //   regression analysis that drove this revision.
      const lines = beatChars.flatMap(c => {
        const entry = [`${c.name}:`]
        if (c.speechPattern) entry.push(`  Voice: ${c.speechPattern}`)
        if (c.goals) entry.push(`  Drives: ${c.goals}`)
        if (c.avoids) entry.push(`  Avoids: ${c.avoids}`)
        if (c.internalConflict) entry.push(`  Conflict: ${c.internalConflict}`)
        return [...entry, ""]
      })
      // Trim trailing blank
      while (lines.length && lines[lines.length - 1] === "") lines.pop()
      sections.push(`CHARACTERS:\n${lines.join("\n")}`)
    } else {
      const snapshots = await Promise.all(beatChars.map(c =>
        formatCharacterSnapshot(novelId, c, povChar, chapterNumber, characterStates)
      ))
      sections.push(`CHARACTERS:\n${snapshots.join("\n\n")}`)
    }
  }

  // ── 5. Resolved references ─────────────────────────────────────────────
  // Keep resolved-references in both modes. Exp #200 regressed when these
  // were stripped: world-fact requirements ("Tower of Reseth sits on a
  // fault line activated six years ago") travel through reference-resolver
  // output and the writer can't establish them without the context.
  const refs = input.preResolvedRefs ?? await resolveReferences(beat, outline, novelId, chapterNumber, characters)
  if (refs.context) sections.push(refs.context)

  // ── 6. Setting ────────────────────────────────────────────────────────
  // Compact mode strips the duplicate SETTING block — inline "Setting: {name}"
  // in §1 already carries the location. Only keep the sensory line when
  // non-empty.
  if (beatIndex === 0 || beatHasLocationChange(beat, outline)) {
    const setting = formatSetting(worldBible, outline.setting)
    if (setting) {
      if (input.compactMode) {
        const sensoryLine = setting.split("\n").find(l => l.startsWith("Sensory:"))
        if (sensoryLine) sections.push(sensoryLine)
      } else {
        sections.push(setting)
      }
    }
  }

  return {
    userPrompt: sections.filter(Boolean).join("\n\n"),
    targetWords,
  }
}

// ── Formatters ──────────────────────────────────────────────────────────

function formatBeatSpec(beat: SceneBeat, outline: ChapterOutline, beatIndex: number): string {
  const lines = [
    `BEAT ${beatIndex + 1} of ${outline.scenes.length}`,
    `POV: ${outline.povCharacter}`,
    `Setting: ${outline.setting}`,
    ``,
    beat.description,
  ]
  if (beat.characters.length > 0) {
    lines.push(`Characters present: ${beat.characters.join(", ")}`)
  }
  return lines.join("\n")
}

async function formatCharacterSnapshot(
  novelId: string, char: CharacterProfile, povChar: CharacterProfile | undefined,
  chapterNumber: number, characterStates: any[],
): Promise<string> {
  const lines: string[] = [`${char.name}:`]

  // Speech pattern — the critical anchor
  if (char.speechPattern) lines.push(`  Voice: ${char.speechPattern}`)

  // Behavioral drivers — how they act, not just how they talk
  if (char.goals) lines.push(`  Drives: ${char.goals}`)
  if (char.avoids) lines.push(`  Avoids: ${char.avoids}`)
  if (char.internalConflict) lines.push(`  Conflict: ${char.internalConflict}`)

  // Current emotional/tactical state
  const state = characterStates.find(
    cs => cs.characterId === char.id || cs.characterId?.toLowerCase() === char.name.toLowerCase()
  )
  if (state?.emotionalState) lines.push(`  State: ${state.emotionalState}`)

  // Relationship to POV (just the current dynamic, not full arc)
  if (povChar && char.id !== povChar.id) {
    try {
      const rel = await getRelationshipBetween(novelId, povChar.id, char.id, chapterNumber)
      if (rel) {
        lines.push(`  With ${povChar.name}: [${rel.trustLevel}] ${rel.dynamic}`)
        if (rel.tension) lines.push(`    Tension: ${rel.tension}`)
      }
    } catch { /* no relationship data yet */ }
  }

  // Knowledge constraint (what they don't know)
  if (state?.doesNotKnow?.length > 0) {
    lines.push(`  Doesn't know: ${state.doesNotKnow.slice(0, 2).join("; ")}`)
  }

  return lines.join("\n")
}

function formatSetting(worldBible: any, settingName: string): string | null {
  const locations = worldBible?.locations ?? []
  const match = locations.find(
    (l: any) => l.name.toLowerCase().includes(settingName.toLowerCase()) ||
         settingName.toLowerCase().includes(l.name.toLowerCase())
  )
  if (!match) return null

  let section = `SETTING: ${match.name}`
  if (match.description) section += `\n${match.description}`
  if (match.sensoryDetails) section += `\nSensory: ${match.sensoryDetails}`
  return section
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
