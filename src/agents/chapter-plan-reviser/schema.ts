// Reuse the planning-scenes output schema verbatim — the reviser produces
// the same shape so drafting.ts can drop it straight back into outline.scenes.
export { chapterScenePlanSchema, chapterScenePlanSchema as schema, type ChapterScenePlan } from "../planning-scenes/schema"
