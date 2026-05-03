/**
 * Voice-shaping prompt fragments for `voice-shaping-ablation-v1` per
 * charter §5 parity contract. Each fragment is a pre-registered,
 * version-controlled text that gets injected into the arm's system
 * prompt (D1/D2) or user prompt CHARACTERS section (D3).
 *
 * NOT imported from any production code path. Used only by
 * `scripts/archive/evals/run-voice-shaping-ablation.ts`.
 */

import { readFileSync } from "node:fs"
import path from "node:path"

// ── D1: textual style guide ─────────────────────────────────────────

/**
 * System-prompt addendum describing target voice without direct
 * corpus quotes. Derived from Salvatore reference analysis:
 * meanSentenceLength ~21w, moderate sentence-length variation,
 * ~27% dialogue, ~1.2 clauses/sentence, low sensory-density
 * (narrative economy, not purple prose).
 */
export const VOICE_STYLE_GUIDE = `VOICE STYLE GUIDE:

The target voice is heroic fantasy with restraint — the kind of prose
that reads like an oral storyteller who's earned the right to be brief.
Aim for these textures:

- **Cadence.** Mostly declarative, averaging ~20 words per sentence
  with meaningful variation. Land on a short sentence after a longer
  passage when a beat needs emphasis. Avoid uniformity; rhythm is
  earned by contrast.
- **Dialogue.** When characters speak, they speak directly. Favor
  short lines over extended speeches. Attribution is simple ("said",
  "asked", "muttered") and often left implicit when two characters
  alternate. Dialogue makes up roughly a quarter to a third of prose
  by volume in scenes where it happens.
- **Clause complexity.** Moderate — around one comma or semicolon
  per sentence on average. Compound structures are welcome when they
  carry weight, but multiple subordinate clauses per sentence dilute
  impact.
- **Sensory density.** Sparing and deliberate. Name a specific
  sensory detail (cold iron, pine smoke, sweat on the haft of a
  weapon) where it carries meaning. Do not atmospherize at the
  expense of forward motion.
- **Interiority.** Favor externalized stakes over long internal
  monologue. When interiority is warranted, prefer one decisive
  thought or a brief remembered fact over a paragraph of reflection.
- **What to avoid.** Excessive adjective stacking. Abstractions
  ("a sense of", "the feeling of") where concrete images would do.
  Narrator commentary on the character's own state. Metaphor strain
  that slows the sentence.

Write as if the reader is smart and the page is expensive.`

// ── D2: few-shot reference passages ─────────────────────────────────

/**
 * System-prompt addendum prepending 3-5 actual Salvatore prose
 * excerpts as voice exemplars. Loaded at runtime from the
 * committed artifact.
 */
export function buildReferencePassagesBlock(
  passagesPath = "scripts/archive/evals/voice-reference-passages.json",
): string {
  const raw = readFileSync(path.resolve(passagesPath), "utf8")
  const data = JSON.parse(raw) as {
    passages: Array<{ attribution: string; prose: string; words: number }>
  }
  const lines: string[] = [
    "VOICE REFERENCE PASSAGES:",
    "",
    "Below are example passages that embody the target voice. They are",
    "EXAMPLES of cadence, register, dialogue pattern, and sensory economy —",
    "NOT templates to copy, NOT characters or settings to reuse. Produce",
    "your own beat with the beat's own characters, setting, and action,",
    "but match the rhythmic and textural qualities of these examples.",
    "",
  ]
  data.passages.slice(0, 5).forEach((p, i) => {
    lines.push(`--- Example ${i + 1} (${p.words}w) ---`)
    lines.push(p.prose)
    lines.push("")
  })
  lines.push("--- End of examples ---")
  return lines.join("\n")
}

// ── D3: per-character voice directives ──────────────────────────────

/**
 * Replaces the user_prompt CHARACTERS section with a richer
 * per-character directive block. The original compact-mode
 * CHARACTERS block has: Voice, Drives, Avoids, Conflict, example
 * lines. D3 adds explicit CADENCE (sentence-length target),
 * REGISTER (vocabulary band), SIGNATURE PHRASINGS, and DIALOGUE TAG
 * CONSTRAINTS. Character-distinctness-focused — the aim is to make
 * characters measurably distinguishable in the prose layer without
 * relying on prior LoRA training.
 *
 * Input: the existing CHARACTERS section text (parsed per-character
 * snapshots). Output: a replacement block with the same character
 * data plus the new directive fields derived from each character's
 * speechPattern + traits.
 */
export function buildCharacterVoiceDirectivesBlock(
  charactersSection: string,
): string {
  // The existing CHARACTERS section uses the compact-mode format
  // per beat-context.ts:177-193 :
  //
  //   CHARACTERS:
  //   <Name>:
  //     Voice: ...
  //     Drives: ...
  //     Avoids: ...
  //     Conflict: ...
  //     Example voiced lines:
  //       1. "..."
  //       2. "..."
  //
  // D3's transform: prepend a rubric header + heuristic per-character
  // "distinctness levers" reminder. It does NOT need per-character
  // auto-generation of cadence/register (would require an extra
  // analysis pass) — the rubric is the lever. Whether the writer uses
  // it is the experimental question.

  const header = [
    "CHARACTER VOICE DIRECTIVES:",
    "",
    "When multiple characters speak in this beat, their dialogue and",
    "attributed action MUST be distinguishable from each other without",
    "the attribution tag. Use these levers:",
    "",
    "- **Cadence signature:** one character favors clipped imperatives;",
    "  another uses longer contemplative constructions; a third speaks",
    "  in fragments under stress. Differentiate rhythmically.",
    "- **Register band:** pick a vocabulary tier per character and hold",
    "  it — formal/archaic for scholars, vernacular/direct for fighters,",
    "  figurative/indirect for diplomats. No character should slip out",
    "  of their band within this beat.",
    "- **Signature phrasings:** if a character has a recurring figure",
    "  of speech or habitual construction (from the Voice or example",
    "  lines below), USE IT at least once when they speak.",
    "- **Dialogue tag variety:** avoid attaching every line to \"said.\"",
    "  Use physical attribution (\"she gripped the blade and answered\"),",
    "  implicit attribution in alternating dialogue, or the occasional",
    "  specific verb (\"muttered\", \"pressed\"). One-third rule: no more",
    "  than 1/3 of dialogue lines attributed with \"said.\"",
    "",
    "Read each character's profile below and commit to ONE distinct",
    "rhythmic + register choice per character before writing. If two",
    "characters' profiles are close, invent the distinction at the",
    "prose layer — do not let them blur.",
    "",
    "--- Character profiles ---",
    "",
  ].join("\n")

  // Strip the "CHARACTERS:" label from the existing section (it'll be
  // replaced by our header) but keep the character entries
  const stripped = charactersSection.replace(/^CHARACTERS:\s*\n?/, "")
  return header + stripped
}

// ── Arm configuration ─────────────────────────────────────────────────

export interface ArmConfig {
  cell_label: "D0-bare" | "D1-style-guide" | "D2-few-shot" | "D3-char-directives"
  systemPromptAddition: string   // prepended to the baseline system prompt
  transformUserPrompt: ((text: string) => string) | null  // optional user_prompt rewriter
  callerId: string
}

/** The four DeepSeek arms. D0 is the baseline; D1/D2/D3 each add
 *  exactly one named intervention. */
export function getAblationArms(passagesPath?: string): ArmConfig[] {
  return [
    {
      cell_label: "D0-bare",
      systemPromptAddition: "",
      transformUserPrompt: null,
      callerId: "voice-shaping-D0",
    },
    {
      cell_label: "D1-style-guide",
      systemPromptAddition: "\n\n" + VOICE_STYLE_GUIDE,
      transformUserPrompt: null,
      callerId: "voice-shaping-D1",
    },
    {
      cell_label: "D2-few-shot",
      systemPromptAddition: "\n\n" + buildReferencePassagesBlock(passagesPath),
      transformUserPrompt: null,
      callerId: "voice-shaping-D2",
    },
    {
      cell_label: "D3-char-directives",
      systemPromptAddition: "",
      transformUserPrompt: (text: string) => {
        // Replace the CHARACTERS section with the directives block.
        // Match via header prefix since beat-context.ts emits "CHARACTERS:"
        // as a section start; keep content through the section's
        // terminator (next \n\nHEADER: or end of string).
        const charactersRegex = /(^|\n\n)(CHARACTERS:[\s\S]*?)(?=\n\n(?:[A-Z][A-Z\s-]*:|Sensory:)|\n\n---|\s*$)/
        const m = text.match(charactersRegex)
        if (!m) return text  // no CHARACTERS section — nothing to replace
        const replaced = buildCharacterVoiceDirectivesBlock(m[2])
        return text.replace(charactersRegex, (full, lead) => lead + replaced)
      },
      callerId: "voice-shaping-D3",
    },
  ]
}
