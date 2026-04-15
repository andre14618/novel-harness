export const pipeline = {
  // Drafting
  maxDraftAttempts: 3,
  maxPhaseRestarts: 2,        // outer cap: how many times the state machine may re-dispatch a phase that returned without making progress (3 inner attempts × 3 total invocations = 9 total writer attempts per chapter)
  beatLevelWriting: true,     // use beat-level context + generation
  maxBeatRetries: 2,          // retries per beat on adherence failure
  chapterPlanCheck: true,     // validate assembled prose against chapter plan

  // Validation
  maxValidationPasses: 3,
  maxChapterRewrites: 3,
  tonalPass: true,            // W&B howard-tonal-v4-sft-resume:v8 (pref-eval confirmed 2026-04-11)

  // State management
  embeddings: false,          // skip embedding step (beat path uses deterministic DB lookups)

  // Word targets (used as defaults if plotter doesn't specify)
  defaultTargetWords: 1000,
  minWords: 500,
}
