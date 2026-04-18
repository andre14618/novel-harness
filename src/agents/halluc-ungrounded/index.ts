import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import type { ChapterOutline, CharacterProfile, SceneBeat } from "../../types"
import { buildContext } from "./context"
import { hallucUngroundedSchema, type HallucUngroundedOutput } from "./schema"

export { buildContext, hallucUngroundedSchema }
export type { HallucUngroundedOutput }

// Load the training-shape system prompt from disk so updates to the
// rubric don't require a TS recompile; matches the pattern used by
// other adapter-backed agents in src/agents/*.
export const HALLUC_UNGROUNDED_SYSTEM = readFileSync(
  resolve(dirname(new URL(import.meta.url).pathname), "halluc-ungrounded-system.md"),
  "utf-8",
)

export interface HallucUngroundedResult {
  pass: boolean
  issues: string[]   // normalized to the BeatIssue.description shape
}

/**
 * Runtime wrapper for the `halluc-ungrounded-v2:v1` W&B adapter. Called
 * from the beat drafting retry loop. Never throws — any transport or
 * schema failure is normalized into a blocking issue so the drafting
 * loop can still decide whether to retry or accept.
 */
export async function checkHallucUngrounded(
  prose: string,
  beat: SceneBeat,
  outline: ChapterOutline,
  characters: CharacterProfile[],
  worldBible: any,
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; attempt?: number },
): Promise<HallucUngroundedResult> {
  const userPrompt = buildContext(prose, beat, outline, characters, worldBible)
  try {
    const result = await callAgent({
      novelId: tags?.novelId,
      chapter: tags?.chapter,
      beatIndex: tags?.beatIndex,
      attempt: tags?.attempt,
      agentName: "halluc-ungrounded" as const,
      systemPrompt: HALLUC_UNGROUNDED_SYSTEM,
      userPrompt,
      schema: hallucUngroundedSchema,
    })
    const output = result.output
    if (output.pass) return { pass: true, issues: [] }
    // Zod's `.default([])` resolves to an array at parse time, but the
    // inferred input type keeps the field optional — fall back to [] so
    // downstream consumers never see undefined.
    const issues = (output.issues ?? []).map(i =>
      `Ungrounded entity "${i.entity}"${i.excerpt ? ` — context: "${i.excerpt}"` : ""}`,
    )
    return { pass: false, issues }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      pass: false,
      issues: [`Ungrounded check failed: ${msg}`],
    }
  }
}
