/**
 * Judge model shootout: test cheap models on penalty-detection rubrics.
 *
 * Normalized prose samples (~500 words each). Tests which models can
 * reliably detect concrete flaws with narrow, focused rubrics.
 *
 * Usage: bun benchmark/judge-shootout.ts
 */

import { extractJSON } from "../src/llm"
import { MODELS, PROVIDERS, getApiKey } from "../models/registry"
import { z } from "zod"

const penaltySchema = z.object({
  issues: z.array(z.object({
    quote: z.string(),
    problem: z.string(),
  })),
  count: z.number(),
})

// ── Normalized samples (~500 words each) ────────────────────────────────

const WEAK = `General Kael was a disgraced military leader who had been exiled to a remote outpost. She was very angry about her situation and felt bitter every day. The outpost was in a desert and it was hot and dry. She was responsible for maintaining the water system but she didn't really care about it anymore because she was too upset about her past.

She walked along the aqueduct every morning. It was always the same. The water was low and the stone was cracking. She could see that things were getting worse but she didn't have the energy to fix them. She thought about her old life constantly. She had been someone important once. Now she was nobody.

One day a man named Davan arrived at the outpost. He was injured and scared. He had been traveling for a long time and he was exhausted. He told her that the empire was based on lies. "The empire is lying to everyone," he said urgently. "I found proof that the founding was a fraud." Kael was shocked by this news. She didn't know what to think about it.

She felt confused and overwhelmed. She realized that everything she had believed her whole life might be wrong. She was angry but also curious. She wanted to know more but she was also afraid of what she might learn. Davan was very insistent that they needed to act quickly.

Then some assassins attacked the outpost. They were sent by the empire to stop the truth from getting out. There were three of them and they were very skilled. Kael fought them because she was a skilled warrior. She defeated all three of them easily because of her military training. The fight was intense but she was clearly superior. She moved quickly and struck hard.

After the fight she looked at the documents Davan had brought and realized that everything she had believed was wrong. She felt a mixture of anger and determination. She decided she needed to do something about it. The wind blew outside and it was getting dark. She picked up the satchel and knew that her life was about to change forever. She was scared but also brave. She knew what she had to do even if she didn't want to do it.

She looked out at the desert one more time. The sun was setting and the sky was red and orange. It was beautiful but also sad somehow. Everything she had known was a lie and she was going to have to face the truth. She took a deep breath and stepped forward into her new life.`

const MID = `Dawn bled gray over Khar-Selim, staining the cracked aqueducts like old bruises. Kael walked the spine of the failing channel, boots grinding grit into fissures oozing silt-thick water. She crouched, pressed a finger to the clay seal—still damp, still shifting.

"Ten thousand liters lost before noon," she said. Not a guess. A verdict.

A laborer coughed. "Could be less if the wind doesn't shift."

"Could be?" Kael stood. "We're not praying for mercy. We're measuring failure. Recalculate the harmonic decay—now."

The man flinched, scrambled for his tuning fork and slate. Around them, the aqueduct groaned, its ancient stone resisting the desert's slow crush. Somewhere beyond the dunes, the buried veins of water trembled, unresponsive to the empire's clumsy tuning.

A child darted forward, small hand outstretched. Offered a scrap of sandcalligraphy—ink on cured hide, curled at the edges. It showed a woman in steel armor, face shadowed by a helmed crest, standing over a broken gate. General Kael. From the days before exile.

She didn't look. Snatched it, crumpled it into her palm, and dropped it into the seep. "Draw something useful next time. Like a working seal."

The child fled. The others didn't meet her eyes. Good. Expect nothing. Disappoint no one.

Back in her quarters—a cell of sun-baked brick with a rusted shutter—Kael wiped down a blade she hadn't used in years. The metal flaked under her cloth, the edge long since ruined by sand and salt. She didn't care. The ritual mattered.

"Vesha," she said, scraping rust. "Korrin. Mirel. Dain."

Each name a stone dropped into silence. Each one a soldier who'd followed her into Vareen. Each one dead because she'd obeyed orders.

Outside, the wind rose, slithering through cracks in the wall. Not just wind. Whispers. Faint, layered, syllables that didn't belong to any living tongue. The Old Voices.

"...you were warned..."

She paused. Breathed. Kept scraping.

"the water remembers..."

"Shut up," she muttered, though she wasn't sure if she meant the wind or the memory.

Then the door exploded inward.

Davan stumbled through, bleeding from a gash across his temple, one arm clutched to his chest. His cloak was singed, his eyes wide and wet. He dropped to one knee, gasping. In his grip: a leather satchel, sealed with wax the color of dried blood.

"Kael—"

"You're not supposed to be here."

"They're lying," he choked out. "The empire—founding—all of it—a lie."`

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

// ── Rubrics (the 3 that showed signal) ──────────────────────────────────

const RUBRICS: Array<{ name: string; rubric: string }> = [
  {
    name: "Telling",
    rubric: `You are a prose editor. Find every instance of TELLING instead of SHOWING.

Flag these specific problems:
- DECLARED EMOTION: "[character] was [emotion]" or "[character] felt [emotion]"
- FILTER WORD: "realized", "noticed", "knew", "seemed", "could see", "could hear", "wondered"
- NARRATOR EXPLAINS: narrator tells reader what to conclude instead of showing evidence
- MOTIVATION EXPOSED: "She did X because Y" — explaining why instead of letting reader infer

Do NOT flag:
- Direct internal monologue in character voice
- Brief time-skips ("Three hours later")
- Dialogue that reveals information naturally

Quote each issue exactly. Return JSON:
{"issues": [{"quote": "exact text", "problem": "declared emotion|filter word|narrator explains|motivation exposed"}], "count": N}`,
  },
  {
    name: "Dead Weight",
    rubric: `You are a prose editor. Find every instance of DEAD WEIGHT — words or sentences that add nothing.

Flag these specific problems:
- FILLER PHRASE: "began to", "started to", "seemed to", "in order to", "the fact that"
- REDUNDANT: detail that repeats what's already established or obvious from context
- EMPTY TRANSITION: mechanical connectors that could be cut ("And then", "After that", "Next")
- WASTED SENTENCE: an entire sentence conveying zero new information

Do NOT flag:
- Deliberate repetition for rhythm or emphasis
- Transitions that carry mood or tension

Quote each issue exactly. Return JSON:
{"issues": [{"quote": "exact text", "problem": "filler phrase|redundant|empty transition|wasted sentence"}], "count": N}`,
  },
  {
    name: "Dialogue Problems",
    rubric: `You are a prose editor. Find every instance of DIALOGUE PROBLEMS.

Flag these specific problems:
- ON-THE-NOSE: character says exactly what they mean with zero subtext
- INFO DUMP: character explains something both speakers already know
- SAME VOICE: two characters speak with identical vocabulary and rhythm
- SAID BOOKISM: "he said urgently", "she whispered menacingly" — adverb-heavy tags

Do NOT flag:
- Terse or clipped dialogue (that's a style choice)
- Characters deliberately stating facts in crisis situations

Quote each issue exactly. Return JSON:
{"issues": [{"quote": "exact dialogue", "problem": "on-the-nose|info dump|same voice|said bookism"}], "count": N}`,
  },
]

// ── Model candidates ────────────────────────────────────────────────────

interface JudgeCandidate {
  label: string
  model: string
  apiUrl: string
  apiKey: string
  extraBody?: Record<string, any>
  costPerMTok: number // rough output cost for display
}

function getCandidates(): JudgeCandidate[] {
  const candidates: JudgeCandidate[] = []

  const tryAdd = (label: string, modelId: string, providerName: string) => {
    const model = MODELS.find(m => m.id === modelId && m.provider === providerName)
    if (!model) return
    const provider = PROVIDERS[model.provider]
    if (!process.env[provider.envKey]) return
    candidates.push({
      label: `${model.label} (${providerName})`,
      model: model.id,
      apiUrl: provider.apiUrl,
      apiKey: getApiKey(model.provider),
      extraBody: provider.extraBody?.(),
      costPerMTok: model.pricing.output,
    })
  }

  // Cheapest first
  tryAdd("Llama 8B", "llama-3.1-8b-instant", "groq")
  tryAdd("Llama 8B", "llama3.1-8b", "cerebras")
  tryAdd("GPT-OSS 20B", "openai/gpt-oss-20b", "groq")
  tryAdd("Scout 17B", "meta-llama/llama-4-scout-17b-16e-instruct", "groq")
  tryAdd("GPT-OSS 120B", "openai/gpt-oss-120b", "groq")
  tryAdd("GPT-OSS 120B", "gpt-oss-120b", "cerebras")
  tryAdd("Qwen3 32B", "qwen/qwen3-32b", "groq")

  return candidates
}

async function callJudge(candidate: JudgeCandidate, rubric: string, prose: string): Promise<z.infer<typeof penaltySchema> | null> {
  try {
    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(candidate.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${candidate.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: candidate.model,
          messages: [{ role: "system", content: rubric }, { role: "user", content: prose }],
          temperature: 0.1,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          ...candidate.extraBody,
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

    // Validate count matches issues array length
    return { ...result.data, count: result.data.issues.length }
  } catch {
    return null
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const RUNS = 3

async function main() {
  const candidates = getCandidates()
  if (candidates.length === 0) { console.error("No models available"); process.exit(1) }

  const wordCounts = SAMPLES.map(s => s.prose.split(/\s+/).length)
  console.log(`\nJudge Model Shootout`)
  console.log(`Models: ${candidates.map(c => c.label).join(", ")}`)
  console.log(`Rubrics: ${RUBRICS.map(r => r.name).join(", ")}`)
  console.log(`Samples: ${SAMPLES.map((s, i) => `${s.label} (${wordCounts[i]}w)`).join(", ")}`)
  console.log(`Runs: ${RUNS}`)
  console.log(`Total calls: ${candidates.length} models x ${RUBRICS.length} rubrics x ${SAMPLES.length} samples x ${RUNS} runs = ${candidates.length * RUBRICS.length * SAMPLES.length * RUNS}\n`)

  type Result = { model: string; rubric: string; sample: string; run: number; count: number; issues: Array<{ quote: string; problem: string }> }
  const results: Result[] = []

  // Run each model sequentially to avoid rate limits across providers
  for (const candidate of candidates) {
    console.log(`\n${"=".repeat(50)}`)
    console.log(`  ${candidate.label} ($${candidate.costPerMTok}/M output)`)
    console.log(`${"=".repeat(50)}`)

    for (const rubric of RUBRICS) {
      console.log(`\n  ${rubric.name}:`)
      for (const sample of SAMPLES) {
        const counts: string[] = []
        for (let run = 1; run <= RUNS; run++) {
          const result = await callJudge(candidate, rubric.rubric, sample.prose)
          if (result) {
            results.push({ model: candidate.label, rubric: rubric.name, sample: sample.label, run, ...result })
            counts.push(String(result.count))
          } else {
            counts.push("FAIL")
          }
        }
        console.log(`    ${sample.label.padEnd(8)} [${counts.join(", ")}]`)
      }
    }
  }

  // ── Analysis ──────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(80)}`)
  console.log(`  SHOOTOUT RESULTS`)
  console.log(`${"=".repeat(80)}`)

  // Per model, per rubric: avg issue counts and discrimination
  for (const rubric of RUBRICS) {
    console.log(`\n  ── ${rubric.name} ──`)
    console.log(`  ${"Model".padEnd(28)} ${"WEAK".padEnd(14)} ${"MID".padEnd(14)} ${"STRONG".padEnd(14)} W>M>S? Consistent?`)
    console.log(`  ${"-".repeat(86)}`)

    for (const candidate of candidates) {
      const get = (sample: string) => {
        const counts = results.filter(r => r.model === candidate.label && r.rubric === rubric.name && r.sample === sample).map(r => r.count)
        const avg = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : -1
        const spread = counts.length >= 2 ? Math.max(...counts) - Math.min(...counts) : 0
        return { counts, avg, spread }
      }

      const weak = get("WEAK")
      const mid = get("MID")
      const strong = get("STRONG")

      // Correct ordering for penalties: WEAK > MID > STRONG (more issues = worse)
      const ordered = weak.avg > mid.avg && mid.avg > strong.avg
      // Consistent: no overlap between adjacent tiers
      const consistent = weak.avg >= 0 && mid.avg >= 0 && strong.avg >= 0 &&
        Math.min(...weak.counts) > Math.max(...mid.counts) &&
        Math.min(...mid.counts) > Math.max(...strong.counts)

      const fmt = (d: { avg: number; counts: number[] }) =>
        d.avg >= 0 ? `${d.avg.toFixed(1)} [${d.counts.join(",")}]` : "FAIL"

      const disc = weak.avg < 0 || mid.avg < 0 || strong.avg < 0 ? "N/A" :
        ordered ? (consistent ? "YES clean" : "yes overlap") : "NO"

      console.log(`  ${candidate.label.padEnd(28)} ${fmt(weak).padEnd(14)} ${fmt(mid).padEnd(14)} ${fmt(strong).padEnd(14)} ${disc}`)
    }
  }

  // ── Summary: best model per rubric ────────────────────────────────────

  console.log(`\n${"=".repeat(80)}`)
  console.log(`  SUMMARY`)
  console.log(`${"=".repeat(80)}\n`)

  for (const rubric of RUBRICS) {
    const modelScores = candidates.map(candidate => {
      const get = (sample: string) => {
        const counts = results.filter(r => r.model === candidate.label && r.rubric === rubric.name && r.sample === sample).map(r => r.count)
        return counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : -1
      }
      const weak = get("WEAK"), mid = get("MID"), strong = get("STRONG")
      const ordered = weak > mid && mid > strong
      const gap = mid - strong
      const consistency = results.filter(r => r.model === candidate.label && r.rubric === rubric.name)
        .reduce((groups, r) => {
          const key = r.sample
          if (!groups[key]) groups[key] = []
          groups[key].push(r.count)
          return groups
        }, {} as Record<string, number[]>)
      const maxSpread = Math.max(...Object.values(consistency).map(c => c.length >= 2 ? Math.max(...c) - Math.min(...c) : 0))

      return { label: candidate.label, cost: candidate.costPerMTok, ordered, gap, maxSpread, failRate: weak < 0 || mid < 0 || strong < 0 }
    })

    const best = modelScores.filter(m => m.ordered && !m.failRate).sort((a, b) => {
      // Sort by gap desc (more separation = better), then cost asc
      if (Math.abs(b.gap - a.gap) > 0.5) return b.gap - a.gap
      return a.cost - b.cost
    })

    console.log(`  ${rubric.name}: ${best.length > 0 ? `${best[0].label} (gap: ${best[0].gap.toFixed(1)}, spread: ${best[0].maxSpread}, $${best[0].cost}/M)` : "no model discriminates"}`)
  }

  console.log()
}

main()
