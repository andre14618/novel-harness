#!/usr/bin/env bun
/**
 * Generate training pairs for a writer fine-tune.
 *
 * For each Howard chunk, uses a big model to reverse-engineer structured context
 * that matches our writer agent's context format:
 *   - Scene setup (setting, POV, purpose, beats)
 *   - Character profiles (traits, speech patterns, relationships)
 *   - Story context (theme, conflict, act position)
 *   - Craft-relevant notes (world details, sensory palette)
 *
 * Output: JSONL with {"messages": [system, user, assistant]} format
 * where user = synthetic structured context, assistant = Howard's actual prose.
 *
 * The system prompt is kept generic so the LoRA learns "write prose from context"
 * and the style comes from the weights, not from style-specific instructions.
 *
 * Usage:
 *   CEREBRAS_API_KEY=... bun scripts/generate-writer-pairs.ts
 *   MAX_CHUNKS=50 bun scripts/generate-writer-pairs.ts   # limit for testing
 */

import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

const INPUT_FILE = join(import.meta.dir, "../lora-data/howard-training.jsonl")
const OUTPUT_FILE = join(import.meta.dir, "../lora-data/howard-writer-pairs.jsonl")
const CACHE_DIR = join(import.meta.dir, "../lora-data/context-cache")

const MAX_CHUNKS = parseInt(process.env.MAX_CHUNKS ?? "9999")
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY
if (!CEREBRAS_API_KEY) {
  console.error("CEREBRAS_API_KEY required")
  process.exit(1)
}

// ── Context extraction prompt ───────────────────────────────────────────────
// Varies across 4 templates to avoid diversity collapse in the synthetic inputs

const EXTRACTION_PROMPTS = [
  `Analyze this prose passage and extract structured context that a writer would need to produce it. Return JSON with these fields:

{
  "scene_setup": {
    "setting": "specific location and time of day",
    "pov_character": "name of the viewpoint character (or 'omniscient' if no clear POV)",
    "purpose": "what this passage accomplishes narratively (e.g., 'establish threat', 'action climax', 'build atmosphere')",
    "beats": ["ordered list of 2-4 specific story beats that occur in this passage"]
  },
  "characters_present": [
    {
      "name": "character name",
      "role": "protagonist/antagonist/supporting/minor",
      "traits": ["2-3 observable traits from this passage"],
      "speech_pattern": "how they talk (if dialogue present), or 'no dialogue'",
      "emotional_state": "their emotional state in this passage",
      "action": "what they're doing"
    }
  ],
  "story_context": {
    "genre": "sword-and-sorcery / horror / adventure",
    "tone": "the dominant mood (e.g., 'dread', 'violent urgency', 'eerie calm')",
    "conflict": "the active conflict or tension in this passage",
    "stakes": "what's at risk"
  },
  "world_details": {
    "sensory_palette": "dominant senses engaged (e.g., 'torchlight, cold stone, blood smell')",
    "setting_details": ["2-3 specific environmental details mentioned or implied"],
    "constraints": "any world rules visible (e.g., 'sorcery exists', 'pre-gunpowder weapons')"
  }
}

Extract ONLY what is present or clearly implied in the text. Do not invent backstory or context not supported by the passage.`,

  `You are a story context analyst. Given a prose passage, extract the structured scene information a writer would need to recreate it. Return JSON:

{
  "scene_setup": {
    "setting": "where and when this takes place",
    "pov_character": "whose eyes we see through",
    "purpose": "narrative function of this passage",
    "beats": ["the specific events/moments in order"]
  },
  "characters_present": [
    {
      "name": "name",
      "role": "their story role",
      "traits": ["visible personality traits"],
      "speech_pattern": "dialogue style if present",
      "emotional_state": "current state",
      "action": "what they do in this passage"
    }
  ],
  "story_context": {
    "genre": "genre classification",
    "tone": "emotional atmosphere",
    "conflict": "what tension drives this passage",
    "stakes": "consequences if things go wrong"
  },
  "world_details": {
    "sensory_palette": "what the reader sees/hears/smells/feels",
    "setting_details": ["concrete environmental elements"],
    "constraints": "visible world rules or technology level"
  }
}

Be precise. Only extract what the text supports.`,

  `Extract the scene blueprint from this prose. A different writer should be able to produce a passage with the same content and structure from your extraction alone. Return JSON:

{
  "scene_setup": {
    "setting": "location + atmosphere",
    "pov_character": "viewpoint character or narrator stance",
    "purpose": "what this scene does for the larger story",
    "beats": ["sequential plot/action/emotional beats"]
  },
  "characters_present": [
    {
      "name": "character name",
      "role": "narrative role",
      "traits": ["demonstrated traits"],
      "speech_pattern": "if they speak, how",
      "emotional_state": "internal state shown through action",
      "action": "their primary action"
    }
  ],
  "story_context": {
    "genre": "genre",
    "tone": "dominant mood",
    "conflict": "active tension",
    "stakes": "what hangs in the balance"
  },
  "world_details": {
    "sensory_palette": "sense details",
    "setting_details": ["environmental specifics"],
    "constraints": "world logic/tech level"
  }
}

Focus on what's dramatized, not implied backstory.`,

  `Reverse-engineer the writing instructions for this passage. What would you tell a writer so they produce something with the same events, characters, and atmosphere? Return JSON:

{
  "scene_setup": {
    "setting": "the physical and temporal setting",
    "pov_character": "who narrates or whose perspective dominates",
    "purpose": "the passage's job in the story",
    "beats": ["what happens, step by step"]
  },
  "characters_present": [
    {
      "name": "name",
      "role": "story function",
      "traits": ["personality as shown"],
      "speech_pattern": "dialogue voice",
      "emotional_state": "where they are emotionally",
      "action": "their primary business in this passage"
    }
  ],
  "story_context": {
    "genre": "genre label",
    "tone": "mood/atmosphere",
    "conflict": "what's driving tension",
    "stakes": "what could be lost or gained"
  },
  "world_details": {
    "sensory_palette": "the sense impressions that dominate",
    "setting_details": ["concrete details a writer should include"],
    "constraints": "rules of this world that are visible"
  }
}

Be concrete, not abstract. "A dark temple with guttering torches" not "an ominous location."`
]

// ── Writer system prompt (generic — style comes from the LoRA weights) ──────

const WRITER_SYSTEM_PROMPT = `You are a prose writer. Write vivid, engaging fiction based on the scene context provided.

Rules:
- Follow the scene beats in order
- Write from the specified POV character's perspective
- Show emotion through action and body language, never narrator statements
- Anchor every paragraph in sensory detail specific to the setting
- Every character must sound distinct in dialogue
- Use \n\n between paragraphs
- Write prose only — no commentary, no metadata`

// ── Format extracted context as a writer prompt ─────────────────────────────

function formatAsWriterPrompt(ctx: any): string {
  const sections: string[] = []

  // Scene setup
  const setup = ctx.scene_setup
  sections.push(`SCENE SETUP:
Setting: ${setup.setting}
POV Character: ${setup.pov_character}
Purpose: ${setup.purpose}

BEATS (follow in order):
${setup.beats.map((b: string, i: number) => `${i + 1}. ${b}`).join("\n")}`)

  // Characters
  if (ctx.characters_present?.length > 0) {
    const charLines = ctx.characters_present.map((c: any) => {
      let line = `${c.name} (${c.role}):`
      if (c.traits?.length > 0) line += `\n  Traits: ${c.traits.join(", ")}`
      if (c.speech_pattern && c.speech_pattern !== "no dialogue") line += `\n  Speech: ${c.speech_pattern}`
      if (c.emotional_state) line += `\n  State: ${c.emotional_state}`
      if (c.action) line += `\n  Action: ${c.action}`
      return line
    }).join("\n\n")
    sections.push(`CHARACTERS PRESENT:\n${charLines}`)
  }

  // Story context
  const story = ctx.story_context
  sections.push(`STORY CONTEXT:
Genre: ${story.genre}
Tone: ${story.tone}
Conflict: ${story.conflict}
Stakes: ${story.stakes}`)

  // World details
  const world = ctx.world_details
  let worldSection = `WORLD DETAILS:\nSensory palette: ${world.sensory_palette}`
  if (world.setting_details?.length > 0) {
    worldSection += `\nSetting: ${world.setting_details.join("; ")}`
  }
  if (world.constraints) {
    worldSection += `\nConstraints: ${world.constraints}`
  }
  sections.push(worldSection)

  return sections.join("\n\n")
}

// ── API call ────────────────────────────────────────────────────────────────

async function extractContext(prose: string, promptIdx: number): Promise<any> {
  const prompt = EXTRACTION_PROMPTS[promptIdx % EXTRACTION_PROMPTS.length]

  const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CEREBRAS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen-3-235b-a22b-instruct-2507",
      temperature: 0.3,
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: prose },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Cerebras API error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json() as any
  const content = data.choices[0].message.content

  // Strip thinking tags if present (Qwen3 /nothink not reliable on Cerebras)
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
  return JSON.parse(cleaned)
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Ensure cache dir exists
  const { mkdirSync } = await import("fs")
  mkdirSync(CACHE_DIR, { recursive: true })

  const lines = readFileSync(INPUT_FILE, "utf-8").trim().split("\n")
  const chunks = lines.map(l => JSON.parse(l).text as string)
  const total = Math.min(chunks.length, MAX_CHUNKS)

  console.log(`=== Writer Pair Generation ===`)
  console.log(`Input: ${chunks.length} chunks, processing ${total}`)
  console.log(`Model: Qwen3 235B on Cerebras`)
  console.log(`Output: ${OUTPUT_FILE}\n`)

  const pairs: string[] = []
  let errors = 0

  for (let i = 0; i < total; i++) {
    const prose = chunks[i]
    const cacheFile = join(CACHE_DIR, `ctx-${i}.json`)

    // Check cache
    let ctx: any
    if (existsSync(cacheFile)) {
      ctx = JSON.parse(readFileSync(cacheFile, "utf-8"))
    } else {
      try {
        ctx = await extractContext(prose, i)
        writeFileSync(cacheFile, JSON.stringify(ctx, null, 2))
      } catch (err) {
        errors++
        console.error(`  [${i + 1}/${total}] ERROR: ${err instanceof Error ? err.message : err}`)
        continue
      }

      // Rate limit politeness
      if (i % 10 === 9) await new Promise(r => setTimeout(r, 200))
    }

    // Validate extracted context has required fields
    if (!ctx.scene_setup?.setting || !ctx.scene_setup?.beats?.length) {
      errors++
      console.error(`  [${i + 1}/${total}] SKIP: incomplete context extraction`)
      continue
    }

    // Format as training pair
    const userPrompt = formatAsWriterPrompt(ctx)
    const pair = {
      messages: [
        { role: "system", content: WRITER_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
        { role: "assistant", content: prose },
      ],
    }

    pairs.push(JSON.stringify(pair))

    if ((i + 1) % 50 === 0 || i === total - 1) {
      console.log(`  [${i + 1}/${total}] ${pairs.length} pairs generated (${errors} errors)`)
    }
  }

  // Write output
  writeFileSync(OUTPUT_FILE, pairs.join("\n") + "\n")

  // Stats
  const avgInputWords = pairs.reduce((sum, p) => {
    const msg = JSON.parse(p).messages
    return sum + msg[1].content.split(/\s+/).length
  }, 0) / pairs.length

  const avgOutputWords = pairs.reduce((sum, p) => {
    const msg = JSON.parse(p).messages
    return sum + msg[2].content.split(/\s+/).length
  }, 0) / pairs.length

  const totalTokensEst = pairs.reduce((sum, p) => {
    const msg = JSON.parse(p).messages
    const words = msg[0].content.split(/\s+/).length +
                  msg[1].content.split(/\s+/).length +
                  msg[2].content.split(/\s+/).length
    return sum + Math.round(words * 1.3)
  }, 0)

  console.log(`\n${"=".repeat(60)}`)
  console.log(`STATS`)
  console.log(`${"=".repeat(60)}`)
  console.log(`Total pairs:          ${pairs.length}`)
  console.log(`Errors/skipped:       ${errors}`)
  console.log(`Avg context words:    ${Math.round(avgInputWords)}`)
  console.log(`Avg prose words:      ${Math.round(avgOutputWords)}`)
  console.log(`Est. total tokens:    ~${totalTokensEst.toLocaleString()}`)
  console.log(`Est. training cost:   ~$${(totalTokensEst * 0.48 / 1_000_000).toFixed(2)} (1 epoch)`)
  console.log(`Output:               ${OUTPUT_FILE}`)

  // Print first pair for verification
  if (pairs.length > 0) {
    console.log(`\n${"=".repeat(60)}`)
    console.log(`SAMPLE PAIR (first)`)
    console.log(`${"=".repeat(60)}`)
    const sample = JSON.parse(pairs[0])
    console.log(`\n--- SYSTEM ---`)
    console.log(sample.messages[0].content.slice(0, 200))
    console.log(`\n--- USER (context, ${sample.messages[1].content.split(/\s+/).length} words) ---`)
    console.log(sample.messages[1].content)
    console.log(`\n--- ASSISTANT (prose, ${sample.messages[2].content.split(/\s+/).length} words) ---`)
    console.log(sample.messages[2].content.slice(0, 400) + "...")
  }
}

main().catch(console.error)
