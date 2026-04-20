import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import { buildContext } from "./context"
import { hallucLeakSalvatoreSchema, type HallucLeakSalvatoreOutput } from "./schema"
import { regexLeakMatches } from "./regex-leak"

export { buildContext, hallucLeakSalvatoreSchema, regexLeakMatches }
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
 * Runtime wrapper for the `halluc-leak-salvatore-v1:v1` W&B adapter
 * OR-combined with a deterministic regex matcher at inference time.
 *
 * OR-combine rationale (Rung 0 of docs/scoping/halluc-leak-salvatore-v2.md,
 * 2026-04-20): the adapter under-fires on canonical FR names the writer
 * LoRA leaks from its training corpus — Harpells, Baldur's Gate, and
 * Waterdeep together accounted for 82 beat-level misses across 32
 * production novels, with ~95% precision on a human spot-check. The
 * regex closes that recall gap for $0 training spend. Tokens are listed
 * in `regex-leak.ts`.
 *
 * Intended to run only when the writer is routed through the Salvatore
 * voice pack — the drafting loop decides gating, not this module. Never
 * throws into the drafting loop; any transport/schema failure is
 * normalized into a blocking issue so retries can still decide.
 */
export async function checkHallucLeakSalvatore(
  prose: string,
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; attempt?: number },
): Promise<HallucLeakSalvatoreResult> {
  // Regex runs first — deterministic, sub-millisecond, no network. If the
  // adapter call fails we still have the regex signal.
  const regexTokens = regexLeakMatches(prose)

  let adapterTokens: string[] = []
  let adapterError: string | null = null
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
    if (output.has_leak) {
      // Zod's `.default([])` resolves at parse time, but the inferred input
      // type keeps `leaks` optional — coalesce so consumers never see undefined.
      adapterTokens = output.leaks ?? []
    }
  } catch (err) {
    adapterError = err instanceof Error ? err.message : String(err)
  }

  // Union of adapter + regex, case-insensitive dedupe preserving the
  // adapter's casing when both sides fire on the same token.
  const union: string[] = []
  const seen = new Set<string>()
  for (const t of [...adapterTokens, ...regexTokens]) {
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    union.push(t)
  }

  if (union.length === 0 && adapterError === null) {
    return { pass: true, issues: [] }
  }

  const issues: string[] = []
  if (adapterError !== null) {
    issues.push(`Leak check adapter failed: ${adapterError}`)
  }
  for (const token of union) {
    issues.push(`Salvatore corpus-leak token "${token}"`)
  }

  return { pass: false, issues }
}
