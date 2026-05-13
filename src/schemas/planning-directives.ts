import { z } from "zod"

// Reject generic role/archetype placeholders as character names. Fantasy
// legitimately uses "The X" naming ("The Compiler", "The Witch-King",
// "The Darkling") so we only block explicitly generic terms, not all
// "the + noun" patterns. The old regex /^(the|a|an)\s+\w+$/i was too
// aggressive — it blocked legitimate fantasy names and caused concept-
// phase failures on seeds like fantasy-archive (exp #211, 2026-04-16).
const GENERIC_NAMES = new Set([
  "the protagonist", "the antagonist", "the narrator", "the hero",
  "the heroine", "the villain", "the mentor", "the sidekick", "the rival",
  "the lover", "the love interest", "the ally", "the foil",
  "the warrior", "the healer", "the thief", "the mage", "the wizard",
  "the knight", "the soldier", "the guard", "the priest", "the priestess",
  "the farmer", "the merchant", "the innkeeper", "the bartender",
  "a warrior", "a healer", "a thief", "a mage", "a wizard",
  "a knight", "a soldier", "a guard", "a priest", "a farmer",
  "an assassin", "an archer", "an alchemist",
])
const ROLE_WORDS = new Set([
  "protagonist", "antagonist", "narrator", "hero", "heroine", "villain",
  "mentor", "sidekick", "rival", "lover", "love interest", "ally", "foil",
])
export function isValidCharacterName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  if (GENERIC_NAMES.has(trimmed.toLowerCase())) return false
  if (ROLE_WORDS.has(trimmed.toLowerCase())) return false
  if (!/[A-Z]/.test(trimmed)) return false
  return true
}
const properNameSchema = z.string().refine(isValidCharacterName, {
  message: "Character name must be a proper name, not a generic archetype ('the warrior', 'the mentor') or bare role word ('protagonist'). Fantasy titles like 'The Compiler' or 'The Witch-King' are fine.",
})

export const lockedCharacterSchema = z.object({
  name: properNameSchema,
  role: z.string().default(""),
  mustHaveTraits: z.array(z.string()).default([]),
  mustHaveArc: z.string().default(""),
})
export type LockedCharacter = z.infer<typeof lockedCharacterSchema>

export const requiredBeatSchema = z.object({
  chapter: z.number().optional(),
  description: z.string(),
  mustInclude: z.array(z.string()).default([]),
})
export type RequiredBeat = z.infer<typeof requiredBeatSchema>

// Coerce string→number on the numeric fields — LLMs frequently emit "3" instead
// of 3 for chapterCount / targetWordsPerChapter. Empty strings become undefined.
const coerceOptionalNumber = z.preprocess(
  (v) => {
    if (v === "" || v === null || v === undefined) return undefined
    if (typeof v === "string") {
      const n = Number(v.trim())
      return Number.isFinite(n) ? n : undefined
    }
    return v
  },
  z.number().optional(),
)

const coerceRequiredNumber = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      const n = Number(v.trim())
      return Number.isFinite(n) ? n : v
    }
    return v
  },
  z.number(),
)

export const structuralConstraintsSchema = z.object({
  chapterCount: coerceOptionalNumber,
  povRotation: z.string().default(""),
  pacing: z.string().default(""),
  targetWordsPerChapter: coerceOptionalNumber,
})
export type StructuralConstraints = z.infer<typeof structuralConstraintsSchema>

export const storyThreadDirectiveSchema = z.object({
  threadId: z.coerce.string().optional(),
  label: z.string(),
  description: z.string().default(""),
  kind: z.string().default(""),
})
export type StoryThreadDirective = z.infer<typeof storyThreadDirectiveSchema>

export const storyDebtDirectiveSchema = z.object({
  storyDebtId: z.coerce.string().optional(),
  threadId: z.coerce.string().optional(),
  promiseText: z.string(),
  openedByChapter: coerceOptionalNumber,
  expectedPayoffChapter: coerceOptionalNumber,
  payoffPolicy: z.string().default(""),
})
export type StoryDebtDirective = z.infer<typeof storyDebtDirectiveSchema>

export const storyPayoffDirectiveSchema = z.object({
  payoffId: z.coerce.string().optional(),
  storyDebtId: z.coerce.string().optional(),
  threadId: z.coerce.string().optional(),
  payoffText: z.string(),
  targetChapter: coerceOptionalNumber,
})
export type StoryPayoffDirective = z.infer<typeof storyPayoffDirectiveSchema>

export const chapterSequenceGuardSchema = z.object({
  guardId: z.coerce.string().default(""),
  chapter: coerceRequiredNumber,
  description: z.string().default(""),
  mustContainAny: z.array(z.string()).default([]),
  mustNotContain: z.array(z.string()).default([]),
}).refine(
  guard => guard.mustContainAny.length > 0 || guard.mustNotContain.length > 0,
  { message: "Chapter sequence guard must declare mustContainAny or mustNotContain" },
)
export type ChapterSequenceGuard = z.infer<typeof chapterSequenceGuardSchema>

export const chapterPlanningContractSchema = z.object({
  contractId: z.coerce.string().default(""),
  chapter: coerceRequiredNumber,
  storyFunction: z.string().default(""),
  ownedMovement: z.string().default(""),
  allowedStoryTerritory: z.array(z.string()).default([]),
  requiredEndpoint: z.string().default(""),
  handoffToNext: z.string().default(""),
  lockedFutureEvents: z.array(z.string()).default([]),
  prohibitedMovement: z.array(z.string()).default([]),
}).refine(
  contract =>
    contract.storyFunction.trim().length > 0 ||
    contract.ownedMovement.trim().length > 0 ||
    contract.requiredEndpoint.trim().length > 0,
  { message: "Chapter planning contract must declare storyFunction, ownedMovement, or requiredEndpoint" },
)
export type ChapterPlanningContract = z.infer<typeof chapterPlanningContractSchema>

export const planningDirectivesSchema = z.object({
  lockedCharacters: z.array(lockedCharacterSchema).default([]),
  requiredBeats: z.array(requiredBeatSchema).default([]),
  forbidden: z.array(z.string()).default([]),
  tonalAnchors: z.array(z.string()).default([]),
  structuralConstraints: structuralConstraintsSchema.default({}),
  storyThreads: z.array(storyThreadDirectiveSchema).default([]),
  storyDebts: z.array(storyDebtDirectiveSchema).default([]),
  storyPayoffs: z.array(storyPayoffDirectiveSchema).default([]),
  chapterContracts: z.array(chapterPlanningContractSchema).default([]),
  chapterSequenceGuards: z.array(chapterSequenceGuardSchema).default([]),
  rawNotes: z.string().default(""),
})
export type PlanningDirectives = z.infer<typeof planningDirectivesSchema>

export interface NormalizedPlanningDirectiveRefs {
  storyThreads: Array<StoryThreadDirective & { threadId: string }>
  storyDebts: Array<StoryDebtDirective & { storyDebtId: string; threadId: string }>
  storyPayoffs: Array<StoryPayoffDirective & { payoffId: string; storyDebtId: string; threadId: string }>
}

export const directorTurnSchema = z.object({
  assistantMessage: z.string(),
  directives: planningDirectivesSchema,
  readyToPlan: z.boolean().default(false),
})
export type DirectorTurn = z.infer<typeof directorTurnSchema>

export const schema = directorTurnSchema

export const emptyDirectives: PlanningDirectives = {
  lockedCharacters: [],
  requiredBeats: [],
  forbidden: [],
  tonalAnchors: [],
  structuralConstraints: {
    povRotation: "",
    pacing: "",
  },
  storyThreads: [],
  storyDebts: [],
  storyPayoffs: [],
  chapterContracts: [],
  chapterSequenceGuards: [],
  rawNotes: "",
}

export function normalizePlanningDirectiveRefs(d: PlanningDirectives): NormalizedPlanningDirectiveRefs {
  const threadIds = new Set<string>()
  const storyThreads = d.storyThreads.map((thread, index) => {
    const threadId = directiveId("thread", thread.threadId || thread.label || thread.description, index, threadIds)
    return { ...thread, threadId }
  })
  const fallbackThreadId = storyThreads.length === 1 ? storyThreads[0]!.threadId : ""
  const debtIds = new Set<string>()
  const storyDebts = d.storyDebts.map((debt, index) => {
    const storyDebtId = directiveId("debt", debt.storyDebtId || debt.promiseText, index, debtIds)
    const threadId = debt.threadId || fallbackThreadId
      ? normalizeReferenceId("thread", debt.threadId || fallbackThreadId)
      : directiveId("thread", debt.promiseText, index, threadIds)
    return { ...debt, storyDebtId, threadId }
  })
  const debtById = new Map(storyDebts.map(debt => [debt.storyDebtId, debt]))
  const payoffIds = new Set<string>()
  const storyPayoffs = d.storyPayoffs.map((payoff, index) => {
    const storyDebtId = payoff.storyDebtId
      ? normalizeReferenceId("debt", payoff.storyDebtId)
      : storyDebts[index]?.storyDebtId ?? directiveId("debt", payoff.payoffText, index, debtIds)
    const debt = debtById.get(storyDebtId)
    const threadId = payoff.threadId || debt?.threadId || fallbackThreadId
      ? normalizeReferenceId("thread", payoff.threadId || debt?.threadId || fallbackThreadId)
      : directiveId("thread", payoff.payoffText, index, threadIds)
    const payoffId = directiveId("payoff", payoff.payoffId || payoff.payoffText, index, payoffIds)
    return { ...payoff, payoffId, storyDebtId, threadId }
  })
  return { storyThreads, storyDebts, storyPayoffs }
}

export function renderDirectivesForPlanner(d: PlanningDirectives): string {
  const sections: string[] = []
  const refs = normalizePlanningDirectiveRefs(d)

  if (d.lockedCharacters.length) {
    sections.push(
      `LOCKED CHARACTERS (must appear, preserve these attributes):\n${
        d.lockedCharacters.map(c => {
          const parts = [`- ${c.name}${c.role ? ` (${c.role})` : ""}`]
          if (c.mustHaveTraits.length) parts.push(`  Traits: ${c.mustHaveTraits.join(", ")}`)
          if (c.mustHaveArc) parts.push(`  Arc: ${c.mustHaveArc}`)
          return parts.join("\n")
        }).join("\n")
      }`,
    )
  }

  if (d.requiredBeats.length) {
    sections.push(
      `REQUIRED BEATS (must appear somewhere in the outline):\n${
        d.requiredBeats.map(b => {
          const where = b.chapter !== undefined ? `Ch ${b.chapter}` : "any chapter"
          const inc = b.mustInclude.length ? ` [must include: ${b.mustInclude.join(", ")}]` : ""
          return `- (${where}) ${b.description}${inc}`
        }).join("\n")
      }`,
    )
  }

  if (d.forbidden.length) {
    sections.push(`FORBIDDEN (do NOT include any of these):\n${d.forbidden.map(f => `- ${f}`).join("\n")}`)
  }

  if (d.tonalAnchors.length) {
    sections.push(`TONAL ANCHORS: ${d.tonalAnchors.join("; ")}`)
  }

  const sc = d.structuralConstraints
  const scParts: string[] = []
  if (sc.chapterCount) scParts.push(`Chapter count: ${sc.chapterCount}`)
  if (sc.povRotation) scParts.push(`POV rotation: ${sc.povRotation}`)
  if (sc.pacing) scParts.push(`Pacing: ${sc.pacing}`)
  if (sc.targetWordsPerChapter) scParts.push(`Target words/chapter: ${sc.targetWordsPerChapter}`)
  if (scParts.length) sections.push(`STRUCTURAL CONSTRAINTS:\n${scParts.map(p => `- ${p}`).join("\n")}`)

  const chapterContracts = d.chapterContracts ?? []
  if (chapterContracts.length) sections.push(renderChapterContractsForPlanner(chapterContracts))

  const chapterSequenceGuards = d.chapterSequenceGuards ?? []
  if (chapterSequenceGuards.length) {
    sections.push(
      `CHAPTER SEQUENCE GUARDS (hard order constraints; keep events in their owning chapter):\n${
        chapterSequenceGuards.map(guard => {
          const mustContainAny = guard.mustContainAny ?? []
          const mustNotContain = guard.mustNotContain ?? []
          const parts = [`- Ch ${guard.chapter}${guard.guardId ? ` [${guard.guardId}]` : ""}: ${guard.description || "sequence guard"}`]
          if (mustContainAny.length) parts.push(`  Must contain at least one: ${mustContainAny.join("; ")}`)
          if (mustNotContain.length) parts.push(`  Must not contain: ${mustNotContain.join("; ")}`)
          return parts.join("\n")
        }).join("\n")
      }`,
    )
  }

  sections.push(...renderStoryThreadSections(refs))

  if (d.rawNotes.trim()) sections.push(`AUTHOR NOTES:\n${d.rawNotes.trim()}`)

  if (!sections.length) return ""
  return `\n\nDIRECTIVES (author-specified, override planner defaults where they conflict):\n${sections.join("\n\n")}`
}

export function renderDirectivesForSceneExpansion(d: PlanningDirectives, targetChapter: number): string {
  const sections: string[] = []
  const refs = normalizePlanningDirectiveRefs(d)
  const boundaryTerms = planningBoundaryTermsForChapter(d, targetChapter)

  if (d.lockedCharacters.length) {
    sections.push(
      `LOCKED CHARACTER ROSTER (names/roles only; use the chapter character context for current-scene traits):\n${
        d.lockedCharacters.map(c => {
          return `- ${c.name}${c.role ? ` (${c.role})` : ""}`
        }).join("\n")
      }`,
    )
  }

  const targetContracts = (d.chapterContracts ?? []).filter(contract => contract.chapter === targetChapter)
  if (targetContracts.length) {
    sections.push(renderTargetChapterContracts(targetContracts, boundaryTerms))
  }

  const targetBeats = d.requiredBeats.filter(beat => beat.chapter === targetChapter || beat.chapter === undefined)
  if (targetBeats.length) {
    sections.push(renderTargetRequiredBeats(targetBeats, boundaryTerms, targetChapter))
  }

  const adjacent = renderAdjacentChapterHandoffs(d.chapterContracts ?? [], targetChapter, boundaryTerms)
  if (adjacent) sections.push(adjacent)

  if (d.forbidden.length) {
    const safeForbidden = d.forbidden.filter(item => !directiveTextContainsBoundaryTerm(item, boundaryTerms))
    const withheld = d.forbidden.length - safeForbidden.length
    const lines = safeForbidden.map(f => `- ${f}`)
    if (withheld > 0) {
      lines.push(`- ${withheld} future-boundary forbidden item${withheld === 1 ? "" : "s"} withheld from the prompt; sequence guards enforce timing.`)
    }
    if (lines.length) sections.push(`GLOBAL FORBIDDEN (applies to this chapter too):\n${lines.join("\n")}`)
  }
  if (d.tonalAnchors.length) {
    sections.push(`TONAL ANCHORS: ${d.tonalAnchors.join("; ")}`)
  }

  const scopedStoryRefs = renderScopedStoryThreadSections(refs, targetChapter, boundaryTerms)
  sections.push(...scopedStoryRefs)

  if (!sections.length) return ""
  return `\n\nCHAPTER-SCOPED DIRECTIVES (decomposed before scene expansion; do not borrow future-chapter movement):\n${sections.join("\n\n")}`
}

function renderChapterContractsForPlanner(contracts: readonly ChapterPlanningContract[]): string {
  return `CHAPTER CONTRACTS (chapter ownership decomposition; scene expansion must fill, not reinterpret):\n${
    contracts.map(contract => {
      const parts = [`- Ch ${contract.chapter}${contract.contractId ? ` [${contract.contractId}]` : ""}`]
      if (contract.storyFunction) parts.push(`  Function: ${contract.storyFunction}`)
      if (contract.ownedMovement) parts.push(`  Owns: ${contract.ownedMovement}`)
      if (contract.allowedStoryTerritory.length) parts.push(`  Allowed territory: ${contract.allowedStoryTerritory.join("; ")}`)
      if (contract.requiredEndpoint) parts.push(`  Required endpoint: ${contract.requiredEndpoint}`)
      if (contract.handoffToNext) parts.push(`  Handoff: ${contract.handoffToNext}`)
      if (contract.lockedFutureEvents.length) parts.push(`  Locked future events: ${contract.lockedFutureEvents.join("; ")}`)
      if (contract.prohibitedMovement.length) parts.push(`  Prohibited movement: ${contract.prohibitedMovement.join("; ")}`)
      return parts.join("\n")
    }).join("\n")
  }`
}

function renderTargetChapterContracts(
  targetContracts: readonly ChapterPlanningContract[],
  boundaryTerms: readonly string[],
): string {
  const rendered = targetContracts.map(contract => {
    const allowedStoryTerritory = contract.allowedStoryTerritory ?? []
    const lockedFutureEvents = contract.lockedFutureEvents ?? []
    const prohibitedMovement = contract.prohibitedMovement ?? []
    const parts = [`- Ch ${contract.chapter}${contract.contractId ? ` [${contract.contractId}]` : ""}`]
    if (contract.storyFunction) parts.push(`  Story function: ${contract.storyFunction}`)
    if (contract.ownedMovement) {
      parts.push(`  Owned movement: ${redactBoundaryText(
        contract.ownedMovement,
        boundaryTerms,
        "Withheld here because it includes future-boundary material; use allowed story territory and required endpoint.",
      )}`)
    }
    if (allowedStoryTerritory.length) parts.push(`  Allowed story territory: ${allowedStoryTerritory.join("; ")}`)
    if (contract.requiredEndpoint) {
      parts.push(`  Required endpoint: ${redactBoundaryText(
        contract.requiredEndpoint,
        boundaryTerms,
        "Execute the owned movement without consuming withheld future-boundary material.",
      )}`)
    }
    if (contract.handoffToNext) {
      parts.push(`  Handoff to next chapter: ${redactBoundaryText(
        contract.handoffToNext,
        boundaryTerms,
        "Withheld here because it names future-boundary material.",
      )}`)
    }
    const withheldBoundaryCount = lockedFutureEvents.length + prohibitedMovement.length
    if (withheldBoundaryCount > 0) {
      parts.push(`  Boundary locks: ${withheldBoundaryCount} future/prohibited movements are withheld from this expansion; fill only the owned movement and required endpoint.`)
    }
    return parts.join("\n")
  }).join("\n")
  return `TARGET CHAPTER CONTRACT (primary expansion source; fill this contract only):\n${rendered}\n\nExpansion rule: author scene entries that execute the owned movement and required endpoint. Treat withheld boundary details as unavailable story material for this chapter.`
}

function renderTargetRequiredBeats(
  beats: readonly RequiredBeat[],
  boundaryTerms: readonly string[],
  targetChapter: number,
): string {
  const rendered = beats.map(beat => {
    const mustInclude = beat.mustInclude ?? []
    const description = directiveTextContainsBoundaryTerm(beat.description, boundaryTerms)
      ? `Chapter ${targetChapter} required movement from the target contract`
      : beat.description
    const safeIncludes = mustInclude.filter(item => !directiveTextContainsBoundaryTerm(item, boundaryTerms))
    const inc = safeIncludes.length ? ` [must include: ${safeIncludes.join(", ")}]` : ""
    const withheld = mustInclude.length - safeIncludes.length
    const withheldNote = withheld > 0
      ? ` [${withheld} future-boundary item${withheld === 1 ? "" : "s"} withheld; sequence guards enforce timing]`
      : ""
    return `- ${description}${inc}${withheldNote}`
  }).join("\n")
  return `TARGET REQUIRED BEATS (only this chapter may execute these now):\n${rendered}`
}

function renderAdjacentChapterHandoffs(
  contracts: readonly ChapterPlanningContract[],
  targetChapter: number,
  boundaryTerms: readonly string[],
): string {
  const previous = contracts.find(contract => contract.chapter === targetChapter - 1)
  const next = contracts.find(contract => contract.chapter === targetChapter + 1)
  const lines: string[] = []
  if (previous?.requiredEndpoint || previous?.handoffToNext) {
    lines.push(`Previous chapter arrives with: ${redactBoundaryText(
      previous.requiredEndpoint || previous.handoffToNext,
      boundaryTerms,
      "Withheld here because it names future-boundary material.",
    )}`)
  }
  if (next?.storyFunction || next?.ownedMovement) {
    lines.push(`Next chapter owns after this handoff: ${redactBoundaryText(
      next.storyFunction || next.ownedMovement,
      boundaryTerms,
      "Withheld here because it names future-boundary material.",
    )}`)
  }
  if (lines.length === 0) return ""
  return `ADJACENT HANDOFFS (boundary awareness, not extra content):\n${lines.map(line => `- ${line}`).join("\n")}`
}

/**
 * Render directives for concept-phase agents (world-builder, character-agent, plotter).
 * Narrower than the planner version — concept agents only need author intent that shapes
 * world/character/structure decisions. Required beats are planner-only.
 */
export function renderDirectivesForConcept(d: PlanningDirectives): string {
  const sections: string[] = []
  const refs = normalizePlanningDirectiveRefs(d)

  if (d.lockedCharacters.length) {
    sections.push(
      `LOCKED CHARACTERS (author has specified these — preserve names, roles, traits, and arcs):\n${
        d.lockedCharacters.map(c => {
          const parts = [`- ${c.name}${c.role ? ` (${c.role})` : ""}`]
          if (c.mustHaveTraits.length) parts.push(`  Traits: ${c.mustHaveTraits.join(", ")}`)
          if (c.mustHaveArc) parts.push(`  Arc: ${c.mustHaveArc}`)
          return parts.join("\n")
        }).join("\n")
      }`,
    )
  }

  if (d.forbidden.length) {
    sections.push(`FORBIDDEN (do NOT include any of these):\n${d.forbidden.map(f => `- ${f}`).join("\n")}`)
  }

  if (d.tonalAnchors.length) {
    sections.push(`TONAL ANCHORS: ${d.tonalAnchors.join("; ")}`)
  }

  const sc = d.structuralConstraints
  const scParts: string[] = []
  if (sc.chapterCount) scParts.push(`Chapter count: ${sc.chapterCount}`)
  if (sc.povRotation) scParts.push(`POV rotation: ${sc.povRotation}`)
  if (sc.pacing) scParts.push(`Pacing: ${sc.pacing}`)
  if (scParts.length) sections.push(`STRUCTURAL CONSTRAINTS:\n${scParts.map(p => `- ${p}`).join("\n")}`)

  sections.push(...renderStoryThreadSections(refs))

  if (d.rawNotes.trim()) sections.push(`AUTHOR NOTES:\n${d.rawNotes.trim()}`)

  if (!sections.length) return ""
  return `\n\nAUTHOR DIRECTIVES (from pre-planning chat — honor these over any generic defaults):\n${sections.join("\n\n")}`
}

export function isEmpty(d: PlanningDirectives): boolean {
  return (
    d.lockedCharacters.length === 0 &&
    d.requiredBeats.length === 0 &&
    d.forbidden.length === 0 &&
    d.tonalAnchors.length === 0 &&
    d.storyThreads.length === 0 &&
    d.storyDebts.length === 0 &&
    d.storyPayoffs.length === 0 &&
    d.chapterContracts.length === 0 &&
    d.chapterSequenceGuards.length === 0 &&
    !d.structuralConstraints.chapterCount &&
    !d.structuralConstraints.povRotation &&
    !d.structuralConstraints.pacing &&
    !d.structuralConstraints.targetWordsPerChapter &&
    !d.rawNotes.trim()
  )
}

export function planningBoundaryTermsForChapter(d: PlanningDirectives, targetChapter: number): string[] {
  const terms: string[] = []
  for (const guard of d.chapterSequenceGuards ?? []) {
    if (guard.chapter < targetChapter) continue
    terms.push(...(guard.mustNotContain ?? []))
  }
  for (const contract of d.chapterContracts ?? []) {
    if (contract.chapter < targetChapter) continue
    terms.push(...(contract.lockedFutureEvents ?? []), ...(contract.prohibitedMovement ?? []))
  }
  const seen = new Set<string>()
  return terms
    .map(term => term.trim())
    .filter(term => term.length > 2)
    .filter(term => {
      const key = normalizeBoundaryText(term)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function directiveTextContainsBoundaryTerm(text: string, terms: readonly string[]): boolean {
  const normalizedText = normalizeBoundaryText(text)
  if (!normalizedText) return false
  return terms.some(term => {
    const normalizedTerm = normalizeBoundaryText(term)
    if (normalizedTerm.length <= 2) return false
    if (normalizedText.includes(normalizedTerm)) return true
    if (/\bcores?\b/.test(normalizedTerm) && /\bcores?\b/.test(normalizedText)) return true
    if (/\bharvest\b/.test(normalizedTerm) && /\bharvest\w*\b/.test(normalizedText)) return true
    if (/\bsealed chamber\b/.test(normalizedTerm) && /\bsealed chamber\b/.test(normalizedText)) return true
    if (/\boperation\b/.test(normalizedTerm) && /\boperation\b/.test(normalizedText)) return true
    return false
  })
}

export function redactBoundaryText(text: string, terms: readonly string[], fallback: string): string {
  return directiveTextContainsBoundaryTerm(text, terms) ? fallback : text
}

function normalizeBoundaryText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
}

function renderStoryThreadSections(refs: NormalizedPlanningDirectiveRefs): string[] {
  const sections: string[] = []
  if (refs.storyThreads.length) {
    sections.push(
      `STORY THREADS (preserve exact IDs in downstream obligations):\n${
        refs.storyThreads.map(t => {
          const parts = [`- threadId=${t.threadId}: ${t.label}`]
          if (t.kind) parts.push(`  Kind: ${t.kind}`)
          if (t.description) parts.push(`  Description: ${t.description}`)
          return parts.join("\n")
        }).join("\n")
      }`,
    )
  }
  if (refs.storyDebts.length) {
    sections.push(
      `STORY DEBTS / PROMISES (use storyDebtId as obligation promiseId):\n${
        refs.storyDebts.map(d => {
          const parts = [`- promiseId=${d.storyDebtId} threadId=${d.threadId}: ${d.promiseText}`]
          if (d.openedByChapter) parts.push(`  Opens by chapter: ${d.openedByChapter}`)
          if (d.expectedPayoffChapter) parts.push(`  Expected payoff chapter: ${d.expectedPayoffChapter}`)
          if (d.payoffPolicy) parts.push(`  Payoff policy: ${d.payoffPolicy}`)
          return parts.join("\n")
        }).join("\n")
      }`,
    )
  }
  if (refs.storyPayoffs.length) {
    sections.push(
      `STORY PAYOFF TARGETS (use payoffId only when the payoff lands):\n${
        refs.storyPayoffs.map(p => {
          const parts = [`- payoffId=${p.payoffId} promiseId=${p.storyDebtId} threadId=${p.threadId}: ${p.payoffText}`]
          if (p.targetChapter) parts.push(`  Target chapter: ${p.targetChapter}`)
          return parts.join("\n")
        }).join("\n")
      }`,
    )
  }
  if (sections.length) {
    sections.push("STORY REF RULE: preserve threadId, promiseId, and payoffId exactly. Do not invent new story refs when none apply.")
  }
  return sections
}

function renderScopedStoryThreadSections(
  refs: NormalizedPlanningDirectiveRefs,
  targetChapter: number,
  boundaryTerms: readonly string[],
): string[] {
  const sections: string[] = []
  if (refs.storyThreads.length) {
    sections.push(
      `STORY THREAD IDS (reference only; do not widen this chapter):\n${
        refs.storyThreads.map(t => {
          const kind = t.kind ? ` (${t.kind})` : ""
          return `- threadId=${t.threadId}${kind}: ${t.label}`
        }).join("\n")
      }`,
    )
  }
  const activeDebts = refs.storyDebts.filter(debt =>
    (debt.openedByChapter ?? 1) <= targetChapter,
  )
  const futureDebts = refs.storyDebts.filter(debt =>
    (debt.openedByChapter ?? 1) > targetChapter,
  )
  if (activeDebts.length) {
    sections.push(
      `ACTIVE STORY DEBTS (use only if this chapter's contract touches them):\n${
        activeDebts.map(debt => {
          const promiseText = redactBoundaryText(
            debt.promiseText,
            boundaryTerms,
            "Withheld here because it names future-boundary payoff material; preserve the ID without opening or resolving it early.",
          )
          const parts = [`- promiseId=${debt.storyDebtId} threadId=${debt.threadId}: ${promiseText}`]
          if (debt.expectedPayoffChapter) parts.push(`  Expected payoff chapter: ${debt.expectedPayoffChapter}`)
          if (debt.payoffPolicy) {
            parts.push(`  Payoff policy: ${redactBoundaryText(
              debt.payoffPolicy,
              boundaryTerms,
              "Withheld here because it belongs to a later payoff boundary.",
            )}`)
          }
          return parts.join("\n")
        }).join("\n")
      }`,
    )
  }
  if (futureDebts.length) {
    sections.push(
      `LOCKED FUTURE STORY DEBTS (ID/timing awareness only; do not open early):\n${
        futureDebts.map(debt => `- promiseId=${debt.storyDebtId} opens by chapter ${debt.openedByChapter ?? "later"}`).join("\n")
      }`,
    )
  }
  const targetPayoffs = refs.storyPayoffs.filter(payoff =>
    payoff.targetChapter === undefined || payoff.targetChapter <= targetChapter,
  )
  if (targetPayoffs.length) {
    sections.push(
      `PAYOFF TARGETS AVAILABLE OR UNSCHEDULED BY THIS CHAPTER:\n${
        targetPayoffs.map(payoff => {
          const payoffText = redactBoundaryText(
            payoff.payoffText,
            boundaryTerms,
            "Withheld here because it names future-boundary material.",
          )
          return `- payoffId=${payoff.payoffId} promiseId=${payoff.storyDebtId}: ${payoffText}`
        }).join("\n")
      }`,
    )
  }
  if (sections.length) {
    sections.push("STORY REF RULE: preserve existing IDs exactly. Do not invent new story refs and do not pay off a future target early.")
  }
  return sections
}

function directiveId(prefix: string, raw: string | undefined, index: number, seen: Set<string>): string {
  const base = normalizeReferenceId(prefix, raw || `${prefix}-${index + 1}`)
  if (!seen.has(base)) {
    seen.add(base)
    return base
  }
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}-${suffix}`
    if (!seen.has(candidate)) {
      seen.add(candidate)
      return candidate
    }
  }
  const fallback = `${base}-${index + 1}`
  seen.add(fallback)
  return fallback
}

function normalizeReferenceId(prefix: string, raw: string | undefined): string {
  const slug = directiveSlugify(raw || prefix) || prefix
  return slug.startsWith(`${prefix}-`) ? slug : `${prefix}-${slug}`
}

function directiveSlugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join("-")
}
