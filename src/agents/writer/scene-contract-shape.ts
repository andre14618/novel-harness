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
  const dramaticFields = [
    scene?.goal,
    scene?.opposition,
    scene?.turningPoint,
    scene?.crisisChoice,
    scene?.outcome,
    scene?.consequence,
    scene?.povPersonalStake,
    scene?.valueIn,
    scene?.valueOut,
  ].filter(hasText).length + (choiceAlternatives > 0 ? 1 : 0)
  const budgetFields = positiveNumber(scene?.targetWords) ? 1 : 0
  const fieldCount = anchorFields + dramaticFields + budgetFields

  return {
    fieldCount,
    anchorFields,
    dramaticFields,
    budgetFields,
    choiceAlternatives,
    hasAny: fieldCount > 0,
    hasAnchor: anchorFields > 0,
    hasDramaticShape: dramaticFields > 0,
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
