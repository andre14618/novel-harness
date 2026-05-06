#!/usr/bin/env bun
/**
 * L66 A/B comparison: v0 (exp #392, pre-prompt) vs v1 (exp #394, post-prompt).
 *
 * Compares halluc-ungrounded blocker fire counts at the chapter level,
 * chapter approval rate, and prose word counts to size the L66 lever's effect.
 *
 * Both runs are 3-chapter smokes on the `fantasy-archive` seed; only the
 * writer's beat-writer-system.md changes between them.
 */

import db from "../../src/db/connection"
import { parseJsonbArray } from "../../src/db/jsonb"

const V0_NOVEL = "novel-1777770759949"  // exp #392, pre-L66
const V1_NOVEL = "novel-1777773057417"  // exp #394, post-L66

interface PerArmStats {
  novelId: string
  label: "v0 (pre-L66)" | "v1 (post-L66)"
  hallucFiresAttempt1: number             // halluc-ungrounded LLM-confirmed blocker fires on attempt 1 across all beats and chapters
  hallucFiresAll: number                   // same, across all chapter-attempts
  chaptersApproved: number
  totalChapters: number
  planCheckExhaustedRows: number           // chapter_exhaustions rows for this novel with kind=plan-check-exhausted that cite halluc-ungrounded
  totalCostUsd: number
  totalLLMCalls: number
  chapterPropertyTable: Array<{
    chapter: number
    bestAttempt: number | null
    approved: boolean
    hallucBlockersAcrossAttempts: number
    bailKind: string | null
    bailEntity: string | null
  }>
}

async function statsFor(novelId: string, label: PerArmStats["label"]): Promise<PerArmStats> {
  // Halluc-ungrounded fires
  const hallucRows = await db<Array<{ id: number; chapter: number; attempt: number; response_content: string }>>`
    SELECT id, chapter, attempt, response_content
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'halluc-ungrounded'
    ORDER BY id
  `

  let hallucFiresAttempt1 = 0
  let hallucFiresAll = 0
  for (const r of hallucRows) {
    let issues: Array<{ entity: string }> = []
    try {
      const parsed = JSON.parse(r.response_content)
      if (parsed?.pass === false && Array.isArray(parsed?.issues)) issues = parsed.issues
    } catch {
      continue
    }
    if (issues.length === 0) continue
    hallucFiresAll += issues.length
    if (r.attempt === 1) hallucFiresAttempt1 += issues.length
  }

  // Chapter approval status
  const draftRows = await db<Array<{ chapter_number: number; status: string; version: number }>>`
    SELECT chapter_number, status, version
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number, version DESC
  `
  // Latest version per chapter
  const latestPerChapter = new Map<number, { status: string; version: number }>()
  for (const d of draftRows) {
    if (!latestPerChapter.has(d.chapter_number)) {
      latestPerChapter.set(d.chapter_number, { status: d.status, version: d.version })
    }
  }
  const chaptersApproved = [...latestPerChapter.values()].filter(c => c.status === "approved").length
  const totalChapters = latestPerChapter.size

  // Plan-check-exhausted rows mentioning halluc-ungrounded
  const exhRows = await db<Array<{ chapter: number; kind: string; unresolved_deviations: any }>>`
    SELECT chapter, kind, unresolved_deviations
    FROM chapter_exhaustions
    WHERE novel_id = ${novelId}
  `
  const planCheckExhaustedRows = exhRows.filter(e => {
    if (e.kind !== "plan-check-exhausted") return false
    const deviations = parseJsonbArray<{ description?: string }>(e.unresolved_deviations)
    return deviations.some((d: { description?: string }) =>
      (d.description ?? "").includes("halluc-ungrounded"))
  }).length

  // Total cost + call count
  const [totalsRow] = await db<Array<{ cost: string; calls: string }>>`
    SELECT COALESCE(SUM(cost), 0)::text as cost, COUNT(*)::text as calls
    FROM llm_calls
    WHERE novel_id = ${novelId}
  `
  const totalCostUsd = parseFloat(totalsRow?.cost ?? "0")
  const totalLLMCalls = parseInt(totalsRow?.calls ?? "0", 10)

  // Per-chapter breakdown
  const chapterPropertyTable: PerArmStats["chapterPropertyTable"] = []
  for (const [chapter, c] of [...latestPerChapter.entries()].sort((a, b) => a[0] - b[0])) {
    const blockersForChapter = hallucRows.filter(r => r.chapter === chapter).reduce((acc, r) => {
      try {
        const p = JSON.parse(r.response_content)
        if (p?.pass === false && Array.isArray(p?.issues)) return acc + p.issues.length
      } catch {}
      return acc
    }, 0)
    const exhForChapter = exhRows.find(e => e.chapter === chapter)
    let bailEntity: string | null = null
    if (exhForChapter) {
      const deviations = parseJsonbArray<{ description?: string }>(exhForChapter.unresolved_deviations)
      const m = deviations[0]?.description?.match?.(/Ungrounded entity "([^"]+)"/)
      bailEntity = m?.[1] ?? null
    }
    chapterPropertyTable.push({
      chapter,
      bestAttempt: c.version,
      approved: c.status === "approved",
      hallucBlockersAcrossAttempts: blockersForChapter,
      bailKind: exhForChapter?.kind ?? null,
      bailEntity,
    })
  }

  return {
    novelId, label,
    hallucFiresAttempt1, hallucFiresAll,
    chaptersApproved, totalChapters,
    planCheckExhaustedRows,
    totalCostUsd, totalLLMCalls,
    chapterPropertyTable,
  }
}

async function main() {
  const v0 = await statsFor(V0_NOVEL, "v0 (pre-L66)")
  const v1 = await statsFor(V1_NOVEL, "v1 (post-L66)")

  for (const arm of [v0, v1]) {
    console.log(`\n=== ${arm.label} (novel ${arm.novelId}) ===`)
    console.log(`  halluc-ungrounded blocker fires (attempt 1):  ${arm.hallucFiresAttempt1}`)
    console.log(`  halluc-ungrounded blocker fires (all retry):  ${arm.hallucFiresAll}`)
    console.log(`  chapters approved:                            ${arm.chaptersApproved} / ${arm.totalChapters}`)
    console.log(`  plan-check-exhausted (halluc-cited):          ${arm.planCheckExhaustedRows}`)
    console.log(`  total cost:                                   $${arm.totalCostUsd.toFixed(4)}`)
    console.log(`  total LLM calls:                              ${arm.totalLLMCalls}`)
    console.log(`  per-chapter:`)
    for (const c of arm.chapterPropertyTable) {
      const flag = c.approved ? "✓" : "✗"
      const bail = c.bailEntity ? ` bailed-on="${c.bailEntity}"` : c.bailKind ? ` bail=${c.bailKind}` : ""
      console.log(`    ${flag} ch${c.chapter}  best-attempt=${c.bestAttempt ?? "?"}  halluc-blockers=${c.hallucBlockersAcrossAttempts}${bail}`)
    }
  }

  // Headline delta
  const att1Delta = v0.hallucFiresAttempt1 === 0
    ? "n/a (v0 had 0 attempt-1 blockers)"
    : `${(((v0.hallucFiresAttempt1 - v1.hallucFiresAttempt1) / v0.hallucFiresAttempt1) * 100).toFixed(0)}%`
  console.log(`\n=== A/B headline ===`)
  console.log(`  attempt-1 halluc-blocker reduction:  v0=${v0.hallucFiresAttempt1} → v1=${v1.hallucFiresAttempt1}  (${att1Delta})`)
  console.log(`  approval rate:                       v0=${v0.chaptersApproved}/${v0.totalChapters} → v1=${v1.chaptersApproved}/${v1.totalChapters}`)
  console.log(`  plan-check-exhausted (halluc):       v0=${v0.planCheckExhaustedRows} → v1=${v1.planCheckExhaustedRows}`)

  await db.end()
}

main().catch(e => { console.error(e); process.exit(1) })
