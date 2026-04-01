/**
 * Probe additional penalty dimensions with GPT-OSS 120B.
 * Tests dimensions that failed with 32B to see if 120B handles them better.
 *
 * Usage: bun benchmark/probe-120b.ts
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

// ── Normalized samples (~500 words) ─────────────────────────────────────

const WEAK = `General Kael was a disgraced military leader who had been exiled to a remote outpost. She was very angry about her situation and felt bitter every day. The outpost was in a desert and it was hot and dry. She was responsible for maintaining the water system but she didn't really care about it anymore because she was too upset about her past.

She walked along the aqueduct every morning. It was always the same. The water was low and the stone was cracking. She could see that things were getting worse but she didn't have the energy to fix them. She thought about her old life constantly. She had been someone important once. Now she was nobody.

One day a man named Davan arrived at the outpost. He was injured and scared. He had been traveling for a long time and he was exhausted. He told her that the empire was based on lies. "The empire is lying to everyone," he said urgently. "I found proof that the founding was a fraud." Kael was shocked by this news. She didn't know what to think about it.

She felt confused and overwhelmed. She realized that everything she had believed her whole life might be wrong. She was angry but also curious. She wanted to know more but she was also afraid of what she might learn. Davan was very insistent that they needed to act quickly.

Then some assassins attacked the outpost. They were sent by the empire to stop the truth from getting out. There were three of them and they were very skilled. Kael fought them because she was a skilled warrior. She defeated all three of them easily because of her military training. The fight was intense but she was clearly superior. She moved quickly and struck hard.

After the fight she looked at the documents Davan had brought and realized that everything she had believed was wrong. She felt a mixture of anger and determination. She decided she needed to do something about it. The wind blew outside and it was getting dark. She picked up the satchel and knew that her life was about to change forever. She was scared but also brave. She knew what she had to do even if she didn't want to do it.

She looked out at the desert one more time. The sun was setting and the sky was red and orange. It was beautiful but also sad somehow. Everything she had known was a lie and she was going to have to face the truth. She took a deep breath and stepped forward into her new life.`

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

// ── Candidate dimensions ────────────────────────────────────────────────

const DIMENSIONS: Array<{ name: string; rubric: string }> = [
  {
    name: "Overwrought",
    rubric: `You are a prose editor. Find every instance of OVERWROUGHT WRITING — passages where the prose tries too hard.

Flag these specific problems:
- STACKED METAPHORS: 2+ figurative comparisons within 2 consecutive sentences
- PURPLE PROSE: adjective/adverb pileups where plain language would be stronger, ornate phrasing that calls attention to itself
- MELODRAMA: emotional language that exceeds what the scene has earned ("her world shattered", "the weight of a thousand sorrows")
- REDUNDANT EMPHASIS: saying the same thing twice in different words for effect that falls flat

Do NOT flag:
- A single vivid metaphor standing alone (that's good writing)
- Ornate language that matches scene intensity (a battle scene can be visceral)
- Intentional stylistic voice

Quote each issue exactly. Return JSON:
{"issues": [{"quote": "exact text", "problem": "stacked metaphors|purple prose|melodrama|redundant emphasis"}], "count": N}`,
  },
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
{"issues": [{"quote": "exact text showing pattern", "problem": "opener repetition|verb pattern|recycled image|paragraph template"}], "count": N}`,
  },
  {
    name: "Psychic Distance",
    rubric: `You are a prose editor. Find every instance of PSYCHIC DISTANCE VIOLATION — moments where the narrative proximity to the character shifts without purpose.

Psychic distance levels:
- CLOSE: character's direct thoughts, their vocabulary, immediate sensation
- MEDIUM: close third person, filtered through character perception
- FAR: narrator summary, objective description, biographical information

Flag these specific problems:
- JARRING SHIFT: prose jumps 2+ levels (e.g., close internal thought to distant narrator summary) without scene break
- HEAD-HOPPING: access to a second character's private thoughts in a single-POV scene
- NARRATOR INTRUSION: an authorial observation or explanation that breaks the character's POV ("Little did she know...")
- UNEARNED OMNISCIENCE: the POV character perceives something they couldn't know from their position

Do NOT flag:
- Gradual zooming in or out across a paragraph
- Intentional shifts at scene or chapter breaks
- A character observing another's visible behavior

Quote each issue and explain the distance levels before and after. Return JSON:
{"issues": [{"quote": "exact text", "problem": "jarring shift|head-hopping|narrator intrusion|unearned omniscience"}], "count": N}`,
  },
  {
    name: "Generic Detail",
    rubric: `You are a prose editor. Find every instance of GENERIC DETAIL — descriptions that could appear in any novel rather than being specific to this world.

Flag these specific problems:
- STOCK SETTING: setting details that are genre defaults rather than specific ("ancient stone walls", "bustling marketplace", "dark alley")
- VAGUE PHYSICALITY: character actions described without precision ("she moved quickly", "he attacked", "she fought")
- TEMPLATE EMOTION: emotion conveyed through cliche physical responses ("heart pounded", "blood ran cold", "stomach dropped", "breath caught")
- PLACEHOLDER SENSORY: sensory details that name a sense without specifying ("a loud noise", "a strong smell", "the cold wind")

Do NOT flag:
- Precise, world-specific details even if they describe common things
- Deliberate simplicity in high-action moments for pacing
- Sensory details that are specific enough to picture ("the wet crack of splitting wood")

Quote each issue exactly. Return JSON:
{"issues": [{"quote": "exact text", "problem": "stock setting|vague physicality|template emotion|placeholder sensory"}], "count": N}`,
  },
  {
    name: "Pacing Stalls",
    rubric: `You are a prose editor. Find every instance of PACING STALLS — moments where forward momentum dies.

Flag these specific problems:
- OVER-DESCRIPTION: 3+ consecutive sentences of static description with no action, dialogue, or tension
- UNNECESSARY RECAP: restating what just happened or what the reader already knows
- STALLED INTERIORITY: character reflecting/ruminating for 3+ sentences without new insight or decision
- ANTI-CLIMAX: a tense moment that deflates through over-explanation or delayed resolution

Do NOT flag:
- Deliberately quiet moments that build atmosphere with new information
- Reflection that reveals something the reader didn't know
- Description that carries tension or subtext

Quote each issue exactly. Return JSON:
{"issues": [{"quote": "exact text", "problem": "over-description|unnecessary recap|stalled interiority|anti-climax"}], "count": N}`,
  },
]

// ── Judge setup (GPT-OSS 120B on Groq) ─────────────────────────────────

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

async function judge(rubric: string, prose: string): Promise<z.infer<typeof penaltySchema> | null> {
  try {
    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(judgeConfig.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${judgeConfig.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: judgeConfig.model,
          messages: [{ role: "system", content: rubric }, { role: "user", content: prose }],
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

    return { ...result.data, count: result.data.issues.length }
  } catch {
    return null
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const RUNS = 3

async function main() {
  console.log(`\nGPT-OSS 120B Dimension Probe`)
  console.log(`Dimensions: ${DIMENSIONS.map(d => d.name).join(", ")}`)
  console.log(`Samples: ${SAMPLES.map(s => s.label).join(", ")}`)
  console.log(`Runs: ${RUNS}`)
  console.log(`Total calls: ${DIMENSIONS.length} x ${SAMPLES.length} x ${RUNS} = ${DIMENSIONS.length * SAMPLES.length * RUNS}\n`)

  type Result = { dim: string; sample: string; run: number; count: number; issues: Array<{ quote: string; problem: string }> }
  const results: Result[] = []

  for (const dim of DIMENSIONS) {
    console.log(`── ${dim.name} ──`)
    for (const sample of SAMPLES) {
      const counts: string[] = []
      for (let run = 1; run <= RUNS; run++) {
        const result = await judge(dim.rubric, sample.prose)
        if (result) {
          results.push({ dim: dim.name, sample: sample.label, run, count: result.issues.length, issues: result.issues })
          counts.push(String(result.issues.length))
        } else {
          counts.push("FAIL")
        }
      }
      console.log(`  ${sample.label.padEnd(8)} [${counts.join(", ")}]`)
    }
    console.log()
  }

  // ── Analysis ──────────────────────────────────────────────────────────

  console.log(`${"=".repeat(80)}`)
  console.log(`  RESULTS (lower = better prose)`)
  console.log(`${"=".repeat(80)}`)
  console.log(`\n  ${"Dimension".padEnd(20)} ${"WEAK".padEnd(16)} ${"MID".padEnd(16)} ${"STRONG".padEnd(16)} W>M>S?  MID-STR gap  Consistency`)
  console.log(`  ${"-".repeat(100)}`)

  type DimStat = { name: string; ordered: boolean; gap: number; maxSpread: number; weakAvg: number; midAvg: number; strongAvg: number }
  const stats: DimStat[] = []

  for (const dim of DIMENSIONS) {
    const get = (sample: string) => {
      const counts = results.filter(r => r.dim === dim.name && r.sample === sample).map(r => r.count)
      const avg = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : -1
      const spread = counts.length >= 2 ? Math.max(...counts) - Math.min(...counts) : 0
      return { counts, avg, spread }
    }

    const weak = get("WEAK")
    const mid = get("MID")
    const strong = get("STRONG")

    const ordered = weak.avg > mid.avg && mid.avg > strong.avg
    const gap = mid.avg - strong.avg
    const maxSpread = Math.max(weak.spread, mid.spread, strong.spread)

    stats.push({ name: dim.name, ordered, gap, maxSpread, weakAvg: weak.avg, midAvg: mid.avg, strongAvg: strong.avg })

    const fmt = (d: { avg: number; counts: number[] }) =>
      d.avg >= 0 ? `${d.avg.toFixed(1)} [${d.counts.join(",")}]` : "FAIL"
    const disc = ordered ? (maxSpread <= 1 ? "YES clean" : "YES") : "NO"

    console.log(`  ${dim.name.padEnd(20)} ${fmt(weak).padEnd(16)} ${fmt(mid).padEnd(16)} ${fmt(strong).padEnd(16)} ${disc.padEnd(10)} ${gap >= 0 ? "+" : ""}${gap.toFixed(1).padEnd(12)} +-${maxSpread}`)
  }

  // ── Ranking ───────────────────────────────────────────────────────────

  console.log(`\n  Ranked by usefulness (ordered + gap + consistency):`)
  stats.sort((a, b) => {
    if (a.ordered !== b.ordered) return a.ordered ? -1 : 1
    if (Math.abs(b.gap - a.gap) > 0.3) return b.gap - a.gap
    return a.maxSpread - b.maxSpread
  })

  for (const s of stats) {
    const icon = s.ordered ? ">>>" : "   "
    console.log(`  ${icon} ${s.name.padEnd(20)} gap: ${s.gap >= 0 ? "+" : ""}${s.gap.toFixed(1)}  spread: +-${s.maxSpread}  ${s.ordered ? "DISCRIMINATES" : "no signal"}`)
  }

  // ── Show MID issues for discriminating dimensions ─────────────────────

  const good = stats.filter(s => s.ordered)
  if (good.length > 0) {
    console.log(`\n${"=".repeat(80)}`)
    console.log(`  MID SAMPLE ISSUES (run 1) — dimensions that discriminate`)
    console.log(`${"=".repeat(80)}`)

    for (const s of good) {
      const entry = results.find(r => r.dim === s.name && r.sample === "MID" && r.run === 1)
      if (entry && entry.issues.length > 0) {
        console.log(`\n  ${s.name} (${entry.count} issues):`)
        for (const issue of entry.issues.slice(0, 5)) {
          console.log(`    [${issue.problem}] "${issue.quote.slice(0, 120)}${issue.quote.length > 120 ? "..." : ""}"`)
        }
      }
    }
  }

  console.log()
}

main()
