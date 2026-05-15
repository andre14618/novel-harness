import type { AuthoringBiblePack, AuthoringBibleRule, AuthoringBibleRuleKind } from "./authoring-bible"

export type AuthoringBibleCardKind = AuthoringBibleRuleKind

export interface AuthoringBibleCardBase {
  id: string
  kind: AuthoringBibleCardKind
  title: string
  appliesWhen: string
  selectionHints?: string[]
  source?: string
}

export interface AuthoringBibleCharacterCard extends AuthoringBibleCardBase {
  kind: "character"
  characterId?: string
  characterName: string
  operatingModel: string
  dialogueModel: string
  interiorAttention?: string
  actionTexture?: string
  microExamples?: string[]
}

export interface AuthoringBibleWorldCard extends AuthoringBibleCardBase {
  kind: "world"
  worldSystemId?: string
  worldPressure: string
  vocabulary?: string[]
  proseBehavior?: string
  microExamples?: string[]
}

export interface AuthoringBibleRelationshipCard extends AuthoringBibleCardBase {
  kind: "relationship"
  characterName: string
  relatedCharacterName: string
  relationshipPosture: string
  pressureBehavior?: string
  microExamples?: string[]
}

export interface AuthoringBibleVoiceCard extends AuthoringBibleCardBase {
  kind: "voice"
  voicePrinciple: string
  sentenceBehavior?: string
  dialogueBehavior?: string
  microExamples?: string[]
}

export interface AuthoringBibleStoryCard extends AuthoringBibleCardBase {
  kind: "story"
  storyFunction: string
  pressurePattern?: string
  payoffPattern?: string
  microExamples?: string[]
}

export type AuthoringBibleCard =
  | AuthoringBibleCharacterCard
  | AuthoringBibleWorldCard
  | AuthoringBibleRelationshipCard
  | AuthoringBibleVoiceCard
  | AuthoringBibleStoryCard

export interface AuthoringBiblePlanningArtifact {
  mode: "authoring-bible-planning-artifact-v1"
  packId: string
  title: string
  description: string
  cards: AuthoringBibleCard[]
}

export function buildAuthoringBiblePackFromPlanningArtifact(
  artifact: AuthoringBiblePlanningArtifact,
): AuthoringBiblePack {
  const rules = artifact.cards.map(cardToRule)
  return {
    id: artifact.packId,
    title: artifact.title,
    description: artifact.description,
    storyRules: rules.filter(rule => rule.kind === "story"),
    worldRules: rules.filter(rule => rule.kind === "world"),
    characterRules: rules.filter(rule => rule.kind === "character"),
    relationshipRules: rules.filter(rule => rule.kind === "relationship"),
    voiceRules: rules.filter(rule => rule.kind === "voice"),
  }
}

export function validateAuthoringBiblePlanningArtifact(
  artifact: AuthoringBiblePlanningArtifact,
): string[] {
  const errors: string[] = []
  if (artifact.mode !== "authoring-bible-planning-artifact-v1") errors.push("mode must be authoring-bible-planning-artifact-v1")
  if (!artifact.packId.trim()) errors.push("packId is required")
  if (!artifact.title.trim()) errors.push("title is required")
  if (!artifact.description.trim()) errors.push("description is required")
  if (artifact.cards.length === 0) errors.push("at least one card is required")

  const seen = new Set<string>()
  for (const card of artifact.cards) {
    if (!card.id.trim()) errors.push("card.id is required")
    if (seen.has(card.id)) errors.push(`duplicate card id: ${card.id}`)
    seen.add(card.id)
    if (!card.title.trim()) errors.push(`${card.id}: title is required`)
    if (!card.appliesWhen.trim()) errors.push(`${card.id}: appliesWhen is required`)
    if (!validCardKinds.has(card.kind)) errors.push(`${card.id}: unsupported kind ${card.kind}`)
    for (const hint of card.selectionHints ?? []) {
      if (!hint.trim()) errors.push(`${card.id}: empty selection hint`)
    }
  }
  return errors
}

function cardToRule(card: AuthoringBibleCard): AuthoringBibleRule {
  const base = {
    id: `pack:${card.id}`,
    kind: card.kind,
    title: card.title,
    appliesWhen: card.appliesWhen,
    source: card.source ?? "authoring-bible-planning-artifact-v1",
    ...(card.selectionHints?.length ? { selectionHints: compactStrings(card.selectionHints) } : {}),
  }
  if (card.kind === "character") {
    return {
      ...base,
      text: compactSentence([
        card.operatingModel,
        card.dialogueModel ? `Dialogue: ${card.dialogueModel}.` : "",
        card.interiorAttention ? `Interior attention: ${card.interiorAttention}.` : "",
        card.actionTexture ? `Action texture: ${card.actionTexture}.` : "",
        examplesText(card.microExamples),
      ]),
      ...(card.characterId ? { characterId: card.characterId } : {}),
      characterName: card.characterName,
    }
  }
  if (card.kind === "world") {
    return {
      ...base,
      text: compactSentence([
        card.worldPressure,
        card.proseBehavior ? `Prose behavior: ${card.proseBehavior}.` : "",
        card.vocabulary?.length ? `Vocabulary with consequence: ${compactStrings(card.vocabulary).join(", ")}.` : "",
        examplesText(card.microExamples),
      ]),
    }
  }
  if (card.kind === "relationship") {
    return {
      ...base,
      text: compactSentence([
        card.relationshipPosture,
        card.pressureBehavior ? `Under pressure: ${card.pressureBehavior}.` : "",
        examplesText(card.microExamples),
      ]),
      characterName: card.characterName,
      relatedCharacterName: card.relatedCharacterName,
    }
  }
  if (card.kind === "voice") {
    return {
      ...base,
      text: compactSentence([
        card.voicePrinciple,
        card.sentenceBehavior ? `Sentences: ${card.sentenceBehavior}.` : "",
        card.dialogueBehavior ? `Dialogue: ${card.dialogueBehavior}.` : "",
        examplesText(card.microExamples),
      ]),
    }
  }
  return {
    ...base,
    text: compactSentence([
      card.storyFunction,
      card.pressurePattern ? `Pressure pattern: ${card.pressurePattern}.` : "",
      card.payoffPattern ? `Payoff pattern: ${card.payoffPattern}.` : "",
      examplesText(card.microExamples),
    ]),
  }
}

function examplesText(examples: string[] | undefined): string {
  const compact = compactStrings(examples ?? [])
  if (compact.length === 0) return ""
  return `Examples: ${compact.map(example => `"${example.replace(/^"|"$/g, "")}"`).join(" / ")}.`
}

function compactSentence(parts: string[]): string {
  return parts.map(part => part.trim()).filter(Boolean).join(" ")
}

function compactStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

const validCardKinds = new Set<AuthoringBibleCardKind>([
  "story",
  "world",
  "character",
  "relationship",
  "voice",
])
