#!/usr/bin/env bun
/**
 * Planner-only diagnostic for the commercial fantasy/adventure method pack.
 *
 * This is intentionally outside the production pipeline. It compares a
 * no-method planning arm with a method-pack arm on chapter/scene contract
 * quality before drafting, checking, proposal flows, or UI change.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { z } from "zod"

const coveragePolicySchema = z.enum(["must_satisfy", "should_surface", "forbid", "optional"])
const sourceKindSchema = z.enum(["character", "world", "structure", "story_promise", "story_debt", "concept"])

const targetSlotSchema = z.object({
  structureSlotId: z.string(),
  structureJob: z.string(),
  planningTest: z.string(),
})

const characterSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  role: z.string(),
  materiality: z.string(),
})

const worldFactSchema = z.object({
  worldFactId: z.string(),
  fact: z.string(),
})

const strategyPacketSchema = z.object({
  strategyPacketId: z.string(),
  logline: z.string(),
  paragraphSummary: z.string(),
  majorReversals: z.array(z.string()).default([]),
  endingDirection: z.string(),
  readerPromise: z.string(),
  protagonistWant: z.string(),
  protagonistNeed: z.string(),
  protagonistLie: z.string(),
  protagonistTruth: z.string(),
  antagonistPressure: z.string(),
  worldPressureRule: z.string(),
}).partial().passthrough()

const storyDebtSchema = z.object({
  storyDebtId: z.string(),
  promiseText: z.string(),
  openedBySlotId: z.string().optional(),
  expectedProgressSlotIds: z.array(z.string()).default([]),
  expectedPayoffSlotId: z.string().optional(),
  payoffPolicy: z.string().optional(),
}).passthrough()

const fixtureSchema = z.object({
  diagnosticId: z.string(),
  methodPackId: z.string(),
  templateId: z.string(),
  targetSlots: z.array(targetSlotSchema).min(1),
  concept: z.object({
    genreProfileId: z.string(),
    premise: z.string(),
    readerPromise: z.string(),
    centralConflict: z.string(),
    protagonist: z.object({
      characterId: z.string(),
      name: z.string(),
      desire: z.string(),
      fear: z.string(),
      flaw: z.string(),
    }),
    characters: z.array(characterSchema),
    worldFacts: z.array(worldFactSchema),
    storyPromise: z.object({
      promiseId: z.string(),
      text: z.string(),
    }),
    strategyPacket: strategyPacketSchema.optional(),
    storyDebts: z.array(storyDebtSchema).default([]),
    constraints: z.array(z.string()),
  }),
  arms: z.array(z.object({
    armId: z.string(),
    label: z.string(),
    methodPackEnabled: z.boolean(),
    plan: z.unknown(),
  })).optional(),
})

const obligationSchema = z.object({
  obligationId: z.string(),
  sourceId: z.string(),
  sourceKind: sourceKindSchema,
  coveragePolicy: coveragePolicySchema,
  requirementText: z.string(),
  linkedCharacterIds: z.array(z.string()).default([]),
  linkedWorldFactIds: z.array(z.string()).default([]),
})

const sceneContractSchema = z.object({
  sceneId: z.string(),
  chapterId: z.string(),
  structureSlotId: z.string(),
  sceneFunction: z.string(),
  povCharacterId: z.string(),
  locationOrArena: z.string(),
  goal: z.string(),
  conflict: z.string(),
  opposition: z.string().default(""),
  turnOrValueShift: z.string(),
  turningPoint: z.string().default(""),
  crisisChoice: z.string().default(""),
  climaxAction: z.string().default(""),
  outcome: z.string(),
  resolution: z.string().default(""),
  valueIn: z.string().default(""),
  valueOut: z.string().default(""),
  consequence: z.string(),
  requiredObligationIds: z.array(z.string()).default([]),
  requiredSourceIds: z.array(z.string()).default([]),
  requiredCharacterIds: z.array(z.string()).default([]),
  requiredWorldFactIds: z.array(z.string()).default([]),
}).strict()

const chapterContractSchema = z.object({
  chapterId: z.string(),
  structureSlotId: z.string(),
  chapterFunction: z.string(),
  povCharacterId: z.string(),
  protagonistPressure: z.string(),
  centralConflict: z.string(),
  irreversibleChange: z.string(),
  endpointOrHook: z.string(),
  requiredCharacterWork: z.string(),
  requiredWorldWork: z.string(),
  requiredStoryDebtWork: z.string(),
  scenes: z.array(sceneContractSchema).min(1),
  obligations: z.array(obligationSchema).default([]),
}).strict()

export const plannerContractPlanSchema = z.object({
  armId: z.string(),
  methodPackId: z.string().nullable().default(null),
  templateId: z.string().nullable().default(null),
  chapters: z.array(chapterContractSchema).min(1),
  notes: z.string().optional(),
}).strict()

const plannerContractPlanOutputSchema = z.preprocess((value) => {
  if (value && typeof value === "object" && "plan" in value) {
    return (value as { plan?: unknown }).plan
  }
  return value
}, plannerContractPlanSchema)

export type PlannerContractPlan = z.infer<typeof plannerContractPlanSchema>
export type PlannerDiagnosticFixture = z.infer<typeof fixtureSchema>

export interface DimensionScore {
  passed: number
  possible: number
  ratio: number | null
  issues: string[]
}

export interface ArmScore {
  armId: string
  methodPackEnabled: boolean
  totalPassed: number
  totalPossible: number
  totalRatio: number
  dimensions: Record<string, DimensionScore>
}

export interface DiagnosticArmResult {
  armId: string
  label: string
  methodPackEnabled: boolean
  plan: PlannerContractPlan
  score: ArmScore
}

export interface DiagnosticReport {
  diagnosticId: string
  generatedAt: string
  mode: "fixture" | "live"
  fixturePath: string
  arms: DiagnosticArmResult[]
  comparison: {
    controlArmId: string | null
    testArmId: string | null
    totalRatioDelta: number | null
    verdict: string
    reason: string
  }
}

interface Args {
  fixturePath: string
  live: boolean
  json: boolean
  outputPath: string | null
  scenesPerChapter: number
  obligationsPerChapter: number
}

const DEFAULT_FIXTURE_PATH = "docs/fixtures/method-packs/commercial-fantasy-adventure-v0/frozen-concept.json"
const DEFAULT_SCENES_PER_CHAPTER = 2
const DEFAULT_OBLIGATIONS_PER_CHAPTER = 2

const ACTION_TERMS = [
  "choose", "choice", "cost", "force", "forces", "risk", "refuse", "reveal",
  "betray", "sacrifice", "confront", "expose", "protect", "escape", "commit",
  "decide", "threaten", "punish", "change", "break", "burn", "burns",
  "burning", "forbid", "forbids", "forbidden", "criminal", "crime",
  "enforce", "enforces", "shift", "shifts", "stable", "stabilize", "block",
  "blocks", "constraint", "constrain", "complicate", "complicates",
]

const GENERIC_TERMS = new Set(["none", "n/a", "tbd", "unknown", "same", "generic"])

const STOPWORDS = new Set([
  "about", "after", "again", "against", "also", "because", "before", "being",
  "between", "chapter", "could", "from", "have", "into", "that", "their",
  "them", "then", "there", "this", "through", "with", "will", "would",
  "while", "where", "which", "what", "when",
])

export function scorePlan(
  plan: PlannerContractPlan,
  fixture: PlannerDiagnosticFixture,
  methodPackEnabled: boolean,
): ArmScore {
  const dimensions: Record<string, DimensionScore> = {
    templateSlotFit: templateSlotFit(plan, fixture, methodPackEnabled),
    chapterContractComplete: chapterContractComplete(plan),
    sceneContractComplete: sceneContractComplete(plan),
    characterMateriality: characterMateriality(plan, fixture),
    worldRelevance: worldRelevance(plan, fixture),
    obligationClarity: obligationClarity(plan),
    strategyConservation: strategyConservation(plan, fixture),
    storyGridSceneContract: storyGridSceneContract(plan, fixture),
    characterArcPressure: characterArcPressure(plan, fixture),
    storyDebtTraceability: storyDebtTraceability(plan, fixture),
    endpointLanding: endpointLanding(plan),
    overfragmentation: overfragmentation(plan),
    idCompleteness: idCompleteness(plan, fixture),
  }
  const scored = Object.values(dimensions).filter(d => d.possible > 0)
  const totalPassed = scored.reduce((sum, d) => sum + d.passed, 0)
  const totalPossible = scored.reduce((sum, d) => sum + d.possible, 0)
  return {
    armId: plan.armId,
    methodPackEnabled,
    totalPassed,
    totalPossible,
    totalRatio: totalPossible > 0 ? totalPassed / totalPossible : 0,
    dimensions,
  }
}

export function normalizePlannerContractPlan(
  raw: unknown,
  fixture: PlannerDiagnosticFixture,
  defaults: { armId: string; methodPackEnabled: boolean },
): PlannerContractPlan {
  const unwrapped = record(raw)
  const source = record("plan" in unwrapped ? unwrapped.plan : unwrapped)
  const chaptersRaw = Array.isArray(source.chapters) ? source.chapters : []
  const chapters = chaptersRaw.map((chapterRaw, index) =>
    normalizeChapterContract(chapterRaw, fixture, defaults, index)
  )
  const candidate = {
    armId: stringValue(source.armId) || defaults.armId,
    methodPackId: defaults.methodPackEnabled
      ? fixture.methodPackId
      : nullableString(source.methodPackId),
    templateId: defaults.methodPackEnabled
      ? fixture.templateId
      : nullableString(source.templateId),
    chapters,
    notes: stringValue(source.notes) || undefined,
  }
  return plannerContractPlanSchema.parse(candidate)
}

export function buildDiagnosticReport(
  fixture: PlannerDiagnosticFixture,
  arms: Array<{ armId: string; label: string; methodPackEnabled: boolean; plan: PlannerContractPlan }>,
  options: { mode: "fixture" | "live"; fixturePath: string; generatedAt?: string },
): DiagnosticReport {
  const results = arms.map(arm => ({
    ...arm,
    score: scorePlan(arm.plan, fixture, arm.methodPackEnabled),
  }))
  const control = results.find(arm => !arm.methodPackEnabled) ?? null
  const test = results.find(arm => arm.methodPackEnabled) ?? null
  const totalRatioDelta = control && test ? test.score.totalRatio - control.score.totalRatio : null
  const testSlotFit = test?.score.dimensions.templateSlotFit
  const testCriticalIssues = test ? [
    ...test.score.dimensions.idCompleteness.issues,
    ...test.score.dimensions.sceneContractComplete.issues,
  ] : []
  let verdict = "HOLD"
  let reason = "Need both control and method-pack arms before drawing a directional conclusion."
  if (control && test && totalRatioDelta !== null) {
    if (testCriticalIssues.length > 0) {
      verdict = "HOLD"
      reason = "Method-pack arm has structural or ID issues; revise before any live promotion."
    } else if ((testSlotFit?.ratio ?? 0) < 1) {
      verdict = "HOLD"
      reason = "Method-pack arm did not preserve the requested structure-slot map."
    } else if (totalRatioDelta >= 0.08) {
      verdict = "DIRECTIONAL-PASS"
      reason = "Method-pack arm improved deterministic plan-contract score by at least 8 points without structural issues; this is diagnostic lift, not semantic promotion evidence."
    } else if (totalRatioDelta < 0) {
      verdict = "NO-PROMOTION"
      reason = "Method-pack arm scored worse than the no-method control on this diagnostic."
    } else {
      verdict = "HOLD"
      reason = "Method-pack arm ran, but the deterministic lift is too small or inconsistent for the next semantic review stage."
    }
  }
  return {
    diagnosticId: fixture.diagnosticId,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    mode: options.mode,
    fixturePath: options.fixturePath,
    arms: results,
    comparison: {
      controlArmId: control?.armId ?? null,
      testArmId: test?.armId ?? null,
      totalRatioDelta,
      verdict,
      reason,
    },
  }
}

export function renderDiagnosticReport(report: DiagnosticReport): string {
  const lines: string[] = []
  lines.push(`Method-pack planner diagnostic: ${report.diagnosticId}`)
  lines.push(`Mode=${report.mode}; fixture=${report.fixturePath}`)
  lines.push("")
  for (const arm of report.arms) {
    lines.push(`${arm.armId} (${arm.label})`)
    lines.push(`  methodPack=${arm.methodPackEnabled}; score=${arm.score.totalPassed}/${arm.score.totalPossible} (${formatPct(arm.score.totalRatio)})`)
    for (const [name, score] of Object.entries(arm.score.dimensions)) {
      const ratio = score.ratio === null ? "n/a" : formatPct(score.ratio)
      lines.push(`  ${name}: ${score.passed}/${score.possible} (${ratio})`)
      for (const issue of score.issues.slice(0, 4)) lines.push(`    - ${issue}`)
      if (score.issues.length > 4) lines.push(`    - ...${score.issues.length - 4} more`)
    }
    lines.push("")
  }
  lines.push(`Verdict: ${report.comparison.verdict}`)
  lines.push(`Reason: ${report.comparison.reason}`)
  if (report.comparison.totalRatioDelta !== null) {
    lines.push(`Delta: ${formatSignedPct(report.comparison.totalRatioDelta)}`)
  }
  return lines.join("\n")
}

function templateSlotFit(
  plan: PlannerContractPlan,
  fixture: PlannerDiagnosticFixture,
  methodPackEnabled: boolean,
): DimensionScore {
  if (!methodPackEnabled) {
    return { passed: 0, possible: 0, ratio: null, issues: ["not applicable for no-method control"] }
  }
  const expected = fixture.targetSlots.map(slot => slot.structureSlotId)
  const issues: string[] = []
  let passed = 0
  for (let i = 0; i < expected.length; i++) {
    const chapter = plan.chapters[i]
    if (!chapter) {
      issues.push(`missing chapter for ${expected[i]}`)
      continue
    }
    if (chapter.structureSlotId === expected[i]) passed++
    else issues.push(`chapter ${i + 1} expected ${expected[i]}, got ${chapter.structureSlotId}`)
  }
  if (plan.chapters.length !== expected.length) {
    issues.push(`expected ${expected.length} chapters for fixture, got ${plan.chapters.length}`)
  }
  return dimension(passed, expected.length, issues)
}

function chapterContractComplete(plan: PlannerContractPlan): DimensionScore {
  const fields = [
    "chapterFunction",
    "protagonistPressure",
    "centralConflict",
    "irreversibleChange",
    "endpointOrHook",
    "requiredStoryDebtWork",
  ] as const
  const issues: string[] = []
  let passed = 0
  for (const chapter of plan.chapters) {
    for (const field of fields) {
      if (meaningful(chapter[field])) passed++
      else issues.push(`${chapter.chapterId}.${field} is missing or generic`)
    }
  }
  return dimension(passed, plan.chapters.length * fields.length, issues)
}

function sceneContractComplete(plan: PlannerContractPlan): DimensionScore {
  const fields = ["goal", "conflict", "turnOrValueShift", "outcome", "consequence"] as const
  const issues: string[] = []
  let passed = 0
  let possible = 0
  for (const chapter of plan.chapters) {
    for (const scene of chapter.scenes) {
      for (const field of fields) {
        possible++
        if (meaningfulSceneField(scene[field])) passed++
        else issues.push(`${scene.sceneId}.${field} is missing or generic`)
      }
    }
  }
  return dimension(passed, possible, issues)
}

function characterMateriality(plan: PlannerContractPlan, fixture: PlannerDiagnosticFixture): DimensionScore {
  const knownCharacterIds = new Set([
    fixture.concept.protagonist.characterId,
    ...fixture.concept.characters.map(c => c.characterId),
  ])
  const issues: string[] = []
  let passed = 0
  for (const chapter of plan.chapters) {
    const sceneCharacterIds = new Set(chapter.scenes.flatMap(scene => scene.requiredCharacterIds))
    const hasKnownCharacter = [...sceneCharacterIds].some(id => knownCharacterIds.has(id))
    const text = `${chapter.requiredCharacterWork} ${chapter.protagonistPressure} ${chapter.centralConflict}`
    if (meaningful(chapter.requiredCharacterWork) && hasKnownCharacter && hasActionPressure(text)) passed++
    else issues.push(`${chapter.chapterId} does not make character work materially active`)
  }
  return dimension(passed, plan.chapters.length, issues)
}

function worldRelevance(plan: PlannerContractPlan, fixture: PlannerDiagnosticFixture): DimensionScore {
  const knownWorldIds = new Set(fixture.concept.worldFacts.map(fact => fact.worldFactId))
  const issues: string[] = []
  let passed = 0
  for (const chapter of plan.chapters) {
    const sceneWorldIds = new Set(chapter.scenes.flatMap(scene => scene.requiredWorldFactIds))
    const obligationWorldIds = new Set(chapter.obligations.flatMap(obligation => obligation.linkedWorldFactIds))
    const hasKnownWorld = [...sceneWorldIds, ...obligationWorldIds].some(id => knownWorldIds.has(id))
    const text = `${chapter.requiredWorldWork} ${chapter.centralConflict} ${chapter.irreversibleChange}`
    if (meaningful(chapter.requiredWorldWork) && hasKnownWorld && hasActionPressure(text)) passed++
    else issues.push(`${chapter.chapterId} does not make world facts operational`)
  }
  return dimension(passed, plan.chapters.length, issues)
}

function obligationClarity(plan: PlannerContractPlan): DimensionScore {
  const issues: string[] = []
  let passed = 0
  let possible = 0
  for (const chapter of plan.chapters) {
    for (const obligation of chapter.obligations) {
      possible++
      if (meaningful(obligation.requirementText) && obligation.coveragePolicy === "must_satisfy") passed++
      else issues.push(`${obligation.obligationId} is vague or not must_satisfy`)
    }
    if (chapter.obligations.length === 0) {
      possible++
      issues.push(`${chapter.chapterId} has no obligations`)
    }
  }
  return dimension(passed, possible, issues)
}

function strategyConservation(plan: PlannerContractPlan, fixture: PlannerDiagnosticFixture): DimensionScore {
  const strategy = fixture.concept.strategyPacket
  if (!isFrameworkV1Fixture(fixture) || !strategy) {
    return { passed: 0, possible: 0, ratio: null, issues: ["not applicable for non-v1 fixture"] }
  }
  const planText = planContractText(plan)
  const checks = [
    {
      label: "readerPromise",
      text: strategy.readerPromise || fixture.concept.readerPromise,
      floor: 0.18,
    },
    {
      label: "endingDirection",
      text: strategy.endingDirection,
      floor: 0.16,
    },
    {
      label: "antagonistPressure",
      text: strategy.antagonistPressure,
      floor: 0.16,
    },
    {
      label: "worldPressureRule",
      text: strategy.worldPressureRule,
      floor: 0.16,
    },
    ...((strategy.majorReversals ?? []).map((text, index) => ({
      label: `majorReversals[${index}]`,
      text,
      floor: 0.14,
    }))),
  ].filter(check => meaningful(check.text ?? ""))

  const issues: string[] = []
  let passed = 0
  for (const check of checks) {
    const overlap = tokenOverlapRatio(check.text ?? "", planText)
    if (overlap >= check.floor) passed++
    else issues.push(`${check.label} is not visibly conserved in plan text`)
  }
  return dimension(passed, checks.length, issues)
}

function storyGridSceneContract(plan: PlannerContractPlan, fixture: PlannerDiagnosticFixture): DimensionScore {
  if (!isFrameworkV1Fixture(fixture)) {
    return { passed: 0, possible: 0, ratio: null, issues: ["not applicable for non-v1 fixture"] }
  }
  const fields = [
    "goal",
    "opposition",
    "turningPoint",
    "crisisChoice",
    "climaxAction",
    "resolution",
    "valueIn",
    "valueOut",
    "consequence",
  ] as const
  const issues: string[] = []
  let passed = 0
  let possible = 0
  for (const chapter of plan.chapters) {
    for (const scene of chapter.scenes) {
      for (const field of fields) {
        possible++
        if (field === "valueIn" || field === "valueOut"
          ? meaningfulValueLabel(scene[field])
          : meaningfulSceneField(scene[field])
        ) passed++
        else issues.push(`${scene.sceneId}.${field} is missing or generic`)
      }
      possible++
      if (
        meaningfulValueLabel(scene.valueIn)
        && meaningfulValueLabel(scene.valueOut)
        && !semanticSameShallow(scene.valueIn, scene.valueOut)
      ) passed++
      else issues.push(`${scene.sceneId}.valueIn/valueOut do not show a visible value shift`)
    }
  }
  return dimension(passed, possible, issues)
}

function characterArcPressure(plan: PlannerContractPlan, fixture: PlannerDiagnosticFixture): DimensionScore {
  const strategy = fixture.concept.strategyPacket
  if (!isFrameworkV1Fixture(fixture) || !strategy) {
    return { passed: 0, possible: 0, ratio: null, issues: ["not applicable for non-v1 fixture"] }
  }
  const want = strategy.protagonistWant || fixture.concept.protagonist.desire
  const need = strategy.protagonistNeed
  const lie = strategy.protagonistLie || fixture.concept.protagonist.flaw
  const truth = strategy.protagonistTruth
  const issues: string[] = []
  let passed = 0
  let possible = 0
  for (const chapter of plan.chapters) {
    const text = chapterContractText(chapter)
    const wantOrNeed = Math.max(tokenOverlapRatio(want, text), tokenOverlapRatio(need ?? "", text))
    const lieOrTruth = Math.max(tokenOverlapRatio(lie, text), tokenOverlapRatio(truth ?? "", text))
    const hasCharacterRef = chapter.scenes.some(scene =>
      scene.requiredCharacterIds.includes(fixture.concept.protagonist.characterId)
      || scene.requiredCharacterIds.some(id => fixture.concept.characters.some(c => c.characterId === id))
    )
    possible++
    if (hasCharacterRef && wantOrNeed >= 0.14 && lieOrTruth >= 0.12) passed++
    else issues.push(`${chapter.chapterId} does not visibly pressure want/need and lie/truth through character refs`)
  }
  return dimension(passed, possible, issues)
}

function storyDebtTraceability(plan: PlannerContractPlan, fixture: PlannerDiagnosticFixture): DimensionScore {
  if (!isFrameworkV1Fixture(fixture) || fixture.concept.storyDebts.length === 0) {
    return { passed: 0, possible: 0, ratio: null, issues: ["not applicable for non-v1 fixture"] }
  }
  const debtIds = new Set(fixture.concept.storyDebts.map(debt => debt.storyDebtId))
  const issues: string[] = []
  let passed = 0
  let possible = 0
  for (const debt of fixture.concept.storyDebts) {
    const linkedChapters = plan.chapters.filter(chapter =>
      chapter.obligations.some(obligation => obligation.sourceId === debt.storyDebtId)
      || chapter.scenes.some(scene => scene.requiredSourceIds.includes(debt.storyDebtId))
      || tokenOverlapRatio(debt.promiseText, chapter.requiredStoryDebtWork) >= 0.18
    )
    possible++
    if (linkedChapters.length > 0) passed++
    else issues.push(`${debt.storyDebtId} is not linked from any chapter obligation or scene source`)
  }
  for (const chapter of plan.chapters) {
    const sceneSourceIds = new Set(chapter.scenes.flatMap(scene => scene.requiredSourceIds))
    const debtObligationIds = new Set(chapter.obligations
      .filter(obligation => debtIds.has(obligation.sourceId))
      .map(obligation => obligation.obligationId))
    if (debtObligationIds.size === 0) continue
    possible++
    const hasSceneLink = [...debtObligationIds].some(obligationId =>
      chapter.scenes.some(scene => scene.requiredObligationIds.includes(obligationId))
    ) || [...sceneSourceIds].some(sourceId => debtIds.has(sourceId))
    if (hasSceneLink) passed++
    else issues.push(`${chapter.chapterId} has story-debt obligations not routed into scenes`)
  }
  return dimension(passed, possible, issues)
}

function endpointLanding(plan: PlannerContractPlan): DimensionScore {
  const issues: string[] = []
  let passed = 0
  for (const chapter of plan.chapters) {
    const lastScene = chapter.scenes.at(-1)
    const landingText = `${lastScene?.outcome ?? ""} ${lastScene?.consequence ?? ""}`
    const overlap = tokenOverlapRatio(chapter.endpointOrHook, landingText)
    if (meaningful(chapter.endpointOrHook) && overlap >= 0.22) passed++
    else issues.push(`${chapter.chapterId} endpoint does not land in final scene outcome/consequence`)
  }
  return dimension(passed, plan.chapters.length, issues)
}

function overfragmentation(plan: PlannerContractPlan): DimensionScore {
  const issues: string[] = []
  let passed = 0
  for (const chapter of plan.chapters) {
    if (chapter.scenes.length >= 1 && chapter.scenes.length <= 4) passed++
    else issues.push(`${chapter.chapterId} has ${chapter.scenes.length} scenes; expected 1-4`)
  }
  return dimension(passed, plan.chapters.length, issues)
}

function idCompleteness(plan: PlannerContractPlan, fixture: PlannerDiagnosticFixture): DimensionScore {
  const issues: string[] = []
  const knownCharacterIds = new Set([
    fixture.concept.protagonist.characterId,
    ...fixture.concept.characters.map(c => c.characterId),
  ])
  const knownWorldIds = new Set(fixture.concept.worldFacts.map(fact => fact.worldFactId))
  const knownStructureIds = new Set(fixture.targetSlots.map(slot => slot.structureSlotId))
  const knownStoryDebtIds = new Set(fixture.concept.storyDebts.map(debt => debt.storyDebtId))
  const knownSourceIds = new Set([
    fixture.concept.storyPromise.promiseId,
    ...knownCharacterIds,
    ...knownWorldIds,
    ...knownStructureIds,
    ...knownStoryDebtIds,
  ])
  const seenChapterIds = new Set<string>()
  const seenSceneIds = new Set<string>()
  let passed = 0
  let possible = 0

  const check = (condition: boolean, issue: string) => {
    possible++
    if (condition) passed++
    else issues.push(issue)
  }

  for (const chapter of plan.chapters) {
    check(Boolean(chapter.chapterId) && !seenChapterIds.has(chapter.chapterId), `${chapter.chapterId || "chapter"} duplicate/missing chapterId`)
    seenChapterIds.add(chapter.chapterId)
    check(Boolean(chapter.structureSlotId), `${chapter.chapterId} missing structureSlotId`)
    if (plan.methodPackId) {
      check(knownStructureIds.has(chapter.structureSlotId), `${chapter.chapterId} unknown structureSlotId ${chapter.structureSlotId}`)
    }
    check(knownCharacterIds.has(chapter.povCharacterId), `${chapter.chapterId} unknown povCharacterId ${chapter.povCharacterId}`)

    const obligationIds = new Set(chapter.obligations.map(obligation => obligation.obligationId))
    const sourceIds = new Set(chapter.obligations.map(obligation => obligation.sourceId))
    for (const obligation of chapter.obligations) {
      check(Boolean(obligation.obligationId), `${chapter.chapterId} obligation missing obligationId`)
      check(Boolean(obligation.sourceId), `${obligation.obligationId} missing sourceId`)
      check(knownSourceIds.has(obligation.sourceId), `${obligation.obligationId} unknown sourceId ${obligation.sourceId}`)
      for (const characterId of obligation.linkedCharacterIds) {
        check(knownCharacterIds.has(characterId), `${obligation.obligationId} unknown linkedCharacterId ${characterId}`)
      }
      for (const worldFactId of obligation.linkedWorldFactIds) {
        check(knownWorldIds.has(worldFactId), `${obligation.obligationId} unknown linkedWorldFactId ${worldFactId}`)
      }
    }

    for (const scene of chapter.scenes) {
      check(Boolean(scene.sceneId) && !seenSceneIds.has(scene.sceneId), `${scene.sceneId || "scene"} duplicate/missing sceneId`)
      seenSceneIds.add(scene.sceneId)
      check(scene.chapterId === chapter.chapterId, `${scene.sceneId} chapterId does not match ${chapter.chapterId}`)
      check(scene.structureSlotId === chapter.structureSlotId, `${scene.sceneId} structureSlotId does not match chapter`)
      check(scene.requiredObligationIds.length > 0, `${scene.sceneId} has no requiredObligationIds`)
      check(scene.requiredSourceIds.length > 0, `${scene.sceneId} has no requiredSourceIds`)
      for (const obligationId of scene.requiredObligationIds) {
        check(obligationIds.has(obligationId), `${scene.sceneId} references unknown obligationId ${obligationId}`)
      }
      for (const sourceId of scene.requiredSourceIds) {
        check(sourceIds.has(sourceId), `${scene.sceneId} references unknown sourceId ${sourceId}`)
      }
      for (const characterId of scene.requiredCharacterIds) {
        check(knownCharacterIds.has(characterId), `${scene.sceneId} references unknown characterId ${characterId}`)
      }
      for (const worldFactId of scene.requiredWorldFactIds) {
        check(knownWorldIds.has(worldFactId), `${scene.sceneId} references unknown worldFactId ${worldFactId}`)
      }
    }
  }
  return dimension(passed, possible, issues)
}

function normalizeChapterContract(
  raw: unknown,
  fixture: PlannerDiagnosticFixture,
  defaults: { methodPackEnabled: boolean },
  index: number,
): z.infer<typeof chapterContractSchema> {
  const source = record(raw)
  const structureSlotId = stringValue(source.structureSlotId)
    || (defaults.methodPackEnabled
      ? fixture.targetSlots[index]?.structureSlotId
      : `BASE-${String(index + 1).padStart(2, "0")}`)
  const chapterId = stringValue(source.chapterId)
    || `ch-${String(index + 1).padStart(2, "0")}-${slug(structureSlotId)}`
  const povCharacterId = stringValue(source.povCharacterId) || stringValue(source.pov) || ""
  const obligations = normalizeObligations(source, chapterId, fixture)
  const scenesRaw = Array.isArray(source.scenes) ? source.scenes : []
  const scenesSource = scenesRaw.length > 0 ? scenesRaw : [{}]
  return {
    chapterId,
    structureSlotId,
    chapterFunction: stringValue(source.chapterFunction) || stringValue(source.function) || stringValue(source.purpose) || stringValue(source.title) || "",
    povCharacterId,
    protagonistPressure: stringValue(source.protagonistPressure) || stringValue(source.pressure) || "",
    centralConflict: stringValue(source.centralConflict) || stringValue(source.conflict) || "",
    irreversibleChange: stringValue(source.irreversibleChange) || stringValue(source.change) || stringValue(source.reversal) || "",
    endpointOrHook: stringValue(source.endpointOrHook) || stringValue(source.chapterHook) || stringValue(source.hook) || "",
    requiredCharacterWork: stringValue(source.requiredCharacterWork) || stringValue(source.characterWork) || "",
    requiredWorldWork: stringValue(source.requiredWorldWork) || stringValue(source.worldWork) || "",
    requiredStoryDebtWork: stringValue(source.requiredStoryDebtWork) || stringValue(source.storyDebtWork) || stringValue(source.promiseWork) || "",
    scenes: scenesSource.map((sceneRaw, sceneIndex) =>
      normalizeSceneContract(sceneRaw, chapterId, structureSlotId, povCharacterId, obligations, sceneIndex)
    ),
    obligations,
  }
}

function normalizeSceneContract(
  raw: unknown,
  chapterId: string,
  structureSlotId: string,
  povCharacterId: string,
  obligations: Array<z.infer<typeof obligationSchema>>,
  index: number,
): z.infer<typeof sceneContractSchema> {
  const source = record(raw)
  const defaultObligationIds = obligations.length === 1 ? [obligations[0]!.obligationId] : []
  const defaultSourceIds = obligations.length === 1 ? [obligations[0]!.sourceId] : []
  return {
    sceneId: stringValue(source.sceneId) || `${chapterId}-scene-${String(index + 1).padStart(2, "0")}`,
    chapterId: stringValue(source.chapterId) || chapterId,
    structureSlotId: stringValue(source.structureSlotId) || structureSlotId,
    sceneFunction: stringValue(source.sceneFunction) || stringValue(source.function) || stringValue(source.purpose) || "",
    povCharacterId: stringValue(source.povCharacterId) || povCharacterId,
    locationOrArena: stringValue(source.locationOrArena) || stringValue(source.location) || stringValue(source.arena) || "",
    goal: stringValue(source.goal),
    conflict: stringValue(source.conflict),
    opposition: stringValue(source.opposition) || stringValue(source.conflict),
    turnOrValueShift: stringValue(source.turnOrValueShift) || stringValue(source.turn) || stringValue(source.valueShift) || "",
    turningPoint: stringValue(source.turningPoint) || stringValue(source.turn) || stringValue(source.valueShift) || "",
    crisisChoice: stringValue(source.crisisChoice) || stringValue(source.crisis) || "",
    climaxAction: stringValue(source.climaxAction) || stringValue(source.climax) || "",
    outcome: stringValue(source.outcome),
    resolution: stringValue(source.resolution) || stringValue(source.outcome),
    valueIn: stringValue(source.valueIn) || stringValue(source.startingValue) || "",
    valueOut: stringValue(source.valueOut) || stringValue(source.endingValue) || "",
    consequence: stringValue(source.consequence),
    requiredObligationIds: stringArray(source.requiredObligationIds, defaultObligationIds),
    requiredSourceIds: stringArray(source.requiredSourceIds, defaultSourceIds),
    requiredCharacterIds: stringArray(source.requiredCharacterIds),
    requiredWorldFactIds: stringArray(source.requiredWorldFactIds),
  }
}

function normalizeObligations(
  chapter: Record<string, unknown>,
  chapterId: string,
  fixture: PlannerDiagnosticFixture,
): Array<z.infer<typeof obligationSchema>> {
  const rawItems = Array.isArray(chapter.obligations)
    ? chapter.obligations
    : Array.isArray(chapter.must_satisfy)
      ? chapter.must_satisfy
      : []
  return rawItems.map((raw, index) => {
    const source = record(raw)
    const text = typeof raw === "string"
      ? raw
      : stringValue(source.requirementText) || stringValue(source.text) || stringValue(source.requirement) || ""
    const linkedCharacterIds = stringArray(source.linkedCharacterIds)
    const linkedWorldFactIds = stringArray(source.linkedWorldFactIds)
    const inferredSourceId = stringValue(source.sourceId)
      || linkedWorldFactIds[0]
      || linkedCharacterIds[0]
      || fixture.concept.storyPromise.promiseId
    return {
      obligationId: stringValue(source.obligationId) || `obl-${chapterId}-${String(index + 1).padStart(2, "0")}`,
      sourceId: inferredSourceId,
      sourceKind: sourceKindSchema.safeParse(source.sourceKind).success
        ? source.sourceKind as z.infer<typeof sourceKindSchema>
        : inferSourceKind(inferredSourceId, fixture),
      coveragePolicy: coveragePolicySchema.safeParse(source.coveragePolicy).success
        ? source.coveragePolicy as z.infer<typeof coveragePolicySchema>
        : "must_satisfy",
      requirementText: text,
      linkedCharacterIds,
      linkedWorldFactIds,
    }
  })
}

function inferSourceKind(sourceId: string, fixture: PlannerDiagnosticFixture): z.infer<typeof sourceKindSchema> {
  if (fixture.concept.characters.some(character => character.characterId === sourceId)) return "character"
  if (fixture.concept.protagonist.characterId === sourceId) return "character"
  if (fixture.concept.worldFacts.some(fact => fact.worldFactId === sourceId)) return "world"
  if (fixture.targetSlots.some(slot => slot.structureSlotId === sourceId)) return "structure"
  if (fixture.concept.storyPromise.promiseId === sourceId) return "story_promise"
  if (fixture.concept.storyDebts.some(debt => debt.storyDebtId === sourceId)) return "story_debt"
  return "concept"
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback
  return value.filter((item): item is string => typeof item === "string")
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contract"
}

function dimension(passed: number, possible: number, issues: string[]): DimensionScore {
  return {
    passed,
    possible,
    ratio: possible > 0 ? passed / possible : null,
    issues,
  }
}

function meaningful(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized || GENERIC_TERMS.has(normalized)) return false
  return contentTokens(text).length >= 3 && text.trim().length >= 16
}

function meaningfulSceneField(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized || GENERIC_TERMS.has(normalized)) return false
  return contentTokens(text).length >= 2 && text.trim().length >= 10
}

function meaningfulValueLabel(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized || GENERIC_TERMS.has(normalized)) return false
  return contentTokens(text).length >= 1 && text.trim().length >= 4
}

function hasActionPressure(text: string): boolean {
  const tokens = new Set(contentTokens(text))
  const stems = new Set([...tokens].map(stemToken))
  return ACTION_TERMS.some(term => tokens.has(term) || stems.has(stemToken(term)))
}

function stemToken(token: string): string {
  return token.replace(/(ing|ed|es|s)$/u, "")
}

function tokenOverlapRatio(a: string, b: string): number {
  const left = [...new Set(contentTokens(a))]
  if (left.length === 0) return 0
  const right = new Set(contentTokens(b))
  const matched = left.filter(token => right.has(token))
  return matched.length / left.length
}

function semanticSameShallow(a: string, b: string): boolean {
  const left = new Set(contentTokens(a))
  const right = new Set(contentTokens(b))
  if (left.size === 0 || right.size === 0) return true
  const overlap = [...left].filter(token => right.has(token)).length
  const smaller = Math.min(left.size, right.size)
  return overlap / smaller >= 0.8
}

function isFrameworkV1Fixture(fixture: PlannerDiagnosticFixture): boolean {
  return fixture.methodPackId.includes("-v1")
    || fixture.templateId.includes("-v1")
    || Boolean(fixture.concept.strategyPacket)
    || fixture.concept.storyDebts.length > 0
}

function planContractText(plan: PlannerContractPlan): string {
  return [
    plan.methodPackId ?? "",
    plan.templateId ?? "",
    ...plan.chapters.map(chapterContractText),
  ].join("\n")
}

function chapterContractText(chapter: PlannerContractPlan["chapters"][number]): string {
  return [
    chapter.chapterFunction,
    chapter.protagonistPressure,
    chapter.centralConflict,
    chapter.irreversibleChange,
    chapter.endpointOrHook,
    chapter.requiredCharacterWork,
    chapter.requiredWorldWork,
    chapter.requiredStoryDebtWork,
    ...chapter.obligations.map(obligation => obligation.requirementText),
    ...chapter.scenes.map(scene => [
      scene.sceneFunction,
      scene.goal,
      scene.conflict,
      scene.opposition,
      scene.turnOrValueShift,
      scene.turningPoint,
      scene.crisisChoice,
      scene.climaxAction,
      scene.outcome,
      scene.resolution,
      scene.valueIn,
      scene.valueOut,
      scene.consequence,
    ].join(" ")),
  ].join(" ")
}

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 3 && !STOPWORDS.has(token))
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatSignedPct(value: number): string {
  const sign = value >= 0 ? "+" : ""
  return `${sign}${(value * 100).toFixed(1)} points`
}

export interface LivePlannerOptions {
  scenesPerChapter?: number
  obligationsPerChapter?: number
  maxTokens?: number
  temperature?: number
  replicateIndex?: number
  includePro?: boolean
}

function parseArgs(argv: string[]): Args {
  let fixturePath = DEFAULT_FIXTURE_PATH
  let live = false
  let json = false
  let outputPath: string | null = null
  let scenesPerChapter = DEFAULT_SCENES_PER_CHAPTER
  let obligationsPerChapter = DEFAULT_OBLIGATIONS_PER_CHAPTER
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--live") live = true
    else if (arg === "--json") json = true
    else if (arg === "--fixture") fixturePath = requireValue(argv, ++i, "--fixture")
    else if (arg.startsWith("--fixture=")) fixturePath = arg.slice("--fixture=".length)
    else if (arg === "--output") outputPath = requireValue(argv, ++i, "--output")
    else if (arg.startsWith("--output=")) outputPath = arg.slice("--output=".length)
    else if (arg === "--scenes-per-chapter") scenesPerChapter = parsePositiveInt(requireValue(argv, ++i, "--scenes-per-chapter"), "--scenes-per-chapter")
    else if (arg.startsWith("--scenes-per-chapter=")) scenesPerChapter = parsePositiveInt(arg.slice("--scenes-per-chapter=".length), "--scenes-per-chapter")
    else if (arg === "--obligations-per-chapter") obligationsPerChapter = parsePositiveInt(requireValue(argv, ++i, "--obligations-per-chapter"), "--obligations-per-chapter")
    else if (arg.startsWith("--obligations-per-chapter=")) obligationsPerChapter = parsePositiveInt(arg.slice("--obligations-per-chapter=".length), "--obligations-per-chapter")
    else throw new Error(`unknown arg: ${arg}`)
  }
  return { fixturePath, live, json, outputPath, scenesPerChapter, obligationsPerChapter }
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

export function loadFixture(path: string): PlannerDiagnosticFixture {
  const abs = resolve(process.cwd(), path)
  if (!existsSync(abs)) throw new Error(`fixture not found: ${abs}`)
  const parsed = fixtureSchema.safeParse(JSON.parse(readFileSync(abs, "utf-8")))
  if (!parsed.success) {
    throw new Error(`fixture invalid: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
  }
  return parsed.data
}

export function loadFixtureArms(fixture: PlannerDiagnosticFixture): Array<{
  armId: string
  label: string
  methodPackEnabled: boolean
  plan: PlannerContractPlan
}> {
  if (!fixture.arms?.length) return []
  return fixture.arms.map(arm => {
    const parsed = plannerContractPlanSchema.safeParse(arm.plan)
    if (!parsed.success) {
      throw new Error(`fixture arm ${arm.armId} invalid: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
    }
    return { ...arm, plan: parsed.data }
  })
}

export async function runLiveArms(fixture: PlannerDiagnosticFixture, options: LivePlannerOptions = {}): Promise<Array<{
  armId: string
  label: string
  methodPackEnabled: boolean
  plan: PlannerContractPlan
}>> {
  const scenesPerChapter = options.scenesPerChapter ?? DEFAULT_SCENES_PER_CHAPTER
  const obligationsPerChapter = options.obligationsPerChapter ?? DEFAULT_OBLIGATIONS_PER_CHAPTER
  const arms = [
    {
      armId: "control:no-method:flash",
      label: "No-method control / DeepSeek V4 Flash",
      methodPackEnabled: false,
      agentName: "method-pack-planner-diagnostic",
      thinking: false,
      model: "deepseek-v4-flash",
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 14000,
    },
    {
      armId: `test:${fixture.methodPackId}:flash`,
      label: `${fixture.methodPackId} / DeepSeek V4 Flash`,
      methodPackEnabled: true,
      agentName: "method-pack-planner-diagnostic",
      thinking: false,
      model: "deepseek-v4-flash",
      temperature: options.temperature ?? 0.3,
      maxTokens: options.maxTokens ?? 14000,
    },
  ]
  if (options.includePro) {
    arms.push(
      {
        armId: "control:no-method:pro",
        label: "No-method control / DeepSeek V4 Pro",
        methodPackEnabled: false,
        agentName: "method-pack-planner-diagnostic-pro",
        thinking: true,
        model: "deepseek-v4-pro",
        temperature: 0.25,
        maxTokens: 32000,
      },
      {
        armId: `test:${fixture.methodPackId}:pro`,
        label: `${fixture.methodPackId} / DeepSeek V4 Pro`,
        methodPackEnabled: true,
        agentName: "method-pack-planner-diagnostic-pro",
        thinking: true,
        model: "deepseek-v4-pro",
        temperature: 0.25,
        maxTokens: 32000,
      },
    )
  }
  const results = []
  for (const arm of arms) {
    const output = await callDeepSeekPlanner({
      systemPrompt: liveSystemPrompt(),
      userPrompt: liveUserPrompt(fixture, arm, { scenesPerChapter, obligationsPerChapter, replicateIndex: options.replicateIndex }),
      temperature: arm.temperature,
      maxTokens: arm.maxTokens,
      thinking: arm.thinking,
      model: arm.model,
      agentName: arm.agentName,
    })
    const plan = normalizePlannerContractPlan(output, fixture, arm)
    results.push({ ...arm, plan })
  }
  return results
}

async function callDeepSeekPlanner(options: {
  systemPrompt: string
  userPrompt: string
  model: string
  temperature: number
  maxTokens: number
  thinking: boolean
  agentName: string
}): Promise<unknown> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error("DEEPSEEK_API_KEY not set in .env")
  const timeoutMs = options.model === "deepseek-v4-pro" ? 300_000 : 180_000
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort(new Error(`DeepSeek ${options.model} timeout after ${timeoutMs}ms`))
    }, timeoutMs)
    try {
      console.log(`  [LLM] Calling ${options.model} (${options.agentName}, temp=${options.temperature}, thinking=${options.thinking ? "on" : "off"}, attempt=${attempt})...`)
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: options.systemPrompt },
            { role: "user", content: options.userPrompt },
          ],
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          response_format: { type: "json_object" },
          thinking: { type: options.thinking ? "enabled" : "disabled" },
        }),
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`DeepSeek ${options.model} ${response.status}: ${text.slice(0, 500)}`)
      }
      return parseDeepSeekPlannerResponse(text, options)
    } catch (err) {
      lastError = err
      console.warn(`  [LLM] ${options.model} attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`)
      if (attempt >= 2) break
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function parseDeepSeekPlannerResponse(text: string, options: {
  model: string
  maxTokens: number
}): unknown {
  const data = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number }
  }
  const content = data.choices?.[0]?.message?.content ?? ""
  const finishReason = data.choices?.[0]?.finish_reason ?? null
  const promptTokens = data.usage?.prompt_tokens ?? 0
  const completionTokens = data.usage?.completion_tokens ?? 0
  const cachedTokens = data.usage?.prompt_cache_hit_tokens ?? 0
  const cachedSuffix = cachedTokens > 0 ? ` [cache:${cachedTokens}]` : ""
  console.log(`  [LLM] Response: ${promptTokens}+${completionTokens} tokens${cachedSuffix}; finish=${finishReason ?? "unknown"}`)
  if (finishReason === "length") {
    throw new Error(`DeepSeek ${options.model} hit max token cap: completion_tokens=${completionTokens} maxTokens=${options.maxTokens}`)
  }
  return JSON.parse(extractJsonObject(content))
}

function extractJsonObject(raw: string): string {
  let text = raw.trim()
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim()
  }
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error(`No JSON object in DeepSeek response: ${text.slice(0, 200)}`)
  return text.slice(start, end + 1)
}

function liveSystemPrompt(): string {
  return `You are an upstream novel planner diagnostic agent.

Produce planning contracts only. Do not write prose. Do not emit beat-level mini-actions.

Respond with only valid JSON matching the requested schema:
- one plan object;
- do not wrap the object in a "plan" property;
- chapters are chapter contracts;
- scenes are scene contracts and are the generation/adherence unit;
- obligations are source-linked contract items inside chapters.

Quality target:
- every chapter must have pressure, conflict, irreversible change, and an endpoint/hook;
- every scene must have goal, conflict, turn/value shift, outcome, and consequence;
- character and world refs must materially affect choices, costs, constraints, or consequences;
- obligations must be concrete enough for a writer to satisfy and a checker to evaluate.`
}

function liveUserPrompt(
  fixture: PlannerDiagnosticFixture,
  arm: { armId: string; methodPackEnabled: boolean },
  options: { scenesPerChapter: number; obligationsPerChapter: number; replicateIndex?: number },
): string {
  const conceptJson = JSON.stringify(fixture.concept, null, 2)
  const slotJson = JSON.stringify(fixture.targetSlots, null, 2)
  const replicateLine = options.replicateIndex === undefined
    ? ""
    : `\nReplicate ${options.replicateIndex + 1}: independently re-plan the same frozen concept; do not copy prior sample wording.`
  const sharedPrefix = `Planner diagnostic shared input.
This shared prefix is intentionally stable across arms for DeepSeek prefix-cache reuse.

Frozen concept:
${conceptJson}

Shared output contract:
- Produce planning contracts only, not prose.
- Return exactly six chapter contracts.
- Each chapter must contain exactly ${options.scenesPerChapter} scene contracts.
- Each chapter must contain exactly ${options.obligationsPerChapter} must_satisfy obligations.
- Use the provided characterId, worldFactId, and promiseId values; do not invent replacement IDs.`
  if (arm.methodPackEnabled) {
    return `${sharedPrefix}

Arm-specific instructions:
Run arm ${arm.armId}.
${replicateLine}

Use methodPackId=${fixture.methodPackId} and templateId=${fixture.templateId}.
Use exactly these six structure slots in this order:
${slotJson}

Return exactly six chapter contracts, one per structure slot.`
      + liveShapeReminder(options, fixture)
  }
  return `${sharedPrefix}

Arm-specific instructions:
Run arm ${arm.armId}.
${replicateLine}

Do not use a method pack. Use methodPackId=null and templateId=null.
Create a freeform six-part upstream plan from the same frozen concept. Use structureSlotId values BASE-01 through BASE-06 in order.
`
    + liveShapeReminder(options, fixture)
}

function liveShapeReminder(options: { scenesPerChapter: number; obligationsPerChapter: number }, fixture: PlannerDiagnosticFixture): string {
  const protagonistId = fixture.concept.protagonist.characterId
  const v1SceneFields = isFrameworkV1Fixture(fixture)
    ? `
          "opposition": "...",
          "turningPoint": "...",
          "crisisChoice": "...",
          "climaxAction": "...",
          "resolution": "...",
          "valueIn": "...",
          "valueOut": "...",`
    : ""
  return `

Hard diagnostic limits for this fixture only:
- exactly 6 chapters;
- exactly ${options.scenesPerChapter} scene contracts per chapter;
- exactly ${options.obligationsPerChapter} obligations per chapter;
- every string field should be 8-18 words;
- do not include chapterNumber, chapterName, title, sceneNumber, chapterHook, must_satisfy, or nested scene obligations;
- put obligations only in chapter.obligations;
- every scene.requiredObligationIds value must reference a chapter obligationId;
- every scene.requiredSourceIds value must reference a chapter obligation sourceId.
- sourceKind must be one of character, world, structure, story_promise, story_debt, concept.

Required top-level JSON shape:
{
  "armId": "...",
  "methodPackId": null,
  "templateId": null,
  "chapters": [
    {
      "chapterId": "...",
      "structureSlotId": "...",
      "chapterFunction": "...",
      "povCharacterId": "${protagonistId}",
      "protagonistPressure": "...",
      "centralConflict": "...",
      "irreversibleChange": "...",
      "endpointOrHook": "...",
      "requiredCharacterWork": "...",
      "requiredWorldWork": "...",
      "requiredStoryDebtWork": "...",
      "obligations": [
        {
          "obligationId": "...",
          "sourceId": "...",
          "sourceKind": "character",
          "coveragePolicy": "must_satisfy",
          "requirementText": "...",
          "linkedCharacterIds": ["${protagonistId}"],
          "linkedWorldFactIds": []
        }
      ],
      "scenes": [
        {
          "sceneId": "...",
          "chapterId": "...",
          "structureSlotId": "...",
          "sceneFunction": "...",
          "povCharacterId": "${protagonistId}",
          "locationOrArena": "...",
          "goal": "...",
          "conflict": "...",
${v1SceneFields}
          "turnOrValueShift": "...",
          "outcome": "...",
          "consequence": "...",
          "requiredObligationIds": ["..."],
          "requiredSourceIds": ["..."],
          "requiredCharacterIds": ["${protagonistId}"],
          "requiredWorldFactIds": []
        }
      ]
    }
  ]
}`
}

function defaultOutputPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `output/method-pack-diagnostics/${stamp}/commercial-fantasy-planner-diagnostic.json`
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/method-pack-planner-diagnostic.ts [--live] [--fixture <path>] [--output <path>] [--json] [--scenes-per-chapter <n>] [--obligations-per-chapter <n>]")
    return 2
  }

  const fixture = loadFixture(args.fixturePath)
  const arms = args.live ? await runLiveArms(fixture, {
    scenesPerChapter: args.scenesPerChapter,
    obligationsPerChapter: args.obligationsPerChapter,
  }) : loadFixtureArms(fixture)
  if (arms.length === 0) {
    console.error("fixture has no offline arms; pass --live to run the planner diagnostic against the LLM")
    return 2
  }
  const report = buildDiagnosticReport(fixture, arms, {
    mode: args.live ? "live" : "fixture",
    fixturePath: args.fixturePath,
  })

  const outputPath = args.outputPath ?? (args.live ? defaultOutputPath() : null)
  if (outputPath) {
    const abs = resolve(process.cwd(), outputPath)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, JSON.stringify(report, null, 2))
    console.error(`wrote ${abs}`)
  }
  console.log(args.json ? JSON.stringify(report, null, 2) : renderDiagnosticReport(report))
  return report.comparison.verdict === "NO-PROMOTION" ? 1 : 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
