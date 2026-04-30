/**
 * MICE-per-scene extractor — corpus Stage 6 tool, NOT in the runtime
 * pipeline. Invoked from scripts/corpus/extract-mice.ts to tag each
 * scene of a normalized per-book bundle with its dominant MICE thread
 * (Milieu / Idea / Character / Event) plus open/close annotations so
 * a downstream stack-walk validator can verify the balanced-parens
 * property over the whole novel.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3
 * "Extraction agents" + docs/research/writing-frameworks/SYNTHESIS.md §1
 * "Sanderson MICE-as-balanced-parens." Model assignment lives in
 * src/models/roles.ts; the role entry is added by the orchestration step
 * after all three Bucket-1 dim agents land.
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import { buildMiceContext, type MiceContextInput } from "./context"
import { miceSchema, type MiceOutput } from "./schema"

export { buildMiceContext, miceSchema }
export type { MiceContextInput, MiceOutput }

export const MICE_SYSTEM = readFileSync(
  resolve(dirname(new URL(import.meta.url).pathname), "mice-system.md"),
  "utf-8",
)

export interface MiceResult {
  ok: boolean
  output?: MiceOutput
  error?: string
}

export async function extractMice(
  input: MiceContextInput,
  /** Override the agent role — used by llm-judge.ts to route the same
   *  prompt + schema through a different model (e.g. V4 Pro as judge,
   *  Cerebras as cross-family judge) without duplicating extractor logic. */
  opts?: { agentName?: string },
): Promise<MiceResult> {
  const userPrompt = buildMiceContext(input)
  try {
    const result = await callAgent({
      agentName: (opts?.agentName ?? "structure-mice") as any,
      systemPrompt: MICE_SYSTEM,
      userPrompt,
      schema: miceSchema,
    })
    return { ok: true, output: result.output }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
