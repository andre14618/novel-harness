const MIN_BEATS_PER_CHAPTER = 3

// Current writer runs are closer to 300-450 words per planned beat than the
// older 100-150w assumption. Keep this deterministic and easy to recalibrate.
const MIN_TARGET_WORDS_PER_BEAT = 400
const RECOMMENDED_TARGET_WORDS_PER_BEAT = 325

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
