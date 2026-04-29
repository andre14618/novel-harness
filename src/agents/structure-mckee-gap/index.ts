/**
 * McKee Gap extractor — corpus Stage 6 tool, NOT in the runtime
 * pipeline. Invoked from scripts/corpus/extract-mckee-gap.ts to tag
 * each beat of a normalized per-book bundle.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3
 * "Extraction agents" + SYNTHESIS.md §2.5 (Maass / Coyne / McKee /
 * Yorke / Truby / Swain convergence on per-beat change). Model
 * assignment in src/models/roles.ts under "structure-mckee-gap"
 * (added in a separate orchestration step after this agent ships).
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import { buildMckeeGapContext, type McKeeGapContextInput } from "./context"
import { mckeeGapSchema, type McKeeGapOutput } from "./schema"

export { buildMckeeGapContext, mckeeGapSchema }
export type { McKeeGapContextInput, McKeeGapOutput }

export const MCKEE_GAP_SYSTEM = readFileSync(
  resolve(dirname(new URL(import.meta.url).pathname), "mckee-gap-system.md"),
  "utf-8",
)

export interface McKeeGapResult {
  ok: boolean
  output?: McKeeGapOutput
  error?: string
}

export async function extractMckeeGap(
  input: McKeeGapContextInput,
  /** Override the agent role — used by llm-judge.ts to route the same
   *  prompt + schema through a different model (e.g. Cerebras 235B as
   *  cross-family judge) without duplicating the extractor logic. */
  opts?: { agentName?: string },
): Promise<McKeeGapResult> {
  const userPrompt = buildMckeeGapContext(input)
  try {
    const result = await callAgent({
      agentName: (opts?.agentName ?? "structure-mckee-gap") as any,
      systemPrompt: MCKEE_GAP_SYSTEM,
      userPrompt,
      schema: mckeeGapSchema,
    })
    return { ok: true, output: result.output }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
