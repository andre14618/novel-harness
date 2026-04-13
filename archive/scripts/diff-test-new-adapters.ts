/**
 * Differential test: base Qwen3-14B vs the two ":v1 step1" adapters.
 *
 * Hypothesis: chapter-plan-checker-v1:v1 and continuity-v1:v1 ARE the trained
 * weights (training completed in ~5 min for the small datasets), they just
 * don't have the "-sft-resume" checkpoint collection because training was
 * too short to trigger periodic saves. If so, base and adapter should produce
 * materially different outputs on the same prompt.
 *
 * Pulls 5 held-out pairs from each dataset and compares base vs adapter
 * predictions. Prints pair-by-pair and computes (correct, agree-with-base,
 * differ-from-base) counts.
 */
import { readFileSync } from "fs"
import { getTransport } from "../src/transport.ts"

const BASE = { provider: "wandb" as const, model: "OpenPipe/Qwen3-14B-Instruct" }

const CASES = [
  {
    label: "chapter-plan-checker-v1",
    adapter: { provider: "wandb" as const, model: "wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v1:v1" },
    dataPath: "lora-data/chapter-plan-checker-pairs-v2-final.jsonl",
    maxTokens: 512,
  },
  {
    label: "continuity-v1",
    adapter: { provider: "wandb" as const, model: "wandb-artifact:///andre14618-/novel-harness/continuity-v1:v1" },
    dataPath: "lora-data/continuity-pairs-sonnet-labeled.jsonl",
    maxTokens: 512,
  },
]

async function run() {
  const transport = getTransport()

  for (const c of CASES) {
    console.log(`\n════════════════════════════════════════════`)
    console.log(`${c.label}`)
    console.log(`════════════════════════════════════════════`)
    const lines = readFileSync(c.dataPath, "utf8").trim().split("\n")
    const samples = lines.slice(-5).map(l => JSON.parse(l))   // take last 5 as a pseudo-held-out slice

    let baseCorrect = 0, adapterCorrect = 0, agree = 0, sampled = 0
    for (let i = 0; i < samples.length; i++) {
      const pair = samples[i]
      const system = pair.messages[0].content
      const user = pair.messages[1].content
      const expected = pair.messages[2].content

      // Extract expected pass/fail if it's JSON with a .pass
      let expectedPass: boolean | undefined
      try {
        const parsed = JSON.parse(expected)
        if (typeof parsed.pass === "boolean") expectedPass = parsed.pass
      } catch {}

      const req = {
        systemPrompt: system,
        userPrompt: user,
        temperature: 0.1,
        maxTokens: c.maxTokens,
      }

      const [baseRes, adapterRes] = await Promise.all([
        transport.execute({ ...req, ...BASE }),
        transport.execute({ ...req, ...c.adapter }),
      ])

      const baseOut = baseRes.content.trim()
      const adapterOut = adapterRes.content.trim()

      sampled++
      const sameText = baseOut === adapterOut
      if (sameText) agree++

      let basePass: boolean | undefined, adapterPass: boolean | undefined
      try { basePass = JSON.parse(baseOut).pass } catch {}
      try { adapterPass = JSON.parse(adapterOut).pass } catch {}
      if (expectedPass !== undefined) {
        if (basePass === expectedPass) baseCorrect++
        if (adapterPass === expectedPass) adapterCorrect++
      }

      console.log(`\n[${i + 1}/${samples.length}]  expected=${expectedPass}  identical=${sameText}`)
      console.log(`  base    (${baseRes.usage.completion_tokens} tok): ${baseOut.slice(0, 220)}`)
      console.log(`  adapter (${adapterRes.usage.completion_tokens} tok): ${adapterOut.slice(0, 220)}`)
    }

    console.log(`\n--- summary ---`)
    console.log(`  samples               : ${sampled}`)
    console.log(`  base correct          : ${baseCorrect}/${sampled}`)
    console.log(`  adapter correct       : ${adapterCorrect}/${sampled}`)
    console.log(`  identical outputs     : ${agree}/${sampled}`)
    console.log(`  verdict               : ${agree === sampled ? "ADAPTER == BASE (untrained)" : "adapter differs from base (trained or noisy)"}`)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
