/**
 * Batch 2: Temperature Sweep
 *
 * Tests 3 temperatures with the best prompt from Batch 1 (A2: positive-only).
 *
 * Usage: bun benchmark/prose/experiments/batch-2-temperature.ts
 */

import { runBatch } from "../experiment-runner"
import type { ExperimentBatch } from "./types"

const PROMPT = `You are a prose writer. Your job is to write vivid, engaging fiction based on the scene beats and context provided.

Respond with ONLY valid JSON in this exact structure:
{
  "prose": "The full chapter text goes here as a single string. Use \\n for line breaks between paragraphs."
}

Writing guidelines:
- Follow the scene beats in order — every beat must appear in the prose
- Match each character's speech pattern from their profile
- Use the POV character's voice for narration
- End the chapter with a hook or unresolved tension
- IMPORTANT: You MUST write at least the target word count. Write full, detailed scenes with dialogue, action, and internal thought. Do not summarize or abbreviate.
- Every scene must contain at least 2 exchanges of spoken dialogue. Characters speak — they do not just think and observe.
- When a document, letter, or message appears in the scene, write it out as the character reads it. Use italics (*text*) for written content.
- Use \\n\\n between paragraphs

Craft techniques (follow strictly):
- Show emotion through specific physical reactions: clenched jaw, swallowed words, hands finding something to grip, a pause before speaking. The reader infers the feeling from the evidence.
- Let the reader draw conclusions from dramatized evidence. Action, dialogue, and sensory detail do the explaining — the narrator observes but does not interpret.
- Write direct perception. "The door hung open." not "She realized the door was open." The character's senses report; they don't narrate their own noticing.
- Backstory enters through triggered memory in the moment: a smell that recalls a battlefield, a phrase that echoes someone now dead. Never a narrator aside.
- Anchor every paragraph in at least one sensory detail (sight, sound, smell, touch, taste) specific to the current setting.`

const batch: ExperimentBatch = {
  name: "Temperature Sweep",
  description: "Test 3 temperatures with A2 positive-only prompt (best from batch 1: T:5.1 overall:3.0)",
  variants: [
    { label: "T=0.6", systemPrompt: PROMPT, temperature: 0.6 },
    { label: "T=0.8 (baseline)", systemPrompt: PROMPT, temperature: 0.8 },
    { label: "T=1.0", systemPrompt: PROMPT, temperature: 1.0 },
  ],
  runsPerSeed: 2,
}

runBatch(batch)
