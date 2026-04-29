import { getNovel, updatePhase } from "./db"
import { conceptPhase, loadConceptOutput } from "./phases/concept"
import { planningPhase, loadPlanningOutput } from "./phases/planning"
import { draftingPhase, loadDraftingOutput, effectivePipeline } from "./phases/drafting"
import { validationPhase, loadValidationOutput } from "./phases/validation"
import { getTokenUsage } from "./llm"
import { emit } from "./events"
import { log } from "./logger"
import { pipeline } from "./config/pipeline"
import { trace } from "./trace"
import db from "./db/connection"
import type { Phase, PhaseCtx, PhaseName, PhaseResult } from "./phases/contract"

// ── Typed driver wiring ────────────────────────────────────────────────────

type AnyPhase = Phase<unknown, unknown>

const PHASES: ReadonlyArray<AnyPhase> = [
  conceptPhase as AnyPhase,
  planningPhase as AnyPhase,
  draftingPhase as AnyPhase,
  validationPhase as AnyPhase,
]

const PHASE_INDEX: Record<string, number> = {
  concept: 0, planning: 1, drafting: 2, validation: 3, done: 4,
}

const NEXT_PHASE: Record<PhaseName, "planning" | "drafting" | "validation" | "done"> = {
  concept: "planning",
  planning: "drafting",
  drafting: "validation",
  validation: "done",
}

const LOADERS: Record<PhaseName, (novelId: string) => Promise<unknown>> = {
  concept: loadConceptOutput,
  planning: loadPlanningOutput,
  drafting: loadDraftingOutput,
  validation: loadValidationOutput,
}

// ── runNovel ───────────────────────────────────────────────────────────────

export async function runNovel(novelId: string): Promise<void> {
  const startedAt = Date.now()
  let novel = await getNovel(novelId)
  let prevSignature = ""
  let stuckCount = 0

  // P6b1: build PhaseCtx once per runNovel; immutable for the duration of
  // this invocation.
  const ctx: PhaseCtx = {
    novelId,
    seed: novel.seed,
    pipeline: effectivePipeline(novel.seed),
  }

  // Resume rehydration: for each Phase already complete, reconstruct its
  // output from DB to feed the typed pipe forward. Idempotent and read-only;
  // any throw here is fatal (the contract says loadOutput is only called when
  // the phase has actually completed, so a thrown loader = schema-of-record
  // violation, not a recoverable condition).
  let pipe: unknown = novel.seed
  const startIdx = PHASE_INDEX[novel.phase] ?? 0
  for (let i = 0; i < startIdx; i++) {
    pipe = await PHASES[i].loadOutput(novelId)
  }

  while (novel.phase !== "done") {
    // The outer busy-retry guard stays in P6b1 (preserves today's semantics).
    // P6b2 removes this when paused returns travel back to runNovel's caller.
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
    const currentPhase = novel.phase as PhaseName
    const idx = PHASE_INDEX[currentPhase]
    const phase = PHASES[idx]

    let result: PhaseResult<unknown>
    try {
      result = await phase.run(pipe, ctx)
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

    if (result.kind === "complete") {
      // Driver-owned phase transition. Pipe the typed output forward and
      // advance novels.phase. The matching `phase:changed` emit happens on
      // the next phase's own entry (preserving the current event surface).
      pipe = result.output
      const next = NEXT_PHASE[currentPhase]
      await updatePhase(novelId, next)
      emit(novelId, { type: "phase:changed", data: { phase: next } })
    } else {
      // Paused: the phase did not advance. The outer busy-retry guard above
      // catches loop-spin; resume after operator intervention re-runs this
      // phase from the top. P6b2 will change paused to return-to-caller.
      log(novelId, "info", `[driver] phase ${currentPhase} returned paused: ${result.reason}`)
    }

    novel = await getNovel(novelId)

    // P6a (preserved through P6b1): exercise loadXOutput for the phase that
    // just advanced. Read-only; loader output is discarded. Surfaces any
    // loader bug or schema-of-record drift as a warn log.
    if (novel.phase !== currentPhase) {
      try {
        await LOADERS[currentPhase](novelId)
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
