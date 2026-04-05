/**
 * Component registry — every tunable surface in the pipeline.
 *
 * Single source of truth for what the autoresearcher CAN adjust.
 * The autoresearcher reads this to understand the full surface area,
 * picks ONE component to change per iteration, and measures the effect
 * via the listed benchmark dimensions.
 *
 * UI reads this to show all tunable parameters in one place.
 * API reads this to validate autoresearcher proposals.
 */

export type ComponentType = "number" | "prompt" | "model" | "template"
export type StorageType = "retrieval_config" | "deterministic_config" | "file" | "roles"

export interface Component {
  /** Unique identifier used by the autoresearcher */
  id: string
  /** Human-readable name */
  name: string
  /** What this controls and why it matters */
  description: string
  /** Data type */
  type: ComponentType
  /** Where the value lives */
  storage: StorageType
  /** For file-based: path relative to HARNESS_ROOT */
  path?: string
  /** For DB-based: table and column */
  table?: string
  column?: string
  /** For number types: valid range */
  min?: number
  max?: number
  step?: number
  /** Which benchmark dimensions measure this component's impact */
  measuredBy: string[]
  /** Category for UI grouping */
  category: "retrieval" | "deterministic" | "agent-prompt" | "model" | "embedding" | "context-format"
}

// ── Registry ──────────────────────────────────────────────────────────────

export const COMPONENTS: Component[] = [
  // ── Retrieval parameters ──────────────────────────────────────────────
  {
    id: "retrieval.max_facts", name: "Max Facts",
    description: "Maximum facts retrieved per scene via hybrid search",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "max_facts",
    min: 5, max: 100, step: 5,
    measuredBy: ["context-relevance", "context-completeness", "context-noise"],
    category: "retrieval",
  },
  {
    id: "retrieval.max_events", name: "Max Events",
    description: "Maximum timeline events retrieved per scene",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "max_events",
    min: 5, max: 50, step: 5,
    measuredBy: ["context-relevance", "context-completeness", "context-causal-depth"],
    category: "retrieval",
  },
  {
    id: "retrieval.max_summaries", name: "Max Summaries",
    description: "Maximum chapter summaries retrieved per scene",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "max_summaries",
    min: 2, max: 20, step: 1,
    measuredBy: ["context-completeness"],
    category: "retrieval",
  },
  {
    id: "retrieval.max_knowledge", name: "Max Knowledge",
    description: "Maximum character knowledge entries retrieved per scene",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "max_knowledge",
    min: 5, max: 50, step: 5,
    measuredBy: ["context-knowledge-accuracy", "context-completeness"],
    category: "retrieval",
  },
  {
    id: "retrieval.min_similarity", name: "Min Similarity",
    description: "Cosine similarity floor — results below this are filtered out",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "min_similarity",
    min: 0.05, max: 0.6, step: 0.05,
    measuredBy: ["context-relevance", "context-noise"],
    category: "retrieval",
  },
  {
    id: "retrieval.rrf_k", name: "RRF K",
    description: "Reciprocal Rank Fusion constant — higher values flatten ranking differences",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "rrf_k",
    min: 10, max: 120, step: 10,
    measuredBy: ["context-relevance", "context-completeness"],
    category: "retrieval",
  },
  {
    id: "retrieval.character_boost", name: "Character Boost",
    description: "Score multiplier for results mentioning characters present in the scene",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "character_boost",
    min: 1.0, max: 4.0, step: 0.25,
    measuredBy: ["context-relevance", "context-noise"],
    category: "retrieval",
  },
  {
    id: "retrieval.location_boost", name: "Location Boost",
    description: "Score multiplier for results matching the scene's location",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "location_boost",
    min: 1.0, max: 4.0, step: 0.25,
    measuredBy: ["context-relevance"],
    category: "retrieval",
  },
  {
    id: "retrieval.recency_half_life", name: "Recency Half-Life",
    description: "Chapters until recency bonus halves — lower values favor recent data",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "recency_half_life",
    min: 3, max: 30, step: 1,
    measuredBy: ["context-relevance", "context-completeness"],
    category: "retrieval",
  },

  // ── Deterministic heuristic parameters ────────────────────────────────
  {
    id: "deterministic.theme_auto_threshold", name: "Theme Auto-Accept Threshold",
    description: "Embedding similarity above this → theme auto-tagged without LLM",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "theme_auto_threshold",
    min: 0.3, max: 0.8, step: 0.05,
    measuredBy: ["context-relevance", "context-noise"],
    category: "deterministic",
  },
  {
    id: "deterministic.theme_candidate_threshold", name: "Theme Candidate Threshold",
    description: "Embedding similarity above this → sent to LLM for validation",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "theme_candidate_threshold",
    min: 0.1, max: 0.5, step: 0.05,
    measuredBy: ["context-relevance"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_participant_weight", name: "Causal: Participant Weight",
    description: "How much shared participants between events contributes to causal link score",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_participant_weight",
    min: 0, max: 1, step: 0.05,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_location_weight", name: "Causal: Location Weight",
    description: "How much same-location contributes to causal link score",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_location_weight",
    min: 0, max: 1, step: 0.05,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_temporal_weight", name: "Causal: Temporal Weight",
    description: "How much chapter proximity contributes to causal link score",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_temporal_weight",
    min: 0, max: 1, step: 0.05,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_consequence_weight", name: "Causal: Consequence Weight",
    description: "How much consequence keyword overlap contributes to causal link score",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_consequence_weight",
    min: 0, max: 1, step: 0.05,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_auto_threshold", name: "Causal Auto-Accept Threshold",
    description: "Causal score above this → auto-accepted without LLM",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_auto_threshold",
    min: 0.5, max: 1.0, step: 0.05,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_candidate_threshold", name: "Causal Candidate Threshold",
    description: "Causal score above this → sent to LLM for validation",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_candidate_threshold",
    min: 0.2, max: 0.8, step: 0.05,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },

  // ── Agent prompts ─────────────────────────────────────────────────────
  {
    id: "prompt.writer", name: "Writer Prompt",
    description: "System prompt for the prose writer agent",
    type: "prompt", storage: "file", path: "src/agents/writer/prompt.md",
    measuredBy: ["prose-craft", "character-voice", "telling", "dead-weight", "dialogue-problems"],
    category: "agent-prompt",
  },
  {
    id: "prompt.planning-plotter", name: "Planning Plotter Prompt",
    description: "System prompt for chapter outline generation",
    type: "prompt", storage: "file", path: "src/agents/planning-plotter/prompt.md",
    measuredBy: ["beat-specificity", "dialogue-cues", "emotional-arc"],
    category: "agent-prompt",
  },
  {
    id: "prompt.graph-linker", name: "Graph Linker Prompt",
    description: "System prompt for causal chain and knowledge propagation identification",
    type: "prompt", storage: "file", path: "src/agents/graph-linker/prompt.md",
    measuredBy: ["context-causal-depth", "context-knowledge-accuracy"],
    category: "agent-prompt",
  },
  {
    id: "prompt.fact-extractor", name: "Fact Extractor Prompt",
    description: "System prompt for extracting facts from prose",
    type: "prompt", storage: "file", path: "src/agents/fact-extractor/prompt.md",
    measuredBy: ["extraction-completeness", "extraction-accuracy", "context-completeness"],
    category: "agent-prompt",
  },
  {
    id: "prompt.summary-extractor", name: "Summary Extractor Prompt",
    description: "System prompt for chapter summarization",
    type: "prompt", storage: "file", path: "src/agents/summary-extractor/prompt.md",
    measuredBy: ["extraction-completeness", "context-completeness"],
    category: "agent-prompt",
  },
  {
    id: "prompt.relationship-timeline", name: "Relationship Timeline Prompt",
    description: "System prompt for extracting relationships, events, knowledge, awareness",
    type: "prompt", storage: "file", path: "src/agents/relationship-timeline/prompt.md",
    measuredBy: ["extraction-completeness", "context-knowledge-accuracy", "context-causal-depth"],
    category: "agent-prompt",
  },
  {
    id: "prompt.rewriter", name: "Rewriter Prompt",
    description: "System prompt for fixing prose issues",
    type: "prompt", storage: "file", path: "src/agents/rewriter/prompt.md",
    measuredBy: ["prose-craft", "telling"],
    category: "agent-prompt",
  },

  // ── Model assignments ─────────────────────────────────────────────────
  {
    id: "model.writer", name: "Writer Model",
    description: "LLM model used for prose generation",
    type: "model", storage: "roles",
    measuredBy: ["prose-craft", "character-voice"],
    category: "model",
  },
  {
    id: "model.graph-linker", name: "Graph Linker Model",
    description: "LLM model used for graph linking (judgment calls only)",
    type: "model", storage: "roles",
    measuredBy: ["context-causal-depth", "context-knowledge-accuracy"],
    category: "model",
  },
  {
    id: "model.benchmark-judge", name: "Benchmark Judge Model",
    description: "LLM model used for scoring benchmark dimensions",
    type: "model", storage: "roles",
    measuredBy: [], // meta — judges measure everything else
    category: "model",
  },

  // ── Embedding templates ───────────────────────────────────────────────
  {
    id: "embed.fact_template", name: "Fact Embedding Template",
    description: "Text format used when embedding facts — affects retrieval recall",
    type: "template", storage: "file", path: "src/db/embed.ts",
    measuredBy: ["context-relevance", "context-completeness"],
    category: "embedding",
  },
  {
    id: "embed.event_template", name: "Event Embedding Template",
    description: "Text format used when embedding timeline events",
    type: "template", storage: "file", path: "src/db/embed.ts",
    measuredBy: ["context-relevance", "context-causal-depth"],
    category: "embedding",
  },
]

// ── Query helpers ─────────────────────────────────────────────────────────

/** Get all components */
export function getAllComponents(): Component[] {
  return COMPONENTS
}

/** Get components that affect a specific benchmark dimension */
export function getComponentsForDimension(dimension: string): Component[] {
  return COMPONENTS.filter(c => c.measuredBy.includes(dimension))
}

/** Get components by category */
export function getComponentsByCategory(category: Component["category"]): Component[] {
  return COMPONENTS.filter(c => c.category === category)
}

/** Get a single component by ID */
export function getComponent(id: string): Component | undefined {
  return COMPONENTS.find(c => c.id === id)
}

/** Get all unique benchmark dimensions referenced by components */
export function getAllMeasuredDimensions(): string[] {
  const dims = new Set<string>()
  for (const c of COMPONENTS) {
    for (const d of c.measuredBy) dims.add(d)
  }
  return [...dims].sort()
}

/** Get all categories */
export function getAllCategories(): Component["category"][] {
  return [...new Set(COMPONENTS.map(c => c.category))]
}
