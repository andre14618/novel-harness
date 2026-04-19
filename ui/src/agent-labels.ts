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
  "planning-beats": "Beat Plan",
  // Drafting
  "writer": "Writer",
  "beat-writer": "Beat Writer",
  "reference-resolver": "References",
  // Beat-level checkers
  "adherence-events": "Adherence",
  "halluc-ungrounded": "Halluc",
  "halluc-leak-salvatore": "Leak",
  // Chapter-level checkers
  "chapter-plan-checker": "Plan Check",
  "continuity": "Continuity",
  "continuity-facts": "Continuity",
  "continuity-state": "Continuity",
  // Prose polish
  "lint-fixer": "Lint",
  "tonal-pass": "Tonal Pass",
  // Improvement daemon
  "improver": "Improver",
}

/** Verb-first phrasing for the activity feed. Reads as a status line. */
const ACTION_LABELS: Record<string, string> = {
  // Concept
  "world-builder": "Building the world",
  "character-agent": "Casting characters",
  "plotter": "Sketching the plot",
  // Planning
  "planning-plotter": "Generating chapter outlines",
  "planning-beats": "Expanding chapter beats",
  // Drafting
  "writer": "Writing the chapter",
  "beat-writer": "Writing beat",
  "reference-resolver": "Resolving references",
  // Beat-level checkers
  "adherence-events": "Checking beat adherence",
  "halluc-ungrounded": "Checking for ungrounded entities",
  "halluc-leak-salvatore": "Checking for corpus leak",
  // Chapter-level checkers
  "chapter-plan-checker": "Verifying chapter plan",
  "continuity": "Checking continuity",
  "continuity-facts": "Checking continuity facts",
  "continuity-state": "Checking continuity state",
  // Prose polish
  "lint-fixer": "Fixing lint",
  "tonal-pass": "Applying tonal pass",
}

export function agentShortLabel(agent: string): string {
  return SHORT_LABELS[agent] ?? agent
}

export function agentActionLabel(agent: string): string {
  return ACTION_LABELS[agent] ?? agent
}
