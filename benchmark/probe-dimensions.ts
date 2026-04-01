/**
 * Dimension probe: test multiple candidate rubrics against MID vs STRONG
 * to find which dimensions Qwen3 32B can actually discriminate.
 *
 * Usage: bun benchmark/probe-dimensions.ts
 */

import { readFileSync, existsSync } from "node:fs"
import { extractJSON } from "../src/llm"
import { judgeScoreSchema } from "./prose/judges/schema"
import { MODELS, PROVIDERS, getApiKey } from "../models/registry"

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

const SAMPLES = [
  { label: "MID", prose: MID },
  { label: "STRONG", prose: STRONG },
]

// ── Candidate dimensions ────────────────────────────────────────────────

const DIMENSIONS: Array<{ name: string; rubric: string }> = [
  {
    name: "Sentence Rhythm",
    rubric: `You are a literary critic evaluating **Sentence Rhythm and Variety**.

Assess whether the prose varies its sentence structure, length, and rhythm — or falls into repetitive patterns.

## Scoring Rubric

**1-3: Monotonous.** Sentences follow the same pattern (subject-verb-object, similar length). Reading aloud reveals a metronomic quality. No variation in pace.

**4-5: Occasional variation.** A few sentences break the pattern, but the default rhythm is predictable. Short declaratives may cluster. Paragraph openings repeat similar constructions.

**6-7: Moderate variety.** Mix of long and short sentences, but patterns still emerge over multiple paragraphs. Some intentional rhythm shifts at dramatic moments.

**8-9: Strong variety.** Sentence length and structure shift purposefully. Fragments used for impact. Long sentences build tension, short ones release it. Rhythm matches content — fast during action, measured during reflection.

**10: Masterful.** The prose has a distinctive rhythmic signature. Every sentence length and structure choice feels deliberate. Reading aloud reveals musicality. The rhythm itself carries meaning.

Quote 3 consecutive sentences that demonstrate the dominant rhythm pattern, and 3 that break it (if any). Note the ratio.

Respond with valid JSON: { "score": N, "reasoning": "..." }`,
  },
  {
    name: "Metaphor Originality",
    rubric: `You are a literary critic evaluating **Metaphor and Image Originality**.

Assess whether figurative language (metaphors, similes, imagery) is fresh and specific to this world — or relies on stock phrases and cliches.

## Scoring Rubric

**1-3: Stock imagery.** Cliches and dead metaphors: "dark as night", "heart pounding", "cold as ice". Images could appear in any story.

**4-5: Functional but generic.** Comparisons make sense but aren't surprising. "Like a knife through butter." Images drawn from a common pool rather than this specific world.

**6-7: Some original images.** A few metaphors surprise or feel specific to the setting/character. But they sit alongside generic ones. Mixed quality.

**8-9: Consistently fresh.** Most figurative language is unexpected and precise. Images are drawn from the world itself (a desert character thinks in terms of water and sand, not forests). Metaphors do work beyond decoration — they reveal character or theme.

**10: Extraordinary.** Every image earns its place. Figurative language is so precise it couldn't belong to any other story. Images compound — early metaphors resonate with later ones. The imagery has a coherent logic.

List every simile and metaphor in the text. For each, mark it as STOCK (could appear in any novel), FUNCTIONAL (makes sense but not surprising), or ORIGINAL (specific, unexpected, world-grounded). Count the ratio.

Respond with valid JSON: { "score": N, "reasoning": "..." }`,
  },
  {
    name: "Prose Density",
    rubric: `You are a literary critic evaluating **Prose Density** — how much meaning is packed into each sentence.

Assess whether sentences carry multiple layers of meaning (advancing plot + revealing character + grounding setting simultaneously) — or whether each sentence does only one job.

## Scoring Rubric

**1-3: Thin.** Most sentences serve a single purpose: either advancing plot, or describing setting, or stating emotion. Information is delivered sequentially, one thing at a time.

**4-5: Single-purpose with exceptions.** Occasionally a sentence does double duty, but the default is one job per sentence. Descriptions sit separate from action.

**6-7: Regular double duty.** Many sentences combine two functions — action that reveals character, description that builds tension. But some stretches are still single-purpose.

**8-9: Consistently layered.** Most sentences carry 2-3 functions simultaneously. A character's physical action reveals their psychology while grounding the scene. Exposition is woven into dramatic moments rather than separated.

**10: Every word earns its place.** Sentences are compressed and resonant. Nothing is merely decorative or merely functional. Cutting any sentence would lose multiple threads of meaning.

Select 3 sentences. For each, list every function it serves (plot, character, setting, mood, theme, foreshadowing). Count average functions per sentence.

Respond with valid JSON: { "score": N, "reasoning": "..." }`,
  },
  {
    name: "Tension & Pacing",
    rubric: `You are a literary critic evaluating **Tension and Pacing**.

Assess whether the prose builds, sustains, and modulates tension — or moves at a flat, uniform pace.

## Scoring Rubric

**1-3: Flat.** Events happen at the same emotional intensity throughout. No build, no release. Action scenes feel the same as quiet scenes. The reader has no reason to lean forward or hold breath.

**4-5: Some tension but poorly modulated.** The prose attempts dramatic moments but doesn't build to them. Climaxes arrive without preparation. Quiet moments feel like dead air rather than deliberate restraint.

**6-7: Functional pacing.** Clear shifts between high and low tension. Action scenes accelerate. But transitions feel mechanical — the gears of pacing are visible.

**8-9: Expert modulation.** Tension builds through accumulation of small details before release. Quiet moments are loaded with unresolved questions. Pacing shifts feel organic. The prose controls when the reader breathes.

**10: Invisible mastery.** The reader's pulse follows the prose without being aware of the technique. Micro-tension in every scene — even quiet ones carry threat or promise. The structure of tension reveals theme.

Map the tension arc: identify the lowest and highest tension moments. Note how many beats of escalation exist between them. Does tension build through accumulation or arrive suddenly?

Respond with valid JSON: { "score": N, "reasoning": "..." }`,
  },
  {
    name: "Character Interiority",
    rubric: `You are a literary critic evaluating **Character Interiority** — the depth and specificity of the protagonist's inner life.

Assess whether the reader inhabits the character's consciousness — or merely watches from outside.

## Scoring Rubric

**1-3: External only.** The character is described entirely through action and dialogue. No access to thought, perception, or private emotional response. Could be a camera recording events.

**4-5: Surface interiority.** Some access to the character's thoughts, but they're generic — anyone might think these things. Emotions are named but not explored. "She felt angry."

**6-7: Consistent but shallow.** The reader knows what the character thinks and feels, with some specificity. But the inner voice doesn't surprise — it confirms what the action already shows rather than adding a new layer.

**8-9: Deep and specific.** The character's interiority reveals contradictions, suppressed feelings, or perceptions the surface action doesn't show. Their way of seeing the world is distinctive — they notice things another character wouldn't. The gap between inner life and outer action creates tension.

**10: Fully inhabited.** The prose IS the character's consciousness. Every description is filtered through their specific history, fears, and desires. The reader understands things about the character that the character doesn't understand about themselves.

Identify 2 moments where we access the character's inner life. For each: does the interiority ADD information beyond what action/dialogue already shows? Is the inner voice generic or specific to this character?

Respond with valid JSON: { "score": N, "reasoning": "..." }`,
  },
  {
    name: "Micro-Detail Precision",
    rubric: `You are a literary critic evaluating **Micro-Detail Precision** — the specificity and exactness of small physical details.

Assess whether the prose uses precise, concrete, unexpected details — or vague, approximate descriptions.

## Scoring Rubric

**1-3: Vague.** Details are abstract or approximate. "A weapon." "The building." "She moved quickly." The reader cannot picture specifics.

**4-5: Generic specifics.** Details exist but are predictable. "A long sword." "The stone building." The writer picks the first adequate detail rather than the most precise one.

**6-7: Often precise.** Many details are concrete and specific. Some surprise. But precision is uneven — key moments are sharp, transitions blur.

**8-9: Consistently exact.** Details are specific enough to be unexpected: not "a knife" but "three kilos of scavenged steel, balanced for close work." Not "he was sweating" but "sweat cutting channels through the dust caked on his neck." Small details reveal the author has fully imagined the physical world.

**10: Forensic.** Every physical detail is exact and earned. The specificity creates the illusion of witnessed reality. Details are so precise they feel researched or remembered, not invented.

List 5 physical details from the text. Rate each as VAGUE (could be anything), ADEQUATE (reasonable but predictable), or PRECISE (exact, unexpected, world-specific).

Respond with valid JSON: { "score": N, "reasoning": "..." }`,
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

async function judge(rubric: string, prose: string): Promise<{ score: number; reasoning: string } | null> {
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
    const result = judgeScoreSchema.safeParse(parsed)
    if (!result.success) { console.log(`    ! [zod]`); return null }

    return result.data
  } catch (err) {
    console.log(`    ! [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const RUNS = 3

async function main() {
  console.log(`\nDimension Probe`)
  console.log(`Judge: Qwen3 32B`)
  console.log(`Dimensions: ${DIMENSIONS.map(d => d.name).join(", ")}`)
  console.log(`Samples: MID, STRONG`)
  console.log(`Runs: ${RUNS}`)
  console.log(`Total calls: ${DIMENSIONS.length} dims x 2 samples x ${RUNS} runs = ${DIMENSIONS.length * 2 * RUNS}\n`)

  const results: Array<{ dim: string; sample: string; run: number; score: number; reasoning: string }> = []

  // Run dimensions sequentially, samples in parallel per dimension
  for (const dim of DIMENSIONS) {
    console.log(`\n── ${dim.name} ──`)

    for (const sample of SAMPLES) {
      for (let run = 1; run <= RUNS; run++) {
        const result = await judge(dim.rubric, sample.prose)
        if (result) {
          results.push({ dim: dim.name, sample: sample.label, run, ...result })
          console.log(`  ${sample.label} run${run}: ${result.score}/10`)
        } else {
          console.log(`  ${sample.label} run${run}: FAIL`)
        }
      }
    }
  }

  // ── Analysis ──────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(60)}`)
  console.log(`  DIMENSION PROBE RESULTS`)
  console.log(`${"=".repeat(60)}`)
  console.log(`\n  ${"Dimension".padEnd(24)} ${"MID".padEnd(16)} ${"STRONG".padEnd(16)} ${"Gap".padEnd(6)} Discriminates?`)
  console.log(`  ${"-".repeat(74)}`)

  const dimStats: Array<{ name: string; midAvg: number; strongAvg: number; gap: number; consistent: boolean }> = []

  for (const dim of DIMENSIONS) {
    const midScores = results.filter(r => r.dim === dim.name && r.sample === "MID").map(r => r.score)
    const strongScores = results.filter(r => r.dim === dim.name && r.sample === "STRONG").map(r => r.score)

    const midAvg = midScores.length ? midScores.reduce((a, b) => a + b, 0) / midScores.length : 0
    const strongAvg = strongScores.length ? strongScores.reduce((a, b) => a + b, 0) / strongScores.length : 0
    const gap = strongAvg - midAvg

    // Consistent = STRONG > MID in every run pair
    const consistent = midScores.length > 0 && strongScores.length > 0 &&
      Math.min(...strongScores) > Math.max(...midScores)

    dimStats.push({ name: dim.name, midAvg, strongAvg, gap, consistent })

    const disc = gap > 0 ? (consistent ? "YES (clean)" : "yes (overlap)") : "NO"
    console.log(`  ${dim.name.padEnd(24)} ${`${midAvg.toFixed(1)} [${midScores.join(",")}]`.padEnd(16)} ${`${strongAvg.toFixed(1)} [${strongScores.join(",")}]`.padEnd(16)} ${gap > 0 ? "+" : ""}${gap.toFixed(1).padEnd(5)} ${disc}`)
  }

  // Rank by gap
  console.log(`\n  Ranked by discrimination gap:`)
  dimStats.sort((a, b) => b.gap - a.gap)
  for (const d of dimStats) {
    const icon = d.consistent ? "***" : d.gap > 0 ? " * " : "   "
    console.log(`  ${icon} ${d.name.padEnd(24)} gap: ${d.gap > 0 ? "+" : ""}${d.gap.toFixed(1)}`)
  }

  console.log()
}

main()
