import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import { buildContext } from "./context"
import { hallucLeakSalvatoreSchema, type HallucLeakSalvatoreOutput } from "./schema"

export { buildContext, hallucLeakSalvatoreSchema }
export type { HallucLeakSalvatoreOutput }

export const HALLUC_LEAK_SALVATORE_SYSTEM = readFileSync(
  resolve(dirname(new URL(import.meta.url).pathname), "halluc-leak-salvatore-system.md"),
  "utf-8",
)

export interface HallucLeakSalvatoreResult {
  pass: boolean
  issues: string[]   // normalized to BeatIssue.description shape
}

/**
 * Runtime wrapper for the `halluc-leak-salvatore-v1:v1` W&B adapter.
 * Intended to run only when the writer is routed through the Salvatore
 * voice pack — the drafting loop decides gating, not this module. Never
 * throws into the drafting loop; any transport/schema failure is
 * normalized into a blocking issue.
 */
export async function checkHallucLeakSalvatore(
  prose: string,
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; attempt?: number },
): Promise<HallucLeakSalvatoreResult> {
  try {
    const result = await callAgent({
      novelId: tags?.novelId,
      chapter: tags?.chapter,
      beatIndex: tags?.beatIndex,
      attempt: tags?.attempt,
      agentName: "halluc-leak-salvatore" as const,
      systemPrompt: HALLUC_LEAK_SALVATORE_SYSTEM,
      userPrompt: buildContext(prose),
      schema: hallucLeakSalvatoreSchema,
    })
    const output = result.output
    if (!output.has_leak) return { pass: true, issues: [] }
    // Zod's `.default([])` resolves at parse time, but the inferred input
    // type keeps `leaks` optional — coalesce so consumers never see undefined.
    const leaks = output.leaks ?? []
    const issues = leaks.length > 0
      ? leaks.map(token => `Salvatore corpus-leak token "${token}"`)
      : ["Salvatore leak reported but no tokens listed"]
    return { pass: false, issues }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      pass: false,
      issues: [`Leak check failed: ${msg}`],
    }
  }
}
