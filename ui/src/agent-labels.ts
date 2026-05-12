/**
 * Shared display labels for harness agents.
 *
 * Agents are referenced by their registry name (`src/models/roles.ts`
 * AGENT_MODELS keys + `src/phases/beat-checks.ts` BeatIssueSource names).
 * Several UI surfaces render the same agent under different phrasing
 * (pipeline pills, activity feed verbs, config-page headings), which
 * previously drifted — e.g. continuity had three distinct labels across
 * three components. This module centralizes the first two shapes.
 *
 * ConfigPage keeps its own map because its labels double as form-section
 * headings with different conventions (fully-spelled-out, Title Case).
 */

/** Short label for pills / compact badges. Keep ≤15 chars. */
const SHORT_LABELS: Record<string, string> = {
  // Concept
  "world-builder": "World",
  "character-agent": "Characters",
  "plotter": "Plot",
  // Planning
  "planning-plotter": "Chapter Plan",
  "planning-scenes": "Scene Plan",
  // Drafting
  "writer": "Writer",
  "beat-writer": "Beat Writer",
  "reference-resolver": "References",
  // Beat-level checkers
  "adherence-events": "Adherence",
  "halluc-ungrounded": "Halluc",
  // Chapter-level checkers
  "chapter-plan-checker": "Plan Check",
  "functional-state-checker": "State Check",
  "continuity": "Continuity",
  "continuity-facts": "Continuity",
  "continuity-state": "Continuity",
  // Prose polish
  "lint-fixer": "Lint",
  // Lint research (offline scripts only)
  "improver": "Lint Research",
}

/** Verb-first phrasing for the activity feed. Reads as a status line. */
const ACTION_LABELS: Record<string, string> = {
  // Concept
  "world-builder": "Building the world",
  "character-agent": "Casting characters",
  "plotter": "Sketching the plot",
  // Planning
  "planning-plotter": "Generating chapter outlines",
  "planning-scenes": "Expanding chapter scenes",
  // Drafting
  "writer": "Writing the chapter",
  "beat-writer": "Writing beat",
  "reference-resolver": "Resolving references",
  // Beat-level checkers
  "adherence-events": "Checking beat adherence",
  "halluc-ungrounded": "Checking for ungrounded entities",
  // Chapter-level checkers
  "chapter-plan-checker": "Verifying chapter plan",
  "functional-state-checker": "Checking planned state",
  "continuity": "Checking continuity",
  "continuity-facts": "Checking continuity facts",
  "continuity-state": "Checking continuity state",
  // Prose polish
  "lint-fixer": "Fixing lint",
}

export function agentShortLabel(agent: string): string {
  return SHORT_LABELS[agent] ?? agent
}

export function agentActionLabel(agent: string): string {
  return ACTION_LABELS[agent] ?? agent
}
