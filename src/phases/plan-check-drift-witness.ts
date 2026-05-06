import type {
  ChapterPlanCheckResult,
  ChapterPlanDeviation,
} from "../agents/chapter-plan-checker/schema"

type OutlineWithBeatIds = { scenes: ReadonlyArray<{ beatId?: string }> }

export interface PlanCheckDriftWitnessPayload {
  source: "post-settle"
  passed: boolean
  settled: boolean
  outcome: string
  rewritePassCount: number
  forcedPlanCheck: boolean
  deviationCount: number
  stableBeatRefs: string[]
  witnesses: PlanCheckDriftWitnessDeviation[]
}

export interface PlanCheckDriftWitnessDeviation {
  beatIndex: number | null
  beatLabel: number | null
  beatId: string | null
  description: string
  seenCount: number
  persistedAcrossPasses: boolean
}

export function buildPlanCheckDriftWitnessPayload(args: {
  result: Pick<ChapterPlanCheckResult, "pass" | "deviations">
  outline: OutlineWithBeatIds
  settleKind: string
  rewritePass: number
  forcedPlanCheck?: boolean
  history?: readonly Pick<ChapterPlanCheckResult, "deviations">[]
  maxDeviations?: number
}): PlanCheckDriftWitnessPayload {
  const deviations = args.result.deviations ?? []
  const historyCounts = countDeviationHistory(args.history ?? [args.result], args.outline)
  const witnesses = deviations.slice(0, args.maxDeviations ?? 20).map(deviation => {
    const beatId = resolveBeatId(args.outline, deviation)
    const key = deviationKey(deviation, beatId)
    const seenCount = historyCounts.get(key) ?? 1
    return {
      beatIndex: deviation.beat_index,
      beatLabel: deviation.beat_index == null ? null : deviation.beat_index + 1,
      beatId: beatId ?? null,
      description: deviation.description,
      seenCount,
      persistedAcrossPasses: seenCount > 1,
    }
  })
  return {
    source: "post-settle",
    passed: args.result.pass,
    settled: args.result.pass,
    outcome: args.settleKind,
    rewritePassCount: args.rewritePass,
    forcedPlanCheck: args.forcedPlanCheck ?? false,
    deviationCount: deviations.length,
    stableBeatRefs: [...new Set(witnesses.flatMap(witness => witness.beatId ? [witness.beatId] : []))],
    witnesses,
  }
}

function countDeviationHistory(
  history: readonly Pick<ChapterPlanCheckResult, "deviations">[],
  outline: OutlineWithBeatIds,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const result of history) {
    for (const deviation of result.deviations ?? []) {
      const key = deviationKey(deviation, resolveBeatId(outline, deviation))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

function resolveBeatId(
  outline: OutlineWithBeatIds,
  deviation: ChapterPlanDeviation,
): string | undefined {
  if (deviation.beatId) return deviation.beatId
  if (deviation.beat_index == null) return undefined
  return outline.scenes[deviation.beat_index]?.beatId
}

function deviationKey(deviation: ChapterPlanDeviation, beatId: string | undefined): string {
  const beatRef = beatId ?? (deviation.beat_index == null ? "chapter" : `beat:${deviation.beat_index}`)
  return `${beatRef}:${normalizeDescription(deviation.description)}`
}

function normalizeDescription(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}
