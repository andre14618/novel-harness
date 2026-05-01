// ── Phase ──────────────────────────────────────────────────────────────────

export type Phase = "concept" | "planning" | "drafting" | "validation" | "done"

// ── Seed Input (collected from user) ───────────────────────────────────────

export interface CharacterSketch {
  name: string
  role: "protagonist" | "antagonist" | "supporting"
  description: string
}

export interface SeedInput {
  premise: string
  genre: string
  characters: CharacterSketch[]
  chapterCount?: number
  directives?: import("./schemas/planning-directives").PlanningDirectives
  /**
   * Per-novel pipeline overrides. Scope knobs that today leak process-wide
   * via env vars (e.g. QUALITY_REDRAFT_ENABLED) belong here so the
   * orchestrator can run two novels with different settings concurrently.
   */
  pipelineOverrides?: {
    qualityRedraftEnabled?: boolean
    qualityRedraftMinWords?: number
  }
}

// ── Stored types (DB rows) ─────────────────────────────────────────────────

export interface Fact {
  id: string
  fact: string
  category: string
  establishedInChapter: number
}

export interface CharacterState {
  characterId: string
  chapterNumber: number
  location: string
  emotionalState: string
  knows: string[]
  doesNotKnow: string[]
}

export interface ChapterSummary {
  chapterNumber: number
  summary: string
  keyEvents: string[]
  emotionalState: string
  openThreads: string[]
}

// ── Novel State (top-level) ────────────────────────────────────────────────

export interface NovelState {
  id: string
  phase: Phase
  seed: SeedInput
  currentChapter: number
  totalChapters: number
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  passed: boolean
  blockers: string[]
  warnings: string[]
}

// ── Backward compatibility — re-export schemas from agent directories ──────

export { locationSchema } from "./schemas/shared"
export { relationshipSchema, actSchema, sceneBeatSchema, continuityIssueSchema } from "./schemas/shared"
export type { BeatObligationsContract, SceneBeat, ContinuityIssue } from "./schemas/shared"

export { worldBibleSchema, type WorldBible } from "./agents/world-builder/schema"
export { characterProfileSchema, characterProfilesSchema, type CharacterProfile } from "./agents/character-agent/schema"
export { storySpineSchema, type StorySpine } from "./agents/plotter/schema"
export { chapterOutlineSchema, chapterOutlinesSchema, type ChapterOutline } from "./agents/planning-plotter/schema"
export { chapterDraftSchema } from "./agents/writer/schema"
// rewriterOutputSchema removed 2026-04-17
