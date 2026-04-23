/**
 * Improvement method for halluc-leak-salvatore: systematic vocabulary
 * expansion. For every §A leak token in labeling-rubric, generate 5 prose
 * examples where the token appears naturally. DeepSeek does generation
 * (per writer-quality rule 2026-04-18).
 *
 * Training pairs use the leak-adapter schema: prose-only input,
 * {has_leak: true, leaks: [token]} output.
 *
 * Usage:
 *   bun scripts/hallucination/expand-leak-vocab.ts
 */

import { appendFileSync, writeFileSync, existsSync } from "fs"
import { createTuningExperiment, concludeExperiment } from "../../src/db/ops"
import { getTransport } from "../../src/transport"

const OUT = "finetune-data/halluc-leak-vocab-expansion.jsonl"
const EXAMPLES_PER_TOKEN = 5
const CONCURRENCY = 10

// Full §A vocabulary from labeling-rubric.md — every token gets training coverage
const LEAK_TOKENS = [
  // Characters
  { token: "Drizzt", category: "character" },
  { token: "Bruenor", category: "character" },
  { token: "Wulfgar", category: "character" },
  { token: "Regis", category: "character" },
  { token: "Catti-brie", category: "character" },
  { token: "Rumblebelly", category: "character" },
  { token: "Akar Kessell", category: "character" },
  { token: "Entreri", category: "character" },
  { token: "Jarlaxle", category: "character" },
  { token: "Zaknafein", category: "character" },
  { token: "Guenhwyvar", category: "character" },
  { token: "Dendybar", category: "character" },
  { token: "Pasha Pook", category: "character" },
  { token: "Deudermont", category: "character" },
  { token: "Cassius", category: "character" },
  { token: "Heafstaag", category: "character" },
  { token: "Biggrin", category: "character" },
  { token: "Alustriel", category: "character" },
  // Places
  { token: "Mithril Hall", category: "place" },
  { token: "Mithral Hall", category: "place" },
  { token: "Icewind Dale", category: "place" },
  { token: "Ten-Towns", category: "place" },
  { token: "Bryn Shander", category: "place" },
  { token: "Termalaine", category: "place" },
  { token: "Easthaven", category: "place" },
  { token: "Luskan", category: "place" },
  { token: "Silverymoon", category: "place" },
  { token: "Calimport", category: "place" },
  { token: "Maer Dualdon", category: "place" },
  { token: "Kelvin's Cairn", category: "place" },
  { token: "Cryshal-Tirith", category: "place" },
  { token: "Faerûn", category: "place" },
  { token: "Sword Coast", category: "place" },
  { token: "Forgotten Realms", category: "place" },
  { token: "Lonelywood", category: "place" },
  { token: "Targos", category: "place" },
  { token: "Spine of the World", category: "place" },
  // Items
  { token: "Crystal Shard", category: "item" },
  { token: "Crenshinibon", category: "item" },
  { token: "Aegis-fang", category: "item" },
  { token: "Twinkle", category: "item" },
  { token: "Icingdeath", category: "item" },
  { token: "Taulmaril", category: "item" },
  // Races (lowercase per rubric)
  { token: "drow", category: "race" },
  { token: "verbeeg", category: "race" },
  { token: "duergar", category: "race" },
  { token: "svirfneblin", category: "race" },
  // Naming patterns
  { token: "Do'Urden", category: "naming" },
  { token: "Battlehammer", category: "naming" },
]

const LEAK_SYSTEM = `You are a corpus-leak detector for generated fiction beats.

Given prose, identify any token that belongs to R.A. Salvatore's Icewind Dale / Forgotten Realms vocabulary — character names, places, items, races, or distinctive naming patterns that should never appear in a non-Salvatore novel.

Examples of leak tokens (case-insensitive):
Characters: Drizzt, Bruenor, Wulfgar, Regis, Catti-brie, Entreri, Jarlaxle, Zaknafein, Guenhwyvar, Akar Kessell, Dendybar, Pasha Pook, Deudermont, Rumblebelly.
Places: Mithril Hall, Mithral Hall, Icewind Dale, Ten-Towns, Bryn Shander, Termalaine, Easthaven, Luskan, Silverymoon, Calimport, Maer Dualdon, Kelvin's Cairn, Cryshal-Tirith, Faerûn, Sword Coast, Forgotten Realms.
Items: Crystal Shard, Crenshinibon, Aegis-fang, Twinkle, Icingdeath, Taulmaril.
Races: drow, verbeeg, duergar, svirfneblin.
Naming patterns: Do'Urden suffix, Battlehammer surname.

Output ONLY valid JSON:
{"has_leak": bool, "leaks": ["token1", "token2", ...]}

Empty leaks array if has_leak is false. Grounded-context checks are NOT in scope for this checker — a separate adapter handles ungrounded-named-entity detection.`

const GEN_SYSTEM = `You are generating prose samples for training a corpus-leak detector. The prose will be labeled as containing the leak token.

Produce ~80-120 words of fantasy prose that naturally includes the requested token. Use varied prose contexts: narration, dialogue, internal thought, description. The token should appear at least once; use it as a real proper noun the way a writer who leaked the reference would.

Output strict JSON: {"prose": "<prose text>"}.`

const VARIETY_CUES = [
  "in a tense battle scene",
  "during quiet dialogue between two characters",
  "as a character's internal memory",
  "in a tavern conversation",
  "during travel through wilderness",
  "at a formal council meeting",
  "in the aftermath of violence",
  "during a moonlit encounter",
  "in a marketplace",
  "during a ceremonial ritual",
]

async function generateProse(token: string, context: string): Promise<string> {
  const transport = getTransport()
  const userPrompt = `Token to include: "${token}"
Context: ${context}

Write a ~80-120 word prose snippet. Include "${token}" at least once, naturally embedded. Make the surrounding prose generic fantasy — don't repeat the token-specific lore; just use the token.

Return {"prose": "..."}.`
  const result = await transport.execute({
    systemPrompt: GEN_SYSTEM,
    userPrompt,
    provider: "deepseek",
    model: "deepseek-chat",
    temperature: 0.85,
    maxTokens: 400,
  })
  let prose = result.content.trim()
  if (prose.startsWith("{")) {
    try {
      const parsed = JSON.parse(prose)
      const extracted = parsed.prose ?? parsed.text
      if (typeof extracted === "string" && extracted.length > 40) prose = extracted.trim()
    } catch { /* fall through */ }
  }
  if (prose.startsWith("```")) prose = prose.replace(/^```[a-z]*\n/, "").replace(/\n```$/, "")
  return prose
}

function buildPair(token: string, prose: string): object {
  return {
    messages: [
      { role: "system", content: LEAK_SYSTEM },
      { role: "user", content: `PROSE:\n${prose}` },
      { role: "assistant", content: JSON.stringify({ has_leak: true, leaks: [token] }) },
    ],
    _meta: {
      source: "leak-vocab-expansion",
      token,
      category: LEAK_TOKENS.find(t => t.token === token)?.category,
      has_leak: true,
    },
  }
}

async function main() {
  if (existsSync(OUT)) {
    console.error(`${OUT} exists — move or delete first.`)
    process.exit(1)
  }
  writeFileSync(OUT, "")

  const tasks: Array<{ token: string; contextIdx: number }> = []
  for (const { token } of LEAK_TOKENS) {
    for (let j = 0; j < EXAMPLES_PER_TOKEN; j++) {
      tasks.push({ token, contextIdx: j })
    }
  }
  console.log(`Target: ${LEAK_TOKENS.length} tokens × ${EXAMPLES_PER_TOKEN} examples = ${tasks.length} pairs`)

  const expId = await createTuningExperiment(
    "data-generation",
    `halluc-leak-salvatore vocabulary expansion — ${LEAK_TOKENS.length} tokens × ${EXAMPLES_PER_TOKEN} examples via DeepSeek`,
    {
      tokens: LEAK_TOKENS.length,
      examples_per_token: EXAMPLES_PER_TOKEN,
      target_pairs: tasks.length,
      writer: "deepseek-chat",
    },
    { target: "halluc-leak-salvatore-v2", dimension: "vocab-coverage" },
  )
  console.log(`Experiment ${expId}`)

  let ok = 0, injFail = 0, genFail = 0
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async ({ token, contextIdx }) => {
      try {
        const context = VARIETY_CUES[contextIdx % VARIETY_CUES.length]!
        const prose = await generateProse(token, context)
        // Injection check: token must be present (case-insensitive)
        if (!prose.toLowerCase().includes(token.toLowerCase())) {
          return { token, injFail: true }
        }
        return { token, prose }
      } catch (e: any) {
        return { token, genFail: true, err: e.message ?? String(e) }
      }
    }))
    for (const r of results) {
      if (r.genFail) { genFail++; continue }
      if (r.injFail) { injFail++; continue }
      appendFileSync(OUT, JSON.stringify(buildPair(r.token, r.prose!)) + "\n")
      ok++
    }
    process.stdout.write(`  [${Math.min(i + CONCURRENCY, tasks.length)}/${tasks.length}] ok=${ok} inj_fail=${injFail} gen_fail=${genFail}\n`)
  }

  const summary = `Generated ${ok}/${tasks.length} pairs. Injection failures: ${injFail}. Gen failures: ${genFail}. Output: ${OUT}`
  console.log(`\n${summary}`)
  await concludeExperiment(expId, summary)
  process.exit(0)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
