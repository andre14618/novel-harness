import { getNovel } from "./db"
import { runConceptPhase, loadConceptOutput } from "./phases/concept"
import { runPlanningPhase, loadPlanningOutput } from "./phases/planning"
import { runDraftingPhase, loadDraftingOutput } from "./phases/drafting"
import { runValidationPhase, loadValidationOutput } from "./phases/validation"
import { getTokenUsage } from "./llm"
import { emit } from "./events"
import { log } from "./logger"
import { pipeline } from "./config/pipeline"
import { trace } from "./trace"
import db from "./db/connection"
import type { PhaseName } from "./phases/contract"

export async function runNovel(novelId: string): Promise<void> {
  const startedAt = Date.now()
  let novel = await getNovel(novelId)
  let prevSignature = ""
  let stuckCount = 0

  while (novel.phase !== "done") {
    // Detect a phase that re-dispatches without making progress (same phase + same chapter
    // as the previous iteration). The inner retry loops have their own caps; this is the
    // outer ceiling that prevents infinite spin if a phase keeps returning early.
    const signature = `${novel.phase}:${novel.currentChapter}`
    if (signature === prevSignature) {
      stuckCount++
      if (stuckCount > pipeline.maxPhaseRestarts) {
        throw new Error(
          `Phase "${novel.phase}" stuck at chapter ${novel.currentChapter} after ${stuckCount} restarts without progress. ` +
          `Increase pipeline.maxPhaseRestarts or investigate why the phase is failing.`,
        )
      }
      console.log(`  [state-machine] Phase "${novel.phase}" did not advance — restart ${stuckCount}/${pipeline.maxPhaseRestarts}`)
    } else {
      stuckCount = 0
    }
    prevSignature = signature

    const phaseStart = Date.now()
    const currentPhase = novel.phase

    try {
      switch (novel.phase) {
        case "concept":
          await runConceptPhase(novelId, novel.seed)
          break
        case "planning":
          await runPlanningPhase(novelId)
          break
        case "drafting":
          await runDraftingPhase(novelId)
          break
        case "validation":
          await runValidationPhase(novelId)
          break
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Surface phase-level failure as both a trace event (so the Activity
      // feed renders an explicit failure block, not just two completed LLM
      // calls) and an SSE "error" event.
      await trace(novelId, {
        eventType: "error",
        durationMs: Date.now() - phaseStart,
        payload: { phase: currentPhase, error: message },
      })
      emit(novelId, { type: "error", data: { phase: currentPhase, error: message } })
      throw err
    }

    await trace(novelId, {
      eventType: "phase-complete",
      durationMs: Date.now() - phaseStart,
      payload: { phase: currentPhase },
    })

    novel = await getNovel(novelId)

    // P6a — exercise the new loadXOutput functions against production DB
    // state for completed phases. Read-only; result discarded. Surfaces
    // any loader bug (missing required artifact, schema-of-record drift)
    // as a warn log without affecting the legacy driver's progress. P6b1
    // promotes loaders into the live driver path.
    if (novel.phase !== currentPhase) {
      try {
        await exerciseLoader(currentPhase, novelId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(novelId, "warn", `[P6a] ${currentPhase} loadOutput threw: ${msg}`)
      }
    }
  }

  const wallMs = Date.now() - startedAt
  const usage = getTokenUsage()

  console.log(`\n╔══════════════════════════════════════╗`)
  console.log(`║          NOVEL COMPLETE               ║`)
  console.log(`╚══════════════════════════════════════╝`)
  console.log(`  Output: output/${novelId}/`)

  // ── Run summary from llm_calls ─────────────────────────────────────────
  await printRunSummary(novelId, wallMs, usage)

  emit(novelId, { type: "done", data: { novelId, tokens: usage } })
}

/** P6a — exercise loadXOutput for the just-completed phase, discarding the
 *  result. Throws are caught by the caller and logged at warn level so a
 *  loader bug surfaces without breaking the legacy driver. */
async function exerciseLoader(phase: PhaseName, novelId: string): Promise<void> {
  switch (phase) {
    case "concept":    await loadConceptOutput(novelId);    return
    case "planning":   await loadPlanningOutput(novelId);   return
    case "drafting":   await loadDraftingOutput(novelId);   return
    case "validation": await loadValidationOutput(novelId); return
  }
}

function formatDuration(ms: number): string {
  const sec = ms / 1000
  if (sec < 60) return `${Math.round(sec)}s`
  const min = Math.floor(sec / 60)
  const rem = Math.round(sec % 60)
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`
}

async function printRunSummary(
  novelId: string,
  wallMs: number,
  memUsage: { prompt: number; completion: number },
): Promise<void> {
  const wallSec = wallMs / 1000
  const wallMin = Math.floor(wallSec / 60)
  const wallRemSec = Math.round(wallSec % 60)

  // Totals
  const [totals] = await db`
    SELECT
      COUNT(*)::int                         AS calls,
      COALESCE(SUM(prompt_tokens), 0)::int  AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
      ROUND(COALESCE(SUM(cost), 0)::numeric, 6) AS total_cost,
      COALESCE(SUM(latency_ms), 0)::int     AS total_latency_ms,
      COUNT(*) FILTER (WHERE failed)::int   AS failed_calls
    FROM llm_calls
    WHERE novel_id = ${novelId}
  `

  // Per-agent breakdown
  const agentRows = await db`
    SELECT
      agent,
      COUNT(*)::int                         AS calls,
      COALESCE(SUM(prompt_tokens), 0)::int  AS prompt_in,
      COALESCE(SUM(completion_tokens), 0)::int AS comp_out,
      ROUND(COALESCE(SUM(cost), 0)::numeric, 6) AS cost,
      ROUND(AVG(latency_ms)::numeric)::int  AS avg_ms
    FROM llm_calls
    WHERE novel_id = ${novelId}
    GROUP BY agent
    ORDER BY cost DESC
  `

  console.log(`\n────────────────────────────────────────────────────────────`)
  console.log(`  Run Summary`)
  console.log(`────────────────────────────────────────────────────────────`)
  console.log(`  Wall clock:    ${wallMin}m ${wallRemSec}s`)
  console.log(`  API cost:      $${totals.total_cost}`)
  console.log(`  LLM calls:     ${totals.calls} (${totals.failed_calls} failed)`)
  console.log(`  Tokens:        ${totals.prompt_tokens.toLocaleString()} in / ${totals.completion_tokens.toLocaleString()} out`)

  if (memUsage.prompt + memUsage.completion !== totals.prompt_tokens + totals.completion_tokens) {
    console.log(`  (in-memory:    ${memUsage.prompt.toLocaleString()} in / ${memUsage.completion.toLocaleString()} out)`)
  }

  console.log(`\n  Per-agent breakdown:`)
  console.log(`  ${"Agent".padEnd(28)} ${"Calls".padStart(5)}  ${"Tokens In".padStart(10)}  ${"Tokens Out".padStart(10)}  ${"Cost".padStart(8)}  ${"Avg ms".padStart(7)}`)
  console.log(`  ${"─".repeat(28)} ${"─".repeat(5)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(8)}  ${"─".repeat(7)}`)
  for (const r of agentRows) {
    console.log(
      `  ${r.agent.padEnd(28)} ${String(r.calls).padStart(5)}  ${r.prompt_in.toLocaleString().padStart(10)}  ${r.comp_out.toLocaleString().padStart(10)}  ${"$" + r.cost.padStart(7)}  ${String(r.avg_ms).padStart(6)}ms`
    )
  }

  // ── Per-phase timing ─────────────────────────────────────────────────
  const phaseRows = await db`
    SELECT
      payload->>'phase' AS phase,
      duration_ms::int  AS duration_ms
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND event_type = 'phase-complete'
      AND payload->>'phase' IS NOT NULL
    ORDER BY timestamp
  `
  if (phaseRows.length > 0) {
    console.log(`\n  Per-phase timing:`)
    console.log(`  ${"Phase".padEnd(16)} Duration`)
    console.log(`  ${"─".repeat(16)} ${"─".repeat(10)}`)
    for (const r of phaseRows) {
      console.log(`  ${r.phase.padEnd(16)} ${formatDuration(r.duration_ms)}`)
    }

    // Per-chapter breakdown within drafting
    const chapterRows = await db`
      SELECT
        chapter,
        duration_ms::int AS duration_ms
      FROM pipeline_events
      WHERE novel_id = ${novelId}
        AND event_type = 'chapter-complete'
        AND chapter IS NOT NULL
      ORDER BY chapter
    `
    if (chapterRows.length > 0) {
      console.log(`\n  Per-chapter drafting:`)
      console.log(`  ${"Chapter".padEnd(16)} Duration`)
      console.log(`  ${"─".repeat(16)} ${"─".repeat(10)}`)
      for (const r of chapterRows) {
        console.log(`  ${`Chapter ${r.chapter}`.padEnd(16)} ${formatDuration(r.duration_ms)}`)
      }
    }
  }

  console.log()
}
