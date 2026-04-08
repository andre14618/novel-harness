/**
 * Tonal pass context builder.
 *
 * Splits chapter prose into paragraphs and builds per-paragraph prompts.
 * The caller (runTonalPass) iterates these and calls the agent once per paragraph.
 */

export interface TonalPassInput {
  paragraph: string
  /** 1-paragraph window before for transition continuity */
  preceding: string | null
  /** 1-paragraph window after so the model knows what follows */
  following: string | null
  index: number
}

/**
 * Split a chapter's prose into paragraph-level inputs for tonal rewriting.
 * Dialogue-only paragraphs (>90% inside quotes) are skipped — they'll pass
 * through unchanged since the voice target is narration, not dialogue.
 */
export function splitIntoParagraphs(prose: string): TonalPassInput[] {
  const paragraphs = prose
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0)

  const inputs: TonalPassInput[] = []

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]

    // Skip dialogue-only paragraphs (>90% quoted text)
    if (isDialogueOnly(para)) continue

    inputs.push({
      paragraph: para,
      preceding: i > 0 ? paragraphs[i - 1] : null,
      following: i < paragraphs.length - 1 ? paragraphs[i + 1] : null,
      index: i,
    })
  }

  return inputs
}

function isDialogueOnly(paragraph: string): boolean {
  const dialogueMatches = paragraph.match(/[""\u201C]([^""\u201D]*?)[""\u201D]/g) || []
  const dialogueChars = dialogueMatches.reduce((sum, m) => sum + m.length, 0)
  return dialogueChars / paragraph.length > 0.9
}

/**
 * Build the user prompt for a single paragraph rewrite.
 * Includes surrounding context so the model preserves transitions.
 */
export function buildParagraphPrompt(input: TonalPassInput): string {
  const parts: string[] = []

  if (input.preceding) {
    parts.push(`PRECEDING PARAGRAPH (do not rewrite, context only):\n${input.preceding}`)
  }

  parts.push(`PARAGRAPH TO REWRITE:\n${input.paragraph}`)

  if (input.following) {
    parts.push(`FOLLOWING PARAGRAPH (do not rewrite, context only):\n${input.following}`)
  }

  return parts.join("\n\n")
}

/**
 * Reassemble the chapter from original paragraphs + rewritten ones.
 * rewrites is a sparse map: index → new text. Missing indices use original.
 */
export function reassemble(
  originalProse: string,
  rewrites: Map<number, string>,
): string {
  const paragraphs = originalProse
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0)

  const output = paragraphs.map((para, i) => rewrites.get(i) ?? para)
  return output.join("\n\n")
}
