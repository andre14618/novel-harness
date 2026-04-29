/**
 * Promise extractor — corpus Stage 6 tool, NOT in the runtime pipeline.
 * Two-pass extraction (open then close), invoked from
 * scripts/corpus/extract-structure.ts on a per-book canonically-ordered
 * beats sequence.
 *
 * Per docs/charters/corpus-structural-decomposition-v1.md (R6) §3.
 * Model assignment in src/models/roles.ts under "structure-promise".
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

import { callAgent } from "../../llm"
import {
  buildPromiseOpenContext, buildPromiseCloseContext,
  type PromiseOpenContextInput, type PromiseCloseContextInput, type PromiseBeatRow,
} from "./context"
import {
  openPromiseListSchema, closurePromiseListSchema,
  type OpenPromise, type ClosurePromise, type FullPromise,
} from "./schema"

export {
  buildPromiseOpenContext, buildPromiseCloseContext,
  openPromiseListSchema, closurePromiseListSchema,
}
export type {
  PromiseOpenContextInput, PromiseCloseContextInput, PromiseBeatRow,
  OpenPromise, ClosurePromise, FullPromise,
}

const HERE = dirname(new URL(import.meta.url).pathname)
export const PROMISE_OPEN_SYSTEM = readFileSync(resolve(HERE, "promise-open-system.md"), "utf-8")
export const PROMISE_CLOSE_SYSTEM = readFileSync(resolve(HERE, "promise-close-system.md"), "utf-8")

export interface PromiseExtractResult {
  ok: boolean
  promises?: FullPromise[]
  /** Pass-1 raw output, useful for debugging mismatch between passes. */
  openOnly?: OpenPromise[]
  /** Pass-2 raw output. */
  closures?: ClosurePromise[]
  error?: string
}

export async function extractPromises(
  input: {
    novelKey: string
    bookKey: string
    beats: PromiseBeatRow[]
  },
  /** Override the agent role — used by llm-judge.ts to route the same
   *  prompt + schema through a different model (e.g. Cerebras 235B as
   *  cross-family judge) without duplicating the extractor logic. */
  opts?: { agentName?: string },
): Promise<PromiseExtractResult> {
  const agentName = (opts?.agentName ?? "structure-promise") as any
  // Pass 1 — open
  let openPromises: OpenPromise[]
  try {
    const userPrompt = buildPromiseOpenContext(input)
    const result = await callAgent({
      agentName,
      systemPrompt: PROMISE_OPEN_SYSTEM,
      userPrompt,
      schema: openPromiseListSchema,
    })
    openPromises = result.output.promises
  } catch (err) {
    return { ok: false, error: `pass-1 (open) failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (openPromises.length === 0) {
    return { ok: true, promises: [], openOnly: [], closures: [] }
  }

  // Pass 2 — closures
  let closures: ClosurePromise[]
  try {
    const userPrompt = buildPromiseCloseContext({ ...input, openPromises })
    const result = await callAgent({
      agentName,
      systemPrompt: PROMISE_CLOSE_SYSTEM,
      userPrompt,
      schema: closurePromiseListSchema,
    })
    closures = result.output.closures
  } catch (err) {
    return { ok: false, openOnly: openPromises, error: `pass-2 (close) failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Join open + closures by promise_id. Pass-2 may emit fewer rows
  // than pass-1 if the model skips ones it can't decide; we backfill
  // any missing closures as "still open at end of book" so every
  // promise_id flows through to the final registry.
  const closureById = new Map(closures.map(c => [c.promise_id, c]))
  const merged: FullPromise[] = openPromises.map(p => {
    const c = closureById.get(p.promise_id)
    return {
      promise_id: p.promise_id,
      promise_text: p.promise_text,
      opened_chapter_label: p.opened_chapter_label,
      opened_chapter_index: p.opened_chapter_index,
      closed_chapter_label: c?.closed_chapter_label ?? null,
      closed_chapter_index: c?.closed_chapter_index ?? null,
      // Zod's `.default([])` resolves to an array at parse time, but the
      // inferred input type keeps the field optional — fall back to [] so
      // downstream consumers never see undefined.
      hint_chapter_labels: p.hint_chapter_labels ?? [],
      hint_chapter_indices: p.hint_chapter_indices ?? [],
      payoff_quality: c?.payoff_quality ?? "unsatisfied",
      evidence_quote_open: p.evidence_quote_open,
      evidence_quote_close: c?.evidence_quote_close ?? null,
      confidence: c?.confidence ?? p.confidence,
    }
  })

  return { ok: true, promises: merged, openOnly: openPromises, closures }
}
