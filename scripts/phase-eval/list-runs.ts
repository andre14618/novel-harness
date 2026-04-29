/**
 * phase-eval results browser.
 *
 * Reads `phase_eval_runs` and prints the most recent rows in tabular
 * form. Designed per docs/designs/eval-testing-module-v1.md (R6) — the
 * cheap query surface that makes "what was loud variant's facts_median
 * on the 2026-04-29 run?" a one-line answer.
 *
 * Usage:
 *   bun scripts/phase-eval/list-runs.ts [--probe=<name>] [--limit=<n>] [--full]
 *
 * Without --probe, lists across all probes. Default limit: 20.
 * --full prints the full row including verdict + notes + the
 * summary_json -> 'g_metrics' block; default is a compact summary.
 */

import db from "../../src/db/connection"

interface Args {
  probe?: string
  limit: number
  full: boolean
}

function parseArgs(): Args {
  const map: Record<string, string | true> = {}
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/)
    if (m) map[m[1]!] = m[2]!
    else if (arg.startsWith("--")) map[arg.slice(2)] = true
  }
  const limitRaw = map["limit"]
  const limit = limitRaw && typeof limitRaw === "string" ? Number(limitRaw) : 20
  if (!Number.isFinite(limit) || limit <= 0) {
    console.error(`--limit must be a positive integer, got: ${limitRaw}`)
    process.exit(2)
  }
  return {
    probe: typeof map["probe"] === "string" ? map["probe"] : undefined,
    limit,
    full: map["full"] === true,
  }
}

async function main(): Promise<void> {
  const args = parseArgs()

  const rows = args.probe
    ? await db`
        SELECT id, probe_name, git_commit, experiment_id,
               seeds_used, variant_labels, verdict, ran_at, notes,
               summary_json -> 'g_metrics' AS g_metrics
        FROM phase_eval_runs
        WHERE probe_name = ${args.probe}
        ORDER BY ran_at DESC
        LIMIT ${args.limit}
      `
    : await db`
        SELECT id, probe_name, git_commit, experiment_id,
               seeds_used, variant_labels, verdict, ran_at, notes,
               summary_json -> 'g_metrics' AS g_metrics
        FROM phase_eval_runs
        ORDER BY ran_at DESC
        LIMIT ${args.limit}
      `

  if (rows.length === 0) {
    console.log(args.probe
      ? `No phase_eval_runs rows for probe='${args.probe}'.`
      : "No phase_eval_runs rows yet. Use `print-screen-verdict.ts --persist` to populate.")
    process.exit(0)
  }

  if (args.full) {
    for (const r of rows) {
      console.log(JSON.stringify(r, null, 2))
      console.log("---")
    }
  } else {
    console.table(rows.map((r: any) => ({
      id: r.id,
      probe: r.probe_name,
      ran_at: new Date(r.ran_at).toISOString(),
      seeds: (r.seeds_used as string[]).join(","),
      variants: (r.variant_labels as string[]).join(","),
      git: (r.git_commit as string).slice(0, 8),
      exp: r.experiment_id ?? "—",
      verdict: (r.verdict as string).split(" — ")[0],   // strip the long explanation tail
    })))
  }
}

main().catch(err => {
  console.error("[list-runs] fatal:", err)
  process.exit(1)
})
