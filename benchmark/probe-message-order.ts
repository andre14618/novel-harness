/**
 * Message order experiment: does putting prose before rubric change results?
 *
 * Tests 3 orderings with GPT-OSS 120B on Telling rubric:
 *   A: system=rubric, user=prose (current)
 *   B: system=prose, user=rubric (inverted for caching)
 *   C: system="", user=prose + "\n---\n" + rubric (single message)
 *
 * Persists results to tuning DB.
 *
 * Usage: bun benchmark/probe-message-order.ts
 */

import { readFileSync, existsSync } from "node:fs"
import { extractJSON } from "../src/llm"
import { MODELS, PROVIDERS, getApiKey } from "../models/registry"
import { z } from "zod"
import {
  getDB, createTuningExperiment, saveTuningResult,
} from "./db"

const penaltySchema = z.object({
  issues: z.array(z.object({
    quote: z.string(),
    problem: z.string(),
  })),
  count: z.coerce.number().min(0),
})

// ── Samples ─────────────────────────────────────────────────────────────

const WEAK = `General Kael was a disgraced military leader who had been exiled to a remote outpost. She was very angry about her situation and felt bitter every day. The outpost was in a desert and it was hot and dry. She was responsible for maintaining the water system but she didn't really care about it anymore because she was too upset about her past.

She walked along the aqueduct every morning. It was always the same. The water was low and the stone was cracking. She could see that things were getting worse but she didn't have the energy to fix them. She thought about her old life constantly. She had been someone important once. Now she was nobody.

One day a man named Davan arrived at the outpost. He was injured and scared. He had been traveling for a long time and he was exhausted. He told her that the empire was based on lies. "The empire is lying to everyone," he said urgently. "I found proof that the founding was a fraud." Kael was shocked by this news. She didn't know what to think about it.

She felt confused and overwhelmed. She realized that everything she had believed her whole life might be wrong. She was angry but also curious. She wanted to know more but she was also afraid of what she might learn. Davan was very insistent that they needed to act quickly.

Then some assassins attacked the outpost. They were sent by the empire to stop the truth from getting out. There were three of them and they were very skilled. Kael fought them because she was a skilled warrior. She defeated all three of them easily because of her military training. The fight was intense but she was clearly superior. She moved quickly and struck hard.

After the fight she looked at the documents Davan had brought and realized that everything she had believed was wrong. She felt a mixture of anger and determination. She decided she needed to do something about it. The wind blew outside and it was getting dark. She picked up the satchel and knew that her life was about to change forever. She was scared but also brave.`

const MID_PATH = new URL("../output/novel-1774995043687/chapter-1.md", import.meta.url).pathname
const MID = existsSync(MID_PATH)
  ? readFileSync(MID_PATH, "utf-8").replace(/^# .*\n\n/, "")
  : null
if (!MID) { console.error("MID sample not found"); process.exit(1) }

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

...the water remembers what you buried...

She kept polishing.`

const SAMPLES = [
  { label: "WEAK", prose: WEAK },
  { label: "MID", prose: MID },
  { label: "STRONG", prose: STRONG },
]

// ── Rubric ──────────────────────────────────────────────────────────────

const RUBRIC = readFileSync(new URL("./prose/judges/telling.md", import.meta.url).pathname, "utf-8")

// ── Message orderings ───────────────────────────────────────────────────

type Ordering = {
  label: string
  buildMessages: (rubric: string, prose: string) => Array<{ role: string; content: string }>
}

const ORDERINGS: Ordering[] = [
  {
    label: "A: system=rubric, user=prose",
    buildMessages: (rubric, prose) => [
      { role: "system", content: rubric },
      { role: "user", content: prose },
    ],
  },
  {
    label: "B: system=prose, user=rubric",
    buildMessages: (rubric, prose) => [
      { role: "system", content: `Here is a prose passage to evaluate:\n\n${prose}` },
      { role: "user", content: rubric },
    ],
  },
  {
    label: "C: user=prose+rubric (no system)",
    buildMessages: (rubric, prose) => [
      { role: "user", content: `${prose}\n\n---\n\n${rubric}` },
    ],
  },
  {
    label: "D: system=rubric+prose, user=evaluate",
    buildMessages: (rubric, prose) => [
      { role: "system", content: `${rubric}\n\n---\n\nHere is the prose to evaluate:\n\n${prose}` },
      { role: "user", content: "Evaluate the prose above according to the rubric. Return the JSON result." },
    ],
  },
  {
    label: "E: system=prose+rubric, user=evaluate",
    buildMessages: (rubric, prose) => [
      { role: "system", content: `Here is a prose passage:\n\n${prose}\n\n---\n\n${rubric}` },
      { role: "user", content: "Evaluate the prose above according to the rubric. Return the JSON result." },
    ],
  },
]

// ── Judge setup ─────────────────────────────────────────────────────────

const judgeModel = MODELS.find(m => m.id === "openai/gpt-oss-120b" && m.provider === "groq")
if (!judgeModel) { console.error("GPT-OSS 120B (Groq) not in registry"); process.exit(1) }

const provider = PROVIDERS[judgeModel.provider]
if (!process.env[provider.envKey]) { console.error(`Missing ${provider.envKey}`); process.exit(1) }

const judgeConfig = {
  apiUrl: provider.apiUrl,
  apiKey: getApiKey(judgeModel.provider),
  model: judgeModel.id,
  extraBody: provider.extraBody?.(),
}

async function callJudge(messages: Array<{ role: string; content: string }>): Promise<{ count: number; issues: Array<{ quote: string; problem: string }> } | null> {
  try {
    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(judgeConfig.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${judgeConfig.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: judgeConfig.model,
          messages,
          temperature: 0.1,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          ...judgeConfig.extraBody,
        }),
      })
      if (res!.status === 429 || res!.status === 503) {
        if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue }
      }
      break
    }
    if (!res!.ok) return null
    const data = await res!.json() as any
    if (data.error) return null
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = penaltySchema.safeParse(parsed)
    if (!result.success) return null
    return { count: result.data.issues.length, issues: result.data.issues }
  } catch {
    return null
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const RUNS = 3

async function main() {
  getDB()

  const expId = createTuningExperiment("message-order", "Test whether prose-before-rubric ordering changes judge discrimination", {
    model: "GPT-OSS 120B (Groq)",
    rubric: "Telling",
    samples: SAMPLES.map(s => s.label),
    orderings: ORDERINGS.map(o => o.label),
    runs: RUNS,
  })

  console.log(`\nMessage Order Experiment (ID: ${expId})`)
  console.log(`Judge: GPT-OSS 120B (Groq)`)
  console.log(`Rubric: Telling`)
  console.log(`Orderings: ${ORDERINGS.length}`)
  console.log(`Total calls: ${ORDERINGS.length} x ${SAMPLES.length} x ${RUNS} = ${ORDERINGS.length * SAMPLES.length * RUNS}\n`)

  type Result = { ordering: string; sample: string; run: number; count: number }
  const results: Result[] = []

  for (const ordering of ORDERINGS) {
    console.log(`── ${ordering.label} ──`)

    for (const sample of SAMPLES) {
      const counts: string[] = []
      for (let run = 1; run <= RUNS; run++) {
        const messages = ordering.buildMessages(RUBRIC, sample.prose)
        const result = await callJudge(messages)
        if (result) {
          results.push({ ordering: ordering.label, sample: sample.label, run, count: result.count })
          saveTuningResult(expId, {
            model: "GPT-OSS 120B (Groq)",
            rubric: `telling:${ordering.label}`,
            sample: sample.label,
            run,
            score: result.count,
            issues: result.issues,
          })
          counts.push(String(result.count))
        } else {
          saveTuningResult(expId, {
            model: "GPT-OSS 120B (Groq)",
            rubric: `telling:${ordering.label}`,
            sample: sample.label,
            run,
            failed: true,
          })
          counts.push("FAIL")
        }
      }
      console.log(`  ${sample.label.padEnd(8)} [${counts.join(", ")}]`)
    }
    console.log()
  }

  // ── Analysis ──────────────────────────────────────────────────────────

  console.log(`${"=".repeat(80)}`)
  console.log(`  MESSAGE ORDER RESULTS — Telling dimension`)
  console.log(`${"=".repeat(80)}`)
  console.log(`\n  ${"Ordering".padEnd(40)} ${"WEAK".padEnd(16)} ${"MID".padEnd(16)} ${"STRONG".padEnd(16)} W>M>S?`)
  console.log(`  ${"-".repeat(92)}`)

  for (const ordering of ORDERINGS) {
    const get = (sample: string) => {
      const counts = results.filter(r => r.ordering === ordering.label && r.sample === sample).map(r => r.count)
      const avg = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : -1
      return { counts, avg }
    }
    const weak = get("WEAK"), mid = get("MID"), strong = get("STRONG")
    const ordered = weak.avg > mid.avg && mid.avg > strong.avg
    const fmt = (d: { avg: number; counts: number[] }) =>
      d.avg >= 0 ? `${d.avg.toFixed(1)} [${d.counts.join(",")}]` : "FAIL"

    console.log(`  ${ordering.label.padEnd(40)} ${fmt(weak).padEnd(16)} ${fmt(mid).padEnd(16)} ${fmt(strong).padEnd(16)} ${ordered ? "YES" : "NO"}`)
  }

  // Reference: current baseline
  console.log(`\n  Reference (current baseline): WEAK ~16, MID ~3.7, STRONG ~3.0`)
  console.log(`\n  Experiment saved to DB as tuning experiment #${expId}`)
  console.log()
}

main()
