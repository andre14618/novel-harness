#!/usr/bin/env bun
/**
 * Autonomous-loop driver — SKELETON. Not executable yet.
 *
 * Refuses to run until the four Phase 0 prerequisites from
 * `scripts/autonomous-loop/README.md` are complete:
 *   1. env-var → DB migration for writer overrides
 *   2. calibration-substrate drift detector
 *   3. 5-chapter planner-only A/B (GO/NO-GO for Phase 0)
 *   4. held-out 10-beat replay set
 *
 * Shape is wired in so reviewers can see the intended loop contract.
 * Every stage that would cost money throws on entry; replace throws
 * with real implementations after prerequisites ship.
 */

import { assertNotKilled } from "./kill-switch"

const PREREQ_GUARD = "PHASE_0_PREREQS_DONE"

interface IterationRecord {
  iteration_id: string
  sub_loop: "planning-beats"
  proposed_at: string
  proposer_reasoning?: string
  config: Record<string, unknown>
  beats_scored: number
  scores: Record<string, number>
  downstream_replay: {
    ran: boolean
    frozen_downstream_sha: string
    gate_status: "pass" | "fail"
    gate_details: Record<string, number>
  }
  notes?: string
}

function requirePrereqs(): void {
  if (process.env[PREREQ_GUARD] !== "true") {
    throw new Error(
      `Phase 0 prerequisites are not marked complete. ` +
      `See scripts/autonomous-loop/README.md "Prerequisites before first iteration". ` +
      `After all four ship, export ${PREREQ_GUARD}=true to unblock.`
    )
  }
}

async function proposeNextConfig(_historyPath: string): Promise<unknown> {
  // TODO: Codex exec wrapper. Reads history JSONL + Phase 0 knob
  // schema + research question; returns one JSON config. See
  // scripts/autonomous-loop/propose-next-planning-config.ts.
  throw new Error("proposeNextConfig: not implemented")
}

async function applyConfig(_config: unknown): Promise<string> {
  // TODO: Write the per-iteration prompt variant under
  // scripts/autonomous-loop/variants/<iteration-id>.md.
  // Return the variant path. The loop NEVER edits
  // src/agents/planning-beats/* directly.
  throw new Error("applyConfig: not implemented")
}

async function generateAndScore(_variantPath: string): Promise<unknown> {
  // TODO: Run planning-beats with the variant across the frozen 20-
  // beat pool; replay frozen writer + frozen checkers; run decomposed
  // audit. Returns {beats_scored, scores, downstream_replay}.
  throw new Error("generateAndScore: not implemented")
}

function appendHistory(_record: IterationRecord, _path: string): void {
  // TODO: append JSONL record atomically. See history/.schema.md.
  throw new Error("appendHistory: not implemented")
}

function hasConverged(_history: IterationRecord[]): boolean {
  // TODO: from design doc §check_convergence — N iterations without
  // improvement on the dominant axis (adherence OR voice-shape) for
  // 5 iterations AND budget > 50% used. Err toward running longer.
  return false
}

async function main(): Promise<void> {
  requirePrereqs()
  await assertNotKilled()

  const historyPath = "scripts/autonomous-loop/history/planning-beats-loop.jsonl"
  const perIterationCap = parseFloat(process.env.PER_ITERATION_CAP ?? "1.00")
  const sessionCap = parseFloat(process.env.SESSION_CAP ?? "5.00")

  let spent = 0
  const history: IterationRecord[] = []  // TODO: load from historyPath

  while (spent < sessionCap && !hasConverged(history)) {
    await assertNotKilled()

    const config = await proposeNextConfig(historyPath)
    await assertNotKilled()

    const variantPath = await applyConfig(config)
    await assertNotKilled()

    const result = await generateAndScore(variantPath) as {
      beats_scored: number
      scores: Record<string, number>
      downstream_replay: IterationRecord["downstream_replay"]
      cost: number
    }

    if (result.cost > perIterationCap) {
      console.warn(`iteration exceeded per-iteration cap ($${result.cost} > $${perIterationCap}); aborting`)
      break
    }

    spent += result.cost

    const record: IterationRecord = {
      iteration_id: `planning-beats-loop-v1-iter-${String(history.length).padStart(3, "0")}`,
      sub_loop: "planning-beats",
      proposed_at: new Date().toISOString(),
      config: config as Record<string, unknown>,
      beats_scored: result.beats_scored,
      scores: result.scores,
      downstream_replay: result.downstream_replay,
    }

    appendHistory(record, historyPath)
    history.push(record)
  }

  console.log(`loop exit — ${history.length} iterations, $${spent.toFixed(2)} spent`)
}

if (import.meta.main) {
  main().catch(e => {
    console.error(e instanceof Error ? e.stack ?? e.message : String(e))
    process.exit(1)
  })
}
