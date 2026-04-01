/**
 * Quick probe: Gemini 3.1 Flash Lite as penalty judge.
 * Tests the 4 best rubrics (Telling, Dead Weight, Dialogue, Repetition)
 * against WEAK/MID/STRONG to see if it discriminates.
 *
 * Usage: bun benchmark/probe-gemini-lite.ts
 */

import { readFileSync, existsSync } from "node:fs"
import { extractJSON } from "../src/llm"
import { MODELS, PROVIDERS, getApiKey } from "../models/registry"
import { z } from "zod"

const penaltySchema = z.object({
  issues: z.array(z.object({
    quote: z.string(),
    problem: z.string(),
  })),
  count: z.coerce.number().min(0),
})

// ── Normalized samples ──────────────────────────────────────────────────

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

// ── Rubrics ─────────────────────────────────────────────────────────────

const RUBRICS: Array<{ name: string; rubric: string }> = [
  { name: "Telling", rubric: readFileSync(new URL("./prose/judges/telling.md", import.meta.url).pathname, "utf-8") },
  { name: "Dead Weight", rubric: readFileSync(new URL("./prose/judges/dead-weight.md", import.meta.url).pathname, "utf-8") },
  { name: "Dialogue", rubric: readFileSync(new URL("./prose/judges/dialogue-problems.md", import.meta.url).pathname, "utf-8") },
  {
    name: "Repetition",
    rubric: `You are a prose editor. Find every instance of STRUCTURAL REPETITION — patterns that make writing feel mechanical.

Flag these specific problems:
- OPENER REPETITION: 3+ sentences or paragraphs starting with the same word/structure in a short span
- VERB PATTERN: same verb form 3+ times in close proximity ("She walked... She turned... She looked...")
- RECYCLED IMAGE: the same metaphor, descriptor, or image used more than once
- PARAGRAPH TEMPLATE: 3+ consecutive paragraphs following the same structure

Do NOT flag:
- Intentional anaphora or litany for rhythmic effect
- Character names naturally repeating in dialogue attribution
- Common pronouns at sentence starts if the sentences are otherwise varied

Quote each issue exactly, showing the repeated elements. Return JSON:
{"issues": [{"quote": "exact text showing pattern", "problem": "opener repetition|verb pattern|recycled image|paragraph template"}], "count": N}`
  },
]

// ── Models to test ──────────────────────────────────────────────────────

interface Judge { label: string; model: string; apiUrl: string; apiKey: string; extraBody?: Record<string, any> }

function getJudges(): Judge[] {
  const judges: Judge[] = []

  const tryAdd = (modelId: string, providerName: string) => {
    const model = MODELS.find(m => m.id === modelId && m.provider === providerName)
    if (!model) return
    const provider = PROVIDERS[model.provider]
    if (!process.env[provider.envKey]) return
    judges.push({
      label: `${model.label} (${providerName})`,
      model: model.id,
      apiUrl: provider.apiUrl,
      apiKey: getApiKey(model.provider),
      extraBody: provider.extraBody?.(),
    })
  }

  tryAdd("google/gemini-3.1-flash-lite-preview", "openrouter")
  tryAdd("openai/gpt-oss-120b", "groq")

  return judges
}

async function callJudge(j: Judge, rubric: string, prose: string): Promise<z.infer<typeof penaltySchema> | null> {
  try {
    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(j.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${j.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: j.model,
          messages: [{ role: "system", content: rubric }, { role: "user", content: prose }],
          temperature: 0.1,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          ...j.extraBody,
        }),
      })
      if (res!.status === 429 || res!.status === 503) {
        if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue }
      }
      break
    }
    if (!res!.ok) { console.log(`    ! [http ${res!.status}]`); return null }
    const data = await res!.json() as any
    if (data.error) { console.log(`    ! [api error]`); return null }
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = penaltySchema.safeParse(parsed)
    if (!result.success) { console.log(`    ! [zod]`); return null }
    return { ...result.data, count: result.data.issues.length }
  } catch (e) {
    console.log(`    ! [exception] ${e instanceof Error ? e.message : e}`)
    return null
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const RUNS = 3

async function main() {
  const judges = getJudges()
  if (judges.length === 0) { console.error("No judge models available"); process.exit(1) }

  console.log(`\nGemini 3.1 Flash Lite vs GPT-OSS 120B`)
  console.log(`Models: ${judges.map(j => j.label).join(", ")}`)
  console.log(`Rubrics: ${RUBRICS.map(r => r.name).join(", ")}`)
  console.log(`Runs: ${RUNS}\n`)

  type Result = { judge: string; rubric: string; sample: string; run: number; count: number }
  const results: Result[] = []

  for (const j of judges) {
    console.log(`\n${"=".repeat(50)}`)
    console.log(`  ${j.label}`)
    console.log(`${"=".repeat(50)}`)

    for (const rubric of RUBRICS) {
      console.log(`\n  ${rubric.name}:`)
      for (const sample of SAMPLES) {
        const counts: string[] = []
        for (let run = 1; run <= RUNS; run++) {
          const result = await callJudge(j, rubric.rubric, sample.prose)
          if (result) {
            results.push({ judge: j.label, rubric: rubric.name, sample: sample.label, run, count: result.count })
            counts.push(String(result.count))
          } else {
            counts.push("FAIL")
          }
        }
        console.log(`    ${sample.label.padEnd(8)} [${counts.join(", ")}]`)
      }
    }
  }

  // ── Comparison ────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(80)}`)
  console.log(`  COMPARISON`)
  console.log(`${"=".repeat(80)}`)

  for (const rubric of RUBRICS) {
    console.log(`\n  ── ${rubric.name} ──`)
    console.log(`  ${"Model".padEnd(32)} ${"WEAK".padEnd(14)} ${"MID".padEnd(14)} ${"STRONG".padEnd(14)} W>M>S?`)
    console.log(`  ${"-".repeat(80)}`)

    for (const j of judges) {
      const get = (sample: string) => {
        const counts = results.filter(r => r.judge === j.label && r.rubric === rubric.name && r.sample === sample).map(r => r.count)
        return { counts, avg: counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : -1 }
      }
      const weak = get("WEAK"), mid = get("MID"), strong = get("STRONG")
      const ordered = weak.avg > mid.avg && mid.avg > strong.avg
      const fmt = (d: { avg: number; counts: number[] }) => d.avg >= 0 ? `${d.avg.toFixed(1)} [${d.counts.join(",")}]` : "FAIL"
      console.log(`  ${j.label.padEnd(32)} ${fmt(weak).padEnd(14)} ${fmt(mid).padEnd(14)} ${fmt(strong).padEnd(14)} ${ordered ? "YES" : "NO"}`)
    }
  }

  console.log()
}

main()
