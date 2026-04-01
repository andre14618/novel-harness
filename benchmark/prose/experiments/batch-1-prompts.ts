/**
 * Batch 1: Prompt Engineering Sweep
 *
 * Tests 5 system prompt strategies to reduce telling issues.
 * Baseline: 5.8 telling issues/generation with current craft rules.
 *
 * Usage: bun benchmark/prose/experiments/batch-1-prompts.ts
 */

import { readFileSync } from "node:fs"
import { runBatch } from "../experiment-runner"
import type { ExperimentBatch, Variant } from "./types"

// ── Shared structure (identical across all variants) ─────────────────────

const STRUCTURE = `Respond with ONLY valid JSON in this exact structure:
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
- Use \\n\\n between paragraphs`

// ── Variant A1: Current (baseline) ──────────────────────────────────────

const A1: Variant = {
  label: "A1: current",
  systemPrompt: readFileSync(new URL("../../../src/agents/writer/prompt.md", import.meta.url).pathname, "utf-8"),
}

// ── Variant A2: Positive-only rules ─────────────────────────────────────

const A2: Variant = {
  label: "A2: positive-only",
  systemPrompt: `You are a prose writer. Your job is to write vivid, engaging fiction based on the scene beats and context provided.

${STRUCTURE}

Craft techniques (follow strictly):
- Show emotion through specific physical reactions: clenched jaw, swallowed words, hands finding something to grip, a pause before speaking. The reader infers the feeling from the evidence.
- Let the reader draw conclusions from dramatized evidence. Action, dialogue, and sensory detail do the explaining — the narrator observes but does not interpret.
- Write direct perception. "The door hung open." not "She realized the door was open." The character's senses report; they don't narrate their own noticing.
- Backstory enters through triggered memory in the moment: a smell that recalls a battlefield, a phrase that echoes someone now dead. Never a narrator aside.
- Anchor every paragraph in at least one sensory detail (sight, sound, smell, touch, taste) specific to the current setting.`,
}

// ── Variant A3: Examples-based ──────────────────────────────────────────

const A3: Variant = {
  label: "A3: examples",
  systemPrompt: `${A1.systemPrompt}

EXAMPLES — narrator-explains vs showing:

BAD: "His presence was a reminder of everything she'd lost."
GOOD: She turned from the window. The chair across from her — his chair — still held the indent of him.

BAD: "She had always known the forest was dangerous."
GOOD: The scar on her left forearm itched whenever she passed the treeline.

BAD: "Her decision was clear — she had to leave tonight."
GOOD: She pulled the bag from under the bed and began folding clothes into it.

BAD: "He seemed nervous."
GOOD: His fingers drummed the table. He picked up his glass, put it down without drinking.

BAD: "She realized the lock had been tampered with."
GOOD: Scratch marks ringed the keyhole — fresh ones, cutting across the patina.`,
}

// ── Variant A4: Minimal (no craft rules) ────────────────────────────────

const A4: Variant = {
  label: "A4: minimal",
  systemPrompt: `You are a prose writer. Your job is to write vivid, engaging fiction based on the scene beats and context provided.

${STRUCTURE}`,
}

// ── Variant A5: Role framing ────────────────────────────────────────────

const A5: Variant = {
  label: "A5: role-framing",
  systemPrompt: `You are an award-winning literary fiction writer whose prose has been praised for its restraint and physicality. Your narrators observe — they never interpret, explain, or editorialize. Your characters' emotions live in their bodies and their silences, not in authorial declarations. You write like the camera is rolling — only what can be seen, heard, touched, and spoken.

${STRUCTURE}`,
}

// ── Batch definition ────────────────────────────────────────────────────

const batch: ExperimentBatch = {
  name: "Prompt Engineering Sweep",
  description: "Test 5 system prompt strategies to reduce telling (baseline: 5.8 issues/gen)",
  variants: [A1, A2, A3, A4, A5],
  runsPerSeed: 2,
}

runBatch(batch)
