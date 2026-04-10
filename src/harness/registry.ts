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
export type StorageType = "retrieval_config" | "deterministic_config" | "embedding_templates" | "context_templates" | "agent_generation_config" | "file" | "roles"

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
  /** For number types: valid range and default */
  min?: number
  max?: number
  step?: number
  default?: number
  /** Which benchmark dimensions measure this component's impact */
  measuredBy: string[]
  /** Category for UI grouping */
  category: "retrieval" | "deterministic" | "agent-prompt" | "model" | "embedding" | "context-format" | "generation"
}

// ── Registry ──────────────────────────────────────────────────────────────

export const COMPONENTS: Component[] = [
  // ── Retrieval parameters ──────────────────────────────────────────────
  {
    id: "retrieval.max_facts", name: "Max Facts",
    description: "Maximum facts retrieved per scene via hybrid search",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "max_facts",
    min: 5, max: 100, step: 5, default: 15,
    measuredBy: ["context-relevance", "context-completeness", "context-noise"],
    category: "retrieval",
  },
  {
    id: "retrieval.max_events", name: "Max Events",
    description: "Maximum timeline events retrieved per scene",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "max_events",
    min: 5, max: 50, step: 5, default: 15,
    measuredBy: ["context-relevance", "context-completeness", "context-causal-depth"],
    category: "retrieval",
  },
  {
    id: "retrieval.max_summaries", name: "Max Summaries",
    description: "Maximum chapter summaries retrieved per scene",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "max_summaries",
    min: 2, max: 20, step: 1, default: 8,
    measuredBy: ["context-completeness"],
    category: "retrieval",
  },
  {
    id: "retrieval.max_knowledge", name: "Max Knowledge",
    description: "Maximum character knowledge entries retrieved per scene",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "max_knowledge",
    min: 5, max: 50, step: 5, default: 15,
    measuredBy: ["context-knowledge-accuracy", "context-completeness"],
    category: "retrieval",
  },
  {
    id: "retrieval.min_similarity", name: "Min Similarity",
    description: "Cosine similarity floor — results below this are filtered out",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "min_similarity",
    min: 0.05, max: 0.6, step: 0.05, default: 0.25,
    measuredBy: ["context-relevance", "context-noise"],
    category: "retrieval",
  },
  {
    id: "retrieval.rrf_k", name: "RRF K",
    description: "Reciprocal Rank Fusion constant — higher values flatten ranking differences",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "rrf_k",
    min: 10, max: 120, step: 10, default: 60,
    measuredBy: ["context-relevance", "context-completeness"],
    category: "retrieval",
  },
  {
    id: "retrieval.character_boost", name: "Character Boost",
    description: "Score multiplier for results mentioning characters present in the scene",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "character_boost",
    min: 1.0, max: 4.0, step: 0.25, default: 2.0,
    measuredBy: ["context-relevance", "context-noise"],
    category: "retrieval",
  },
  {
    id: "retrieval.location_boost", name: "Location Boost",
    description: "Score multiplier for results matching the scene's location",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "location_boost",
    min: 1.0, max: 4.0, step: 0.25, default: 1.5,
    measuredBy: ["context-relevance"],
    category: "retrieval",
  },
  {
    id: "retrieval.recency_half_life", name: "Recency Half-Life",
    description: "Chapters until recency bonus halves — lower values favor recent data",
    type: "number", storage: "retrieval_config", table: "retrieval_config", column: "recency_half_life",
    min: 3, max: 30, step: 1, default: 10,
    measuredBy: ["context-relevance", "context-completeness"],
    category: "retrieval",
  },

  // ── Deterministic heuristic parameters ────────────────────────────────
  {
    id: "deterministic.causal_participant_weight", name: "Causal: Participant Weight",
    description: "How much shared participants between events contributes to causal link score",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_participant_weight",
    min: 0, max: 1, step: 0.05, default: 0.4,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_location_weight", name: "Causal: Location Weight",
    description: "How much same-location contributes to causal link score",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_location_weight",
    min: 0, max: 1, step: 0.05, default: 0.2,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_temporal_weight", name: "Causal: Temporal Weight",
    description: "How much chapter proximity contributes to causal link score",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_temporal_weight",
    min: 0, max: 1, step: 0.05, default: 0.15,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_consequence_weight", name: "Causal: Consequence Weight",
    description: "How much consequence keyword overlap contributes to causal link score",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_consequence_weight",
    min: 0, max: 1, step: 0.05, default: 0.25,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_auto_threshold", name: "Causal Auto-Accept Threshold",
    description: "Causal score above this → auto-accepted without LLM",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_auto_threshold",
    min: 0.5, max: 1.0, step: 0.05, default: 0.65,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },
  {
    id: "deterministic.causal_candidate_threshold", name: "Causal Candidate Threshold",
    description: "Causal score above this → sent to LLM for validation",
    type: "number", storage: "deterministic_config", table: "deterministic_config", column: "causal_candidate_threshold",
    min: 0.2, max: 0.8, step: 0.05, default: 0.35,
    measuredBy: ["context-causal-depth"],
    category: "deterministic",
  },

  // ── Agent prompts ─────────────────────────────────────────────────────
  {
    id: "prompt.writer", name: "Writer Prompt",
    description: "System prompt for the prose writer agent",
    type: "prompt", storage: "file", path: "src/agents/writer/prose-writer-system.md",
    measuredBy: ["prose-craft", "character-voice", "telling", "dead-weight", "dialogue-problems"],
    category: "agent-prompt",
  },
  {
    id: "prompt.planning-plotter", name: "Planning Plotter Prompt",
    description: "System prompt for chapter outline generation",
    type: "prompt", storage: "file", path: "src/agents/planning-plotter/chapter-outline-system.md",
    measuredBy: ["beat-specificity", "dialogue-cues", "emotional-arc"],
    category: "agent-prompt",
  },
  {
    id: "prompt.graph-linker", name: "Graph Linker Prompt",
    description: "System prompt for causal chain and knowledge propagation identification",
    type: "prompt", storage: "file", path: "src/agents/graph-linker/graph-validator-system.md",
    measuredBy: ["context-causal-depth", "context-knowledge-accuracy"],
    category: "agent-prompt",
  },
  {
    id: "prompt.fact-extractor", name: "Fact Extractor Prompt",
    description: "System prompt for extracting facts from prose",
    type: "prompt", storage: "file", path: "src/agents/fact-extractor/fact-extractor-system.md",
    measuredBy: ["extraction-completeness", "extraction-accuracy", "context-completeness"],
    category: "agent-prompt",
  },
  {
    id: "prompt.summary-extractor", name: "Summary Extractor Prompt",
    description: "System prompt for chapter summarization",
    type: "prompt", storage: "file", path: "src/agents/summary-extractor/chapter-summary-system.md",
    measuredBy: ["extraction-completeness", "context-completeness"],
    category: "agent-prompt",
  },
  {
    id: "prompt.relationship-timeline", name: "Relationship Timeline Prompt",
    description: "System prompt for extracting relationships, events, knowledge, awareness",
    type: "prompt", storage: "file", path: "src/agents/relationship-timeline/timeline-extractor-system.md",
    measuredBy: ["extraction-completeness", "context-knowledge-accuracy", "context-causal-depth"],
    category: "agent-prompt",
  },
  {
    id: "prompt.rewriter", name: "Rewriter Prompt",
    description: "System prompt for fixing prose issues",
    type: "prompt", storage: "file", path: "src/agents/rewriter/prose-rewriter-system.md",
    measuredBy: ["prose-craft", "telling"],
    category: "agent-prompt",
  },

  // ── Concept agent prompts ──────────────────────────────────────────────
  {
    id: "prompt.world-builder", name: "World Builder Prompt",
    description: "System prompt for world systems, cultures, and setting generation",
    type: "prompt", storage: "file", path: "src/agents/world-builder/world-bible-system.md",
    measuredBy: ["context-relevance", "context-completeness"],
    category: "agent-prompt",
  },
  {
    id: "prompt.character-agent", name: "Character Agent Prompt",
    description: "System prompt for character profile generation",
    type: "prompt", storage: "file", path: "src/agents/character-agent/character-profile-system.md",
    measuredBy: ["context-relevance", "context-knowledge-accuracy"],
    category: "agent-prompt",
  },
  {
    id: "prompt.plotter", name: "Plotter Prompt",
    description: "System prompt for story spine and act structure generation",
    type: "prompt", storage: "file", path: "src/agents/plotter/story-structure-system.md",
    measuredBy: ["beat-specificity", "emotional-arc"],
    category: "agent-prompt",
  },

  // ── Model assignments (visible in registry, NOT autoresearcher-tunable) ─
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
  // ── Embedding templates (DB-backed, autoresearcher-tunable) ────────────
  {
    id: "embed.fact_template", name: "Fact Embedding Template",
    description: "Text format for embedding facts. Placeholders: {category}, {fact}. Affects which facts are retrieved for a scene.",
    type: "template", storage: "embedding_templates", table: "embedding_templates", column: "fact",
    measuredBy: ["context-relevance", "context-completeness"],
    category: "embedding",
  },
  {
    id: "embed.event_template", name: "Event Embedding Template",
    description: "Text format for embedding timeline events. Placeholders: {event}, {location}, {participants}, {consequences}.",
    type: "template", storage: "embedding_templates", table: "embedding_templates", column: "event",
    measuredBy: ["context-relevance", "context-causal-depth"],
    category: "embedding",
  },
  {
    id: "embed.summary_template", name: "Summary Embedding Template",
    description: "Text format for embedding chapter summaries. Placeholders: {chapterNum}, {summary}, {keyEvents}, {emotionalState}.",
    type: "template", storage: "embedding_templates", table: "embedding_templates", column: "summary",
    measuredBy: ["context-completeness"],
    category: "embedding",
  },
  {
    id: "embed.char_state_template", name: "Character State Embedding Template",
    description: "Text format for embedding character states. Placeholders: {name}, {location}, {emotionalState}, {knows}, {doesNotKnow}.",
    type: "template", storage: "embedding_templates", table: "embedding_templates", column: "char_state",
    measuredBy: ["context-relevance", "context-knowledge-accuracy"],
    category: "embedding",
  },
  {
    id: "embed.relationship_template", name: "Relationship Embedding Template",
    description: "Text format for embedding relationships. Placeholders: {charA}, {charB}, {trustLevel}, {dynamic}, {tension}, {recentShift}.",
    type: "template", storage: "embedding_templates", table: "embedding_templates", column: "relationship",
    measuredBy: ["context-relevance"],
    category: "embedding",
  },
  {
    id: "embed.knowledge_template", name: "Knowledge Embedding Template",
    description: "Text format for embedding character knowledge. Placeholders: {characterName}, {source}, {knowledge}, {isFalseTag}.",
    type: "template", storage: "embedding_templates", table: "embedding_templates", column: "knowledge",
    measuredBy: ["context-knowledge-accuracy", "context-completeness"],
    category: "embedding",
  },

  // ── Context templates (DB-backed, autoresearcher-tunable) ─────────────
  {
    id: "context.scene_query", name: "Scene Query Template",
    description: "Text embedded as the search query for hybrid RRF retrieval. Placeholders: {pov}, {setting}, {purpose}, {beats}. Highest-impact template — determines what gets retrieved.",
    type: "template", storage: "context_templates", table: "context_templates", column: "scene_query",
    measuredBy: ["context-relevance", "context-completeness", "context-noise"],
    category: "context-format",
  },
  {
    id: "context.fact_line", name: "Fact Line Format",
    description: "How each fact appears in context. Placeholders: {chapter}, {category}, {fact}.",
    type: "template", storage: "context_templates", table: "context_templates", column: "fact_line",
    measuredBy: ["context-relevance", "context-noise"],
    category: "context-format",
  },
  {
    id: "context.event_line", name: "Event Line Format",
    description: "How each event appears in context. Placeholders: {chapter}, {event}, {consequences}.",
    type: "template", storage: "context_templates", table: "context_templates", column: "event_line",
    measuredBy: ["context-causal-depth"],
    category: "context-format",
  },
  {
    id: "context.summary_line", name: "Summary Line Format",
    description: "How each chapter summary appears. Placeholders: {chapter}, {summary}, {emotionalState}.",
    type: "template", storage: "context_templates", table: "context_templates", column: "summary_line",
    measuredBy: ["context-completeness"],
    category: "context-format",
  },
  {
    id: "context.knowledge_line", name: "Knowledge Line Format",
    description: "How each knowledge entry appears. Placeholders: {knowledge}, {source}, {chapter}.",
    type: "template", storage: "context_templates", table: "context_templates", column: "knowledge_line",
    measuredBy: ["context-knowledge-accuracy"],
    category: "context-format",
  },
  {
    id: "context.causal_chain", name: "Causal Chain Format",
    description: "How causal backtraces are shown. Placeholders: {chain}.",
    type: "template", storage: "context_templates", table: "context_templates", column: "causal_chain",
    measuredBy: ["context-causal-depth"],
    category: "context-format",
  },

  // ── Agent generation params (DB-backed, autoresearcher-tunable) ───────
  {
    id: "gen.writer.temperature", name: "Writer Temperature",
    description: "Controls creativity vs consistency for prose generation. Higher = more creative, lower = more predictable.",
    type: "number", storage: "agent_generation_config", table: "agent_generation_config", column: "writer.temperature",
    min: 0.3, max: 1.0, step: 0.05, default: 0.8,
    measuredBy: ["prose-craft", "character-voice"],
    category: "generation",
  },
  {
    id: "gen.writer.max_tokens", name: "Writer Max Tokens",
    description: "Maximum output tokens for prose generation.",
    type: "number", storage: "agent_generation_config", table: "agent_generation_config", column: "writer.max_tokens",
    min: 4096, max: 16384, step: 1024, default: 8000,
    measuredBy: ["prose-craft"],
    category: "generation",
  },
  {
    id: "gen.fact-extractor.temperature", name: "Fact Extractor Temperature",
    description: "Lower = more precise extraction, higher = catches more but noisier.",
    type: "number", storage: "agent_generation_config", table: "agent_generation_config", column: "fact-extractor.temperature",
    min: 0.0, max: 0.5, step: 0.05, default: 0.1,
    measuredBy: ["extraction-completeness", "extraction-accuracy"],
    category: "generation",
  },
  {
    id: "gen.summary-extractor.temperature", name: "Summary Extractor Temperature",
    description: "Controls precision of chapter summarization.",
    type: "number", storage: "agent_generation_config", table: "agent_generation_config", column: "summary-extractor.temperature",
    min: 0.0, max: 0.5, step: 0.05, default: 0.2,
    measuredBy: ["extraction-completeness"],
    category: "generation",
  },
  {
    id: "gen.relationship-timeline.temperature", name: "Relationship Timeline Temperature",
    description: "Controls precision of relationship/event/knowledge extraction.",
    type: "number", storage: "agent_generation_config", table: "agent_generation_config", column: "relationship-timeline.temperature",
    min: 0.0, max: 0.5, step: 0.05, default: 0.2,
    measuredBy: ["extraction-completeness", "context-knowledge-accuracy"],
    category: "generation",
  },
  {
    id: "gen.graph-linker.temperature", name: "Graph Linker Temperature",
    description: "Controls judgment quality for causal link validation.",
    type: "number", storage: "agent_generation_config", table: "agent_generation_config", column: "graph-linker.temperature",
    min: 0.0, max: 0.5, step: 0.05, default: 0.2,
    measuredBy: ["context-causal-depth", "context-knowledge-accuracy"],
    category: "generation",
  },
  {
    id: "gen.planning-plotter.temperature", name: "Planning Plotter Temperature",
    description: "Controls creativity vs structure in chapter outlines.",
    type: "number", storage: "agent_generation_config", table: "agent_generation_config", column: "planning-plotter.temperature",
    min: 0.3, max: 0.9, step: 0.05, default: 0.6,
    measuredBy: ["beat-specificity", "dialogue-cues", "emotional-arc"],
    category: "generation",
  },
  {
    id: "gen.rewriter.temperature", name: "Rewriter Temperature",
    description: "Controls how boldly the rewriter changes prose. Higher = more aggressive rewrites.",
    type: "number", storage: "agent_generation_config", table: "agent_generation_config", column: "rewriter.temperature",
    min: 0.2, max: 0.8, step: 0.05, default: 0.5,
    measuredBy: ["prose-craft", "telling"],
    category: "generation",
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
