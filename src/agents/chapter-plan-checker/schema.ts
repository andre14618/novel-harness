import { z } from "zod"
import type { ChapterOutline } from "../../types"

export type ChapterPlanDeviation = {
  description: string
  beat_index: number | null
  /** Durable beat ref resolved by the harness from outline.scenes[beat_index].beatId. */
  beatId?: string
}

// Coerce legacy string deviations into {description, beat_index: null} before
// the object schema parses. Cast the ZodType to the resolved output so
// z.infer downstream lands on ChapterPlanDeviation instead of `unknown`.
const deviationSchema = z.preprocess(
  v => typeof v === "string" ? { description: v, beat_index: null } : v,
  z.object({
    description: z.string(),
    beat_index: z.number().int().nullable(),
    beatId: z.string().min(1).optional(),
  }),
) as unknown as z.ZodType<ChapterPlanDeviation>

export const schema = z.object({
  setting_match: z.object({
    planned: z.string(),
    observed: z.string(),
    matches: z.boolean(),
  }).optional(),
  emotional_arc_correct: z.boolean().optional(),
  pass: z.boolean(),
  deviations: z.array(deviationSchema).default([]),
})

export const chapterPlanCheckSchema = schema

export type ChapterPlanCheckResult = z.infer<typeof schema>

export function attachChapterPlanDeviationBeatIds<T extends {
  deviations?: readonly ChapterPlanDeviation[]
}>(
  result: T,
  outline: Pick<ChapterOutline, "scenes">,
): T & { deviations: ChapterPlanDeviation[] } {
  return {
    ...result,
    deviations: (result.deviations ?? []).map((deviation) => {
      const beatId = resolveDeviationBeatId(outline, deviation.beat_index)
      return beatId ? { ...deviation, beatId } : { ...deviation }
    }),
  }
}

export function resolveDeviationBeatId(
  outline: Pick<ChapterOutline, "scenes">,
  beatIndex: number | null,
): string | undefined {
  if (beatIndex === null || !Number.isInteger(beatIndex) || beatIndex < 0) {
    return undefined
  }
  const scene = outline.scenes?.[beatIndex]
  return typeof scene?.beatId === "string" && scene.beatId.length > 0
    ? scene.beatId
    : undefined
}
