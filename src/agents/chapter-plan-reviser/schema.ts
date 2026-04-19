// Reuse the planning-beats output schema verbatim — the reviser produces
// the same shape so drafting.ts can drop it straight back into outline.scenes.
export { chapterBeatsSchema, chapterBeatsSchema as schema, type ChapterBeats } from "../planning-beats/schema"
