/**
 * Adapter registry status printer. Queries adapter_registry and prints the
 * deployed slate grouped by slot, plus candidates and retired.
 *
 * Usage:
 *   bun scripts/finetune/adapter-status.ts              # all
 *   bun scripts/finetune/adapter-status.ts --deployed   # deployed only
 *   bun scripts/finetune/adapter-status.ts --slot writer/fantasy
 */

import db from "../../src/db/connection"

async function main() {
  const args = process.argv.slice(2)
  const deployedOnly = args.includes("--deployed")
  const slotIdx = args.indexOf("--slot")
  const slotFilter = slotIdx >= 0 ? args[slotIdx + 1] : null

  const rows = (await db`
    SELECT r.uri, r.name, r.slot, r.base_model, r.status,
           r.training_experiment_id, r.eval_experiment_ids,
           r.deployed_at, r.retired_at, r.headline_metrics,
           r.supersedes,
           t.conclusion AS training_conclusion
    FROM adapter_registry r
    LEFT JOIN tuning_experiments t ON t.id = r.training_experiment_id
    ORDER BY CASE r.status
             WHEN 'deployed'  THEN 1
             WHEN 'candidate' THEN 2
             WHEN 'retired'   THEN 3
             WHEN 'rejected'  THEN 4
             ELSE 5 END, r.slot NULLS LAST, r.name
  `) as any[]

  const filtered = rows.filter(r => {
    if (deployedOnly && r.status !== "deployed") return false
    if (slotFilter && r.slot !== slotFilter) return false
    return true
  })

  if (filtered.length === 0) {
    console.log("No adapters match filter.")
    process.exit(0)
  }

  // Group by status
  const byStatus: Record<string, any[]> = {}
  for (const r of filtered) (byStatus[r.status] ??= []).push(r)

  for (const status of ["deployed", "candidate", "retired", "rejected"]) {
    const group = byStatus[status]
    if (!group?.length) continue
    console.log(`\n── ${status.toUpperCase()} (${group.length}) ──`)
    for (const r of group) {
      const hm = typeof r.headline_metrics === "string" ? JSON.parse(r.headline_metrics) : r.headline_metrics
      const metrics = hm ? summarizeMetrics(hm) : "—"
      const exps = [
        r.training_experiment_id ? `train=#${r.training_experiment_id}` : null,
        r.eval_experiment_ids?.length ? `eval=[${r.eval_experiment_ids.join(",")}]` : null,
      ].filter(Boolean).join(" ")
      console.log(`  ${r.name.padEnd(32)}  slot=${(r.slot ?? "(none)").padEnd(24)}  ${exps}`)
      console.log(`    URI: ${r.uri}`)
      console.log(`    Metrics: ${metrics}`)
      if (r.supersedes) console.log(`    Supersedes: ${r.supersedes}`)
    }
  }
  console.log()
  process.exit(0)
}

function summarizeMetrics(m: Record<string, any>): string {
  const keys = ["precision", "recall", "f1", "accuracy", "sonnet_agreement", "first_attempt_pass",
    "phase_c3_delta_sum", "max_5gram_jaccard", "latency_ms", "latency_ms_warm"]
  const parts: string[] = []
  for (const k of keys) {
    if (m[k] === undefined || m[k] === null) continue
    const v = m[k]
    parts.push(`${k}=${typeof v === "number" && v < 1 ? (v * 100).toFixed(1) + "%" : v}`)
  }
  return parts.join(" ") || JSON.stringify(m).slice(0, 80)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
