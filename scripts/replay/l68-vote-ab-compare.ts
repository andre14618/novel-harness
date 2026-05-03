#!/usr/bin/env bun
/**
 * L68 / Lever G-D A/B comparison: N=1 baseline vs N=2 multi-call vote/union.
 *
 * For each (n1, n2) novel pair on the same seed:
 *   - halluc-ungrounded blocker fire counts (chapter 1 attempt 1, plus all attempts)
 *   - chapter approval rate
 *   - distinct chapter-blocking entities surfaced per beat (union recall)
 *   - checker stability — at N=2, a beat with both calls flagging the same
 *     entity is "stable"; flagging disjoint sets is "stochastic"
 *   - total cost + LLM call count
 *
 * Usage:
 *   bun scripts/replay/l68-vote-ab-compare.ts \
 *     --pair seed=fantasy-archive,n1=novel-...,n2=novel-... \
 *     --pair seed=fantasy-debt,n1=novel-...,n2=novel-... \
 *     --pair seed=fantasy-system-heretic,n1=novel-...,n2=novel-...
 *
 * Outputs to stdout AND a timestamped JSON to /tmp/l68-vote-ab.<ts>.json so
 * the per-overwrite memory rule (`feedback_no_overwrite_runs.md`) holds.
 */

import db from "../../src/db/connection"
import { writeFileSync } from "node:fs"

interface Pair {
  seed: string
  n1: string
  n2: string
}

interface PerArmStats {
  novelId: string
  arm: "n1-baseline" | "n2-vote"
  hallucFiresAttempt1: number
  hallucFiresAll: number
  chaptersApproved: number
  totalChapters: number
  planCheckExhaustedRows: number
  totalCostUsd: number
  totalLLMCalls: number
  totalHallucCalls: number
  // L68-specific: how many beats had at least 2 vote rows? (sanity check)
  beatsWithVoteFanout: number
  // distinct entities flagged across all halluc calls (union recall proxy)
  distinctEntitiesFlagged: number
  chapterPropertyTable: Array<{
    chapter: number
    bestAttempt: number | null
    approved: boolean
    hallucBlockersAcrossAttempts: number
    distinctEntities: number
    bailKind: string | null
    bailEntity: string | null
  }>
}

function parseArgs(): Pair[] {
  const pairs: Pair[] = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--pair") {
      const spec = process.argv[i + 1] ?? ""
      const parts = Object.fromEntries(spec.split(",").map(p => p.split("=") as [string, string]))
      const seed = parts.seed
      const n1 = parts.n1
      const n2 = parts.n2
      if (seed && n1 && n2) pairs.push({ seed, n1, n2 })
    }
  }
  return pairs
}

async function statsFor(novelId: string, arm: "n1-baseline" | "n2-vote"): Promise<PerArmStats> {
  const hallucRows = await db<Array<{ id: number; chapter: number; attempt: number; response_content: string; ner_prepass_json: any }>>`
    SELECT id, chapter, attempt, response_content, ner_prepass_json
    FROM llm_calls
    WHERE novel_id = ${novelId} AND agent = 'halluc-ungrounded'
    ORDER BY id
  `

  let hallucFiresAttempt1 = 0
  let hallucFiresAll = 0
  let beatsWithVoteFanout = 0
  const distinctEntities = new Set<string>()
  for (const r of hallucRows) {
    let issues: Array<{ entity: string }> = []
    try {
      const parsed = JSON.parse(r.response_content)
      if (parsed?.pass === false && Array.isArray(parsed?.issues)) issues = parsed.issues
    } catch { continue }
    if (issues.length === 0) continue
    hallucFiresAll += issues.length
    if (r.attempt === 1) hallucFiresAttempt1 += issues.length
    for (const i of issues) distinctEntities.add(i.entity.toLowerCase().trim())

    // L68 sanity: vote rows are tagged in ner_prepass_json
    const ner = typeof r.ner_prepass_json === "string"
      ? JSON.parse(r.ner_prepass_json)
      : r.ner_prepass_json
    if (ner?.voteN != null && ner.voteN > 1) beatsWithVoteFanout += 1
  }

  // Chapter approval status (latest version per chapter)
  const draftRows = await db<Array<{ chapter_number: number; status: string; version: number }>>`
    SELECT chapter_number, status, version
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number, version DESC
  `
  const latestPerChapter = new Map<number, { status: string; version: number }>()
  for (const d of draftRows) {
    if (!latestPerChapter.has(d.chapter_number)) {
      latestPerChapter.set(d.chapter_number, { status: d.status, version: d.version })
    }
  }
  const chaptersApproved = [...latestPerChapter.values()].filter(c => c.status === "approved").length
  const totalChapters = latestPerChapter.size

  // Plan-check-exhausted citing halluc-ungrounded
  const exhRows = await db<Array<{ chapter: number; kind: string; unresolved_deviations: any }>>`
    SELECT chapter, kind, unresolved_deviations
    FROM chapter_exhaustions
    WHERE novel_id = ${novelId}
  `
  const planCheckExhaustedRows = exhRows.filter(e => {
    if (e.kind !== "plan-check-exhausted") return false
    const raw = typeof e.unresolved_deviations === "string"
      ? JSON.parse(e.unresolved_deviations)
      : (e.unresolved_deviations ?? [])
    return raw.some((d: { description?: string }) => (d.description ?? "").includes("halluc-ungrounded"))
  }).length

  // Total cost + total LLM calls
  const [totalsRow] = await db<Array<{ cost: string; calls: string }>>`
    SELECT COALESCE(SUM(cost), 0)::text as cost, COUNT(*)::text as calls
    FROM llm_calls
    WHERE novel_id = ${novelId}
  `
  const totalCostUsd = parseFloat(totalsRow?.cost ?? "0")
  const totalLLMCalls = parseInt(totalsRow?.calls ?? "0", 10)

  // Per-chapter rollup
  const chapterPropertyTable: PerArmStats["chapterPropertyTable"] = []
  for (const [chapter, c] of [...latestPerChapter.entries()].sort((a, b) => a[0] - b[0])) {
    const chapterEntities = new Set<string>()
    let blockersForChapter = 0
    for (const r of hallucRows.filter(r => r.chapter === chapter)) {
      try {
        const p = JSON.parse(r.response_content)
        if (p?.pass === false && Array.isArray(p?.issues)) {
          blockersForChapter += p.issues.length
          for (const i of p.issues) chapterEntities.add(i.entity.toLowerCase().trim())
        }
      } catch {}
    }
    const exhForChapter = exhRows.find(e => e.chapter === chapter)
    let bailEntity: string | null = null
    if (exhForChapter) {
      const raw = typeof exhForChapter.unresolved_deviations === "string"
        ? JSON.parse(exhForChapter.unresolved_deviations)
        : (exhForChapter.unresolved_deviations ?? [])
      const m = raw[0]?.description?.match?.(/Ungrounded entity "([^"]+)"/)
      bailEntity = m?.[1] ?? null
    }
    chapterPropertyTable.push({
      chapter,
      bestAttempt: c.version,
      approved: c.status === "approved",
      hallucBlockersAcrossAttempts: blockersForChapter,
      distinctEntities: chapterEntities.size,
      bailKind: exhForChapter?.kind ?? null,
      bailEntity,
    })
  }

  return {
    novelId, arm,
    hallucFiresAttempt1, hallucFiresAll,
    chaptersApproved, totalChapters,
    planCheckExhaustedRows,
    totalCostUsd, totalLLMCalls,
    totalHallucCalls: hallucRows.length,
    beatsWithVoteFanout,
    distinctEntitiesFlagged: distinctEntities.size,
    chapterPropertyTable,
  }
}

function reportArm(s: PerArmStats): string {
  const lines: string[] = []
  lines.push(`  ${s.arm.padEnd(13)} (${s.novelId})`)
  lines.push(`    halluc-ungrounded blocker fires (att 1):  ${s.hallucFiresAttempt1}`)
  lines.push(`    halluc-ungrounded blocker fires (all):    ${s.hallucFiresAll}`)
  lines.push(`    distinct entities flagged (union recall): ${s.distinctEntitiesFlagged}`)
  lines.push(`    chapters approved:                        ${s.chaptersApproved} / ${s.totalChapters}`)
  lines.push(`    plan-check-exhausted (halluc-cited):      ${s.planCheckExhaustedRows}`)
  lines.push(`    total cost:                               $${s.totalCostUsd.toFixed(4)}`)
  lines.push(`    total LLM calls / halluc calls:           ${s.totalLLMCalls} / ${s.totalHallucCalls}`)
  lines.push(`    rows tagged voteN>1:                      ${s.beatsWithVoteFanout}`)
  for (const c of s.chapterPropertyTable) {
    const flag = c.approved ? "✓" : "✗"
    const bail = c.bailEntity ? ` bailed-on="${c.bailEntity}"` : c.bailKind ? ` bail=${c.bailKind}` : ""
    lines.push(`      ${flag} ch${c.chapter}  best-att=${c.bestAttempt}  blockers=${c.hallucBlockersAcrossAttempts}  distinct=${c.distinctEntities}${bail}`)
  }
  return lines.join("\n")
}

async function main() {
  const pairs = parseArgs()
  if (pairs.length === 0) {
    console.error("Usage: bun scripts/replay/l68-vote-ab-compare.ts --pair seed=X,n1=novel-...,n2=novel-... [--pair ...]")
    process.exit(1)
  }

  const allArms: PerArmStats[] = []
  for (const pair of pairs) {
    console.log(`\n=== seed=${pair.seed} ===`)
    const n1 = await statsFor(pair.n1, "n1-baseline")
    const n2 = await statsFor(pair.n2, "n2-vote")
    console.log(reportArm(n1))
    console.log(reportArm(n2))

    // Per-pair headline delta
    const att1Delta = n1.hallucFiresAttempt1 === 0
      ? "n/a (n1 had 0 att-1 blockers)"
      : `${(((n2.hallucFiresAttempt1 - n1.hallucFiresAttempt1) / n1.hallucFiresAttempt1) * 100).toFixed(0)}%`
    const distinctDelta = n1.distinctEntitiesFlagged === 0
      ? "n/a"
      : `${(((n2.distinctEntitiesFlagged - n1.distinctEntitiesFlagged) / n1.distinctEntitiesFlagged) * 100).toFixed(0)}%`
    console.log(`  --- pair headline ---`)
    console.log(`    attempt-1 blockers:   n1=${n1.hallucFiresAttempt1} → n2=${n2.hallucFiresAttempt1} (${att1Delta})`)
    console.log(`    distinct entities:    n1=${n1.distinctEntitiesFlagged} → n2=${n2.distinctEntitiesFlagged} (${distinctDelta})`)
    console.log(`    approved:             n1=${n1.chaptersApproved}/${n1.totalChapters} → n2=${n2.chaptersApproved}/${n2.totalChapters}`)
    console.log(`    plan-check-exh:       n1=${n1.planCheckExhaustedRows} → n2=${n2.planCheckExhaustedRows}`)
    console.log(`    cost ratio:           $${n1.totalCostUsd.toFixed(4)} → $${n2.totalCostUsd.toFixed(4)}  (${(n2.totalCostUsd / Math.max(n1.totalCostUsd, 0.0001)).toFixed(2)}x)`)
    allArms.push(n1, n2)
  }

  // Roll-up across pairs
  const sumApproved = (arm: "n1-baseline" | "n2-vote") =>
    allArms.filter(a => a.arm === arm).reduce((acc, a) => acc + a.chaptersApproved, 0)
  const sumTotal = (arm: "n1-baseline" | "n2-vote") =>
    allArms.filter(a => a.arm === arm).reduce((acc, a) => acc + a.totalChapters, 0)
  const sumDistinct = (arm: "n1-baseline" | "n2-vote") =>
    allArms.filter(a => a.arm === arm).reduce((acc, a) => acc + a.distinctEntitiesFlagged, 0)
  const sumAtt1 = (arm: "n1-baseline" | "n2-vote") =>
    allArms.filter(a => a.arm === arm).reduce((acc, a) => acc + a.hallucFiresAttempt1, 0)
  const sumCost = (arm: "n1-baseline" | "n2-vote") =>
    allArms.filter(a => a.arm === arm).reduce((acc, a) => acc + a.totalCostUsd, 0)

  console.log(`\n=== rollup across all pairs ===`)
  console.log(`  approved chapters:       n1=${sumApproved("n1-baseline")}/${sumTotal("n1-baseline")} → n2=${sumApproved("n2-vote")}/${sumTotal("n2-vote")}`)
  console.log(`  distinct entities:       n1=${sumDistinct("n1-baseline")} → n2=${sumDistinct("n2-vote")}`)
  console.log(`  att-1 halluc blockers:   n1=${sumAtt1("n1-baseline")} → n2=${sumAtt1("n2-vote")}`)
  console.log(`  total cost:              n1=$${sumCost("n1-baseline").toFixed(4)} → n2=$${sumCost("n2-vote").toFixed(4)}`)

  // Persist a timestamped JSON snapshot for later analysis.
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)
  const outPath = `/tmp/l68-vote-ab.${ts}.json`
  writeFileSync(outPath, JSON.stringify({ pairs, arms: allArms }, null, 2))
  console.log(`\nPersisted: ${outPath}`)

  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })
