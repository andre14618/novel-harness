/**
 * Merge gpt-oss labels + Sonnet escalation verdicts into the final
 * chapter-plan-checker v2 training dataset.
 *
 * Merge strategy for FAIL_MISSING_BEAT escalation pairs:
 *   ABSENT            → keep with FAIL label (override gpt-oss PASS, was correct all along)
 *   OBLIQUE_REFERENCE → remove (ambiguous training signal)
 *   IN_MEDIAS_RES_CLEAN → accept gpt-oss PASS label (gpt-oss was right)
 *
 * For all other pairs: use gpt-oss label as-is from the v2 training file.
 *
 * Reads:  lora-data/chapter-plan-checker-pairs-gptoss-v2.jsonl  (gpt-oss labeled)
 *         /tmp/missing-beat-escalation/results_NN.jsonl          (Sonnet verdicts)
 *         lora-data/chapter-plan-checker-pairs.jsonl             (originals, for ABSENT override)
 * Writes: lora-data/chapter-plan-checker-pairs-v2-final.jsonl   (training set)
 *         tuning_experiment row
 *
 * Usage:
 *   bun scripts/merge-chapter-plan-v2.ts
 */

import { readdirSync, readFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"

const ESCALATION_DIR = "/tmp/missing-beat-escalation"
const GPTOSS_TRAIN   = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs-gptoss-v2.jsonl")
const ORIG_PAIRS     = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")
const OUT_FINAL      = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs-v2-final.jsonl")

interface EscalationResult {
  pair_id: string
  scenario: string
  beat_1_action: string
  opening_50_words: string
  verdict: "ABSENT" | "OBLIQUE_REFERENCE" | "IN_MEDIAS_RES_CLEAN"
  reasoning: string
}

interface TrainPair {
  messages: Array<{ role: string; content: string }>
  _meta: Record<string, unknown>
}

async function main() {
  // ── Load escalation verdicts ───────────────────────────────────────────
  const escalFiles = readdirSync(ESCALATION_DIR)
    .filter(f => f.startsWith("results_") && f.endsWith(".jsonl"))
    .sort()

  if (escalFiles.length === 0) {
    console.error(`No escalation results found in ${ESCALATION_DIR}`)
    process.exit(1)
  }

  const escalMap = new Map<string, EscalationResult>()
  for (const f of escalFiles) {
    const text = readFileSync(join(ESCALATION_DIR, f), "utf8").trim()
    for (const line of text.split("\n").filter(Boolean)) {
      const r: EscalationResult = JSON.parse(line)
      escalMap.set(r.pair_id, r)
    }
  }
  console.log(`Loaded ${escalMap.size} escalation verdicts from ${escalFiles.length} files`)

  // ── Load gpt-oss labeled training pairs ───────────────────────────────
  const gptossLines = readFileSync(GPTOSS_TRAIN, "utf8").trim().split("\n")
  const gptosspairs: TrainPair[] = gptossLines.map(l => JSON.parse(l))
  console.log(`Loaded ${gptosspairs.length} gpt-oss labeled pairs`)

  // ── Load original pairs (for ABSENT override — need deterministic FAIL label) ──
  const origLines = readFileSync(ORIG_PAIRS, "utf8").trim().split("\n")
  const origMap = new Map<string, TrainPair>()
  for (const line of origLines) {
    const p: TrainPair = JSON.parse(line)
    origMap.set(`${p._meta.scenario}_${p._meta.variant}`, p)
  }

  // ── Apply merge strategy ───────────────────────────────────────────────
  const finalPairs: TrainPair[] = []
  let kept = 0, overridden = 0, removed = 0, passedThrough = 0

  const variantCounts: Record<string, number> = {}

  for (const pair of gptosspairs) {
    const pairId = `${pair._meta.scenario}_${pair._meta.variant}`
    const variant = pair._meta.variant as string

    if (variant === "FAIL_MISSING_BEAT") {
      const verdict = escalMap.get(pairId)

      if (!verdict) {
        // No escalation record = was NOT a gpt-oss false positive, keep as-is
        finalPairs.push(pair)
        kept++
        variantCounts[variant] = (variantCounts[variant] ?? 0) + 1
        continue
      }

      if (verdict.verdict === "ABSENT") {
        // gpt-oss was wrong (said PASS), Sonnet confirms FAIL → use deterministic label
        const origPair = origMap.get(pairId)
        if (!origPair) {
          console.warn(`No original pair for ${pairId} — using gpt-oss pair with FAIL override`)
          const overridePair: TrainPair = {
            ...pair,
            messages: [
              pair.messages[0],
              pair.messages[1],
              { role: "assistant", content: JSON.stringify({ pass: false, deviations: [`Missing beat: beat 1 does not occur in the prose`] }) },
            ],
            _meta: { ...pair._meta, teacher_override: "sonnet-escalation:ABSENT" },
          }
          finalPairs.push(overridePair)
        } else {
          // Use the deterministic label from the original pair
          const overridePair: TrainPair = {
            messages: [
              origPair.messages[0],
              origPair.messages[1],
              origPair.messages[2],  // deterministic FAIL label
            ],
            _meta: { ...origPair._meta, teacher: "sonnet-escalation:ABSENT", gptoss_override: true },
          }
          finalPairs.push(overridePair)
        }
        overridden++
        variantCounts[variant] = (variantCounts[variant] ?? 0) + 1
      } else if (verdict.verdict === "OBLIQUE_REFERENCE") {
        // Ambiguous — remove from training data
        removed++
        console.log(`  Removing ${pairId}: OBLIQUE_REFERENCE — ${verdict.reasoning}`)
      } else {
        // IN_MEDIAS_RES_CLEAN — gpt-oss was right to say PASS, keep gpt-oss label
        finalPairs.push(pair)
        passedThrough++
        variantCounts[variant] = (variantCounts[variant] ?? 0) + 1
      }
    } else {
      // Non-FMB pairs: use gpt-oss label as-is
      finalPairs.push(pair)
      variantCounts[variant] = (variantCounts[variant] ?? 0) + 1
    }
  }

  // ── Write final JSONL ──────────────────────────────────────────────────
  if (existsSync(OUT_FINAL)) unlinkSync(OUT_FINAL)
  await Bun.write(OUT_FINAL, finalPairs.map(p => JSON.stringify(p)).join("\n") + "\n")
  console.log(`\nFinal training set: ${finalPairs.length} pairs → ${OUT_FINAL}`)

  // ── Class balance check ───────────────────────────────────────────────
  const passCount = finalPairs.filter(p => JSON.parse(p.messages[2].content).pass === true).length
  const failCount = finalPairs.length - passCount
  const passRatio = Math.round(passCount / finalPairs.length * 100)

  console.log("\n" + "═".repeat(60))
  console.log("FINAL CLASS BALANCE")
  console.log("═".repeat(60))
  console.log("variant".padEnd(24) + "count")
  console.log("─".repeat(60))
  const variants = ["PASS_CLEAN","PASS_PARAPHRASE","PASS_REORDER","PASS_ATMOSPHERIC",
                    "FAIL_MISSING_BEAT","FAIL_MISSING_CHAR","FAIL_REVERSED_ARC","FAIL_WRONG_SETTING"]
  for (const v of variants) {
    console.log(v.padEnd(24) + (variantCounts[v] ?? 0))
  }
  console.log("─".repeat(60))
  console.log(`PASS total:  ${passCount} (${passRatio}%)`)
  console.log(`FAIL total:  ${failCount} (${100 - passRatio}%)`)
  console.log(`Overall:     ${finalPairs.length} pairs`)
  console.log(`Removed (OBLIQUE_REFERENCE): ${removed}`)
  console.log(`Overridden (ABSENT→FAIL):    ${overridden}`)
  console.log(`Accepted (IN_MEDIAS_RES_CLEAN): ${passedThrough}`)

  const balanceStatus = passRatio >= 45 && passRatio <= 55
    ? "PASS — within 45:55–55:45"
    : "FAIL — outside balance threshold, consider oversampling"
  console.log(`Balance: ${balanceStatus}`)

  // ── DB record ─────────────────────────────────────────────────────────
  const expId = await createTuningExperiment(
    "data-generation",
    `Chapter-plan-checker v2 final training set — ${finalPairs.length} pairs (gpt-oss + Sonnet escalation)`,
    {
      totalPairs: finalPairs.length,
      passCount,
      failCount,
      passRatio,
      removed,
      overridden,
      passedThrough,
      byVariant: variantCounts,
      inputFiles: [
        "lora-data/chapter-plan-checker-pairs-gptoss-v2.jsonl",
        "/tmp/missing-beat-escalation/results_*.jsonl",
      ],
      outputFile: "lora-data/chapter-plan-checker-pairs-v2-final.jsonl",
    },
    { target: "chapter-plan-checker", dimension: "calibration" }
  )
  const conclusion = `Chapter-plan v2 final dataset: ${finalPairs.length} pairs. ` +
    `PASS:FAIL = ${passRatio}:${100-passRatio}. Removed ${removed} OBLIQUE_REFERENCE pairs. ` +
    `Overrode ${overridden} gpt-oss false-positives with Sonnet ABSENT verdicts. ` +
    `${balanceStatus}.`
  await concludeExperiment(expId, conclusion)
  console.log(`\nExp #${expId} concluded.`)
}

main().catch(e => { console.error(e); process.exit(1) })
