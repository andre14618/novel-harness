import { z } from "zod"
import { chapterDraftSchema } from "../src/types"
import { WRITER_AGENT_PROMPT } from "../src/prompts"
import { extractJSON } from "../src/llm"

const PROSE_PROMPT = `/nothink
CHAPTER 1: "The Weight of Sand"
POV Character: Kael
Setting: The Frontier Outpost
Purpose: Establish Kael's exile, introduce the world, hint at the central mystery
Target: ~1000 words

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
- The desert storms carry corrosive sand that eats stone over decades
- The frontier outpost sits at the empire edge, a posting reserved for the disgraced and forgotten

SETTING DETAILS:
The Frontier Outpost: A crumbling stone fort on the empire eastern edge. Walls pitted by decades of corrosive sand. Skeleton garrison of 30 soldiers, most of them disciplinary cases. Water rations are deliberately kept low -- a reminder of the capital control.`

const providers = [
  {
    label: "Groq Direct (Qwen3 32B)",
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiKey: process.env.GROQ_API_KEY!,
    model: "qwen/qwen3-32b",
  },
  {
    label: "Cerebras (Qwen3 235B-A22B)",
    apiUrl: "https://api.cerebras.ai/v1/chat/completions",
    apiKey: process.env.CEREBRAS_API_KEY!,
    model: "qwen-3-235b-a22b-instruct-2507",
  },
]

for (const p of providers) {
  if (!p.apiKey) { console.log(`  ${p.label}: SKIPPED (no API key)`); continue }

  process.stdout.write(`  ${p.label}... `)
  const start = performance.now()

  try {
    const res = await fetch(p.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${p.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: "system", content: WRITER_AGENT_PROMPT },
          { role: "user", content: PROSE_PROMPT },
        ],
        temperature: 0.8,
        max_tokens: 16384,
        response_format: { type: "json_object" },
      }),
    })

    const elapsed = performance.now() - start

    if (!res.ok) {
      const text = await res.text()
      console.log(`FAIL ${(elapsed / 1000).toFixed(1)}s  HTTP ${res.status}: ${text.slice(0, 120)}`)
      continue
    }

    const data = await res.json() as any
    if (data.error) { console.log(`FAIL  API error: ${JSON.stringify(data.error).slice(0, 100)}`); continue }

    const content = data.choices[0].message.content
    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const tps = Math.round(usage.completion_tokens / (elapsed / 1000))

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const zodResult = chapterDraftSchema.safeParse(parsed)

    const words = parsed.prose ? parsed.prose.split(/\s+/).length : 0
    const dialogueLines = parsed.prose ? parsed.prose.split("\n").filter((l: string) => /"/.test(l)).length : 0

    console.log(`${zodResult.success ? "PASS" : "FAIL"}  ${(elapsed / 1000).toFixed(1)}s  ${tps} tok/s  ${usage.completion_tokens} tokens  ${words} words  ${dialogueLines} dialogue lines`)

    if (parsed.prose) {
      const slug = p.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      await Bun.write(`output/model-comparison/${slug}-prose.md`,
        `# ${p.label}\n# ${tps} tok/s | ${(elapsed / 1000).toFixed(1)}s | ${words} words\n\n${parsed.prose}`)
      console.log(`    Saved: output/model-comparison/${slug}-prose.md`)
    }
  } catch (err) {
    console.log(`FAIL: ${err instanceof Error ? err.message : err}`)
  }
}
