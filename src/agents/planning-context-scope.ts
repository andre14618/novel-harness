import type { CharacterProfile, ChapterOutline, SeedInput, StorySpine, WorldBible } from "../types"
import {
  directiveTextContainsBoundaryTerm,
  planningBoundaryTermsForChapter,
  type ChapterPlanningContract,
} from "../schemas/planning-directives"

export interface ScopedPlanningContext {
  active: boolean
  contracts: ChapterPlanningContract[]
  boundaryTerms: string[]
}

export function resolveScopedPlanningContext(seed: SeedInput, targetChapter: ChapterOutline): ScopedPlanningContext {
  const contracts = seed.directives?.chapterContracts?.filter(
    contract => contract.chapter === targetChapter.chapterNumber,
  ) ?? []
  const boundaryTerms = seed.directives
    ? planningBoundaryTermsForChapter(seed.directives, targetChapter.chapterNumber)
    : []
  return {
    active: contracts.length > 0,
    contracts,
    boundaryTerms,
  }
}

export function renderScopedSeedHeader(seed: SeedInput, targetChapter: ChapterOutline, scope: ScopedPlanningContext): string {
  if (!scope.active) return `Genre: ${seed.genre}\nPremise: ${seed.premise}`
  const contractLines = scope.contracts.map(contract => {
    const parts = [`- Ch ${contract.chapter}${contract.contractId ? ` [${contract.contractId}]` : ""}`]
    if (contract.storyFunction) parts.push(`  Function: ${contract.storyFunction}`)
    if (contract.ownedMovement) parts.push(`  Owned movement: ${contract.ownedMovement}`)
    if (contract.requiredEndpoint) parts.push(`  Required endpoint: ${contract.requiredEndpoint}`)
    return parts.join("\n")
  }).join("\n")
  return `Genre: ${seed.genre}
CHAPTER STORY SCOPE:
Use Chapter ${targetChapter.chapterNumber}'s chapter contract as the source of truth for this step. Broader premise and concept artifacts are continuity reference only; do not stage later chapter meetings, locations, reveals, proofs, or consequences unless this chapter contract owns them.
${contractLines}`
}

export function renderScopedWorldSection(
  worldBible: WorldBible,
  targetChapter: ChapterOutline,
  scope: ScopedPlanningContext,
): string {
  if (!scope.active) {
    return `WORLD BIBLE:
Setting: ${worldBible.setting}
Rules:
${worldBible.rules.map(r => `- ${r}`).join("\n")}
Locations:
${worldBible.locations.map(l => `- ${l.name}: ${l.description}${l.sensoryDetails ? ` [${l.sensoryDetails}]` : ""}`).join("\n")}`
  }

  const allowedTerritory = scope.contracts.flatMap(contract => contract.allowedStoryTerritory ?? [])
  const filteredRules = worldBible.rules.filter(rule =>
    !directiveTextContainsBoundaryTerm(rule, scope.boundaryTerms),
  )
  const filteredLocations = worldBible.locations.filter(location => {
    const text = `${location.name} ${location.description} ${location.sensoryDetails ?? ""}`
    if (directiveTextContainsBoundaryTerm(text, scope.boundaryTerms)) return false
    return isLocationInScope(location.name, targetChapter.setting, allowedTerritory)
  })
  const locationLines = filteredLocations.length
    ? filteredLocations.map(l => `- ${l.name}: ${l.description}${l.sensoryDetails ? ` [${l.sensoryDetails}]` : ""}`).join("\n")
    : `- ${targetChapter.setting || "Target chapter setting"}: Use only the setting named by this chapter; future-only locations are withheld.`
  const ruleLines = filteredRules.length
    ? filteredRules.map(r => `- ${r}`).join("\n")
    : "- Use only rules implied by the target chapter contract; future reveal rules are withheld."

  return `WORLD BIBLE (chapter-scoped reference):
Setting in play: ${targetChapter.setting || worldBible.setting}
Rules in play:
${ruleLines}
Locations in play:
${locationLines}
Future-only world details are omitted from this chapter context.`
}

export function renderScopedCharacterSection(
  characters: CharacterProfile[],
  targetChapter: ChapterOutline,
  scope: ScopedPlanningContext,
): string {
  if (!scope.active) {
    return `CHARACTERS:
${characters.map(c =>
  `- ${c.name} (${c.role}) — ${c.traits.join(", ")}\n  Speech: ${c.speechPattern}\n  Goals: ${c.goals}  Fears: ${c.fears}`
).join("\n")}`
  }

  const presentNames = new Set(
    [targetChapter.povCharacter, ...(targetChapter.charactersPresent ?? [])]
      .map(name => normalizeText(name))
      .filter(Boolean),
  )
  const presentCharacters = characters.filter(character => presentNames.has(normalizeText(character.name)))
  const fallbackCharacters = presentCharacters.length
    ? presentCharacters
    : characters.filter(character => normalizeText(character.name) === normalizeText(targetChapter.povCharacter)).slice(0, 1)
  const contractText = scope.contracts.map(contract =>
    [contract.storyFunction, contract.ownedMovement, (contract.allowedStoryTerritory ?? []).join(" "), contract.requiredEndpoint]
      .filter(Boolean)
      .join(" "),
  ).join(" ")
  const offstageNames = characters
    .filter(character => !fallbackCharacters.some(active => active.name === character.name))
    .filter(character => normalizeText(contractText).includes(normalizeText(character.name)))
    .map(character => character.name)

  const offstage = offstageNames.length
    ? `\n\nOFFSTAGE/NEXT-LEAD NAMES:\n${offstageNames.map(name => `- ${name}: may be referenced only as information, pressure, or a lead unless listed as present in this chapter.`).join("\n")}`
    : ""

  return `CHARACTERS IN THIS CHAPTER:
${fallbackCharacters.map(c =>
  renderScopedCharacterLine(c, scope.boundaryTerms)
).join("\n")}${offstage}`
}

export function renderScopedSpineSection(
  spine: StorySpine,
  scope: ScopedPlanningContext,
): string {
  if (!scope.active) {
    return `STORY SPINE:
Central Conflict: ${spine.centralConflict}
Theme: ${spine.theme}
Ending Direction: ${spine.endingDirection}`
  }
  const functions = scope.contracts
    .map(contract => contract.storyFunction || contract.ownedMovement)
    .filter(Boolean)
    .join("; ")
  return `STORY SPINE (chapter-scoped):
Current chapter function: ${functions || "Execute the target chapter contract."}
Theme: ${spine.theme}
Ending Direction: ${spine.endingDirection}`
}

function isLocationInScope(locationName: string, chapterSetting: string, allowedTerritory: readonly string[]): boolean {
  const normalizedName = normalizeText(locationName)
  const normalizedSetting = normalizeText(chapterSetting)
  if (normalizedName && (normalizedSetting.includes(normalizedName) || normalizedName.includes(normalizedSetting))) return true
  return allowedTerritory.some(territory => {
    const normalizedTerritory = normalizeText(territory)
    return normalizedTerritory &&
      (normalizedName.includes(normalizedTerritory) || normalizedTerritory.includes(normalizedName))
  })
}

function renderScopedCharacterLine(character: CharacterProfile, boundaryTerms: readonly string[]): string {
  const traits = (character.traits ?? [])
    .filter(trait => !directiveTextContainsBoundaryTerm(trait, boundaryTerms))
  const traitText = traits.length ? traits.join(", ") : "chapter-local traits only"
  const goals = sanitizeCharacterContextText(character.goals, boundaryTerms)
  const fears = sanitizeCharacterContextText(character.fears, boundaryTerms)
  return `- ${character.name} (${character.role}) -- ${traitText}\n  Speech: ${character.speechPattern}\n  Goals: ${goals}  Fears: ${fears}`
}

function sanitizeCharacterContextText(text: string | undefined, boundaryTerms: readonly string[]): string {
  if (!text?.trim()) return ""
  if (!directiveTextContainsBoundaryTerm(text, boundaryTerms)) return text
  return "Withheld here because it belongs to a later chapter boundary; use only this chapter's contract-local motive."
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
}
