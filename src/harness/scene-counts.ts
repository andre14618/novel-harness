const MIN_SCENES_PER_CHAPTER = 3

// Treat planned entries as scene-scale story turns, not micro-beats. Recent
// drafting evidence shows a real dramatized entry usually needs hundreds of
// words; a 3k chapter can carry about 3-5 entries, not 8-10.
const MIN_TARGET_WORDS_PER_SCENE = 1100
const RECOMMENDED_TARGET_WORDS_PER_SCENE = 750
const RECOMMENDED_SCENE_COUNT_OVERAGE_ALLOWED = 1

export interface SceneCountAssessment {
  minRecommendedScenes: number
  recommendedScenes: number
  sceneDeltaFromRecommended: number
  underPlanned: boolean
  overPlanned: boolean
}

export interface PlanningSceneCountPolicy {
  minRecommendedScenes: number
  recommendedScenes: number
  configuredMaxScenes: number | null
  effectiveMaxScenes: number | null
  capRaisedToFloor: boolean
}

function normalizeTargetWords(targetWords: number | null | undefined): number {
  return typeof targetWords === "number" && Number.isFinite(targetWords) && targetWords > 0
    ? targetWords
    : 1000
}

export function minimumSceneCountForTarget(targetWords: number | null | undefined): number {
  return Math.max(MIN_SCENES_PER_CHAPTER, Math.ceil(normalizeTargetWords(targetWords) / MIN_TARGET_WORDS_PER_SCENE))
}

export function recommendedSceneCountForTarget(targetWords: number | null | undefined): number {
  return Math.max(MIN_SCENES_PER_CHAPTER, Math.ceil(normalizeTargetWords(targetWords) / RECOMMENDED_TARGET_WORDS_PER_SCENE))
}

export function assessSceneCountForTarget(
  targetWords: number | null | undefined,
  plannedScenes: number,
): SceneCountAssessment {
  const minRecommendedScenes = minimumSceneCountForTarget(targetWords)
  const recommendedScenes = recommendedSceneCountForTarget(targetWords)
  return {
    minRecommendedScenes,
    recommendedScenes,
    sceneDeltaFromRecommended: plannedScenes - recommendedScenes,
    underPlanned: plannedScenes < minRecommendedScenes,
    overPlanned: plannedScenes > recommendedScenes + RECOMMENDED_SCENE_COUNT_OVERAGE_ALLOWED,
  }
}

export function planningSceneCountPolicy(
  targetWords: number | null | undefined,
  configuredMaxScenes: number | null | undefined,
): PlanningSceneCountPolicy {
  const minRecommendedScenes = minimumSceneCountForTarget(targetWords)
  const recommendedScenes = recommendedSceneCountForTarget(targetWords)
  const normalizedMax = normalizeConfiguredMaxScenes(configuredMaxScenes)
  const effectiveMaxScenes = normalizedMax === null
    ? null
    : Math.max(minRecommendedScenes, normalizedMax)
  return {
    minRecommendedScenes,
    recommendedScenes,
    configuredMaxScenes: normalizedMax,
    effectiveMaxScenes,
    capRaisedToFloor: normalizedMax !== null && effectiveMaxScenes !== normalizedMax,
  }
}

function normalizeConfiguredMaxScenes(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null
  if (!Number.isInteger(value) || value <= 0) return null
  return value
}
