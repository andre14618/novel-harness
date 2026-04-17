// Backward compatibility — re-export prompts from agent directories
export { prompt as WORLD_BUILDER_PROMPT } from "./agents/world-builder"
export { prompt as CHARACTER_AGENT_PROMPT } from "./agents/character-agent"
export { prompt as PLOTTER_AGENT_PROMPT } from "./agents/plotter"
export { prompt as PLANNING_PLOTTER_PROMPT } from "./agents/planning-plotter"
export { prompt as WRITER_AGENT_PROMPT, beatPrompt as BEAT_WRITER_PROMPT } from "./agents/writer"
// REWRITER_AGENT_PROMPT removed 2026-04-17
export { prompt as CHAPTER_PLAN_CHECKER_PROMPT } from "./agents/chapter-plan-checker"
