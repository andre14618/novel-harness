import type { FactRoleContextPolicy } from "../harness/fact-roles"
import type { AuthoringBibleMode } from "../harness/authoring-bible"
import type { WriterDraftingBriefMode } from "../agents/writer/drafting-brief"
import {
  DEFAULT_WRITER_CONTEXT_MODE,
  DEFAULT_WRITER_PROMPT_ID_RENDERING,
  type WriterContextMode,
  type WriterPromptIdRendering,
} from "../agents/writer/context-mode"

export const pipeline = {
  // Drafting
  maxDraftAttempts: 3,
  beatLevelWriting: true,     // legacy flag name; uses scene-entry context + generation
  maxBeatRetries: 2,          // retries per beat on adherence failure
  chapterPlanCheck: true,     // validate assembled prose against chapter plan
  maxChapterPlanRewritePasses: 2, // when chapter-plan-checker fails, rewrite affected beats in place up to N times before escalating to full chapter restart

  // Validation
  maxValidationPasses: 3,
  maxChapterRewrites: 3,

  // Quality redraft — when existing checkers pass but local quality detectors
  // fire (repetition loops, underlength), force a no-critique redraft with
  // the same BeatContext. No V1 prose, no critique — pure re-sampling.
  // Motivated by the 2026-04-21 rewrite-capability-probe result: critique-
  // based rewrites were weak, while clean redrafts could recover. Default
  // off; enable per-novel via `seed.pipelineOverrides`
  // (written by the `--quality-redraft` CLI flag or the orchestrator's
  // novel-creation endpoint). Env-var wiring removed 2026-04-21 — a
  // module-load-time process.env read couldn't be scoped per-novel under
  // the orchestrator service, so a measurement run could silently flip the
  // flag for every subsequent novel.
  qualityRedraftEnabled: false,
  qualityRedraftMinWords: 100,  // underlength threshold for the detector

  // Phase 7 proposal persistence hook. When true, deterministic lint issues
  // are persisted as prose_edit proposal envelopes after the draft is saved,
  // and the inline lint auto-fix path is skipped for that chapter. Default
  // off until an evaluation/scheduler lane explicitly opts into
  // review-before-apply.
  lintProseEditProposals: false,

  // Style lint auto-fix is default-off. Lint detection still records
  // deterministic telemetry, but automatic prose rewriting is opt-in because
  // recent production runs showed paid style repairs can introduce fused
  // sentence boundaries or quote-integrity defects. Deterministic prose
  // integrity repair/checks below remain active regardless of this flag.
  lintAutoFixEnabled: false,

  // Phase 7 proposal persistence hook. When true, run the existing
  // validator-backed editorial beat-coverage producer after a chapter draft
  // has settled and persist uncovered beats as editorial_flag envelopes.
  // Default off because this adds an LLM checker call per drafted chapter.
  editorialBeatCoverageProposals: false,

  // Phase 7 proposal persistence hook. When true, fact-scoped continuity
  // blocker findings become nonblocking editorial_flag envelopes after the
  // chapter draft has settled. No extra LLM calls; default off to avoid
  // review-queue noise until a lane deliberately enables it.
  continuityEditorialFlagProposals: false,

  // Diagnostic/A-B gate for fact-role-aware context. Default legacy preserves
  // all loaded facts. Per-novel `role-aware` drops hidden facts from writer
  // context and sends only operational facts to continuity blocking checks.
  factRoleContextPolicy: "legacy" as FactRoleContextPolicy,

  // Production writer-context mode. Default-on because fixed-plan POC evidence
  // showed exact-ID character capsules improved scene expansion and reduced
  // floor warnings without adding semantic/prose regressions. Override to
  // "legacy" per seed when isolating old prompt shape.
  writerContextMode: DEFAULT_WRITER_CONTEXT_MODE as WriterContextMode,

  // L099 / adjusted-B1: writer-prompt ID rendering ablation lever. Default
  // "raw" preserves the production prompt byte-for-byte. Override to
  // "suppress" per novel via `seed.pipelineOverrides.writerPromptIdRendering`
  // to omit Cluster-1 raw-ID lines from the prose-writer prompt
  // (Chapter/Beat/POV-character IDs, Active thread/promise/payoff refs,
  // Missing character IDs, per-card [characterId] brackets, per-card
  // Source obligations / Active threads/promises/payoffs). Trace metadata
  // and `summarizeCharacterContextCapsules` are unaffected — IDs remain
  // mandatory in DB / telemetry / traces / checker findings / proposals /
  // evals / audit per L099.
  writerPromptIdRendering: DEFAULT_WRITER_PROMPT_ID_RENDERING as WriterPromptIdRendering,

  // L106 production-path integration: compact writer-facing drafting brief
  // rendered from the production BeatContext slots. Default off preserves the
  // full existing writer prompt. Override per novel to a default-off
  // writer-brief mode to test production brief paths with telemetry.
  writerDraftingBriefMode: "off" as WriterDraftingBriefMode,

  // Default-off production context/eval lever. When set per novel to "v1",
  // drafting compiles compact story/character/relationship/voice authoring
  // bible rules from existing world/story/character surfaces, renders a
  // scene-specific slice into writer context, and records rule IDs in
  // writer-context telemetry. Advisory review uses binary gates, not model
  // confidence scores.
  authoringBibleMode: "off" as AuthoringBibleMode,

  // Modular authoring-bible pack IDs layered into authoringBibleMode=v1.
  // Empty by default so production prompt shape remains unchanged until a
  // novel/arm deliberately selects a pack.
  authoringBiblePackIds: [] as string[],

  // Diagnostic/A-B planning shape lever. Default null leaves planner behavior
  // unchanged. Per-novel overrides cap generated planning scene entries before
  // state mapping, but the effective cap never drops below the calibrated floor
  // for the chapter target.
  planningMaxScenesPerChapter: null as number | null,

  // Production upstream planning-shape default. Planning prompts ask for
  // native story-turn beats at calibrated granularity and enforcement
  // retries/rejects over-fragmented plans instead of slicing or post-hoc
  // packing them. Override per seed with nativePlanningContractV1=false for
  // legacy comparisons or rollback.
  nativePlanningContractV1: true,

  // Default-off production planning control for selective scene-turn shaping.
  // When enabled, the planner may populate only the optional scene-contract
  // fields that make a load-bearing entry more writable: endpoint
  // outcome/consequence, protagonist pressure, opposition, and world/character
  // constraints. Unlike scenePlanContractV1, this does not require full
  // crisis-choice scaffolding and does not change enforcement defaults.
  planningSceneTurnShapingV1: false,

  // Default-off production planning/context control for material pressure.
  // When enabled, existing source-refed non-final obligations get compact
  // materiality pressure notes for the writer. This does not add obligations
  // or change scene-contract validation; it only makes already-selected
  // character/world/fact pressure operational in the drafting brief.
  planningMaterialPressureV1: false,

  // L095 Slice 0: scene-contract substrate flag. Default off — Slice 0 only
  // adds optional schema fields, the `enforceScenePlanContract` helper, and
  // this resolver. No prompt or behavior change. Slice 1 wires the
  // `causal-motivation-v3` prompt and enforcement under this flag; later
  // slices flip the default to true after evidence gates clear.
  scenePlanContractV1: false,

  // L097 Slice 2: scene-call writer architecture flag. Default off. When on,
  // the writer uses the scene-call path; L110 separately renders populated
  // scene-contract fields on the legacy writer without this flag.
  sceneCallWriterV1: false,

  // L110: render the SCENE CONTRACT block on the production legacy
  // writer whenever the planner populated scene-contract fields. This does
  // NOT enable sceneCallWriterV1, expansion retries, or deterministic field
  // population; entries with no scene-contract fields still render no block.
  // Per-novel overrides can set false for legacy no-contract comparisons.
  forceRenderSceneContractWhenAvailable: true,

  // adjusted-B1/B3 experiment lane: draft-capture mode. Default off.
  // When on, after the writer assembles each chapter's prose, drafting
  // saves+approves the draft and SKIPS the post-writer settle loops
  // (chapter-plan-checker, continuity, validation, halluc-ungrounded
  // routing, integrity reviser, validation reviser, plan-check beat
  // rewrites). The writer's own per-scene retries inside its checker
  // budget are unaffected; only the chapter-level settle loops are
  // skipped. This exists because writer-arm A/B comparisons should
  // collect prose evidence even when checker/API hangs would otherwise
  // block one arm. Diagnostics can be run post-hoc on the saved drafts
  // (chapter_drafts row + llm_calls + writer-context trace events all
  // persist normally). Production runtime stays default-off — no
  // default behaviour changes.
  draftCaptureModeV1: false,

  // L097 Slice 2: writer expansion mode. "off" = legacy behaviour (writer
  // is called once per entry, retries only on checker failure).
  // "retry-short-scenes-v1" = under sceneCallWriterV1, after the per-entry
  // writer call completes, run up to 3 expansion retries when the produced
  // word count is below the advisory floor (70% of target, min 120w).
  // Best-attempt retention: the highest-word-count attempt is kept even
  // if the final attempt undershoots. Word count remains advisory; the
  // expansion path adds attempts but never converts word count into a hard
  // gate.
  writerExpansionMode: "off" as "off" | "retry-short-scenes-v1",

  // L098 Slice 3: reserved scene-satisfaction checker flag. Default off.
  // Current production runtime does not consume this flag yet; shipped code
  // only adds the additive `obligationIds` finding surface and deterministic
  // obligation-aware routing helpers. Scene-satisfaction LLM judging lives in
  // replay-only diagnostic scripts until parity evidence supports a separate
  // promotion decision.
  sceneSatisfactionCheckerV1: false,

  // Scene entity-grounding posture for the writer retry loop.
  // "off" removes the costly/noisy halluc-ungrounded LLM checker from default
  // scene retries. The writer still receives deterministic ID/context surfaces;
  // plan/adherence checks remain active. Use "llm-blocking" only for deliberate
  // calibration or regression runs where high-recall entity policing is worth
  // the false-positive and retry cost.
  sceneEntityGroundingMode: "off" as "off" | "llm-blocking",

  // State management
  embeddings: false,          // skip embedding step (scene path uses deterministic DB lookups)

  // Halluc-ungrounded multi-call vote/union (L68 / Grounding Lever G-D).
  // When sceneEntityGroundingMode="llm-blocking" and this is >1, runSceneChecks
  // issues N parallel halluc-ungrounded LLM calls per scene entry and unions
  // their LLM-confirmed flagged entities before the L40 grounded-surface filter
  // and AND-gate assembly. Addresses checker
  // stochasticity surfaced by exp #389+#395 trace (same byte-identical prose
  // produced disjoint flagged-entity sets across 3 calls).
  // Resolves at module load time from `HALLUC_UNGROUNDED_VOTE_N` env, falling
  // back to 1 (= legacy single-call behavior). Read at module-load (not
  // call-time) so a process that boots with N=2 keeps that setting consistent
  // throughout its run, and so unit tests can pin a value via the opts param
  // without competing with env state.
  hallucVoteN: (() => {
    const raw = process.env.HALLUC_UNGROUNDED_VOTE_N
    if (raw == null) return 1
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed < 1) return 1
    return parsed
  })(),

  // Word targets (used as defaults if plotter doesn't specify)
  defaultTargetWords: 1000,
  minWords: 500,
}

export function resolveNativePlanningContractV1(
  overrides: { nativePlanningContractV1?: boolean } | undefined,
): boolean {
  return overrides?.nativePlanningContractV1 ?? pipeline.nativePlanningContractV1
}

export function resolvePlanningSceneTurnShapingV1(
  overrides: { planningSceneTurnShapingV1?: boolean } | undefined,
): boolean {
  return overrides?.planningSceneTurnShapingV1 ?? pipeline.planningSceneTurnShapingV1
}

export function resolvePlanningMaterialPressureV1(
  overrides: { planningMaterialPressureV1?: boolean } | undefined,
): boolean {
  return overrides?.planningMaterialPressureV1 ?? pipeline.planningMaterialPressureV1
}

export function resolveScenePlanContractV1(
  overrides: { scenePlanContractV1?: boolean } | undefined,
): boolean {
  return overrides?.scenePlanContractV1 ?? pipeline.scenePlanContractV1
}

export function resolveSceneCallWriterV1(
  overrides: { sceneCallWriterV1?: boolean } | undefined,
): boolean {
  return overrides?.sceneCallWriterV1 ?? pipeline.sceneCallWriterV1
}

export function resolveForceRenderSceneContractWhenAvailable(
  overrides: { forceRenderSceneContractWhenAvailable?: boolean } | undefined,
): boolean {
  return overrides?.forceRenderSceneContractWhenAvailable ?? pipeline.forceRenderSceneContractWhenAvailable
}

export function resolveDraftCaptureModeV1(
  overrides: { draftCaptureModeV1?: boolean } | undefined,
): boolean {
  return overrides?.draftCaptureModeV1 ?? pipeline.draftCaptureModeV1
}

export function resolveLintAutoFixEnabled(
  overrides: { lintAutoFixEnabled?: boolean } | undefined,
): boolean {
  return overrides?.lintAutoFixEnabled ?? pipeline.lintAutoFixEnabled
}

export function resolveWriterExpansionMode(
  overrides: { writerExpansionMode?: "off" | "retry-short-scenes-v1" } | undefined,
): "off" | "retry-short-scenes-v1" {
  return overrides?.writerExpansionMode ?? pipeline.writerExpansionMode
}

export function resolveSceneSatisfactionCheckerV1(
  overrides: { sceneSatisfactionCheckerV1?: boolean } | undefined,
): boolean {
  return overrides?.sceneSatisfactionCheckerV1 ?? pipeline.sceneSatisfactionCheckerV1
}

export function resolveSceneEntityGroundingMode(
  overrides: { sceneEntityGroundingMode?: "off" | "llm-blocking" } | undefined,
): "off" | "llm-blocking" {
  return overrides?.sceneEntityGroundingMode ?? pipeline.sceneEntityGroundingMode
}

export function resolveWriterPromptIdRendering(
  overrides: { writerPromptIdRendering?: WriterPromptIdRendering } | undefined,
): WriterPromptIdRendering {
  return overrides?.writerPromptIdRendering ?? pipeline.writerPromptIdRendering
}

export function resolveWriterDraftingBriefMode(
  overrides: { writerDraftingBriefMode?: WriterDraftingBriefMode } | undefined,
): WriterDraftingBriefMode {
  return overrides?.writerDraftingBriefMode ?? pipeline.writerDraftingBriefMode
}

export function resolveAuthoringBibleMode(
  overrides: { authoringBibleMode?: AuthoringBibleMode } | undefined,
): AuthoringBibleMode {
  return overrides?.authoringBibleMode ?? pipeline.authoringBibleMode
}

export function resolveAuthoringBiblePackIds(
  overrides: { authoringBiblePackIds?: string[] } | undefined,
): string[] {
  return overrides?.authoringBiblePackIds ?? pipeline.authoringBiblePackIds
}
