import type { SeedInput } from "../../types"
import type { WorldBible } from "../world-builder/schema"
import type { CharacterProfile } from "../character-agent/schema"
import type { StorySpine } from "../plotter/schema"
import type { ChapterOutline } from "../planning-plotter/schema"
import { renderDirectivesForPlanner } from "../../schemas/planning-directives"
import { resolveStructuralPriors, renderStructuralPriorsForPlanner } from "../../models/roles"

function renderSkeletonLine(sk: ChapterOutline): string {
  const chars = sk.charactersPresent?.length ? ` [${sk.charactersPresent.join(", ")}]` : ""
  return `  Ch ${sk.chapterNumber}: "${sk.title}" — POV: ${sk.povCharacter} — ${sk.setting} — ${sk.targetWords}w\n    Purpose: ${sk.purpose}${chars}`
}

function renderPriorState(sk: ChapterOutline): string {
  if (!sk.characterStateChanges?.length && !sk.establishedFacts?.length) return ""
  const state = sk.characterStateChanges.map(s =>
    `    - ${s.name}: at ${s.location || "?"}, ${s.emotionalState || "?"}${s.knows.length ? `; knows: ${s.knows.join(", ")}` : ""}`
  ).join("\n")
  const facts = sk.establishedFacts.map(f => `    - [${f.category}] ${f.fact}`).join("\n")
  return `  Ch ${sk.chapterNumber} end-state:\n${state}${facts ? `\n  Facts established:\n${facts}` : ""}`
}

export interface BeatExpansionArgs {
  targetChapter: ChapterOutline       // skeleton only at call time
  allSkeletons: ChapterOutline[]      // full skeleton list for cross-chapter context
  priorChapters: ChapterOutline[]     // already-expanded chapters (with beats/state)
  worldBible: WorldBible
  characters: CharacterProfile[]
  spine: StorySpine
  seed: SeedInput
}

export function buildContext(args: BeatExpansionArgs): string {
  const { targetChapter, allSkeletons, priorChapters, worldBible, characters, spine, seed } = args

  const worldSection = `WORLD BIBLE:
Setting: ${worldBible.setting}
Rules:
${worldBible.rules.map(r => `- ${r}`).join("\n")}
Locations:
${worldBible.locations.map(l => `- ${l.name}: ${l.description}${l.sensoryDetails ? ` [${l.sensoryDetails}]` : ""}`).join("\n")}`

  const charSection = `CHARACTERS:
${characters.map(c =>
  `- ${c.name} (${c.role}) — ${c.traits.join(", ")}\n  Speech: ${c.speechPattern}\n  Goals: ${c.goals}  Fears: ${c.fears}`
).join("\n")}`

  const spineSection = `STORY SPINE:
Central Conflict: ${spine.centralConflict}
Theme: ${spine.theme}
Ending Direction: ${spine.endingDirection}`

  const allSkelSection = `ALL CHAPTER SKELETONS (for cross-chapter awareness):
${allSkeletons.map(renderSkeletonLine).join("\n")}`

  const priorSection = priorChapters.length
    ? `\n\nPRIOR CHAPTERS (already expanded — state at their end):\n${priorChapters.map(renderPriorState).filter(Boolean).join("\n\n")}`
    : ""

  const targetSection = `THIS CHAPTER TO EXPAND:
Chapter ${targetChapter.chapterNumber}: "${targetChapter.title}"
POV: ${targetChapter.povCharacter}
Setting: ${targetChapter.setting}
Purpose: ${targetChapter.purpose}
Target words: ${targetChapter.targetWords}
Characters present: ${(targetChapter.charactersPresent ?? []).join(", ")}

Minimum beats required: ${Math.max(3, Math.ceil(targetChapter.targetWords / 150))} (each beat produces ~100-140 words of prose in the writer).
Recommended: ${Math.max(3, Math.ceil(targetChapter.targetWords / 120))} beats to comfortably hit the target.`

  const directivesSection = seed.directives ? renderDirectivesForPlanner(seed.directives) : ""
  const priors = resolveStructuralPriors(seed.genre)
  const structuralSection = priors ? renderStructuralPriorsForPlanner(priors) : ""

  return `Genre: ${seed.genre}
Premise: ${seed.premise}

${worldSection}

${charSection}

${spineSection}

${allSkelSection}${priorSection}

${targetSection}${directivesSection}${structuralSection}

Expand Chapter ${targetChapter.chapterNumber} into its beat sequence only. Do not emit chapter-level state or beat obligations; the state mapper assigns those in the next planning step.`
}
