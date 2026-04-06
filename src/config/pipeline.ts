export const pipeline = {
  // Drafting
  maxDraftAttempts: 3,
  beatLevelWriting: false,    // use beat-level context + generation
  maxBeatRetries: 2,          // retries per beat on adherence failure

  // Validation
  maxValidationPasses: 3,
  maxChapterRewrites: 3,

  // Word targets (used as defaults if plotter doesn't specify)
  defaultTargetWords: 1000,
  minWords: 500,
}
