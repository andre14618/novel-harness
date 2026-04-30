/**
 * Value-charge extractor — corpus Stage 6 tool, NOT in the runtime
 * pipeline. Invoked from scripts/corpus/extract-structure.ts to tag
 * each scene of a normalized per-book bundle.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3
 * "Extraction agents." Model assignment in src/models/roles.ts under
 * "structure-value-charge".
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import { buildValueChargeContext, type ValueChargeContextInput } from "./context"
import { valueChargeSchema, type ValueChargeOutput } from "./schema"

export { buildValueChargeContext, valueChargeSchema }
export type { ValueChargeContextInput, ValueChargeOutput }

export const VALUE_CHARGE_SYSTEM = readFileSync(
  resolve(dirname(new URL(import.meta.url).pathname), "value-charge-system.md"),
  "utf-8",
)

export interface ValueChargeResult {
  ok: boolean
  output?: ValueChargeOutput
  error?: string
}

export async function extractValueCharge(
  input: ValueChargeContextInput,
  /** Override the agent role — used by llm-judge.ts to route the same
   *  prompt + schema through a different model (e.g. Cerebras 235B as
   *  cross-family judge) without duplicating the extractor logic. */
  opts?: { agentName?: string },
): Promise<ValueChargeResult> {
  const userPrompt = buildValueChargeContext(input)
  try {
    const result = await callAgent({
      agentName: (opts?.agentName ?? "structure-value-charge") as any,
      systemPrompt: VALUE_CHARGE_SYSTEM,
      userPrompt,
      schema: valueChargeSchema,
    })
    return { ok: true, output: result.output }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
