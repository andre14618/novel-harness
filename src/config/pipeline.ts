import type { FactRoleContextPolicy } from "../harness/fact-roles"
import { DEFAULT_WRITER_CONTEXT_MODE, type WriterContextMode } from "../agents/writer/context-mode"

export const pipeline = {
  // Drafting
  maxDraftAttempts: 3,
  beatLevelWriting: true,     // use beat-level context + generation
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
  // and the legacy inline lint-fix apply path is skipped for that chapter.
  // Default off so existing drafting behavior is unchanged until an
  // evaluation/scheduler lane explicitly opts into review-before-apply.
  lintProseEditProposals: false,

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

  // Diagnostic/A-B planning shape lever. Default null leaves planner behavior
  // unchanged. Per-novel overrides cap generated planning beats before state
  // mapping, but the effective cap never drops below the calibrated floor for
  // the chapter target.
  planningMaxBeatsPerChapter: null as number | null,

  // Production upstream planning-shape default. Planning prompts ask for
  // native story-turn beats at calibrated granularity and enforcement
  // retries/rejects over-fragmented plans instead of slicing or post-hoc
  // packing them. Override per seed with nativePlanningContractV1=false for
  // legacy comparisons or rollback.
  nativePlanningContractV1: true,

  // State management
  embeddings: false,          // skip embedding step (beat path uses deterministic DB lookups)

  // Halluc-ungrounded multi-call vote/union (L68 / Grounding Lever G-D).
  // When >1, runBeatChecks issues N parallel halluc-ungrounded LLM calls per
  // beat and unions their LLM-confirmed flagged entities before the L40
  // grounded-surface filter and AND-gate assembly. Addresses checker
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
