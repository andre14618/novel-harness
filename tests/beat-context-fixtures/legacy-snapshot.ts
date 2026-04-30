/**
 * FROZEN snapshot of buildBeatContext as it existed at the start of D1
 * (commit just prior to the typed-slot refactor).
 *
 * This file is test-only — never imported from src/. Its sole purpose is to
 * serve as the regression baseline for tests/beat-context-parity.test.ts.
 *
 * Per Codex round-3 Q2 the snapshot stays in the suite long-term so any
 * future refactor of buildBeatContext (which now composes a typed-slot
 * builder + pure renderer) can re-prove byte-equivalence against the
 * pre-refactor behavior.
 *
 * Do NOT modify the algorithm here unless you are intentionally retiring
 * the parity gate. Bug fixes to the live behavior should be made in
 * src/agents/writer/beat-context.ts (and split between slot builder and
 * renderer); the parity test will then flag the divergence and the fix
 * needs to be backported here in a separate, deliberate commit.
 */

import { getRelationshipBetween } from "../../src/db"
import { resolveReferences, type ResolvedReferences } from "../../src/agents/writer/reference-resolver"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../src/types"

// ── FROZEN COPY of pickExampleLineSubset ─────────────────────────────────
// This is the snapshot baseline. It is intentionally a hand-copy of the
// production helper (src/agents/writer/example-line-subset.ts at the time
// of the D1 typed-slot refactor). It MUST NOT import the production
// implementation — that would defeat the parity gate by letting the legacy
// "before" mutate alongside the live "after". When the production helper
// changes, the parity test will diverge; copy the new behavior here in a
// SEPARATE deliberate commit only if the change is intended to be the new
// baseline.
const _LEGACY_LINE_PRESETS_5: Record<"preset-a" | "preset-b" | "preset-c", number[]> = {
  "preset-a": [0, 1, 2],
  "preset-b": [0, 3, 4],
  "preset-c": [1, 3, 4],
}
const _LEGACY_LINE_PRESETS_4: Record<"preset-a" | "preset-b" | "preset-c", number[]> = {
  "preset-a": [0, 1, 2],
  "preset-b": [0, 1, 3],
  "preset-c": [1, 2, 3],
}
const _LEGACY_PRESET_CYCLE: Array<"preset-a" | "preset-b" | "preset-c"> = ["preset-a", "preset-b", "preset-c"]

function pickExampleLineSubset(
  lines: string[],
  chapterNumber: number,
  beatIndex: number,
  conditioning: "fixed" | "rotation" | undefined,
): string[] {
  if (conditioning === undefined) return lines.slice(0, 5)
  if (lines.length < 4) return lines.slice(0, 5)
  const presetFamily = lines.length >= 5 ? _LEGACY_LINE_PRESETS_5 : _LEGACY_LINE_PRESETS_4
  if (conditioning === "fixed") {
    return presetFamily["preset-a"]
      .map(i => lines[i])
      .filter((v): v is string => typeof v === "string")
  }
  const presetIdx = (chapterNumber * 100 + beatIndex) % 3
  const preset = _LEGACY_PRESET_CYCLE[presetIdx]
  return presetFamily[preset]
    .map(i => lines[i])
    .filter((v): v is string => typeof v === "string")
}

export interface BeatContextInputLegacy {
  novelId: string
  chapterNumber: number
  beatIndex: number
  previousBeatProse?: string
  outline: ChapterOutline
  characters: CharacterProfile[]
  characterStates: any[]
  worldBible: any
  preResolvedRefs?: ResolvedReferences
  compactMode?: boolean
  genre?: string
}

export interface BeatContextResultLegacy {
  userPrompt: string
  targetWords: number
}

export async function buildBeatContextLegacy(input: BeatContextInputLegacy): Promise<BeatContextResultLegacy> {
  const { novelId, chapterNumber, beatIndex, previousBeatProse, outline, characters, characterStates, worldBible } = input
  const conditioning = resolveConditioningOverride()
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
      const lines = beatChars.flatMap(c => {
        const entry = [`${c.name}:`]
        if (c.speechPattern) entry.push(`  Voice: ${c.speechPattern}`)
        if (c.goals) entry.push(`  Drives: ${c.goals}`)
        if (c.avoids) entry.push(`  Avoids: ${c.avoids}`)
        if (c.internalConflict) entry.push(`  Conflict: ${c.internalConflict}`)
        if (c.exampleLines && c.exampleLines.length > 0) {
          entry.push(`  Example voiced lines:`)
          pickExampleLineSubset(c.exampleLines, chapterNumber, beatIndex, conditioning).forEach((line, i) => {
            entry.push(`    ${i + 1}. "${line.replace(/^"|"$/g, "")}"`)
          })
        }
        return [...entry, ""]
      })
      while (lines.length && lines[lines.length - 1] === "") lines.pop()
      sections.push(`CHARACTERS:\n${lines.join("\n")}`)
    } else {
      const snapshots = await Promise.all(beatChars.map(c =>
        formatCharacterSnapshot(novelId, c, povChar, chapterNumber, beatIndex, characterStates, conditioning)
      ))
      sections.push(`CHARACTERS:\n${snapshots.join("\n\n")}`)
    }
  }

  // ── 5. Resolved references ─────────────────────────────────────────────
  const refs = input.preResolvedRefs ?? await resolveReferences(beat, outline, novelId, chapterNumber, characters)
  if (refs.context) sections.push(refs.context)

  // ── 6. Setting ────────────────────────────────────────────────────────
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

function resolveConditioningOverride(): "fixed" | "rotation" | undefined {
  const raw = process.env.WRITER_CONDITIONING
  return raw === "fixed" || raw === "rotation" ? raw : undefined
}

function formatBeatSpec(beat: SceneBeat, outline: ChapterOutline, beatIndex: number): string {
  const lines = [
    `BEAT ${beatIndex + 1} of ${outline.scenes.length}`,
    `POV: ${outline.povCharacter}`,
    `Setting: ${outline.setting}`,
    `Kind: ${beat.kind ?? "action"}`,
    ``,
    beat.description,
  ]
  if (beat.characters.length > 0) {
    lines.push(`Characters present: ${beat.characters.join(", ")}`)
  }

  const facts = outline.establishedFacts ?? []
  const factById = new Map(facts.filter(f => f.id).map(f => [f.id, f.fact]))

  const seeds = beat.requiredPayoffs ?? []
  if (seeds.length > 0) {
    const setupLines = seeds.map(p => {
      const fact = factById.get(p.fact_id) ?? `[fact_id=${p.fact_id}]`
      return `  - "${fact}" (lands at beat ${p.payoff_beat + 1})`
    }).join("\n")
    lines.push("", "SEEDS (this beat must set up):", setupLines)
  }

  const due: { fact: string; seededAtBeat: number }[] = []
  for (let i = 0; i < beatIndex; i++) {
    for (const link of outline.scenes[i]?.requiredPayoffs ?? []) {
      if (link.payoff_beat === beatIndex) {
        due.push({
          fact: factById.get(link.fact_id) ?? `[fact_id=${link.fact_id}]`,
          seededAtBeat: i,
        })
      }
    }
  }
  if (due.length > 0) {
    const payoffLines = due.map(d => `  - "${d.fact}" (seeded in beat ${d.seededAtBeat + 1})`).join("\n")
    lines.push("", "PAYOFFS DUE (this beat must realize):", payoffLines)
  }

  return lines.join("\n")
}

async function formatCharacterSnapshot(
  novelId: string, char: CharacterProfile, povChar: CharacterProfile | undefined,
  chapterNumber: number, beatIndex: number, characterStates: any[],
  conditioning: "fixed" | "rotation" | undefined,
): Promise<string> {
  const lines: string[] = [`${char.name}:`]

  if (char.speechPattern) lines.push(`  Voice: ${char.speechPattern}`)

  if (char.goals) lines.push(`  Drives: ${char.goals}`)
  if (char.avoids) lines.push(`  Avoids: ${char.avoids}`)
  if (char.internalConflict) lines.push(`  Conflict: ${char.internalConflict}`)

  const state = characterStates.find(
    cs => cs.characterId === char.id || cs.characterId?.toLowerCase() === char.name.toLowerCase()
  )
  if (state?.emotionalState) lines.push(`  State: ${state.emotionalState}`)

  if (povChar && char.id !== povChar.id) {
    try {
      const rel = await getRelationshipBetween(novelId, povChar.id, char.id, chapterNumber)
      if (rel) {
        lines.push(`  With ${povChar.name}: [${rel.trustLevel}] ${rel.dynamic}`)
        if (rel.tension) lines.push(`    Tension: ${rel.tension}`)
      }
    } catch { /* no relationship data yet */ }
  }

  if (state?.doesNotKnow?.length > 0) {
    lines.push(`  Doesn't know: ${state.doesNotKnow.slice(0, 2).join("; ")}`)
  }

  if (char.exampleLines && char.exampleLines.length > 0) {
    lines.push(`  Example voiced lines:`)
    pickExampleLineSubset(char.exampleLines, chapterNumber, beatIndex, conditioning).forEach((line, i) => {
      lines.push(`    ${i + 1}. "${line.replace(/^"|"$/g, "")}"`)
    })
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
  const sentences = prose.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0)
  if (sentences.length === 0) return null
  return sentences.slice(-count).join(" ")
}

function beatHasLocationChange(beat: SceneBeat, outline: ChapterOutline): boolean {
  const desc = beat.description.toLowerCase()
  const setting = outline.setting.toLowerCase()
  const locationWords = ["enters", "arrives at", "walks to", "goes to", "reaches", "steps into", "moves to"]
  return locationWords.some(w => desc.includes(w)) && !desc.includes(setting)
}
