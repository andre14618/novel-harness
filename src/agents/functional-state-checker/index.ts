import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { callAgent } from "../../llm"
import type { ChapterOutline } from "../../types"
import { buildContext } from "./context"
import { functionalStateCheckerSchema, type FunctionalStateCheckerFinding } from "./schema"

export { buildContext, functionalStateCheckerSchema }
export type { FunctionalStateCheckerFinding }

export const FUNCTIONAL_STATE_CHECKER_SYSTEM = readFileSync(
  resolve(dirname(new URL(import.meta.url).pathname), "functional-state-checker-system.md"),
  "utf-8",
)

export interface FunctionalStateWarning {
  beat_index: number | null
  description: string
}

export interface FunctionalStateCheckResult {
  warnings: FunctionalStateWarning[]
  error?: string
}

export async function checkFunctionalStateGrounding(
  prose: string,
  outline: ChapterOutline,
  beatProses: string[],
  tags?: { novelId?: string; chapter?: number; attempt?: number },
): Promise<FunctionalStateCheckResult> {
  if (!hasPlannedState(outline) || beatProses.length === 0) return { warnings: [] }

  try {
    const result = await callAgent({
      novelId: tags?.novelId,
      chapter: tags?.chapter,
      attempt: tags?.attempt,
      agentName: "functional-state-checker",
      systemPrompt: FUNCTIONAL_STATE_CHECKER_SYSTEM,
      userPrompt: buildContext(outline, beatProses),
      schema: functionalStateCheckerSchema,
      logMetadata: {
        checkerSurface: "planned-state-vs-chapter-prose-by-beat",
        plannedStateCounts: {
          establishedFacts: outline.establishedFacts?.length ?? 0,
          characterStateChanges: outline.characterStateChanges?.length ?? 0,
          knowledgeChanges: outline.knowledgeChanges?.length ?? 0,
        },
      },
    })

    const warnings = result.output.findings
      .slice(0, 10)
      .map(f => findingToWarning(f, prose))
    return { warnings }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { warnings: [], error: msg }
  }
}

function hasPlannedState(outline: ChapterOutline): boolean {
  return (outline.establishedFacts?.length ?? 0) > 0
    || (outline.characterStateChanges?.length ?? 0) > 0
    || (outline.knowledgeChanges?.length ?? 0) > 0
}

function findingToWarning(finding: FunctionalStateCheckerFinding, prose: string): FunctionalStateWarning {
  const quote = normalizeQuote(finding.evidence_quote)
  const normalizedProse = normalizeQuote(prose).toLowerCase()
  const validQuote = quote && normalizedProse.includes(quote.toLowerCase()) ? quote : ""
  const quoteText = validQuote ? ` Evidence: "${validQuote}"` : ""
  return {
    beat_index: finding.beat_index,
    description: `${finding.kind}: ${finding.planned_item}. ${finding.explanation}${quoteText}`,
  }
}

function normalizeQuote(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}
