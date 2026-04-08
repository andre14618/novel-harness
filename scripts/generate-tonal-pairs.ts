#!/usr/bin/env bun
/**
 * Generate back-translated training pairs for tonal-pass LoRA.
 *
 * Takes Howard prose chunks, flattens each into bland/neutral prose via
 * Qwen 32B on Groq, then formats as (bland → Howard) instruction pairs.
 *
 * The flattening prompt varies across 4 templates to avoid diversity collapse.
 * Content preservation is verified by word count ratio (reject if >50% drift).
 *
 * Output: JSONL with {"messages": [system, user, assistant]} format
 * ready for Together AI LoRA SFT fine-tuning.
 *
 * Usage:
 *   bun scripts/generate-tonal-pairs.ts                    # first 200 chunks
 *   MAX_CHUNKS=50 bun scripts/generate-tonal-pairs.ts      # test run
 *   MAX_CHUNKS=926 bun scripts/generate-tonal-pairs.ts     # full corpus
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

const INPUT_FILE = join(import.meta.dir, "../lora-data/howard-training.jsonl")
const OUTPUT_FILE = join(import.meta.dir, "../lora-data/howard-tonal-pairs.jsonl")
const CACHE_DIR = join(import.meta.dir, "../lora-data/flatten-cache")

const MAX_CHUNKS = parseInt(process.env.MAX_CHUNKS ?? "926")
const GROQ_API_KEY = process.env.GROQ_API_KEY
if (!GROQ_API_KEY) {
  console.error("GROQ_API_KEY required")
  process.exit(1)
}

// ── Flattening prompts (rotated to avoid diversity collapse) ────────────────

const FLATTEN_PROMPTS = [
  `Rewrite the following passage in plain, neutral prose. Rules:
- Preserve every plot event, character action, and factual detail exactly
- Preserve all dialogue lines word-for-word — only flatten the narration between them
- Keep the SAME number of paragraphs
- Each paragraph must be approximately the same length as the original
- Do NOT summarize, compress, or combine paragraphs
- Remove only the distinctive voice, rhythm, and stylistic word choices
- Output only the rewritten text, nothing else`,

  `Rewrite this passage in a generic narrative style. Rules:
- Keep all events, characters, names, and details identical
- Keep all dialogue EXACTLY as written — do not change quoted speech
- Maintain the same paragraph structure and paragraph count
- Match the word count of each paragraph closely
- Strip away the author's distinctive sentence rhythm and tonal flourishes
- Do NOT summarize or condense — rewrite paragraph by paragraph
- Output only the rewritten passage`,

  `Convert this passage to neutral, workmanlike prose. Rules:
- Every event, character action, and plot point must be preserved
- All dialogue must remain unchanged — only rewrite narration
- Keep the same number of paragraphs with similar lengths
- Do NOT merge or remove paragraphs
- Remove unusual vocabulary, distinctive sentence structures, and stylistic flair
- Output only the result`,

  `Flatten this passage into standard, unremarkable prose. Rules:
- Preserve all content — who does what, where, when, and why
- Keep dialogue lines exactly as they appear — only flatten narration
- Maintain paragraph structure — same number of paragraphs, similar word counts
- Do NOT summarize or compress multiple paragraphs into one
- Remove the author's voice: their sentence patterns, visceral verbs, atmospheric compression
- Output only the flattened text`,
]

// ── System prompt for the fine-tuned model (generic — style is in the weights) ──

const TONAL_SYSTEM_PROMPT = `Rewrite this paragraph. Make the prose vivid, concrete, and direct.`

// ── API call ────────────────────────────────────────────────────────────────

async function flatten(prose: string, promptIdx: number): Promise<string> {
  const systemPrompt = FLATTEN_PROMPTS[promptIdx % FLATTEN_PROMPTS.length]

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen/qwen3-32b",
      temperature: 0.4,
      max_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `/nothink\n${prose}` },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Groq API error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json() as any
  let content = data.choices[0].message.content

  // Strip thinking tags if present (Qwen3 may include them)
  content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim()

  return content
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true })

  const lines = readFileSync(INPUT_FILE, "utf-8").trim().split("\n")
  const chunks = lines.map(l => JSON.parse(l).text as string)
  const total = Math.min(chunks.length, MAX_CHUNKS)

  console.log(`=== Tonal Pair Generation (Back-Translation) ===`)
  console.log(`Input: ${chunks.length} Howard chunks, processing ${total}`)
  console.log(`Model: Qwen3 32B on Groq ($0.29/$0.59 per 1M)`)
  console.log(`Output: ${OUTPUT_FILE}\n`)

  const pairs: string[] = []
  let errors = 0
  let contentDriftSkips = 0
  let totalInputCost = 0
  let totalOutputCost = 0

  for (let i = 0; i < total; i++) {
    const howard = chunks[i]
    const cacheFile = join(CACHE_DIR, `flat-${i}.txt`)

    let bland: string
    if (existsSync(cacheFile)) {
      bland = readFileSync(cacheFile, "utf-8")
    } else {
      try {
        bland = await flatten(howard, i)
        writeFileSync(cacheFile, bland)
      } catch (err) {
        errors++
        console.error(`  [${i + 1}/${total}] ERROR: ${err instanceof Error ? err.message : err}`)
        continue
      }
    }

    // Content preservation check: word count ratio
    const howardWords = wordCount(howard)
    const blandWords = wordCount(bland)
    const ratio = blandWords / howardWords

    if (ratio < 0.5 || ratio > 2.0) {
      contentDriftSkips++
      console.warn(`  [${i + 1}/${total}] SKIP: word count drift ${howardWords} → ${blandWords} (ratio ${ratio.toFixed(2)})`)
      continue
    }

    // Estimate costs
    const inputTokens = howardWords * 1.3
    const outputTokens = blandWords * 1.3
    totalInputCost += inputTokens * 0.29 / 1_000_000
    totalOutputCost += outputTokens * 0.59 / 1_000_000

    // Format as training pair
    // Split into paragraphs and pair them individually for per-paragraph training
    const howardParas = howard.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0)
    const blandParas = bland.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0)

    if (howardParas.length === blandParas.length) {
      // Paragraph-aligned: create per-paragraph pairs
      for (let p = 0; p < howardParas.length; p++) {
        const pHoward = howardParas[p]
        const pBland = blandParas[p]

        // Skip very short paragraphs
        if (wordCount(pHoward) < 20 || wordCount(pBland) < 15) continue

        const pair = {
          messages: [
            { role: "system", content: TONAL_SYSTEM_PROMPT },
            { role: "user", content: pBland },
            { role: "assistant", content: pHoward },
          ],
        }
        pairs.push(JSON.stringify(pair))
      }
    } else {
      // Paragraph count mismatch: use whole chunk as one pair
      const pair = {
        messages: [
          { role: "system", content: TONAL_SYSTEM_PROMPT },
          { role: "user", content: bland },
          { role: "assistant", content: howard },
        ],
      }
      pairs.push(JSON.stringify(pair))
    }

    if ((i + 1) % 25 === 0 || i === total - 1) {
      console.log(`  [${i + 1}/${total}] ${pairs.length} pairs generated`)
    }
  }

  // Write output
  writeFileSync(OUTPUT_FILE, pairs.join("\n") + "\n")

  // Stats
  const pairWordCounts = pairs.map(p => {
    const msg = JSON.parse(p).messages
    return {
      system: wordCount(msg[0].content),
      user: wordCount(msg[1].content),
      assistant: wordCount(msg[2].content),
      total: wordCount(msg[0].content) + wordCount(msg[1].content) + wordCount(msg[2].content),
    }
  })

  const avgUserWords = Math.round(pairWordCounts.reduce((s, p) => s + p.user, 0) / pairWordCounts.length)
  const avgAssistantWords = Math.round(pairWordCounts.reduce((s, p) => s + p.assistant, 0) / pairWordCounts.length)
  const totalTokensEst = Math.round(pairWordCounts.reduce((s, p) => s + p.total * 1.3, 0))

  console.log(`\n${"=".repeat(60)}`)
  console.log(`STATS`)
  console.log(`${"=".repeat(60)}`)
  console.log(`Chunks processed:     ${total}`)
  console.log(`Total pairs:          ${pairs.length} (per-paragraph when aligned)`)
  console.log(`Errors:               ${errors}`)
  console.log(`Content drift skips:  ${contentDriftSkips}`)
  console.log(`Avg bland words:      ${avgUserWords}`)
  console.log(`Avg Howard words:     ${avgAssistantWords}`)
  console.log(`Est. total tokens:    ~${totalTokensEst.toLocaleString()}`)
  console.log(``)
  console.log(`Flattening cost:      ~$${(totalInputCost + totalOutputCost).toFixed(2)} (Groq Qwen 32B)`)
  console.log(`Training cost (1ep):  ~$${(totalTokensEst * 0.48 / 1_000_000).toFixed(2)} (Together SFT LoRA)`)
  console.log(`Output:               ${OUTPUT_FILE}`)

  // Print sample pairs
  if (pairs.length >= 2) {
    console.log(`\n${"=".repeat(60)}`)
    console.log(`SAMPLE PAIRS`)
    console.log(`${"=".repeat(60)}`)

    for (let s = 0; s < Math.min(2, pairs.length); s++) {
      const sample = JSON.parse(pairs[s])
      console.log(`\n--- PAIR ${s + 1} ---`)
      console.log(`BLAND (${wordCount(sample.messages[1].content)} words):`)
      console.log(sample.messages[1].content.slice(0, 300))
      console.log(`\nHOWARD (${wordCount(sample.messages[2].content)} words):`)
      console.log(sample.messages[2].content.slice(0, 300))
      console.log()
    }
  }
}

main().catch(console.error)
