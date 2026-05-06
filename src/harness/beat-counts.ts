const MIN_BEATS_PER_CHAPTER = 3

// Current writer runs are closer to 300-450 words per planned beat than the
// older 100-150w assumption. Keep this deterministic and easy to recalibrate.
const MIN_TARGET_WORDS_PER_BEAT = 400
const RECOMMENDED_TARGET_WORDS_PER_BEAT = 325
const RECOMMENDED_BEAT_COUNT_OVERAGE_ALLOWED = 1

export interface BeatCountAssessment {
  minRecommendedBeats: number
  recommendedBeats: number
  beatDeltaFromRecommended: number
  underPlanned: boolean
  overPlanned: boolean
}

function normalizeTargetWords(targetWords: number | null | undefined): number {
  return typeof targetWords === "number" && Number.isFinite(targetWords) && targetWords > 0
    ? targetWords
    : 1000
}

export function minimumBeatCountForTarget(targetWords: number | null | undefined): number {
  return Math.max(MIN_BEATS_PER_CHAPTER, Math.ceil(normalizeTargetWords(targetWords) / MIN_TARGET_WORDS_PER_BEAT))
}

export function recommendedBeatCountForTarget(targetWords: number | null | undefined): number {
  return Math.max(MIN_BEATS_PER_CHAPTER, Math.ceil(normalizeTargetWords(targetWords) / RECOMMENDED_TARGET_WORDS_PER_BEAT))
}

export function assessBeatCountForTarget(
  targetWords: number | null | undefined,
  plannedBeats: number,
): BeatCountAssessment {
  const minRecommendedBeats = minimumBeatCountForTarget(targetWords)
  const recommendedBeats = recommendedBeatCountForTarget(targetWords)
  return {
    minRecommendedBeats,
    recommendedBeats,
    beatDeltaFromRecommended: plannedBeats - recommendedBeats,
    underPlanned: plannedBeats < minRecommendedBeats,
    overPlanned: plannedBeats > recommendedBeats + RECOMMENDED_BEAT_COUNT_OVERAGE_ALLOWED,
  }
}
