/**
 * phase-eval persistence helper.
 *
 * INSERT one row into `phase_eval_runs` mirroring the probe's summary
 * + computed verdict. Designed per docs/designs/eval-testing-module-v1.md
 * (R6) — narrow, append-only, ~$0 engineering, ~$0 runtime.
 *
 * Called from `scripts/phase-eval/print-screen-verdict.ts` when invoked
 * with `--persist`. Probe is otherwise UNCHANGED. Without `--persist`,
 * print-screen-verdict.ts behavior is byte-identical to today.
 *
 * Schema: see sql/033_phase_eval_runs.sql.
 */

import { spawnSync } from "node:child_process"
import db from "../../src/db/connection"

export interface PersistRunInput {
  probeName: string
  gitCommit: string
  experimentId?: number | null
  seedsUsed: string[]
  variantLabels: string[]
  /** The probe's summary.json + computed g_metrics block, as JSONB. */
  summaryJson: unknown
  /** The verdict line from print-screen-verdict.ts. */
  verdict: string
  notes?: string | null
}

export async function persistPhaseEvalRun(input: PersistRunInput): Promise<number> {
  // Cast TEXT[] arrays explicitly: Bun.SQL binds JS arrays as JSON by
  // default, but the column expects pg's TEXT[] type — `::text[]` on a
  // JSONB-encoded array converts cleanly through pg's array_in.
  const rows = await db`
    INSERT INTO phase_eval_runs (
      probe_name, git_commit, experiment_id,
      seeds_used, variant_labels,
      summary_json, verdict, notes
    ) VALUES (
      ${input.probeName}, ${input.gitCommit}, ${input.experimentId ?? null},
      ${input.seedsUsed}::text[], ${input.variantLabels}::text[],
      ${JSON.stringify(input.summaryJson)}::jsonb,
      ${input.verdict},
      ${input.notes ?? null}
    )
    RETURNING id
  `
  return (rows[0] as { id: number }).id
}

/** Capture HEAD commit at probe-end time. Used for code-identity
 *  provenance (R6 §3 "Why git_commit"). Returns "unknown" on failure
 *  so a missing git binary or detached HEAD doesn't block persistence
 *  — git_commit is forensic context, not a primary key. */
export function currentGitCommit(): string {
  try {
    const proc = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" })
    if (proc.status !== 0) return "unknown"
    return (proc.stdout ?? "").trim() || "unknown"
  } catch {
    return "unknown"
  }
}
