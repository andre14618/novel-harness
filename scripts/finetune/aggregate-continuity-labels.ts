/**
 * Aggregate Sonnet subagent labeling results for the continuity-checker SFT dataset.
 *
 * Reads:  /tmp/continuity-label/results_NN.jsonl  (12 subagent output files)
 *         lora-data/continuity-pairs.jsonl         (original pairs with messages)
 * Writes: /tmp/continuity-label/combined.jsonl     (per-pair label audit)
 *         lora-data/continuity-pairs-sonnet-labeled.jsonl  (training-ready JSONL)
 *         tuning_experiment row
 *
 * Training pair format:
 *   messages[0] = system (continuity checker prompt)
 *   messages[1] = user   (draft + facts + states)
 *   messages[2] = assistant ({"issues": [{"severity":...,"description":...,"conflictsWith":...}]})
 *
 * Usage:
 *   bun scripts/aggregate-continuity-labels.ts
 *   RESULTS_DIR=/tmp/continuity-label bun scripts/aggregate-continuity-labels.ts
 */

import { readdirSync, readFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../../data/db"

const RESULTS_DIR  = process.env.RESULTS_DIR ?? "/tmp/continuity-label"
const PAIRS_PATH   = join(import.meta.dir, "../lora-data/continuity-pairs.jsonl")
const OUT_COMBINED = join(RESULTS_DIR, "combined.jsonl")
const OUT_TRAIN    = join(import.meta.dir, "../lora-data/continuity-pairs-sonnet-labeled.jsonl")

interface LabelResult {
  id: string
  scenario: string
  variant: string
  found_severities: string[]
  expected_severities: string[]
  match: boolean
  sonnet_issues: Array<{ severity: string; description: string; conflictsWith: string }>
  note: string | null
}

interface OriginalPair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string; draft?: string }
}

function pct(n: number, d: number) {
  return d === 0 ? "—" : `${Math.round(n / d * 100)}%`
}

async function main() {
  // ── Read all result files ──────────────────────────────────────────────
  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith("results_") && f.endsWith(".jsonl"))
    .sort()

  if (files.length === 0) {
    console.error(`No results_*.jsonl found in ${RESULTS_DIR}`)
    process.exit(1)
  }

  const allResults: LabelResult[] = []
  for (const f of files) {
    const text = readFileSync(join(RESULTS_DIR, f), "utf8").trim()
    for (const line of text.split("\n").filter(Boolean)) {
      allResults.push(JSON.parse(line))
    }
  }
  console.log(`Read ${allResults.length} results from ${files.length} files`)

  // ── Load original pairs (to reconstruct messages) ─────────────────────
  const origLines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  const origPairs: OriginalPair[] = origLines.map(l => JSON.parse(l))

  // Build lookup by scenario+variant
  const pairLookup = new Map<string, OriginalPair>()
  for (const p of origPairs) {
    pairLookup.set(`${p._meta.scenario}_${p._meta.variant}`, p)
  }

  // ── Write combined audit ───────────────────────────────────────────────
  if (existsSync(OUT_COMBINED)) unlinkSync(OUT_COMBINED)
  const combinedLines = allResults.map(r => JSON.stringify(r))
  await Bun.write(OUT_COMBINED, combinedLines.join("\n") + "\n")
  console.log(`Combined audit: ${OUT_COMBINED}`)

  // ── Build training JSONL ───────────────────────────────────────────────
  if (existsSync(OUT_TRAIN)) unlinkSync(OUT_TRAIN)
  let trainWritten = 0
  let trainSkipped = 0

  const trainLines: string[] = []
  for (const r of allResults) {
    const key = `${r.scenario}_${r.variant}`
    const orig = pairLookup.get(key)

    if (!orig) {
      console.warn(`  No original pair found for ${key} — skipping`)
      trainSkipped++
      continue
    }

    // Build the assistant response from Sonnet's found issues
    const assistantContent = JSON.stringify({
      issues: r.sonnet_issues ?? [],
    })

    const trainPair = {
      messages: [
        orig.messages[0],
        orig.messages[1],
        { role: "assistant", content: assistantContent },
      ],
      _meta: {
        ...orig._meta,
        teacher: "claude-sonnet-4-6",
        found_severities: r.found_severities,
        expected_severities: r.expected_severities,
        label_match: r.match,
        note: r.note ?? null,
      },
    }
    trainLines.push(JSON.stringify(trainPair))
    trainWritten++
  }
  await Bun.write(OUT_TRAIN, trainLines.join("\n") + "\n")
  console.log(`Training JSONL: ${OUT_TRAIN} (${trainWritten} pairs, ${trainSkipped} skipped)`)

  // ── Accuracy report ───────────────────────────────────────────────────
  const variants = ["VAR_NONE","VAR_BLOCKER","VAR_WARNING","VAR_NIT","VAR_TRAP","VAR_MULTI"]
  const byVariant: Record<string, { match: number; total: number; mismatches: LabelResult[] }> = {}
  for (const v of variants) byVariant[v] = { match: 0, total: 0, mismatches: [] }

  for (const r of allResults) {
    if (!byVariant[r.variant]) byVariant[r.variant] = { match: 0, total: 0, mismatches: [] }
    byVariant[r.variant].total++
    if (r.match) byVariant[r.variant].match++
    else byVariant[r.variant].mismatches.push(r)
  }

  const totalMatch = allResults.filter(r => r.match).length
  const total = allResults.length

  console.log("\n" + "═".repeat(60))
  console.log(`CONTINUITY SONNET LABELING — accuracy vs expected labels`)
  console.log("═".repeat(60))

  // Thresholds from SOP
  const thresholds: Record<string, number> = {
    VAR_BLOCKER: 95, VAR_WARNING: 80, VAR_NIT: 80,
    VAR_TRAP: 90, VAR_NONE: 95, VAR_MULTI: 85,
  }

  for (const v of variants) {
    const s = byVariant[v]
    const accuracy = s.total === 0 ? 0 : Math.round(s.match / s.total * 100)
    const threshold = thresholds[v] ?? 80
    const status = accuracy >= threshold ? "PASS" : "FAIL"
    console.log(`${v.padEnd(14)} ${accuracy}% (${s.match}/${s.total})   threshold: ${threshold}%   ${status}`)
    if (s.mismatches.length > 0) {
      for (const mm of s.mismatches) {
        console.log(`  mismatch: ${mm.scenario} | found: [${mm.found_severities}] expected: [${mm.expected_severities}]${mm.note ? ` — ${mm.note}` : ""}`)
      }
    }
  }

  console.log("─".repeat(60))
  const overallAccuracy = Math.round(totalMatch / total * 100)
  const overallStatus = overallAccuracy >= 82 ? "PASS — accept for training" : "FAIL — below 82% threshold"
  console.log(`OVERALL        ${overallAccuracy}% (${totalMatch}/${total})   ${overallStatus}`)

  // ── DB record ─────────────────────────────────────────────────────────
  const expId = await createTuningExperiment(
    "data-generation",
    `Continuity-checker Sonnet teacher labeling — ${total} pairs, ${overallAccuracy}% accuracy`,
    {
      pairs: total,
      teacher: "claude-sonnet-4-6",
      batchSize: 10,
      subagents: files.length,
      inputFile: "lora-data/continuity-pairs.jsonl",
      outputFile: "lora-data/continuity-pairs-sonnet-labeled.jsonl",
      auditFile: join(RESULTS_DIR, "combined.jsonl"),
      overallAccuracy,
      byVariant: Object.fromEntries(
        Object.entries(byVariant).map(([v, s]) => [v, { match: s.match, total: s.total, pct: Math.round(s.match / (s.total || 1) * 100) }])
      ),
    },
    { target: "continuity", dimension: "calibration" }
  )

  const conclusion = `Sonnet teacher labeling: ${totalMatch}/${total} matches (${overallAccuracy}%). ` +
    `${overallStatus}. Training JSONL: lora-data/continuity-pairs-sonnet-labeled.jsonl. ` +
    `Mismatches: ${total - totalMatch} pairs flagged for human review before V2 training.`
  await concludeExperiment(expId, conclusion)
  console.log(`\nExp #${expId} concluded.`)
  console.log(`\nNext steps:`)
  console.log(`  rsync novel-harness-lxc:/tmp/continuity-label/combined.jsonl lora-data/continuity-pairs-sonnet-labeled-audit.jsonl`)
  console.log(`  (Training JSONL already written to lora-data/continuity-pairs-sonnet-labeled.jsonl)`)
}

main().catch(e => { console.error(e); process.exit(1) })
