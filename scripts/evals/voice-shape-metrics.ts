/**
 * Voice-shape metrics for `voice-shaping-ablation-v1` per charter §3.
 *
 * Five features per prose sample (all standardizable vs a reference
 * distribution):
 *
 *   1. meanSentenceLength    — average word count per sentence
 *   2. sentenceLengthStd     — std-dev of sentence word counts (rhythm)
 *   3. dialogueRatio         — chars-in-quotes / total chars
 *   4. clauseComplexity      — mean (commas + semicolons) per sentence
 *   5. sensoryDensity        — count of frozen-vocabulary sensory words
 *                               / total words
 *
 * Reference distribution: computed from a pre-registered set of
 * Salvatore corpus passages (`scripts/evals/voice-shape-reference.json`)
 * stratified by beat kind. Per-feature standardized distance is
 * `abs(arm_mean - ref_mean) / ref_std` — dimensionless units.
 *
 * Pure module — no DB or network. Unit-tested.
 */

// ── Frozen sensory vocabulary (120 terms) ────────────────────────────
// Constructed to catch sensory-density surface signal without over-fitting
// to any corpus. Five senses + body-state + weather. Static list;
// versioning via git history if it ever needs to change.
export const SENSORY_VOCABULARY = new Set<string>([
  // Sight — light, color, shape
  "glimmer", "gleam", "flicker", "shimmer", "glint", "glow", "flash", "shadow",
  "dim", "dark", "bright", "pale", "crimson", "amber", "silver", "golden",
  // Sound
  "whisper", "hiss", "murmur", "roar", "creak", "groan", "rustle", "clatter",
  "echo", "silence", "crack", "shriek", "moan", "thud", "crash",
  // Smell
  "scent", "reek", "stench", "aroma", "musk", "perfume", "fragrance",
  "smoke", "sweat", "rot",
  // Taste
  "sour", "sweet", "bitter", "salt", "salty", "metallic", "tang", "stale",
  // Touch / texture / temperature
  "cold", "icy", "frigid", "warm", "hot", "burning", "freezing", "numb",
  "rough", "smooth", "jagged", "slick", "sharp", "sticky", "damp", "brittle",
  "tender", "raw",
  // Body-state (interiority-sensory)
  "ache", "pulse", "throb", "shiver", "tremble", "flinch", "gasp",
  "breath", "heartbeat", "sweat",
  // Weather / environment
  "wind", "rain", "storm", "mist", "fog", "snow", "frost", "thunder",
  "chill", "heat", "dust", "drizzle",
  // Visual-atmosphere
  "gloom", "haze", "glare", "shade", "dusk", "dawn", "twilight",
  // Movement-sensory
  "stagger", "lurch", "reel", "sway", "falter",
  // Material-sensory
  "blood", "stone", "iron", "leather", "fur", "hide", "mud", "wood",
])

// ── Feature computation ─────────────────────────────────────────────

function splitSentences(prose: string): string[] {
  // Sentence splitter: terminators `.?!` followed by whitespace-then-uppercase,
  // or end of string. Dialogue quotation boundaries preserved.
  const trimmed = prose.trim()
  if (!trimmed) return []
  // Simple heuristic — good enough for feature stats, not for parsing meaning.
  const raw = trimmed.split(/(?<=[.!?])\s+(?=[A-Z"'"""])/)
  return raw.map(s => s.trim()).filter(s => s.length > 0)
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

export interface VoiceShapeFeatures {
  meanSentenceLength: number
  sentenceLengthStd: number
  dialogueRatio: number
  clauseComplexity: number
  sensoryDensity: number
  totalWords: number   // for word-count residualization
  sentenceCount: number
}

export function computeFeatures(prose: string): VoiceShapeFeatures {
  const sentences = splitSentences(prose)
  const wordCounts = sentences.map(countWords)
  const totalWords = wordCounts.reduce((a, b) => a + b, 0)

  const dialogueChars =
    [...prose.matchAll(/(?:"[^"]+"|"[^"]+"|'[^']+')/g)]
      .reduce((sum, m) => sum + m[0].length, 0)
  const dialogueRatio = prose.length > 0 ? dialogueChars / prose.length : 0

  const clauseMarks = (prose.match(/[,;]/g) ?? []).length
  const clauseComplexity = sentences.length > 0 ? clauseMarks / sentences.length : 0

  const words = prose.toLowerCase().match(/[a-z']+/g) ?? []
  const sensoryHits = words.filter(w => SENSORY_VOCABULARY.has(w)).length
  const sensoryDensity = words.length > 0 ? sensoryHits / words.length : 0

  return {
    meanSentenceLength: mean(wordCounts),
    sentenceLengthStd: std(wordCounts),
    dialogueRatio,
    clauseComplexity,
    sensoryDensity,
    totalWords,
    sentenceCount: sentences.length,
  }
}

// ── Reference distribution + per-feature standardized distance ──────

export const FEATURE_KEYS = [
  "meanSentenceLength",
  "sentenceLengthStd",
  "dialogueRatio",
  "clauseComplexity",
  "sensoryDensity",
] as const
export type FeatureKey = typeof FEATURE_KEYS[number]

export interface ReferenceDistribution {
  n: number
  means: Record<FeatureKey, number>
  stds: Record<FeatureKey, number>
}

export function computeReferenceDistribution(
  samples: VoiceShapeFeatures[],
): ReferenceDistribution {
  const means = {} as Record<FeatureKey, number>
  const stds = {} as Record<FeatureKey, number>
  for (const k of FEATURE_KEYS) {
    const xs = samples.map(s => s[k])
    means[k] = mean(xs)
    stds[k] = std(xs)
  }
  return { n: samples.length, means, stds }
}

/**
 * Per-feature standardized distance: `abs(arm - ref_mean) / ref_std`.
 * Units are ref-standard-deviations. If ref_std is 0 (degenerate
 * reference), falls back to 0 — treat as "feature is constant and
 * arm matches it perfectly" only if arm == ref_mean; otherwise large.
 */
export function standardizedDistance(
  sample: VoiceShapeFeatures,
  ref: ReferenceDistribution,
): Record<FeatureKey, number> {
  const out = {} as Record<FeatureKey, number>
  for (const k of FEATURE_KEYS) {
    const diff = Math.abs(sample[k] - ref.means[k])
    const s = ref.stds[k]
    out[k] = s === 0 ? (diff === 0 ? 0 : Number.POSITIVE_INFINITY) : diff / s
  }
  return out
}

/**
 * Aggregate "arm-improves-on-N-of-5-features" rule from charter §3.
 * For each arm, returns the count of features where its
 * standardizedDistance is ≤ 0.75 × baseline's standardizedDistance.
 */
export function countImprovedFeatures(
  armDist: Record<FeatureKey, number>,
  baselineDist: Record<FeatureKey, number>,
  improvementRatio = 0.75,
): { count: number; per_feature: Record<FeatureKey, boolean> } {
  const per_feature = {} as Record<FeatureKey, boolean>
  let count = 0
  for (const k of FEATURE_KEYS) {
    const improved = armDist[k] <= baselineDist[k] * improvementRatio
    per_feature[k] = improved
    if (improved) count++
  }
  return { count, per_feature }
}
