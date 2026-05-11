import type { SceneContractBlock } from "./beat-context"

export interface SceneContractShapeCounts {
  fieldCount: number
  anchorFields: number
  dramaticFields: number
  budgetFields: number
  choiceAlternatives: number
  hasAny: boolean
  hasAnchor: boolean
  hasDramaticShape: boolean
  hasChoiceShape: boolean
  hasEndpointShape: boolean
  hasFullDramaticShape: boolean
  isAnchorOnly: boolean
}

type SceneContractShapeInput = {
  [K in keyof Omit<SceneContractBlock, "choiceAlternatives">]?: unknown
} & {
  choiceAlternatives?: unknown
}

export function summarizeSceneContractShape(scene: SceneContractShapeInput | null | undefined): SceneContractShapeCounts {
  const temporalAnchor = hasText(scene?.temporalAnchor)
  const placeAnchor = hasText(scene?.placeAnchor)
  const anchorFields = Number(temporalAnchor) + Number(placeAnchor)
  const choiceAlternatives = stringArray(scene?.choiceAlternatives).length
  const goal = hasText(scene?.goal)
  const opposition = hasText(scene?.opposition)
  const turningPoint = hasText(scene?.turningPoint)
  const crisisChoice = hasText(scene?.crisisChoice)
  const outcome = hasText(scene?.outcome)
  const consequence = hasText(scene?.consequence)
  const povPersonalStake = hasText(scene?.povPersonalStake)
  const valueIn = hasText(scene?.valueIn)
  const valueOut = hasText(scene?.valueOut)
  const dramaticFields = [
    goal,
    opposition,
    turningPoint,
    crisisChoice,
    outcome,
    consequence,
    povPersonalStake,
    valueIn,
    valueOut,
  ].filter(Boolean).length + (choiceAlternatives > 0 ? 1 : 0)
  const budgetFields = positiveNumber(scene?.targetWords) ? 1 : 0
  const fieldCount = anchorFields + dramaticFields + budgetFields
  const hasChoiceShape = crisisChoice && choiceAlternatives >= 2
  const hasEndpointShape = outcome && consequence
  const hasFullDramaticShape = goal && opposition && turningPoint &&
    hasChoiceShape && hasEndpointShape && povPersonalStake && valueIn && valueOut

  return {
    fieldCount,
    anchorFields,
    dramaticFields,
    budgetFields,
    choiceAlternatives,
    hasAny: fieldCount > 0,
    hasAnchor: anchorFields > 0,
    hasDramaticShape: dramaticFields > 0,
    hasChoiceShape,
    hasEndpointShape,
    hasFullDramaticShape,
    isAnchorOnly: anchorFields > 0 && dramaticFields === 0,
  }
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(item => typeof item === "string" && item.trim().length > 0)
    : []
}
