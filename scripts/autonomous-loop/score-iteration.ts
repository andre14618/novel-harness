#!/usr/bin/env bun
/**
 * Iteration scorer — SKELETON.
 *
 * Given a variant path and the frozen 20-beat pool, this:
 *   1. Runs planning-beats with the variant (produces beat
 *      descriptions + establishedFacts + characterStateChanges +
 *      knowledgeChanges).
 *   2. Freezes writer + checker prompts to their production shapes
 *      at the frozen_downstream_sha recorded in the iteration
 *      record.
 *   3. Replays writer → adherence → halluc-ungrounded → halluc-leak
 *      → voice-shape → distinctness → defect detectors across the
 *      pool.
 *   4. Computes the Phase 0 measurement axes listed in
 *      docs/designs/autonomous-context-loop.md §Sub-loop-1 and the
 *      downstream gates per the composition rule.
 *   5. Returns a structured score JSON the driver writes into the
 *      history record.
 *
 * Reuses existing eval infrastructure:
 *   - initExperimentRun for llm_calls persistence (commit 2f48217)
 *   - eval_results schema for the raw beat-level rows
 *   - voice-shape-metrics.ts for voice-shape distance
 *
 * Not yet implemented. The driver refuses to call this until the
 * Phase 0 prerequisites in README.md ship.
 */

throw new Error("score-iteration.ts: skeleton only, not implemented")
