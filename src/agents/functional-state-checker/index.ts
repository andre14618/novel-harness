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
  /**
   * Stable-ID coverage (2026-05-04, additive). `beatId` is resolved
   * deterministically by the wrapper from `outline.scenes[beat_index]?.beatId`
   * when the outline is enriched and `beat_index` is in range. `plannedItemId`
   * is populated only on exact safe match (see `findingToWarning`); the
   * wrapper never invents an id from prose, paraphrases, or display names.
   * Both stay absent when no deterministic match exists. See
   * `docs/stable-id-checker-coverage.md`.
   */
  beatId?: string
  plannedItemId?: string
}

export interface FunctionalStateSuppressedFinding {
  reason: "supported" | "uncertain" | "self_contradiction" | "support_echo"
  kind: FunctionalStateCheckerFinding["kind"]
  verdict: FunctionalStateCheckerFinding["verdict"]
  plannedItem: string
  beatIndex: number | null
}

export interface FunctionalStateCheckResult {
  warnings: FunctionalStateWarning[]
  suppressedFindings?: FunctionalStateSuppressedFinding[]
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

    const warnings: FunctionalStateWarning[] = []
    const suppressedFindings: FunctionalStateSuppressedFinding[] = []
    for (const finding of (result.output.findings ?? [])
      .slice(0, 10)
      .map((f: any) => ({
        ...f,
        beat_index: f.beat_index ?? null,
        evidence_quote: f.evidence_quote ?? "",
      } as FunctionalStateCheckerFinding))) {
      const routing = routeFunctionalStateFinding(finding)
      if (routing !== "actionable") {
        suppressedFindings.push({
          reason: routing,
          kind: finding.kind,
          verdict: finding.verdict,
          plannedItem: finding.planned_item,
          beatIndex: finding.beat_index,
        })
        continue
      }
      warnings.push(findingToWarning(finding, prose, outline))
    }
    return { warnings, suppressedFindings }
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

export function findingToWarning(
  finding: FunctionalStateCheckerFinding,
  prose: string,
  outline?: ChapterOutline,
): FunctionalStateWarning {
  const quote = normalizeQuote(finding.evidence_quote)
  const normalizedProse = normalizeQuote(prose).toLowerCase()
  const validQuote = quote && normalizedProse.includes(quote.toLowerCase()) ? quote : ""
  const quoteText = validQuote ? ` Evidence: "${validQuote}"` : ""
  const warning: FunctionalStateWarning = {
    beat_index: finding.beat_index,
    description: `${finding.kind}: ${finding.planned_item}. ${finding.explanation}${quoteText}`,
  }
  if (outline) {
    const beatId = resolveBeatIdFromIndex(outline, finding.beat_index)
    if (beatId) warning.beatId = beatId
    const plannedItemId = resolvePlannedItemId(outline, finding)
    if (plannedItemId) warning.plannedItemId = plannedItemId
  }
  return warning
}

export function routeFunctionalStateFinding(
  finding: Pick<FunctionalStateCheckerFinding, "kind" | "verdict"> & Partial<Pick<FunctionalStateCheckerFinding, "planned_item" | "evidence_quote" | "explanation">>,
): "actionable" | FunctionalStateSuppressedFinding["reason"] {
  if (finding.verdict === "supported") return "supported"
  if (finding.verdict === "uncertain") return "uncertain"
  const expected = finding.kind === "planned_state_contradicted" ? "contradicted" : "missing"
  if (finding.verdict === expected && hasSupportEcho(finding)) return "support_echo"
  return finding.verdict === expected ? "actionable" : "self_contradiction"
}

function hasSupportEcho(
  finding: Partial<Pick<FunctionalStateCheckerFinding, "planned_item" | "evidence_quote" | "explanation">>,
): boolean {
  const text = [
    finding.planned_item,
    finding.evidence_quote,
    finding.explanation,
  ].filter(Boolean).join(" ").toLowerCase()
  if (!text) return false
  if (/\b(not supported|unsupported|no support|no supporting evidence|not clearly supported|not fully supported)\b/.test(text)) {
    return false
  }
  const supportLanguage = /\b(supported|supports|supporting)\b/.test(text) &&
    /\b(so|therefore|thus|actually|however|but|context|prose|scene|beat|draft)\b/.test(text)
  const positiveEvidenceLanguage =
    /\b(prose|draft|scene|beat)\s+(?:shows|describes|mentions|states|places|implies|establishes|depicts)\b/.test(text) ||
    /\b(?:shows|describes|mentions|states|places|implies|establishes|depicts)\b.+\b(prose|draft|scene|beat)\b/.test(text)
  const explicitnessOnlyGap =
    /\bdoes not explicitly state\b/.test(text) ||
    /\bnot explicitly stated\b/.test(text) ||
    /\bnever explicitly states\b/.test(text) ||
    /\bnot articulated as (?:a |an )?(?:discovery|knowledge|state change)\b/.test(text) ||
    /\bdoes not show (?:him|her|them|[a-z]+) (?:explicitly )?know(?:ing)?\b/.test(text)
  const concreteMismatch =
    /\bcontradicts?\b|\bconflicts?\b|\bnot (?:the same|in the same|actually|present|shown|mentioned|described)\b/.test(text) ||
    /\bdoes not (?:mention|describe|show|state)\b(?!\s+explicitly)/.test(text)
  return supportLanguage || (positiveEvidenceLanguage && explicitnessOnlyGap && !concreteMismatch)
}

function normalizeQuote(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

function resolveBeatIdFromIndex(
  outline: ChapterOutline,
  beatIndex: number | null,
): string | undefined {
  if (beatIndex === null || !Number.isInteger(beatIndex) || beatIndex < 0) return undefined
  const scene = outline.scenes?.[beatIndex]
  const beatId = scene && typeof scene.beatId === "string" && scene.beatId.length > 0
    ? scene.beatId
    : undefined
  return beatId
}

/**
 * Stable-ID hardening (2026-05-04, additive). Resolve `planned_item_id` only
 * on a deterministic safe match against the outline's planned-state
 * registry. Two safe paths:
 *
 *   1. The model already echoed an id (`planned_item_id`) that exactly
 *      matches one of the planned-item ids on the outline's
 *      establishedFacts / knowledgeChanges / characterStateChanges arrays.
 *   2. The emitted `planned_item` text exactly matches an established-fact
 *      `fact` string or a knowledge-change `knowledge` string (after
 *      `trim()`). Character-state items have no single canonical text field
 *      the model would echo, so text-fallback is fact/knowledge only.
 *
 * Anything else (paraphrase, substring, character-state display name guess,
 * empty input, missing id on the matched item) returns undefined. The
 * wrapper never invents an id.
 */
export function resolvePlannedItemId(
  outline: ChapterOutline,
  finding: Pick<FunctionalStateCheckerFinding, "kind" | "planned_item" | "planned_item_id">,
): string | undefined {
  const factIds = new Set<string>()
  const knowledgeIds = new Set<string>()
  const stateIds = new Set<string>()
  for (const fact of outline.establishedFacts ?? []) {
    if (fact.id) factIds.add(fact.id)
  }
  for (const change of outline.knowledgeChanges ?? []) {
    const id = (change as { id?: string }).id
    if (id) knowledgeIds.add(id)
  }
  for (const change of outline.characterStateChanges ?? []) {
    const id = (change as { id?: string }).id
    if (id) stateIds.add(id)
  }

  const emittedId = typeof finding.planned_item_id === "string"
    ? finding.planned_item_id.trim()
    : ""
  if (emittedId.length > 0) {
    if (factIds.has(emittedId) || knowledgeIds.has(emittedId) || stateIds.has(emittedId)) {
      return emittedId
    }
    // Emitted id did not match any planned-state registry entry — fall
    // through to the text-match path. The wrapper silently drops the
    // unverified id rather than copying it onto the warning.
  }

  const emittedText = typeof finding.planned_item === "string"
    ? finding.planned_item.trim()
    : ""
  if (emittedText.length === 0) return undefined

  for (const fact of outline.establishedFacts ?? []) {
    if (fact.id && typeof fact.fact === "string" && fact.fact.trim() === emittedText) {
      return fact.id
    }
  }
  for (const change of outline.knowledgeChanges ?? []) {
    const id = (change as { id?: string }).id
    const knowledge = (change as { knowledge?: string }).knowledge
    if (id && typeof knowledge === "string" && knowledge.trim() === emittedText) {
      return id
    }
  }
  // Character-state planned items have no canonical text surface the LLM
  // would echo — skip text-fallback so we never invent an id from a
  // composite display string. ID-path above is the only resolution route
  // for character_state_missing / planned_state_contradicted on state items.
  return undefined
}
