import { z } from "zod"
import type { ChapterOutline } from "../../types"

export type ChapterPlanDeviation = {
  description: string
  beat_index: number | null
  /** Durable scene ref resolved by the harness from outline.scenes[beat_index].sceneId. */
  sceneId?: string
  /** Legacy durable beat ref for beat-shaped entries. Not a generic scene ref. */
  beatId?: string
  /**
   * L098 Slice 3: optional obligation refs for scene-satisfaction findings.
   * When the chapter-plan-checker (under sceneSatisfactionCheckerV1) emits
   * a deviation tied to specific scene obligations, populate this with the
   * exact obligation IDs. Routing prefers obligation-ID lookup over the
   * legacy beat-0 fallback when present and beat_index is null.
   */
  obligationIds?: string[]
}

// Coerce legacy string deviations into {description, beat_index: null} before
// the object schema parses. Cast the ZodType to the resolved output so
// z.infer downstream lands on ChapterPlanDeviation instead of `unknown`.
const deviationSchema = z.preprocess(
  v => typeof v === "string" ? { description: v, beat_index: null } : v,
  z.object({
    description: z.string(),
    beat_index: z.number().int().nullable(),
    sceneId: z.string().min(1).optional(),
    beatId: z.string().min(1).optional(),
    obligationIds: z.array(z.string().min(1)).optional(),
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
      const sceneId = resolveDeviationSceneId(outline, deviation.beat_index)
      const beatId = resolveDeviationBeatId(outline, deviation.beat_index)
      return {
        ...deviation,
        ...(sceneId ? { sceneId } : {}),
        ...(beatId ? { beatId } : {}),
      }
    }),
  }
}

export function resolveDeviationSceneId(
  outline: Pick<ChapterOutline, "scenes">,
  beatIndex: number | null,
): string | undefined {
  if (beatIndex === null || !Number.isInteger(beatIndex) || beatIndex < 0) {
    return undefined
  }
  const scene = outline.scenes?.[beatIndex]
  return typeof scene?.sceneId === "string" && scene.sceneId.length > 0
    ? scene.sceneId
    : undefined
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
