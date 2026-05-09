#!/usr/bin/env bun
/**
 * Diagnostic-only corpus structure recreation POC.
 *
 * It uses a corpus-derived chapter/scene reference as structural target, then
 * asks the model to create an original analog plan and optional example
 * chapter. It must not copy source prose, names, or exact events.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { z } from "zod"

import type { CorpusStructureReference } from "./corpus-structure-reference"

type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro"

interface Args {
  referencePath: string
  chapterLabel: string
  outputDir: string
  live: boolean
  writeChapter: boolean
  sceneCalls: boolean
  model: ModelId
  thinking: boolean
  maxTokens: number
}

interface RecreationPacket {
  schemaVersion: "1.0"
  generatedAt: string
  sourceReference: {
    path: string
    novel: string
    book: string
    chapterLabel: string
    sourceBoundary: "structural-only"
  }
  originalAnalogSeed: OriginalAnalogSeed
  target: TargetChapterBlueprint
  evidenceTiers: {
    required: string[]
    supporting: string[]
    inventory: string[]
  }
}

interface OriginalAnalogSeed {
  conceptId: string
  genreLane: string
  premise: string
  readerPromise: string
  protagonist: {
    characterId: string
    name: string
    want: string
    need: string
    lie: string
    truth: string
  }
  supportingCharacters: Array<{
    characterId: string
    name: string
    role: string
    pressure: string
  }>
  worldFacts: Array<{
    worldFactId: string
    fact: string
    operationalUse: string
  }>
  storyDebts: Array<{
    storyDebtId: string
    promiseText: string
  }>
  forbiddenSourceTerms: string[]
}

interface TargetChapterBlueprint {
  chapterLabel: string
  targetWords: number
  sceneCount: number
  beatCount: number
  sceneBlueprints: TargetSceneBlueprint[]
  chapterPattern: {
    polaritySequence: string[]
    miceSequence: string[]
    medianSceneWords: number
    medianBeatsPerScene: number
  }
}

interface TargetSceneBlueprint {
  referenceSceneOrdinal: number
  targetWords: number
  targetBeatCount: number
  sourceStructuralDigest?: string
  beatPurposeHints?: string[]
  valueIn: string | null
  valueOut: string | null
  polarity: string | null
  micePrimaryThread: string | null
  opensThread: boolean
  closesThread: boolean
  beatKindCounts: Record<string, number>
  boundarySignalCounts: Record<string, number>
  gapSizeCounts: Record<string, number>
}

const beatHintSchema = z.object({
  kind: z.string().min(1),
  boundarySignal: z.string().min(1),
  gapSize: z.string().min(1),
  purpose: z.string().min(8),
})

const recreationScenePlanSchema = z.object({
  sceneId: z.string().min(1),
  referenceSceneOrdinal: z.number().int().min(0),
  targetWords: z.number().int().min(50),
  structuralRole: z.string().min(8),
  povCharacterId: z.string().min(1),
  locationOrArena: z.string().min(1),
  goal: z.string().min(8),
  opposition: z.string().min(8),
  turningPoint: z.string().min(8),
  crisisChoice: z.string().min(8),
  choiceAlternatives: z.array(z.string().min(3)).min(2),
  climaxAction: z.string().min(8),
  outcome: z.string().min(8),
  consequence: z.string().min(8),
  valueIn: z.string(),
  valueOut: z.string(),
  miceThread: z.string(),
  beatHints: z.array(beatHintSchema).min(1),
})

const recreationPlanSchema = z.object({
  plan: z.object({
    chapterId: z.string().min(1),
    title: z.string().min(1),
    targetWords: z.number().int().min(100),
    chapterFunction: z.string().min(12),
    endpointOrHook: z.string().min(12),
    scenes: z.array(recreationScenePlanSchema).min(1),
    obligations: z.array(z.object({
      obligationId: z.string().min(1),
      sceneId: z.string().min(1),
      sourceId: z.string().min(1),
      requirementText: z.string().min(8),
    })).default([]),
  }),
}).strict()

const exampleChapterSchema = z.object({
  chapterTitle: z.string().min(1),
  scenes: z.array(z.object({
    sceneId: z.string().min(1),
    prose: z.string().min(50),
  })).min(1),
  fullProse: z.string().min(100),
}).strict()

const exampleSceneSchema = z.object({
  sceneId: z.string().min(1),
  prose: z.string().min(50),
}).strict()

type RecreationPlan = z.infer<typeof recreationPlanSchema>["plan"]
type ExampleChapter = z.infer<typeof exampleChapterSchema>
type ExampleScene = z.infer<typeof exampleSceneSchema>

export class ModelJsonParseError extends Error {
  readonly snippet: string

  constructor(label: string, snippet: string, cause: unknown) {
    super(`${label} returned invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = "ModelJsonParseError"
    this.snippet = snippet
  }
}

interface PlanComparison {
  sceneCount: {
    expected: number
    actual: number
    match: boolean
  }
  valuePolarity: {
    expected: string[]
    actual: string[]
    exactMatches: number
    ratio: number
  }
  miceThread: {
    expected: string[]
    actual: string[]
    exactMatches: number
    ratio: number
  }
  beatHintShape: {
    expectedTotal: number
    actualTotal: number
    ratio: number
  }
  sceneContract: {
    total: number
    choiceAlternativeCount: number
    declaredObligationCount: number
    knownSourceIdCount: number
    observableConsequenceCount: number
    scenes: SceneContractDiagnostic[]
  }
  issues: string[]
}

interface SceneContractDiagnostic {
  sceneId: string
  hasChoiceAlternatives: boolean
  hasDeclaredObligation: boolean
  hasKnownSourceIds: boolean
  hasObservableConsequence: boolean
  unknownSourceIds: string[]
  issues: string[]
}

interface ChapterComparison {
  sceneCount: {
    expected: number
    actual: number
    match: boolean
  }
  sceneWordCounts: Array<{
    sceneId: string
    target: number
    minimum: number
    actual: number
    ratio: number
    meetsMinimum: boolean
  }>
  wordCount: {
    target: number
    actual: number
    ratio: number
  }
  sourceBoundary: {
    forbiddenTermsPresent: string[]
  }
  issues: string[]
}

const DEFAULT_REFERENCE_PATH = "output/corpus-structure-reference/crystal_shard/reference.json"
const DEFAULT_OUTPUT_DIR = "output/corpus-recreation-poc/crystal_shard-ch1"

const ORIGINAL_ANALOG_SEED: OriginalAnalogSeed = {
  conceptId: "aurora-key-frontier-analog-v1",
  genreLane: "original action-pulp fantasy adventure",
  premise: "A disgraced aurora courier escorts a sun-metal key into a frozen frontier city while rival occult surveyors try to turn the key into a military beacon.",
  readerPromise: "Fast frontier fantasy with dangerous travel, active world rules, pressure-filled bargains, and a powerful artifact that creates more danger than safety.",
  protagonist: {
    characterId: "char-nara-venn",
    name: "Nara Venn",
    want: "recover her courier oathmark and prove she did not abandon her last convoy",
    need: "trust witnesses instead of surviving by private cleverness",
    lie: "a clean escape can restore her honor",
    truth: "honor returns only when she accepts public responsibility for who follows her",
  },
  supportingCharacters: [
    {
      characterId: "char-tovin-ash",
      name: "Tovin Ash",
      role: "rival surveyor",
      pressure: "He offers legal restoration if Nara lets him aim the key at the frontier gates.",
    },
    {
      characterId: "char-mirel-sorn",
      name: "Mirel Sorn",
      role: "frontier guide",
      pressure: "She knows the honest route but demands Nara name the convoy she failed.",
    },
    {
      characterId: "char-bellwarden-kael",
      name: "Bellwarden Kael",
      role: "local authority",
      pressure: "He can bar Nara from the city if the aurora bells mark her as oath-broken.",
    },
  ],
  worldFacts: [
    {
      worldFactId: "world-aurora-bells",
      fact: "Aurora bells ring false when an oath-breaker crosses a ward line.",
      operationalUse: "The bells can expose Nara or force her to confess before she gains entry.",
    },
    {
      worldFactId: "world-sun-metal-key",
      fact: "Sun-metal keys open locked roads but burn hotter when aimed at a living settlement.",
      operationalUse: "Using the key can save travel time while endangering the frontier city.",
    },
    {
      worldFactId: "world-surveyor-law",
      fact: "Surveyor law treats unauthorized route marks as military claims.",
      operationalUse: "Tovin can turn Nara's honest map into proof of treason if she signs it alone.",
    },
  ],
  storyDebts: [
    {
      storyDebtId: "debt-oathmark",
      promiseText: "Nara can restore her oathmark only if the frontier learns what happened to her lost convoy.",
    },
    {
      storyDebtId: "debt-key-cost",
      promiseText: "The sun-metal key's help must reveal a cost that cannot be hidden inside navigation.",
    },
  ],
  forbiddenSourceTerms: [
    "Drizzt",
    "Bruenor",
    "Wulfgar",
    "Catti-brie",
    "Crenshinibon",
    "Errtu",
    "Kessell",
    "Ten-Towns",
    "Icewind Dale",
    "Kelvin's Cairn",
    "Cryshal-Tirith",
  ],
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const values: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    if (eq >= 0) {
      values[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
      values[arg.slice(2)] = argv[++i]!
    } else {
      values[arg.slice(2)] = true
    }
  }
  const model = parseModel(typeof values.model === "string" ? values.model : "deepseek-v4-flash")
  const thinking = values.thinking === true || (model === "deepseek-v4-pro" && values["no-thinking"] !== true)
  const maxTokens = typeof values["max-tokens"] === "string"
    ? positiveInt(values["max-tokens"], "--max-tokens")
    : (model === "deepseek-v4-pro" ? 24000 : 12000)
  return {
    referencePath: typeof values.reference === "string" ? values.reference : DEFAULT_REFERENCE_PATH,
    chapterLabel: typeof values.chapter === "string" ? values.chapter : "1",
    outputDir: typeof values["output-dir"] === "string" ? values["output-dir"] : DEFAULT_OUTPUT_DIR,
    live: values.live === true,
    writeChapter: values.write === true || values["write-chapter"] === true,
    sceneCalls: values["scene-calls"] === true || values["scene-writer"] === true,
    model,
    thinking,
    maxTokens,
  }
}

function parseModel(value: string): ModelId {
  if (value === "deepseek-v4-flash" || value === "deepseek-v4-pro") return value
  throw new Error(`--model must be deepseek-v4-flash or deepseek-v4-pro; got ${value}`)
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

export function buildRecreationPacket(args: {
  reference: CorpusStructureReference
  referencePath: string
  chapterLabel: string
  generatedAt: string
}): RecreationPacket {
  const chapter = args.reference.chapters.find(row => row.chapterLabel === args.chapterLabel)
  if (!chapter) {
    throw new Error(`chapter ${args.chapterLabel} not found in reference; available: ${args.reference.chapters.map(row => row.chapterLabel).join(", ")}`)
  }
  const sceneBlueprints = chapter.scenes.map(scene => ({
    referenceSceneOrdinal: scene.sceneOrdinal,
    targetWords: scene.wordCount,
    targetBeatCount: scene.beatCount,
    sourceStructuralDigest: scene.plotPointSummary,
    beatPurposeHints: scene.beatSummaries,
    valueIn: scene.valueShift?.valueIn ?? null,
    valueOut: scene.valueShift?.valueOut ?? null,
    polarity: scene.valueShift?.polarity ?? null,
    micePrimaryThread: scene.mice?.primaryThread ?? null,
    opensThread: scene.mice?.opensThread ?? false,
    closesThread: scene.mice?.closesThread ?? false,
    beatKindCounts: scene.beatKindCounts,
    boundarySignalCounts: scene.boundarySignalCounts,
    gapSizeCounts: scene.gapSizeCounts,
  }))
  return {
    schemaVersion: "1.0",
    generatedAt: args.generatedAt,
    sourceReference: {
      path: args.referencePath,
      novel: args.reference.source.novel,
      book: args.reference.source.book,
      chapterLabel: args.chapterLabel,
      sourceBoundary: "structural-only",
    },
    originalAnalogSeed: ORIGINAL_ANALOG_SEED,
    target: {
      chapterLabel: chapter.chapterLabel,
      targetWords: chapter.wordCount,
      sceneCount: chapter.sceneCount,
      beatCount: chapter.beatCount,
      sceneBlueprints,
      chapterPattern: {
        polaritySequence: sceneBlueprints.map(scene => scene.polarity ?? "unknown"),
        miceSequence: sceneBlueprints.map(scene => scene.micePrimaryThread ?? "unknown"),
        medianSceneWords: median(sceneBlueprints.map(scene => scene.targetWords)),
        medianBeatsPerScene: median(sceneBlueprints.map(scene => scene.targetBeatCount)),
      },
    },
    evidenceTiers: {
      required: [
        "originalAnalogSeed",
        "target.chapterLabel",
        "target.sceneBlueprints",
        "output schema",
        "source boundary",
      ],
      supporting: [
        "target.chapterPattern",
        "target targetWords/beatCount as pacing guidance",
        "target.sourceStructuralDigest when present as structural-function hint only",
      ],
      inventory: [
        "sourceReference novel/book/path",
      ],
    },
  }
}

export function comparePlanToReference(plan: RecreationPlan, packet: RecreationPacket): PlanComparison {
  const expectedScenes = packet.target.sceneBlueprints
  const issues: string[] = []
  if (plan.scenes.length !== expectedScenes.length) {
    issues.push(`scene count mismatch: expected ${expectedScenes.length}, got ${plan.scenes.length}`)
  }
  const expectedPolarity = expectedScenes.map(scene => scene.polarity ?? "unknown")
  const actualPolarity = plan.scenes.map(scene => polarityFromValues(scene.valueIn, scene.valueOut))
  const expectedMice = expectedScenes.map(scene => scene.micePrimaryThread ?? "unknown")
  const actualMice = plan.scenes.map(scene => scene.miceThread || "unknown")
  const polarityMatches = countPositionMatches(expectedPolarity, actualPolarity)
  const miceMatches = countPositionMatches(expectedMice, actualMice)
  const expectedBeatHints = expectedScenes.reduce((sum, scene) => sum + scene.targetBeatCount, 0)
  const actualBeatHints = plan.scenes.reduce((sum, scene) => sum + scene.beatHints.length, 0)
  if (polarityMatches / Math.max(1, expectedPolarity.length) < 0.5) {
    issues.push("less than half of scene polarity sequence matched")
  }
  if (miceMatches / Math.max(1, expectedMice.length) < 0.5) {
    issues.push("less than half of MICE/thread sequence matched")
  }
  if (actualBeatHints < Math.floor(expectedBeatHints * 0.6)) {
    issues.push(`beat hint shape is too thin: expected about ${expectedBeatHints}, got ${actualBeatHints}`)
  }
  const sceneContract = buildSceneContractDiagnostics(plan, packet)
  for (const scene of sceneContract.scenes) {
    if (scene.issues.length > 0) {
      issues.push(`scene contract weak for ${scene.sceneId}: ${scene.issues.join(", ")}`)
    }
  }
  return {
    sceneCount: {
      expected: expectedScenes.length,
      actual: plan.scenes.length,
      match: plan.scenes.length === expectedScenes.length,
    },
    valuePolarity: {
      expected: expectedPolarity,
      actual: actualPolarity,
      exactMatches: polarityMatches,
      ratio: round(polarityMatches / Math.max(1, expectedPolarity.length)),
    },
    miceThread: {
      expected: expectedMice,
      actual: actualMice,
      exactMatches: miceMatches,
      ratio: round(miceMatches / Math.max(1, expectedMice.length)),
    },
    beatHintShape: {
      expectedTotal: expectedBeatHints,
      actualTotal: actualBeatHints,
      ratio: round(actualBeatHints / Math.max(1, expectedBeatHints)),
    },
    sceneContract,
    issues,
  }
}

function buildSceneContractDiagnostics(plan: RecreationPlan, packet: RecreationPacket): PlanComparison["sceneContract"] {
  const scenes = plan.scenes.map(scene => evaluateSceneContract(scene, plan, packet))
  return {
    total: scenes.length,
    choiceAlternativeCount: scenes.filter(scene => scene.hasChoiceAlternatives).length,
    declaredObligationCount: scenes.filter(scene => scene.hasDeclaredObligation).length,
    knownSourceIdCount: scenes.filter(scene => scene.hasKnownSourceIds).length,
    observableConsequenceCount: scenes.filter(scene => scene.hasObservableConsequence).length,
    scenes,
  }
}

function evaluateSceneContract(scene: RecreationPlan["scenes"][number], plan: RecreationPlan, packet: RecreationPacket): SceneContractDiagnostic {
  const issues: string[] = []
  const obligations = plan.obligations.filter(obligation => obligation.sceneId === scene.sceneId)
  const knownSourceIds = knownPressureSourceIds(packet)
  const unknownSourceIds = obligations
    .map(obligation => obligation.sourceId)
    .filter(sourceId => !knownSourceIds.has(sourceId))
  const hasChoiceAlternatives = scene.choiceAlternatives.length >= 2
  const hasDeclaredObligation = obligations.length > 0
  const hasKnownSourceIds = hasDeclaredObligation && unknownSourceIds.length === 0
  const hasObservableConsequence = isObservableConsequence(scene.consequence, scene.outcome)
  if (!hasChoiceAlternatives) issues.push("choiceAlternatives must declare at least two options")
  if (!hasDeclaredObligation) issues.push("scene lacks explicit obligation sourceIds")
  if (unknownSourceIds.length > 0) issues.push(`unknown obligation sourceIds: ${unknownSourceIds.join(", ")}`)
  if (!hasObservableConsequence) issues.push("consequence is generic, internal-only, or indistinct from outcome")
  return {
    sceneId: scene.sceneId,
    hasChoiceAlternatives,
    hasDeclaredObligation,
    hasKnownSourceIds,
    hasObservableConsequence,
    unknownSourceIds,
    issues,
  }
}

export function compareChapterToPlan(chapter: ExampleChapter, plan: RecreationPlan, packet: RecreationPacket): ChapterComparison {
  const text = chapter.scenes.map(scene => scene.prose).join("\n\n")
  const words = wordCount(text)
  const forbiddenTermsPresent = packet.originalAnalogSeed.forbiddenSourceTerms
    .filter(term => new RegExp(`\\b${escapeRegExp(term)}\\b`, "iu").test(text))
  const issues: string[] = []
  if (chapter.scenes.length !== plan.scenes.length) {
    issues.push(`scene count mismatch: expected ${plan.scenes.length}, got ${chapter.scenes.length}`)
  }
  const sceneWordCounts = plan.scenes.map(scene => {
    const actual = wordCount(chapter.scenes.find(row => row.sceneId === scene.sceneId)?.prose ?? "")
    const minimum = minimumSceneWords(scene.targetWords)
    return {
      sceneId: scene.sceneId,
      target: scene.targetWords,
      minimum,
      actual,
      ratio: round(actual / Math.max(1, scene.targetWords)),
      meetsMinimum: actual >= minimum,
    }
  })
  const ratio = words / Math.max(1, plan.targetWords)
  if (ratio < 0.65 || ratio > 1.45) {
    issues.push(`word count outside broad POC band: ${words} words for target ${plan.targetWords}`)
  }
  const thinScenes = sceneWordCounts.filter(scene => !scene.meetsMinimum)
  if (thinScenes.length > 0) {
    issues.push(`scene prose below minimum: ${thinScenes.map(scene => `${scene.sceneId} ${scene.actual}/${scene.minimum}`).join(", ")}`)
  }
  if (forbiddenTermsPresent.length > 0) {
    issues.push(`source terms appeared in generated chapter: ${forbiddenTermsPresent.join(", ")}`)
  }
  return {
    sceneCount: {
      expected: plan.scenes.length,
      actual: chapter.scenes.length,
      match: plan.scenes.length === chapter.scenes.length,
    },
    sceneWordCounts,
    wordCount: {
      target: plan.targetWords,
      actual: words,
      ratio: round(ratio),
    },
    sourceBoundary: { forbiddenTermsPresent },
    issues,
  }
}

function polarityFromValues(valueIn: string, valueOut: string): string {
  if (valueIn === valueOut) return "0"
  if (valueOut === "+" || valueOut === "-" || valueOut === "0") return valueOut
  return valueOut || "unknown"
}

function countPositionMatches(expected: string[], actual: string[]): number {
  const count = Math.min(expected.length, actual.length)
  let matches = 0
  for (let i = 0; i < count; i++) if (expected[i] === actual[i]) matches++
  return matches
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length
}

function isObservableConsequence(consequence: string, outcome: string): boolean {
  const normalizedConsequence = normalizeForExactComparison(consequence)
  const normalizedOutcome = normalizeForExactComparison(outcome)
  if (wordCount(consequence) < 4) return false
  if (normalizedConsequence === normalizedOutcome) return false
  if (/^(nara )?(realizes|understands|knows|feels|wonders|decides|thinks)\b/iu.test(consequence.trim())) return false
  if (/\b(things|situation|everything|something)\s+(changes|worsens|shifts)\b/iu.test(consequence)) return false
  return true
}

function normalizeForExactComparison(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim()
}

function knownPressureSourceIds(packet: RecreationPacket): Set<string> {
  return new Set([
    packet.originalAnalogSeed.protagonist.characterId,
    ...packet.originalAnalogSeed.supportingCharacters.map(character => character.characterId),
    ...packet.originalAnalogSeed.worldFacts.map(fact => fact.worldFactId),
    ...packet.originalAnalogSeed.storyDebts.map(debt => debt.storyDebtId),
  ])
}

function minimumSceneWords(targetWords: number): number {
  return Math.max(120, Math.floor(targetWords * 0.7))
}

function sceneDraftingTargets(plan: RecreationPlan): Array<{
  sceneId: string
  targetWords: number
  minimumWords: number
  minimumParagraphs: number
}> {
  return plan.scenes.map(scene => ({
    sceneId: scene.sceneId,
    targetWords: scene.targetWords,
    minimumWords: minimumSceneWords(scene.targetWords),
    minimumParagraphs: minimumSceneParagraphs(scene.targetWords),
  }))
}

function minimumSceneParagraphs(targetWords: number): number {
  return Math.max(3, Math.ceil(minimumSceneWords(targetWords) / 100))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function stablePlannerPrompt(): string {
  return `You are a diagnostic upstream planner for Novel Harness.

You create ORIGINAL fiction plans from a structural reference. The target is full structural imitation: scene count, scene size, scene-function cadence, value turns, thread movement, tension/gap shape, and annotation-beat density.

Hard rules:
- Do not copy source prose, names, proper nouns, places, or exact events.
- Do not imitate a living author's prose style. Imitate only structural granularity: scene count, value-turn cadence, thread movement, and action-pulp pacing.
- Use the provided original analog seed. Keep all names/events original to that seed.
- If sourceStructuralDigest or beatPurposeHints are present, translate their structural job into the original analog seed. Do not reuse their literal events.
- Treat scenes as the plan/write/check unit.
- Treat beat hints as internal annotations inside scenes, not separate writer calls.
- Every scene needs a crisisChoice plus a choiceAlternatives array with explicit options tied to the protagonist's want, need, lie, or truth.
- Every scene needs active pressure from a supporting character, world fact, or story debt. Declare that pressure with obligations whose sourceId exactly matches a provided characterId, worldFactId, or storyDebtId.
- Outcome and consequence must be distinct. The consequence should be observable pressure caused by the scene turn, not only an internal realization.
- Add obligations for scene-specific character/world/story-debt pressure that the writer must dramatize.
- Output ONLY valid JSON matching this schema:
{
  "plan": {
    "chapterId": "analog-ch01",
    "title": "string",
    "targetWords": 1800,
    "chapterFunction": "string",
    "endpointOrHook": "string",
    "scenes": [
      {
        "sceneId": "analog-ch01-sc01",
        "referenceSceneOrdinal": 0,
        "targetWords": 400,
        "structuralRole": "string",
        "povCharacterId": "char-nara-venn",
        "locationOrArena": "string",
        "goal": "string",
        "opposition": "string",
        "turningPoint": "string",
        "crisisChoice": "string",
        "choiceAlternatives": ["string", "string"],
        "climaxAction": "string",
        "outcome": "string",
        "consequence": "string",
        "valueIn": "+|-|0",
        "valueOut": "+|-|0",
        "miceThread": "M|I|C|E|unknown",
        "beatHints": [
          {"kind": "action|dialogue|interiority|description", "boundarySignal": "string", "gapSize": "none|small|medium|large", "purpose": "string"}
        ]
      }
    ],
    "obligations": [
      {"obligationId": "obl-...", "sceneId": "analog-ch01-sc01", "sourceId": "char/world/debt id", "requirementText": "string"}
    ]
  }
}`
}

function plannerUserPrompt(packet: RecreationPacket): string {
  return `VOLATILE INPUT PACKET

Required evidence:
${JSON.stringify({
  originalAnalogSeed: packet.originalAnalogSeed,
  target: packet.target,
}, null, 2)}

Supporting evidence:
${JSON.stringify(packet.evidenceTiers.supporting, null, 2)}

Task:
Create one original analog chapter plan. Match the reference chapter's structural granularity closely:
- exact scene count;
- similar per-scene target word counts;
- similar valueIn/valueOut/polarity sequence;
- similar MICE/thread sequence;
- beatHints count roughly tracks targetBeatCount for each scene.
- if sourceStructuralDigest/beatPurposeHints are present, map each source structural function to an original analog function.
- each scene's choiceAlternatives should name concrete options and make Nara's oathmark/convoy/witness/escape pressure matter;
- each scene should carry active relationship or world pressure when applicable, with obligations whose sourceId exactly matches the pressure the writer must dramatize;
- each scene's consequence should be externally observable or create a future obligation/threat.

Do not use source names or exact source events.`
}

function stableWriterPrompt(): string {
  return `You are a diagnostic fiction writer for Novel Harness.

You write ORIGINAL prose from an original analog plan.

Hard rules:
- Do not copy source prose, names, proper nouns, places, or exact events.
- Do not imitate a living author's prose style. Use only the structural plan's pacing and scene rhythm.
- Keep the prose suitable for a commercial action-fantasy POC.
- Write one scene per plan scene and return JSON only.
- Use no markdown fences.
- Output ONLY valid JSON matching this schema:
{
  "chapterTitle": "string",
  "scenes": [
    {"sceneId": "analog-ch01-sc01", "prose": "scene prose"}
  ],
  "fullProse": "all scenes joined with blank lines"
}`
}

function writerUserPrompt(packet: RecreationPacket, plan: RecreationPlan): string {
  return `VOLATILE INPUT PACKET

Original analog seed:
${JSON.stringify(packet.originalAnalogSeed, null, 2)}

Plan to draft:
${JSON.stringify(plan, null, 2)}

Scene drafting budgets:
${JSON.stringify(sceneDraftingTargets(plan), null, 2)}

Task:
Draft the example chapter from this plan. Aim for roughly ${plan.targetWords} words total.
Each scene prose field must meet or exceed its minimumWords value and should land near its own targetWords value.
Do not summarize the plan; dramatize each scene with concrete action, dialogue, physical setting, and interior pressure.
Satisfy every scene's goal, opposition, turning point, crisis choice, climax action, outcome, and consequence.
Use several paragraphs per scene when needed to reach the target. Expand through action, dialogue, observed world detail, and choices under pressure rather than explanation.
Use scene-level flow; do not mechanically label beats in the prose.`
}

function writerRetryPrompt(packet: RecreationPacket, plan: RecreationPlan, comparison: ChapterComparison): string {
  return `${writerUserPrompt(packet, plan)}

Previous draft comparison:
${JSON.stringify(comparison, null, 2)}

Repair instruction:
- If word count was too low, rewrite the full chapter and expand every under-minimum scene until it meets the scene drafting budget.
- Expand by fully dramatizing each planned scene rather than adding exposition.
- Preserve the same sceneIds and scene order.
- Do not add source names, source places, or exact source events.
- Keep the chapter original to the analog seed.`
}

function stableSceneWriterPrompt(): string {
  return `You are a diagnostic fiction scene writer for Novel Harness.

You write ONE complete original scene from an original analog scene plan.

Hard rules:
- Do not copy source prose, names, proper nouns, places, or exact events.
- Do not imitate a living author's prose style. Use only the structural plan's pacing and scene rhythm.
- Write prose, not a synopsis. The scene should have concrete action, dialogue, physical setting, and interior pressure.
- The minimumWords and targetWords values are validator-backed. Meet the minimumWords value.
- Return JSON only. Use no markdown fences.
- Output ONLY valid JSON matching this schema:
{
  "sceneId": "analog-ch01-sc01",
  "prose": "complete scene prose"
}`
}

interface PreviousSceneAttempt {
  actualWords: number
  minimumWords: number
  issue: string
  previousProse?: string
}

function sceneWriterUserPrompt(packet: RecreationPacket, plan: RecreationPlan, scene: RecreationPlan["scenes"][number], previous?: PreviousSceneAttempt): string {
  const sceneTarget = {
    sceneId: scene.sceneId,
    targetWords: scene.targetWords,
    minimumWords: minimumSceneWords(scene.targetWords),
    minimumParagraphs: minimumSceneParagraphs(scene.targetWords),
  }
  return `VOLATILE INPUT PACKET

Original analog seed:
${JSON.stringify(packet.originalAnalogSeed, null, 2)}

Chapter-level context:
${JSON.stringify({
  chapterId: plan.chapterId,
  title: plan.title,
  chapterFunction: plan.chapterFunction,
  endpointOrHook: plan.endpointOrHook,
  totalScenes: plan.scenes.length,
  obligationsForScene: plan.obligations.filter(obligation => obligation.sceneId === scene.sceneId),
}, null, 2)}

Scene plan:
${JSON.stringify(scene, null, 2)}

Scene drafting budget:
${JSON.stringify(sceneTarget, null, 2)}
${previous ? `
Previous scene attempt failed deterministic validation:
${JSON.stringify({
  actualWords: previous.actualWords,
  minimumWords: previous.minimumWords,
  issue: previous.issue,
}, null, 2)}
${previous.previousProse ? `
Previous scene prose to expand:
${previous.previousProse}
` : ""}
Return the complete expanded scene, not only additions. Preserve the same sceneId and expand through dramatized action/dialogue/choice until it meets minimumWords.
` : ""}
Task:
Draft this one scene as complete original prose. Use at least the requested minimumParagraphs, and do not stop at a synopsis. Satisfy the goal, opposition, turningPoint, crisisChoice, climaxAction, outcome, consequence, and beatHints.`
}

async function writeChapterBySceneCalls(args: {
  packet: RecreationPacket
  plan: RecreationPlan
  model: ModelId
  maxTokens: number
}): Promise<ExampleChapter> {
  const scenes: ExampleScene[] = []
  for (const scene of args.plan.scenes) {
    let lastIssue: PreviousSceneAttempt | undefined
    let parsedScene: ExampleScene | null = null
    let bestScene: ExampleScene | null = null
    let bestWordCount = -1
    for (let attempt = 1; attempt <= 3; attempt++) {
      let rawScene: unknown
      try {
        rawScene = await callDeepSeekJson({
          model: args.model,
          thinking: false,
          temperature: 0.78,
          maxTokens: args.maxTokens,
          systemPrompt: stableSceneWriterPrompt(),
          userPrompt: sceneWriterUserPrompt(args.packet, args.plan, scene, lastIssue),
          label: `scene-recreation-${scene.referenceSceneOrdinal + 1}-${attempt}`,
        })
      } catch (error) {
        if (error instanceof ModelJsonParseError && attempt < 3) {
          lastIssue = {
            actualWords: 0,
            minimumWords: minimumSceneWords(scene.targetWords),
            issue: "previous scene attempt returned invalid JSON; rewrite as valid JSON with escaped quotes",
          }
          continue
        }
        throw error
      }
      const parsed = exampleSceneSchema.safeParse(rawScene)
      if (!parsed.success) {
        throw new Error(`scene output invalid: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
      }
      parsedScene = parsed.data
      if (parsedScene.sceneId !== scene.sceneId) {
        throw new Error(`scene output id mismatch: expected ${scene.sceneId}, got ${parsedScene.sceneId}`)
      }
      const actualWords = wordCount(parsedScene.prose)
      const minimumWords = minimumSceneWords(scene.targetWords)
      if (actualWords > bestWordCount) {
        bestScene = parsedScene
        bestWordCount = actualWords
      }
      if (actualWords >= minimumWords) break
      lastIssue = {
        actualWords,
        minimumWords,
        issue: `scene below minimum: ${actualWords}/${minimumWords}`,
        previousProse: parsedScene.prose,
      }
    }
    if (bestScene && (!parsedScene || wordCount(parsedScene.prose) < wordCount(bestScene.prose))) {
      parsedScene = bestScene
    }
    if (!parsedScene) throw new Error(`scene writer returned no scene for ${scene.sceneId}`)
    scenes.push(parsedScene)
  }
  return {
    chapterTitle: args.plan.title,
    scenes,
    fullProse: scenes.map(scene => scene.prose).join("\n\n"),
  }
}

async function callDeepSeekJson(args: {
  model: ModelId
  thinking: boolean
  temperature: number
  maxTokens: number
  systemPrompt: string
  userPrompt: string
  label: string
}): Promise<unknown> {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error("DEEPSEEK_API_KEY not set in .env")
  const timeoutMs = args.model === "deepseek-v4-pro" ? 300_000 : 180_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
  try {
    console.log(`[LLM] ${args.label}: ${args.model}, thinking=${args.thinking ? "on" : "off"}, maxTokens=${args.maxTokens}`)
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: args.model,
        messages: [
          { role: "system", content: args.systemPrompt },
          { role: "user", content: args.userPrompt },
        ],
        temperature: args.temperature,
        max_tokens: args.maxTokens,
        response_format: { type: "json_object" },
        thinking: { type: args.thinking ? "enabled" : "disabled" },
      }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${text.slice(0, 500)}`)
    const data = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number }
    }
    const finish = data.choices?.[0]?.finish_reason ?? null
    const content = data.choices?.[0]?.message?.content ?? ""
    const promptTokens = data.usage?.prompt_tokens ?? 0
    const completionTokens = data.usage?.completion_tokens ?? 0
    const cachedTokens = data.usage?.prompt_cache_hit_tokens ?? 0
    const cache = cachedTokens > 0 ? ` cache=${cachedTokens}` : ""
    console.log(`[LLM] ${args.label}: ${promptTokens}+${completionTokens}${cache}; finish=${finish ?? "unknown"}`)
    if (finish === "length") throw new Error(`${args.label} hit completion cap`)
    return parseJsonResponseContent(args.label, content)
  } finally {
    clearTimeout(timer)
  }
}

export function parseJsonResponseContent(label: string, content: string): unknown {
  let extracted: string
  try {
    extracted = extractJson(content)
  } catch (error) {
    throw new ModelJsonParseError(label, content.slice(0, 1000), error)
  }
  try {
    return JSON.parse(extracted)
  } catch (error) {
    throw new ModelJsonParseError(label, extracted.slice(0, 1000), error)
  }
}

function extractJson(raw: string): string {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "")
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error(`no JSON object in response: ${trimmed.slice(0, 200)}`)
  return trimmed.slice(start, end + 1)
}

export function renderRecreationReport(args: {
  packet: RecreationPacket
  plan: RecreationPlan | null
  planComparison: PlanComparison | null
  chapter: ExampleChapter | null
  chapterComparison: ChapterComparison | null
}): string {
  const lines: string[] = []
  lines.push("# Corpus Recreation POC")
  lines.push("")
  lines.push(`Generated: ${args.packet.generatedAt}`)
  lines.push(`Reference: ${args.packet.sourceReference.book} chapter ${args.packet.sourceReference.chapterLabel}`)
  lines.push("Mode: original structural analog, not source prose/style imitation")
  lines.push("")
  lines.push("## Target")
  lines.push("")
  lines.push(`- Scenes: ${args.packet.target.sceneCount}`)
  lines.push(`- Target words: ${args.packet.target.targetWords}`)
  lines.push(`- Annotation beats: ${args.packet.target.beatCount}`)
  lines.push(`- Polarity sequence: ${args.packet.target.chapterPattern.polaritySequence.join(" ")}`)
  lines.push(`- MICE/thread sequence: ${args.packet.target.chapterPattern.miceSequence.join(" ")}`)
  if (args.planComparison) {
    lines.push("")
    lines.push("## Plan Fit")
    lines.push("")
    lines.push(`- Scene count: ${args.planComparison.sceneCount.actual}/${args.planComparison.sceneCount.expected}`)
    lines.push(`- Polarity sequence match: ${args.planComparison.valuePolarity.exactMatches}/${args.planComparison.valuePolarity.expected.length} (${args.planComparison.valuePolarity.ratio})`)
    lines.push(`- MICE sequence match: ${args.planComparison.miceThread.exactMatches}/${args.planComparison.miceThread.expected.length} (${args.planComparison.miceThread.ratio})`)
    lines.push(`- Beat hint shape: ${args.planComparison.beatHintShape.actualTotal}/${args.planComparison.beatHintShape.expectedTotal} (${args.planComparison.beatHintShape.ratio})`)
    lines.push(`- Scene contract choices: ${args.planComparison.sceneContract.choiceAlternativeCount}/${args.planComparison.sceneContract.total}`)
    lines.push(`- Scenes with declared obligations: ${args.planComparison.sceneContract.declaredObligationCount}/${args.planComparison.sceneContract.total}`)
    lines.push(`- Scenes with known obligation sourceIds: ${args.planComparison.sceneContract.knownSourceIdCount}/${args.planComparison.sceneContract.total}`)
    lines.push(`- Observable consequences: ${args.planComparison.sceneContract.observableConsequenceCount}/${args.planComparison.sceneContract.total}`)
    if (args.planComparison.issues.length) {
      lines.push(`- Issues: ${args.planComparison.issues.join("; ")}`)
    } else {
      lines.push("- Issues: none")
    }
  }
  if (args.chapterComparison) {
    lines.push("")
    lines.push("## Chapter Fit")
    lines.push("")
    lines.push(`- Scene count: ${args.chapterComparison.sceneCount.actual}/${args.chapterComparison.sceneCount.expected}`)
    lines.push(`- Word count: ${args.chapterComparison.wordCount.actual}/${args.chapterComparison.wordCount.target} (${args.chapterComparison.wordCount.ratio})`)
    lines.push(`- Scene word counts: ${args.chapterComparison.sceneWordCounts.map(scene => `${scene.sceneId} ${scene.actual}/${scene.target}`).join("; ")}`)
    lines.push(`- Forbidden source terms: ${args.chapterComparison.sourceBoundary.forbiddenTermsPresent.length ? args.chapterComparison.sourceBoundary.forbiddenTermsPresent.join(", ") : "none"}`)
    if (args.chapterComparison.issues.length) {
      lines.push(`- Issues: ${args.chapterComparison.issues.join("; ")}`)
    } else {
      lines.push("- Issues: none")
    }
  }
  lines.push("")
  lines.push("## Next")
  lines.push("")
  lines.push("- Operator reviews plan/chapter side by side against the local reference.")
  lines.push("- If structure is close enough, promote the planner packet shape into a repeatable diagnostic cohort.")
  lines.push("- Do not wire runtime writer/checker changes from this single POC.")
  return `${lines.join("\n")}\n`
}

async function main(): Promise<void> {
  const args = parseArgs()
  const referencePath = resolve(process.cwd(), args.referencePath)
  if (!existsSync(referencePath)) throw new Error(`reference not found: ${referencePath}`)
  const reference = JSON.parse(readFileSync(referencePath, "utf-8")) as CorpusStructureReference
  const packet = buildRecreationPacket({
    reference,
    referencePath: args.referencePath,
    chapterLabel: args.chapterLabel,
    generatedAt: new Date().toISOString(),
  })

  const outputDir = resolve(process.cwd(), args.outputDir)
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "packet.json"), `${JSON.stringify(packet, null, 2)}\n`)

  let plan: RecreationPlan | null = null
  let planComparison: PlanComparison | null = null
  let chapter: ExampleChapter | null = null
  let chapterComparison: ChapterComparison | null = null

  if (args.live) {
    const rawPlan = await callDeepSeekJson({
      model: args.model,
      thinking: args.thinking,
      temperature: 0.35,
      maxTokens: args.maxTokens,
      systemPrompt: stablePlannerPrompt(),
      userPrompt: plannerUserPrompt(packet),
      label: "planner-recreation",
    })
    const parsed = recreationPlanSchema.safeParse(rawPlan)
    if (!parsed.success) {
      throw new Error(`planner output invalid: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
    }
    plan = parsed.data.plan
    planComparison = comparePlanToReference(plan, packet)
    writeFileSync(join(outputDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`)
    writeFileSync(join(outputDir, "plan-comparison.json"), `${JSON.stringify(planComparison, null, 2)}\n`)
  }

  if (args.writeChapter) {
    if (!plan) throw new Error("--write requires --live so a plan exists")
    if (args.sceneCalls) {
      chapter = await writeChapterBySceneCalls({
        packet,
        plan,
        model: args.model,
        maxTokens: args.maxTokens,
      })
      chapterComparison = compareChapterToPlan(chapter, plan, packet)
    } else {
      let writerPrompt = writerUserPrompt(packet, plan)
      for (let attempt = 1; attempt <= 2; attempt++) {
        const rawChapter = await callDeepSeekJson({
          model: args.model,
          thinking: false,
          temperature: 0.75,
          maxTokens: args.maxTokens,
          systemPrompt: stableWriterPrompt(),
          userPrompt: writerPrompt,
          label: `chapter-recreation-${attempt}`,
        })
        const parsed = exampleChapterSchema.safeParse(rawChapter)
        if (!parsed.success) {
          throw new Error(`chapter output invalid: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
        }
        chapter = parsed.data
        chapterComparison = compareChapterToPlan(chapter, plan, packet)
        if (chapterComparison.issues.length === 0) break
        if (attempt < 2) writerPrompt = writerRetryPrompt(packet, plan, chapterComparison)
      }
    }
    writeFileSync(join(outputDir, "chapter.json"), `${JSON.stringify(chapter, null, 2)}\n`)
    writeFileSync(join(outputDir, "chapter.md"), `# ${chapter.chapterTitle}\n\n${chapter.scenes.map(scene => scene.prose).join("\n\n***\n\n")}\n`)
    writeFileSync(join(outputDir, "chapter-comparison.json"), `${JSON.stringify(chapterComparison, null, 2)}\n`)
  }

  const report = renderRecreationReport({ packet, plan, planComparison, chapter, chapterComparison })
  writeFileSync(join(outputDir, "report.md"), report)
  console.log(`wrote ${join(outputDir, "packet.json")}`)
  console.log(`wrote ${join(outputDir, "report.md")}`)
  if (plan) console.log(`wrote ${join(outputDir, "plan.json")}`)
  if (chapter) console.log(`wrote ${join(outputDir, "chapter.md")}`)
}

if (import.meta.main) await main()
