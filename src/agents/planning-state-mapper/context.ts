import type { SeedInput, SceneBeat } from "../../types"
import type { WorldBible } from "../world-builder/schema"
import type { CharacterProfile } from "../character-agent/schema"
import type { StorySpine } from "../plotter/schema"
import type { ChapterOutline } from "../planning-plotter/schema"
import { renderDirectivesForPlanner } from "../../schemas/planning-directives"
import { resolveStructuralPriors, renderStructuralPriorsForPlanner } from "../../models/roles"
import {
  resolvePlanningMaterialPressureV1,
  resolvePlanningSceneTurnShapingV1,
  resolveScenePlanContractV1,
} from "../../config/pipeline"

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

function renderSceneEntryLine(scene: SceneBeat, index: number): string {
  const chars = scene.characters?.length ? scene.characters.join(", ") : "none listed"
  const soft: string[] = []
  if (scene.valueShifted !== undefined) soft.push(`valueShifted=${scene.valueShifted}`)
  if (scene.gapPresent !== undefined) soft.push(`gapPresent=${scene.gapPresent}`)
  if (scene.lifeValueAxes?.length) soft.push(`lifeValueAxes=${scene.lifeValueAxes.join("/")}`)
  if (scene.miceActive?.length) soft.push(`miceActive=${scene.miceActive.join("/")}`)
  if (scene.miceOpens?.length) soft.push(`miceOpens=${scene.miceOpens.join("/")}`)
  if (scene.miceCloses?.length) soft.push(`miceCloses=${scene.miceCloses.join("/")}`)
  const idTag = scene.beatId ? ` [${scene.beatId}]` : ""
  return `  ${index}.${idTag} [${scene.kind}] chars: ${chars}${soft.length ? ` (${soft.join(", ")})` : ""}\n     ${scene.description}`
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

  const sceneSection = `SCENE ENTRIES TO MAP (0-based indexes; do not rewrite descriptions):\n${scenes.map(renderSceneEntryLine).join("\n")}`

  const directivesSection = seed.directives ? renderDirectivesForPlanner(seed.directives) : ""
  const priors = resolveStructuralPriors(seed.genre)
  const structuralSection = priors ? renderStructuralPriorsForPlanner(priors) : ""

  const scenePlanContractSection = renderStateMapperScenePlanContractGuidance(
    resolveScenePlanContractV1(seed.pipelineOverrides),
  )
  const selectiveSceneTurnSection = renderStateMapperSelectiveSceneTurnGuidance(
    resolvePlanningSceneTurnShapingV1(seed.pipelineOverrides),
    resolveScenePlanContractV1(seed.pipelineOverrides),
  )
  const materialPressureSection = renderStateMapperMaterialPressureGuidance(
    resolvePlanningMaterialPressureV1(seed.pipelineOverrides),
    resolveScenePlanContractV1(seed.pipelineOverrides),
  )

  return `Genre: ${seed.genre}\nPremise: ${seed.premise}\n\n${worldSection}\n\n${charSection}\n\n${spineSection}\n\n${allSkelSection}${priorSection}\n\n${targetSection}\n\n${sceneSection}${directivesSection}${structuralSection}${scenePlanContractSection}${selectiveSceneTurnSection}${materialPressureSection}\n\nMap Chapter ${targetChapter.chapterNumber}'s end-of-chapter state and writer-visible scene obligations onto the existing scene-entry list.`
}

// L096 Slice 1: scene-plan-contract guidance for the state mapper. Off-flag
// emits an empty string and the mapper prompt is unchanged. On-flag adds two
// instructions: every obligation needs a `materialityTest`; the wider
// `storyDebtStage` enum (now seven values) is available for use.
function renderStateMapperScenePlanContractGuidance(enabled: boolean): string {
  if (!enabled) return ""
  return `

SCENE PLAN CONTRACT (scenePlanContractV1):
- Every scene obligation MUST include a "materialityTest" string. The materialityTest names how the exact source ID changes choice, cost, constraint, relationship state, outcome, or future pressure. Example: "Ledger gives Orvath leverage Calla cannot ignore." Generic restatements of the obligation text are not sufficient.
- "storyDebtStage" accepts seven values: open, progress, complicate, partial_payoff, final_payoff, aftermath, escalation.
  - Use "complicate" when an obligation deepens the story debt with new opposition or cost without paying it off.
  - Use "escalation" when later pressure builds on a prior final_payoff (the debt was paid; this is the aftermath/escalation curve).
  - Reserve "final_payoff" for when this scene truly resolves the parent story debt for the sequence, not for local chapter landings.
  - Use "partial_payoff", "aftermath", or "escalation" for chapter-local landings that should not close the parent debt.
- When an obligation carries "payoffId", set a unique "payoffEventId" naming the concrete local payoff event (e.g. "evt-script-burn-final-ch01"). Do not set payoffEventId on open/progress/complicate stages, and do not set it without the parent payoffId.
- The mapper still does not invent thread/promise/payoff IDs. Only emit these refs when the upstream story debt or payoff explicitly provides them.`
}

function renderStateMapperSelectiveSceneTurnGuidance(enabled: boolean, scenePlanContractV1: boolean): string {
  if (!enabled || scenePlanContractV1) return ""
  return `

SELECTIVE SCENE-TURN SHAPING (planningSceneTurnShapingV1):
- When a scene has optional goal/opposition/outcome/consequence/povPersonalStake fields, map facts, knowledge changes, and character-state changes onto obligations that make those fields operational in drafting.
- Prefer one to three source-refed obligations per scene. Each obligation should pressure a choice, constrain action, alter the outcome, make a character materially active, or create the endpoint consequence.
- Do not add obligations for decorative context. If a fact or character does not change the turn, leave it out of writer-visible obligations.
- Preserve exact source IDs and character IDs so scene semantic lows can trace endpoint, character materiality, and world pressure back to the plan.`
}

function renderStateMapperMaterialPressureGuidance(enabled: boolean, scenePlanContractV1: boolean): string {
  if (!enabled || scenePlanContractV1) return ""
  return `

MATERIAL PRESSURE (planningMaterialPressureV1):
- For non-final scenes, every selected source-refed fact, knowledge, or state obligation should include "materialityTest".
- The materialityTest must state how that source changes this scene's choice, constraint, tactic, relationship behavior, outcome, or future pressure.
- Keep it compact and concrete. Do not add new obligations to satisfy this; only annotate obligations already selected because they materially affect the scene turn.
- Prefer notes that make a character active or a world rule costly on page, not generic restatements of the source text.`
}
