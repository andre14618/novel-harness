import type { SeedInput } from "../../types"
import type { WorldBible } from "../world-builder/schema"
import type { CharacterProfile } from "../character-agent/schema"
import type { StorySpine } from "../plotter/schema"
import type { ChapterOutline } from "../planning-plotter/schema"
import { renderDirectivesForPlanner } from "../../schemas/planning-directives"
import { resolveStructuralPriors, renderStructuralPriorsForPlanner } from "../../models/roles"
import { planningBeatCountPolicy } from "../../harness/beat-counts"
import {
  resolveNativePlanningContractV1,
  resolvePlanningSceneTurnShapingV1,
  resolveScenePlanContractV1,
} from "../../config/pipeline"

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
  const scenePlanContractV1 = resolveScenePlanContractV1(seed.pipelineOverrides)
  const planningSceneTurnShapingV1 = resolvePlanningSceneTurnShapingV1(seed.pipelineOverrides)
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

${renderChapterScopeGuidance(beatPolicy, scenePlanContractV1)}
${renderNativePlanningContractGuidance(beatPolicy, resolveNativePlanningContractV1(seed.pipelineOverrides))}${renderSelectiveSceneTurnGuidance(planningSceneTurnShapingV1, scenePlanContractV1)}${renderScenePlanContractGuidance(scenePlanContractV1)}`

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

function renderChapterScopeGuidance(
  policy: ReturnType<typeof planningBeatCountPolicy>,
  scenePlanContractV1: boolean,
): string {
  const countGuide = scenePlanContractV1
    ? `- Recommended scene contracts for this chapter size: around ${policy.recommendedBeats}. This is advisory; content scope and chapter purpose decide the actual count.`
    : `- Recommended story-turn entries for this chapter size: ${policy.recommendedBeats}; minimum structural floor: ${policy.minRecommendedBeats}.`
  return `Chapter scope guidance:
- Target words are a rough chapter-size signal, not a prose quota. Do not solve pacing by asking the writer to hit a number.
${countGuide}
- Scope by content load: each entry should have one continuous time/location frame, one main pressure or opposition, one dominant turn or choice, and one outcome/consequence pair.
- Do not pack multiple full scenes, set pieces, investigations, confrontations, or reveals into one entry. If the skeleton purpose demands more story than fits, preserve the endpoint/hook and choose the load-bearing movement; leave secondary material for adjacent chapters or a later planning revision.
${renderBeatCapGuidance(policy, scenePlanContractV1)}`
}

function renderBeatCapGuidance(policy: ReturnType<typeof planningBeatCountPolicy>, scenePlanContractV1: boolean): string {
  if (policy.effectiveMaxBeats !== null) {
    const floorNote = policy.capRaisedToFloor
      ? scenePlanContractV1
        ? ""
        : ` Configured cap ${policy.configuredMaxBeats} is below the calibrated floor, so ${policy.effectiveMaxBeats} is the effective cap.`
      : ""
    const effectiveMax = scenePlanContractV1 ? policy.configuredMaxBeats ?? policy.effectiveMaxBeats : policy.effectiveMaxBeats
    return `Planning max override: ${effectiveMax} entries.${floorNote} Do not exceed this explicit cap.`
  }
  return `Do not exceed recommended scope by more than 1 entry unless the chapter truly contains multiple distinct set pieces. If it does, prefer moving material across chapters over packing oversized entries.`
}

function renderNativePlanningContractGuidance(
  policy: ReturnType<typeof planningBeatCountPolicy>,
  enabled: boolean,
): string {
  if (!enabled) return ""
  return `
Native planning contract: Author about ${policy.recommendedBeats} complete story-turn entries for this chapter, sized by dramatic load rather than by a word-count quota. Each entry must carry a concrete pressure, choice, reveal, reversal, or consequence. When the entry turns on the POV's motive or choice, include povPersonalStake naming the specific want, need, fear, lie, truth, wound, oath, shame, or relationship pressure that makes the action matter. Do not emit micro-actions, transit-only entries, oversized packed entries, or bullet-list summaries. The final entry must preserve the chapter endpoint/hook named in the skeleton purpose.`
}

// L106/L107 follow-on evidence control. This is narrower than the full
// scenePlanContractV1 prompt: it lets a production planner expose the minimum
// turn fields the writer can use, without forcing every entry into a templated
// plot builder or adding blocking validation.
function renderSelectiveSceneTurnGuidance(enabled: boolean, scenePlanContractV1: boolean): string {
  if (!enabled || scenePlanContractV1) return ""
  return `

Selective scene-turn shaping (planningSceneTurnShapingV1):
This flag is active. It is not the full scenePlanContractV1 template, but the final entry MUST include "outcome" and "consequence"; the planner will retry if those endpoint fields are missing.
- Populate the final entry's "outcome" and "consequence" so the chapter endpoint/hook lands through an on-page action, reveal, refusal, concession, or changed status with an immediate external effect.
- Use other optional scene-turn fields only when they clarify a load-bearing entry. Do not tag background, transit, or decorative setup just because a field exists.
- For entries driven by a concrete decision or pressure turn, populate "goal", "opposition", "turningPoint", "outcome", "consequence", and "povPersonalStake". Add "crisisChoice" and two "choiceAlternatives" only when there is a real tradeoff the prose should dramatize.
- If a world fact, rule, debt, location constraint, or supporting character is load-bearing, make it constrain the goal, opposition, outcome, or consequence. Do not add standalone labels for context that does not change the turn.
- Keep each scene description concise and playable. The optional fields should sharpen endpoint, character materiality, and world pressure; they must not duplicate the description or inflate the entry with generic theory.
- Omit optional scene-turn fields on simple connective entries unless the entry creates a new observable cost, deadline, debt, threat, or relationship state.`
}

// L096 Slice 1: scene plan contract guidance, gated by `scenePlanContractV1`.
// Source: POC `corpus-recreation-poc.ts` causal-motivation-v3 prompt language
// (lines 1234-1307 / 1454-1493). Treat each beat-list entry as a scene
// contract: declare the dramatic shape the writer must satisfy, with explicit
// choice alternatives and an externally observable consequence. Default off;
// when off this function emits an empty string and the planner sees the
// existing native-planning prompt unchanged.
function renderScenePlanContractGuidance(enabled: boolean): string {
  if (!enabled) return ""
  return `

Scene plan contract (scenePlanContractV1):
Each entry in "scenes" is a scene contract — a complete dramatic unit, not a micro-beat. For every entry, ALSO emit these optional scene-contract fields:
- "temporalAnchor": the explicit time frame the writer and checkers must preserve (e.g. "dawn the next morning"). Use this when timing matters; do not rely only on description prose.
- "placeAnchor": the explicit location/arena frame the writer and checkers must preserve (e.g. "Iron Bridge"). Use this when place matters; do not rely only on description prose.
- "goal": the protagonist's concrete scene-level goal in this entry.
- "opposition": who or what opposes the goal in this entry.
- "turningPoint": the moment the entry's dominant value flips or the protagonist commits.
- "crisisChoice": the specific choice the protagonist must make at the turning point.
- "choiceAlternatives": an array of at least TWO concrete options the protagonist could take, each tied to a want, need, lie, truth, fear, oath, or relationship pressure.
- "outcome": what actually happens at the end of the entry as a result of the crisis choice.
- "consequence": the externally observable downstream pressure or change the outcome creates. The consequence must NOT simply restate the outcome; it must be observable in dialogue, action, body language, world state, or relationship state. Internal-only realisation is not a consequence.
- "valueIn" and "valueOut": the dominant value at the start and end of the entry (e.g. "compliance" → "rupture", "ignorance" → "knowledge").
- "povPersonalStake": the personal pressure behind the crisis choice — the specific want, need, fear, lie, truth, wound, oath, shame, or relationship pressure that makes the choice matter to this POV.
- "beatHints" (optional): an array of internal annotation beats inside the scene. Each hint declares "kind" (action|dialogue|interiority|description), "boundarySignal", "gapSize", and "purpose". Beat hints are annotation only; the writer does not see them as separate calls.

Scene-scope discipline:
- The scene contract controls how much story the writer is being asked to draft. Do not rely on per-scene word targets to correct over-scoped asks.
- One scene contract should contain one protagonist goal, one main opposition source, one dominant turn/crisis choice, and one immediate outcome/consequence. If an entry needs two goals, two locations, two confrontations, or multiple unrelated reveals, split or move material.
- Keep obligation load realistic for one scene. Prefer one to three load-bearing facts/knowledge/state movements. If a scene needs more, the chapter plan is probably over-packed.
- If a short chapter purpose contains enough content for several full scenes, reduce the chapter movement to its essential turn while preserving the endpoint/hook. Do not cram the whole skeleton purpose into dense scene contracts.
- Spend the scene's limited scope on executing the endpoint. Avoid setup-only, transit-only, and delayed-decision entries unless the entry's consequence shows a new external cost, deadline, debt, threat, or relationship state before the scene exits.

Causal-motivation-v3 expectations:
- The crisis choice must be motive-caused, not arbitrary. The povPersonalStake and choiceAlternatives must show why this protagonist (not a generic protagonist) is forced to choose under this pressure.
- Choice alternatives must each carry a concrete tradeoff: gain vs cost, want vs need, oath vs survival, etc.
- World facts and supporting characters are operational pressure, not background. If a world fact or character is named in the entry, it must constrain the choice or alter the outcome.
- The consequence must create future pressure (a new obligation, threat, debt, or relationship shift) that the next entry or chapter can build on.
- The endpoint must land inside the current entry through the existing outcome/consequence pair. Do not make the endpoint a promised later confrontation, an intention to investigate, or an unanswered order unless the current entry also shows the immediate consequence that changes the next entry's starting conditions.

If you cannot honour these fields for a given entry, omit the optional fields rather than emitting placeholder text. Empty string consequences and one-option choiceAlternatives are validator failures.

Worked example of a complete scene-contract entry (do not copy literal content; copy the SHAPE):

\`\`\`json
{
  "description": "Calla confronts Orvath in the empty archive.",
  "characters": ["Calla", "Orvath"],
  "kind": "dialogue",
  "temporalAnchor": "after closing",
  "placeAnchor": "empty archive",
  "goal": "Force Orvath to confess his deal with the empire.",
  "opposition": "Orvath holds Davan's safety as leverage and will use it.",
  "turningPoint": "Calla realises she has been the leverage all along.",
  "crisisChoice": "Trade the script for Davan's safety, or burn it and force a public reckoning.",
  "choiceAlternatives": [
    "Hand the script over and accept Orvath's protection — preserves Davan but cements the empire's grip.",
    "Burn the script and force Orvath into a public reckoning — costs Davan but breaks the leverage."
  ],
  "outcome": "Calla burns the script.",
  "consequence": "Davan is publicly exiled and the empire begins hunting Calla.",
  "valueIn": "compliance",
  "valueOut": "rupture",
  "povPersonalStake": "Calla cannot let Davan be reduced to leverage again — she carries the oath she swore at her mother's grave.",
  "valueShifted": true,
  "gapPresent": true,
  "lifeValueAxes": ["ethics", "relational"],
  "miceCloses": ["I"]
}
\`\`\`

Compliance rules (validator will fail without these — fix every line before returning):

1. If you write a non-empty crisisChoice on an entry, that entry MUST be a real scene with at least one supporting-character / world-fact / story-debt obligation grounding the choice. If the entry is transit/establishment with no grounded crisis, leave crisisChoice empty (omit the field).
2. choiceAlternatives MUST be a non-empty array of at least TWO entries when the field is present. Every option is a complete sentence describing a concrete action and its tradeoff.
3. consequence MUST describe externally observable downstream pressure that is different from outcome. "Calla burns the script" + "Calla burns the script" is invalid; "Calla burns the script" + "Davan is publicly exiled" is valid.
4. povPersonalStake MUST name the specific personal pressure (oath, fear, wound, lie, truth, relationship debt) — generic motives like "do the right thing" or "survive" will be rejected.
5. outcome/consequence MUST execute a visible action/reveal/refusal/commitment on the page; "she considers", "she waits", "she intends", or "she asks for more time" is insufficient without an immediate external cost.
6. valueIn and valueOut should be short value labels (one or two words) describing the polarity of the dominant value at the start and end of the entry.`
}
