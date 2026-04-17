/**
 * Flatten each dialogue line to a semantically-equivalent neutral paraphrase.
 * The training pair is (flat, char_name) → (voiced original).
 *
 * Runner: Sonnet subagents via callAgent with a pinned system prompt.
 * Per feedback_sonnet_subagents: Sonnet labeling uses Claude Code subagents
 * rather than transport API calls. This script generates the prompt bundle
 * and writes to disk; we hand off to a subagent invocation to actually run.
 *
 * Input:  dialogue-lines.jsonl
 * Output: dialogue-pairs.jsonl  — { char, line: voiced_original, flat: neutral_paraphrase }
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const HERE = new URL(".", import.meta.url).pathname
const IN  = join(HERE, "dialogue-lines.jsonl")
const OUT = join(HERE, "dialogue-pairs.jsonl")
const PROMPT_BUNDLE = join(HERE, "sonnet-flatten-prompts.json")

const SYSTEM_PROMPT = `You rewrite dialogue lines to remove voice and style while preserving the speaker's semantic intent.

Take a voiced dialogue line and output a FLAT paraphrase that:
- Preserves every semantic claim, question, command, or emotional beat
- Strips distinctive dialect, vocabulary, rhythm, cadence
- Uses plain, functional Standard English
- Keeps roughly the same word count (±20%)
- Does NOT add new information
- Does NOT editorialize or summarize

Output ONLY the flat paraphrase. No quotes, no commentary, no attribution.

Examples:
  Voiced:  "Aye, but he's no the dwarf I fostered, not no more."
  Flat:    He is no longer the dwarf I raised.

  Voiced:  "By the gods and my own grave, I'll not stand and watch this."
  Flat:    I refuse to stand by and watch this happen.

  Voiced:  "A curious thing, the way fate has a habit of arriving on foot."
  Flat:    Interesting how fate so often shows up unexpectedly.`

interface DialogueRow { char: string; line: string; beat_id: string }

function main() {
  const rows: DialogueRow[] = readFileSync(IN, "utf8")
    .trim().split("\n").map(l => JSON.parse(l))

  console.log(`Loaded ${rows.length} dialogue lines for flattening`)

  // Emit a Sonnet-subagent prompt bundle. The POC runner invokes these via
  // Claude Code subagents (NOT transport.ts), per feedback_sonnet_subagents.
  // Each bundle entry becomes one subagent call with SYSTEM_PROMPT + the line.
  const bundle = rows.map((r, i) => ({
    id: i,
    char: r.char,
    beat_id: r.beat_id,
    system: SYSTEM_PROMPT,
    user: `Voiced:\n"${r.line}"\n\nFlat:`,
    voiced_original: r.line,
  }))

  writeFileSync(PROMPT_BUNDLE, JSON.stringify(bundle, null, 2))
  console.log(`Prompt bundle → ${PROMPT_BUNDLE}`)
  console.log()
  console.log("NEXT STEP: run the Sonnet subagent pass over the bundle.")
  console.log("  Invocation (from Claude Code): dispatch a batch of agents (≤10 parallel")
  console.log("  per feedback_parallel_batch_limit), each processing a slice, merging")
  console.log("  results into dialogue-pairs.jsonl with schema:")
  console.log("    { char, voiced: <original>, flat: <sonnet output> }")
  console.log()
  console.log(`Output target: ${OUT}`)
}

main()
