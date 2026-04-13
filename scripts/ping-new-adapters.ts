/**
 * Ping the 3 new SFT adapters to verify they're trained and responding.
 *
 * Adapters:
 *   - adherence-checker-v3-sonnet-sft-resume:v9 (exp #159)
 *   - chapter-plan-checker-v1-sft-resume:v9    (exp #154)
 *   - continuity-v1-sft-resume:v9               (exp #155)
 *
 * Minimal smoke call — sends a trivial system+user prompt, reports
 * latency, token usage, and first 200 chars of the response. Does NOT
 * assert correctness.
 *
 * Usage:
 *   WANDB_API_KEY=... bun scripts/ping-new-adapters.ts
 */
import { getTransport } from "../src/transport.ts"

const ADAPTERS = [
  {
    name: "adherence-checker-v3-sonnet",
    model: "wandb-artifact:///andre14618-/novel-harness/adherence-checker-v3-sonnet-sft-resume:v9",
    system: "You verify whether prose enacts a scene beat. Return JSON: { events_present: boolean, evidence: string, reasoning: string }",
    user: `Beat: "Elena opens the letter in the library."

Prose: "Elena broke the wax seal and unfolded the parchment, her hands trembling in the dim candlelight of the library."`,
  },
  {
    name: "chapter-plan-checker-v1",
    model: "wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v1:v1",
    system: "You compare a chapter's prose against its structured plan. Return JSON: { pass: boolean, deviations: string[] }",
    user: `Plan: Chapter 1 — Elena discovers the letter. Beats: (1) Elena enters library, (2) finds hidden letter, (3) reads it, (4) decides to confront Marcus.

Prose summary: Elena walks into the library, searches the shelves, finds a hidden envelope, opens it, reads the betrayal, and resolves to confront Marcus at dinner.`,
  },
  {
    name: "continuity-v1",
    model: "wandb-artifact:///andre14618-/novel-harness/continuity-v1:v1",
    system: "You check chapter prose for continuity violations against established facts. Return JSON: { pass: boolean, violations: string[] }",
    user: `Established facts: Marcus is left-handed. Elena lives in Ashveil Manor. The letter was delivered on Tuesday.

Prose: "Marcus signed the parchment with his left hand, then passed it across the desk to Elena."`,
  },
]

async function main() {
  const transport = getTransport()
  console.log(`Pinging ${ADAPTERS.length} new SFT adapters on W&B Inference\n`)

  const results: Array<{ name: string; ok: boolean; latencyMs?: number; usage?: any; preview?: string; error?: string }> = []

  for (const a of ADAPTERS) {
    process.stdout.write(`[${a.name}] ... `)
    const t0 = Date.now()
    try {
      const res = await transport.execute({
        systemPrompt: a.system,
        userPrompt: a.user,
        model: a.model,
        provider: "wandb",
        temperature: 0.1,
        maxTokens: 256,
      })
      const latency = Date.now() - t0
      const preview = res.content.replace(/\s+/g, " ").slice(0, 200)
      results.push({ name: a.name, ok: true, latencyMs: latency, usage: res.usage, preview })
      console.log(`OK ${latency}ms (${res.usage.prompt_tokens} in / ${res.usage.completion_tokens} out)`)
      console.log(`   preview: ${preview}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ name: a.name, ok: false, error: msg })
      console.log(`ERROR`)
      console.log(`   ${msg.slice(0, 400)}`)
    }
  }

  console.log(`\n═══════════════════════════════`)
  const okCount = results.filter(r => r.ok).length
  console.log(`Result: ${okCount}/${ADAPTERS.length} adapters responding`)
  process.exit(okCount === ADAPTERS.length ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
