import type { ChapterOutline } from "../types"
import type { PlanningDirectives } from "../schemas/planning-directives"
import { normalizePlanningDirectiveRefs } from "../schemas/planning-directives"

const OBLIGATION_LIST_KEYS = [
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
  "mustNotReveal",
] as const

type ObligationListKey = typeof OBLIGATION_LIST_KEYS[number]

export type StoryRefIssueCode =
  | "unknown_thread_id"
  | "unknown_promise_id"
  | "unknown_payoff_id"
  | "promise_thread_mismatch"
  | "payoff_promise_mismatch"
  | "payoff_thread_mismatch"
  | "payoff_ref_on_non_payoff_stage"
  | "payoff_stage_missing_payoff_id"

export interface StoryRefIssue {
  severity: "warning"
  code: StoryRefIssueCode
  chapterId?: string
  beatId?: string
  beatIndex: number
  obligationId?: string
  obligationListKey: ObligationListKey
  detail: string
  refs: {
    threadId?: string
    promiseId?: string
    payoffId?: string
    expectedThreadId?: string
    expectedPromiseId?: string
  }
}

export interface StoryRefValidation {
  issues: StoryRefIssue[]
  summary: {
    checkedObligations: number
    issueCount: number
    threadRefCount: number
    promiseRefCount: number
    payoffRefCount: number
  }
}

interface ObligationSlot {
  beatId?: string
  beatIndex: number
  listKey: ObligationListKey
  obligation: Record<string, unknown>
}

export function validateOutlineStoryRefs(
  outline: ChapterOutline,
  directives: PlanningDirectives | undefined,
): StoryRefValidation {
  const refs = directives ? normalizePlanningDirectiveRefs(directives) : { storyThreads: [], storyDebts: [], storyPayoffs: [] }
  const knownThreadIds = new Set([
    ...refs.storyThreads.map(t => t.threadId),
    ...refs.storyDebts.map(d => d.threadId),
    ...refs.storyPayoffs.map(p => p.threadId),
  ].filter(Boolean))
  const knownPromiseIds = new Set([
    ...refs.storyDebts.map(d => d.storyDebtId),
    ...refs.storyPayoffs.map(p => p.storyDebtId),
  ].filter(Boolean))
  const knownPayoffIds = new Set(refs.storyPayoffs.map(p => p.payoffId).filter(Boolean))
  const promiseById = new Map(refs.storyDebts.map(d => [d.storyDebtId, d]))
  const payoffById = new Map(refs.storyPayoffs.map(p => [p.payoffId, p]))
  const payoffsByPromise = groupBy(refs.storyPayoffs, p => p.storyDebtId)
  const issues: StoryRefIssue[] = []
  let checkedObligations = 0
  let threadRefCount = 0
  let promiseRefCount = 0
  let payoffRefCount = 0

  for (const slot of collectObligationSlots(outline)) {
    const threadId = stringOrUndefined(slot.obligation.threadId)
    const promiseId = stringOrUndefined(slot.obligation.promiseId)
    const payoffId = stringOrUndefined(slot.obligation.payoffId)
    const storyDebtStage = stringOrUndefined(slot.obligation.storyDebtStage)
    if (!threadId && !promiseId && !payoffId && !storyDebtStage) continue
    checkedObligations++
    if (threadId) threadRefCount++
    if (promiseId) promiseRefCount++
    if (payoffId) payoffRefCount++

    if (threadId && !knownThreadIds.has(threadId)) {
      issues.push(issue(outline, slot, "unknown_thread_id", `threadId ${threadId} is not declared in planning directives`, { threadId }))
    }
    if (promiseId && !knownPromiseIds.has(promiseId)) {
      issues.push(issue(outline, slot, "unknown_promise_id", `promiseId ${promiseId} is not declared in planning directives`, { threadId, promiseId }))
    }
    if (payoffId && !knownPayoffIds.has(payoffId)) {
      issues.push(issue(outline, slot, "unknown_payoff_id", `payoffId ${payoffId} is not declared in planning directives`, { threadId, promiseId, payoffId }))
    }

    const promise = promiseId ? promiseById.get(promiseId) : undefined
    if (promise && threadId && promise.threadId !== threadId) {
      issues.push(issue(outline, slot, "promise_thread_mismatch", `promiseId ${promiseId} belongs to threadId ${promise.threadId}, not ${threadId}`, {
        threadId,
        promiseId,
        expectedThreadId: promise.threadId,
      }))
    }

    const payoff = payoffId ? payoffById.get(payoffId) : undefined
    if (payoff && promiseId && payoff.storyDebtId !== promiseId) {
      issues.push(issue(outline, slot, "payoff_promise_mismatch", `payoffId ${payoffId} belongs to promiseId ${payoff.storyDebtId}, not ${promiseId}`, {
        threadId,
        promiseId,
        payoffId,
        expectedPromiseId: payoff.storyDebtId,
      }))
    }
    if (payoff && threadId && payoff.threadId !== threadId) {
      issues.push(issue(outline, slot, "payoff_thread_mismatch", `payoffId ${payoffId} belongs to threadId ${payoff.threadId}, not ${threadId}`, {
        threadId,
        promiseId,
        payoffId,
        expectedThreadId: payoff.threadId,
      }))
    }

    if (payoffId && (storyDebtStage === "open" || storyDebtStage === "progress")) {
      issues.push(issue(outline, slot, "payoff_ref_on_non_payoff_stage", `payoffId ${payoffId} is present but storyDebtStage is ${storyDebtStage}`, {
        threadId,
        promiseId,
        payoffId,
      }))
    }
    if ((storyDebtStage === "partial_payoff" || storyDebtStage === "final_payoff")
      && !payoffId
      && promiseId
      && (payoffsByPromise.get(promiseId)?.length ?? 0) > 0) {
      issues.push(issue(outline, slot, "payoff_stage_missing_payoff_id", `storyDebtStage ${storyDebtStage} should name a payoffId for promiseId ${promiseId}`, {
        threadId,
        promiseId,
      }))
    }
  }

  return {
    issues,
    summary: {
      checkedObligations,
      issueCount: issues.length,
      threadRefCount,
      promiseRefCount,
      payoffRefCount,
    },
  }
}

export function formatStoryRefIssue(issue: StoryRefIssue): string {
  const beat = issue.beatId ?? `beatIndex:${issue.beatIndex}`
  const obligation = issue.obligationId ? ` obligation=${issue.obligationId}` : ""
  return `${issue.code} ${beat}${obligation}: ${issue.detail}`
}

function collectObligationSlots(outline: ChapterOutline): ObligationSlot[] {
  const slots: ObligationSlot[] = []
  for (let beatIndex = 0; beatIndex < (outline.scenes ?? []).length; beatIndex++) {
    const beat = outline.scenes[beatIndex]!
    const obligations = beat.obligations as unknown as Record<ObligationListKey, Record<string, unknown>[]>
    for (const listKey of OBLIGATION_LIST_KEYS) {
      for (const obligation of obligations[listKey] ?? []) {
        slots.push({ beatId: beat.beatId, beatIndex, listKey, obligation })
      }
    }
  }
  return slots
}

function issue(
  outline: ChapterOutline,
  slot: ObligationSlot,
  code: StoryRefIssueCode,
  detail: string,
  refs: StoryRefIssue["refs"],
): StoryRefIssue {
  return {
    severity: "warning",
    code,
    ...(outline.chapterId ? { chapterId: outline.chapterId } : {}),
    ...(slot.beatId ? { beatId: slot.beatId } : {}),
    beatIndex: slot.beatIndex,
    ...(stringOrUndefined(slot.obligation.obligationId) ? { obligationId: stringOrUndefined(slot.obligation.obligationId) } : {}),
    obligationListKey: slot.listKey,
    detail,
    refs,
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    out.set(key, [...(out.get(key) ?? []), item])
  }
  return out
}
