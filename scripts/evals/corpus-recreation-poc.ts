#!/usr/bin/env bun
/**
 * Diagnostic-only corpus structure recreation POC.
 *
 * It uses a corpus-derived chapter/scene reference as structural target, then
 * asks the model to create an original analog plan and optional example
 * chapter. It must not copy source prose, names, or exact events.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { z } from "zod"

import type { CorpusStructureReference } from "./corpus-structure-reference"
import {
  RUN_MANIFEST_FILENAME,
  artifactRef,
  buildRunManifest,
  existingArtifactRefs,
  writeRunManifest,
} from "./run-manifest"
import { corpusRecreationVariantLabel } from "./corpus-recreation-variant"

type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro"
type PlannerVariant = "baseline" | "materiality-v1" | "causal-materiality-v2" | "causal-motivation-v3"
type PlannerContractRetryMode = "none" | "structural-v1"
type WriterContextMode = "baseline" | "thread-context-v1" | "thread-character-context-v1"
type WriterExpansionMode = "none" | "retry-short-scenes-v1"

interface Args {
  referencePath: string
  chapterLabel: string
  outputDir: string
  planFromDir: string | null
  allowDisposablePoc: boolean
  live: boolean
  writeChapter: boolean
  sceneCalls: boolean
  model: ModelId
  thinking: boolean
  maxTokens: number
  plannerVariant: PlannerVariant
  plannerContractRetryMode: PlannerContractRetryMode
  writerContextMode: WriterContextMode
  writerExpansionMode: WriterExpansionMode
  sequenceContextDirs: string[]
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
  diagnosticConfig?: {
    plannerVariant: PlannerVariant
    plannerContractRetryMode?: PlannerContractRetryMode
    writerContextMode?: WriterContextMode
    writerExpansionMode?: WriterExpansionMode
  }
  sequenceContext?: SequenceContext
}

interface SequenceContext {
  sourceDirs: string[]
  priorChapters: Array<{
    chapterLabel: string
    chapterId: string | null
    sceneIds: string[]
    storyDebtMovements: Array<{
      sceneId: string
      obligationId: string
      threadId: string | null
      promiseId: string | null
      payoffId: string | null
      payoffEventId: string | null
      storyDebtStage: string | null
      requirementText: string
    }>
    finalPayoffEventIds: string[]
    openPromiseIds: string[]
    finalPayoffPromiseIds: string[]
  }>
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
  storyThreads: Array<{
    threadId: string
    kind: "main_plot" | "character_arc" | "relationship" | "world_rule" | "mystery"
    label: string
    description: string
  }>
  storyDebts: Array<{
    storyDebtId: string
    threadId: string
    promiseText: string
  }>
  storyPayoffs: Array<{
    payoffId: string
    threadId: string
    storyDebtId: string
    payoffText: string
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

const optionalModelStringSchema = z.preprocess(
  value => value === "" ? undefined : value,
  z.string().min(1).nullish(),
).transform(value => value ?? undefined)

const storyDebtStageSchema = z.preprocess(
  value => value === "" ? undefined : value,
  z.enum(["open", "progress", "complicate", "partial_payoff", "final_payoff", "aftermath", "escalation"]).nullish(),
).transform(value => value ?? undefined)

const recreationSceneTurnSchema = z.object({
  sceneTurnId: z.string().min(1),
  sceneId: z.string().min(1),
  summary: z.string().min(8),
  turnType: optionalModelStringSchema,
})

const recreationScenePlanSchema = z.object({
  sceneId: z.string().min(1),
  referenceSceneOrdinal: z.number().int().min(0),
  targetWords: z.number().int().min(50),
  structuralRole: z.string().min(8),
  povCharacterId: z.string().min(1),
  povPersonalStake: optionalModelStringSchema,
  requiredCharacterIds: z.array(z.string().min(1)).default([]),
  affectedCharacterIds: z.array(z.string().min(1)).default([]),
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
    sceneTurns: z.array(recreationSceneTurnSchema).default([]),
    obligations: z.array(z.object({
      obligationId: z.string().min(1),
      sceneId: z.string().min(1),
      sceneTurnId: optionalModelStringSchema,
      sourceId: z.string().min(1),
      threadId: optionalModelStringSchema,
      promiseId: optionalModelStringSchema,
      payoffId: optionalModelStringSchema,
      payoffEventId: optionalModelStringSchema,
      storyDebtStage: storyDebtStageSchema,
      requirementText: z.string().min(8),
      materialityTest: optionalModelStringSchema,
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
})

type RecreationPlan = z.infer<typeof recreationPlanSchema>["plan"]
type ExampleChapter = z.infer<typeof exampleChapterSchema>
type ExampleScene = z.infer<typeof exampleSceneSchema>

const PLANNER_PROMPT_VERSION = "scene-turn-child-thread-v8"

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
    knownThreadRefCount: number
    knownPromiseRefCount: number
    knownPayoffRefCount: number
    orphanPayoffRefCount: number
    promiseThreadMismatchCount: number
    payoffThreadMismatchCount: number
    sceneTurnCount: number
    sceneTurnRefCount: number
    sceneTurnRefIssueCount: number
    characterRefClosureCount: number
    characterRefIssueCount: number
    povPersonalStakeCount: number
    invalidSceneTurnSceneIds: string[]
    duplicateSceneTurnIds: string[]
    observableConsequenceCount: number
    materialityTestCount: number
    scenes: SceneContractDiagnostic[]
  }
  issues: string[]
}

interface SceneContractDiagnostic {
  sceneId: string
  hasChoiceAlternatives: boolean
  hasPovPersonalStake: boolean
  hasDeclaredObligation: boolean
  hasKnownSourceIds: boolean
  hasKnownThreadRefs: boolean
  unknownThreadIds: string[]
  unknownPromiseIds: string[]
  unknownPayoffIds: string[]
  orphanPayoffIds: string[]
  promiseThreadMismatchIds: string[]
  payoffThreadMismatchIds: string[]
  requiredCharacterIds: string[]
  affectedCharacterIds: string[]
  unknownRequiredCharacterIds: string[]
  unknownAffectedCharacterIds: string[]
  missingLocalCharacterIds: string[]
  missingAffectedCharacterIds: string[]
  missingNamedCharacterIds: string[]
  sceneTurnIds: string[]
  unknownSceneTurnIds: string[]
  crossSceneTurnIds: string[]
  hasObservableConsequence: boolean
  hasMaterialityTest: boolean
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
  warnings: string[]
}

interface PlannerContractRetryAudit {
  mode: PlannerContractRetryMode
  attempts: Array<{
    attempt: number
    retried: boolean
    issueCount: number
    issues: string[]
  }>
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
  storyThreads: [
    {
      threadId: "thread-oathmark-public-accountability",
      kind: "character_arc",
      label: "Nara's oathmark and public responsibility",
      description: "Nara moves from private escape toward public responsibility for the lost convoy.",
    },
    {
      threadId: "thread-key-cost",
      kind: "world_rule",
      label: "The sun-metal key has a visible cost",
      description: "Each helpful use of the key should create danger, leverage, or exposure that cannot be hidden.",
    },
    {
      threadId: "thread-tovin-leverage",
      kind: "relationship",
      label: "Tovin converts help into leverage",
      description: "Tovin's offers and observations should tighten his leverage over Nara's route.",
    },
  ],
  storyDebts: [
    {
      storyDebtId: "debt-oathmark",
      threadId: "thread-oathmark-public-accountability",
      promiseText: "Nara can restore her oathmark only if the frontier learns what happened to her lost convoy.",
    },
    {
      storyDebtId: "debt-key-cost",
      threadId: "thread-key-cost",
      promiseText: "The sun-metal key's help must reveal a cost that cannot be hidden inside navigation.",
    },
  ],
  storyPayoffs: [
    {
      payoffId: "payoff-oathmark-public-confession",
      threadId: "thread-oathmark-public-accountability",
      storyDebtId: "debt-oathmark",
      payoffText: "Nara names the lost convoy or otherwise accepts public responsibility before witnesses.",
    },
    {
      payoffId: "payoff-key-cost-exposure",
      threadId: "thread-key-cost",
      storyDebtId: "debt-key-cost",
      payoffText: "The key's useful action creates public exposure, danger to the city, or leverage for a rival.",
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

export function parseArgs(argv = process.argv.slice(2)): Args {
  const values: Record<string, string | true | string[]> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) continue
    const eq = arg.indexOf("=")
    const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2)
    const value = eq >= 0
      ? arg.slice(eq + 1)
      : (i + 1 < argv.length && !argv[i + 1]!.startsWith("--") ? argv[++i]! : true)
    if (key === "sequence-context") {
      values[key] = [...(Array.isArray(values[key]) ? values[key] as string[] : []), String(value)]
      continue
    }
    if (eq >= 0) {
      values[key] = String(value)
    } else if (value !== true) {
      values[key] = String(value)
    } else {
      values[key] = true
    }
  }
  const model = parseModel(typeof values.model === "string" ? values.model : "deepseek-v4-flash")
  const thinking = values.thinking === true || (model === "deepseek-v4-pro" && values["no-thinking"] !== true)
  const maxTokens = typeof values["max-tokens"] === "string"
    ? positiveInt(values["max-tokens"], "--max-tokens")
    : (model === "deepseek-v4-pro" ? 24000 : 12000)
  const plannerVariant = parsePlannerVariant(
    typeof values["planner-variant"] === "string" ? values["planner-variant"] : "baseline",
  )
  const plannerContractRetryMode = parsePlannerContractRetryMode(
    typeof values["planner-contract-retry"] === "string" ? values["planner-contract-retry"] : "none",
  )
  const writerContextMode = parseWriterContextMode(
    typeof values["writer-context"] === "string" ? values["writer-context"] : "thread-character-context-v1",
  )
  const writerExpansionMode = parseWriterExpansionMode(
    typeof values["writer-expansion"] === "string" ? values["writer-expansion"] : "none",
  )
  return {
    referencePath: typeof values.reference === "string" ? values.reference : DEFAULT_REFERENCE_PATH,
    chapterLabel: typeof values.chapter === "string" ? values.chapter : "1",
    outputDir: typeof values["output-dir"] === "string" ? values["output-dir"] : DEFAULT_OUTPUT_DIR,
    planFromDir: typeof values["plan-from"] === "string" ? values["plan-from"] : null,
    allowDisposablePoc: values["allow-disposable-poc"] === true || values["allow-disposable-corpus-poc"] === true,
    live: values.live === true,
    writeChapter: values.write === true || values["write-chapter"] === true,
    sceneCalls: values["scene-calls"] === true || values["scene-writer"] === true,
    model,
    thinking,
    maxTokens,
    plannerVariant,
    plannerContractRetryMode,
    writerContextMode,
    writerExpansionMode,
    sequenceContextDirs: Array.isArray(values["sequence-context"]) ? values["sequence-context"] as string[] : [],
  }
}

function parseModel(value: string): ModelId {
  if (value === "deepseek-v4-flash" || value === "deepseek-v4-pro") return value
  throw new Error(`--model must be deepseek-v4-flash or deepseek-v4-pro; got ${value}`)
}

function parsePlannerVariant(value: string): PlannerVariant {
  if (
    value === "baseline"
    || value === "materiality-v1"
    || value === "causal-materiality-v2"
    || value === "causal-motivation-v3"
  ) return value
  throw new Error(`--planner-variant must be baseline, materiality-v1, causal-materiality-v2, or causal-motivation-v3; got ${value}`)
}

function parsePlannerContractRetryMode(value: string): PlannerContractRetryMode {
  if (value === "none" || value === "structural-v1") return value
  throw new Error(`--planner-contract-retry must be none or structural-v1; got ${value}`)
}

function parseWriterContextMode(value: string): WriterContextMode {
  if (value === "baseline" || value === "thread-context-v1" || value === "thread-character-context-v1") return value
  throw new Error(`--writer-context must be baseline, thread-context-v1, or thread-character-context-v1; got ${value}`)
}

function parseWriterExpansionMode(value: string): WriterExpansionMode {
  if (value === "none" || value === "retry-short-scenes-v1") return value
  throw new Error(`--writer-expansion must be none or retry-short-scenes-v1; got ${value}`)
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/evals/corpus-recreation-poc.ts [--chapter <label>] [--output-dir <dir>]
    --allow-disposable-poc
    [--live] [--write] [--scene-calls]
    [--model deepseek-v4-flash|deepseek-v4-pro]
    [--planner-variant baseline|materiality-v1|causal-materiality-v2|causal-motivation-v3]
    [--planner-contract-retry none|structural-v1]
    [--writer-context baseline|thread-context-v1|thread-character-context-v1]
    [--writer-expansion none|retry-short-scenes-v1]
    [--sequence-context <prior-poc-dir>]
    [--plan-from <poc-dir>]

Examples:
  bun run diagnostics:corpus-recreation-poc -- --allow-disposable-poc --chapter 2 --output-dir output/poc-ch2
  bun run diagnostics:corpus-recreation-poc -- --allow-disposable-poc --chapter 2 --live --planner-variant materiality-v1
  bun run diagnostics:corpus-recreation-poc -- --allow-disposable-poc --chapter 2 --live --planner-variant causal-materiality-v2
  bun run diagnostics:corpus-recreation-poc -- --allow-disposable-poc --chapter 2 --live --planner-variant causal-motivation-v3
`)
}

function wantsHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h")
}

export function assertDisposablePocAllowed(args: { allowDisposablePoc: boolean }): void {
  if (args.allowDisposablePoc) return
  throw new Error([
    "diagnostics:corpus-recreation-poc is historical/disposable under L106 and is not the default production path.",
    "Use production drafting, scene-semantic review, Plan Readiness import/review/apply, or corpus artifact analysis commands for mainline work.",
    "Pass --allow-disposable-poc only when intentionally creating a disposable corpus-recreation POC artifact.",
  ].join(" "))
}

export function buildRecreationPacket(args: {
  reference: CorpusStructureReference
  referencePath: string
  chapterLabel: string
  generatedAt: string
  plannerVariant?: PlannerVariant
  plannerContractRetryMode?: PlannerContractRetryMode
  writerContextMode?: WriterContextMode
  writerExpansionMode?: WriterExpansionMode
  sequenceContext?: SequenceContext
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
    diagnosticConfig: {
      plannerVariant: args.plannerVariant ?? "baseline",
      plannerContractRetryMode: args.plannerContractRetryMode ?? "none",
      writerContextMode: args.writerContextMode ?? "baseline",
      writerExpansionMode: args.writerExpansionMode ?? "none",
    },
    sequenceContext: args.sequenceContext,
  }
}

export function buildSequenceContextFromPocDirs(pocDirs: string[]): SequenceContext {
  return {
    sourceDirs: pocDirs,
    priorChapters: pocDirs.map(readSequenceContextChapter),
  }
}

function readSequenceContextChapter(pocDir: string): SequenceContext["priorChapters"][number] {
  const resolved = resolve(process.cwd(), pocDir)
  const packet = JSON.parse(readFileSync(join(resolved, "packet.json"), "utf-8")) as RecreationPacket
  const plan = parseRecreationPlanOutput({ plan: JSON.parse(readFileSync(join(resolved, "plan.json"), "utf-8")) })
  const movements = plan.obligations
    .filter(obligation => obligation.promiseId || obligation.payoffId || obligation.payoffEventId || obligation.storyDebtStage)
    .map(obligation => ({
      sceneId: obligation.sceneId,
      obligationId: obligation.obligationId,
      threadId: obligation.threadId ?? null,
      promiseId: obligation.promiseId ?? null,
      payoffId: obligation.payoffId ?? null,
      payoffEventId: obligation.payoffEventId ?? null,
      storyDebtStage: obligation.storyDebtStage ?? null,
      requirementText: obligation.requirementText,
    }))
  return {
    chapterLabel: packet.sourceReference?.chapterLabel ?? plan.chapterId,
    chapterId: plan.chapterId ?? null,
    sceneIds: plan.scenes.map(scene => scene.sceneId),
    storyDebtMovements: movements,
    finalPayoffEventIds: uniqueStrings(movements
      .filter(movement => movement.storyDebtStage === "final_payoff")
      .map(movement => movement.payoffEventId)
      .filter((value): value is string => Boolean(value))),
    openPromiseIds: uniqueStrings(movements
      .filter(movement => movement.promiseId && movement.storyDebtStage !== "final_payoff")
      .map(movement => movement.promiseId)
      .filter((value): value is string => Boolean(value))),
    finalPayoffPromiseIds: uniqueStrings(movements
      .filter(movement => movement.promiseId && movement.storyDebtStage === "final_payoff")
      .map(movement => movement.promiseId)
      .filter((value): value is string => Boolean(value))),
  }
}

export function comparePlanToReference(
  plan: RecreationPlan,
  packet: RecreationPacket,
  opts: { requireMaterialityTests?: boolean; requirePovPersonalStake?: boolean } = {},
): PlanComparison {
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
  const sceneContract = buildSceneContractDiagnostics(plan, packet, opts)
  if (sceneContract.invalidSceneTurnSceneIds.length > 0) {
    issues.push(`sceneTurns point to unknown sceneIds: ${sceneContract.invalidSceneTurnSceneIds.join(", ")}`)
  }
  if (sceneContract.duplicateSceneTurnIds.length > 0) {
    issues.push(`duplicate sceneTurnIds: ${sceneContract.duplicateSceneTurnIds.join(", ")}`)
  }
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

function buildSceneContractDiagnostics(
  plan: RecreationPlan,
  packet: RecreationPacket,
  opts: { requireMaterialityTests?: boolean; requirePovPersonalStake?: boolean },
): PlanComparison["sceneContract"] {
  const scenes = plan.scenes.map(scene => evaluateSceneContract(scene, plan, packet, opts))
  const sceneTurns = plan.sceneTurns ?? []
  const knownSceneIds = new Set(plan.scenes.map(scene => scene.sceneId))
  const duplicateSceneTurnIds = duplicateStrings(sceneTurns.map(turn => turn.sceneTurnId))
  const invalidSceneTurnSceneIds = sceneTurns
    .filter(turn => !knownSceneIds.has(turn.sceneId))
    .map(turn => `${turn.sceneTurnId}:${turn.sceneId}`)
  return {
    total: scenes.length,
    choiceAlternativeCount: scenes.filter(scene => scene.hasChoiceAlternatives).length,
    declaredObligationCount: scenes.filter(scene => scene.hasDeclaredObligation).length,
    knownSourceIdCount: scenes.filter(scene => scene.hasKnownSourceIds).length,
    knownThreadRefCount: scenes.filter(scene => scene.hasKnownThreadRefs).length,
    knownPromiseRefCount: scenes.filter(scene => scene.unknownPromiseIds.length === 0).length,
    knownPayoffRefCount: scenes.filter(scene => scene.unknownPayoffIds.length === 0).length,
    orphanPayoffRefCount: scenes.reduce((sum, scene) => sum + scene.orphanPayoffIds.length, 0),
    promiseThreadMismatchCount: scenes.reduce((sum, scene) => sum + scene.promiseThreadMismatchIds.length, 0),
    payoffThreadMismatchCount: scenes.reduce((sum, scene) => sum + scene.payoffThreadMismatchIds.length, 0),
    sceneTurnCount: sceneTurns.length,
    sceneTurnRefCount: plan.obligations.filter(obligation => Boolean(obligation.sceneTurnId)).length,
    sceneTurnRefIssueCount: invalidSceneTurnSceneIds.length
      + duplicateSceneTurnIds.length
      + scenes.reduce((sum, scene) => sum + scene.unknownSceneTurnIds.length + scene.crossSceneTurnIds.length, 0),
    characterRefClosureCount: scenes.filter(scene =>
      scene.unknownRequiredCharacterIds.length === 0
      && scene.unknownAffectedCharacterIds.length === 0
      && scene.missingLocalCharacterIds.length === 0
      && scene.missingAffectedCharacterIds.length === 0
    ).length,
    characterRefIssueCount: scenes.reduce((sum, scene) =>
      sum
      + scene.unknownRequiredCharacterIds.length
      + scene.unknownAffectedCharacterIds.length
      + scene.missingLocalCharacterIds.length
      + scene.missingAffectedCharacterIds.length, 0
    ),
    povPersonalStakeCount: scenes.filter(scene => scene.hasPovPersonalStake).length,
    invalidSceneTurnSceneIds,
    duplicateSceneTurnIds,
    observableConsequenceCount: scenes.filter(scene => scene.hasObservableConsequence).length,
    materialityTestCount: scenes.filter(scene => scene.hasMaterialityTest).length,
    scenes,
  }
}

function evaluateSceneContract(
  scene: RecreationPlan["scenes"][number],
  plan: RecreationPlan,
  packet: RecreationPacket,
  opts: { requireMaterialityTests?: boolean; requirePovPersonalStake?: boolean },
): SceneContractDiagnostic {
  const issues: string[] = []
  const obligations = plan.obligations.filter(obligation => obligation.sceneId === scene.sceneId)
  const knownSourceIds = knownPressureSourceIds(packet)
  const knownThreadIds = new Set(packet.originalAnalogSeed.storyThreads.map(thread => thread.threadId))
  const knownPromiseIds = new Set(packet.originalAnalogSeed.storyDebts.map(debt => debt.storyDebtId))
  const knownPayoffIds = new Set(packet.originalAnalogSeed.storyPayoffs.map(payoff => payoff.payoffId))
  const knownCharacterIds = knownSeedCharacterIds(packet)
  const promiseById = new Map(packet.originalAnalogSeed.storyDebts.map(debt => [debt.storyDebtId, debt]))
  const payoffById = new Map(packet.originalAnalogSeed.storyPayoffs.map(payoff => [payoff.payoffId, payoff]))
  const sceneTurnById = new Map((plan.sceneTurns ?? []).map(turn => [turn.sceneTurnId, turn]))
  const hasPovPersonalStake = typeof scene.povPersonalStake === "string" && scene.povPersonalStake.trim().length >= 8
  const unknownSourceIds = obligations
    .map(obligation => obligation.sourceId)
    .filter(sourceId => !knownSourceIds.has(sourceId))
  const missingThreadIds = obligations
    .filter(obligation => !obligation.threadId)
    .map(obligation => obligation.obligationId)
  const unknownThreadIds = obligations
    .map(obligation => obligation.threadId)
    .filter((threadId): threadId is string => Boolean(threadId))
    .filter(threadId => !knownThreadIds.has(threadId))
  const unknownPromiseIds = obligations
    .map(obligation => obligation.promiseId)
    .filter((promiseId): promiseId is string => Boolean(promiseId))
    .filter(promiseId => !knownPromiseIds.has(promiseId))
  const unknownPayoffIds = obligations
    .map(obligation => obligation.payoffId)
    .filter((payoffId): payoffId is string => Boolean(payoffId))
    .filter(payoffId => !knownPayoffIds.has(payoffId))
  const requiredCharacterIds = uniqueStrings(scene.requiredCharacterIds ?? [])
  const affectedCharacterIds = uniqueStrings(scene.affectedCharacterIds ?? [])
  const unknownRequiredCharacterIds = requiredCharacterIds.filter(characterId => !knownCharacterIds.has(characterId))
  const unknownAffectedCharacterIds = affectedCharacterIds.filter(characterId => !knownCharacterIds.has(characterId))
  const characterSourceIds = obligations
    .map(obligation => obligation.sourceId)
    .filter(sourceId => knownCharacterIds.has(sourceId))
  const localNamedCharacterIds = charactersNamedInLocalSceneContract(scene, packet)
  const affectedNamedCharacterIds = charactersNamedInText(scene.consequence, packet)
    .filter(characterId => !localNamedCharacterIds.includes(characterId))
  const missingLocalCharacterIds = localNamedCharacterIds
    .filter(characterId => characterId !== scene.povCharacterId)
    .filter(characterId => !requiredCharacterIds.includes(characterId) && !characterSourceIds.includes(characterId))
  const missingAffectedCharacterIds = affectedNamedCharacterIds
    .filter(characterId => characterId !== scene.povCharacterId)
    .filter(characterId =>
      !affectedCharacterIds.includes(characterId)
      && !requiredCharacterIds.includes(characterId)
      && !characterSourceIds.includes(characterId)
    )
  const missingNamedCharacterIds = uniqueStrings([
    ...missingLocalCharacterIds,
    ...missingAffectedCharacterIds,
  ])
  const orphanPayoffIds = obligations
    .filter(obligation => obligation.payoffId)
    .filter(obligation => {
      const payoff = payoffById.get(obligation.payoffId!)
      return !obligation.promiseId || Boolean(payoff && payoff.storyDebtId !== obligation.promiseId)
    })
    .map(obligation => obligation.payoffId!)
  const promiseThreadMismatchIds = obligations
    .filter(obligation => obligation.threadId && obligation.promiseId)
    .filter(obligation => knownThreadIds.has(obligation.threadId!) && knownPromiseIds.has(obligation.promiseId!))
    .filter(obligation => {
      const promise = promiseById.get(obligation.promiseId!)
      return Boolean(promise && promise.threadId !== obligation.threadId)
    })
    .map(obligation => `${obligation.obligationId}:${obligation.promiseId}`)
  const payoffThreadMismatchIds = obligations
    .filter(obligation => obligation.threadId && obligation.payoffId)
    .filter(obligation => knownThreadIds.has(obligation.threadId!) && knownPayoffIds.has(obligation.payoffId!))
    .filter(obligation => {
      const payoff = payoffById.get(obligation.payoffId!)
      return Boolean(payoff && payoff.threadId !== obligation.threadId)
    })
    .map(obligation => `${obligation.obligationId}:${obligation.payoffId}`)
  const nonPayoffStagePayoffRefs = obligations
    .filter(obligation => obligation.payoffId || obligation.payoffEventId)
    .filter(obligation => obligation.storyDebtStage && !isPayoffDebtStage(obligation.storyDebtStage))
    .map(obligation => `${obligation.obligationId}:${obligation.storyDebtStage}`)
  const payoffStageMissingEventIds = obligations
    .filter(obligation => obligation.payoffId && obligation.storyDebtStage && isPayoffDebtStage(obligation.storyDebtStage))
    .filter(obligation => !obligation.payoffEventId)
    .map(obligation => obligation.obligationId)
  const eventIdsWithoutPayoffs = obligations
    .filter(obligation => obligation.payoffEventId && !obligation.payoffId)
    .map(obligation => obligation.obligationId)
  const sceneTurnIds = uniqueStrings(obligations
    .map(obligation => obligation.sceneTurnId)
    .filter((sceneTurnId): sceneTurnId is string => Boolean(sceneTurnId)))
  const unknownSceneTurnIds = obligations
    .filter(obligation => obligation.sceneTurnId && !sceneTurnById.has(obligation.sceneTurnId))
    .map(obligation => `${obligation.obligationId}:${obligation.sceneTurnId}`)
  const crossSceneTurnIds = obligations
    .filter(obligation => obligation.sceneTurnId && sceneTurnById.has(obligation.sceneTurnId))
    .filter(obligation => sceneTurnById.get(obligation.sceneTurnId!)!.sceneId !== obligation.sceneId)
    .map(obligation => `${obligation.obligationId}:${obligation.sceneTurnId}->${sceneTurnById.get(obligation.sceneTurnId!)!.sceneId}`)
  const hasChoiceAlternatives = scene.choiceAlternatives.length >= 2
  const hasDeclaredObligation = obligations.length > 0
  const hasKnownSourceIds = hasDeclaredObligation && unknownSourceIds.length === 0
  const hasKnownThreadRefs = hasDeclaredObligation
    && missingThreadIds.length === 0
    && unknownThreadIds.length === 0
    && unknownPromiseIds.length === 0
    && unknownPayoffIds.length === 0
    && orphanPayoffIds.length === 0
    && promiseThreadMismatchIds.length === 0
    && payoffThreadMismatchIds.length === 0
    && nonPayoffStagePayoffRefs.length === 0
    && payoffStageMissingEventIds.length === 0
    && eventIdsWithoutPayoffs.length === 0
  const hasObservableConsequence = isObservableConsequence(scene.consequence, scene.outcome)
  const hasMaterialityTest = hasDeclaredObligation && obligations.every(obligation =>
    typeof obligation.materialityTest === "string" && obligation.materialityTest.trim().length >= 8
  )
  if (!hasChoiceAlternatives) issues.push("choiceAlternatives must declare at least two options")
  if (opts.requirePovPersonalStake && !hasPovPersonalStake) {
    issues.push("scene needs povPersonalStake naming the personal fear, wound, oath, need, lie, or relationship pressure behind the crisisChoice")
  }
  if (!hasDeclaredObligation) issues.push("scene lacks explicit obligation sourceIds")
  if (unknownSourceIds.length > 0) issues.push(`unknown obligation sourceIds: ${unknownSourceIds.join(", ")}`)
  if (missingThreadIds.length > 0) issues.push(`obligations missing threadId: ${missingThreadIds.join(", ")}`)
  if (unknownThreadIds.length > 0) issues.push(`unknown threadIds: ${unknownThreadIds.join(", ")}`)
  if (unknownPromiseIds.length > 0) issues.push(`unknown promiseIds: ${unknownPromiseIds.join(", ")}`)
  if (unknownPayoffIds.length > 0) issues.push(`unknown payoffIds: ${unknownPayoffIds.join(", ")}`)
  if (unknownRequiredCharacterIds.length > 0) issues.push(`unknown requiredCharacterIds: ${unknownRequiredCharacterIds.join(", ")}`)
  if (unknownAffectedCharacterIds.length > 0) issues.push(`unknown affectedCharacterIds: ${unknownAffectedCharacterIds.join(", ")}`)
  if (missingLocalCharacterIds.length > 0) issues.push(`local named characters missing requiredCharacterIds/source obligation: ${missingLocalCharacterIds.join(", ")}`)
  if (missingAffectedCharacterIds.length > 0) issues.push(`consequence characters missing affectedCharacterIds/requiredCharacterIds/source obligation: ${missingAffectedCharacterIds.join(", ")}`)
  if (orphanPayoffIds.length > 0) issues.push(`payoffIds do not belong to declared promiseId: ${orphanPayoffIds.join(", ")}`)
  if (promiseThreadMismatchIds.length > 0) issues.push(`promiseIds belong to different threadId: ${promiseThreadMismatchIds.join(", ")}`)
  if (payoffThreadMismatchIds.length > 0) issues.push(`payoffIds belong to different threadId: ${payoffThreadMismatchIds.join(", ")}`)
  if (nonPayoffStagePayoffRefs.length > 0) issues.push(`non-payoff storyDebtStage rows carry payoff refs: ${nonPayoffStagePayoffRefs.join(", ")}`)
  if (payoffStageMissingEventIds.length > 0) issues.push(`payoff storyDebtStage rows missing payoffEventId: ${payoffStageMissingEventIds.join(", ")}`)
  if (eventIdsWithoutPayoffs.length > 0) issues.push(`payoffEventId rows missing payoffId: ${eventIdsWithoutPayoffs.join(", ")}`)
  if (unknownSceneTurnIds.length > 0) issues.push(`unknown sceneTurnIds: ${unknownSceneTurnIds.join(", ")}`)
  if (crossSceneTurnIds.length > 0) issues.push(`sceneTurnIds point to different scene: ${crossSceneTurnIds.join(", ")}`)
  if (!hasObservableConsequence) issues.push("consequence is generic, internal-only, or indistinct from outcome")
  if (opts.requireMaterialityTests && !hasMaterialityTest) {
    issues.push("each obligation needs a materialityTest for how it changes choice, cost, relationship state, outcome, or future pressure")
  }
  return {
    sceneId: scene.sceneId,
    hasChoiceAlternatives,
    hasPovPersonalStake,
    hasDeclaredObligation,
    hasKnownSourceIds,
    hasKnownThreadRefs,
    unknownThreadIds,
    unknownPromiseIds,
    unknownPayoffIds,
    orphanPayoffIds,
    promiseThreadMismatchIds,
    payoffThreadMismatchIds,
    requiredCharacterIds,
    affectedCharacterIds,
    unknownRequiredCharacterIds,
    unknownAffectedCharacterIds,
    missingLocalCharacterIds,
    missingAffectedCharacterIds,
    missingNamedCharacterIds,
    sceneTurnIds,
    unknownSceneTurnIds,
    crossSceneTurnIds,
    hasObservableConsequence,
    hasMaterialityTest,
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
  const warnings: string[] = []
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
    warnings.push(`word count outside broad POC band: ${words} words for target ${plan.targetWords}`)
  }
  const thinScenes = sceneWordCounts.filter(scene => !scene.meetsMinimum)
  if (thinScenes.length > 0) {
    warnings.push(`scene prose below advisory floor: ${thinScenes.map(scene => `${scene.sceneId} ${scene.actual}/${scene.minimum}`).join(", ")}`)
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
    warnings,
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

function isPayoffDebtStage(stage: string): boolean {
  return stage === "partial_payoff" || stage === "final_payoff"
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

function knownSeedCharacterIds(packet: RecreationPacket): Set<string> {
  return new Set([
    packet.originalAnalogSeed.protagonist.characterId,
    ...packet.originalAnalogSeed.supportingCharacters.map(character => character.characterId),
  ])
}

function charactersNamedInLocalSceneContract(
  scene: RecreationPlan["scenes"][number],
  packet: RecreationPacket,
): string[] {
  const searchable = [
    scene.structuralRole,
    scene.goal,
    scene.opposition,
    scene.turningPoint,
    scene.crisisChoice,
    scene.climaxAction,
    scene.outcome,
    ...scene.beatHints.map(beat => beat.purpose),
  ].join("\n")
  const named: string[] = []
  for (const character of [
    packet.originalAnalogSeed.protagonist,
    ...packet.originalAnalogSeed.supportingCharacters,
  ]) {
    if (characterNameAppears(searchable, character.name)) named.push(character.characterId)
  }
  return uniqueStrings(named)
}

function charactersNamedInText(text: string, packet: RecreationPacket): string[] {
  const named: string[] = []
  for (const character of [
    packet.originalAnalogSeed.protagonist,
    ...packet.originalAnalogSeed.supportingCharacters,
  ]) {
    if (characterNameAppears(text, character.name)) named.push(character.characterId)
  }
  return uniqueStrings(named)
}

function characterNameAppears(text: string, name: string): boolean {
  const parts = name.split(/\s+/u).map(part => part.trim()).filter(part => part.length >= 3)
  const fullNameAppears = new RegExp(`\\b${escapeRegExp(name)}\\b`, "iu").test(text)
  if (fullNameAppears) return true
  return parts.some(part => new RegExp(`\\b${escapeRegExp(part)}\\b`, "u").test(text))
}

function minimumSceneWords(targetWords: number): number {
  return Math.max(120, Math.floor(targetWords * 0.7))
}

function sceneDraftingTargets(plan: RecreationPlan): Array<{
  sceneId: string
  targetWords: number
  advisoryFloorWords: number
  minimumParagraphs: number
}> {
  return plan.scenes.map(scene => ({
    sceneId: scene.sceneId,
    targetWords: scene.targetWords,
    advisoryFloorWords: minimumSceneWords(scene.targetWords),
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

function duplicateStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicate = new Set<string>()
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) duplicate.add(value)
    seen.add(value)
  }
  return [...duplicate].sort()
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
- Every scene needs requiredCharacterIds for any non-POV provided character named in the scene contract, unless that character already has a character-source obligation in that scene.
- Use affectedCharacterIds for provided characters named only as downstream consequence or future pressure, not local scene participants.
- Every obligation needs threadId. Use threadId to name the narrative continuity vector being moved.
- Use promiseId when an obligation opens, progresses, complicates, or pays a story debt. promiseId must match a provided storyDebtId.
- Use payoffId when an obligation lands or partially lands a planned payoff. payoffId must match a provided payoffId and belong to the same promiseId/storyDebtId.
- payoffId is the parent/canonical payoff category. When a concrete scene lands a payoff, also add a unique payoffEventId for that local payoff event, for example "payoff-event-ch02-key-cost-wall-scar".
- Use storyDebtStage for story-debt obligations: open, progress, complicate, partial_payoff, final_payoff, aftermath, or escalation.
- Use final_payoff only when this scene truly resolves the parent story debt for the sequence. Use partial_payoff, aftermath, or escalation for local chapter landings that should not close the parent debt.
- Do not set payoffId or payoffEventId on open, progress, or complicate rows. Only partial_payoff and final_payoff rows can carry payoffId/payoffEventId.
- When an obligation includes promiseId, its threadId must match that story debt's threadId.
- When an obligation includes payoffId, its threadId must match that payoff's threadId, and its promiseId must match that payoff's storyDebtId.
- Use sceneTurns to name causal story turns inside scenes. A sceneTurn is the parent event, choice, reveal, reversal, cost, relationship shift, setup, or payoff that can cause one or more obligations.
- When one scene turn moves multiple threads, create one sceneTurn and multiple child obligations sharing sceneTurnId. Each child obligation still has exactly one threadId, and any promiseId/payoffId must belong to that same thread.
- Do not copy a promiseId or payoffId onto a sibling child obligation just because the same sceneTurn caused it. A shared confession can create one character-arc promise obligation and one relationship-leverage obligation with the same sceneTurnId; the relationship child must leave promiseId/payoffId empty unless that relationship thread has its own provided story debt/payoff.
- If a scene action creates pressure across two threads, split it into separate obligations instead of attaching one thread's promise or payoff to another threadId.
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
        "povPersonalStake": "optional string naming the personal pressure behind the crisis choice",
        "requiredCharacterIds": ["char-tovin-ash"],
        "affectedCharacterIds": ["char-bellwarden-kael"],
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
    "sceneTurns": [
      {"sceneTurnId": "turn-...", "sceneId": "analog-ch01-sc01", "summary": "string", "turnType": "choice|reveal|reversal|cost|relationship_shift|payoff|setup"}
    ],
    "obligations": [
      {"obligationId": "obl-...", "sceneId": "analog-ch01-sc01", "sceneTurnId": "optional sceneTurnId", "sourceId": "char/world/debt id", "threadId": "thread-...", "promiseId": "optional storyDebtId", "payoffId": "optional parent payoffId", "payoffEventId": "optional unique local payoff event id", "storyDebtStage": "optional open|progress|complicate|partial_payoff|final_payoff|aftermath|escalation", "requirementText": "string", "materialityTest": "optional concrete story effect this obligation must change"}
    ]
  }
}`
}

export function plannerUserPrompt(packet: RecreationPacket, variant: PlannerVariant = "baseline"): string {
  return `VOLATILE INPUT PACKET

Required evidence:
${JSON.stringify({
  originalAnalogSeed: packet.originalAnalogSeed,
  target: packet.target,
  sequenceContext: packet.sequenceContext ?? null,
  diagnosticConfig: {
    plannerVariant: packet.diagnosticConfig?.plannerVariant ?? "baseline",
    plannerContractRetryMode: packet.diagnosticConfig?.plannerContractRetryMode ?? "none",
  },
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
- each scene should include requiredCharacterIds for any named non-POV provided character who is locally present, opposing, pressuring, speaking, or otherwise needed as writer context and is not already represented by a character-source obligation;
- each scene should include affectedCharacterIds for any named non-POV provided character who appears only in the consequence/future-pressure line and is not already represented by requiredCharacterIds or a character-source obligation;
- if sequenceContext is present, treat it as prior-chapter truth: preserve parent promiseId/threadId continuity, do not reuse prior payoffEventIds, do not mark a promise as final_payoff after it already has a prior final_payoff, and use aftermath/escalation for later pressure caused by a prior final payoff;
- every obligation should carry threadId, and story-debt/payoff obligations should also carry promiseId and payoffId when applicable;
- payoffId is the provided parent payoff category; add a unique payoffEventId for each concrete local payoff event and storyDebtStage for every story-debt movement;
- use final_payoff only when the scene truly resolves the parent story debt for the sequence; otherwise use partial_payoff, aftermath, or escalation for local landings;
- do not set payoffId or payoffEventId on open, progress, or complicate storyDebtStage rows;
- create sceneTurns for causal choices/reveals/costs that produce obligations, and attach obligations to them with sceneTurnId when useful;
- when sibling obligations share a sceneTurnId, keep each child's promiseId/payoffId inside that child's own thread only;
- keep thread refs internally consistent: promiseId must use its story debt threadId, payoffId must use its payoff threadId and matching promiseId, and cross-thread pressure should be split into separate obligations;
- each scene's consequence should be externally observable or create a future obligation/threat.
${plannerVariantTail(variant)}

Do not use source names or exact source events.`
}

export function plannerRetryPrompt(
  packet: RecreationPacket,
  variant: PlannerVariant,
  error: ModelJsonParseError,
): string {
  return plannerJsonRetryPromptFromBase(plannerUserPrompt(packet, variant), error)
}

function plannerJsonRetryPromptFromBase(basePrompt: string, error: ModelJsonParseError): string {
  return `${basePrompt}

RETRY INSTRUCTION:
The previous planner attempt returned malformed JSON and could not be parsed.
Return a complete fresh JSON object matching the schema. Do not continue or
patch the previous output. Escape quotes inside strings. Do not include
markdown fences.

Malformed-output snippet for debugging only:
${error.snippet.slice(0, 1200)}`
}

export function plannerSchemaRetryPrompt(
  packet: RecreationPacket,
  variant: PlannerVariant,
  issueSummary: string,
): string {
  return plannerSchemaRetryPromptFromBase(plannerUserPrompt(packet, variant), issueSummary)
}

function plannerSchemaRetryPromptFromBase(basePrompt: string, issueSummary: string): string {
  return `${basePrompt}

RETRY INSTRUCTION:
The previous planner attempt returned JSON that failed schema validation.
Return a complete fresh JSON object matching the schema. Do not continue or
patch the previous output. Fix every listed schema issue.

Schema issues:
${issueSummary.slice(0, 1200)}`
}

export function planContractRetryIssues(comparison: PlanComparison): string[] {
  return comparison.issues.filter(issue =>
    issue.startsWith("scene count mismatch")
    || issue.startsWith("less than half")
    || issue.startsWith("beat hint shape")
    || issue.startsWith("sceneTurns point")
    || issue.startsWith("duplicate sceneTurnIds")
    || issue.startsWith("scene contract weak")
  )
}

export function shouldRetryPlannerContract(args: {
  plannerContractRetryMode: PlannerContractRetryMode
  attempt: number
  maxAttempts: number
  comparison: PlanComparison
}): boolean {
  return args.plannerContractRetryMode === "structural-v1"
    && args.attempt < args.maxAttempts
    && planContractRetryIssues(args.comparison).length > 0
}

export function plannerContractRetryPrompt(
  packet: RecreationPacket,
  variant: PlannerVariant,
  comparison: PlanComparison,
  previousPlan: RecreationPlan,
): string {
  return `${plannerUserPrompt(packet, variant)}

CONTRACT REPAIR INSTRUCTION:
The previous planner attempt returned valid JSON, but deterministic plan checks
found structural contract issues. Return a complete fresh JSON object matching
the same schema. Preserve the previous plan wherever it is not directly involved
in a listed issue.

Fix only the listed plan-contract issues in the previous plan:
- preserve the same original analog seed, source-boundary rules, scene ids, and
  reference scene order unless the diagnostic explicitly names a scene-count or
  sequence mismatch;
- close exact character refs by adding requiredCharacterIds for local scene
  participants, adding affectedCharacterIds for downstream/offstage impact, or
  adding a character-source obligation when the character actively pressures the
  scene;
- preserve thread, promise, payoff, and sceneTurn consistency;
- if an obligation has a promiseId or payoffId whose owning thread does not
  match the obligation threadId, do not force the promise across threads; either
  split the pressure into separate obligations or remove promiseId/payoffId from
  the child obligation that is only moving the supporting-character/world thread;
- keep promiseId/payoffId only on the child obligation whose threadId matches
  the provided storyDebt/payoff thread exactly;
- keep word targets as pacing guidance only.

Deterministic issues:
${planContractRetryIssues(comparison).map(issue => `- ${issue}`).join("\n").slice(0, 3000)}

Previous valid plan to minimally repair:
${JSON.stringify({ plan: previousPlan }, null, 2)}`
}

function plannerVariantTail(variant: PlannerVariant): string {
  if (variant === "baseline") return ""
  if (variant === "causal-motivation-v3") {
    return `
Causal-motivation-v3 diagnostic variant:
- Include povPersonalStake on every scene.
- povPersonalStake must name the personal fear, wound, oath, need, lie, truth, shame, or relationship pressure that makes the crisisChoice matter to Nara.
- For every obligation, add materialityTest.
- materialityTest must name the concrete story effect the writer must dramatize: changed choice, cost, constraint, relationship state, outcome, or future pressure.
- The scene goal, crisisChoice, choiceAlternatives, climaxAction, outcome, and consequence must all be caused by the povPersonalStake plus active external pressure.
- Do not let "survive", "escape", "avoid exposure", or "find safety" stand alone as motivation; tie them to Nara's oathmark, lost convoy shame, public accountability, lie, need, or relationship risk.
- Each choiceAlternative should include a concrete tradeoff: what Nara gains, what she risks, and which personal stake and thread pressure changes.
- A world fact is material only if it constrains options, changes the cost, forces a decision, creates a danger, blocks a route, or alters the outcome.
- A supporting character is material only if they change leverage, trust, obligation, access, threat, allegiance, or the POV character's available choices.
- The turningPoint, climaxAction, outcome, and consequence should form one causal chain: personal pressure + external pressure -> choice -> irreversible external result -> future obligation/threat.
- If a sourceId cannot be made material in the scene, choose a different exact sourceId that can affect the scene's choice/outcome.`
  }
  if (variant === "causal-materiality-v2") {
    return `
Causal-materiality-v2 diagnostic variant:
- Keep the same JSON schema. Do not add fields.
- For every obligation, add materialityTest.
- materialityTest must name the concrete story effect the writer must dramatize: changed choice, cost, constraint, relationship state, outcome, or future pressure.
- Make Nara's motive causal in each scene: her want, need, lie, or truth should force the crisisChoice, not merely decorate it.
- Each choiceAlternative should include a concrete tradeoff: what Nara gains, what she risks, and which witness/oathmark/convoy pressure changes.
- A world fact is material only if it constrains options, changes the cost, forces a decision, creates a danger, blocks a route, or alters the outcome.
- A supporting character is material only if they change leverage, trust, obligation, access, threat, allegiance, or the POV character's available choices.
- The turningPoint, climaxAction, outcome, and consequence should form one causal chain: pressure -> choice -> irreversible external result -> future obligation/threat.
- If a sourceId cannot be made material in the scene, choose a different exact sourceId that can affect the scene's choice/outcome.`
  }
  return `
Materiality-v1 diagnostic variant:
- For every obligation, add materialityTest.
- materialityTest must name the concrete story effect the writer must dramatize: changed choice, cost, constraint, relationship state, outcome, or future pressure.
- Do not use vague tests like "the fact is mentioned" or "the relationship is shown".
- A world fact is material only if it constrains options, changes the cost, forces a decision, creates a danger, blocks a route, or alters the outcome.
- A supporting character is material only if they change leverage, trust, obligation, access, threat, allegiance, or the POV character's available choices.
- A story debt is material only if it opens, narrows, escalates, or pays a concrete future obligation.
- If a sourceId cannot be made material in the scene, choose a different exact sourceId that can affect the scene's choice/outcome.`
}

function stableWriterPrompt(): string {
  return `You are a diagnostic fiction writer for Novel Harness.

You draft chapter prose from the provided scene plan.

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

Analog seed:
${JSON.stringify(packet.originalAnalogSeed, null, 2)}

Plan to draft:
${JSON.stringify(plan, null, 2)}

Scene drafting budgets:
${JSON.stringify(sceneDraftingTargets(plan), null, 2)}

Task:
Draft the example chapter from this plan. Aim for roughly ${plan.targetWords} words total.
Scene word targets are pacing budgets, not hard gates. Do not pad to hit a number, but avoid synopsis-level compression.
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
- Repair only hard structural/source-boundary issues. Word count warnings alone should not cause a rewrite.
- If the prose is synopsis-like, expand by fully dramatizing the planned scene rather than adding exposition.
- Preserve the same sceneIds and scene order.
- Do not add source names, source places, or exact source events.
- Stay within the analog seed and source-boundary rules.`
}

function stableSceneWriterPrompt(): string {
  return `You are a diagnostic fiction scene writer for Novel Harness.

You draft one complete scene from the provided scene plan.

Hard rules:
- Do not copy source prose, names, proper nouns, places, or exact events.
- Do not imitate a living author's prose style. Use only the structural plan's pacing and scene rhythm.
- Write prose, not a synopsis. The scene should have concrete action, dialogue, physical setting, and interior pressure.
- The advisoryFloorWords and targetWords values are pacing guidance, not hard gates. Do not pad to a number.
- Return JSON only. Use no markdown fences.
- Output ONLY valid JSON matching this schema:
{
  "sceneId": "analog-ch01-sc01",
  "prose": "complete scene prose"
}`
}

interface PreviousSceneAttempt {
  actualWords: number
  advisoryFloorWords: number
  issue: string
  previousProse?: string
}

export interface SceneWriterThreadContextReport {
  generatedAt: string
  mode: WriterContextMode
  sceneCount: number
  contexts: Array<ReturnType<typeof sceneWriterContextForPrompt>>
}

export function sceneWriterUserPrompt(
  packet: RecreationPacket,
  plan: RecreationPlan,
  scene: RecreationPlan["scenes"][number],
  previous?: PreviousSceneAttempt,
  opts: { writerContextMode?: WriterContextMode } = {},
): string {
  const sceneTarget = {
    sceneId: scene.sceneId,
    targetWords: scene.targetWords,
    advisoryFloorWords: minimumSceneWords(scene.targetWords),
    minimumParagraphs: minimumSceneParagraphs(scene.targetWords),
  }
  const writerContextMode = opts.writerContextMode ?? "baseline"
  const writerContextLabel = writerContextMode === "thread-context-v1"
    ? "Thread context packet"
    : "Writer context packet"
  const writerContextSection = writerContextMode !== "baseline"
    ? `
${writerContextLabel} (diagnostic writer-context arm):
${JSON.stringify(sceneWriterContextForPrompt(packet, plan, scene, writerContextMode), null, 2)}
`
    : ""
  return `VOLATILE INPUT PACKET

Analog seed:
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
${writerContextSection}

Scene plan:
${JSON.stringify(scene, null, 2)}

Scene drafting budget:
${JSON.stringify(sceneTarget, null, 2)}
${previous ? `
Previous scene attempt failed structural validation:
${JSON.stringify({
  actualWords: previous.actualWords,
  advisoryFloorWords: previous.advisoryFloorWords,
  issue: previous.issue,
}, null, 2)}
${previous.previousProse ? `
Previous scene prose to expand:
${previous.previousProse}
` : ""}
Return the complete expanded scene, not only additions. Preserve the same sceneId and expand through dramatized action/dialogue/choice instead of summary.
` : ""}
Task:
Draft this one scene as complete prose. The targetWords and advisoryFloorWords values are pacing guidance, not hard gates. Do not pad to a number, but do not stop at a synopsis. Satisfy the goal, opposition, turningPoint, crisisChoice, climaxAction, outcome, consequence, and beatHints.`
}

export function sceneWriterContextForPrompt(
  packet: RecreationPacket,
  plan: RecreationPlan,
  scene: RecreationPlan["scenes"][number],
  mode: WriterContextMode = "thread-context-v1",
) {
  const base = writerContextIncludesThread(mode)
    ? sceneThreadContextForPrompt(packet, plan, scene)
    : { mode, sceneId: scene.sceneId }
  return {
    ...base,
    mode,
    ...(writerContextIncludesCharacters(mode)
      ? { characterContext: sceneCharacterContextForPrompt(packet, plan, scene) }
      : {}),
  }
}

export function sceneThreadContextForPrompt(
  packet: RecreationPacket,
  plan: RecreationPlan,
  scene: RecreationPlan["scenes"][number],
) {
  const obligations = plan.obligations.filter(obligation => obligation.sceneId === scene.sceneId)
  const activeThreadIds = uniqueStrings(obligations.map(obligation => obligation.threadId).filter(Boolean) as string[])
  const activePromiseIds = uniqueStrings(obligations.map(obligation => obligation.promiseId).filter(Boolean) as string[])
  const activePayoffIds = uniqueStrings(obligations.map(obligation => obligation.payoffId).filter(Boolean) as string[])
  const relevantRefs = new Set([...activeThreadIds, ...activePromiseIds, ...activePayoffIds])
  const sceneIndex = plan.scenes.findIndex(row => row.sceneId === scene.sceneId)
  const priorMovements = plan.scenes
    .slice(0, Math.max(0, sceneIndex))
    .flatMap(priorScene => {
      const related = plan.obligations.filter(obligation => obligation.sceneId === priorScene.sceneId && obligationSharesRef(obligation, relevantRefs))
      return related.length
        ? [{
          sceneId: priorScene.sceneId,
          obligationIds: related.map(obligation => obligation.obligationId),
          consequence: priorScene.consequence,
        }]
        : []
    })
  return {
    mode: "thread-context-v1",
    sceneId: scene.sceneId,
    activeThreads: packet.originalAnalogSeed.storyThreads
      .filter(thread => activeThreadIds.includes(thread.threadId))
      .map(thread => ({ threadId: thread.threadId, label: thread.label, kind: thread.kind, description: thread.description })),
    activePromises: packet.originalAnalogSeed.storyDebts
      .filter(debt => activePromiseIds.includes(debt.storyDebtId))
      .map(debt => ({ promiseId: debt.storyDebtId, threadId: debt.threadId, promiseText: debt.promiseText })),
    activePayoffs: packet.originalAnalogSeed.storyPayoffs
      .filter(payoff => activePayoffIds.includes(payoff.payoffId))
      .map(payoff => ({ payoffId: payoff.payoffId, threadId: payoff.threadId, promiseId: payoff.storyDebtId, payoffText: payoff.payoffText })),
    currentResponsibilities: obligations.map(obligation => ({
      obligationId: obligation.obligationId,
      sceneTurnId: obligation.sceneTurnId ?? null,
      sourceId: obligation.sourceId,
      threadId: obligation.threadId ?? null,
      promiseId: obligation.promiseId ?? null,
      payoffId: obligation.payoffId ?? null,
      payoffEventId: obligation.payoffEventId ?? null,
      storyDebtStage: obligation.storyDebtStage ?? null,
      requirementText: obligation.requirementText,
      materialityTest: obligation.materialityTest ?? null,
    })),
    priorMovements,
    futureImpactPreview: buildPromptFutureImpactPreview(plan, sceneIndex, relevantRefs),
  }
}

export function sceneCharacterContextForPrompt(
  packet: RecreationPacket,
  plan: RecreationPlan,
  scene: RecreationPlan["scenes"][number],
) {
  const obligations = plan.obligations.filter(obligation => obligation.sceneId === scene.sceneId)
  const characters = seedCharacterRegistry(packet)
  const povCharacterId = scene.povCharacterId
  const requiredCharacterIds = uniqueStrings(scene.requiredCharacterIds ?? [])
  const affectedCharacterIds = uniqueStrings(scene.affectedCharacterIds ?? [])
  const characterSourceIds = uniqueStrings(obligations
    .map(obligation => obligation.sourceId)
    .filter(sourceId => characters.has(sourceId)))
  const activeCharacterIds = uniqueStrings([
    povCharacterId,
    ...requiredCharacterIds,
    ...characterSourceIds,
  ])
  const cards = activeCharacterIds
    .map(characterId => {
      const character = characters.get(characterId)
      if (!character) return null
      const sourceObligations = obligations.filter(obligation => obligation.sourceId === characterId)
      return {
        characterId,
        name: character.name ?? characterId,
        role: character.role ?? (characterId === povCharacterId ? "pov" : "supporting"),
        sceneRole: characterId === povCharacterId ? "pov" : "supporting",
        want: character.want ?? null,
        need: character.need ?? null,
        lie: character.lie ?? null,
        truth: character.truth ?? null,
        pressure: character.pressure ?? null,
        sourceObligationIds: sourceObligations.map(obligation => obligation.obligationId),
        activeThreadIds: uniqueStrings(sourceObligations.map(obligation => obligation.threadId).filter(Boolean) as string[]),
        activePromiseIds: uniqueStrings(sourceObligations.map(obligation => obligation.promiseId).filter(Boolean) as string[]),
        activePayoffIds: uniqueStrings(sourceObligations.map(obligation => obligation.payoffId).filter(Boolean) as string[]),
      }
    })
    .filter((card): card is NonNullable<typeof card> => Boolean(card))
  return {
    mode: "character-context-v1",
    sceneId: scene.sceneId,
    povCharacterId,
    povPersonalStake: scene.povPersonalStake ?? null,
    sceneGoal: scene.goal,
    sceneOpposition: scene.opposition,
    sceneChoice: scene.crisisChoice,
    sceneOutcome: scene.outcome,
    sceneConsequence: scene.consequence,
    activeCharacterIds,
    affectedCharacterIds,
    characterCards: cards,
    missingCharacterIds: activeCharacterIds.filter(characterId => !characters.has(characterId)),
  }
}

function seedCharacterRegistry(packet: RecreationPacket): Map<string, {
  name?: string
  role?: string
  pressure?: string
  want?: string
  need?: string
  lie?: string
  truth?: string
}> {
  return new Map([
    [packet.originalAnalogSeed.protagonist.characterId, {
      name: packet.originalAnalogSeed.protagonist.name,
      role: "protagonist",
      want: packet.originalAnalogSeed.protagonist.want,
      need: packet.originalAnalogSeed.protagonist.need,
      lie: packet.originalAnalogSeed.protagonist.lie,
      truth: packet.originalAnalogSeed.protagonist.truth,
    }],
    ...packet.originalAnalogSeed.supportingCharacters.map(character => [character.characterId, {
      name: character.name,
      role: character.role,
      pressure: character.pressure,
    }] as const),
  ])
}

function writerContextIncludesThread(mode: WriterContextMode): boolean {
  return mode === "thread-context-v1" || mode === "thread-character-context-v1"
}

function writerContextIncludesCharacters(mode: WriterContextMode): boolean {
  return mode === "thread-character-context-v1"
}

function buildPromptFutureImpactPreview(
  plan: RecreationPlan,
  sceneIndex: number,
  relevantRefs: Set<string>,
): Array<{ refKind: "thread" | "promise" | "payoff"; ref: string; affectedSceneIds: string[] }> {
  const byRef = new Map<string, { refKind: "thread" | "promise" | "payoff"; ref: string; affectedSceneIds: string[] }>()
  for (const futureScene of plan.scenes.slice(sceneIndex + 1)) {
    for (const obligation of plan.obligations.filter(row => row.sceneId === futureScene.sceneId)) {
      for (const [refKind, ref] of [
        ["thread", obligation.threadId],
        ["promise", obligation.promiseId],
        ["payoff", obligation.payoffId],
      ] as Array<["thread" | "promise" | "payoff", string | undefined]>) {
        if (!ref || !relevantRefs.has(ref)) continue
        const key = `${refKind}:${ref}`
        const current = byRef.get(key) ?? { refKind, ref, affectedSceneIds: [] }
        current.affectedSceneIds = uniqueStrings([...current.affectedSceneIds, futureScene.sceneId])
        byRef.set(key, current)
      }
    }
  }
  return [...byRef.values()].sort((a, b) => a.refKind.localeCompare(b.refKind) || a.ref.localeCompare(b.ref))
}

function obligationSharesRef(obligation: RecreationPlan["obligations"][number], refs: Set<string>): boolean {
  return Boolean(
    (obligation.threadId && refs.has(obligation.threadId))
    || (obligation.promiseId && refs.has(obligation.promiseId))
    || (obligation.payoffId && refs.has(obligation.payoffId)),
  )
}

export function buildSceneWriterThreadContextReport(
  packet: RecreationPacket,
  plan: RecreationPlan,
): SceneWriterThreadContextReport {
  const mode = packet.diagnosticConfig?.writerContextMode ?? "baseline"
  return {
    generatedAt: packet.generatedAt,
    mode,
    sceneCount: plan.scenes.length,
    contexts: plan.scenes.map(scene => sceneWriterContextForPrompt(packet, plan, scene, mode)),
  }
}

async function writeChapterBySceneCalls(args: {
  packet: RecreationPacket
  plan: RecreationPlan
  model: ModelId
  maxTokens: number
  writerContextMode: WriterContextMode
  writerExpansionMode: WriterExpansionMode
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
          userPrompt: sceneWriterUserPrompt(args.packet, args.plan, scene, lastIssue, {
            writerContextMode: args.writerContextMode,
          }),
          label: `scene-recreation-${scene.referenceSceneOrdinal + 1}-${attempt}`,
        })
      } catch (error) {
        if (error instanceof ModelJsonParseError && attempt < 3) {
          lastIssue = {
            actualWords: 0,
            advisoryFloorWords: minimumSceneWords(scene.targetWords),
            issue: "previous scene attempt returned invalid JSON; rewrite as valid JSON with escaped quotes",
          }
          continue
        }
        throw error
      }
      parsedScene = parseExampleSceneOutput(rawScene, scene.sceneId)
      const actualWords = wordCount(parsedScene.prose)
      if (actualWords > bestWordCount) {
        bestScene = parsedScene
        bestWordCount = actualWords
      }
      if (shouldRetryShortScene({
        writerExpansionMode: args.writerExpansionMode,
        attempt,
        maxAttempts: 3,
        actualWords,
        advisoryFloorWords: minimumSceneWords(scene.targetWords),
      })) {
        lastIssue = {
          actualWords,
          advisoryFloorWords: minimumSceneWords(scene.targetWords),
          issue: "scene prose below advisory floor; expand the existing scene through dramatized action, dialogue, interiority, and consequence without padding",
          previousProse: parsedScene.prose,
        }
        continue
      }
      break
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

export function shouldRetryShortScene(args: {
  writerExpansionMode: WriterExpansionMode
  attempt: number
  maxAttempts: number
  actualWords: number
  advisoryFloorWords: number
}): boolean {
  return args.writerExpansionMode === "retry-short-scenes-v1"
    && args.attempt < args.maxAttempts
    && args.actualWords < args.advisoryFloorWords
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

async function callPlannerPlanWithRetry(args: {
  packet: RecreationPacket
  variant: PlannerVariant
  model: ModelId
  thinking: boolean
  maxTokens: number
  initialUserPrompt?: string
  labelPrefix?: string
}): Promise<RecreationPlan> {
  const basePrompt = args.initialUserPrompt ?? plannerUserPrompt(args.packet, args.variant)
  let userPrompt = basePrompt
  const labelPrefix = args.labelPrefix ?? "planner-recreation"
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rawPlan = await callDeepSeekJson({
        model: args.model,
        thinking: args.thinking,
        temperature: 0.35,
        maxTokens: args.maxTokens,
        systemPrompt: stablePlannerPrompt(),
        userPrompt,
        label: `${labelPrefix}-${attempt}`,
      })
      return parseRecreationPlanOutput(rawPlan)
    } catch (error) {
      if (error instanceof ModelJsonParseError && attempt < 2) {
        userPrompt = plannerJsonRetryPromptFromBase(basePrompt, error)
        continue
      }
      if (isPlannerSchemaValidationError(error) && attempt < 2) {
        userPrompt = plannerSchemaRetryPromptFromBase(basePrompt, error.message)
        continue
      }
      throw error
    }
  }
  throw new Error("planner retry loop exhausted without output")
}

function isPlannerSchemaValidationError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("planner output invalid:")
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

export function parseRecreationPlanOutput(rawPlan: unknown): RecreationPlan {
  const parsed = recreationPlanSchema.safeParse(rawPlan)
  if (!parsed.success) {
    throw new Error(`planner output invalid: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
  }
  return parsed.data.plan
}

export function parseExampleSceneOutput(rawScene: unknown, expectedSceneId: string): ExampleScene {
  const parsed = exampleSceneSchema.safeParse(rawScene)
  if (!parsed.success) {
    throw new Error(`scene output invalid: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`)
  }
  if (parsed.data.sceneId !== expectedSceneId) {
    throw new Error(`scene output id mismatch: expected ${expectedSceneId}, got ${parsed.data.sceneId}`)
  }
  return parsed.data
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
  lines.push(`Planner variant: ${args.packet.diagnosticConfig?.plannerVariant ?? "baseline"}`)
  lines.push(`Planner contract retry: ${args.packet.diagnosticConfig?.plannerContractRetryMode ?? "none"}`)
  lines.push(`Writer context: ${args.packet.diagnosticConfig?.writerContextMode ?? "baseline"}`)
  lines.push(`Writer expansion: ${args.packet.diagnosticConfig?.writerExpansionMode ?? "none"}`)
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
    lines.push(`- Scenes with known thread refs: ${args.planComparison.sceneContract.knownThreadRefCount}/${args.planComparison.sceneContract.total}`)
    lines.push(`- Scene turns declared: ${args.planComparison.sceneContract.sceneTurnCount}`)
    lines.push(`- Scene turn refs: ${args.planComparison.sceneContract.sceneTurnRefCount} refs, ${args.planComparison.sceneContract.sceneTurnRefIssueCount} issues`)
    lines.push(`- Character refs closed: ${args.planComparison.sceneContract.characterRefClosureCount}/${args.planComparison.sceneContract.total} (${args.planComparison.sceneContract.characterRefIssueCount} issues)`)
    lines.push(`- Payoff ref mismatches: ${args.planComparison.sceneContract.orphanPayoffRefCount}`)
    lines.push(`- Observable consequences: ${args.planComparison.sceneContract.observableConsequenceCount}/${args.planComparison.sceneContract.total}`)
    lines.push(`- Obligation materiality tests: ${args.planComparison.sceneContract.materialityTestCount}/${args.planComparison.sceneContract.total}`)
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
    if (args.chapterComparison.warnings.length) {
      lines.push(`- Warnings: ${args.chapterComparison.warnings.join("; ")}`)
    } else {
      lines.push("- Warnings: none")
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
  if (wantsHelp(process.argv.slice(2))) {
    printHelp()
    return
  }
  const args = parseArgs()
  assertDisposablePocAllowed(args)
  const referencePath = resolve(process.cwd(), args.referencePath)
  if (!existsSync(referencePath)) throw new Error(`reference not found: ${referencePath}`)
  const reference = JSON.parse(readFileSync(referencePath, "utf-8")) as CorpusStructureReference
  const sequenceContext = args.sequenceContextDirs.length > 0
    ? buildSequenceContextFromPocDirs(args.sequenceContextDirs)
    : undefined
  let packet = buildRecreationPacket({
    reference,
    referencePath: args.referencePath,
    chapterLabel: args.chapterLabel,
    generatedAt: new Date().toISOString(),
    plannerVariant: args.plannerVariant,
    plannerContractRetryMode: args.plannerContractRetryMode,
    writerContextMode: args.writerContextMode,
    writerExpansionMode: args.writerExpansionMode,
    sequenceContext,
  })

  if (args.planFromDir) {
    const sourcePacketPath = resolve(process.cwd(), args.planFromDir, "packet.json")
    if (existsSync(sourcePacketPath)) {
      const sourcePacket = JSON.parse(readFileSync(sourcePacketPath, "utf-8")) as RecreationPacket
      packet = {
        ...sourcePacket,
        generatedAt: new Date().toISOString(),
        diagnosticConfig: {
          plannerVariant: sourcePacket.diagnosticConfig?.plannerVariant ?? args.plannerVariant,
          plannerContractRetryMode: sourcePacket.diagnosticConfig?.plannerContractRetryMode ?? "none",
          writerContextMode: args.writerContextMode,
          writerExpansionMode: args.writerExpansionMode,
        },
        sequenceContext,
      }
    }
  }

  const outputDir = resolve(process.cwd(), args.outputDir)
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "packet.json"), `${JSON.stringify(packet, null, 2)}\n`)

  let plan: RecreationPlan | null = null
  let planComparison: PlanComparison | null = null
  let chapter: ExampleChapter | null = null
  let chapterComparison: ChapterComparison | null = null
  let writerContextReport: SceneWriterThreadContextReport | null = null
  let plannerContractRetryAudit: PlannerContractRetryAudit | null = null

  if (args.planFromDir) {
    const sourcePlanPath = resolve(process.cwd(), args.planFromDir, "plan.json")
    if (!existsSync(sourcePlanPath)) throw new Error(`--plan-from requires plan.json at ${sourcePlanPath}`)
    try {
      plan = parseRecreationPlanOutput({ plan: JSON.parse(readFileSync(sourcePlanPath, "utf-8")) })
    } catch (error) {
      throw new Error(`--plan-from plan invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    planComparison = comparePlanToReference(plan, packet, {
      requireMaterialityTests: plannerVariantRequiresMaterialityTests(packet.diagnosticConfig?.plannerVariant),
      requirePovPersonalStake: plannerVariantRequiresPovPersonalStake(packet.diagnosticConfig?.plannerVariant),
    })
    writeFileSync(join(outputDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`)
    writeFileSync(join(outputDir, "plan-comparison.json"), `${JSON.stringify(planComparison, null, 2)}\n`)
  } else if (args.live) {
    plannerContractRetryAudit = { mode: args.plannerContractRetryMode, attempts: [] }
    let plannerPrompt: string | undefined
    const maxContractAttempts = args.plannerContractRetryMode === "structural-v1" ? 2 : 1
    for (let attempt = 1; attempt <= maxContractAttempts; attempt++) {
      plan = await callPlannerPlanWithRetry({
        packet,
        variant: args.plannerVariant,
        model: args.model,
        thinking: args.thinking,
        maxTokens: args.maxTokens,
        initialUserPrompt: plannerPrompt,
        labelPrefix: attempt === 1 ? "planner-recreation" : "planner-contract-repair",
      })
      planComparison = comparePlanToReference(plan, packet, {
        requireMaterialityTests: plannerVariantRequiresMaterialityTests(packet.diagnosticConfig?.plannerVariant),
        requirePovPersonalStake: plannerVariantRequiresPovPersonalStake(packet.diagnosticConfig?.plannerVariant),
      })
      const contractIssues = planContractRetryIssues(planComparison)
      const retried = shouldRetryPlannerContract({
        plannerContractRetryMode: args.plannerContractRetryMode,
        attempt,
        maxAttempts: maxContractAttempts,
        comparison: planComparison,
      })
      plannerContractRetryAudit.attempts.push({
        attempt,
        retried,
        issueCount: contractIssues.length,
        issues: contractIssues,
      })
      if (!retried) break
      plannerPrompt = plannerContractRetryPrompt(packet, args.plannerVariant, planComparison, plan)
    }
    writeFileSync(join(outputDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`)
    writeFileSync(join(outputDir, "plan-comparison.json"), `${JSON.stringify(planComparison, null, 2)}\n`)
    if (args.plannerContractRetryMode !== "none") {
      writeFileSync(join(outputDir, "planner-contract-retry.json"), `${JSON.stringify(plannerContractRetryAudit, null, 2)}\n`)
    }
  }

  if (args.writeChapter) {
    if (!args.live) throw new Error("--write requires --live")
    if (!plan) throw new Error("--write requires --live so a plan exists")
    if (args.writerContextMode !== "baseline" && !args.sceneCalls) {
      throw new Error("--writer-context is only supported with --scene-calls")
    }
    if (args.sceneCalls) {
      if (args.writerContextMode !== "baseline") {
        writerContextReport = buildSceneWriterThreadContextReport(packet, plan)
        writeFileSync(join(outputDir, "writer-context.json"), `${JSON.stringify(writerContextReport, null, 2)}\n`)
      }
      chapter = await writeChapterBySceneCalls({
        packet,
        plan,
        model: args.model,
        maxTokens: args.maxTokens,
        writerContextMode: args.writerContextMode,
        writerExpansionMode: args.writerExpansionMode,
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
  writeRunManifest(join(outputDir, RUN_MANIFEST_FILENAME), buildRunManifest({
    generatedAt: packet.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-poc",
    variantId: corpusRecreationVariantLabel(packet.diagnosticConfig),
    command: {
      name: "diagnostics:corpus-recreation-poc",
      argv: process.argv.slice(2),
    },
    model: {
      provider: "deepseek",
      model: args.model,
      thinking: args.thinking,
    },
    inputs: [
      artifactRef(referencePath, "corpus-structure-reference"),
      ...existingArtifactRefs(args.planFromDir
        ? [
          { path: join(resolve(process.cwd(), args.planFromDir), "run-manifest.json"), role: "source-run-manifest" },
          { path: join(resolve(process.cwd(), args.planFromDir), "packet.json"), role: "source-packet" },
          { path: join(resolve(process.cwd(), args.planFromDir), "plan.json"), role: "source-plan" },
          { path: join(resolve(process.cwd(), args.planFromDir), "plan-comparison.json"), role: "source-plan-comparison" },
        ]
        : []),
      ...existingArtifactRefs(args.sequenceContextDirs.flatMap(dir => [
        { path: join(resolve(process.cwd(), dir), "run-manifest.json"), role: "sequence-context-run-manifest" },
        { path: join(resolve(process.cwd(), dir), "packet.json"), role: "sequence-context-packet" },
        { path: join(resolve(process.cwd(), dir), "plan.json"), role: "sequence-context-plan" },
      ])),
    ],
    outputs: existingArtifactRefs([
      { path: join(outputDir, "packet.json"), role: "packet" },
      { path: join(outputDir, "plan.json"), role: "plan" },
      { path: join(outputDir, "plan-comparison.json"), role: "plan-comparison" },
      { path: join(outputDir, "planner-contract-retry.json"), role: "planner-contract-retry-json" },
      { path: join(outputDir, "chapter.json"), role: "chapter-json" },
      { path: join(outputDir, "chapter.md"), role: "chapter-markdown" },
      { path: join(outputDir, "chapter-comparison.json"), role: "chapter-comparison" },
      { path: join(outputDir, "writer-context.json"), role: "writer-context-json" },
      { path: join(outputDir, "report.md"), role: "report" },
    ]),
    discriminator: basename(outputDir),
    metadata: {
      chapterLabel: packet.sourceReference.chapterLabel,
      live: args.live,
      writeChapter: args.writeChapter,
      sceneCalls: args.sceneCalls,
      plannerContractRetryMode: args.plannerContractRetryMode,
      writerContextMode: args.writerContextMode,
      writerExpansionMode: args.writerExpansionMode,
      plannerPromptVersion: PLANNER_PROMPT_VERSION,
      planFromDir: args.planFromDir,
      sequenceContextDirs: args.sequenceContextDirs,
      referencePath: args.referencePath,
    },
  }))
  console.log(`wrote ${join(outputDir, "packet.json")}`)
  console.log(`wrote ${join(outputDir, "report.md")}`)
  console.log(`wrote ${join(outputDir, RUN_MANIFEST_FILENAME)}`)
  if (plan) console.log(`wrote ${join(outputDir, "plan.json")}`)
  if (plannerContractRetryAudit && args.plannerContractRetryMode !== "none") console.log(`wrote ${join(outputDir, "planner-contract-retry.json")}`)
  if (writerContextReport) console.log(`wrote ${join(outputDir, "writer-context.json")}`)
  if (chapter) console.log(`wrote ${join(outputDir, "chapter.md")}`)
}

function plannerVariantRequiresMaterialityTests(variant: PlannerVariant | undefined): boolean {
  return variant === "materiality-v1" || variant === "causal-materiality-v2" || variant === "causal-motivation-v3"
}

function plannerVariantRequiresPovPersonalStake(variant: PlannerVariant | undefined): boolean {
  return variant === "causal-motivation-v3"
}

if (import.meta.main) await main()
