/**
 * Quick streaming TPS probe — OpenPipe/Qwen3-14B-Instruct on W&B Inference.
 *
 * 3 sequential calls per shape using the real agent prompt format.
 * Streaming separates TTFT from decode TPS so we get an accurate picture.
 * No DB write — diagnostic only.
 *
 * Usage:
 *   bun scripts/tps-probe-qwen14b.ts
 */

const KEY = process.env.WANDB_API_KEY
if (!KEY) throw new Error("WANDB_API_KEY not set")

const MODEL = "OpenPipe/Qwen3-14B-Instruct"
const URL   = "https://api.inference.wandb.ai/v1/chat/completions"
const RUNS  = 3

interface Shape {
  name: string
  system: string
  user: string
  maxTokens: number
}

// Real agent prompt format pulled from src/agents/writer/adherence-checker.ts
// and src/agents/writer/reference-resolver.ts
const SHAPES: Shape[] = [
  {
    name: "adherence-checker",
    maxTokens: 256,
    system: "You check if prose follows a scene beat specification. Be strict but fair.",
    user: `Beat: "Elena confronts Marcus about the betrayal in the manor library. The conversation escalates from cold civility to open accusation. Marcus tries to deflect by mentioning their shared history; Elena cuts him off and demands the truth about the missing letters."
Setting: "Ashveil Manor library"
Characters expected: Elena, Marcus

Prose:
---
The library was silent except for the rasp of Elena's breath. She stood at the edge of the carpet, her arms crossed tight enough to bruise.

"You knew," she said. The words came out flat, without inflection.

Marcus turned from the window. The lamplight caught the silver at his temples. "Elena—"

"You knew about the letters. You read them. You burned them."

"It's complicated."

"Don't." Her voice cracked. "Don't tell me about the years we worked together, or the favors you've called in. I want to know what you did with the letters."
---

Did the prose execute the beat? Return JSON: { "pass": true/false, "deviations": ["specific issue 1", ...] }`,
  },
  {
    name: "reference-resolver",
    maxTokens: 256,
    system: "You identify what background information a scene beat needs. Return JSON with specific lookups.",
    user: `Beat: "Elena confronts Marcus about the betrayal in the manor library."
Characters: Elena Verre, Marcus Halliday
Setting: Ashveil Manor
Chapter: 5

What specific background does the writer need? Return JSON:
{ "lookups": [{ "type": "recent_events"|"relationship"|"location_events"|"knowledge", "characters": ["name"], "topic": "subject" }] }`,
  },
  {
    name: "chapter-plan-checker",
    maxTokens: 512,
    system: "You compare a completed chapter against its structural plan. Report deviations or PASS.",
    user: `Chapter plan:
- Beat 1: Elena arrives at the manor, observes the sealed library door. [Elena present]
- Beat 2: Elena confronts Marcus about the missing letters; conversation escalates. [Elena, Marcus present]
- Beat 3: Marcus admits to burning the letters. Elena leaves. Tone: cold resolution. [Elena, Marcus present]
- Required facts established: letters existed, Marcus burned them, Elena's brother wrote them
- Character state changes: Elena shifts from suspicious to certain; Marcus shifts from deflecting to resigned

Chapter prose (excerpt):
---
The manor smelled of old wax and something sharper beneath — turpentine, or regret. Elena crossed the entrance hall without stopping, her boots loud on the parquet.

The library door was sealed with a strip of dark paper she didn't recognize. She peeled it back. Inside, the room was unchanged — high shelves, the fireplace still holding the remnants of last night's fire.

She heard Marcus on the stairs before she saw him.

"I expected you earlier," he said.

"I had to be sure." She didn't turn. "The letters. My brother's letters."

A long pause. The fire settled in the grate.

"Elena—"

"You burned them."

Marcus came to stand beside her. He looked smaller than she remembered. "Yes."

She nodded once, said nothing more, and walked out.
---

Did the chapter execute the plan? Return JSON: { "pass": true/false, "deviations": ["specific issue"] }`,
  },
]

interface StreamResult {
  ok: boolean
  ttftMs: number
  totalMs: number
  outputTokens: number
  decodeTps: number
  content: string
  error?: string
}

async function streamCall(shape: Shape): Promise<StreamResult> {
  const t0 = performance.now()
  let ttftMs = 0
  let outputTokens = 0
  let content = ""

  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: shape.system },
          { role: "user",   content: shape.user   },
        ],
        temperature: 0.3,
        max_tokens: shape.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return { ok: false, ttftMs: 0, totalMs: performance.now() - t0, outputTokens: 0, decodeTps: 0, content: "", error: `${res.status} ${text.slice(0, 300)}` }
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let usageTokens = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (data === "[DONE]") continue
        try {
          const chunk = JSON.parse(data)
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) {
            if (ttftMs === 0) ttftMs = performance.now() - t0
            content += delta
            outputTokens++
          }
          // Capture usage from final chunk if provided
          if (chunk.usage?.completion_tokens) {
            usageTokens = chunk.usage.completion_tokens
          }
        } catch {}
      }
    }

    const totalMs = performance.now() - t0
    // Use reported completion tokens if available, else chunk-count approximation
    const finalTokens = usageTokens > 0 ? usageTokens : outputTokens
    const decodeMs = totalMs - ttftMs
    const decodeTps = decodeMs > 0 ? finalTokens / (decodeMs / 1000) : 0

    return { ok: true, ttftMs, totalMs, outputTokens: finalTokens, decodeTps, content }
  } catch (e: any) {
    return { ok: false, ttftMs, totalMs: performance.now() - t0, outputTokens: 0, decodeTps: 0, content: "", error: e.message }
  }
}

async function main() {
  console.log(`Streaming TPS probe — ${MODEL}`)
  console.log(`${RUNS} sequential calls per shape\n`)

  for (const shape of SHAPES) {
    console.log(`── ${shape.name} ──`)
    const results: StreamResult[] = []

    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(`  run ${i + 1}: `)
      const r = await streamCall(shape)
      if (!r.ok) {
        console.log(`ERROR: ${r.error}`)
        continue
      }
      results.push(r)
      console.log(
        `ttft=${Math.round(r.ttftMs)}ms  total=${Math.round(r.totalMs)}ms  tokens=${r.outputTokens}  decode=${Math.round(r.decodeTps)} tps`
      )
    }

    if (results.length > 0) {
      const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length
      const ttfts   = results.map(r => r.ttftMs)
      const totals  = results.map(r => r.totalMs)
      const tpss    = results.map(r => r.decodeTps)
      const tokens  = results.map(r => r.outputTokens)
      console.log(
        `  avg   ttft=${Math.round(avg(ttfts))}ms  total=${Math.round(avg(totals))}ms  tokens=${Math.round(avg(tokens))}  decode=${Math.round(avg(tpss))} tps`
      )
      // Print first response for sanity check
      console.log(`  sample output: ${results[0].content.slice(0, 120).replace(/\n/g, " ")}…`)
    }
    console.log()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
