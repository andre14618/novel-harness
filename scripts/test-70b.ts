import { z } from "zod"
import { worldBibleSchema, characterProfilesSchema, chapterDraftSchema } from "../src/types"
import { WORLD_BUILDER_PROMPT, CHARACTER_AGENT_PROMPT, WRITER_AGENT_PROMPT } from "../src/prompts"
import { extractJSON } from "../src/llm"

const API_URL = "https://openrouter.ai/api/v1/chat/completions"
const API_KEY = process.env.OPENROUTER_API_KEY
if (!API_KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1) }

const PROSE_PROMPT = `CHAPTER 1: "The Weight of Sand"
POV Character: Kael
Setting: The Frontier Outpost
Purpose: Establish Kael's exile, introduce the world, hint at the central mystery
Target: ~1500 words

SCENE BEATS (follow in order):
1. Kael patrols the crumbling walls of the frontier outpost at dawn, observing the corrosive desert and reflecting on her fall from grace.
   Characters: Kael
   Emotional shift: resignation -> unease

2. A young soldier reports an incoming rider -- unexpected, since supply runs are not due for weeks. Kael recognizes the seal on the messenger satchel as belonging to the Imperial Archive.
   Characters: Kael, Soldier, Messenger
   Emotional shift: suspicion -> dread

3. Kael reads the message alone: Davan, a name she does not recognize, claims to have found documents that prove the empire founding myth is fabricated. He is coming to the frontier. He is being hunted.
   Characters: Kael
   Emotional shift: disbelief -> old loyalty stirring

CHARACTER PROFILES:
Kael (protagonist):
  Speech pattern: Clipped military cadence, dry humor masking pain, avoids emotional language, speaks in declaratives
  Traits: strategic thinker, bitter, loyal despite herself, haunted by the siege of Vashar
  Goals: survive exile, find meaning after disgrace
  Fears: that her sacrifice at Vashar was for nothing, that the empire she bled for deserves to fall

WORLD RULES:
- The empire controls water distribution through the Aqueduct Authority as political leverage
- Military rank is permanently branded on the forearm -- Kael brand marks her as a former Commander
- The desert storms carry corrosive sand that eats stone over decades -- architecture must be constantly maintained
- The frontier outpost sits at the empire edge, a posting reserved for the disgraced and forgotten

SETTING DETAILS:
The Frontier Outpost: A crumbling stone fort on the empire eastern edge. Walls pitted by decades of corrosive sand. Skeleton garrison of 30 soldiers, most of them disciplinary cases. Water rations are deliberately kept low -- a reminder of the capital control.`

const SEED = `Genre: epic fantasy

Premise: In a crumbling desert city, a disgraced general discovers the empire she served is built on a lie.

Characters:
- Kael (protagonist): Disgraced general, sharp mind, bitter tongue
- Rina (antagonist): Empire spymaster, former comrade
- Davan (supporting): Young archivist, idealistic, terrified`

const tests = [
  { name: "world-bible", schema: worldBibleSchema, system: WORLD_BUILDER_PROMPT, user: SEED + "\n\nCreate a detailed world bible for this story.", temp: 0.7, max: 4096 },
  { name: "characters", schema: characterProfilesSchema, system: CHARACTER_AGENT_PROMPT, user: SEED + "\n\nDevelop these character sketches into full profiles.", temp: 0.7, max: 4096 },
  { name: "prose", schema: chapterDraftSchema, system: WRITER_AGENT_PROMPT, user: PROSE_PROMPT, temp: 0.8, max: 8192 },
]

const MODEL = "meta-llama/llama-3.3-70b-instruct"

console.log("Testing Llama 3.3 70B via Groq...\n")

for (const t of tests) {
  process.stdout.write(`  ${t.name}... `)
  const start = performance.now()
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: t.system }, { role: "user", content: t.user }],
        temperature: t.temp,
        max_tokens: t.max,
        response_format: { type: "json_object" },
        provider: { order: ["Groq"], allow_fallbacks: false },
      }),
    })
    const elapsed = performance.now() - start
    if (!res.ok) {
      const text = await res.text()
      console.log(`FAIL HTTP ${res.status}: ${text.slice(0, 150)}`)
      continue
    }
    const data = await res.json() as any
    if (data.error) { console.log(`FAIL API: ${JSON.stringify(data.error).slice(0, 150)}`); continue }

    const content = data.choices[0].message.content
    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const tps = Math.round(usage.completion_tokens / (elapsed / 1000))

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const zodResult = t.schema.safeParse(parsed)

    console.log(`${zodResult.success ? "PASS" : "FAIL"}  ${(elapsed / 1000).toFixed(1)}s  ${tps} tok/s  json=true  zod=${zodResult.success}`)
    if (!zodResult.success) {
      console.log(`    Zod errors: ${zodResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
    }

    if (t.name === "prose" && parsed.prose) {
      const words = parsed.prose.split(/\s+/).length
      const dialogueLines = parsed.prose.split("\n").filter((l: string) => /"/.test(l)).length
      const sensory = (parsed.prose.match(/\b(smell|taste|sound|feel|touch|hear|see|saw|felt|warm|cold|rough|smooth|bitter|bright|dim|shadow|echo|whisper|roar|sting|ache)\b/gi) ?? []).length
      console.log(`    ${words} words | ${dialogueLines} dialogue lines | ${sensory} sensory words`)
      await Bun.write("output/model-comparison/llama-3-3-70b-prose.md",
        `# Llama 3.3 70B — Prose Sample\n# ${tps} tok/s | ${(elapsed / 1000).toFixed(1)}s | ${words} words\n\n${parsed.prose}`)
      console.log(`    Saved: output/model-comparison/llama-3-3-70b-prose.md`)
    }
  } catch (err) {
    console.log(`FAIL: ${err instanceof Error ? err.message : err}`)
  }
}
