/**
 * halluc-and-gate-summary.ts
 *
 * Per-novel AND-gate breakdown for halluc-ungrounded calls.
 *
 * Queries llm_calls where agent='halluc-ungrounded' and ner_prepass_json IS NOT NULL,
 * then prints a table of:
 *   - Total calls
 *   - pass (both NER+LLM passed)
 *   - ner+llm-blocker (both fired)
 *   - ner-only-warning (NER fired, LLM passed)
 *   - llm-only-blocker (LLM fired, NER passed)
 *   - disabled (NER prepass not active, variant v0/v2)
 *
 * Added in L16 (2026-05-01, exp #TBD). Requires migration
 * 034_llm_call_ner_prepass.sql to have been applied.
 *
 * Usage:
 *   bun scripts/phase-eval/halluc-and-gate-summary.ts <novel_id>
 *   bun scripts/phase-eval/halluc-and-gate-summary.ts --all     # all novels
 *   bun scripts/phase-eval/halluc-and-gate-summary.ts           # last 100 calls
 */

import db from "../../src/db/connection"

interface Row {
  novel_id: string | null
  total: number
  pass_count: number
  ner_llm_blocker: number
  ner_only_warning: number
  llm_only_blocker: number
  disabled_count: number
  unpersisted: number
}

async function main() {
  const args = process.argv.slice(2)
  const novelId = args.find(a => !a.startsWith("--"))
  const showAll = args.includes("--all")

  if (novelId) {
    // Per-novel breakdown
    const rows = await db<Row[]>`
      SELECT
        novel_id,
        COUNT(*)::int                                                                AS total,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'pass' THEN 1 ELSE 0 END)::int          AS pass_count,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'ner+llm-blocker' THEN 1 ELSE 0 END)::int AS ner_llm_blocker,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'ner-only-warning' THEN 1 ELSE 0 END)::int AS ner_only_warning,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'llm-only-blocker' THEN 1 ELSE 0 END)::int AS llm_only_blocker,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'disabled' THEN 1 ELSE 0 END)::int       AS disabled_count,
        SUM(CASE WHEN ner_prepass_json IS NULL THEN 1 ELSE 0 END)::int              AS unpersisted
      FROM llm_calls
      WHERE agent = 'halluc-ungrounded'
        AND novel_id = ${novelId}
      GROUP BY novel_id
      ORDER BY novel_id
    `
    if (rows.length === 0) {
      console.log(`No halluc-ungrounded calls found for novel ${novelId}.`)
      console.log("(Make sure migration 034_llm_call_ner_prepass.sql has been applied.)")
      process.exit(0)
    }
    printTable(rows)

    // Also show per-beat breakdown for this novel
    const beatRows = await db`
      SELECT
        chapter,
        beat_index,
        attempt,
        ner_prepass_json->>'andGateDecision' AS decision,
        jsonb_array_length(COALESCE(ner_prepass_json->'nerFindings', '[]'::jsonb)) AS ner_findings_count,
        jsonb_array_length(COALESCE(ner_prepass_json->'nerOnlyFindings', '[]'::jsonb)) AS ner_only_count,
        timestamp
      FROM llm_calls
      WHERE agent = 'halluc-ungrounded'
        AND novel_id = ${novelId}
        AND ner_prepass_json IS NOT NULL
      ORDER BY chapter, beat_index, attempt
    `
    if (beatRows.length > 0) {
      console.log("\nPer-beat breakdown:")
      console.log("ch | beat | att | decision           | NER finds | NER-only | timestamp")
      console.log("---|------|-----|--------------------|-----------| ---------|-----------")
      for (const r of beatRows as any[]) {
        const ch = String(r.chapter ?? "?").padStart(2)
        const bi = String(r.beat_index ?? "?").padStart(4)
        const at = String(r.attempt ?? "?").padStart(3)
        const dec = (r.decision ?? "null").padEnd(20)
        const nf = String(r.ner_findings_count ?? 0).padStart(9)
        const no = String(r.ner_only_count ?? 0).padStart(8)
        const ts = r.timestamp ? new Date(r.timestamp).toISOString().slice(0, 19) : "?"
        console.log(`${ch} | ${bi} | ${at} | ${dec} | ${nf} | ${no} | ${ts}`)
      }
    }
  } else if (showAll) {
    // Per-novel rollup across all novels
    const rows = await db<Row[]>`
      SELECT
        novel_id,
        COUNT(*)::int                                                                AS total,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'pass' THEN 1 ELSE 0 END)::int          AS pass_count,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'ner+llm-blocker' THEN 1 ELSE 0 END)::int AS ner_llm_blocker,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'ner-only-warning' THEN 1 ELSE 0 END)::int AS ner_only_warning,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'llm-only-blocker' THEN 1 ELSE 0 END)::int AS llm_only_blocker,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'disabled' THEN 1 ELSE 0 END)::int       AS disabled_count,
        SUM(CASE WHEN ner_prepass_json IS NULL THEN 1 ELSE 0 END)::int              AS unpersisted
      FROM llm_calls
      WHERE agent = 'halluc-ungrounded'
      GROUP BY novel_id
      ORDER BY total DESC
      LIMIT 50
    `
    printTable(rows)
  } else {
    // Most recent 100 calls summary
    const rows = await db<Row[]>`
      SELECT
        novel_id,
        COUNT(*)::int                                                                AS total,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'pass' THEN 1 ELSE 0 END)::int          AS pass_count,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'ner+llm-blocker' THEN 1 ELSE 0 END)::int AS ner_llm_blocker,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'ner-only-warning' THEN 1 ELSE 0 END)::int AS ner_only_warning,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'llm-only-blocker' THEN 1 ELSE 0 END)::int AS llm_only_blocker,
        SUM(CASE WHEN ner_prepass_json->>'andGateDecision' = 'disabled' THEN 1 ELSE 0 END)::int       AS disabled_count,
        SUM(CASE WHEN ner_prepass_json IS NULL THEN 1 ELSE 0 END)::int              AS unpersisted
      FROM (
        SELECT novel_id, ner_prepass_json
        FROM llm_calls
        WHERE agent = 'halluc-ungrounded'
        ORDER BY timestamp DESC
        LIMIT 100
      ) recent
      GROUP BY novel_id
      ORDER BY total DESC
    `
    console.log("Most recent 100 halluc-ungrounded calls (per novel):")
    printTable(rows)
  }

  await db.end()
}

function printTable(rows: Row[]) {
  if (rows.length === 0) {
    console.log("No rows found.")
    return
  }

  const header = "novel_id".padEnd(24) +
    " | total" +
    " | pass" +
    " | NER+LLM" +
    " | NER-only" +
    " | LLM-only" +
    " | disabled" +
    " | unpersisted"
  console.log(header)
  console.log("-".repeat(header.length))

  for (const r of rows) {
    const nid = (r.novel_id ?? "null").slice(0, 22).padEnd(24)
    const total = String(r.total).padStart(6)
    const pass = String(r.pass_count).padStart(6)
    const ner_llm = String(r.ner_llm_blocker).padStart(8)
    const ner_only = String(r.ner_only_warning).padStart(9)
    const llm_only = String(r.llm_only_blocker).padStart(9)
    const dis = String(r.disabled_count).padStart(9)
    const unp = String(r.unpersisted).padStart(12)
    console.log(`${nid} | ${total} | ${pass} | ${ner_llm} | ${ner_only} | ${llm_only} | ${dis} | ${unp}`)
  }

  // Summary totals
  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      pass_count: acc.pass_count + r.pass_count,
      ner_llm_blocker: acc.ner_llm_blocker + r.ner_llm_blocker,
      ner_only_warning: acc.ner_only_warning + r.ner_only_warning,
      llm_only_blocker: acc.llm_only_blocker + r.llm_only_blocker,
      disabled_count: acc.disabled_count + r.disabled_count,
      unpersisted: acc.unpersisted + r.unpersisted,
    }),
    { total: 0, pass_count: 0, ner_llm_blocker: 0, ner_only_warning: 0, llm_only_blocker: 0, disabled_count: 0, unpersisted: 0 },
  )
  console.log("-".repeat(header.length))
  const tNid = "TOTAL".padEnd(24)
  console.log(
    `${tNid} | ${String(totals.total).padStart(6)} | ${String(totals.pass_count).padStart(6)} | ` +
    `${String(totals.ner_llm_blocker).padStart(8)} | ${String(totals.ner_only_warning).padStart(9)} | ` +
    `${String(totals.llm_only_blocker).padStart(9)} | ${String(totals.disabled_count).padStart(9)} | ` +
    `${String(totals.unpersisted).padStart(12)}`,
  )

  if (totals.total > 0) {
    const pct = (n: number) => ((n / totals.total) * 100).toFixed(1) + "%"
    console.log(
      `\nRates (of ${totals.total} calls): pass=${pct(totals.pass_count)} ` +
      `ner+llm=${pct(totals.ner_llm_blocker)} ner-only=${pct(totals.ner_only_warning)} ` +
      `llm-only=${pct(totals.llm_only_blocker)} disabled=${pct(totals.disabled_count)} ` +
      `unpersisted=${pct(totals.unpersisted)}`,
    )
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
