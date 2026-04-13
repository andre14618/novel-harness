/**
 * Label chapter-plan-checker pairs with gpt-oss-120b as the teacher.
 *
 * Unlike the baseline/teachers scoring scripts (which measure agreement-vs-label),
 * this script PRODUCES the labeled training set: gpt-oss's full {pass, deviations}
 * response becomes the assistant turn in the final training pair.
 *
 * Also writes a per-pair audit JSONL at /tmp/chapter-plan-gptoss-labels.jsonl so
 * FAIL_MISSING_BEAT cases where gpt-oss returned PASS can be extracted for
 * Sonnet escalation (see synthetic-labeling-sop.md Step 3).
 *
 * Reads:  lora-data/chapter-plan-checker-pairs.jsonl
 * Writes: lora-data/chapter-plan-checker-pairs-gptoss-v2.jsonl (training set)
 *         /tmp/chapter-plan-gptoss-labels.jsonl              (per-pair audit)
 *         tuning_experiment row
 *
 * Usage:
 *   GROQ_API_KEY=... bun scripts/label-chapter-plan-gptoss.ts
 *   EXPERIMENT_ID=N GROQ_API_KEY=... bun scripts/label-chapter-plan-gptoss.ts
 */

import { readFileSync, appendFileSync, existsSync, unlinkSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"
import { getTransport } from "../src/transport"

const EXPERIMENT_ID = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : null

const PAIRS_PATH  = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")
const OUT_TRAIN   = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs-gptoss-v2.jsonl")
const OUT_AUDIT   = "/tmp/chapter-plan-gptoss-labels.jsonl"

// Set RESUME=1 to skip already-labeled pairs and only run errors from a prior run
const RESUME = process.env.RESUME === "1"

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

interface GptOssVerdict {
  pass: boolean
  deviations: string[]
  raw: string
}

async function callGptOss(system: string, user: string): Promise<GptOssVerdict | null> {
  const transport = getTransport()
  try {
    const result = await transport.execute({
      systemPrompt: system,
      userPrompt: user,
      provider: "groq",
      model: "openai/gpt-oss-120b",
      temperature: 0.1,
      maxTokens: 768,
      responseFormat: { type: "json_object" },
      maxTokens: 2048,
    })
    let content = result.content.trim()
    if (content.startsWith("```")) {
      content = content.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
    }
    const m = content.match(/\{[\s\S]*\}/)
    if (m) content = m[0]
    const parsed = JSON.parse(content)
    return {
      pass: Boolean(parsed.pass),
      deviations: Array.isArray(parsed.deviations) ? parsed.deviations : [],
      raw: content,
    }
  } catch (e: any) {
    console.error(`  ERROR: ${e?.message ?? String(e)}`)
    return null
  }
}

async function main() {
  const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")
  const pairs: Pair[] = lines.map(l => JSON.parse(l))
  console.log(`Labeling ${pairs.length} pairs with gpt-oss-120b`)

  const expId = await createTuningExperiment(
    "data-generation",
    `Chapter-plan-checker gpt-oss-120b teacher labeling — ${pairs.length} pairs`,
    {
      pairs: pairs.length,
      teacher: "gpt-oss-120b",
      provider: "groq",
      inputFile: "lora-data/chapter-plan-checker-pairs.jsonl",
      outputFile: "lora-data/chapter-plan-checker-pairs-gptoss-v2.jsonl",
      auditFile: "/tmp/chapter-plan-gptoss-labels.jsonl",
      note: "gpt-oss is validated teacher at 90% on PASS variants and 50% on FAIL_MISSING_BEAT. FAIL_MISSING_BEAT false-positives go to Sonnet escalation.",
    },
    { target: "chapter-plan-checker", dimension: "calibration" }
  )
  console.log(`Experiment: ${expId}`)

  // Build set of already-labeled pair IDs when resuming
  const alreadyLabeled = new Set<string>()
  if (RESUME && existsSync(OUT_AUDIT)) {
    const auditText = readFileSync(OUT_AUDIT, "utf8").trim()
    for (const line of auditText.split("\n").filter(Boolean)) {
      const r = JSON.parse(line)
      alreadyLabeled.add(r.pair_id)
    }
    console.log(`Resume mode: ${alreadyLabeled.size} already labeled, running remaining ${pairs.length - alreadyLabeled.size}`)
  } else {
    if (existsSync(OUT_TRAIN)) unlinkSync(OUT_TRAIN)
    if (existsSync(OUT_AUDIT)) unlinkSync(OUT_AUDIT)
  }

  let done = 0, errors = 0
  const variants = ["PASS_CLEAN","PASS_PARAPHRASE","PASS_REORDER","PASS_ATMOSPHERIC",
                    "FAIL_MISSING_BEAT","FAIL_MISSING_CHAR","FAIL_REVERSED_ARC","FAIL_WRONG_SETTING"]
  const byVariant: Record<string, { gptossPass: number; gtPass: number; total: number }> = {}
  for (const v of variants) byVariant[v] = { gptossPass: 0, gtPass: 0, total: 0 }

  // 4 concurrent calls
  const CONCURRENCY = 4
  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (pair, bi) => {
      const idx = i + bi
      const { scenario, variant } = pair._meta
      const pairId = `${scenario}_${variant}`

      if (RESUME && alreadyLabeled.has(pairId)) {
        process.stdout.write(`[${idx + 1}/${pairs.length}] ${pairId} — skip (already labeled)\n`)
        return
      }

      const system = pair.messages[0].content
      const user   = pair.messages[1].content
      const gtPass = JSON.parse(pair.messages[2].content).pass as boolean

      // Retry once on failure
      let verdict = await callGptOss(system, user)
      if (!verdict) verdict = await callGptOss(system, user)

      if (!verdict) {
        errors++
        process.stdout.write(`[${idx + 1}/${pairs.length}] ${scenario}/${variant} → ERR\n`)
        return
      }

      const ok = verdict.pass === gtPass ? "OK" : "✗"
      process.stdout.write(`[${idx + 1}/${pairs.length}] ${scenario}/${variant} (gt:${gtPass ? "PASS" : "FAIL"} gpt:${verdict.pass ? "PASS" : "FAIL"}) ${ok}\n`)

      // Per-variant stats
      if (byVariant[variant]) {
        byVariant[variant].total++
        if (verdict.pass) byVariant[variant].gptossPass++
        if (gtPass) byVariant[variant].gtPass++
      }
      done++

      // Training pair: replace assistant turn with gpt-oss output
      const trainPair = {
        messages: [
          pair.messages[0],
          pair.messages[1],
          { role: "assistant", content: JSON.stringify({ pass: verdict.pass, deviations: verdict.deviations }) },
        ],
        _meta: { ...pair._meta, teacher: "gpt-oss-120b", gt_pass: gtPass, teacher_pass: verdict.pass },
      }
      appendFileSync(OUT_TRAIN, JSON.stringify(trainPair) + "\n")

      // Audit record
      const auditRow = {
        pair_id: `${scenario}_${variant}`,
        scenario,
        variant,
        gt_pass: gtPass,
        gptoss_pass: verdict.pass,
        gptoss_deviations: verdict.deviations,
        agree: verdict.pass === gtPass,
      }
      appendFileSync(OUT_AUDIT, JSON.stringify(auditRow) + "\n")
    }))
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70))
  console.log(`gpt-oss-120b labeling complete: ${done} labeled, ${errors} errors`)
  console.log("═".repeat(70))
  console.log("variant".padEnd(24) + "gptoss_pass_rate".padEnd(20) + "agree_w_gt")
  console.log("─".repeat(70))
  let totalAgree = 0, totalDone = 0
  for (const v of variants) {
    const s = byVariant[v]
    if (s.total === 0) continue
    const agree = s.gptossPass === (s.gtPass > 0 ? s.gtPass : 0)
    // Recount agree from raw (approximate — actual agree is tracked per-call above)
    totalDone += s.total
    console.log(
      v.padEnd(24) +
      `${Math.round(s.gptossPass / s.total * 100)}% (${s.gptossPass}/${s.total})`.padEnd(20)
    )
  }

  // Count FAIL_MISSING_BEAT escalation candidates
  const auditLines = (await Bun.file(OUT_AUDIT).text()).trim().split("\n").filter(Boolean)
  const escalation = auditLines
    .map(l => JSON.parse(l))
    .filter(r => r.variant === "FAIL_MISSING_BEAT" && r.gptoss_pass === true)
  console.log(`\nFAIL_MISSING_BEAT escalation candidates: ${escalation.length} (gpt-oss said PASS on FAIL pairs)`)
  for (const e of escalation) console.log(`  ${e.pair_id}`)

  const conclusion = `gpt-oss-120b teacher labeling: ${done}/${pairs.length} pairs labeled (${errors} errors). ` +
    `Training JSONL: lora-data/chapter-plan-checker-pairs-gptoss-v2.jsonl. ` +
    `FAIL_MISSING_BEAT escalation candidates: ${escalation.length}. ` +
    `Audit: /tmp/chapter-plan-gptoss-labels.jsonl. Next: Sonnet escalation on ${escalation.length} FAIL_MISSING_BEAT false-positives.`
  await concludeExperiment(expId, conclusion)
  console.log(`\nConclusion recorded (exp #${expId})`)
}

main().catch(e => { console.error(e); process.exit(1) })
