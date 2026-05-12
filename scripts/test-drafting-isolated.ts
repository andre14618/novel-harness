/**
 * Drafting-isolated A/B harness — L097 Slice 2.5 + adjusted-B1/B3 lane.
 *
 * Takes a planning-done source novel id, clones it once per requested
 * writer arm via `scripts/variant/clone-for-variant.ts`, sets per-arm
 * pipelineOverrides via UPDATE on seed_json, runs `runDraftingPhase` on
 * each clone, and prints a per-chapter word-count comparison plus pairwise
 * deltas. The plan never changes between arms — clones inherit the same
 * chapter_outlines.
 *
 * Arms:
 *   baseline           — current production writer (sceneCallWriterV1=false,
 *                        writerExpansionMode="off",
 *                        writerPromptIdRendering="raw")
 *   id-suppress        — adjusted-B1 ablation: same writer as baseline, but
 *                        Cluster-1 raw-ID lines suppressed in the
 *                        prose-writer prompt (writerPromptIdRendering=
 *                        "suppress"). Trace metadata, DB rows, telemetry,
 *                        checker findings, proposals, evals, and audit
 *                        logs are unaffected — the flag is render-only.
 *                        See docs/decisions/L099-writer-prompt-id-rendering.md.
 *   contract-render-only — adjusted-B3 Arm B preparation: render the
 *                        SCENE CONTRACT block whenever the planner has
 *                        populated scene-contract fields, without
 *                        switching to scene-call writer mode. Requires
 *                        the new `forceRenderSceneContractWhenAvailable`
 *                        pipeline override (default-off). When the
 *                        underlying plan has no scene-contract fields
 *                        (the common production case while
 *                        scenePlanContractV1 stays default-off), the
 *                        rendered prompt remains byte-identical to
 *                        baseline.
 *   scene-call-no-expansion — scene-call writer with the same SCENE
 *                        CONTRACT rendering as scene-call-v1, but with
 *                        writerExpansionMode="off". Use this to isolate
 *                        the retry-short-scenes expansion path while
 *                        holding the cloned plan constant.
 *   drafting-brief-v1  — production-path writer drafting brief from L106:
 *                        the writer prompt is rendered as a compact
 *                        scene-budget brief from the same BeatContext slots.
 *                        Scene contract fields are included when present;
 *                        production context surface telemetry is preserved.
 *   drafting-brief-tight-v1 — compact brief plus scene load-control guard
 *                        for advisory evidence loops.
 *   drafting-brief-scene-turn-v1 — compact brief plus scene-turn/materiality
 *                        floor for advisory evidence loops.
 *   drafting-brief-anchored-v1 — scene-turn brief plus fact/continuity
 *                        anchors for advisory evidence loops.
 *   drafting-brief-tight-anchored-v1 — tight load control plus scene-turn
 *                        floor and fact/continuity anchors.
 *   scene-call-v1      — L097 Slice 2: scene-call writer + retry-short-
 *                        scenes-v1 expansion path. The full B3 Arm C.
 *
 * Usage:
 *   bun scripts/test-drafting-isolated.ts \
 *     --source <planning-done-novel-id> \
 *     --target-prefix <prefix>                                   # e.g. "ab-1778378900"
 *     [--writer-arms baseline,id-suppress,contract-render-only,scene-call-no-expansion,drafting-brief-v1,scene-call-v1]
 *                                                                # default: baseline,scene-call-v1
 *     [--writer-only]                                            # set draftCaptureModeV1=true on every arm
 *     [--no-prose-semantic-eval]                                 # opt out of default advisory prose telemetry
 *     [--quality-telemetry-packet]                               # stable advisory prose+scene semantic packet; artifact-only readiness
 *     [--scene-semantic-review]                                  # opt into endpoint/scene replay telemetry
 *     [--scene-semantic-persist]                                 # persist scene-semantic eval rows; imports readiness lows unless disabled
 *     [--no-scene-semantic-readiness-import]                     # keep persisted scene-semantic readiness artifact-only
 *     [--allow-drafted-source]                                   # explicitly allow cloning a source that already has drafts
 *     [--target-word-scale 0.85]                                  # default-off clone-only budget elasticity probe
 *     [--per-arm-timeout-ms 1800000]                             # 30-minute per-arm wallclock cap
 *     [--report-dir output/drafting-isolated/<prefix>]           # override durable run report directory
 *
 * Each arm becomes a clone novel id `<target-prefix>-<arm>`. Arms run
 * sequentially (parallel runs would race on shared DB resources).
 *
 * `--writer-only` (draft-capture mode):
 *   Skips the post-writer chapter-level settle loops (plan-check,
 *   continuity, validation, halluc-ungrounded routing, integrity
 *   reviser, validation reviser, plan-check beat rewrites). Each
 *   chapter's writer output is saved + approved as-is. Use this when
 *   the experiment cares only about the writer's prose-rendering arm
 *   and the checker stack is irrelevant or slow. Per-beat writer
 *   retries inside the writer's own checker budget are unaffected.
 *
 * `--per-arm-timeout-ms`:
 *   Wallclock cap for each arm's drafting. On timeout, the runner
 *   collects partial chapter_drafts that did finish, records the
 *   timeout as the arm's error, and proceeds to the next arm. The
 *   underlying drafting promise is NOT cancelled — postgres.js + LLM
 *   transport have their own timeouts. Subsequent arms run in fresh
 *   clones (different novel-id), so there is no cross-arm DB contention.
 */

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import db from "../src/db/connection"
import { runDraftingPhase } from "../src/phases/drafting"
import { initNovelRun } from "../src/logger"
import { setAutoMode, setResolverMode } from "../src/cli"
import { getMode } from "../src/gates"
import {
  runProseSemanticForNovel,
  type ProseSemanticReport,
} from "./analysis/prose-semantic-report"
import {
  buildSceneSemanticReplayReport,
  persistSceneSemanticReplayReport,
  renderSceneSemanticReplayReport,
  type SceneSemanticReplayReport,
} from "./evals/scene-semantic-review"
import {
  buildSceneSemanticReadinessAggregate,
  renderSceneSemanticReadinessAggregate,
} from "./evals/scene-semantic-readiness"
import {
  buildSceneSemanticComparisonReport,
  renderSceneSemanticComparisonReport,
  type SceneSemanticComparisonReport,
  type SceneSemanticReportRef,
} from "./evals/scene-semantic-compare"
import {
  loadPlanningToDraftingContextReport,
  renderPlanningToDraftingContextReport,
  type PlanningToDraftingContextReport,
} from "./analysis/planning-drafting-context-report"
import {
  buildPlanningContextReadinessAggregate,
  renderPlanningContextReadinessAggregate,
  type PlanningContextReadinessAggregate,
} from "./analysis/planning-context-readiness"
import {
  buildPlanAssistReadinessAggregate,
  loadPlanAssistReadinessInputs,
  renderPlanAssistReadinessAggregate,
  type PlanAssistReadinessAggregate,
} from "./analysis/plan-assist-readiness-report"
import {
  buildCheckerReadinessAggregate,
  loadCheckerReadinessChapterTargets,
  renderCheckerReadinessAggregate,
  type CheckerReadinessAggregate,
} from "./analysis/checker-readiness-report"
import {
  buildCheckerWarningReport,
  loadCheckerWarningInputs,
  renderCheckerWarningReport,
  type CheckerWarningReport,
} from "./analysis/checker-warning-report"
import {
  buildPlannerQualityReadinessAggregate,
  buildPlannerQualityReport,
  renderPlannerQualityReport,
  type PlannerQualityOutlineRow,
  type PlannerQualityReport,
} from "./analysis/planner-quality-report"
import type { Dimension } from "./evals/planner-discernment-calibration"
import {
  assessSourceDraftingIsolation,
  formatSourceDraftingIsolationAssessment,
  loadSourceDraftingIsolationState,
  sourceDraftingIsolationIssue,
  type SourceDraftingIsolationAssessment,
  type SourceDraftingIsolationState,
} from "../src/harness/drafting-source"
import type { ChapterOutline } from "../src/types"

export {
  sourceDraftingIsolationIssue,
  type SourceDraftingIsolationState,
}

export interface Args {
  source: string
  targetPrefix: string
  arms: ArmName[]
  /** When true, every arm runs with `draftCaptureModeV1=true` so the
   *  chapter-level checker settle loops are skipped. Used to make the
   *  writer-arm comparison resistant to checker/API hangs. */
  writerOnly: boolean
  /** Default-on evidence telemetry. Runs advisory prose-semantic diagnostics
   *  over each arm's drafted chapters after drafting/partial collection. This
   *  does not gate the arm; it only writes artifacts and persists judge
   *  telemetry. */
  qualityTelemetryPacket: boolean
  proseSemanticEval: boolean
  proseSemanticDryRun: boolean
  proseSemanticConcurrency: number
  /** Optional production replay semantic telemetry over persisted outlines +
   *  approved/partial drafts. Default-off because it runs one LLM judge call
   *  per scene × dimension. Diagnostic only. */
  sceneSemanticReview: boolean
  sceneSemanticLive: boolean
  sceneSemanticPersist: boolean
  sceneSemanticReadinessImport: boolean
  sceneSemanticConcurrency: number
  sceneSemanticMaxTokens: number
  sceneSemanticDimensions: Dimension[]
  /** Default false. Drafting-isolated evidence should start from a planning-
   *  done source, not a completed draft artifact with generated facts/states.
   *  This escape hatch is for deliberate contamination/replay investigations. */
  allowDraftedSource: boolean
  /** Default-off clone-only budget elasticity probe. A value other than 1
   *  scales chapter outline `targetWords` and any existing per-scene
   *  `targetWords` fields after clone and before drafting. Source plans and
   *  production defaults are unchanged. */
  targetWordScale: number
  /** Optional per-arm wallclock timeout in milliseconds. When the
   *  drafting promise for an arm doesn't resolve in time, the runner
   *  records a timeout result and proceeds to the next arm. The
   *  underlying drafting flow keeps running until its own LLM
   *  transport timeouts fire; subsequent arms run in fresh clones, so
   *  there is no cross-arm DB contention. */
  perArmTimeoutMs: number | null
  reportDir: string | null
}

export const WRITER_ARM_NAMES = [
  "baseline",
  "id-suppress",
  "contract-render-only",
  "scene-call-no-expansion",
  "drafting-brief-v1",
  "drafting-brief-tight-v1",
  "drafting-brief-scene-turn-v1",
  "drafting-brief-anchored-v1",
  "drafting-brief-tight-anchored-v1",
  "scene-call-v1",
] as const

export type ArmName = typeof WRITER_ARM_NAMES[number]

export interface ArmResult {
  arm: ArmName
  novelId: string
  chapters: Array<{ chapter: number; words: number; targetWords: number; ratio: number }>
  totalWords: number
  totalTarget: number
  meanRatio: number
  expansionEvents: number
  draftingBrief: DraftingBriefTelemetrySummary
  targetWordScaling?: TargetWordScalingSummary | null
  planningContext?: PlanningContextTelemetrySummary
  proseSemantic?: {
    outputDir: string
    resultCount: number
    lowRows: number
    errorRows: number
    saturationNotes: string[]
    lengthSignal: string
    qualityRisk: string
    recommendation: string
  }
  sceneSemantic?: SceneSemanticTelemetrySummary
  planAssistReadiness?: PlanAssistReadinessTelemetrySummary
  checkerReadiness?: CheckerReadinessTelemetrySummary
  error?: string
}

export interface DraftingIsolatedDelta {
  arm: ArmName
  baselineArm: ArmName
  meanRatioDelta: number
  expansionEvents: number
  error: string | null
  pocMagnitude: "not_applicable" | "improvement" | "partial" | "insufficient" | "failed"
}

export interface DraftingIsolatedRunReport {
  v: "drafting-isolated-report-v1"
  generatedAt: string
  source: string
  targetPrefix: string
  sourceAssessment: SourceDraftingIsolationAssessment
  options: {
    arms: ArmName[]
    writerOnly: boolean
    qualityTelemetryPacket: boolean
    proseSemanticEval: boolean
    proseSemanticDryRun: boolean
    proseSemanticConcurrency: number
    sceneSemanticReview: boolean
    sceneSemanticLive: boolean
    sceneSemanticPersist: boolean
    sceneSemanticReadinessImport: boolean
    sceneSemanticConcurrency: number
    sceneSemanticMaxTokens: number
    sceneSemanticDimensions: Dimension[]
    allowDraftedSource: boolean
    targetWordScale: number
    perArmTimeoutMs: number | null
  }
  summary: {
    armCount: number
    completedArms: number
    errorArms: number
    cleanSource: boolean
    totalWordsByArm: Record<string, number>
    meanRatioByArm: Record<string, number>
    planningContextGapsByArm: Record<string, number | null>
    planningContextReadinessByArm: Record<string, number | null>
    planAssistReadinessByArm: Record<string, number | null>
    checkerReadinessByArm: Record<string, number | null>
    proseSemanticLowRowsByArm: Record<string, number | null>
    sceneSemanticLowRowsByArm: Record<string, number | null>
  }
  sourcePlannerQuality?: PlannerQualityTelemetrySummary | null
  results: ArmResult[]
  deltas: DraftingIsolatedDelta[]
  sceneSemanticComparison?: DraftingIsolatedSceneSemanticComparisonSummary | null
}

export interface DraftingIsolatedSceneSemanticComparisonSummary {
  outputDir: string
  baselineArm: ArmName
  baselineReport: string
  candidateCount: number
  comparisons: Array<{
    candidateArm: ArmName
    candidateReport: string
    verdict: SceneSemanticComparisonReport["comparisons"][number]["verdict"]
    comparedRows: number
    missingInCandidate: number
    missingInBaseline: number
    dimensions: Array<{
      dimension: Dimension
      meanDelta: number | null
      lowDelta: number
      resolvedLowRows: number
      regressedLowRows: number
      improvedRows: number
      worsenedRows: number
    }>
  }>
}

export interface DraftingBriefTelemetrySummary {
  events: number
  enabledEvents: number
  modes: Record<string, number>
  avgCharsRatio: number | null
  avgSelectedPromptChars: number | null
  avgFullContextPromptChars: number | null
  totalCharsDelta: number
}

export interface TargetWordScalingSummary {
  scale: number
  changedChapters: number
  changedScenes: number
  beforeTotalTargetWords: number
  afterTotalTargetWords: number
  chapters: Array<{
    chapter: number
    beforeTargetWords: number | null
    afterTargetWords: number | null
    changedSceneTargets: number
  }>
}

export interface PlanningContextTelemetrySummary {
  outputDir: string
  surfaceCount: number
  gapCount: number
  readiness?: PlanningContextReadinessTelemetrySummary
  gaps: Array<{
    surface: string
    status: string
    upstreamCount: number
    downstreamCount: number
  }>
  upstream: {
    worldBibleAvailable: boolean
    storySpineAvailable: boolean
    characterCount: number
    chapterPlanCount: number
    plannedSceneCount: number
    scenesWithSceneContract: number
    scenesWithTemporalAnchor: number
    scenesWithPlaceAnchor: number
    sceneContractsWithDramaticShape: number
    sceneContractsWithChoiceShape: number
    sceneContractsWithEndpointShape: number
    sceneContractsWithFullDramaticShape: number
    anchorOnlySceneContracts: number
    scenesWithObligations: number
    scenesWithImplicitReferences: number
  }
  downstream: {
    events: number
    withCharacterContext: number
    withWorldContext: number
    withStoryContext: number
    storyRefIds: number
    withReaderInfoState: number
    readerInfoStateChars: number
    withImplicitReferences: number
    withResolvedReferences: number
    referenceLookups: number
    withSceneContract: number
    withSceneContractShapeCounts: number
    withSceneContractAnchors: number
    withDramaticSceneContract: number
    withAnchorOnlySceneContract: number
    withObligations: number
    withDraftingBriefTrace: number
  }
  error?: string
}

export interface PlanningContextReadinessTelemetrySummary {
  outputDir: string
  groupCount: number
  findingCount: number
  labels: Record<string, number>
}

export interface PlannerQualityTelemetrySummary {
  outputDir: string
  chapters: number
  plannedScenes: number
  endpointIssues: number
  inactiveCharacterFindings: number
  weakStoryTurnEntries: number
  obligationErrorChapters: number
  overloadedObligationChapters: number
  readiness: PlanningContextReadinessTelemetrySummary
  error?: string
}

export interface PlanAssistReadinessTelemetrySummary extends PlanningContextReadinessTelemetrySummary {
  exhaustionRows: number
  pendingRows: number
  error?: string
}

export interface CheckerReadinessTelemetrySummary extends PlanningContextReadinessTelemetrySummary {
  checkerItems: number
  blockerItems: number
  warningItems: number
  negativeItems: number
  positiveItems: number
  ambiguousItems: number
  lowConfidenceItems: number
  error?: string
}

export interface SceneSemanticTelemetrySummary {
  outputDir: string
  taskCount: number
  skipCount: number
  lowRows: number
  errorRows: number
  error?: string
  failureArtifact?: string
  persistence?: SceneSemanticPersistenceTelemetrySummary
  readinessImport?: SceneSemanticReadinessImportTelemetrySummary
  dimensions: Array<{
    dimension: Dimension
    count: number
    meanOrdinal: number
    lowCount: number
    labelCounts: Record<string, number>
  }>
  recommendation: string
}

export interface SceneSemanticPersistenceTelemetrySummary {
  requested: true
  briefRows: number
  resultRows: number
  error?: string
}

export interface SceneSemanticReadinessImportTelemetrySummary {
  requested: true
  inserted: number
  updated: number
  skipped: number
  itemIds: string[]
  error?: string
}

const DEFAULT_SCENE_SEMANTIC_DIMENSIONS: Dimension[] = [
  "endpointLanding",
  "sceneDramaturgy",
  "characterMateriality",
  "worldFactPressure",
]
const DEFAULT_SCENE_SEMANTIC_MAX_TOKENS = 2200
const QUALITY_TELEMETRY_SCENE_SEMANTIC_MAX_TOKENS = 8000

function emptyDraftingBriefTelemetry(): DraftingBriefTelemetrySummary {
  return {
    events: 0,
    enabledEvents: 0,
    modes: {},
    avgCharsRatio: null,
    avgSelectedPromptChars: null,
    avgFullContextPromptChars: null,
    totalCharsDelta: 0,
  }
}

async function ensureSourceExists(
  source: string,
  opts: { allowDraftedSource: boolean },
): Promise<SourceDraftingIsolationAssessment> {
  const state = await loadSourceDraftingIsolationState(source, db)
  if (!state) throw new Error(`Source novel ${source} not found`)
  const assessment = assessSourceDraftingIsolation(state)
  if (assessment.issue && !opts.allowDraftedSource) {
    throw new Error(formatSourceDraftingIsolationAssessment(assessment))
  }
  if (assessment.issue) {
    console.warn(`WARNING: ${formatSourceDraftingIsolationAssessment(assessment)}; proceeding because --allow-drafted-source was set.`)
  }
  return assessment
}

function runCloneSubprocess(source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["scripts/variant/clone-for-variant.ts", "--source", source, "--target", target], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", c => { stdout += c.toString() })
    child.stderr.on("data", c => { stderr += c.toString() })
    child.on("close", code => {
      if (code === 0) {
        if (stdout.trim()) console.log(stdout.trim().split("\n").map(l => `    [clone] ${l}`).join("\n"))
        resolve()
      } else {
        reject(new Error(`clone-for-variant exited ${code}: ${stderr.trim() || stdout.trim()}`))
      }
    })
    child.on("error", err => reject(err))
  })
}

interface ArmFlags {
  sceneCallWriterV1: boolean
  writerExpansionMode: "off" | "retry-short-scenes-v1"
  forceRenderSceneContractWhenAvailable: boolean
  writerPromptIdRendering: "raw" | "suppress"
  writerDraftingBriefMode: "off" | "scene-budget-v1" | "scene-budget-tight-v1" | "scene-turn-v1" | "scene-turn-anchored-v1" | "scene-budget-tight-anchored-v1"
}

export function flagsForArm(arm: ArmName): ArmFlags {
  switch (arm) {
    case "baseline":
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false,
        writerPromptIdRendering: "raw",
        writerDraftingBriefMode: "off",
      }
    case "id-suppress":
      // adjusted-B1 ablation: same writer + plan path as baseline; only the
      // prose-writer prompt's Cluster-1 raw-ID lines are suppressed.
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false,
        writerPromptIdRendering: "suppress",
        writerDraftingBriefMode: "off",
      }
    case "contract-render-only":
      // adjusted-B3 Arm B preparation: render the scene contract block
      // when populated, but keep the beat-shaped writer call unit. No
      // expansion-retry path. ID rendering stays raw so this arm is a
      // pure isolation of "contract rendering effect."
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: true,
        writerPromptIdRendering: "raw",
        writerDraftingBriefMode: "off",
      }
    case "scene-call-no-expansion":
      // Scene-call writer with expansion disabled. This isolates the
      // retry-short-scenes-v1 expansion path from the scene-call writer
      // architecture while keeping the cloned plan fixed.
      return {
        sceneCallWriterV1: true,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false, // implied by sceneCallWriterV1=true
        writerPromptIdRendering: "raw",
        writerDraftingBriefMode: "off",
      }
    case "drafting-brief-v1":
      // L106 production-path integration: render a compact writer-facing
      // drafting brief from the same production BeatContext slots. This
      // isolates prompt shaping from scene-call architecture and expansion.
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false,
        writerPromptIdRendering: "raw",
        writerDraftingBriefMode: "scene-budget-v1",
      }
    case "drafting-brief-tight-v1":
      // Follow-on evidence arm: keep the compact production brief path and
      // add explicit load control, without changing the scene-call writer,
      // expansion retry, or production defaults.
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false,
        writerPromptIdRendering: "raw",
        writerDraftingBriefMode: "scene-budget-tight-v1",
      }
    case "drafting-brief-scene-turn-v1":
      // Follow-on evidence arm: keep the compact brief path but add an
      // explicit scene-turn/materiality floor for the failure mode seen in
      // LitRPG scene-select evidence.
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false,
        writerPromptIdRendering: "raw",
        writerDraftingBriefMode: "scene-turn-v1",
      }
    case "drafting-brief-anchored-v1":
      // Follow-on evidence arm: preserve scene-turn floor and add
      // fact/continuity anchoring to test worldFactPressure regressions.
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false,
        writerPromptIdRendering: "raw",
        writerDraftingBriefMode: "scene-turn-anchored-v1",
      }
    case "drafting-brief-tight-anchored-v1":
      // Follow-on evidence arm: preserve tight load control while adding
      // scene-turn and fact/continuity anchors for endpoint/world regressions.
      return {
        sceneCallWriterV1: false,
        writerExpansionMode: "off",
        forceRenderSceneContractWhenAvailable: false,
        writerPromptIdRendering: "raw",
        writerDraftingBriefMode: "scene-budget-tight-anchored-v1",
      }
    case "scene-call-v1":
      // L097 Slice 2: scene-call writer + expansion-retry. The full B3 Arm C.
      return {
        sceneCallWriterV1: true,
        writerExpansionMode: "retry-short-scenes-v1",
        forceRenderSceneContractWhenAvailable: false, // implied by sceneCallWriterV1=true
        writerPromptIdRendering: "raw",
        writerDraftingBriefMode: "off",
      }
  }
}

async function setWriterFlags(novelId: string, arm: ArmName, opts: { writerOnly: boolean }): Promise<void> {
  const flags = flagsForArm(arm)
  const draftCaptureModeV1 = opts.writerOnly
  await db`
    UPDATE novels
    SET seed_json = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      COALESCE(seed_json, '{}'::jsonb),
                      '{pipelineOverrides}',
                      COALESCE(seed_json->'pipelineOverrides', '{}'::jsonb),
                      true
                    ),
                    '{pipelineOverrides,sceneCallWriterV1}',
                    to_jsonb(${flags.sceneCallWriterV1}::boolean),
                    true
                  ),
                  '{pipelineOverrides,writerExpansionMode}',
                  to_jsonb(${flags.writerExpansionMode}::text),
                  true
                ),
                '{pipelineOverrides,forceRenderSceneContractWhenAvailable}',
                to_jsonb(${flags.forceRenderSceneContractWhenAvailable}::boolean),
                true
              ),
              '{pipelineOverrides,writerPromptIdRendering}',
              to_jsonb(${flags.writerPromptIdRendering}::text),
              true
            ),
            '{pipelineOverrides,writerDraftingBriefMode}',
            to_jsonb(${flags.writerDraftingBriefMode}::text),
            true
          ),
          '{pipelineOverrides,draftCaptureModeV1}',
          to_jsonb(${draftCaptureModeV1}::boolean),
          true
        ),
        updated_at = now()
    WHERE id = ${novelId}
  `
}

function scaledTargetWords(value: unknown, scale: number, minimum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  if (value < minimum) return value
  return Math.max(minimum, Math.round(value * scale))
}

export function scaleOutlineTargetWords(
  outline: ChapterOutline,
  scale: number,
): { outline: ChapterOutline; summary: TargetWordScalingSummary["chapters"][number] } {
  const scaled = JSON.parse(JSON.stringify(outline)) as ChapterOutline
  const beforeTargetWords = scaledTargetWords(outline.targetWords, 1, 1)
  const afterTargetWords = scaledTargetWords(outline.targetWords, scale, 1)
  if (afterTargetWords !== null) scaled.targetWords = afterTargetWords

  let changedSceneTargets = 0
  if (Array.isArray(scaled.scenes)) {
    scaled.scenes = scaled.scenes.map((scene, index) => {
      const original = outline.scenes?.[index]
      const before = scaledTargetWords(original?.targetWords, 1, 0)
      const after = scaledTargetWords(original?.targetWords, scale, 0)
      if (after === null || after === before) return scene
      changedSceneTargets++
      return { ...scene, targetWords: after }
    })
  }

  return {
    outline: scaled,
    summary: {
      chapter: scaled.chapterNumber,
      beforeTargetWords,
      afterTargetWords,
      changedSceneTargets,
    },
  }
}

async function applyTargetWordScale(novelId: string, scale: number): Promise<TargetWordScalingSummary | null> {
  if (scale === 1) return null
  const rows = await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  ` as Array<{ chapter_number: number; outline_json: ChapterOutline }>

  const chapters: TargetWordScalingSummary["chapters"] = []
  let beforeTotalTargetWords = 0
  let afterTotalTargetWords = 0
  let changedChapters = 0
  let changedScenes = 0

  for (const row of rows) {
    const { outline, summary } = scaleOutlineTargetWords(row.outline_json, scale)
    chapters.push(summary)
    beforeTotalTargetWords += summary.beforeTargetWords ?? 0
    afterTotalTargetWords += summary.afterTargetWords ?? 0
    if (summary.beforeTargetWords !== summary.afterTargetWords) changedChapters++
    changedScenes += summary.changedSceneTargets
    await db`
      UPDATE chapter_outlines
      SET outline_json = ${outline}
      WHERE novel_id = ${novelId}
        AND chapter_number = ${row.chapter_number}
    `
  }

  return {
    scale,
    changedChapters,
    changedScenes,
    beforeTotalTargetWords,
    afterTotalTargetWords,
    chapters,
  }
}

async function collectArmResult(arm: ArmName, novelId: string): Promise<Pick<ArmResult, "chapters" | "totalWords" | "totalTarget" | "meanRatio" | "expansionEvents" | "draftingBrief">> {
  const chapterRows = await db`
    SELECT cd.chapter_number, cd.word_count, cd.version,
           (co.outline_json->>'targetWords')::int AS target_words
    FROM chapter_drafts cd
    JOIN chapter_outlines co ON co.novel_id = cd.novel_id AND co.chapter_number = cd.chapter_number
    WHERE cd.novel_id = ${novelId}
    ORDER BY cd.chapter_number ASC, cd.version DESC
  ` as Array<{ chapter_number: number; word_count: number; version: number; target_words: number }>

  const seenChapters = new Set<number>()
  const chapters: ArmResult["chapters"] = []
  for (const r of chapterRows) {
    if (seenChapters.has(r.chapter_number)) continue
    seenChapters.add(r.chapter_number)
    const target = r.target_words ?? 0
    chapters.push({
      chapter: r.chapter_number,
      words: r.word_count ?? 0,
      targetWords: target,
      ratio: target > 0 ? (r.word_count ?? 0) / target : 0,
    })
  }
  chapters.sort((a, b) => a.chapter - b.chapter)

  const totalWords = chapters.reduce((s, c) => s + c.words, 0)
  const totalTarget = chapters.reduce((s, c) => s + c.targetWords, 0)
  const meanRatio = chapters.length > 0
    ? chapters.reduce((s, c) => s + c.ratio, 0) / chapters.length
    : 0

  const expansionRows = await db`
    SELECT count(*)::int AS n FROM pipeline_events
    WHERE novel_id = ${novelId} AND event_type = 'writer-expansion'
  ` as Array<{ n: number }>
  const expansionEvents = expansionRows[0]?.n ?? 0

  const draftingBriefRows = await db`
    SELECT payload FROM pipeline_events
    WHERE novel_id = ${novelId} AND event_type = 'writer-context'
  ` as Array<{ payload: unknown }>
  const draftingBrief = summarizeDraftingBriefTelemetry(draftingBriefRows.map(row => row.payload))

  return { chapters, totalWords, totalTarget, meanRatio, expansionEvents, draftingBrief }
}

export function summarizeDraftingBriefTelemetry(payloads: unknown[]): DraftingBriefTelemetrySummary {
  const rows = payloads
    .map(payload => readDraftingBriefTelemetry(payload))
    .filter((row): row is NonNullable<ReturnType<typeof readDraftingBriefTelemetry>> => Boolean(row))
  if (rows.length === 0) return emptyDraftingBriefTelemetry()

  const modes: Record<string, number> = {}
  let selectedTotal = 0
  let fullTotal = 0
  let ratioTotal = 0
  let ratioCount = 0
  let totalCharsDelta = 0
  let enabledEvents = 0
  for (const row of rows) {
    modes[row.mode] = (modes[row.mode] ?? 0) + 1
    selectedTotal += row.selectedPromptChars
    fullTotal += row.fullContextPromptChars
    totalCharsDelta += row.charsDelta
    if (row.mode !== "off") enabledEvents++
    if (Number.isFinite(row.charsRatio)) {
      ratioTotal += row.charsRatio
      ratioCount++
    }
  }

  return {
    events: rows.length,
    enabledEvents,
    modes,
    avgCharsRatio: ratioCount > 0 ? ratioTotal / ratioCount : null,
    avgSelectedPromptChars: selectedTotal / rows.length,
    avgFullContextPromptChars: fullTotal / rows.length,
    totalCharsDelta,
  }
}

function readDraftingBriefTelemetry(payload: unknown): {
  mode: string
  selectedPromptChars: number
  fullContextPromptChars: number
  charsRatio: number
  charsDelta: number
} | null {
  if (!payload || typeof payload !== "object") return null
  const draftingBrief = (payload as { draftingBrief?: unknown }).draftingBrief
  if (!draftingBrief || typeof draftingBrief !== "object") return null
  const row = draftingBrief as Record<string, unknown>
  const mode = typeof row.mode === "string" ? row.mode : null
  const selectedPromptChars = readFiniteNumber(row.selectedPromptChars)
  const fullContextPromptChars = readFiniteNumber(row.fullContextPromptChars)
  const charsRatio = readFiniteNumber(row.charsRatio)
  const charsDelta = readFiniteNumber(row.charsDelta)
  if (!mode || selectedPromptChars === null || fullContextPromptChars === null || charsRatio === null || charsDelta === null) return null
  return { mode, selectedPromptChars, fullContextPromptChars, charsRatio, charsDelta }
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

interface RunArmOptions {
  writerOnly: boolean
  proseSemanticEval: boolean
  proseSemanticDryRun: boolean
  proseSemanticConcurrency: number
  sceneSemanticReview: boolean
  sceneSemanticLive: boolean
  sceneSemanticPersist: boolean
  sceneSemanticReadinessImport: boolean
  sceneSemanticConcurrency: number
  sceneSemanticMaxTokens: number
  sceneSemanticDimensions: Dimension[]
  targetWordScale: number
  perArmTimeoutMs: number | null
}

/** Race a promise against a wallclock timeout. The dangling promise is
 *  NOT cancelled — postgres.js + LLM transport have their own timeouts.
 *  This races so that one arm's hang doesn't block the next arm's run. */
async function withArmTimeout<T>(p: Promise<T>, timeoutMs: number, armLabel: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`arm "${armLabel}" timed out after ${timeoutMs}ms (drafting promise still running in the background; subsequent arms will use fresh clones)`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([p, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runArm(arm: ArmName, source: string, targetPrefix: string, opts: RunArmOptions): Promise<ArmResult> {
  const novelId = `${targetPrefix}-${arm}`
  console.log(`\n━━━ arm: ${arm} ━━━`)
  console.log(`  cloning ${source} → ${novelId}`)
  try {
    await runCloneSubprocess(source, novelId)
  } catch (err) {
    const planAssistReadiness = await maybeRunPlanAssistReadinessAudit(arm, novelId, targetPrefix)
    const checkerReadiness = await maybeRunCheckerReadinessAudit(arm, novelId, targetPrefix)
    return {
      arm, novelId, chapters: [], totalWords: 0, totalTarget: 0, meanRatio: 0,
      draftingBrief: emptyDraftingBriefTelemetry(),
      planningContext: await maybeRunPlanningContextAudit(arm, novelId, targetPrefix),
      planAssistReadiness,
      checkerReadiness,
      expansionEvents: 0, error: `clone failed: ${err instanceof Error ? err.message : err}`,
    }
  }

  let targetWordScaling: TargetWordScalingSummary | null = null
  if (opts.targetWordScale !== 1) {
    targetWordScaling = await applyTargetWordScale(novelId, opts.targetWordScale)
    if (targetWordScaling) {
      console.log(
        `  target word scale: ${opts.targetWordScale} ` +
          `(${targetWordScaling.beforeTotalTargetWords} → ${targetWordScaling.afterTotalTargetWords}; ` +
          `chapters=${targetWordScaling.changedChapters}, scenes=${targetWordScaling.changedScenes})`,
      )
    }
  }

  const flags = flagsForArm(arm)
  console.log(`  setting writer flags: sceneCallWriterV1=${flags.sceneCallWriterV1}, writerExpansionMode=${flags.writerExpansionMode}, forceRenderSceneContractWhenAvailable=${flags.forceRenderSceneContractWhenAvailable}, writerPromptIdRendering=${flags.writerPromptIdRendering}, writerDraftingBriefMode=${flags.writerDraftingBriefMode}, draftCaptureModeV1=${opts.writerOnly}`)
  await setWriterFlags(novelId, arm, { writerOnly: opts.writerOnly })

  await initNovelRun(novelId)
  console.log(`  drafting ...`)
  try {
    const draftingPromise = runDraftingPhase(novelId)
    const result = opts.perArmTimeoutMs != null
      ? await withArmTimeout(draftingPromise, opts.perArmTimeoutMs, arm)
      : await draftingPromise
    if (result.kind !== "complete") {
      // collect partial results — drafting may have produced some chapters
      // before pausing on a gate. The collector reads chapter_drafts so
      // partial output is captured.
      const collected = await collectArmResult(arm, novelId)
      const planningContext = await maybeRunPlanningContextAudit(arm, novelId, targetPrefix)
      const planAssistReadiness = await maybeRunPlanAssistReadinessAudit(arm, novelId, targetPrefix)
      const checkerReadiness = await maybeRunCheckerReadinessAudit(arm, novelId, targetPrefix)
      const proseSemantic = await maybeRunProseSemanticEval(arm, novelId, targetPrefix, opts)
      const sceneSemantic = await maybeRunSceneSemanticReview(arm, novelId, targetPrefix, opts)
      return {
        arm, novelId, ...collected,
        targetWordScaling,
        planningContext,
        planAssistReadiness,
        checkerReadiness,
        ...(proseSemantic ? { proseSemantic } : {}),
        ...(sceneSemantic ? { sceneSemantic } : {}),
        error: `drafting did not complete: ${result.kind}`,
      }
    }
  } catch (err) {
    // Always attempt to collect partial output even on timeout/error so
    // the operator gets evidence from chapters that did finish.
    const collected = await collectArmResult(arm, novelId).catch(() => ({
      chapters: [] as ArmResult["chapters"], totalWords: 0, totalTarget: 0, meanRatio: 0, expansionEvents: 0,
      draftingBrief: emptyDraftingBriefTelemetry(),
    }))
    const planningContext = await maybeRunPlanningContextAudit(arm, novelId, targetPrefix).catch(err => ({
      outputDir: `output/planning-drafting-context/${targetPrefix}/${arm}`,
      surfaceCount: 0,
      gapCount: 0,
      gaps: [],
      upstream: {
        worldBibleAvailable: false,
        storySpineAvailable: false,
        characterCount: 0,
        chapterPlanCount: 0,
        plannedSceneCount: 0,
        scenesWithSceneContract: 0,
        scenesWithTemporalAnchor: 0,
        scenesWithPlaceAnchor: 0,
        sceneContractsWithDramaticShape: 0,
        sceneContractsWithChoiceShape: 0,
        sceneContractsWithEndpointShape: 0,
        sceneContractsWithFullDramaticShape: 0,
        anchorOnlySceneContracts: 0,
        scenesWithObligations: 0,
        scenesWithImplicitReferences: 0,
      },
      downstream: {
        events: 0,
        withCharacterContext: 0,
        withWorldContext: 0,
        withStoryContext: 0,
        storyRefIds: 0,
        withReaderInfoState: 0,
        readerInfoStateChars: 0,
        withImplicitReferences: 0,
        withResolvedReferences: 0,
        referenceLookups: 0,
        withSceneContract: 0,
        withSceneContractShapeCounts: 0,
        withSceneContractAnchors: 0,
        withDramaticSceneContract: 0,
        withAnchorOnlySceneContract: 0,
        withObligations: 0,
        withDraftingBriefTrace: 0,
      },
      error: `planning context audit failed: ${err instanceof Error ? err.message : String(err)}`,
    }))
    const planAssistReadiness = await maybeRunPlanAssistReadinessAudit(arm, novelId, targetPrefix).catch(paErr => ({
      outputDir: `output/plan-assist-readiness/${targetPrefix}/${arm}`,
      groupCount: 0,
      findingCount: 0,
      labels: {},
      exhaustionRows: 0,
      pendingRows: 0,
      error: `plan-assist readiness audit failed: ${paErr instanceof Error ? paErr.message : String(paErr)}`,
    }))
    const checkerReadiness = await maybeRunCheckerReadinessAudit(arm, novelId, targetPrefix).catch(checkerErr => ({
      outputDir: `output/checker-readiness/${targetPrefix}/${arm}`,
      groupCount: 0,
      findingCount: 0,
      labels: {},
      checkerItems: 0,
      blockerItems: 0,
      warningItems: 0,
      negativeItems: 0,
      positiveItems: 0,
      ambiguousItems: 0,
      lowConfidenceItems: 0,
      error: `checker readiness audit failed: ${checkerErr instanceof Error ? checkerErr.message : String(checkerErr)}`,
    }))
    const proseSemantic = await maybeRunProseSemanticEval(arm, novelId, targetPrefix, opts).catch(proseErr => ({
      outputDir: "",
      resultCount: 0,
      lowRows: 0,
      errorRows: 1,
      saturationNotes: [],
      recommendation: `prose semantic eval failed: ${proseErr instanceof Error ? proseErr.message : String(proseErr)}`,
    }))
    const sceneSemantic = await maybeRunSceneSemanticReview(arm, novelId, targetPrefix, opts)
    return {
      arm, novelId, ...collected,
      planningContext,
      planAssistReadiness,
      checkerReadiness,
      targetWordScaling,
      ...(proseSemantic ? { proseSemantic } : {}),
      ...(sceneSemantic ? { sceneSemantic } : {}),
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const collected = await collectArmResult(arm, novelId)
  const planningContext = await maybeRunPlanningContextAudit(arm, novelId, targetPrefix)
  const planAssistReadiness = await maybeRunPlanAssistReadinessAudit(arm, novelId, targetPrefix)
  const checkerReadiness = await maybeRunCheckerReadinessAudit(arm, novelId, targetPrefix)
  const proseSemantic = await maybeRunProseSemanticEval(arm, novelId, targetPrefix, opts)
  const sceneSemantic = await maybeRunSceneSemanticReview(arm, novelId, targetPrefix, opts)
  return {
    arm,
    novelId,
    ...collected,
    targetWordScaling,
    planningContext,
    planAssistReadiness,
    checkerReadiness,
    ...(proseSemantic ? { proseSemantic } : {}),
    ...(sceneSemantic ? { sceneSemantic } : {}),
  }
}

async function maybeRunSourcePlannerQualityAudit(
  novelId: string,
  targetPrefix: string,
): Promise<PlannerQualityTelemetrySummary> {
  const outputDir = `output/planner-quality/${targetPrefix}/source`
  console.log(`source planner quality audit ...`)
  try {
    const report = buildPlannerQualityReport(await loadPlannerQualityRows(novelId), novelId)
    const readiness = writePlannerQualityArtifacts(report, outputDir)
    return plannerQualitySummary(report, outputDir, readiness)
  } catch (err) {
    return {
      outputDir,
      chapters: 0,
      plannedScenes: 0,
      endpointIssues: 0,
      inactiveCharacterFindings: 0,
      weakStoryTurnEntries: 0,
      obligationErrorChapters: 0,
      overloadedObligationChapters: 0,
      readiness: {
        outputDir,
        groupCount: 0,
        findingCount: 0,
        labels: {},
      },
      error: `planner quality audit failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function loadPlannerQualityRows(novelId: string): Promise<PlannerQualityOutlineRow[]> {
  return await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  ` as PlannerQualityOutlineRow[]
}

export function writePlannerQualityArtifacts(
  report: PlannerQualityReport,
  outputDir: string,
): PlanningContextReadinessTelemetrySummary {
  mkdirSync(outputDir, { recursive: true })
  const reportPath = join(outputDir, "planner-quality-report.json")
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outputDir, "planner-quality-report.md"), renderPlannerQualityReport(report))
  const readiness = buildPlannerQualityReadinessAggregate(report, reportPath)
  writeFileSync(join(outputDir, "planner-quality-readiness.json"), `${JSON.stringify(readiness, null, 2)}\n`)
  writeFileSync(join(outputDir, "planner-quality-readiness.md"), renderPlannerQualityReadinessSidecar(readiness))
  return plannerQualityReadinessSummary(readiness, outputDir)
}

function plannerQualitySummary(
  report: PlannerQualityReport,
  outputDir: string,
  readiness: PlanningContextReadinessTelemetrySummary,
): PlannerQualityTelemetrySummary {
  return {
    outputDir,
    chapters: report.totals.chapters,
    plannedScenes: report.totals.plannedScenes,
    endpointIssues: report.totals.endpointIssues,
    inactiveCharacterFindings: report.totals.inactiveCharacterFindings,
    weakStoryTurnEntries: report.totals.weakStoryTurnEntries,
    obligationErrorChapters: report.totals.obligationErrorChapters,
    overloadedObligationChapters: report.totals.overloadedObligationChapters,
    readiness,
  }
}

function plannerQualityReadinessSummary(
  aggregate: ReturnType<typeof buildPlannerQualityReadinessAggregate>,
  outputDir: string,
): PlanningContextReadinessTelemetrySummary {
  const groups = plannerQualityReadinessGroups(aggregate)
  const labels = new Map<string, number>()
  let findingCount = 0
  for (const group of groups) {
    const findings = Array.isArray(group.findings) ? group.findings : []
    findingCount += findings.length
    for (const finding of findings) {
      const label = typeof finding.label === "string" ? finding.label : ""
      if (label) labels.set(label, (labels.get(label) ?? 0) + 1)
    }
  }
  return {
    outputDir,
    groupCount: groups.length,
    findingCount,
    labels: Object.fromEntries(labels.entries()),
  }
}

function renderPlannerQualityReadinessSidecar(
  aggregate: ReturnType<typeof buildPlannerQualityReadinessAggregate>,
): string {
  const groups = plannerQualityReadinessGroups(aggregate)
  const lines: string[] = []
  lines.push("# Planner Quality Readiness Candidates")
  lines.push("")
  lines.push(`Groups: ${groups.length}`)
  lines.push("")
  lines.push("These are advisory source-plan candidates. They do not auto-mutate the plan.")
  lines.push("")
  for (const group of groups) {
    const finding = Array.isArray(group.findings) ? asRecord(group.findings[0]) : null
    const label = typeof finding?.label === "string" ? finding.label : "UNKNOWN"
    const dimension = typeof finding?.dimension === "string" ? finding.dimension : "unknown"
    const rewritePacket = asRecord(group.rewritePacket)
    const proposalCandidate = asRecord(rewritePacket?.proposalCandidate)
    const target = asRecord(proposalCandidate?.target)
    const targetText = target
      ? `${String(target.kind ?? "unknown")}:${String(target.ref ?? "unknown")}:${String(target.fieldPath ?? "unknown")}`
      : "unknown"
    lines.push(`## ${String(group.groupId ?? "planner-quality")} ${label}`)
    lines.push("")
    lines.push(`Target: ${targetText}`)
    lines.push(`Dimension: ${dimension}`)
    if (typeof finding?.missingForNextLevel === "string") {
      lines.push(`Missing: ${finding.missingForNextLevel}`)
    }
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function plannerQualityReadinessGroups(
  aggregate: ReturnType<typeof buildPlannerQualityReadinessAggregate>,
): Array<Record<string, unknown>> {
  const groups = (aggregate as { groups?: unknown }).groups
  return Array.isArray(groups)
    ? groups.filter((group): group is Record<string, unknown> => Boolean(group) && typeof group === "object" && !Array.isArray(group))
    : []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

async function maybeRunPlanningContextAudit(
  arm: ArmName,
  novelId: string,
  targetPrefix: string,
): Promise<PlanningContextTelemetrySummary> {
  const outputDir = `output/planning-drafting-context/${targetPrefix}/${arm}`
  console.log(`  planning-to-drafting context audit ...`)
  try {
    const report = await loadPlanningToDraftingContextReport(novelId)
    const readiness = writePlanningContextArtifacts(report, outputDir)
    return planningContextSummary(report, outputDir, readiness)
  } catch (err) {
    return {
      outputDir,
      surfaceCount: 0,
      gapCount: 0,
      gaps: [],
      upstream: {
        worldBibleAvailable: false,
        storySpineAvailable: false,
        characterCount: 0,
        chapterPlanCount: 0,
        plannedSceneCount: 0,
        scenesWithSceneContract: 0,
        scenesWithTemporalAnchor: 0,
        scenesWithPlaceAnchor: 0,
        sceneContractsWithDramaticShape: 0,
        sceneContractsWithChoiceShape: 0,
        sceneContractsWithEndpointShape: 0,
        sceneContractsWithFullDramaticShape: 0,
        anchorOnlySceneContracts: 0,
        scenesWithObligations: 0,
        scenesWithImplicitReferences: 0,
      },
      downstream: {
        events: 0,
        withCharacterContext: 0,
        withWorldContext: 0,
        withStoryContext: 0,
        storyRefIds: 0,
        withReaderInfoState: 0,
        readerInfoStateChars: 0,
        withImplicitReferences: 0,
        withResolvedReferences: 0,
        referenceLookups: 0,
        withSceneContract: 0,
        withSceneContractShapeCounts: 0,
        withSceneContractAnchors: 0,
        withDramaticSceneContract: 0,
        withAnchorOnlySceneContract: 0,
        withObligations: 0,
        withDraftingBriefTrace: 0,
      },
      error: `planning context audit failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export function writePlanningContextArtifacts(
  report: PlanningToDraftingContextReport,
  outputDir: string,
): PlanningContextReadinessTelemetrySummary {
  mkdirSync(outputDir, { recursive: true })
  const reportPath = join(outputDir, "planning-drafting-context-report.json")
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outputDir, "planning-drafting-context-report.md"), renderPlanningToDraftingContextReport(report))
  const readiness = buildPlanningContextReadinessAggregate({
    report,
    sourceReport: reportPath,
  })
  writeFileSync(join(outputDir, "planning-context-readiness.json"), `${JSON.stringify(readiness, null, 2)}\n`)
  writeFileSync(join(outputDir, "planning-context-readiness.md"), renderPlanningContextReadinessAggregate(readiness))
  return planningContextReadinessSummary(readiness, outputDir)
}

function planningContextSummary(
  report: PlanningToDraftingContextReport,
  outputDir: string,
  readiness: PlanningContextReadinessTelemetrySummary,
): PlanningContextTelemetrySummary {
  return {
    outputDir,
    surfaceCount: report.surfaces.length,
    gapCount: report.gaps.length,
    readiness,
    gaps: report.gaps.map(row => ({
      surface: row.surface,
      status: row.status,
      upstreamCount: row.upstreamCount,
      downstreamCount: row.downstreamCount,
    })),
    upstream: {
      worldBibleAvailable: report.upstream.worldBibleAvailable,
      storySpineAvailable: report.upstream.storySpineAvailable,
      characterCount: report.upstream.characterCount,
      chapterPlanCount: report.upstream.chapterPlanCount,
      plannedSceneCount: report.upstream.plannedSceneCount,
      scenesWithSceneContract: report.upstream.scenesWithSceneContract,
      scenesWithTemporalAnchor: report.upstream.scenesWithTemporalAnchor,
      scenesWithPlaceAnchor: report.upstream.scenesWithPlaceAnchor,
      sceneContractsWithDramaticShape: report.upstream.sceneContractsWithDramaticShape,
      sceneContractsWithChoiceShape: report.upstream.sceneContractsWithChoiceShape,
      sceneContractsWithEndpointShape: report.upstream.sceneContractsWithEndpointShape,
      sceneContractsWithFullDramaticShape: report.upstream.sceneContractsWithFullDramaticShape,
      anchorOnlySceneContracts: report.upstream.anchorOnlySceneContracts,
      scenesWithObligations: report.upstream.scenesWithObligations,
      scenesWithImplicitReferences: report.upstream.scenesWithImplicitReferences,
    },
    downstream: {
      events: report.downstream.events,
      withCharacterContext: report.downstream.withCharacterContext,
      withWorldContext: report.downstream.withWorldContext,
      withStoryContext: report.downstream.withStoryContext,
      storyRefIds: report.downstream.storyRefIds,
      withReaderInfoState: report.downstream.withReaderInfoState,
      readerInfoStateChars: report.downstream.readerInfoStateChars,
      withImplicitReferences: report.downstream.withImplicitReferences,
      withResolvedReferences: report.downstream.withResolvedReferences,
      referenceLookups: report.downstream.referenceLookups,
      withSceneContract: report.downstream.withSceneContract,
      withSceneContractShapeCounts: report.downstream.withSceneContractShapeCounts,
      withSceneContractAnchors: report.downstream.withSceneContractAnchors,
      withDramaticSceneContract: report.downstream.withDramaticSceneContract,
      withAnchorOnlySceneContract: report.downstream.withAnchorOnlySceneContract,
      withObligations: report.downstream.withObligations,
      withDraftingBriefTrace: report.downstream.withDraftingBriefTrace,
    },
  }
}

function planningContextReadinessSummary(
  aggregate: PlanningContextReadinessAggregate,
  outputDir: string,
): PlanningContextReadinessTelemetrySummary {
  const labels = new Map<string, number>()
  for (const group of aggregate.groups) {
    for (const finding of group.findings) labels.set(finding.label, (labels.get(finding.label) ?? 0) + 1)
  }
  return {
    outputDir,
    groupCount: aggregate.groupCount,
    findingCount: aggregate.findingCount,
    labels: Object.fromEntries(labels.entries()),
  }
}

async function maybeRunPlanAssistReadinessAudit(
  arm: ArmName,
  novelId: string,
  targetPrefix: string,
): Promise<PlanAssistReadinessTelemetrySummary> {
  const outputDir = `output/plan-assist-readiness/${targetPrefix}/${arm}`
  console.log(`  plan-assist readiness audit ...`)
  try {
    const inputs = await loadPlanAssistReadinessInputs(novelId)
    const aggregate = buildPlanAssistReadinessAggregate({
      novelId,
      exhaustions: inputs.exhaustions,
      chapterTargets: inputs.chapterTargets,
    })
    return writePlanAssistReadinessArtifacts(aggregate, outputDir)
  } catch (err) {
    return {
      outputDir,
      groupCount: 0,
      findingCount: 0,
      labels: {},
      exhaustionRows: 0,
      pendingRows: 0,
      error: `plan-assist readiness audit failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export function writePlanAssistReadinessArtifacts(
  aggregate: PlanAssistReadinessAggregate,
  outputDir: string,
): PlanAssistReadinessTelemetrySummary {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "plan-assist-readiness.json"), `${JSON.stringify(aggregate, null, 2)}\n`)
  writeFileSync(join(outputDir, "plan-assist-readiness.md"), renderPlanAssistReadinessAggregate(aggregate))
  return planAssistReadinessSummary(aggregate, outputDir)
}

function planAssistReadinessSummary(
  aggregate: PlanAssistReadinessAggregate,
  outputDir: string,
): PlanAssistReadinessTelemetrySummary {
  const labels = new Map<string, number>()
  for (const group of aggregate.groups) {
    for (const finding of group.findings) {
      labels.set(finding.label, (labels.get(finding.label) ?? 0) + 1)
    }
  }
  return {
    outputDir,
    groupCount: aggregate.groupCount,
    findingCount: aggregate.findingCount,
    labels: Object.fromEntries([...labels.entries()].sort(([a], [b]) => a.localeCompare(b))),
    exhaustionRows: aggregate.exhaustionRows,
    pendingRows: aggregate.pendingRows,
  }
}

async function maybeRunCheckerReadinessAudit(
  arm: ArmName,
  novelId: string,
  targetPrefix: string,
): Promise<CheckerReadinessTelemetrySummary> {
  const outputDir = `output/checker-readiness/${targetPrefix}/${arm}`
  console.log(`  checker readiness audit ...`)
  try {
    const warningReport = buildCheckerWarningReport(await loadCheckerWarningInputs(novelId), novelId)
    const aggregate = buildCheckerReadinessAggregate({
      report: warningReport,
      chapterTargets: await loadCheckerReadinessChapterTargets(novelId),
      includeWarnings: false,
    })
    return writeCheckerReadinessArtifacts(warningReport, aggregate, outputDir)
  } catch (err) {
    return {
      outputDir,
      groupCount: 0,
      findingCount: 0,
      labels: {},
      checkerItems: 0,
      blockerItems: 0,
      warningItems: 0,
      negativeItems: 0,
      positiveItems: 0,
      ambiguousItems: 0,
      lowConfidenceItems: 0,
      error: `checker readiness audit failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export function writeCheckerReadinessArtifacts(
  warningReport: CheckerWarningReport,
  aggregate: CheckerReadinessAggregate,
  outputDir: string,
): CheckerReadinessTelemetrySummary {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "checker-warning-report.json"), `${JSON.stringify(warningReport, null, 2)}\n`)
  writeFileSync(join(outputDir, "checker-warning-report.md"), renderCheckerWarningReport(warningReport))
  writeFileSync(join(outputDir, "checker-readiness.json"), `${JSON.stringify(aggregate, null, 2)}\n`)
  writeFileSync(join(outputDir, "checker-readiness.md"), renderCheckerReadinessAggregate(aggregate))
  return checkerReadinessSummary(warningReport, aggregate, outputDir)
}

function checkerReadinessSummary(
  warningReport: CheckerWarningReport,
  aggregate: CheckerReadinessAggregate,
  outputDir: string,
): CheckerReadinessTelemetrySummary {
  const labels = new Map<string, number>()
  for (const group of aggregate.groups) {
    for (const finding of group.findings) {
      labels.set(finding.label, (labels.get(finding.label) ?? 0) + 1)
    }
  }
  return {
    outputDir,
    groupCount: aggregate.groupCount,
    findingCount: aggregate.findingCount,
    labels: Object.fromEntries([...labels.entries()].sort(([a], [b]) => a.localeCompare(b))),
    checkerItems: warningReport.totalItems,
    blockerItems: warningReport.bySeverity.blocker ?? 0,
    warningItems: warningReport.bySeverity.warning ?? 0,
    negativeItems: warningReport.byPolarity.negative ?? 0,
    positiveItems: warningReport.byPolarity.positive ?? 0,
    ambiguousItems: warningReport.byPolarity.ambiguous ?? 0,
    lowConfidenceItems: warningReport.byCalibration["low-confidence"] ?? 0,
  }
}

async function maybeRunProseSemanticEval(
  arm: ArmName,
  novelId: string,
  targetPrefix: string,
  opts: RunArmOptions,
): Promise<ArmResult["proseSemantic"] | null> {
  if (!opts.proseSemanticEval) return null
  console.log(`  prose semantic eval ...${opts.proseSemanticDryRun ? " (dry-run)" : ""}`)
  const outputDir = `output/prose-semantic-eval/${targetPrefix}/${arm}`
  try {
    const result = await runProseSemanticForNovel({
      novelId,
      dryRun: opts.proseSemanticDryRun,
      concurrency: opts.proseSemanticConcurrency,
      outputDir,
      initRun: false,
      traceSummary: !opts.proseSemanticDryRun,
    })
    return proseSemanticSummary(result.report, result.outputDir)
  } catch (err) {
    return {
      outputDir,
      resultCount: 0,
      lowRows: 0,
      errorRows: 1,
      saturationNotes: [],
      lengthSignal: "incomplete",
      qualityRisk: "incomplete",
      recommendation: `prose semantic eval failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function proseSemanticSummary(report: ProseSemanticReport, outputDir: string): NonNullable<ArmResult["proseSemantic"]> {
  return {
    outputDir,
    resultCount: report.resultCount,
    lowRows: report.results.filter(row => !row.error && row.ordinal <= 1).length,
    errorRows: report.results.filter(row => row.error).length,
    saturationNotes: report.saturationNotes,
    lengthSignal: report.telemetry.harnessGuidance.lengthSignal,
    qualityRisk: report.telemetry.harnessGuidance.qualityRisk,
    recommendation: report.advisoryRecommendation,
  }
}

async function maybeRunSceneSemanticReview(
  arm: ArmName,
  novelId: string,
  targetPrefix: string,
  opts: RunArmOptions,
): Promise<SceneSemanticTelemetrySummary | null> {
  if (!opts.sceneSemanticReview) return null
  const outputDir = `output/scene-semantic-review/${targetPrefix}/${arm}`
  console.log(`  scene semantic replay ...${opts.sceneSemanticLive ? "" : " (dry-run)"}`)
  try {
    const report = await buildSceneSemanticReplayReport({
      novelId,
      chapters: null,
      outputDir,
      setName: `scene-semantic-review:${targetPrefix}:${arm}`,
      live: opts.sceneSemanticLive,
      persist: opts.sceneSemanticPersist,
      readinessImport: opts.sceneSemanticReadinessImport,
      model: "deepseek-v4-flash",
      thinking: true,
      maxTokens: opts.sceneSemanticMaxTokens,
      concurrency: opts.sceneSemanticConcurrency,
      promptMode: "evidence-first",
      dimensions: opts.sceneSemanticDimensions,
      json: false,
    })
    const artifacts = writeSceneSemanticArtifacts(report, outputDir)
    const persistence = opts.sceneSemanticPersist
      ? await persistSceneSemanticTelemetry(report)
      : undefined
    const readinessImport = opts.sceneSemanticPersist && opts.sceneSemanticReadinessImport
      ? await importSceneSemanticReadiness(report.novelId, report.setName, artifacts.readiness)
      : undefined
    return sceneSemanticSummary(report, outputDir, { persistence, readinessImport })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const failureArtifact = writeSceneSemanticFailureArtifacts({
      novelId,
      targetPrefix,
      arm,
      outputDir,
      error,
      opts,
    })
    return {
      outputDir,
      taskCount: 0,
      skipCount: 0,
      lowRows: 0,
      errorRows: 1,
      dimensions: [],
      error,
      failureArtifact,
      recommendation: `scene semantic review failed: ${error}`,
    }
  }
}

export function writeSceneSemanticFailureArtifacts(input: {
  novelId: string
  targetPrefix: string
  arm: ArmName
  outputDir: string
  error: string
  opts: Pick<RunArmOptions,
    "sceneSemanticLive" |
    "sceneSemanticConcurrency" |
    "sceneSemanticMaxTokens" |
    "sceneSemanticDimensions"
  >
}): string {
  mkdirSync(input.outputDir, { recursive: true })
  const generatedAt = new Date().toISOString()
  const artifact = {
    v: "scene-semantic-review-failure-v1",
    generatedAt,
    novelId: input.novelId,
    targetPrefix: input.targetPrefix,
    arm: input.arm,
    error: input.error,
    options: {
      live: input.opts.sceneSemanticLive,
      model: "deepseek-v4-flash",
      thinking: true,
      promptMode: "evidence-first",
      maxTokens: input.opts.sceneSemanticMaxTokens,
      concurrency: input.opts.sceneSemanticConcurrency,
      dimensions: input.opts.sceneSemanticDimensions,
    },
    recommendation: "Treat this as evaluator telemetry; rerun with a narrower dimension set, lower concurrency, or a larger token cap before comparing scene-semantic rows.",
  }
  const jsonPath = join(input.outputDir, "scene-semantic-review-failure.json")
  writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`)

  const lines = [
    "# Scene-Semantic Replay Failure",
    "",
    `Generated: ${generatedAt}`,
    `Novel: ${input.novelId}`,
    `Target prefix: ${input.targetPrefix}`,
    `Arm: ${input.arm}`,
    `Mode: ${input.opts.sceneSemanticLive ? "live" : "dry"}; model=deepseek-v4-flash; thinking=true; promptMode=evidence-first`,
    `Max tokens: ${input.opts.sceneSemanticMaxTokens}`,
    `Concurrency: ${input.opts.sceneSemanticConcurrency}`,
    `Dimensions: ${input.opts.sceneSemanticDimensions.join(", ")}`,
    "",
    "## Error",
    "",
    input.error,
    "",
    "## Next",
    "",
    "- Treat this as evaluator telemetry, not a drafting failure.",
    "- Rerun with a narrower dimension set, lower concurrency, or a larger token cap before comparing scene-semantic rows.",
    "",
  ]
  writeFileSync(join(input.outputDir, "scene-semantic-review-failure.md"), `${lines.join("\n")}`)
  return jsonPath
}

function writeSceneSemanticArtifacts(report: SceneSemanticReplayReport, outputDir: string): {
  reviewJsonPath: string
  readinessJsonPath: string
  readiness: ReturnType<typeof buildSceneSemanticReadinessAggregate>
} {
  mkdirSync(outputDir, { recursive: true })
  const reviewJsonPath = join(outputDir, "scene-semantic-review.json")
  writeFileSync(reviewJsonPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(outputDir, "scene-semantic-review.md"), renderSceneSemanticReplayReport(report))
  const readiness = buildSceneSemanticReadinessAggregate([{
    report,
    sourceReport: reviewJsonPath,
  }])
  const readinessJsonPath = join(outputDir, "scene-semantic-readiness.json")
  writeFileSync(readinessJsonPath, `${JSON.stringify(readiness, null, 2)}\n`)
  writeFileSync(join(outputDir, "scene-semantic-readiness.md"), renderSceneSemanticReadinessAggregate(readiness))
  return { reviewJsonPath, readinessJsonPath, readiness }
}

async function persistSceneSemanticTelemetry(
  report: SceneSemanticReplayReport,
): Promise<SceneSemanticPersistenceTelemetrySummary> {
  try {
    const persisted = await persistSceneSemanticReplayReport(report)
    return {
      requested: true,
      briefRows: persisted.briefRows,
      resultRows: persisted.resultRows,
    }
  } catch (err) {
    return {
      requested: true,
      briefRows: 0,
      resultRows: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function importSceneSemanticReadiness(
  novelId: string,
  setName: string,
  readiness: ReturnType<typeof buildSceneSemanticReadinessAggregate>,
): Promise<SceneSemanticReadinessImportTelemetrySummary> {
  try {
    const { importPlanReadinessAggregateForNovel } = await import("../src/harness/plan-readiness-import")
    const imported = await importPlanReadinessAggregateForNovel({
      novelId,
      aggregate: readiness,
      importedByKind: "script",
      importedByRef: `scene-semantic-review:${setName}`,
      refreshStaleness: true,
    })
    return {
      requested: true,
      inserted: imported.inserted,
      updated: imported.updated,
      skipped: imported.skipped.length,
      itemIds: imported.items.map(item => item.id),
    }
  } catch (err) {
    return {
      requested: true,
      inserted: 0,
      updated: 0,
      skipped: 0,
      itemIds: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function sceneSemanticSummary(
  report: SceneSemanticReplayReport,
  outputDir: string,
  telemetry: {
    persistence?: SceneSemanticPersistenceTelemetrySummary
    readinessImport?: SceneSemanticReadinessImportTelemetrySummary
  } = {},
): SceneSemanticTelemetrySummary {
  const lowRows = report.results.filter(row => !row.error && row.ordinal <= 1).length
  const errorRows = report.results.filter(row => row.error).length
  return {
    outputDir,
    taskCount: report.taskCount,
    skipCount: report.skipCount,
    lowRows,
    errorRows,
    ...(telemetry.persistence ? { persistence: telemetry.persistence } : {}),
    ...(telemetry.readinessImport ? { readinessImport: telemetry.readinessImport } : {}),
    dimensions: report.summaries,
    recommendation: errorRows > 0
      ? "Diagnostic review incomplete: inspect errored scene-semantic judge rows before promoting this drafting surface."
      : lowRows > 0
      ? "Diagnostic review: inspect low endpoint/scene-turn rows before promoting this drafting surface."
      : "Diagnostic review: no low endpoint/scene-turn rows in selected dimensions.",
  }
}

export function parseArgs(argv: string[]): Args {
  let source: string | null = null
  let targetPrefix: string | null = null
  let armsRaw: string | null = null
  let writerOnly = false
  let qualityTelemetryPacket = false
  let proseSemanticEval = true
  let proseSemanticDryRun = false
  let proseSemanticConcurrency = 4
  let sceneSemanticReview = false
  let sceneSemanticLive = true
  let sceneSemanticPersist = false
  let sceneSemanticReadinessImport = true
  let sceneSemanticReadinessImportExplicit = false
  let sceneSemanticConcurrency = 4
  let sceneSemanticMaxTokens = DEFAULT_SCENE_SEMANTIC_MAX_TOKENS
  let sceneSemanticMaxTokensExplicit = false
  const sceneSemanticDimensions: Dimension[] = []
  let allowDraftedSource = false
  let targetWordScale = 1
  let perArmTimeoutMs: number | null = null
  let reportDir: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--source") { source = argv[++i] ?? null; continue }
    if (a === "--target-prefix") { targetPrefix = argv[++i] ?? null; continue }
    if (a === "--writer-arms") { armsRaw = argv[++i] ?? null; continue }
    if (a === "--writer-only") { writerOnly = true; continue }
    if (a === "--quality-telemetry-packet") { qualityTelemetryPacket = true; continue }
    if (a === "--prose-semantic-eval") { proseSemanticEval = true; continue }
    if (a === "--no-prose-semantic-eval") { proseSemanticEval = false; proseSemanticDryRun = false; continue }
    if (a === "--prose-semantic-dry-run") { proseSemanticEval = true; proseSemanticDryRun = true; continue }
    if (a === "--prose-semantic-concurrency") {
      const raw = argv[++i] ?? ""
      const parsed = Number.parseInt(raw, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--prose-semantic-concurrency requires a positive integer; got ${JSON.stringify(raw)}`)
      }
      proseSemanticConcurrency = parsed
      continue
    }
    if (a === "--scene-semantic-review") { sceneSemanticReview = true; sceneSemanticLive = true; continue }
    if (a === "--scene-semantic-dry-run") { sceneSemanticReview = true; sceneSemanticLive = false; continue }
    if (a === "--scene-semantic-persist") { sceneSemanticReview = true; sceneSemanticPersist = true; continue }
    if (a === "--scene-semantic-readiness-import") { sceneSemanticReview = true; sceneSemanticPersist = true; sceneSemanticReadinessImport = true; sceneSemanticReadinessImportExplicit = true; continue }
    if (a === "--no-scene-semantic-readiness-import") { sceneSemanticReadinessImport = false; sceneSemanticReadinessImportExplicit = true; continue }
    if (a === "--no-scene-semantic-review") { sceneSemanticReview = false; sceneSemanticPersist = false; continue }
    if (a === "--allow-drafted-source") { allowDraftedSource = true; continue }
    if (a === "--target-word-scale") {
      const raw = argv[++i] ?? ""
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--target-word-scale requires a positive number; got ${JSON.stringify(raw)}`)
      }
      targetWordScale = parsed
      continue
    }
    if (a === "--scene-semantic-dimension") {
      sceneSemanticReview = true
      sceneSemanticDimensions.push(parseSceneSemanticDimension(argv[++i] ?? ""))
      continue
    }
    if (a === "--scene-semantic-concurrency") {
      sceneSemanticReview = true
      const raw = argv[++i] ?? ""
      const parsed = Number.parseInt(raw, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--scene-semantic-concurrency requires a positive integer; got ${JSON.stringify(raw)}`)
      }
      sceneSemanticConcurrency = parsed
      continue
    }
    if (a === "--scene-semantic-max-tokens") {
      sceneSemanticReview = true
      const raw = argv[++i] ?? ""
      const parsed = Number.parseInt(raw, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--scene-semantic-max-tokens requires a positive integer; got ${JSON.stringify(raw)}`)
      }
      sceneSemanticMaxTokens = parsed
      sceneSemanticMaxTokensExplicit = true
      continue
    }
    if (a === "--per-arm-timeout-ms") {
      const raw = argv[++i] ?? ""
      const parsed = Number.parseInt(raw, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--per-arm-timeout-ms requires a positive integer; got ${JSON.stringify(raw)}`)
      }
      perArmTimeoutMs = parsed
      continue
    }
    if (a === "--report-dir") { reportDir = argv[++i] ?? null; continue }
    throw new Error(`unknown arg: ${a}`)
  }
  if (!source) throw new Error("--source <planning-done-novel-id> is required")
  if (!targetPrefix) throw new Error("--target-prefix <prefix> is required")
  if (qualityTelemetryPacket) {
    proseSemanticEval = true
    proseSemanticDryRun = false
    sceneSemanticReview = true
    sceneSemanticLive = true
    sceneSemanticPersist = true
    if (!sceneSemanticReadinessImportExplicit) sceneSemanticReadinessImport = false
    if (!sceneSemanticMaxTokensExplicit) sceneSemanticMaxTokens = QUALITY_TELEMETRY_SCENE_SEMANTIC_MAX_TOKENS
  }
  const arms: ArmName[] = (armsRaw ?? "baseline,scene-call-v1")
    .split(",").map(s => s.trim()).filter(Boolean) as ArmName[]
  for (const arm of arms) {
    if (!WRITER_ARM_NAMES.includes(arm)) {
      throw new Error(`--writer-arms entries must be one of ${WRITER_ARM_NAMES.join(", ")}; got ${arm}`)
    }
  }
  if (arms.length === 0) throw new Error("--writer-arms produced an empty arm list")
  return {
    source,
    targetPrefix,
    arms,
    writerOnly,
    qualityTelemetryPacket,
    proseSemanticEval,
    proseSemanticDryRun,
    proseSemanticConcurrency,
    sceneSemanticReview,
    sceneSemanticLive,
    sceneSemanticPersist,
    sceneSemanticReadinessImport,
    sceneSemanticConcurrency,
    sceneSemanticMaxTokens,
    sceneSemanticDimensions: sceneSemanticDimensions.length > 0 ? sceneSemanticDimensions : DEFAULT_SCENE_SEMANTIC_DIMENSIONS,
    allowDraftedSource,
    targetWordScale,
    perArmTimeoutMs,
    reportDir,
  }
}

function parseSceneSemanticDimension(value: string): Dimension {
  const allowed: Dimension[] = [
    "characterAgency", "worldPressure", "endpointLanding", "causalMomentum",
    "sceneDramaturgy", "threadProgression", "promiseProgress", "promisePayoff",
    "motivationSpecificity", "characterMateriality", "relationshipDelta",
    "worldFactPressure", "stakesValueShift",
  ]
  if (allowed.includes(value as Dimension)) return value as Dimension
  throw new Error(`unsupported --scene-semantic-dimension: ${value}`)
}

async function main() {
  setAutoMode(true)
  setResolverMode(getMode(true))

  const args = parseArgs(process.argv.slice(2))
  console.log(`source: ${args.source}`)
  console.log(`target prefix: ${args.targetPrefix}`)
  console.log(`arms: ${args.arms.join(", ")}`)
  if (args.writerOnly) {
    console.log(`writer-only mode: draftCaptureModeV1=true on every arm — chapter-level checker settle loops are SKIPPED`)
  }
  if (args.qualityTelemetryPacket) {
    console.log(`quality telemetry packet: enabled (advisory prose+scene semantics; scene readiness import=${args.sceneSemanticReadinessImport ? "enabled" : "disabled"})`)
  }
  if (args.proseSemanticEval) {
    console.log(`prose semantic eval: enabled${args.proseSemanticDryRun ? " (dry-run)" : ""}, concurrency=${args.proseSemanticConcurrency}`)
  }
  if (args.sceneSemanticReview) {
    console.log(`scene semantic replay: enabled${args.sceneSemanticLive ? "" : " (dry-run)"}, dimensions=${args.sceneSemanticDimensions.join(",")}, concurrency=${args.sceneSemanticConcurrency}`)
    if (args.sceneSemanticPersist) {
      console.log(`scene semantic persistence: enabled; readiness import=${args.sceneSemanticReadinessImport ? "enabled" : "disabled"}`)
    }
  }
  if (args.allowDraftedSource) {
    console.log(`allow drafted source: true (source may include generated draft state)`)
  }
  if (args.targetWordScale !== 1) {
    console.log(`target word scale: ${args.targetWordScale} (clone-only budget elasticity probe; source plan is unchanged)`)
  }
  if (args.perArmTimeoutMs != null) {
    console.log(`per-arm timeout: ${args.perArmTimeoutMs}ms (a hung arm will not block the next arm; partial chapter_drafts are still collected)`)
  }

  const sourceAssessment = await ensureSourceExists(args.source, { allowDraftedSource: args.allowDraftedSource })
  const sourcePlannerQuality = await maybeRunSourcePlannerQualityAudit(args.source, args.targetPrefix)

  const results: ArmResult[] = []
  for (const arm of args.arms) {
    results.push(await runArm(arm, args.source, args.targetPrefix, {
      writerOnly: args.writerOnly,
      proseSemanticEval: args.proseSemanticEval,
      proseSemanticDryRun: args.proseSemanticDryRun,
      proseSemanticConcurrency: args.proseSemanticConcurrency,
      sceneSemanticReview: args.sceneSemanticReview,
      sceneSemanticLive: args.sceneSemanticLive,
      sceneSemanticPersist: args.sceneSemanticPersist,
      sceneSemanticReadinessImport: args.sceneSemanticReadinessImport,
      sceneSemanticConcurrency: args.sceneSemanticConcurrency,
      sceneSemanticMaxTokens: args.sceneSemanticMaxTokens,
      sceneSemanticDimensions: args.sceneSemanticDimensions,
      targetWordScale: args.targetWordScale,
      perArmTimeoutMs: args.perArmTimeoutMs,
    }))
  }

  console.log(`\n\n━━━━━━━━━━ A/B SUMMARY ━━━━━━━━━━`)
  for (const r of results) {
    console.log(`\n${r.arm} (${r.novelId})`)
    if (r.error) {
      console.log(`  FAILED: ${r.error}`)
    }
    console.log(`  chapters drafted: ${r.chapters.length}`)
    console.log(`  total words: ${r.totalWords} / target ${r.totalTarget}`)
    console.log(`  mean per-chapter ratio: ${r.meanRatio.toFixed(3)}`)
    console.log(`  writer-expansion events: ${r.expansionEvents}`)
    if (r.targetWordScaling) {
      console.log(
        `  target word scaling: scale=${r.targetWordScaling.scale}, ` +
          `${r.targetWordScaling.beforeTotalTargetWords}→${r.targetWordScaling.afterTotalTargetWords}, ` +
          `chapters=${r.targetWordScaling.changedChapters}, scenes=${r.targetWordScaling.changedScenes}`,
      )
    }
    console.log(`  writer drafting brief: ${formatDraftingBriefTelemetry(r.draftingBrief)}`)
    if (r.planningContext) {
      console.log(`  planning context: surfaces=${r.planningContext.surfaceCount}, gaps=${r.planningContext.gapCount}, report=${r.planningContext.outputDir}`)
      if (r.planningContext.readiness) {
        console.log(`    readiness: groups=${r.planningContext.readiness.groupCount}, findings=${r.planningContext.readiness.findingCount}`)
      }
      if (r.planningContext.gaps.length > 0) {
        console.log(`    gaps: ${r.planningContext.gaps.map(gap => `${gap.surface}:${gap.status}`).join(", ")}`)
      }
      if (r.planningContext.error) {
        console.log(`    error: ${r.planningContext.error}`)
      }
    }
    if (r.planAssistReadiness) {
      console.log(`  plan-assist readiness: rows=${r.planAssistReadiness.exhaustionRows}, pending=${r.planAssistReadiness.pendingRows}, groups=${r.planAssistReadiness.groupCount}, findings=${r.planAssistReadiness.findingCount}, report=${r.planAssistReadiness.outputDir}`)
      if (r.planAssistReadiness.error) {
        console.log(`    error: ${r.planAssistReadiness.error}`)
      }
    }
    if (r.checkerReadiness) {
      console.log(`  checker readiness: items=${r.checkerReadiness.checkerItems}, blockers=${r.checkerReadiness.blockerItems}, warnings=${r.checkerReadiness.warningItems}, negative=${r.checkerReadiness.negativeItems}, positive=${r.checkerReadiness.positiveItems}, ambiguous=${r.checkerReadiness.ambiguousItems}, lowConfidence=${r.checkerReadiness.lowConfidenceItems}, groups=${r.checkerReadiness.groupCount}, findings=${r.checkerReadiness.findingCount}, report=${r.checkerReadiness.outputDir}`)
      if (r.checkerReadiness.error) {
        console.log(`    error: ${r.checkerReadiness.error}`)
      }
    }
    if (r.proseSemantic) {
      console.log(`  prose semantic: rows=${r.proseSemantic.resultCount}, lows=${r.proseSemantic.lowRows}, errors=${r.proseSemantic.errorRows}`)
      console.log(`    guidance: lengthSignal=${r.proseSemantic.lengthSignal}, qualityRisk=${r.proseSemantic.qualityRisk}`)
      console.log(`    report: ${r.proseSemantic.outputDir || "(not written)"}`)
      console.log(`    recommendation: ${r.proseSemantic.recommendation}`)
      if (r.proseSemantic.saturationNotes.length > 0) {
        console.log(`    saturation: ${r.proseSemantic.saturationNotes.join(" | ")}`)
      }
    }
    if (r.sceneSemantic) {
      console.log(`  scene semantic: tasks=${r.sceneSemantic.taskCount}, lows=${r.sceneSemantic.lowRows}, errors=${r.sceneSemantic.errorRows}, skips=${r.sceneSemantic.skipCount}`)
      console.log(`    report: ${r.sceneSemantic.outputDir || "(not written)"}`)
      if (r.sceneSemantic.persistence) {
        const p = r.sceneSemantic.persistence
        console.log(`    persisted: briefs=${p.briefRows}, results=${p.resultRows}${p.error ? `, error=${p.error}` : ""}`)
      }
      if (r.sceneSemantic.readinessImport) {
        const imported = r.sceneSemantic.readinessImport
        console.log(`    readiness import: inserted=${imported.inserted}, updated=${imported.updated}, skipped=${imported.skipped}${imported.error ? `, error=${imported.error}` : ""}`)
      }
      console.log(`    recommendation: ${r.sceneSemantic.recommendation}`)
      for (const dim of r.sceneSemantic.dimensions) {
        const counts = Object.entries(dim.labelCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([label, count]) => `${label}:${count}`)
          .join(" ")
        console.log(`    ${dim.dimension}: mean=${dim.meanOrdinal.toFixed(2)}, lows=${dim.lowCount}/${dim.count}, ${counts}`)
      }
    }
    for (const c of r.chapters) {
      console.log(`    ch${c.chapter}: ${c.words}/${c.targetWords} (${c.ratio.toFixed(2)})`)
    }
  }

  const baseline = results.find(r => r.arm === "baseline")
  if (baseline && !baseline.error) {
    console.log(`\n━━━━━━━━━━ DELTAS vs baseline ━━━━━━━━━━`)
    for (const r of results) {
      if (r.arm === "baseline") continue
      if (r.error) {
        console.log(`  ${r.arm}: FAILED — ${r.error}`)
        continue
      }
      const delta = r.meanRatio - baseline.meanRatio
      const sign = delta >= 0 ? "+" : ""
      console.log(`  ${r.arm} − baseline: ${sign}${delta.toFixed(3)} (expansion events: ${r.expansionEvents})`)
      if (r.arm === "scene-call-v1") {
        // L097 POC magnitude check applies only to the scene-call-v1 arm
        // (the original POC compared baseline vs scene-call+expansion).
        if (delta >= 0.10) console.log(`    ✓ POC-magnitude improvement (≥0.10)`)
        else if (delta >= 0.05) console.log(`    ⚠ partial improvement (≥0.05 but <0.10) — sub-POC magnitude`)
        else console.log(`    ✗ insufficient improvement (<0.05) — does not match POC evidence`)
      }
    }
  }

  const reportDir = args.reportDir ?? `output/drafting-isolated/${args.targetPrefix}`
  const sceneSemanticComparison = writeDraftingIsolatedSceneSemanticComparison(results, reportDir)
  if (sceneSemanticComparison) {
    console.log(`\nscene semantic comparison: ${sceneSemanticComparison.outputDir}/scene-semantic-compare.json`)
  }

  const report = buildDraftingIsolatedRunReport({
    args,
    results,
    sourceAssessment,
    sourcePlannerQuality,
    sceneSemanticComparison,
  })
  writeDraftingIsolatedRunReport(report, reportDir)
  console.log(`\nreport: ${reportDir}/drafting-isolated-report.json`)

  process.exit(0)
}

export function buildDraftingIsolatedRunReport(input: {
  args: Args
  results: ArmResult[]
  sourceAssessment: SourceDraftingIsolationAssessment
  sourcePlannerQuality?: PlannerQualityTelemetrySummary | null
  sceneSemanticComparison?: DraftingIsolatedSceneSemanticComparisonSummary | null
  generatedAt?: string
}): DraftingIsolatedRunReport {
  const results = input.results
  const deltas = draftingIsolatedDeltas(results)
  return {
    v: "drafting-isolated-report-v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: input.args.source,
    targetPrefix: input.args.targetPrefix,
    sourceAssessment: input.sourceAssessment,
    options: {
      arms: input.args.arms,
      writerOnly: input.args.writerOnly,
      qualityTelemetryPacket: input.args.qualityTelemetryPacket,
      proseSemanticEval: input.args.proseSemanticEval,
      proseSemanticDryRun: input.args.proseSemanticDryRun,
      proseSemanticConcurrency: input.args.proseSemanticConcurrency,
      sceneSemanticReview: input.args.sceneSemanticReview,
      sceneSemanticLive: input.args.sceneSemanticLive,
      sceneSemanticPersist: input.args.sceneSemanticPersist,
      sceneSemanticReadinessImport: input.args.sceneSemanticReadinessImport,
      sceneSemanticConcurrency: input.args.sceneSemanticConcurrency,
      sceneSemanticMaxTokens: input.args.sceneSemanticMaxTokens,
      sceneSemanticDimensions: input.args.sceneSemanticDimensions,
      allowDraftedSource: input.args.allowDraftedSource,
      targetWordScale: input.args.targetWordScale,
      perArmTimeoutMs: input.args.perArmTimeoutMs,
    },
    summary: {
      armCount: results.length,
      completedArms: results.filter(result => !result.error).length,
      errorArms: results.filter(result => Boolean(result.error)).length,
      cleanSource: input.sourceAssessment.clean,
      totalWordsByArm: Object.fromEntries(results.map(result => [result.arm, result.totalWords])),
      meanRatioByArm: Object.fromEntries(results.map(result => [result.arm, result.meanRatio])),
      planningContextGapsByArm: Object.fromEntries(results.map(result => [result.arm, result.planningContext?.gapCount ?? null])),
      planningContextReadinessByArm: Object.fromEntries(results.map(result => [result.arm, result.planningContext?.readiness?.findingCount ?? null])),
      planAssistReadinessByArm: Object.fromEntries(results.map(result => [result.arm, result.planAssistReadiness?.findingCount ?? null])),
      checkerReadinessByArm: Object.fromEntries(results.map(result => [result.arm, result.checkerReadiness?.findingCount ?? null])),
      proseSemanticLowRowsByArm: Object.fromEntries(results.map(result => [result.arm, result.proseSemantic?.lowRows ?? null])),
      sceneSemanticLowRowsByArm: Object.fromEntries(results.map(result => [result.arm, result.sceneSemantic?.lowRows ?? null])),
    },
    sourcePlannerQuality: input.sourcePlannerQuality ?? null,
    results,
    deltas,
    sceneSemanticComparison: input.sceneSemanticComparison ?? null,
  }
}

export function draftingIsolatedDeltas(results: readonly ArmResult[]): DraftingIsolatedDelta[] {
  const baseline = results.find(result => result.arm === "baseline")
  if (!baseline || baseline.error) return []
  return results
    .filter(result => result.arm !== "baseline")
    .map(result => {
      const meanRatioDelta = result.meanRatio - baseline.meanRatio
      return {
        arm: result.arm,
        baselineArm: "baseline",
        meanRatioDelta,
        expansionEvents: result.expansionEvents,
        error: result.error ?? null,
        pocMagnitude: result.error
          ? "failed"
          : result.arm !== "scene-call-v1"
            ? "not_applicable"
            : meanRatioDelta >= 0.10
              ? "improvement"
              : meanRatioDelta >= 0.05
                ? "partial"
                : "insufficient",
      }
    })
}

export function writeDraftingIsolatedSceneSemanticComparison(
  results: readonly ArmResult[],
  reportDir: string,
): DraftingIsolatedSceneSemanticComparisonSummary | null {
  const reportRefs = results.flatMap(result => {
    const ref = sceneSemanticReportRefForArm(result)
    return ref ? [ref] : []
  })
  if (reportRefs.length < 2) return null
  const baseline = reportRefs.find(ref => ref.arm === "baseline") ?? reportRefs[0]!
  const candidates = reportRefs.filter(ref => ref !== baseline)
  if (candidates.length === 0) return null

  const comparisonReport = buildSceneSemanticComparisonReport({
    baseline,
    candidates,
  })
  const outputDir = reportDir
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, "scene-semantic-compare.json"), `${JSON.stringify(comparisonReport, null, 2)}\n`)
  writeFileSync(join(outputDir, "scene-semantic-compare.md"), renderSceneSemanticComparisonReport(comparisonReport))
  const armByPath = new Map(reportRefs.map(ref => [ref.path, ref.arm]))
  return {
    outputDir,
    baselineArm: baseline.arm,
    baselineReport: baseline.path,
    candidateCount: comparisonReport.comparisons.length,
    comparisons: comparisonReport.comparisons.map(comparison => ({
      candidateArm: armByPath.get(comparison.candidate.path) ?? candidates[0]!.arm,
      candidateReport: comparison.candidate.path,
      verdict: comparison.verdict,
      comparedRows: comparison.comparedRows,
      missingInCandidate: comparison.missingInCandidate.length,
      missingInBaseline: comparison.missingInBaseline.length,
      dimensions: comparison.dimensions.map(dim => ({
        dimension: dim.dimension,
        meanDelta: dim.meanDelta,
        lowDelta: dim.lowDelta,
        resolvedLowRows: dim.resolvedLowRows,
        regressedLowRows: dim.regressedLowRows,
        improvedRows: dim.improvedRows,
        worsenedRows: dim.worsenedRows,
      })),
    })),
  }
}

function sceneSemanticReportRefForArm(result: ArmResult): (SceneSemanticReportRef & { arm: ArmName }) | null {
  if (!result.sceneSemantic || result.sceneSemantic.taskCount === 0) return null
  const path = join(result.sceneSemantic.outputDir, "scene-semantic-review.json")
  if (!existsSync(path)) return null
  try {
    return {
      arm: result.arm,
      path,
      report: JSON.parse(readFileSync(path, "utf8")) as SceneSemanticReplayReport,
    }
  } catch {
    return null
  }
}

export function renderDraftingIsolatedRunReport(report: DraftingIsolatedRunReport): string {
  const lines: string[] = []
  lines.push("# Drafting Isolated Report")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Source: ${report.source}`)
  lines.push(`Target prefix: ${report.targetPrefix}`)
  lines.push(`Clean source: ${report.summary.cleanSource ? "yes" : "no"}`)
  if (report.sourceAssessment.issue) lines.push(`Source issue: ${report.sourceAssessment.issue}`)
  lines.push("")
  lines.push("## Summary")
  lines.push(`- arms: ${report.summary.armCount}`)
  lines.push(`- completed arms: ${report.summary.completedArms}`)
  lines.push(`- error arms: ${report.summary.errorArms}`)
  lines.push(`- writer-only: ${report.options.writerOnly}`)
  lines.push(`- quality telemetry packet: ${report.options.qualityTelemetryPacket ? "enabled" : "disabled"}`)
  lines.push(`- target word scale: ${report.options.targetWordScale}`)
  lines.push(`- prose semantic eval: ${report.options.proseSemanticEval ? "enabled" : "disabled"}`)
  lines.push(`- scene semantic replay: ${report.options.sceneSemanticReview ? "enabled" : "disabled"}`)
  lines.push(`- scene semantic persistence: ${report.options.sceneSemanticPersist ? "enabled" : "disabled"}`)
  lines.push(`- scene semantic readiness import: ${report.options.sceneSemanticPersist && report.options.sceneSemanticReadinessImport ? "enabled" : "disabled"}`)
  if (report.sourcePlannerQuality) {
    const quality = report.sourcePlannerQuality
    lines.push(
      `- source planner quality: chapters=${quality.chapters} scenes=${quality.plannedScenes} ` +
        `endpointIssues=${quality.endpointIssues} inactiveCharacters=${quality.inactiveCharacterFindings} ` +
        `weakStoryTurns=${quality.weakStoryTurnEntries} obligationErrors=${quality.obligationErrorChapters} ` +
        `readiness=${quality.readiness.findingCount} report=${quality.outputDir}` +
        (quality.error ? ` error=${quality.error}` : ""),
    )
  }
  lines.push("")
  lines.push("## Arms")
  for (const result of report.results) {
    lines.push(`- ${result.arm}: novel=${result.novelId} words=${result.totalWords}/${result.totalTarget} meanRatio=${result.meanRatio.toFixed(3)}${result.error ? ` error=${result.error}` : ""}`)
    if (result.targetWordScaling) {
      lines.push(
        `  targetWordScaling scale=${result.targetWordScaling.scale} ` +
          `target=${result.targetWordScaling.beforeTotalTargetWords}->${result.targetWordScaling.afterTotalTargetWords} ` +
          `changedChapters=${result.targetWordScaling.changedChapters} changedScenes=${result.targetWordScaling.changedScenes}`,
      )
    }
    if (result.proseSemantic) {
      lines.push(`  proseSemantic rows=${result.proseSemantic.resultCount} lows=${result.proseSemantic.lowRows} errors=${result.proseSemantic.errorRows} report=${result.proseSemantic.outputDir || "(not written)"}`)
    }
    if (result.planningContext) {
      lines.push(`  planningContext surfaces=${result.planningContext.surfaceCount} gaps=${result.planningContext.gapCount} report=${result.planningContext.outputDir}`)
      if (result.planningContext.readiness) {
        lines.push(`  planningContextReadiness groups=${result.planningContext.readiness.groupCount} findings=${result.planningContext.readiness.findingCount}`)
      }
      if (result.planningContext.gaps.length > 0) {
        lines.push(`  planningContextGaps ${result.planningContext.gaps.map(gap => `${gap.surface}:${gap.status}`).join(", ")}`)
      }
    }
    if (result.planAssistReadiness) {
      lines.push(
        `  planAssistReadiness rows=${result.planAssistReadiness.exhaustionRows} pending=${result.planAssistReadiness.pendingRows} ` +
          `groups=${result.planAssistReadiness.groupCount} findings=${result.planAssistReadiness.findingCount} report=${result.planAssistReadiness.outputDir}` +
          (result.planAssistReadiness.error ? ` error=${result.planAssistReadiness.error}` : ""),
      )
    }
    if (result.checkerReadiness) {
      lines.push(
        `  checkerReadiness items=${result.checkerReadiness.checkerItems} blockers=${result.checkerReadiness.blockerItems} ` +
          `warnings=${result.checkerReadiness.warningItems} negative=${result.checkerReadiness.negativeItems} ` +
          `positive=${result.checkerReadiness.positiveItems} ambiguous=${result.checkerReadiness.ambiguousItems} ` +
          `lowConfidence=${result.checkerReadiness.lowConfidenceItems} groups=${result.checkerReadiness.groupCount} ` +
          `findings=${result.checkerReadiness.findingCount} report=${result.checkerReadiness.outputDir}` +
          (result.checkerReadiness.error ? ` error=${result.checkerReadiness.error}` : ""),
      )
    }
    if (result.sceneSemantic) {
      lines.push(`  sceneSemantic tasks=${result.sceneSemantic.taskCount} lows=${result.sceneSemantic.lowRows} errors=${result.sceneSemantic.errorRows} report=${result.sceneSemantic.outputDir || "(not written)"}`)
      if (result.sceneSemantic.persistence) {
        const p = result.sceneSemantic.persistence
        lines.push(`  sceneSemanticPersistence briefs=${p.briefRows} results=${p.resultRows}${p.error ? ` error=${p.error}` : ""}`)
      }
      if (result.sceneSemantic.readinessImport) {
        const imported = result.sceneSemantic.readinessImport
        lines.push(`  sceneSemanticReadinessImport inserted=${imported.inserted} updated=${imported.updated} skipped=${imported.skipped}${imported.error ? ` error=${imported.error}` : ""}`)
      }
    }
  }
  if (report.deltas.length > 0) {
    lines.push("")
    lines.push("## Deltas")
    for (const delta of report.deltas) {
      const sign = delta.meanRatioDelta >= 0 ? "+" : ""
      lines.push(`- ${delta.arm} vs ${delta.baselineArm}: ${sign}${delta.meanRatioDelta.toFixed(3)} expansionEvents=${delta.expansionEvents} verdict=${delta.pocMagnitude}${delta.error ? ` error=${delta.error}` : ""}`)
    }
  }
  if (report.sceneSemanticComparison && report.sceneSemanticComparison.comparisons.length > 0) {
    lines.push("")
    lines.push("## Scene Semantic Comparison")
    lines.push(`- baseline: ${report.sceneSemanticComparison.baselineArm}`)
    lines.push(`- report: ${report.sceneSemanticComparison.outputDir}/scene-semantic-compare.json`)
    for (const comparison of report.sceneSemanticComparison.comparisons) {
      lines.push(`- ${comparison.candidateArm}: verdict=${comparison.verdict} rows=${comparison.comparedRows} missingCandidate=${comparison.missingInCandidate} missingBaseline=${comparison.missingInBaseline}`)
      for (const dim of comparison.dimensions) {
        const mean = dim.meanDelta === null ? "n/a" : dim.meanDelta.toFixed(2)
        const lowSign = dim.lowDelta > 0 ? "+" : ""
        lines.push(`  ${dim.dimension}: meanDelta=${mean} lowDelta=${lowSign}${dim.lowDelta} resolved=${dim.resolvedLowRows} regressed=${dim.regressedLowRows}`)
      }
    }
  }
  return `${lines.join("\n")}\n`
}

function writeDraftingIsolatedRunReport(report: DraftingIsolatedRunReport, reportDir: string): void {
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(join(reportDir, "drafting-isolated-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(reportDir, "drafting-isolated-report.md"), renderDraftingIsolatedRunReport(report))
}

function formatDraftingBriefTelemetry(summary: DraftingBriefTelemetrySummary): string {
  if (summary.events === 0) return "no writer-context telemetry"
  const modeText = Object.entries(summary.modes)
    .map(([mode, count]) => `${mode}=${count}`)
    .join(", ")
  const ratio = summary.avgCharsRatio === null ? "n/a" : summary.avgCharsRatio.toFixed(3)
  const selected = summary.avgSelectedPromptChars === null ? "n/a" : Math.round(summary.avgSelectedPromptChars)
  const full = summary.avgFullContextPromptChars === null ? "n/a" : Math.round(summary.avgFullContextPromptChars)
  return `events=${summary.events}, enabled=${summary.enabledEvents}, modes=${modeText || "none"}, avgChars=${selected}/${full}, avgRatio=${ratio}, delta=${summary.totalCharsDelta}`
}

if (import.meta.main) {
  main().catch(err => {
    console.error(err instanceof Error ? err.stack : err)
    process.exit(1)
  })
}
