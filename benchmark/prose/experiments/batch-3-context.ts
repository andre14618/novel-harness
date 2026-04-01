/**
 * Batch 3: Context Structure Sweep
 *
 * Tests how the "Emotional shift" lines in scene beats affect telling.
 * Uses best prompt (A2: positive-only) at best temperature (0.8).
 *
 * Usage: bun benchmark/prose/experiments/batch-3-context.ts
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
  name: "Context Structure Sweep",
  description: "Test 3 context structures with A2 prompt at T=0.8. How do emotional shift labels affect telling?",
  variants: [
    {
      label: "C1: emotional labels (current)",
      systemPrompt: PROMPT,
      // no modifier — keeps "Emotional shift: stasis -> unease"
    },
    {
      label: "C2: no emotional labels",
      systemPrompt: PROMPT,
      contextModifier: (prompt) => prompt.replace(/\n   Emotional shift: .+/g, ""),
    },
    {
      label: "C3: physical cues",
      systemPrompt: PROMPT,
      contextModifier: (prompt) => prompt
        .replace("Emotional shift: stasis -> unease", "Character behavior: still, routine → restless, checking surroundings")
        .replace("Emotional shift: suspicion -> dread", "Character behavior: guarded, watching → backing away, hands clenching")
        .replace("Emotional shift: disbelief -> resolve", "Character behavior: frozen, shaking head → jaw set, picking up what's needed"),
    },
  ],
  runsPerSeed: 2,
}

runBatch(batch)
