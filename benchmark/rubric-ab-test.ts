/**
 * A/B test: vibes-based vs count-based rubric for Show/Tell.
 *
 * Runs Qwen3 32B as judge against WEAK/MID/STRONG samples using both rubric styles.
 * 3 runs each to test consistency. Compares discrimination and score spread.
 *
 * Usage: BENCHMARK_PROVIDER=groq bun benchmark/rubric-ab-test.ts
 */

import { readFileSync, existsSync } from "node:fs"
import { extractJSON } from "../src/llm"
import { judgeScoreSchema } from "./prose/judges/schema"
import { MODELS, PROVIDERS, getApiKey } from "../models/registry"

// ── Samples (same as calibrate.ts) ──────────────────────────────────────

const WEAK = `General Kael was a disgraced military leader who had been exiled to a remote outpost. She was very angry about her situation and felt bitter every day. The outpost was in a desert and it was hot and dry. She was responsible for maintaining the water system but she didn't really care about it anymore because she was too upset about her past.

One day a man named Davan arrived. He was injured and scared. He told her that the empire was based on lies. "The empire is lying to everyone," he said urgently. "I found proof that the founding was a fraud." Kael was shocked by this news. She didn't know what to think.

Then some assassins attacked. They were sent by the empire to stop the truth from getting out. Kael fought them because she was a skilled warrior. She defeated all three of them easily because of her military training. After the fight she looked at the documents Davan had brought and realized that everything she had believed was wrong. She felt a mixture of anger and determination. She decided she needed to do something about it.

The wind blew outside. It was a dark and stormy night. She picked up the satchel and knew that her life was about to change forever. She was scared but also brave.`

const MID_PATH = new URL("../output/novel-1774995043687/chapter-1.md", import.meta.url).pathname
const MID = existsSync(MID_PATH)
  ? readFileSync(MID_PATH, "utf-8").replace(/^# .*\n\n/, "")
  : null

const STRONG = readFileSync(new URL("../benchmark/calibrate.ts", import.meta.url).pathname, "utf-8")
  .match(/const STRONG = `([\s\S]*?)`;?$/m)?.[1] ?? null

// Fallback: read STRONG directly if regex didn't work
const STRONG_PROSE = STRONG ?? `Dawn bled through the fissures of Khar-Selim's eastern wall, catching the mineral deposits in the stone until they glowed like infected wounds. Kael pressed her thumb into the clay seal of aqueduct seven and felt it give—a soft, wet surrender, like pressing into a bruise.

She pulled her hand back. Wiped the ochre residue on her thigh. Calculated.

"We'll lose the northern terrace by midday."

Behind her, Tomash fumbled with his tuning fork, striking it against the channel wall with the confidence of a man playing an instrument he'd never been taught. The note came back wrong—flat, swallowed by the stone instead of resonating through it. He struck again, harder.

"Stop." Kael didn't turn. "You're cracking the harmonic bed. One more strike like that and we lose the seal entirely."

"Then what am I supposed to—"

"Listen." She crouched, pressed her ear to the channel. Beneath the trickle of failing water, beneath the groan of settling stone, something hummed. Low. Tectonic. The aquifer shifting in its bed three hundred meters below, rolling like a sleeper disturbed by dreams. "The water table's dropped. Again. Feel it?"

Tomash clearly felt nothing. His face was a mask of polite incomprehension, sweat cutting channels through the dust caked on his neck. He smelled of copper and panic.

"Never mind. Reseat the upper clamp. Hand-tight, no fork."

She left him there, picking her way along the channel's spine with the practiced gait of someone who'd walked worse terrain under fire.`

const SAMPLES = [
  { label: "WEAK", tier: 1, prose: WEAK },
  ...(MID ? [{ label: "MID", tier: 2, prose: MID }] : []),
  { label: "STRONG", tier: 3, prose: STRONG_PROSE },
]

// ── Rubrics ─────────────────────────────────────────────────────────────

const RUBRIC_VIBES = readFileSync(new URL("./prose/judges/show-tell.md", import.meta.url).pathname, "utf-8")
const RUBRIC_COUNTED = readFileSync(new URL("./prose/judges/show-tell-counted.md", import.meta.url).pathname, "utf-8")

const RUBRICS = [
  { label: "VIBES", rubric: RUBRIC_VIBES },
  { label: "COUNTED", rubric: RUBRIC_COUNTED },
]

// ── Judge setup ─────────────────────────────────────────────────────────

const judgeModel = MODELS.find(m => m.label === "Qwen3 32B" && !!process.env[PROVIDERS[m.provider].envKey])
if (!judgeModel) { console.error("Qwen3 32B not available (check API key)"); process.exit(1) }

const provider = PROVIDERS[judgeModel.provider]
const judge = {
  label: judgeModel.label,
  apiUrl: provider.apiUrl,
  apiKey: getApiKey(judgeModel.provider),
  model: judgeModel.id,
  extraBody: provider.extraBody?.(),
}

async function score(rubric: string, prose: string): Promise<{ score: number; reasoning: string } | null> {
  try {
    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(judge.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${judge.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: judge.model,
          messages: [{ role: "system", content: rubric }, { role: "user", content: prose }],
          temperature: 0.1,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          ...judge.extraBody,
        }),
      })
      if (res!.status === 429 || res!.status === 503) {
        if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue }
      }
      break
    }

    if (!res!.ok) { console.log(`  ! [http ${res!.status}]`); return null }
    const data = await res!.json() as any
    if (data.error) { console.log(`  ! [api error]`); return null }

    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = judgeScoreSchema.safeParse(parsed)
    if (!result.success) { console.log(`  ! [zod] ${result.error.issues.map(i => i.message).join("; ")}`); return null }

    return result.data
  } catch (err) {
    console.log(`  ! [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const RUNS = 3

async function main() {
  console.log(`\nRubric A/B Test: Show/Tell`)
  console.log(`Judge: ${judge.label}`)
  console.log(`Samples: ${SAMPLES.map(s => s.label).join(", ")}`)
  console.log(`Runs: ${RUNS}`)
  console.log(`Total calls: ${RUBRICS.length} rubrics x ${SAMPLES.length} samples x ${RUNS} runs = ${RUBRICS.length * SAMPLES.length * RUNS}\n`)

  const results: Array<{ rubric: string; sample: string; tier: number; run: number; score: number; reasoning: string }> = []

  for (const { label: rubricLabel, rubric } of RUBRICS) {
    console.log(`\n── ${rubricLabel} rubric ──`)

    for (const sample of SAMPLES) {
      for (let run = 1; run <= RUNS; run++) {
        const result = await score(rubric, sample.prose)
        if (result) {
          results.push({ rubric: rubricLabel, sample: sample.label, tier: sample.tier, run, ...result })
          console.log(`  ${sample.label} run${run}: ${result.score}/10`)
        } else {
          console.log(`  ${sample.label} run${run}: FAIL`)
        }
      }
    }
  }

  // ── Analysis ──────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(60)}`)
  console.log(`  RESULTS`)
  console.log(`${"=".repeat(60)}`)

  for (const rubricLabel of RUBRICS.map(r => r.label)) {
    const rubricResults = results.filter(r => r.rubric === rubricLabel)

    console.log(`\n  ${rubricLabel}:`)

    // Per-sample averages
    const byTier: Record<number, number[]> = {}
    for (const r of rubricResults) {
      if (!byTier[r.tier]) byTier[r.tier] = []
      byTier[r.tier].push(r.score)
    }

    const avgs: Array<{ label: string; tier: number; avg: number; scores: number[] }> = []
    for (const sample of SAMPLES) {
      const scores = byTier[sample.tier] ?? []
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
      avgs.push({ label: sample.label, tier: sample.tier, avg, scores })
      console.log(`    ${sample.label.padEnd(8)} avg: ${avg.toFixed(1)}  scores: [${scores.join(", ")}]`)
    }

    // Discrimination
    let discriminates = true
    for (let i = 1; i < avgs.length; i++) {
      if (avgs[i].avg <= avgs[i - 1].avg) { discriminates = false; break }
    }
    console.log(`    Discriminates: ${discriminates ? "YES" : "NO"}`)

    // Spread between tiers
    if (avgs.length >= 2) {
      const totalSpread = avgs[avgs.length - 1].avg - avgs[0].avg
      console.log(`    WEAK->STRONG spread: ${totalSpread.toFixed(1)} points`)
      if (avgs.length >= 3) {
        const midSpread = avgs[2].avg - avgs[1].avg
        console.log(`    MID->STRONG spread:  ${midSpread.toFixed(1)} points (this is what matters for iteration)`)
      }
    }

    // Consistency
    const spreads: number[] = []
    for (const sample of SAMPLES) {
      const scores = rubricResults.filter(r => r.sample === sample.label).map(r => r.score)
      if (scores.length >= 2) {
        spreads.push(Math.max(...scores) - Math.min(...scores))
      }
    }
    const avgConsistency = spreads.length ? (spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(1) : "N/A"
    console.log(`    Consistency (avg spread): ${avgConsistency}`)
  }

  // ── Side by side ──────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(60)}`)
  console.log(`  COMPARISON`)
  console.log(`${"=".repeat(60)}\n`)

  console.log(`  ${"".padEnd(10)} ${"VIBES".padEnd(20)} COUNTED`)
  for (const sample of SAMPLES) {
    const vibesScores = results.filter(r => r.rubric === "VIBES" && r.sample === sample.label).map(r => r.score)
    const countedScores = results.filter(r => r.rubric === "COUNTED" && r.sample === sample.label).map(r => r.score)
    const vibesAvg = vibesScores.length ? (vibesScores.reduce((a, b) => a + b, 0) / vibesScores.length).toFixed(1) : "N/A"
    const countedAvg = countedScores.length ? (countedScores.reduce((a, b) => a + b, 0) / countedScores.length).toFixed(1) : "N/A"
    console.log(`  ${sample.label.padEnd(10)} ${`${vibesAvg} [${vibesScores.join(",")}]`.padEnd(20)} ${countedAvg} [${countedScores.join(",")}]`)
  }

  // Show reasoning for MID sample (most important for iteration)
  console.log(`\n${"=".repeat(60)}`)
  console.log(`  MID SAMPLE REASONING (run 1)`)
  console.log(`${"=".repeat(60)}`)

  for (const rubricLabel of RUBRICS.map(r => r.label)) {
    const entry = results.find(r => r.rubric === rubricLabel && r.sample === "MID" && r.run === 1)
    if (entry) {
      console.log(`\n  --- ${rubricLabel} (score: ${entry.score}) ---`)
      console.log(`  ${entry.reasoning.slice(0, 800)}`)
    }
  }

  console.log()
}

main()
