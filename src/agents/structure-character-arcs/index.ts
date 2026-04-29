/**
 * Character-arcs extractor — corpus Stage 6 tool, NOT in the runtime
 * pipeline. Single-pass per-book extraction, invoked from
 * scripts/corpus/extract-character-arcs.ts on a per-book canonically-
 * ordered beats sequence.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3
 * + the Weiland canonical Lie/Truth/Want/Need formulation captured in
 * docs/research/writing-frameworks/SYNTHESIS.md §2.3 (densest 8-frame
 * convergence in the corpus).
 *
 * Model assignment in src/models/roles.ts under
 * "structure-character-arcs" (added by the orchestration step after
 * all three structure dim agents land — NOT this commit).
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import {
  buildCharacterArcsContext,
  type CharacterArcsContextInput, type CharacterArcsBeatRow,
} from "./context"
import {
  characterArcsListSchema,
  type CharacterArc, type CharacterArcsList,
} from "./schema"

export { buildCharacterArcsContext, characterArcsListSchema }
export type {
  CharacterArcsContextInput, CharacterArcsBeatRow,
  CharacterArc, CharacterArcsList,
}

export const CHARACTER_ARCS_SYSTEM = readFileSync(
  resolve(dirname(new URL(import.meta.url).pathname), "character-arcs-system.md"),
  "utf-8",
)

export interface CharacterArcsExtractResult {
  ok: boolean
  arcs?: CharacterArc[]
  error?: string
}

export async function extractCharacterArcs(
  input: CharacterArcsContextInput,
  /** Override the agent role — used by llm-judge.ts to route the same
   *  prompt + schema through a different model (e.g. Cerebras 235B as
   *  cross-family judge) without duplicating the extractor logic. */
  opts?: { agentName?: string },
): Promise<CharacterArcsExtractResult> {
  const userPrompt = buildCharacterArcsContext(input)
  try {
    const result = await callAgent({
      agentName: (opts?.agentName ?? "structure-character-arcs") as any,
      systemPrompt: CHARACTER_ARCS_SYSTEM,
      userPrompt,
      schema: characterArcsListSchema,
    })
    return { ok: true, arcs: result.output.arcs }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
