export { initDB } from "./connection"
export { createNovel, getNovel, updatePhase, updateCurrentChapter, updateTotalChapters } from "./novels"
export {
  saveWorldBible, getWorldBible, saveCharacter, getCharacters, saveStorySpine, getStorySpine,
  updateCharacterFields, updateWorldBibleFields, updateStorySpineFields,
} from "./world"
export { saveChapterOutline, getChapterOutline, getChapterOutlines } from "./outlines"
export {
  saveChapterDraft, approveChapterDraft, getApprovedDraft, unapproveChapterDraft, deleteChapterDrafts,
  saveTonalPassDraft, getTonalPassDraft, deleteTonalPassDrafts,
} from "./drafts"
export { saveChapterSummary, getRecentSummaries } from "./summaries"
export { saveFact, getFactsUpToChapter, getFactsForChapter, clearFactsForChapter } from "./facts"
export { saveCharacterState, getCharacterStatesAtChapter, getAllCharacterStatesBeforeChapter, clearCharacterStatesForChapter } from "./character-states"
export { saveIssue, getOpenIssues, resolveIssuesForChapter } from "./issues"
export { saveValidationPass, getValidationAttempts } from "./validation-passes"
export {
  saveWorldSystem, getWorldSystems, getWorldSystem,
  saveCulture, getCultures, getCulture,
  saveCharacterCulture, getCharacterCultures,
  saveCharacterSystemAwareness, getCharacterSystemAwareness,
} from "./world-systems"
export type { WorldSystem, Culture, CharacterCulture, CharacterSystemAwareness } from "./world-systems"
export {
  saveRelationshipState, getRelationshipStatesAtChapter, getRelationshipBetween,
  getRelationshipArc, clearRelationshipStatesForChapter,
} from "./relationships"
export type { RelationshipState } from "./relationships"
export {
  saveTimelineEvent, getTimelineEventsUpToChapter, getTimelineEventsForChapter,
  getRecentEventsForCharacters, getEventsAtLocation, clearTimelineEventsForChapter,
} from "./timeline"
export type { TimelineEvent } from "./timeline"
export {
  saveCharacterKnowledge, getCharacterKnowledgeUpToChapter, getKnowledgeForChapter,
  searchCharacterKnowledge, clearKnowledgeForChapter,
} from "./knowledge"
export type { CharacterKnowledgeEntry } from "./knowledge"
