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
    /**
     * Default-off upstream planning control. When on, the planner may add
     * selective scene-turn fields to load-bearing entries without enabling
     * the full scenePlanContractV1 contract or blocking validator.
     */
    planningSceneTurnShapingV1?: boolean
    /**
     * L095 Slice 0: scene-contract substrate flag. Default-off in Slice 0.
     * Slice 1 wires the `causal-motivation-v3` planner prompt and
     * `enforceScenePlanContract` under this flag.
     */
    scenePlanContractV1?: boolean
    /**
     * L097 Slice 2: scene-call writer rendering flag. Default-off. When on,
     * the writer prompt surfaces scene-contract fields per entry.
     */
    sceneCallWriterV1?: boolean
    /**
     * adjusted-B3 Arm B preparation: render the SCENE CONTRACT block when
     * the planner has populated scene-contract fields, without enabling
     * scene-call writer mode. Default-off. Works with the legacy
     * beat-shaped writer call unit. Has no effect when no scene-contract
     * field is set on the entry, and is redundant when
     * sceneCallWriterV1=true.
     */
    forceRenderSceneContractWhenAvailable?: boolean
    /**
     * adjusted-B1/B3 experiment lane: draft-capture mode. Default-off.
     * When on, drafting saves + approves each chapter immediately after
     * the writer assembles its prose, skipping the chapter-level
     * checker settle loops (plan check, continuity, validation,
     * halluc-ungrounded routing, integrity reviser, validation
     * reviser, plan-check beat rewrites). Used by writer-arm A/B
     * runners that need to collect prose evidence even when checker
     * APIs hang. Production runtime stays default-off.
     */
    draftCaptureModeV1?: boolean
    /**
     * L097 Slice 2: writer expansion mode. "off" preserves legacy
     * single-call-per-entry retry behaviour. "retry-short-scenes-v1" adds
     * expansion retries when word count is below the advisory floor.
     */
    writerExpansionMode?: "off" | "retry-short-scenes-v1"
    /**
     * L098 Slice 3: reserved scene-satisfaction checker flag. Default-off.
     * Production does not currently switch the inline checker prompt with
     * this flag; replay diagnostics use the scene-satisfaction shape while
     * runtime routing accepts optional `obligationIds`.
     */
    sceneSatisfactionCheckerV1?: boolean
    /**
     * L099 / adjusted-B1: writer-prompt ID rendering ablation lever.
     * Default "raw" preserves production prompt byte-for-byte. Override to
     * "suppress" per novel to omit Cluster-1 raw-ID lines from the prose-
     * writer prompt only. Trace metadata, DB rows, checker findings, and
     * audit logs continue to carry every ID.
     */
    writerPromptIdRendering?: import("./agents/writer/context-mode").WriterPromptIdRendering
    /**
     * L106 production-path integration: optional compact writer-facing
     * drafting brief rendered from production writer context slots. Default
     * "off" preserves the full existing writer prompt.
     */
    writerDraftingBriefMode?: import("./agents/writer/drafting-brief").WriterDraftingBriefMode
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
  sceneId?: string
  beatId?: string
  /**
   * L098 Slice 3: scene-keyed routing reference. When a finding originates
   * from a scene-satisfaction LLM checker (sceneSatisfactionCheckerV1) or
   * any future obligation-aware checker, populate this with the exact
   * obligation IDs the finding refers to. validation-routing prefers
   * obligation-ID lookup over the legacy beat-0 fallback when this is
   * present and `beatIndex` is undefined.
   */
  obligationIds?: string[]
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
