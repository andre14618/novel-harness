export const pipeline = {
  // Drafting
  maxDraftAttempts: 3,
  maxPhaseRestarts: 2,        // outer cap: how many times the state machine may re-dispatch a phase that returned without making progress (3 inner attempts × 3 total invocations = 9 total writer attempts per chapter)
  beatLevelWriting: true,     // use beat-level context + generation
  maxBeatRetries: 2,          // retries per beat on adherence failure
  chapterPlanCheck: true,     // validate assembled prose against chapter plan
  maxChapterPlanRewritePasses: 2, // when chapter-plan-checker fails, rewrite affected beats in place up to N times before escalating to full chapter restart

  // Validation
  maxValidationPasses: 3,
  maxChapterRewrites: 3,
  tonalPass: false,           // Auto-run disabled. Howard primer/tonal-pass methodology retired 2026-04-16; voice now lands at generation time via per-genre voice LoRAs (see WRITER_GENRE_PACKS). On-demand /api/novel/:id/tonal-pass route still works for existing novels.

  // Quality redraft — when existing checkers pass but local quality detectors
  // fire (repetition loops, underlength), force a no-critique redraft with
  // the same BeatContext. No V1 prose, no critique — pure re-sampling.
  // Motivated by the 2026-04-21 rewrite-capability-probe result: the writer
  // LoRA doesn't meaningfully rewrite V1+critique, but it CAN redraft from
  // scratch. Default off; enable per-novel via `seed.pipelineOverrides`
  // (written by the `--quality-redraft` CLI flag or the orchestrator's
  // novel-creation endpoint). Env-var wiring removed 2026-04-21 — a
  // module-load-time process.env read couldn't be scoped per-novel under
  // the orchestrator service, so a measurement run could silently flip the
  // flag for every subsequent novel.
  qualityRedraftEnabled: false,
  qualityRedraftMinWords: 100,  // underlength threshold for the detector

  // State management
  embeddings: false,          // skip embedding step (beat path uses deterministic DB lookups)

  // Word targets (used as defaults if plotter doesn't specify)
  defaultTargetWords: 1000,
  minWords: 500,
}
