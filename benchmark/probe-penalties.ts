/**
 * Penalty dimension probe: test flaw-detection rubrics against MID vs STRONG.
 *
 * Instead of "rate the quality 1-10", these rubrics ask "find specific problems."
 * Score = issue count (lower = better prose). Tests whether 32B can reliably
 * detect concrete flaws rather than grading abstract quality.
 *
 * Usage: bun benchmark/probe-penalties.ts
 */

import { readFileSync, existsSync } from "node:fs"
import { extractJSON } from "../src/llm"
import { MODELS, PROVIDERS, getApiKey } from "../models/registry"
import { z } from "zod"

// ── Schema for penalty rubrics ──────────────────────────────────────────

const penaltySchema = z.object({
  issues: z.array(z.object({
    quote: z.string(),
    problem: z.string(),
  })),
  count: z.number(),
  summary: z.string(),
})

// ── Samples ─────────────────────────────────────────────────────────────

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

const WEAK = `General Kael was a disgraced military leader who had been exiled to a remote outpost. She was very angry about her situation and felt bitter every day. The outpost was in a desert and it was hot and dry. She was responsible for maintaining the water system but she didn't really care about it anymore because she was too upset about her past.

One day a man named Davan arrived. He was injured and scared. He told her that the empire was based on lies. "The empire is lying to everyone," he said urgently. "I found proof that the founding was a fraud." Kael was shocked by this news. She didn't know what to think.

Then some assassins attacked. They were sent by the empire to stop the truth from getting out. Kael fought them because she was a skilled warrior. She defeated all three of them easily because of her military training. After the fight she looked at the documents Davan had brought and realized that everything she had believed was wrong. She felt a mixture of anger and determination. She decided she needed to do something about it.

The wind blew outside. It was a dark and stormy night. She picked up the satchel and knew that her life was about to change forever. She was scared but also brave.`

const SAMPLES = [
  { label: "WEAK", prose: WEAK },
  { label: "MID", prose: MID },
  { label: "STRONG", prose: STRONG },
]

// ── Penalty rubrics ─────────────────────────────────────────────────────

const DIMENSIONS: Array<{ name: string; rubric: string }> = [
  {
    name: "Overwrought",
    rubric: `You are a prose editor scanning for **overwrought writing** — passages where the prose tries too hard.

Find every instance of:
- **Stacked metaphors**: 2+ figurative comparisons within 2 sentences of each other (metaphor fatigue)
- **Purple prose**: adjective/adverb pileups, ornate phrasing where plain language would be stronger
- **Melodrama**: emotional language that exceeds what the scene has earned ("her world shattered", "the weight of a thousand sorrows")
- **Redundant emphasis**: saying the same thing twice in different words for effect that falls flat

For each issue found, quote the exact passage and name the problem type.

If a metaphor is vivid AND isolated (not stacked), it is NOT an issue.
If ornate language serves a clear purpose (establishing voice, matching scene intensity), it is NOT an issue.

Respond with valid JSON:
{
  "issues": [{ "quote": "exact text", "problem": "stacked metaphors|purple prose|melodrama|redundant emphasis" }],
  "count": N,
  "summary": "one sentence overall assessment"
}

If there are no issues, return count: 0 and an empty issues array.`,
  },
  {
    name: "Repetition",
    rubric: `You are a prose editor scanning for **repetition and homogeneity** — patterns that make the writing feel mechanical.

Find every instance of:
- **Sentence opener repetition**: 3+ sentences starting with the same word or structure within a paragraph (e.g., "She" opening 4 consecutive sentences)
- **Recycled phrasing**: the same phrase, image, or descriptor used more than once (unless deliberate for rhythm/theme)
- **Structural monotony**: 3+ consecutive paragraphs following the same template (e.g., action-dialogue-reaction, action-dialogue-reaction)
- **Verb pattern repetition**: same verb form used 3+ times in close proximity (e.g., "She walked... She turned... She looked...")

For each issue found, quote the exact passages showing the repetition and name the problem type.

If repetition is clearly intentional for rhythmic effect (e.g., anaphora, litany), note it but do NOT count it as an issue.

Respond with valid JSON:
{
  "issues": [{ "quote": "exact text showing pattern", "problem": "opener repetition|recycled phrasing|structural monotony|verb pattern" }],
  "count": N,
  "summary": "one sentence overall assessment"
}

If there are no issues, return count: 0 and an empty issues array.`,
  },
  {
    name: "Psychic Distance",
    rubric: `You are a prose editor scanning for **psychic distance violations** — moments where the narrative POV shifts in jarring or unintentional ways.

Psychic distance = how close the reader is to the character's consciousness.
- CLOSE: "The seal was failing. Damn." (character's thoughts, their words)
- MEDIUM: "She pressed her finger to the seal, feeling it give." (close third, filtered through character)
- FAR: "General Kael was a disgraced military leader." (narrator summary, distant)

Find every instance of:
- **Unintentional distance shift**: the prose jumps from close to far (or far to close) without scene break or purposeful transition
- **Head-hopping**: access to multiple characters' internal states in the same scene without clear transition
- **Narrator intrusion**: the narrating voice suddenly becomes visible in a close-POV passage (e.g., explaining something the POV character wouldn't think about)
- **Tense/perspective inconsistency**: shifts between "she felt" (mediated) and direct thought without pattern

For each issue found, quote the passage and explain the distance levels before and after.

If a distance shift is clearly intentional (e.g., zooming out at a scene break, or pulling close for impact), it is NOT an issue.

Respond with valid JSON:
{
  "issues": [{ "quote": "exact text", "problem": "distance shift|head-hopping|narrator intrusion|tense inconsistency" }],
  "count": N,
  "summary": "one sentence overall assessment"
}

If there are no issues, return count: 0 and an empty issues array.`,
  },
  {
    name: "Telling",
    rubric: `You are a prose editor scanning for **telling instead of showing** — moments where the narrator explains what should be dramatized.

Find every instance of:
- **Declared emotions**: "[character] was [emotion]" or "[character] felt [emotion]" — e.g., "She was angry", "He felt nervous", "A wave of sadness washed over her"
- **Filter words**: "realized", "noticed", "knew", "seemed", "could see", "could hear", "was aware", "wondered", "thought to herself"
- **Narrator explanation**: the narrator tells the reader what to conclude instead of letting action/dialogue show it — e.g., "This meant everything had changed", "It was clear that he was lying"
- **Motivation exposition**: "She did X because Y" — explaining character motivation instead of letting the reader infer it

For each issue found, quote the exact passage and name the problem type.

If a brief telling phrase serves pacing (e.g., "Three hours later" to skip time), it is NOT an issue.
If a thought is presented as direct internal monologue in character voice, it is NOT an issue.

Respond with valid JSON:
{
  "issues": [{ "quote": "exact text", "problem": "declared emotion|filter word|narrator explanation|motivation exposition" }],
  "count": N,
  "summary": "one sentence overall assessment"
}

If there are no issues, return count: 0 and an empty issues array.`,
  },
  {
    name: "Dead Weight",
    rubric: `You are a prose editor scanning for **dead weight** — words, phrases, and sentences that add nothing.

Find every instance of:
- **Filler phrases**: "began to", "started to", "seemed to", "in order to", "the fact that", "it was [adjective] that"
- **Redundant description**: details that repeat what's already been established or what the reader can infer from context
- **Empty transitions**: "Then", "And then", "After that", "Next" — mechanical connectors that could be cut
- **Wasted sentences**: entire sentences that convey zero new information, mood, or character insight

For each issue found, quote the exact passage and explain what could be cut without losing meaning.

If a word like "then" is used once for pacing, it is NOT an issue. Only flag patterns or truly empty language.

Respond with valid JSON:
{
  "issues": [{ "quote": "exact text", "problem": "filler phrase|redundant description|empty transition|wasted sentence" }],
  "count": N,
  "summary": "one sentence overall assessment"
}

If there are no issues, return count: 0 and an empty issues array.`,
  },
  {
    name: "Dialogue Problems",
    rubric: `You are a prose editor scanning for **dialogue problems** — specific flaws in how characters speak.

Find every instance of:
- **On-the-nose dialogue**: characters say exactly what they mean with no subtext, evasion, or indirection — e.g., "I'm scared and I don't know what to do" instead of showing fear through deflection or avoidance
- **Info-dumping speech**: characters explain things to each other that both would already know ("As you know, our empire was founded 300 years ago...")
- **Uniform voice**: two or more characters who use the same vocabulary, sentence length, and speech rhythm — indistinguishable without tags
- **Said bookisms / adverb tags**: "he said urgently", "she whispered menacingly", "he exclaimed" — the dialogue should carry its own tone

For each issue found, quote the dialogue and name the problem type.

If characters are deliberately formal or share speech patterns for a story reason, note it but do NOT count it as an issue.

Respond with valid JSON:
{
  "issues": [{ "quote": "exact dialogue", "problem": "on-the-nose|info-dump|uniform voice|said bookism" }],
  "count": N,
  "summary": "one sentence overall assessment"
}

If there are no issues, return count: 0 and an empty issues array.`,
  },
]

// ── Judge setup ─────────────────────────────────────────────────────────

const judgeModel = MODELS.find(m => m.label === "Qwen3 32B" && !!process.env[PROVIDERS[m.provider].envKey])
if (!judgeModel) { console.error("Qwen3 32B not available"); process.exit(1) }

const provider = PROVIDERS[judgeModel.provider]
const judgeConfig = {
  apiUrl: provider.apiUrl,
  apiKey: getApiKey(judgeModel.provider),
  model: judgeModel.id,
  extraBody: provider.extraBody?.(),
}

async function callJudge(rubric: string, prose: string): Promise<z.infer<typeof penaltySchema> | null> {
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

    if (!res!.ok) { console.log(`    ! [http ${res!.status}]`); return null }
    const data = await res!.json() as any
    if (data.error) { console.log(`    ! [api error]`); return null }

    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = penaltySchema.safeParse(parsed)
    if (!result.success) { console.log(`    ! [zod] ${result.error.issues.map(i => i.message).join("; ")}`); return null }

    return result.data
  } catch (err) {
    console.log(`    ! [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const RUNS = 3

async function main() {
  console.log(`\nPenalty Dimension Probe`)
  console.log(`Judge: Qwen3 32B`)
  console.log(`Dimensions: ${DIMENSIONS.map(d => d.name).join(", ")}`)
  console.log(`Samples: ${SAMPLES.map(s => s.label).join(", ")}`)
  console.log(`Runs: ${RUNS}`)
  console.log(`Total calls: ${DIMENSIONS.length} dims x ${SAMPLES.length} samples x ${RUNS} runs = ${DIMENSIONS.length * SAMPLES.length * RUNS}\n`)

  const results: Array<{ dim: string; sample: string; run: number; count: number; issues: Array<{ quote: string; problem: string }>; summary: string }> = []

  for (const dim of DIMENSIONS) {
    console.log(`\n── ${dim.name} ──`)

    for (const sample of SAMPLES) {
      for (let run = 1; run <= RUNS; run++) {
        const result = await callJudge(dim.rubric, sample.prose)
        if (result) {
          results.push({ dim: dim.name, sample: sample.label, run, ...result })
          console.log(`  ${sample.label} run${run}: ${result.count} issues`)
        } else {
          console.log(`  ${sample.label} run${run}: FAIL`)
        }
      }
    }
  }

  // ── Analysis ──────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  PENALTY PROBE RESULTS (lower = better prose)`)
  console.log(`${"=".repeat(70)}`)
  console.log(`\n  ${"Dimension".padEnd(20)} ${"WEAK".padEnd(16)} ${"MID".padEnd(16)} ${"STRONG".padEnd(16)} MID-STRONG gap`)
  console.log(`  ${"-".repeat(80)}`)

  for (const dim of DIMENSIONS) {
    const weakCounts = results.filter(r => r.dim === dim.name && r.sample === "WEAK").map(r => r.count)
    const midCounts = results.filter(r => r.dim === dim.name && r.sample === "MID").map(r => r.count)
    const strongCounts = results.filter(r => r.dim === dim.name && r.sample === "STRONG").map(r => r.count)

    const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : "N/A"
    const weakAvg = avg(weakCounts)
    const midAvg = avg(midCounts)
    const strongAvg = avg(strongCounts)

    const midN = midCounts.length ? midCounts.reduce((a, b) => a + b, 0) / midCounts.length : 0
    const strongN = strongCounts.length ? strongCounts.reduce((a, b) => a + b, 0) / strongCounts.length : 0
    const gap = midN - strongN

    console.log(`  ${dim.name.padEnd(20)} ${`${weakAvg} [${weakCounts.join(",")}]`.padEnd(16)} ${`${midAvg} [${midCounts.join(",")}]`.padEnd(16)} ${`${strongAvg} [${strongCounts.join(",")}]`.padEnd(16)} ${gap > 0 ? "+" : ""}${gap.toFixed(1)}`)
  }

  // ── Show issues found for MID (most actionable) ───────────────────────

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  ISSUES FOUND IN MID (run 1) — actionable feedback for writer prompt`)
  console.log(`${"=".repeat(70)}`)

  for (const dim of DIMENSIONS) {
    const entry = results.find(r => r.dim === dim.name && r.sample === "MID" && r.run === 1)
    if (entry && entry.issues.length > 0) {
      console.log(`\n  ${dim.name} (${entry.count} issues):`)
      for (const issue of entry.issues) {
        console.log(`    [${issue.problem}] "${issue.quote.slice(0, 100)}${issue.quote.length > 100 ? "..." : ""}"`)
      }
    } else if (entry) {
      console.log(`\n  ${dim.name}: clean`)
    }
  }

  console.log()
}

main()
