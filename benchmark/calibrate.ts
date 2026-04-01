/**
 * Judge calibration test.
 *
 * Tests whether a judge model can:
 *   1. Discriminate — rank clearly different quality levels correctly
 *   2. Ground — cite actual passages from the text, not hallucinate
 *   3. Stay consistent — score the same prose similarly on repeat
 *
 * Uses 3 prose samples at obviously different quality tiers:
 *   WEAK  — heavy telling, flat dialogue, no sensory grounding
 *   MID   — real harness output (actual chapter from a run)
 *   STRONG — hand-crafted with strong showing, distinct voices, vivid detail
 *
 * Run: bun benchmark/calibrate.ts
 */

import { readFileSync, existsSync } from "node:fs"
import { extractJSON } from "../src/llm"
import { judgeScoreSchema, CALIBRATE_DIMENSIONS as DIMENSIONS, CALIBRATE_DIMENSION_LABELS as DIMENSION_LABELS, type CalibrateDimension as Dimension } from "./prose/judges/schema"

// ── Prose samples ────────────────────────────────────────────────────────

const WEAK = `General Kael was a disgraced military leader who had been exiled to a remote outpost. She was very angry about her situation and felt bitter every day. The outpost was in a desert and it was hot and dry. She was responsible for maintaining the water system but she didn't really care about it anymore because she was too upset about her past.

One day a man named Davan arrived. He was injured and scared. He told her that the empire was based on lies. "The empire is lying to everyone," he said urgently. "I found proof that the founding was a fraud." Kael was shocked by this news. She didn't know what to think.

Then some assassins attacked. They were sent by the empire to stop the truth from getting out. Kael fought them because she was a skilled warrior. She defeated all three of them easily because of her military training. After the fight she looked at the documents Davan had brought and realized that everything she had believed was wrong. She felt a mixture of anger and determination. She decided she needed to do something about it.

The wind blew outside. It was a dark and stormy night. She picked up the satchel and knew that her life was about to change forever. She was scared but also brave.`

// Real harness output — mid-tier, the prose we're trying to improve
const MID_PATH = new URL("../output/novel-1774995043687/chapter-1.md", import.meta.url).pathname
const MID = existsSync(MID_PATH)
  ? readFileSync(MID_PATH, "utf-8").replace(/^# .*\n\n/, "")  // strip markdown header
  : null

const STRONG = `Dawn bled through the fissures of Khar-Selim's eastern wall, catching the mineral deposits in the stone until they glowed like infected wounds. Kael pressed her thumb into the clay seal of aqueduct seven and felt it give—a soft, wet surrender, like pressing into a bruise.

She pulled her hand back. Wiped the ochre residue on her thigh. Calculated.

"We'll lose the northern terrace by midday."

Behind her, Tomash fumbled with his tuning fork, striking it against the channel wall with the confidence of a man playing an instrument he'd never been taught. The note came back wrong—flat, swallowed by the stone instead of resonating through it. He struck again, harder.

"Stop." Kael didn't turn. "You're cracking the harmonic bed. One more strike like that and we lose the seal entirely."

"Then what am I supposed to—"

"Listen." She crouched, pressed her ear to the channel. Beneath the trickle of failing water, beneath the groan of settling stone, something hummed. Low. Tectonic. The aquifer shifting in its bed three hundred meters below, rolling like a sleeper disturbed by dreams. "The water table's dropped. Again. Feel it?"

Tomash clearly felt nothing. His face was a mask of polite incomprehension, sweat cutting channels through the dust caked on his neck. He smelled of copper and panic.

"Never mind. Reseat the upper clamp. Hand-tight, no fork."

She left him there, picking her way along the channel's spine with the practiced gait of someone who'd walked worse terrain under fire. The aqueduct stretched before her—a kilometer of crumbling ambition, the empire's promise of water to the exiled reduced to a leaking monument to indifference.

In her quarters, the blade waited.

Not for use. The edge had gone to rust years ago, pitted and soft, the steel remembering a shape it could no longer hold. But her hands remembered. She drew the cloth along the flat in slow, deliberate strokes, and with each pass a name surfaced like a body from shallow water.

"Vesha." Cloth down. "Korrin." Cloth up. "Mirel."

The wind found the gap beneath her door and threaded itself through, carrying grit and something else—a whisper pressed so thin it might have been imagination. Might have been the Old Voices, the ones the geological surveys insisted were acoustic artifacts of subsurface wind patterns. The ones that spoke in a language that predated the empire by a thousand years.

*...the water remembers what you buried...*

She kept polishing.

The door didn't knock. It splintered inward, frame and all, and Davan came through it like a man thrown from a horse—shoulder first, legs failing, one hand locked white-knuckled around a leather satchel dark with what she recognized immediately as blood. Not his. The gash across his temple was fresh but shallow. The blood on the satchel was old, dried to the color of brick dust.

He hit the floor and the satchel skidded. She had her knife in hand before his second breath.

"You crossed the exclusion line." Not a question.

"They killed—" He coughed. Something wet. "The archivists. All of them. Kael, the founding records, the real ones—they were under a false floor in the eastern wing. The Sandwardens weren't insurgents. They were the original settlers. The first Emperor didn't unite the territory, he—"

"Stop talking."

She checked the window. The storm wall was building in the east, a curtain of ochre haze that turned the sun into a copper coin. But within it—movement. Deliberate. Three shapes that didn't drift with the wind but cut against it.

Sand-dyed cloaks. Tuned blades. Office of Purity.

She'd trained half of them.

"Under the cot. Don't move. Don't breathe loud."

She pulled the rebar from beneath the floorboard—her real weapon, the one she'd shaped in the months after exile when she'd understood that a disgraced general lives only as long as she's not worth the cost of killing. Three kilos of scavenged steel, balanced for close work.

The first one came through the window. She was already moving—low, off-angle, driving the rebar up under his ribs before his feet found the floor. The steel slid through the sand-dyed fabric like a finger through wet clay. He made a sound like a man surprised by cold water and folded around the bar.

Second came through the door. Fast. Blade singing a harmonic meant to shatter bone at contact. She caught his wrist with her left hand, felt the vibration travel up her forearm like an electric shock, and broke his elbow across her raised knee. The blade clattered. She stamped on his throat. Gristle popped.

Third was smart. Waited. Came in low with a sweep aimed at her ankles.

She jumped it, landed on the flat of his blade, and drove her knife—the rusted one, the memorial—into the base of his skull. It went in harder than clean steel would have. Rougher. She felt every millimeter of entry.

Silence.

Then wind. Then Davan's breathing, ragged and quick behind the cot.

She turned the third one over. Inside his collar: a glyph branded into the fabric. Circle bisected by a descending flame. Office of Purity, confirmed. But beneath it, smaller, almost hidden in the weave—a second mark. A water sign. The archivists' seal.

They'd sent Purity agents carrying archivist credentials. To retrieve, not just to kill.

She looked at the satchel.`

const SAMPLES = [
  { label: "WEAK", tier: 1, prose: WEAK },
  ...(MID ? [{ label: "MID", tier: 2, prose: MID }] : []),
  { label: "STRONG", tier: 3, prose: STRONG },
]

// ── Judge model configs (pulled from registry) ──────────────────────────

import {
  MODELS, PROVIDERS, getApiKey,
  type ModelDef, type ProviderName,
} from "../models/registry"

interface JudgeModel {
  label: string
  apiUrl: string
  apiKey: string
  model: string
  extraBody?: Record<string, any>
  useMaxCompletionTokens?: boolean
  cost: string  // for display
}

function getJudgeModels(): JudgeModel[] {
  // Pull every available model (calibration tests all of them)
  const candidates = MODELS.filter(m => {
    const provider = PROVIDERS[m.provider]
    return !!process.env[provider.envKey]
  })

  // Optional filter: CALIBRATE_MODELS=label1,label2 to test specific models
  const filterEnv = process.env.CALIBRATE_MODELS
  const filter = filterEnv ? filterEnv.split(",").map(s => s.trim().toLowerCase()) : null

  return candidates
    .filter(m => !filter || filter.some(f => m.label.toLowerCase().includes(f)))
    .map(m => {
      const provider = PROVIDERS[m.provider]
      return {
        label: m.label,
        apiUrl: provider.apiUrl,
        apiKey: getApiKey(m.provider),
        model: m.id,
        extraBody: provider.extraBody?.(),
        useMaxCompletionTokens: m.useMaxCompletionTokens,
        cost: `$${m.pricing.input}/$${m.pricing.output}/M`,
      }
    })
}

// ── Load rubrics ─────────────────────────────────────────────────────────

const RUBRICS: Record<Dimension, string> = {} as any
for (const dim of DIMENSIONS) {
  const path = new URL(`./prose/judges/${dim}.md`, import.meta.url).pathname
  RUBRICS[dim] = readFileSync(path, "utf-8")
}

// ── Judge call ───────────────────────────────────────────────────────────

async function judge(
  model: JudgeModel, dimension: Dimension, prose: string,
): Promise<{ score: number; reasoning: string; latencyMs: number } | null> {
  const start = performance.now()
  try {
    const tokenParam = model.useMaxCompletionTokens
      ? { max_completion_tokens: 4096 }
      : { max_tokens: 4096 }

    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(model.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${model.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.model,
          messages: [{ role: "system", content: RUBRICS[dimension] }, { role: "user", content: prose }],
          temperature: 0.1,
          ...tokenParam,
          response_format: { type: "json_object" },
          ...model.extraBody,
        }),
      })
      if (res!.status === 429 || res!.status === 503) {
        if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue }
      }
      break
    }

    if (!res!.ok) {
      console.log(`  ! ${model.label}/${dimension} [http ${res!.status}]`)
      return null
    }

    const data = await res!.json() as any
    if (data.error) {
      console.log(`  ! ${model.label}/${dimension} [api error]`)
      return null
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const usage = data.usage ?? {}
    const completionTokens = usage.completion_tokens ?? 0
    const elapsed = performance.now() - start
    const tps = elapsed > 0 && completionTokens > 0 ? Math.round(completionTokens / (elapsed / 1000)) : 0

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = judgeScoreSchema.safeParse(parsed)
    if (!result.success) {
      console.log(`  ! ${model.label}/${dimension} [zod] ${result.error.issues.map(i => i.message).join("; ")}`)
      return null
    }

    return { ...result.data, latencyMs: Math.round(elapsed), tps }
  } catch (err) {
    console.log(`  ! ${model.label}/${dimension} [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

interface ScoreEntry {
  model: string
  sample: string
  tier: number
  dimension: Dimension
  score: number
  reasoning: string
  latencyMs: number
  tps: number
  run: number
}

async function main() {
  const models = getJudgeModels()
  if (models.length === 0) { console.error("No API keys found"); process.exit(1) }

  const CONSISTENCY_RUNS = 2  // run each judgment twice to test consistency

  console.log(`\nJudge Calibration Test`)
  console.log(`Models: ${models.map(m => m.label).join(", ")}`)
  console.log(`Samples: ${SAMPLES.map(s => s.label).join(", ")}`)
  console.log(`Dimensions: ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(", ")}`)
  console.log(`Runs per judgment: ${CONSISTENCY_RUNS}`)
  console.log(`Total judge calls: ${models.length} x ${SAMPLES.length} x ${DIMENSIONS.length} x ${CONSISTENCY_RUNS} = ${models.length * SAMPLES.length * DIMENSIONS.length * CONSISTENCY_RUNS}`)
  console.log()

  const allScores: ScoreEntry[] = []

  // Run each model sequentially (avoid rate limits), but dimensions in parallel per sample
  for (const model of models) {
    console.log(`\n${"=".repeat(50)}`)
    console.log(`  ${model.label} (${model.model})`)
    console.log(`${"=".repeat(50)}`)

    for (const sample of SAMPLES) {
      for (let run = 1; run <= CONSISTENCY_RUNS; run++) {
        const results = await Promise.all(
          DIMENSIONS.map(async (dim) => {
            const result = await judge(model, dim, sample.prose)
            return { dim, result }
          })
        )

        const scores: string[] = []
        for (const { dim, result } of results) {
          if (result) {
            allScores.push({
              model: model.label, sample: sample.label, tier: sample.tier,
              dimension: dim, score: result.score, reasoning: result.reasoning,
              latencyMs: result.latencyMs, tps: result.tps, run,
            })
            scores.push(`${DIMENSION_LABELS[dim]}:${result.score}`)
          } else {
            scores.push(`${DIMENSION_LABELS[dim]}:FAIL`)
          }
        }
        console.log(`  ${sample.label} run${run}: ${scores.join("  ")}`)
      }
    }
  }

  // ── Analysis ─────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(60)}`)
  console.log("  CALIBRATION RESULTS")
  console.log(`${"=".repeat(60)}`)

  // 1. Discrimination: does WEAK < MID < STRONG for each model/dimension?
  console.log("\n  1. DISCRIMINATION (can the model rank quality levels?)")
  console.log(`     Expected: WEAK < MID < STRONG\n`)

  for (const model of models) {
    const modelScores = allScores.filter(s => s.model === model.label)
    let correctRankings = 0
    let totalRankings = 0

    for (const dim of DIMENSIONS) {
      const byTier: Record<number, number[]> = {}
      for (const s of modelScores.filter(s => s.dimension === dim)) {
        if (!byTier[s.tier]) byTier[s.tier] = []
        byTier[s.tier].push(s.score)
      }

      const avg = (tier: number) => {
        const scores = byTier[tier]
        return scores ? scores.reduce((a, b) => a + b, 0) / scores.length : null
      }

      const tiers = SAMPLES.map(s => s.tier)
      const avgs = tiers.map(t => ({ tier: t, avg: avg(t) })).filter(a => a.avg !== null)

      // Check if rankings are monotonically increasing
      let correct = true
      for (let i = 1; i < avgs.length; i++) {
        if (avgs[i].avg! <= avgs[i - 1].avg!) { correct = false; break }
      }

      totalRankings++
      if (correct) correctRankings++

      const tierStr = avgs.map(a => {
        const label = SAMPLES.find(s => s.tier === a.tier)!.label
        return `${label}:${a.avg!.toFixed(1)}`
      }).join(" < ")

      console.log(`     ${model.label.padEnd(16)} ${DIMENSION_LABELS[dim].padEnd(12)} ${tierStr} ${correct ? "OK" : "WRONG"}`)
    }

    const pct = totalRankings > 0 ? Math.round(correctRankings / totalRankings * 100) : 0
    console.log(`     ${model.label.padEnd(16)} ${"TOTAL".padEnd(12)} ${correctRankings}/${totalRankings} correct (${pct}%)`)
    console.log()
  }

  // 2. Consistency: how close are run1 and run2 for same model/sample/dimension?
  console.log("\n  2. CONSISTENCY (same prose -> same score?)")
  console.log(`     Showing max spread (|run1 - run2|) per model\n`)

  for (const model of models) {
    const modelScores = allScores.filter(s => s.model === model.label)
    const spreads: number[] = []

    for (const sample of SAMPLES) {
      for (const dim of DIMENSIONS) {
        const runs = modelScores.filter(s => s.sample === sample.label && s.dimension === dim)
        if (runs.length >= 2) {
          const spread = Math.abs(runs[0].score - runs[1].score)
          spreads.push(spread)
        }
      }
    }

    const avgSpread = spreads.length ? (spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(1) : "N/A"
    const maxSpread = spreads.length ? Math.max(...spreads) : "N/A"
    console.log(`     ${model.label.padEnd(16)} avg spread: ${avgSpread}  max spread: ${maxSpread}`)
  }

  // 3. Score ranges: does the model actually use the full scale?
  console.log("\n\n  3. SCORE RANGE (does the model use the scale?)")
  console.log(`     Models that cluster 4-7 for everything give weak signal\n`)

  for (const model of models) {
    const modelScores = allScores.filter(s => s.model === model.label)
    const scores = modelScores.map(s => s.score)
    const min = Math.min(...scores)
    const max = Math.max(...scores)
    const range = max - min
    console.log(`     ${model.label.padEnd(16)} range: ${min}-${max} (spread: ${range})`)
  }

  // 4. Speed (latency + TPS)
  console.log("\n\n  4. SPEED (observed from judge calls)\n")

  for (const model of models) {
    const modelScores = allScores.filter(s => s.model === model.label)
    const avgLatency = modelScores.length
      ? Math.round(modelScores.reduce((a, s) => a + s.latencyMs, 0) / modelScores.length)
      : 0
    const tpsValues = modelScores.filter(s => s.tps > 0).map(s => s.tps)
    const avgTps = tpsValues.length ? Math.round(tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length) : 0
    console.log(`     ${model.label.padEnd(16)} ${avgLatency}ms avg  ${avgTps > 0 ? `${avgTps} tok/s` : "no tps data"}`)
  }

  // 5. Grounding spot-check: print reasoning for STRONG sample, show-tell dimension, run 1
  console.log("\n\n  5. GROUNDING SPOT-CHECK (does reasoning cite real passages?)")
  console.log(`     Showing show-tell reasoning for STRONG sample (check manually)\n`)

  for (const model of models) {
    const entry = allScores.find(s =>
      s.model === model.label && s.sample === "STRONG" && s.dimension === "show-tell" && s.run === 1
    )
    if (entry) {
      console.log(`  --- ${model.label} (score: ${entry.score}) ---`)
      console.log(`  ${entry.reasoning.slice(0, 500)}`)
      console.log()
    }
  }

  // Summary recommendation
  console.log(`\n${"=".repeat(60)}`)
  console.log("  RECOMMENDATION")
  console.log(`${"=".repeat(60)}`)
  console.log()

  // Rank models by discrimination accuracy, then by latency as tiebreaker
  const modelRanks = models.map(model => {
    const modelScores = allScores.filter(s => s.model === model.label)
    let correct = 0, total = 0

    for (const dim of DIMENSIONS) {
      const byTier: Record<number, number[]> = {}
      for (const s of modelScores.filter(s => s.dimension === dim)) {
        if (!byTier[s.tier]) byTier[s.tier] = []
        byTier[s.tier].push(s.score)
      }
      const avg = (tier: number) => {
        const scores = byTier[tier]
        return scores ? scores.reduce((a, b) => a + b, 0) / scores.length : null
      }
      const avgs = SAMPLES.map(s => s.tier).map(t => avg(t)).filter(a => a !== null) as number[]
      total++
      let ok = true
      for (let i = 1; i < avgs.length; i++) { if (avgs[i] <= avgs[i - 1]) { ok = false; break } }
      if (ok) correct++
    }

    const spreads: number[] = []
    for (const sample of SAMPLES) {
      for (const dim of DIMENSIONS) {
        const runs = modelScores.filter(s => s.sample === sample.label && s.dimension === dim)
        if (runs.length >= 2) spreads.push(Math.abs(runs[0].score - runs[1].score))
      }
    }
    const avgSpread = spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 99
    const avgLatency = modelScores.length
      ? modelScores.reduce((a, s) => a + s.latencyMs, 0) / modelScores.length
      : 99999

    const tpsValues = modelScores.filter(s => s.tps > 0).map(s => s.tps)
    const avgTps = tpsValues.length ? Math.round(tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length) : 0

    return { label: model.label, model: model.model, discrimination: correct / total, consistency: avgSpread, latency: avgLatency, tps: avgTps }
  }).sort((a, b) => {
    // Sort by discrimination desc, then consistency asc, then latency asc
    if (b.discrimination !== a.discrimination) return b.discrimination - a.discrimination
    if (a.consistency !== b.consistency) return a.consistency - b.consistency
    return a.latency - b.latency
  })

  for (const r of modelRanks) {
    const disc = `${Math.round(r.discrimination * 100)}%`
    const cons = r.consistency.toFixed(1)
    const tps = r.tps > 0 ? `${r.tps} tok/s` : "—"
    console.log(`  ${r.label.padEnd(16)} disc: ${disc.padEnd(5)} consistency: +-${cons.padEnd(5)} ${tps.padEnd(12)} ${Math.round(r.latency)}ms`)
  }

  console.log(`\n  Top pick for iteration: ${modelRanks[0]?.label ?? "N/A"}`)

  // Print registry update snippet for observed TPS
  const tpsUpdates = modelRanks.filter(r => r.tps > 0)
  if (tpsUpdates.length > 0) {
    console.log(`\n  Observed TPS (paste into models/registry.ts):`)
    for (const r of tpsUpdates) {
      console.log(`    // ${r.label}: observedTps: ${r.tps},`)
    }
  }

  console.log()
}

main()
