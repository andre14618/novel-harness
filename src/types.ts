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
    lintProseEditProposals?: boolean
    editorialBeatCoverageProposals?: boolean
    continuityEditorialFlagProposals?: boolean
    factRoleContextPolicy?: import("./harness/fact-roles").FactRoleContextPolicy
    writerContextMode?: import("./agents/writer/context-mode").WriterContextMode
    planningMaxBeatsPerChapter?: number | null
    nativePlanningContractV1?: boolean
  }
}

// ── Stored types (DB rows) ─────────────────────────────────────────────────

/**
 * How a fact participates in writing and checking, independent of its
 * `category` shape tag. See `sql/049_world_fact_roles.sql`.
 *
 * - `operational` — enforced by the checker, visible to the writer. Default.
 * - `reference`   — background info, advisory only; no continuity blockers.
 * - `hidden`      — exists in canon but never appears in writer context.
 */
export type FactRole = "operational" | "reference" | "hidden"

export interface Fact {
  id: string
  fact: string
  category: string
  establishedInChapter: number
  role: FactRole
}

/** Insert shape: callers may omit `role`; the DB defaults to `operational`. */
export type FactInput = Omit<Fact, "id" | "role"> & { role?: FactRole }

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

export interface ValidationFinding {
  severity: "blocker" | "warning"
  code: string
  description: string
  chapterNumber?: number
  chapterId?: string
  beatIndex?: number
  beatId?: string
  metadata?: Record<string, unknown>
}

export interface ValidationResult {
  passed: boolean
  blockers: string[]
  warnings: string[]
  findings?: ValidationFinding[]
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
