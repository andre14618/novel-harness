// Backward compatibility — re-export context builders from agent directories
import type { SeedInput } from "./types"
import { buildContext as buildWorldContext } from "./agents/world-builder/context"
import { buildContext as buildCharContext } from "./agents/character-agent/context"
import { buildContext as buildPlotterContext } from "./agents/plotter/context"

// Concept phase needs the 3-in-1 format for backward compat
export function buildConceptContext(seed: SeedInput): { world: string; character: string; plotter: string } {
  return {
    world: buildWorldContext(seed),
    character: buildCharContext(seed),
    plotter: buildPlotterContext(seed),
  }
}

export { buildContext as buildPlanningContext } from "./agents/planning-plotter/context"
export { buildContext as buildWriterContext } from "./agents/writer/context"
export { buildContext as buildContinuityContext } from "./agents/continuity/context"
export { buildContext as buildSummaryContext } from "./agents/summary-extractor/context"
export { buildContext as buildFactExtractionContext } from "./agents/fact-extractor/context"
export { buildContext as buildCharacterStateContext } from "./agents/character-state/context"
export { buildContext as buildCrossChapterContext } from "./agents/cross-chapter-continuity/context"
export { buildContext as buildProseQualityContext } from "./agents/prose-quality/context"
export { buildContext as buildRewriterContext } from "./agents/rewriter/context"
