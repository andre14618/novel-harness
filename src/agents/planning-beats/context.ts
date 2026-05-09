import type { SeedInput } from "../../types"
import type { WorldBible } from "../world-builder/schema"
import type { CharacterProfile } from "../character-agent/schema"
import type { StorySpine } from "../plotter/schema"
import type { ChapterOutline } from "../planning-plotter/schema"
import { renderDirectivesForPlanner } from "../../schemas/planning-directives"
import { resolveStructuralPriors, renderStructuralPriorsForPlanner } from "../../models/roles"
import { planningBeatCountPolicy } from "../../harness/beat-counts"
import { resolveNativePlanningContractV1 } from "../../config/pipeline"

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
  retryFeedback?: string
}

export function buildContext(args: BeatExpansionArgs): string {
  const { targetChapter, allSkeletons, priorChapters, worldBible, characters, spine, seed, retryFeedback } = args
  const beatPolicy = planningBeatCountPolicy(
    targetChapter.targetWords,
    seed.pipelineOverrides?.planningMaxBeatsPerChapter,
  )

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

Minimum beats required: ${beatPolicy.minRecommendedBeats} (current writer usually produces ~300-450 words per planned beat).
${renderBeatCapGuidance(beatPolicy)}
${renderNativePlanningContractGuidance(beatPolicy, resolveNativePlanningContractV1(seed.pipelineOverrides))}`

  const directivesSection = seed.directives ? renderDirectivesForPlanner(seed.directives) : ""
  const priors = resolveStructuralPriors(seed.genre)
  const structuralSection = priors ? renderStructuralPriorsForPlanner(priors) : ""

  return `Genre: ${seed.genre}
Premise: ${seed.premise}

${worldSection}

${charSection}

${spineSection}

${allSkelSection}${priorSection}

${targetSection}${directivesSection}${structuralSection}${retryFeedback ? `\n\n--- PREVIOUS BEAT EXPANSION FAILED ---\n${retryFeedback}\nFix this by authoring native story-turn beats for the same chapter contract. Do not drop the endpoint or hide discarded beats inside one run-on description.` : ""}

Expand Chapter ${targetChapter.chapterNumber} into its beat sequence only. Do not emit chapter-level state or beat obligations; the state mapper assigns those in the next planning step.`
}

function renderBeatCapGuidance(policy: ReturnType<typeof planningBeatCountPolicy>): string {
  if (policy.effectiveMaxBeats !== null) {
    const floorNote = policy.capRaisedToFloor
      ? ` Configured cap ${policy.configuredMaxBeats} is below the calibrated floor, so ${policy.effectiveMaxBeats} is the effective cap.`
      : ""
    return `Recommended: ${policy.recommendedBeats} beats. Planning max override: ${policy.effectiveMaxBeats} beats.${floorNote} Do not exceed this cap.`
  }
  return `Recommended: ${policy.recommendedBeats} beats. Do not exceed recommended by more than 1 unless the chapter has multiple distinct set pieces.`
}

function renderNativePlanningContractGuidance(
  policy: ReturnType<typeof planningBeatCountPolicy>,
  enabled: boolean,
): string {
  if (!enabled) return ""
  return `
Native planning contract: Author exactly ${policy.recommendedBeats} complete story-turn beats for this chapter. Each beat should be large enough to draft into roughly 300-450 words and must carry a concrete pressure, choice, reveal, reversal, or consequence. When the beat turns on the POV's motive or choice, include povPersonalStake naming the specific want, need, fear, lie, truth, wound, oath, shame, or relationship pressure that makes the action matter. Do not emit micro-actions, transit-only beats, or packed bullet lists. The final beat must preserve the chapter endpoint/hook named in the skeleton purpose.`
}
