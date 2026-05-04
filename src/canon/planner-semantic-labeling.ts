import { z } from "zod"

export const PLANNER_SEMANTIC_LABEL_SCHEMA_VERSION = "planner-semantic-label-v1"

export const plannerSemanticVerdictSchema = z.enum([
  "correct",
  "incorrect",
  "partial",
  "unsupported",
  "needs_human",
])

export const plannerCanonSafetySchema = z.enum([
  "direct_write",
  "human_review",
  "reject",
])

export const plannerEvidenceSourceSchema = z.enum([
  "chapter_outline",
  "beat_description",
  "beat_obligation",
  "approved_prose",
  "absence",
])

export const plannerSemanticItemLabelSchema = z.object({
  itemId: z.string(),
  itemKind: z.enum(["fact", "knowledge", "state"]),
  chapterN: z.number().int().nonnegative(),
  planVerdict: plannerSemanticVerdictSchema,
  canonSafety: plannerCanonSafetySchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    source: plannerEvidenceSourceSchema,
    quote: z.string(),
    explanation: z.string().default(""),
  })).default([]),
  reason: z.string(),
  caveats: z.array(z.string()).default([]),
})
export type PlannerSemanticItemLabel = z.infer<typeof plannerSemanticItemLabelSchema>

export const plannerMissingCanonItemSchema = z.object({
  kind: z.enum(["fact", "knowledge", "state"]),
  chapterN: z.number().int().nonnegative(),
  proposedId: z.string().default(""),
  text: z.string(),
  characterName: z.string().default(""),
  whyPlannerEligible: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    source: plannerEvidenceSourceSchema,
    quote: z.string(),
    explanation: z.string().default(""),
  })).default([]),
})
export type PlannerMissingCanonItem = z.infer<typeof plannerMissingCanonItemSchema>

export const plannerMissingCanonItemsSchema = z.object({
  chapterN: z.number().int().nonnegative(),
  missingItems: z.array(plannerMissingCanonItemSchema).max(10).default([]),
})
export type PlannerMissingCanonItems = z.infer<typeof plannerMissingCanonItemsSchema>

export interface PlannerSemanticJudgeCall {
  task: "item"
  route: "flash" | "pro"
  sampleIndex: number
  itemId: string
  itemKind: "fact" | "knowledge" | "state"
  chapterN: number
  ok: boolean
  label?: PlannerSemanticItemLabel
  error?: string
  llmCallId?: number | null
}

export interface PlannerSemanticMissingCall {
  task: "missing"
  route: "flash" | "pro"
  sampleIndex: number
  chapterN: number
  ok: boolean
  result?: PlannerMissingCanonItems
  error?: string
  llmCallId?: number | null
}

export type PlannerSemanticPanelCall = PlannerSemanticJudgeCall | PlannerSemanticMissingCall

export interface PlannerSemanticItemConsensus {
  itemId: string
  itemKind: "fact" | "knowledge" | "state"
  chapterN: number
  totalCalls: number
  okCalls: number
  failedCalls: number
  flashCalls: number
  proCalls: number
  verdictCounts: Record<string, number>
  safetyCounts: Record<string, number>
  flashMajoritySafety: string | null
  proMajoritySafety: string | null
  flashMajorityVerdict: string | null
  proMajorityVerdict: string | null
  crossRouteSafetyAgreement: boolean
  crossRouteVerdictAgreement: boolean
  meanConfidence: number
  consensusSafety: "direct_write" | "human_review" | "reject" | "needs_human"
  consensusVerdict: "correct" | "incorrect" | "partial" | "unsupported" | "needs_human"
  needsHuman: boolean
}

export interface PlannerSemanticMissingConsensus {
  chapterN: number
  candidateKey: string
  kind: "fact" | "knowledge" | "state"
  text: string
  supportCount: number
  flashSupport: number
  proSupport: number
  maxConfidence: number
  needsHuman: boolean
}

export interface PlannerSemanticPanelSummary {
  itemCount: number
  callCount: number
  okCallCount: number
  failedCallCount: number
  directWriteCandidates: number
  humanReviewCandidates: number
  rejectCandidates: number
  needsHumanItems: number
  crossRouteSafetyAgreementRate: number
  crossRouteVerdictAgreementRate: number
  missingCandidateCount: number
  missingNeedsHumanCount: number
}

export interface PlannerSemanticPanelReport {
  items: PlannerSemanticItemConsensus[]
  missing: PlannerSemanticMissingConsensus[]
  summary: PlannerSemanticPanelSummary
}

export function aggregatePlannerSemanticPanel(
  calls: readonly PlannerSemanticPanelCall[],
): PlannerSemanticPanelReport {
  const itemCalls = calls.filter((call): call is PlannerSemanticJudgeCall => call.task === "item")
  const missingCalls = calls.filter((call): call is PlannerSemanticMissingCall => call.task === "missing")
  const items = aggregateItemConsensus(itemCalls)
  const missing = aggregateMissingConsensus(missingCalls)
  const okCallCount = calls.filter((call) => call.ok).length
  const failedCallCount = calls.length - okCallCount
  const safetyAgreementEligible = items.filter((item) => item.flashMajoritySafety && item.proMajoritySafety)
  const verdictAgreementEligible = items.filter((item) => item.flashMajorityVerdict && item.proMajorityVerdict)

  return {
    items,
    missing,
    summary: {
      itemCount: items.length,
      callCount: calls.length,
      okCallCount,
      failedCallCount,
      directWriteCandidates: items.filter((item) => item.consensusSafety === "direct_write").length,
      humanReviewCandidates: items.filter((item) => item.consensusSafety === "human_review").length,
      rejectCandidates: items.filter((item) => item.consensusSafety === "reject").length,
      needsHumanItems: items.filter((item) => item.needsHuman).length,
      crossRouteSafetyAgreementRate: ratio(
        safetyAgreementEligible.filter((item) => item.crossRouteSafetyAgreement).length,
        safetyAgreementEligible.length,
      ),
      crossRouteVerdictAgreementRate: ratio(
        verdictAgreementEligible.filter((item) => item.crossRouteVerdictAgreement).length,
        verdictAgreementEligible.length,
      ),
      missingCandidateCount: missing.length,
      missingNeedsHumanCount: missing.filter((item) => item.needsHuman).length,
    },
  }
}

function aggregateItemConsensus(calls: readonly PlannerSemanticJudgeCall[]): PlannerSemanticItemConsensus[] {
  const byId = new Map<string, PlannerSemanticJudgeCall[]>()
  for (const call of calls) {
    const group = byId.get(call.itemId) ?? []
    group.push(call)
    byId.set(call.itemId, group)
  }

  return [...byId.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([itemId, group]) => {
    const ok = group.filter((call) => call.ok && call.label)
    const labels = ok.map((call) => call.label!)
    const verdictCounts = counts(labels.map((label) => label.planVerdict))
    const safetyCounts = counts(labels.map((label) => label.canonSafety))
    const flashLabels = ok.filter((call) => call.route === "flash").map((call) => call.label!)
    const proLabels = ok.filter((call) => call.route === "pro").map((call) => call.label!)
    const flashMajoritySafety = majority(flashLabels.map((label) => label.canonSafety))
    const proMajoritySafety = majority(proLabels.map((label) => label.canonSafety))
    const flashMajorityVerdict = majority(flashLabels.map((label) => label.planVerdict))
    const proMajorityVerdict = majority(proLabels.map((label) => label.planVerdict))
    const consensusSafety = consensusSafetyFrom(flashMajoritySafety, proMajoritySafety, safetyCounts)
    const consensusVerdict = consensusVerdictFrom(flashMajorityVerdict, proMajorityVerdict, verdictCounts)
    const crossRouteSafetyAgreement = Boolean(flashMajoritySafety && proMajoritySafety && flashMajoritySafety === proMajoritySafety)
    const crossRouteVerdictAgreement = Boolean(flashMajorityVerdict && proMajorityVerdict && flashMajorityVerdict === proMajorityVerdict)
    const needsHuman =
      !crossRouteSafetyAgreement ||
      !crossRouteVerdictAgreement ||
      consensusSafety === "human_review" ||
      consensusVerdict === "partial" ||
      consensusVerdict === "needs_human" ||
      group.some((call) => !call.ok)

    return {
      itemId,
      itemKind: group[0].itemKind,
      chapterN: group[0].chapterN,
      totalCalls: group.length,
      okCalls: ok.length,
      failedCalls: group.length - ok.length,
      flashCalls: ok.filter((call) => call.route === "flash").length,
      proCalls: ok.filter((call) => call.route === "pro").length,
      verdictCounts,
      safetyCounts,
      flashMajoritySafety,
      proMajoritySafety,
      flashMajorityVerdict,
      proMajorityVerdict,
      crossRouteSafetyAgreement,
      crossRouteVerdictAgreement,
      meanConfidence: mean(labels.map((label) => label.confidence)),
      consensusSafety,
      consensusVerdict,
      needsHuman,
    }
  })
}

function aggregateMissingConsensus(calls: readonly PlannerSemanticMissingCall[]): PlannerSemanticMissingConsensus[] {
  const byKey = new Map<string, PlannerSemanticMissingConsensus>()
  for (const call of calls) {
    if (!call.ok || !call.result) continue
    const seenInCall = new Set<string>()
    for (const item of call.result.missingItems) {
      const key = missingKey(item.chapterN, item.kind, item.text)
      if (seenInCall.has(key)) continue
      seenInCall.add(key)
      const current = byKey.get(key) ?? {
        chapterN: item.chapterN,
        candidateKey: key,
        kind: item.kind,
        text: item.text,
        supportCount: 0,
        flashSupport: 0,
        proSupport: 0,
        maxConfidence: 0,
        needsHuman: true,
      }
      current.supportCount++
      if (call.route === "flash") current.flashSupport++
      else current.proSupport++
      current.maxConfidence = Math.max(current.maxConfidence, item.confidence)
      current.needsHuman = current.flashSupport === 0 || current.proSupport === 0
      byKey.set(key, current)
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.chapterN !== b.chapterN) return a.chapterN - b.chapterN
    if (b.supportCount !== a.supportCount) return b.supportCount - a.supportCount
    return a.candidateKey.localeCompare(b.candidateKey)
  })
}

function consensusSafetyFrom(
  flash: string | null,
  pro: string | null,
  countsBySafety: Record<string, number>,
): PlannerSemanticItemConsensus["consensusSafety"] {
  if (flash && pro && flash === pro) return flash as PlannerSemanticItemConsensus["consensusSafety"]
  const top = majorityFromCounts(countsBySafety)
  if (top === "direct_write" && (flash !== "direct_write" || pro !== "direct_write")) return "needs_human"
  return (top as PlannerSemanticItemConsensus["consensusSafety"]) ?? "needs_human"
}

function consensusVerdictFrom(
  flash: string | null,
  pro: string | null,
  countsByVerdict: Record<string, number>,
): PlannerSemanticItemConsensus["consensusVerdict"] {
  if (flash && pro && flash === pro) return flash as PlannerSemanticItemConsensus["consensusVerdict"]
  return (majorityFromCounts(countsByVerdict) as PlannerSemanticItemConsensus["consensusVerdict"]) ?? "needs_human"
}

function counts(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const value of values) out[value] = (out[value] ?? 0) + 1
  return out
}

function majority(values: readonly string[]): string | null {
  return majorityFromCounts(counts(values))
}

function majorityFromCounts(countMap: Record<string, number>): string | null {
  let best: string | null = null
  let bestCount = 0
  let tied = false
  for (const [key, count] of Object.entries(countMap)) {
    if (count > bestCount) {
      best = key
      bestCount = count
      tied = false
    } else if (count === bestCount && count > 0) {
      tied = true
    }
  }
  return tied ? null : best
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function missingKey(chapterN: number, kind: string, text: string): string {
  return `${chapterN}:${kind}:${normalizeText(text)}`
}

const NORMALIZE_STOP_WORDS = new Set(["a", "an", "the", "s"])

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !NORMALIZE_STOP_WORDS.has(token))
    .join(" ")
}
