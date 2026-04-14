/**
 * Aggregate Sonnet subagent labeling results for the chapter-plan-checker SFT dataset.
 *
 * Reads:  /tmp/chapter-plan-label/results_NN.jsonl  (subagent output files)
 *         lora-data/chapter-plan-checker-pairs.jsonl (original pairs with messages)
 * Writes: /tmp/chapter-plan-label/combined.jsonl     (per-pair label audit)
 *         lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl  (training-ready JSONL)
 *         tuning_experiment row
 *
 * Training pair format:
 *   messages[0] = system (chapter plan checker prompt)
 *   messages[1] = user   (chapter plan + chapter prose)
 *   messages[2] = assistant (Sonnet's structured response)
 *
 * Usage:
 *   bun scripts/aggregate-chapter-plan-labels.ts
 *   RESULTS_DIR=/tmp/chapter-plan-label bun scripts/aggregate-chapter-plan-labels.ts
 */

import { readdirSync, readFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../../data/db"

const RESULTS_DIR  = process.env.RESULTS_DIR ?? "/tmp/chapter-plan-label"
const PAIRS_PATH   = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")
const OUT_COMBINED = join(RESULTS_DIR, "combined.jsonl")
const OUT_TRAIN    = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl")

interface LabelResult {
  id: number
  scenario: string
  variant: string
  setting_match: { planned: string; observed: string; matches: boolean }
  emotional_arc_correct: boolean
  pass: boolean
  deviations: string[]
  note: string | null
}

interface OriginalPair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

function pct(n: number, d: number) {
  return d === 0 ? "---" : `${Math.round(n / d * 100)}%`
}

async function main() {
  // -- Read all result files ---------------------------------------------------
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
      try {
        allResults.push(JSON.parse(line))
      } catch (e) {
        console.warn(`  Parse error in ${f}: ${line.slice(0, 80)}...`)
      }
    }
  }
  console.log(`Read ${allResults.length} results from ${files.length} files`)

  // -- Load original pairs (to reconstruct messages) --------------------------
  const origLines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  const origPairs: OriginalPair[] = origLines.map(l => JSON.parse(l))

  // Build lookup by scenario+variant
  const pairLookup = new Map<string, OriginalPair>()
  for (const p of origPairs) {
    pairLookup.set(`${p._meta.scenario}_${p._meta.variant}`, p)
  }

  // Deduplicate results (in case of overlapping subagent runs)
  const seenKeys = new Set<string>()
  const dedupResults: LabelResult[] = []
  for (const r of allResults) {
    const key = `${r.scenario}_${r.variant}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    dedupResults.push(r)
  }
  if (dedupResults.length < allResults.length) {
    console.log(`Deduplicated: ${allResults.length} -> ${dedupResults.length} unique results`)
  }

  // -- Write combined audit ---------------------------------------------------
  if (existsSync(OUT_COMBINED)) unlinkSync(OUT_COMBINED)
  const combinedLines = dedupResults.map(r => JSON.stringify(r))
  await Bun.write(OUT_COMBINED, combinedLines.join("\n") + "\n")
  console.log(`Combined audit: ${OUT_COMBINED}`)

  // -- Build training JSONL ---------------------------------------------------
  if (existsSync(OUT_TRAIN)) unlinkSync(OUT_TRAIN)
  let trainWritten = 0
  let trainSkipped = 0

  const trainLines: string[] = []
  for (const r of dedupResults) {
    const key = `${r.scenario}_${r.variant}`
    const orig = pairLookup.get(key)

    if (!orig) {
      console.warn(`  No original pair found for ${key} -- skipping`)
      trainSkipped++
      continue
    }

    // Build assistant response from Sonnet's structured evaluation
    const assistantContent = JSON.stringify({
      setting_match: r.setting_match,
      emotional_arc_correct: r.emotional_arc_correct,
      pass: r.pass,
      deviations: r.deviations,
    })

    // Determine ground-truth pass from variant type.
    // FAIL_MISSING_BEAT v2: redesigned to omit the beat that establishes a required
    // establishedFact — a genuine plan violation (missing required knowledge is a
    // major plot contradiction per the checker prompt). gt_pass=false.
    // Note: 12/65 pairs labeled PASS by Sonnet are legitimate overrides — the Cerebras
    // writer established the required fact through other means despite the beat being
    // absent. Those are correct PASS labels and acceptable training signal.
    const gtPass = r.variant.startsWith("PASS_")

    const trainPair = {
      messages: [
        orig.messages[0],
        orig.messages[1],
        { role: "assistant", content: assistantContent },
      ],
      _meta: {
        scenario: r.scenario,
        variant: r.variant,
        teacher: "claude-sonnet-4-6",
        gt_pass: gtPass,
        teacher_pass: r.pass,
        label_match: r.pass === gtPass,
        note: r.note ?? null,
      },
    }
    trainLines.push(JSON.stringify(trainPair))
    trainWritten++
  }
  await Bun.write(OUT_TRAIN, trainLines.join("\n") + "\n")
  console.log(`Training JSONL: ${OUT_TRAIN} (${trainWritten} pairs, ${trainSkipped} skipped)`)

  // -- Accuracy report --------------------------------------------------------
  const variants = [
    "PASS_CLEAN", "PASS_PARAPHRASE", "PASS_REORDER", "PASS_ATMOSPHERIC",
    "FAIL_MISSING_BEAT", "FAIL_MISSING_CHAR", "FAIL_REVERSED_ARC", "FAIL_WRONG_SETTING",
  ]
  const byVariant: Record<string, { match: number; total: number; mismatches: LabelResult[] }> = {}
  for (const v of variants) byVariant[v] = { match: 0, total: 0, mismatches: [] }

  for (const r of dedupResults) {
    if (!byVariant[r.variant]) byVariant[r.variant] = { match: 0, total: 0, mismatches: [] }
    const gtPass = r.variant.startsWith("PASS_")
    byVariant[r.variant].total++
    if (r.pass === gtPass) byVariant[r.variant].match++
    else byVariant[r.variant].mismatches.push(r)
  }

  const totalMatch = dedupResults.filter(r => r.pass === r.variant.startsWith("PASS_")).length
  const total = dedupResults.length

  console.log("\n" + "=".repeat(70))
  console.log(`CHAPTER PLAN CHECKER SONNET LABELING -- accuracy vs deterministic labels`)
  console.log("=".repeat(70))

  const thresholds: Record<string, number> = {
    PASS_CLEAN: 98, PASS_PARAPHRASE: 95, PASS_REORDER: 90, PASS_ATMOSPHERIC: 95,
    FAIL_MISSING_BEAT: 90, FAIL_MISSING_CHAR: 90, FAIL_REVERSED_ARC: 85, FAIL_WRONG_SETTING: 95,
  }

  for (const v of variants) {
    const s = byVariant[v]
    if (s.total === 0) continue
    const accuracy = Math.round(s.match / s.total * 100)
    const threshold = thresholds[v] ?? 85
    const status = accuracy >= threshold ? "PASS" : "FAIL"
    console.log(`${v.padEnd(22)} ${pct(s.match, s.total).padEnd(8)} (${s.match}/${s.total})  threshold: ${threshold}%  ${status}`)
    if (s.mismatches.length > 0) {
      for (const mm of s.mismatches) {
        console.log(`  mismatch: ${mm.scenario} | sonnet_pass:${mm.pass} gt_pass:${v.startsWith("PASS_")}${mm.note ? ` -- ${mm.note}` : ""}`)
        if (mm.deviations.length > 0) {
          for (const d of mm.deviations) console.log(`    deviation: ${d}`)
        }
      }
    }
  }

  console.log("-".repeat(70))
  const overallAccuracy = Math.round(totalMatch / total * 100)
  const overallStatus = overallAccuracy >= 90 ? "PASS -- accept for training" : "FAIL -- below 90% threshold"
  console.log(`OVERALL              ${pct(totalMatch, total).padEnd(8)} (${totalMatch}/${total})  ${overallStatus}`)

  // -- DB record --------------------------------------------------------------
  const expId = await createTuningExperiment(
    "data-generation",
    `Chapter-plan-checker Sonnet teacher labeling -- ${total} pairs, ${overallAccuracy}% accuracy`,
    {
      pairs: total,
      teacher: "claude-sonnet-4-6",
      method: "subagent",
      subagents: files.length,
      inputFile: "lora-data/chapter-plan-checker-pairs.jsonl",
      outputFile: "lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl",
      auditFile: join(RESULTS_DIR, "combined.jsonl"),
      overallAccuracy,
      byVariant: Object.fromEntries(
        Object.entries(byVariant).map(([v, s]) => [
          v,
          { match: s.match, total: s.total, pct: Math.round(s.match / (s.total || 1) * 100) },
        ])
      ),
      note: "Sonnet replaces gpt-oss-120b. FAIL_MISSING_BEAT v2 redesigned: missing beat now targets a beat that establishes a required establishedFact — genuine plan violation. gt_pass=false. 12/65 labeled PASS by Sonnet are correct overrides (writer conveyed required fact through other means). FAIL_MISSING_CHAR, FAIL_REVERSED_ARC, FAIL_WRONG_SETTING all confirmed as genuine fail cases.",
    },
    { target: "chapter-plan-checker", dimension: "calibration" }
  )

  const conclusion = `Sonnet teacher labeling: ${totalMatch}/${total} matches (${overallAccuracy}%). ` +
    `${overallStatus}. Training JSONL: lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl. ` +
    `Mismatches: ${total - totalMatch} pairs. Method: ${files.length} Claude Code subagents.`
  await concludeExperiment(expId, conclusion)
  console.log(`\nExp #${expId} concluded.`)
  console.log(`\nNext steps:`)
  if (overallAccuracy >= 90) {
    console.log(`  1. Review mismatches in ${OUT_COMBINED}`)
    console.log(`  2. Submit to W&B: python3 scripts/train-lora.py --data lora-data/chapter-plan-checker-pairs-sonnet-v2.jsonl --name chapter-plan-checker-v2 --base OpenPipe/Qwen3-14B-Instruct --project novel-harness`)
  } else {
    console.log(`  1. Investigate mismatches in ${OUT_COMBINED}`)
    console.log(`  2. Fix scenarios or relabel problematic pairs before training`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
