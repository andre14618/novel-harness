import type { SeedInput, SceneBeat } from "../../types"
import type { WorldBible } from "../world-builder/schema"
import type { CharacterProfile } from "../character-agent/schema"
import type { StorySpine } from "../plotter/schema"
import type { ChapterOutline } from "../planning-plotter/schema"
import { renderDirectivesForPlanner } from "../../schemas/planning-directives"
import { resolveStructuralPriors, renderStructuralPriorsForPlanner } from "../../models/roles"

export interface StateMapperContextArgs {
  targetChapter: ChapterOutline
  allSkeletons: ChapterOutline[]
  priorChapters: ChapterOutline[]
  scenes: SceneBeat[]
  worldBible: WorldBible
  characters: CharacterProfile[]
  spine: StorySpine
  seed: SeedInput
}

function renderSkeletonLine(sk: ChapterOutline): string {
  const chars = sk.charactersPresent?.length ? ` [${sk.charactersPresent.join(", ")}]` : ""
  return `  Ch ${sk.chapterNumber}: "${sk.title}" -- POV: ${sk.povCharacter} -- ${sk.setting} -- ${sk.targetWords}w\n    Purpose: ${sk.purpose}${chars}`
}

function renderPriorState(sk: ChapterOutline): string {
  if (!sk.characterStateChanges?.length && !sk.establishedFacts?.length) return ""
  const state = sk.characterStateChanges.map(s =>
    `    - ${s.name}: at ${s.location || "?"}, ${s.emotionalState || "?"}${s.knows.length ? `; knows: ${s.knows.join(", ")}` : ""}`
  ).join("\n")
  const facts = sk.establishedFacts.map(f => `    - [${f.category}] ${f.fact}`).join("\n")
  return `  Ch ${sk.chapterNumber} end-state:\n${state}${facts ? `\n  Facts established:\n${facts}` : ""}`
}

function renderBeatLine(beat: SceneBeat, index: number): string {
  const chars = beat.characters?.length ? beat.characters.join(", ") : "none listed"
  const soft: string[] = []
  if (beat.valueShifted !== undefined) soft.push(`valueShifted=${beat.valueShifted}`)
  if (beat.gapPresent !== undefined) soft.push(`gapPresent=${beat.gapPresent}`)
  if (beat.lifeValueAxes?.length) soft.push(`lifeValueAxes=${beat.lifeValueAxes.join("/")}`)
  if (beat.miceActive?.length) soft.push(`miceActive=${beat.miceActive.join("/")}`)
  if (beat.miceOpens?.length) soft.push(`miceOpens=${beat.miceOpens.join("/")}`)
  if (beat.miceCloses?.length) soft.push(`miceCloses=${beat.miceCloses.join("/")}`)
  const idTag = beat.beatId ? ` [${beat.beatId}]` : ""
  return `  ${index}.${idTag} [${beat.kind}] chars: ${chars}${soft.length ? ` (${soft.join(", ")})` : ""}\n     ${beat.description}`
}

export function buildContext(args: StateMapperContextArgs): string {
  const { targetChapter, allSkeletons, priorChapters, scenes, worldBible, characters, spine, seed } = args

  const worldSection = `WORLD BIBLE:\nSetting: ${worldBible.setting}\nRules:\n${worldBible.rules.map(r => `- ${r}`).join("\n")}\nLocations:\n${worldBible.locations.map(l => `- ${l.name}: ${l.description}${l.sensoryDetails ? ` [${l.sensoryDetails}]` : ""}`).join("\n")}`

  const charSection = `CHARACTERS:\n${characters.map(c =>
    `- ${c.name} (${c.role}) -- ${c.traits.join(", ")}\n  Speech: ${c.speechPattern}\n  Goals: ${c.goals}  Fears: ${c.fears}`
  ).join("\n")}`

  const spineSection = `STORY SPINE:\nCentral Conflict: ${spine.centralConflict}\nTheme: ${spine.theme}\nEnding Direction: ${spine.endingDirection}`

  const allSkelSection = `ALL CHAPTER SKELETONS (for cross-chapter awareness):\n${allSkeletons.map(renderSkeletonLine).join("\n")}`

  const priorSection = priorChapters.length
    ? `\n\nPRIOR CHAPTERS (already expanded -- state at their end):\n${priorChapters.map(renderPriorState).filter(Boolean).join("\n\n")}`
    : ""

  const targetSection = `THIS CHAPTER TO MAP:\nChapter ${targetChapter.chapterNumber}: "${targetChapter.title}"\nPOV: ${targetChapter.povCharacter}\nSetting: ${targetChapter.setting}\nPurpose: ${targetChapter.purpose}\nTarget words: ${targetChapter.targetWords}\nCharacters present: ${(targetChapter.charactersPresent ?? []).join(", ")}`

  const beatSection = `BEATS TO MAP (0-based indexes; do not rewrite descriptions):\n${scenes.map(renderBeatLine).join("\n")}`

  const directivesSection = seed.directives ? renderDirectivesForPlanner(seed.directives) : ""
  const priors = resolveStructuralPriors(seed.genre)
  const structuralSection = priors ? renderStructuralPriorsForPlanner(priors) : ""

  return `Genre: ${seed.genre}\nPremise: ${seed.premise}\n\n${worldSection}\n\n${charSection}\n\n${spineSection}\n\n${allSkelSection}${priorSection}\n\n${targetSection}\n\n${beatSection}${directivesSection}${structuralSection}\n\nMap Chapter ${targetChapter.chapterNumber}'s end-of-chapter state and writer-visible beat obligations onto the existing beat list.`
}
