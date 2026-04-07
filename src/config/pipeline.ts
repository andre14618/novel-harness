export const pipeline = {
  // Drafting
  maxDraftAttempts: 3,
  beatLevelWriting: true,     // use beat-level context + generation
  maxBeatRetries: 2,          // retries per beat on adherence failure
  chapterPlanCheck: true,     // validate assembled prose against chapter plan

  // Validation
  maxValidationPasses: 3,
  maxChapterRewrites: 3,
  tonalPass: false,           // enable after LoRA model is deployed

  // State management
  embeddings: false,          // skip embedding step (beat path uses deterministic DB lookups)
  extractionMode: "both" as "plan" | "extract" | "both",  // plan=planner state, extract=LLM extractors, both=verify

  // Word targets (used as defaults if plotter doesn't specify)
  defaultTargetWords: 1000,
  minWords: 500,
}
