/**
 * Phase-eval variant runner — child entry point.
 *
 * Spawned by `scripts/phase-eval/probe-planning-beats.ts` (parent) with one
 * of the planning-phase prompt-override env vars pre-set. Runs the planning
 * phase ONLY against an already-cloned concept-done novel state, then writes
 * the resulting chapter outlines to disk for the parent to aggregate.
 *
 * Why a separate child process: module-level state hazards make
 * in-process variant cycling unsafe. `src/logger.ts` and
 * `src/transport.ts` carry currentRunId / setTransport singletons; the
 * planner agents read their system prompts at module-load time. Spawning
 * a fresh Bun process per variant gives each one its own module graph and
 * prompt cache, with no leakage between variants.
 *
 * Supported override env vars (parent must set EXACTLY ONE before exec):
 *   - PLANNING_BEATS_PROMPT_OVERRIDE        — swaps the beat-expansion prompt
 *   - PLANNING_PLOTTER_PROMPT_OVERRIDE      — swaps the chapter-skeleton prompt
 *   - PLANNING_STATE_MAPPER_PROMPT_OVERRIDE — swaps the state-mapper prompt
 *
 * Usage:
 *
 *   PLANNING_BEATS_PROMPT_OVERRIDE=/abs/path/to/prompt.md \
 *     bun scripts/phase-eval/run-variant.ts \
 *       --novel-id=<cloned-concept-done-novel-id> \
 *       --output-dir=<absolute-output-dir>
 *
 * Output: <output-dir>/outlines.json — JSON object
 *   { novelId, promptOverride, promptEnvVar, outlines: ChapterOutline[] }
 *   where `outlines` is the planner's per-chapter output. The verdict
 *   reader reads `.outlines` from this shape.
 */

import { writeFileSync, mkdirSync } from "node:fs"
import { basename, join, isAbsolute } from "node:path"

function parseArgs(): { novelId: string; outputDir: string } {
  const novelIdArg = process.argv.find(a => a.startsWith("--novel-id="))
  const outputDirArg = process.argv.find(a => a.startsWith("--output-dir="))
  if (!novelIdArg || !outputDirArg) {
    console.error("usage: bun run-variant.ts --novel-id=<id> --output-dir=<abs-path>")
    process.exit(2)
  }
  const novelId = novelIdArg.split("=", 2)[1]!
  const outputDir = outputDirArg.split("=", 2)[1]!
  if (!isAbsolute(outputDir)) {
    console.error(`--output-dir must be absolute: ${outputDir}`)
    process.exit(2)
  }
  return { novelId, outputDir }
}

async function main() {
  const { novelId, outputDir } = parseArgs()

  const SUPPORTED = ["PLANNING_BEATS_PROMPT_OVERRIDE", "PLANNING_PLOTTER_PROMPT_OVERRIDE", "PLANNING_STATE_MAPPER_PROMPT_OVERRIDE"] as const
  const setVars = SUPPORTED.filter(k => (process.env[k]?.trim()?.length ?? 0) > 0)
  if (setVars.length === 0) {
    console.error(`exactly one of ${SUPPORTED.join(" / ")} must be set by the parent runner`)
    process.exit(2)
  }
  if (setVars.length > 1) {
    console.error(`exactly one of ${SUPPORTED.join(" / ")} must be set; got: ${setVars.join(", ")}`)
    process.exit(2)
  }
  const promptEnvVar = setVars[0]!
  const promptOverride = process.env[promptEnvVar]!.trim()
  if (!isAbsolute(promptOverride)) {
    console.error(`${promptEnvVar} must be absolute: ${promptOverride}`)
    process.exit(2)
  }

  console.error(`[run-variant] novelId=${novelId}`)
  console.error(`[run-variant] ${promptEnvVar}=${promptOverride}`)
  console.error(`[run-variant] output-dir=${outputDir}`)

  // Auto mode + auto resolver — variant runs are non-interactive by definition.
  const { setAutoMode, setResolverMode } = await import("../../src/cli")
  setAutoMode(true)
  setResolverMode("auto")

  const experimentIdRaw = process.env.EXPERIMENT_ID?.trim()
  const experimentId = experimentIdRaw ? Number(experimentIdRaw) : null
  if (experimentIdRaw && !Number.isInteger(experimentId)) {
    console.error(`EXPERIMENT_ID must be an integer when set: ${experimentIdRaw}`)
    process.exit(2)
  }

  const { initExperimentRun, initNovelRun } = await import("../../src/logger")
  const runId = experimentId
    ? await initExperimentRun(experimentId, "phase-eval", novelId, `${promptEnvVar}:${basename(promptOverride)}`)
    : await initNovelRun(novelId)
  console.error(`[run-variant] runId=${runId}${experimentId ? ` experimentId=${experimentId}` : ""}`)

  // Run planning ONLY. Concept must already be applied (clone-for-variant
  // --target-phase=concept-done).
  const { runPlanningPhase } = await import("../../src/phases/planning")
  const result = await runPlanningPhase(novelId)
  if (result.kind !== "complete") {
    console.error(`[run-variant] planning paused: reason=${result.reason}`)
    process.exit(1)
  }

  const { getChapterOutlines } = await import("../../src/db/outlines")
  const outlines = await getChapterOutlines(novelId)
  if (outlines.length === 0) {
    console.error(`[run-variant] no chapter_outlines rows for novelId=${novelId} — planner produced nothing`)
    process.exit(1)
  }

  mkdirSync(outputDir, { recursive: true })
  const outPath = join(outputDir, "outlines.json")
  writeFileSync(outPath, JSON.stringify({ novelId, runId, experimentId, promptOverride, promptEnvVar, outlines }, null, 2))
  console.error(`[run-variant] wrote ${outlines.length} outlines to ${outPath}`)
}

main().catch(err => {
  console.error("[run-variant] fatal:", err)
  process.exit(1)
})
